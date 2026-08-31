import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import type { Resume } from '@db/schema';
import { setLocalUri } from './resumeQueries';

/**
 * Local copies of resume files, so a resume is readable offline after its first
 * fetch (FR-3).
 *
 * These live in the app's document directory rather than the cache directory:
 * the OS may evict the cache directory under storage pressure, which would
 * silently break offline access. §8 asks for encrypted storage — the document
 * directory is inside the app sandbox, which the platform encrypts at rest
 * (iOS Data Protection; Android full-disk encryption). We are not hand-rolling
 * a second encryption layer on top of that.
 */
const DIRECTORY = 'resumes';

/** Signed URLs are short-lived by design — the bucket is private (§8). */
const SIGNED_URL_TTL_SECONDS = 60;

function resumeDirectory(): Directory {
  const dir = new Directory(Paths.document, DIRECTORY);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function extensionOf(storagePath: string): string {
  const match = /\.[a-z0-9]+$/i.exec(storagePath);
  return match ? match[0] : '';
}

function cachedFile(resume: Pick<Resume, 'id' | 'storagePath'>): File {
  return new File(resumeDirectory(), `${resume.id}${extensionOf(resume.storagePath)}`);
}

/** Cached, and the file is actually still on disk. */
export function isCached(resume: Pick<Resume, 'id' | 'storagePath' | 'localUri'>): boolean {
  return resume.localUri != null && cachedFile(resume).exists;
}

/**
 * Returns a local file URI, downloading it once if needed. Returns null when the
 * file is not cached and cannot be fetched — the caller reports that rather than
 * pretending the resume is unavailable, since the row itself is still usable.
 */
export async function ensureLocalCopy(
  resume: Pick<Resume, 'id' | 'storagePath' | 'localUri'>,
): Promise<string | null> {
  const destination = cachedFile(resume);

  if (destination.exists) {
    if (resume.localUri !== destination.uri) await setLocalUri(resume.id, destination.uri);
    return destination.uri;
  }

  const { data, error } = await supabase.storage
    .from('resumes')
    .createSignedUrl(resume.storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) return null;

  try {
    const file = await File.downloadFileAsync(data.signedUrl, destination, { idempotent: true });
    await setLocalUri(resume.id, file.uri);
    return file.uri;
  } catch {
    return null;
  }
}

/** Copies a file already on the device — the upload path has one, so skip the round trip. */
export async function cacheLocalFile(
  resume: Pick<Resume, 'id' | 'storagePath'>,
  sourceUri: string,
): Promise<void> {
  const destination = cachedFile(resume);
  try {
    if (destination.exists) destination.delete();
    await new File(sourceUri).copy(destination);
    await setLocalUri(resume.id, destination.uri);
  } catch {
    // A failed cache write is not a failed upload — the file downloads on demand.
  }
}

export async function removeLocalCopy(
  resume: Pick<Resume, 'id' | 'storagePath'>,
): Promise<void> {
  const file = cachedFile(resume);
  if (file.exists) file.delete();
  await setLocalUri(resume.id, null);
}

/**
 * Wipes every cached resume file. Called on sign-out alongside the local row
 * reset — leaving the files behind would hand the next account on this device
 * the previous user's resumes.
 */
export function clearResumeCache(): void {
  const dir = new Directory(Paths.document, DIRECTORY);
  if (dir.exists) dir.delete();
}
