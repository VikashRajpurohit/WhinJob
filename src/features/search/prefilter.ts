import type { ParsedResume, SearchFilters } from '@db/schema';
import type { NormalizedJob } from './adapters';

/**
 * Two free gates before any Bedrock spend (§8.2). Fan-out multiplies rows ~6×;
 * scoring all of them is unaffordable. Gate 1 drops rows that can never be a
 * fit; Gate 2 defers rows the resume barely touches — deferred jobs stay
 * visible and tappable, so recall is unaffected.
 */

/** Three, not one: a 5–10y posting is a real stretch for a 3y11m candidate. */
const EXPERIENCE_OVERSHOOT_YEARS = 3;

/** Below this after HTML stripping, nothing useful can be scored. */
const MIN_DESCRIPTION_CHARS = 200;

/** Fewer top-resume skills in the description than this → defer, don't drop. */
const MIN_SKILL_MATCHES = 2;

const DEFAULT_DISQUALIFIERS = ['intern', 'internship', 'fresher', 'walk-in', 'walkin', 'trainee'];

export type PrefilterResult = {
  toScore: NormalizedJob[];
  deferred: NormalizedJob[];
  dropped: number;
};

export function prefilter(
  jobs: NormalizedJob[],
  args: {
    resume: ParsedResume | null;
    filters: SearchFilters;
    extraDisqualifiers?: string[];
  },
): PrefilterResult {
  const candidateYears =
    args.resume?.total_experience_months != null
      ? args.resume.total_experience_months / 12
      : null;

  // The user opting into internships disables the level disqualifiers.
  const wantsEntryRoles = args.filters.employment_type === 'internship';
  const disqualifiers = wantsEntryRoles
    ? []
    : [...DEFAULT_DISQUALIFIERS, ...(args.extraDisqualifiers ?? []).map((d) => d.toLowerCase())];

  const topSkills = (args.resume?.primary_skills?.length
    ? args.resume.primary_skills
    : (args.resume?.skills ?? [])
  )
    .slice(0, 20)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 1);

  const toScore: NormalizedJob[] = [];
  const deferred: NormalizedJob[] = [];
  let dropped = 0;

  for (const job of jobs) {
    // Gate 1 — hard exclusions, no model call.
    if (job.descriptionFull.length < MIN_DESCRIPTION_CHARS) {
      dropped++;
      continue;
    }
    if (
      candidateYears != null &&
      job.experienceMinYears != null &&
      job.experienceMinYears - candidateYears > EXPERIENCE_OVERSHOOT_YEARS
    ) {
      dropped++;
      continue;
    }
    const titleLower = job.title.toLowerCase();
    if (disqualifiers.some((d) => d && titleLower.includes(d))) {
      dropped++;
      continue;
    }

    // Gate 2 — lexical coverage. With no parsed resume there is nothing to
    // gate on, so everything passes to scoring's own credential check.
    if (topSkills.length > 0) {
      const haystack = `${titleLower}\n${job.descriptionFull.toLowerCase()}`;
      const hits = topSkills.filter((skill) => haystack.includes(skill)).length;
      if (hits < MIN_SKILL_MATCHES) {
        deferred.push(job);
        continue;
      }
    }

    toScore.push(job);
  }

  return { toScore, deferred, dropped };
}
