import { supabase } from '@/lib/supabase';
import type { ParsedResume, Resume } from '@db/schema';
import {
  getResume,
  listResumesForSync,
  markResumeSynced,
  upsertRemoteResume,
} from './resumeQueries';

/** Postgres row shape for `resumes`, as PostgREST returns it. */
type RemoteResume = {
  id: string;
  user_id: string;
  display_name: string;
  storage_path: string;
  is_default: boolean;
  parsed_json: ParsedResume | null;
  parsed_at: string | null;
  parse_error: string | null;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const ms = (iso: string | null) => (iso == null ? null : Date.parse(iso));
const iso = (epoch: number | null) => (epoch == null ? null : new Date(epoch).toISOString());

/**
 * Pulls the server's resumes into SQLite once per sign-in. Reads still resolve
 * from SQLite afterwards (hard rule 3).
 *
 * Soft-deleted rows are pulled too — skipping them would leave a resume the user
 * deleted on another device visible here forever.
 *
 * Like `hydrateProfile`, this is the single-device approximation of last-write-
 * wins; the real conflict resolution arrives with the sync engine in Phase 8.
 */
export async function hydrateResumes(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('resumes')
    .select('*')
    .eq('user_id', userId)
    .returns<RemoteResume[]>();

  // Offline is the expected case, not an error — local rows already serve reads.
  if (error || !data) return;

  const remoteIds = new Set<string>();
  const newerLocally: Resume[] = [];

  for (const row of data) {
    remoteIds.add(row.id);
    const local = await getResume(row.id);

    if (local && local.updatedAt > Date.parse(row.updated_at)) {
      newerLocally.push(local);
      continue;
    }

    await upsertRemoteResume({
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      storagePath: row.storage_path,
      isDefault: row.is_default,
      parsedJson: row.parsed_json,
      parsedAt: ms(row.parsed_at),
      parseError: row.parse_error,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
      deletedAt: ms(row.deleted_at),
    });
  }

  // Rows the server has never seen: created here while offline, or a push that
  // failed. Everything local is either on the server or on its way there.
  const local = await listResumesForSync(userId);
  const unsent = local.filter((row) => !remoteIds.has(row.id));

  for (const row of defaultLast([...newerLocally, ...unsent])) {
    await pushResume(row);
  }
}

/** Best-effort push. A failure leaves `syncedAt` null for the sync engine to retry. */
export async function pushResume(resume: Resume): Promise<boolean> {
  const { error } = await supabase.from('resumes').upsert(
    {
      id: resume.id,
      user_id: resume.userId,
      display_name: resume.displayName,
      storage_path: resume.storagePath,
      is_default: resume.isDefault,
      parsed_json: resume.parsedJson,
      parsed_at: iso(resume.parsedAt),
      parse_error: resume.parseError,
      file_size: resume.fileSize,
      mime_type: resume.mimeType,
      deleted_at: iso(resume.deletedAt),
    },
    { onConflict: 'id' },
  );

  if (error) return false;
  await markResumeSynced(resume.id);
  return true;
}

/**
 * Postgres enforces one default per user with a partial unique index, so the row
 * losing the default has to land before the row gaining it. Pushing in row order
 * would hit the constraint roughly half the time.
 */
function defaultLast(rows: Resume[]): Resume[] {
  return [...rows].sort((a, b) => Number(a.isDefault) - Number(b.isDefault));
}

/**
 * Pushes every unsynced resume for a user. Called after a local change that
 * touched more than one row — setting a default clears the previous one, so
 * pushing only the new default would leave two defaults on the server.
 */
export async function pushPendingResumes(userId: string): Promise<void> {
  const rows = await listResumesForSync(userId);
  for (const row of defaultLast(rows)) {
    if (row.syncedAt == null) await pushResume(row);
  }
}
