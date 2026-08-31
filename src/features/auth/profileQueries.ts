import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@db/client';
import { profiles, type NewProfile, type Profile } from '@db/schema';
import { now } from '@/lib/time';

/** Reads never hit the network (hard rule 3); the sync engine refreshes underneath. */
export function useProfile(userId: string | undefined) {
  const { data, error, updatedAt } = useLiveQuery(
    db.select().from(profiles).where(eq(profiles.userId, userId ?? '')),
  );
  return { profile: data?.[0] ?? null, error, updatedAt };
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

type ProfileFields = Omit<NewProfile, 'userId' | 'createdAt' | 'updatedAt'>;

/**
 * Writes land locally first and are picked up by the mutation queue (FR-9.2).
 * `syncedAt` resets to null on every local edit and is set explicitly only by
 * the sync path, which is the one caller that knows the server has the value.
 */
export async function upsertProfile(userId: string, fields: Partial<ProfileFields>) {
  const ts = now();
  const syncedAt = fields.syncedAt ?? null;
  await db
    .insert(profiles)
    .values({ userId, createdAt: ts, updatedAt: ts, ...fields, syncedAt })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { ...fields, updatedAt: ts, syncedAt },
    });
}

/**
 * Records that the server has this row. Deliberately does not touch `updatedAt` —
 * bumping it would make the local copy look newer than the server's on the next
 * hydrate and push the same row forever.
 */
export async function markProfileSynced(userId: string, at: number = now()) {
  await db.update(profiles).set({ syncedAt: at }).where(eq(profiles.userId, userId));
}

/**
 * "Anywhere / Remote" is open-to-remote with no location constraint — distinct
 * from an empty preference list (FR-2).
 */
export function isAnywhereRemote(profile: Pick<Profile, 'openToRemote' | 'preferredLocations'>) {
  return profile.openToRemote && profile.preferredLocations.length === 0;
}

/** Clears every local row on sign-out so a second account never sees the first's data. */
export async function clearProfile(userId: string) {
  await db.delete(profiles).where(eq(profiles.userId, userId));
}
