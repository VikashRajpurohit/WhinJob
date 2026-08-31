import { and, desc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@db/client';
import { resumes, type NewResume, type ParsedResume, type Resume } from '@db/schema';
import { newId } from '@/lib/uuid';
import { now } from '@/lib/time';

const notDeleted = (userId: string) =>
  and(eq(resumes.userId, userId), isNull(resumes.deletedAt));

export function useResumes(userId: string | undefined) {
  const { data, error } = useLiveQuery(
    db
      .select()
      .from(resumes)
      .where(notDeleted(userId ?? ''))
      .orderBy(desc(resumes.isDefault), desc(resumes.createdAt)),
  );
  return { resumes: data ?? [], error };
}

export async function listResumes(userId: string): Promise<Resume[]> {
  return db
    .select()
    .from(resumes)
    .where(notDeleted(userId))
    .orderBy(desc(resumes.isDefault), desc(resumes.createdAt));
}

/** Pre-selected for every search; a search cannot run without a resume (FR-3). */
export async function getDefaultResume(userId: string): Promise<Resume | null> {
  const rows = await db
    .select()
    .from(resumes)
    .where(and(notDeleted(userId), eq(resumes.isDefault, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getResume(resumeId: string): Promise<Resume | null> {
  const rows = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1);
  return rows[0] ?? null;
}

/** Includes soft-deleted rows — the sync layer has to see a delete to replay it. */
export async function listResumesForSync(userId: string): Promise<Resume[]> {
  return db.select().from(resumes).where(eq(resumes.userId, userId));
}

type ResumeInput = Omit<NewResume, 'createdAt' | 'updatedAt' | 'isDefault'> & { id?: string };

/**
 * The first resume a user uploads becomes their default automatically (FR-3).
 *
 * `id` is accepted rather than always minted here because the upload path needs
 * it before the row exists — the storage path is keyed on it.
 */
export async function insertResume(input: ResumeInput): Promise<Resume> {
  const ts = now();
  const existing = await listResumes(input.userId);
  const row: NewResume = {
    ...input,
    id: input.id ?? newId(),
    isDefault: existing.length === 0,
    createdAt: ts,
    updatedAt: ts,
  };
  const [inserted] = await db.insert(resumes).values(row).returning();
  return inserted!;
}

/**
 * Exactly one default per user. Both statements run in one transaction so the
 * unique partial index never sees two defaults mid-flight.
 */
export async function setDefaultResume(userId: string, resumeId: string) {
  const ts = now();
  await db.transaction(async (tx) => {
    await tx
      .update(resumes)
      .set({ isDefault: false, updatedAt: ts, syncedAt: null })
      .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true)));
    await tx
      .update(resumes)
      .set({ isDefault: true, updatedAt: ts, syncedAt: null })
      .where(eq(resumes.id, resumeId));
  });
}

export async function renameResume(resumeId: string, displayName: string) {
  await db
    .update(resumes)
    .set({ displayName, updatedAt: now(), syncedAt: null })
    .where(eq(resumes.id, resumeId));
}

/** Soft delete — cached scores reference the resume and must stay resolvable. */
export async function softDeleteResume(userId: string, resumeId: string) {
  const ts = now();
  await db.transaction(async (tx) => {
    await tx
      .update(resumes)
      .set({ deletedAt: ts, isDefault: false, updatedAt: ts, syncedAt: null })
      .where(eq(resumes.id, resumeId));

    const remaining = await tx
      .select()
      .from(resumes)
      .where(notDeleted(userId))
      .orderBy(desc(resumes.createdAt))
      .limit(1);

    const promoted = remaining[0];
    if (promoted) {
      await tx
        .update(resumes)
        .set({ isDefault: true, updatedAt: ts, syncedAt: null })
        .where(eq(resumes.id, promoted.id));
    }
  });
}

/** A parse failure is recorded but never blocks use of the raw file (FR-3). */
export async function recordParseResult(
  resumeId: string,
  result: { parsedJson: ParsedResume } | { parseError: string },
) {
  const ts = now();
  const set =
    'parsedJson' in result
      ? { parsedJson: result.parsedJson, parsedAt: ts, parseError: null }
      : { parseError: result.parseError, parsedAt: null };
  await db.update(resumes).set({ ...set, updatedAt: ts }).where(eq(resumes.id, resumeId));
}

/**
 * The cached file path is device-local and never syncs, so it deliberately does
 * not bump `updatedAt` — caching a file is not an edit to the resume.
 */
export async function setLocalUri(resumeId: string, localUri: string | null) {
  await db.update(resumes).set({ localUri }).where(eq(resumes.id, resumeId));
}

/**
 * Records that the server has this row. Like `markProfileSynced`, it leaves
 * `updatedAt` alone — bumping it would make the local row look newer than the
 * server's forever.
 */
export async function markResumeSynced(resumeId: string, at: number = now()) {
  await db.update(resumes).set({ syncedAt: at }).where(eq(resumes.id, resumeId));
}

/** Applies a server row locally. `localUri` is preserved: the cached file is still there. */
export async function upsertRemoteResume(
  row: Omit<NewResume, 'localUri' | 'syncedAt'>,
): Promise<void> {
  const syncedAt = now();
  await db
    .insert(resumes)
    .values({ ...row, syncedAt })
    .onConflictDoUpdate({ target: resumes.id, set: { ...row, syncedAt } });
}
