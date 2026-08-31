import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { getCredentials, getModelForStage } from '@/features/settings/settingsStore';
import { completeWithPdf, extractJson } from '@/lib/bedrock';
import { validateParsedResume } from '@/lib/parsedResume';
import { supabase } from '@/lib/supabase';
import { newId } from '@/lib/uuid';
import type { ParsedResume, Resume } from '@db/schema';
import { cacheLocalFile, ensureLocalCopy, removeLocalCopy } from './resumeCache';
import { getResume, insertResume, recordParseResult, softDeleteResume } from './resumeQueries';
import { pushResume } from './resumeSync';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Mirrors the bucket's server-side limit — the client check is a courtesy, not the boundary. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const BUCKET = 'resumes';

const EXTENSION: Record<string, string> = { [PDF_MIME]: 'pdf', [DOCX_MIME]: 'docx' };

const PARSE_SYSTEM = `You extract structured data from resumes.

Return only a single JSON object with this shape, and no prose, no markdown
fences and no commentary:

{
  "skills": [string],
  "primary_skills": [string],
  "roles": [string],
  "target_roles": [string],
  "total_experience_months": integer|null,
  "seniority": "entry" | "mid" | "senior" | "lead" | null,
  "experience": [{ "title": string, "company": string|null, "months": integer|null }],
  "projects": [{ "name": string, "summary": string|null, "tech": [string] }],
  "education": [{ "degree": string, "institution": string|null, "year": integer|null }],
  "current_location": string|null,
  "preferred_locations": [string],
  "notice_period_days": integer|null,
  "open_to_relocate": boolean|null
}

Report only what the document states. Do not infer a skill from a job title, do
not estimate durations that are not given, and use null when the resume does not
supply a value — an absent value is more useful than a guessed one.

"total_experience_months" comes from an explicitly stated total if the resume
gives one, otherwise from summing role durations, otherwise null. Never estimate
it from graduation year.

"primary_skills" is at most eight skills the resume itself emphasises — through a
summary line, a skills section ordering, or repetition across roles. If the
resume gives no signal about emphasis, return the same list as "skills" truncated
to eight rather than ranking them yourself.

"target_roles" comes only from an explicit objective, summary or headline. If the
resume states no target, return an empty array — do not infer one from history.

"seniority" is drawn from stated titles, not from years. A resume with a "Senior"
title is senior even at three years; a resume with no levelled title is null.

List skills as the resume names them; do not expand abbreviations or normalise
spellings. Return both forms when a resume uses both.`;

type PickedFile = { uri: string; name: string; size: number; mimeType: string };

export type UploadResult =
  | { status: 'cancelled' }
  | { status: 'rejected'; message: string }
  | { status: 'uploaded'; resume: Resume; parse: ParseResult };

export type ParseResult =
  | { status: 'parsed'; parsedJson: ParsedResume }
  | { status: 'failed'; message: string };

/** Files carry a MIME type on iOS but not always on Android — fall back to the extension. */
function resolveMimeType(asset: DocumentPicker.DocumentPickerAsset): string | null {
  if (asset.mimeType === PDF_MIME || asset.mimeType === DOCX_MIME) return asset.mimeType;
  const name = asset.name.toLowerCase();
  if (name.endsWith('.pdf')) return PDF_MIME;
  if (name.endsWith('.docx')) return DOCX_MIME;
  return null;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Resume';
}

async function pickFile(): Promise<PickedFile | null | { rejected: string }> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [PDF_MIME, DOCX_MIME],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) return null;

  const mimeType = resolveMimeType(asset);
  if (!mimeType) return { rejected: 'Only PDF and Word (.docx) resumes are supported.' };

  const size = asset.size ?? new File(asset.uri).size;
  if (size > MAX_FILE_BYTES) {
    return { rejected: 'That file is larger than 10 MB. Please upload a smaller resume.' };
  }

  return { uri: asset.uri, name: asset.name, size, mimeType };
}

/**
 * Picks, uploads and parses a resume.
 *
 * Uploading requires connectivity and fails loudly rather than queueing (FR-9.3):
 * a queued upload would leave a resume row pointing at a file that does not
 * exist, and a search could then be run against it.
 *
 * Order matters — the file lands in Storage first, then the row locally, then
 * the row on the server, and only then does parsing run. `parse-resume` reads
 * the row and the file server-side, so both have to exist before it is called.
 */
export async function uploadResume(userId: string): Promise<UploadResult> {
  const picked = await pickFile();
  if (picked === null) return { status: 'cancelled' };
  if ('rejected' in picked) return { status: 'rejected', message: picked.rejected };

  const resumeId = newId();
  const storagePath = `${userId}/${resumeId}.${EXTENSION[picked.mimeType]}`;

  // An ArrayBuffer, not a Blob or typed array: storage-js documents that Blob,
  // File and FormData bodies do not upload correctly under React Native.
  let body: ArrayBuffer;
  try {
    body = await new File(picked.uri).arrayBuffer();
  } catch {
    return { status: 'rejected', message: 'That file could not be read from your device.' };
  }

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType: picked.mimeType, upsert: false });

  if (upload.error) {
    return {
      status: 'rejected',
      message: 'Upload failed. Resumes need a connection — check yours and try again.',
    };
  }

  const resume = await insertResume({
    id: resumeId,
    userId,
    displayName: stripExtension(picked.name),
    storagePath,
    fileSize: picked.size,
    mimeType: picked.mimeType,
  });

  await cacheLocalFile(resume, picked.uri);

  // Parsing reads the local copy, so a failed push no longer blocks it — the
  // row syncs later and the resume is usable now.
  await pushResume(resume);

  return { status: 'uploaded', resume, parse: await parseResume(resume.id) };
}

/**
 * Runs model extraction for one resume (FR-3). Explicit only — never on a list
 * render — because each call costs the user a model request against their own
 * Bedrock account.
 *
 * A failure is recorded on the row and surfaced, but the raw file stays usable.
 */
export async function parseResume(resumeId: string): Promise<ParseResult> {
  const fail = async (message: string): Promise<ParseResult> => {
    await recordParseResult(resumeId, { parseError: message });
    return { status: 'failed', message };
  };

  const credentials = await getCredentials();
  if (!credentials) {
    return fail('Add your Bedrock API key in Settings to read resumes.');
  }

  const resume = await getResume(resumeId);
  if (!resume) return fail('That resume no longer exists.');

  const isPdf = resume.mimeType === PDF_MIME || resume.storagePath.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    // The Claude document block takes PDF only. Unzipping DOCX on-device would
    // mean shipping a zip library for a format the user can re-export in a click.
    return fail('Only PDF resumes can be read. Re-upload this one as a PDF.');
  }

  const localUri = await ensureLocalCopy(resume);
  if (!localUri) {
    return fail('The file could not be downloaded. Check your connection and try again.');
  }

  let base64: string;
  try {
    base64 = await new File(localUri).base64();
  } catch {
    return fail('That file could not be read from your device.');
  }

  try {
    const { raw } = await completeWithPdf(
      credentials,
      await getModelForStage('parse'),
      PARSE_SYSTEM,
      'Extract this resume.',
      base64,
    );
    const parsed = validateParsedResume(extractJson(raw));
    if (!parsed) {
      return fail('This resume could not be read as structured data.');
    }
    await recordParseResult(resumeId, { parsedJson: parsed });
    return { status: 'parsed', parsedJson: parsed };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : 'This resume could not be read.',
    );
  }
}

/**
 * Soft-deletes a resume and drops its cached file.
 *
 * The Storage object is deliberately left in place: cached scores reference the
 * resume id and a soft delete is reversible server-side, so destroying the file
 * would turn an undo into data loss.
 */
export async function deleteResume(userId: string, resumeId: string): Promise<void> {
  const resume = await getResume(resumeId);
  if (resume) await removeLocalCopy(resume);
  await softDeleteResume(userId, resumeId);
}
