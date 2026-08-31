/**
 * parse-resume — extracts `parsed_json` from an uploaded resume (FR-3).
 *
 * Runs once per resume, on upload or explicit re-parse. Nothing here is
 * automatic or retried: parsing costs the user a model call, and the result is
 * reused across every scoring run rather than re-derived.
 *
 * Credentials and the model id arrive **in the request body**, supplied by the
 * user from their own device. This function holds no secrets of its own, keeps
 * nothing after the response, and never logs a request body — that last point is
 * the only thing standing between a user's Bedrock key and Supabase's log
 * retention, so keep it that way.
 *
 * A parse failure is a recorded outcome, not an error: it returns 200 with
 * `ok: false`, because the raw file is still usable for a search (FR-3).
 */
import { docxToText } from '../_shared/docx.ts';
import { HttpError, json, preflight, userClient } from '../_shared/http.ts';
import { parsedResumeSchema, validateParsedResume } from '../_shared/parsedResume.ts';
import { extractResume, parseCredentials, type SourceDocument } from '../_shared/providers.ts';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BUCKET = 'resumes';

const SYSTEM = `You extract structured data from resumes.

Return only a single JSON object matching this schema, with no prose, no
markdown fences, and no commentary:

${JSON.stringify(parsedResumeSchema)}

Report only what the document states. Do not infer a skill from a job title, do
not estimate durations that are not given, and use null when the resume does not
supply a value — an absent value is more useful than a guessed one.

"months" is the total duration of a role in months, and only when the resume
gives enough date information to compute it. List skills as the resume names
them; do not expand abbreviations or normalise spellings.`;

type ResumeRow = { id: string; storage_path: string; mime_type: string | null };

function mimeTypeFor(row: ResumeRow): string {
  if (row.mime_type === PDF || row.mime_type === DOCX) return row.mime_type;
  const path = row.storage_path.toLowerCase();
  if (path.endsWith('.pdf')) return PDF;
  if (path.endsWith('.docx')) return DOCX;
  throw new HttpError(400, 'Only PDF and DOCX resumes can be parsed.');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // Chunked so a large file cannot blow the call stack.
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Models wrap JSON in prose or fences often enough to be worth handling. */
function readJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(candidate.slice(start, end + 1));
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  let supabase: ReturnType<typeof userClient> | null = null;
  let resumeId: string | null = null;

  try {
    supabase = userClient(req);

    const body = await req.json().catch(() => ({}));
    resumeId = typeof body?.resume_id === 'string' ? body.resume_id : null;
    const modelId = typeof body?.model === 'string' ? body.model : null;

    if (!resumeId) throw new HttpError(400, 'resume_id is required.');
    if (!modelId) throw new HttpError(400, 'model is required.');

    let credentials;
    try {
      credentials = parseCredentials(body);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Invalid credentials.');
    }

    // RLS scopes this to the caller's own rows, and the storage path comes from
    // the row rather than the request — a client cannot point this function at a
    // file it does not own.
    const { data: resume, error } = await supabase
      .from('resumes')
      .select('id, storage_path, mime_type')
      .eq('id', resumeId)
      .is('deleted_at', null)
      .maybeSingle<ResumeRow>();

    if (error) throw new HttpError(500, error.message);
    if (!resume) throw new HttpError(404, 'Resume not found.');

    const mimeType = mimeTypeFor(resume);

    const download = await supabase.storage.from(BUCKET).download(resume.storage_path);
    if (download.error || !download.data) {
      throw new HttpError(404, 'Resume file is missing from storage.');
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    const document: SourceDocument =
      mimeType === PDF
        ? { kind: 'pdf', base64: toBase64(bytes), filename: 'resume.pdf' }
        : { kind: 'text', text: await docxToText(bytes) };

    const extraction = await extractResume(credentials, modelId, SYSTEM, document);

    if (!extraction.ok) {
      await recordFailure(supabase, resume.id, extraction.reason);
      return json({ ok: false, parse_error: extraction.reason });
    }

    let parsed = null;
    try {
      parsed = validateParsedResume(readJson(extraction.raw));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      const reason = 'The resume could not be read as structured data.';
      await recordFailure(supabase, resume.id, reason);
      return json({ ok: false, parse_error: reason });
    }

    const { error: writeError } = await supabase
      .from('resumes')
      .update({ parsed_json: parsed, parsed_at: new Date().toISOString(), parse_error: null })
      .eq('id', resume.id);

    if (writeError) throw new HttpError(500, writeError.message);

    return json({ ok: true, parsed_json: parsed });
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ ok: false, error: err.message }, err.status);
    }

    // Anything else — a provider outage, a malformed DOCX, a decode failure — is
    // still just this one resume failing to parse.
    const reason = err instanceof Error ? err.message : 'Resume parsing failed.';
    if (supabase && resumeId) await recordFailure(supabase, resumeId, reason);
    return json({ ok: false, parse_error: reason });
  }
});

async function recordFailure(
  supabase: ReturnType<typeof userClient>,
  resumeId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('resumes')
    .update({ parse_error: reason, parsed_at: null })
    .eq('id', resumeId);
}
