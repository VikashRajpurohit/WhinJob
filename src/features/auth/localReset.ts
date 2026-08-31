import { db } from '@db/client';
import { clearResumeCache } from '@/features/resume/resumeCache';
import { clearSettings } from '@/features/settings/settingsStore';
import {
  applications,
  jobScores,
  jobs,
  profiles,
  resumes,
  searchHistoryJobs,
  searches,
} from '@db/schema';

/**
 * Wipes every local row on sign-out. The device cache is scoped to one account;
 * leaving rows behind would let a second account read the first one's jobs,
 * resumes and applications straight out of SQLite, bypassing RLS entirely.
 *
 * Ordered child-first so foreign keys stay satisfied (PRAGMA foreign_keys = ON).
 */
export async function clearLocalData(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(searchHistoryJobs);
    await tx.delete(jobScores);
    await tx.delete(applications);
    await tx.delete(jobs);
    await tx.delete(searches);
    await tx.delete(resumes);
    await tx.delete(profiles);
  });

  // Rows alone are not enough — the downloaded resume files sit outside SQLite,
  // and leaving them would hand the next account the previous user's documents.
  clearResumeCache();

  // Credentials are per-person and billed per-person. A second account on this
  // device must not inherit the first one's Bedrock key and spend their money.
  await clearSettings();
}
