import { supabase } from '@/lib/supabase';
import { now } from '@/lib/time';
import type { Profile } from '@db/schema';
import { getProfile, markProfileSynced, upsertProfile } from './profileQueries';

/** Postgres row shape for `profiles`, as PostgREST returns it. */
type RemoteProfile = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  total_experience_months: number | null;
  notice_period_days: number | null;
  preferred_locations: string[];
  open_to_remote: boolean;
  preferred_roles: string[];
  current_ctc: number | string | null;
  expected_ctc: number | string | null;
  created_at: string;
  updated_at: string;
};

const num = (v: number | string | null) => (v == null ? null : Number(v));

/**
 * Hydrates SQLite from the server once per sign-in. Reads still resolve from
 * SQLite afterwards (hard rule 3); this only refreshes what they read.
 *
 * Full last-write-wins conflict resolution arrives with the sync engine in
 * Phase 8 (FR-9.5). Until then the newer `updated_at` wins wholesale, which is
 * correct for a single-device user and never silently drops a local edit.
 */
export async function hydrateProfile(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<RemoteProfile>();

  // Offline is the expected case, not an error — the local row already serves reads.
  if (error || !data) return;

  const local = await getProfile(userId);
  const remoteUpdatedAt = Date.parse(data.updated_at);

  if (local && local.updatedAt > remoteUpdatedAt) {
    await pushProfile(local);
    return;
  }

  await upsertProfile(userId, {
    fullName: data.full_name,
    email: data.email,
    phone: data.phone,
    totalExperienceMonths: data.total_experience_months,
    noticePeriodDays: data.notice_period_days,
    preferredLocations: data.preferred_locations ?? [],
    openToRemote: data.open_to_remote,
    preferredRoles: data.preferred_roles ?? [],
    currentCtc: num(data.current_ctc),
    expectedCtc: num(data.expected_ctc),
    syncedAt: now(),
  });
}

/** Best-effort push. A failure leaves `syncedAt` null for the sync engine to retry. */
export async function pushProfile(profile: Profile): Promise<boolean> {
  const { error } = await supabase.from('profiles').upsert(
    {
      user_id: profile.userId,
      full_name: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      total_experience_months: profile.totalExperienceMonths,
      notice_period_days: profile.noticePeriodDays,
      preferred_locations: profile.preferredLocations,
      open_to_remote: profile.openToRemote,
      preferred_roles: profile.preferredRoles,
      current_ctc: profile.currentCtc,
      expected_ctc: profile.expectedCtc,
    },
    { onConflict: 'user_id' },
  );

  if (error) return false;
  await markProfileSynced(profile.userId);
  return true;
}
