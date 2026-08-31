import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '@db/schema';
import { getProfile, upsertProfile } from './profileQueries';
import { pushProfile } from './profileSync';

export type ProfileFormValues = {
  fullName: string;
  phone: string;
  totalExperienceMonths: string;
  noticePeriodDays: string;
  preferredLocations: string;
  openToRemote: boolean;
  preferredRoles: string;
  currentCtc: string;
  expectedCtc: string;
};

const EMPTY: ProfileFormValues = {
  fullName: '',
  phone: '',
  totalExperienceMonths: '',
  noticePeriodDays: '',
  preferredLocations: '',
  openToRemote: false,
  preferredRoles: '',
  currentCtc: '',
  expectedCtc: '',
};

const toList = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Blank stays null rather than becoming 0 — undisclosed is its own state (hard rule 7). */
const toNumber = (v: string): number | null => {
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

function toValues(profile: Profile | null): ProfileFormValues {
  if (!profile) return EMPTY;
  return {
    fullName: profile.fullName ?? '',
    phone: profile.phone ?? '',
    totalExperienceMonths: profile.totalExperienceMonths?.toString() ?? '',
    noticePeriodDays: profile.noticePeriodDays?.toString() ?? '',
    preferredLocations: profile.preferredLocations.join(', '),
    openToRemote: profile.openToRemote,
    preferredRoles: profile.preferredRoles.join(', '),
    currentCtc: profile.currentCtc?.toString() ?? '',
    expectedCtc: profile.expectedCtc?.toString() ?? '',
  };
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline';

export function useProfileForm(userId: string | null) {
  const [values, setValues] = useState<ProfileFormValues>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    let active = true;
    void (async () => {
      const profile = userId ? await getProfile(userId) : null;
      if (!active) return;
      setValues(toValues(profile));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const setField = useCallback(<K extends keyof ProfileFormValues>(
    key: K,
    value: ProfileFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaveState('idle');
  }, []);

  /**
   * Saves locally first so the edit survives with no connectivity (FR-9.2),
   * then attempts the push. A failed push is reported as offline, not an error —
   * `syncedAt` stays null and the sync engine retries.
   */
  const save = useCallback(async () => {
    if (!userId) return;
    setSaveState('saving');

    await upsertProfile(userId, {
      fullName: values.fullName.trim() || null,
      phone: values.phone.trim() || null,
      totalExperienceMonths: toNumber(values.totalExperienceMonths),
      noticePeriodDays: toNumber(values.noticePeriodDays),
      preferredLocations: toList(values.preferredLocations),
      openToRemote: values.openToRemote,
      preferredRoles: toList(values.preferredRoles),
      currentCtc: toNumber(values.currentCtc),
      expectedCtc: toNumber(values.expectedCtc),
    });

    const saved = await getProfile(userId);
    const pushed = saved ? await pushProfile(saved) : false;
    setSaveState(pushed ? 'saved' : 'offline');
  }, [userId, values]);

  return { values, setField, loading, saveState, save };
}
