import { and, eq } from 'drizzle-orm';
import { db } from '@db/client';
import {
  jobs,
  type CredibilityFlag,
  type EmploymentType,
  type Job,
  type JobSource,
  type SalaryPeriod,
  type WorkMode,
} from '@db/schema';
import type { NormalizedJob } from '@/features/search/adapters';
import { normalizeLocation } from '@/features/search/locationAliases';
import { newId } from '@/lib/uuid';
import { now } from '@/lib/time';

/** Fan-out makes the same requisition arrive under several titles — see §6. */
const MARKETING_PREFIXES = /^(hiring for|urgent(ly)? (hiring|required)?|walk[\s-]?in|immediate (joiner|opening)s?|job opening[s]?( for)?)\s*[:|-]?\s*/i;

/** Closed compounds that boards write both ways; folding them collapses dupes. */
const COMPOUNDS: [RegExp, string][] = [
  [/\breactnative\b/g, 'react native'],
  [/\breact-native\b/g, 'react native'],
  [/\bnodejs\b/g, 'node js'],
  [/\bnode-js\b/g, 'node js'],
  [/\breactjs\b/g, 'react js'],
  [/\bnextjs\b/g, 'next js'],
  [/\bfull-?stack\b/g, 'full stack'],
  [/\bfront-?end\b/g, 'front end'],
  [/\bback-?end\b/g, 'back end'],
];

/** Trailing level tokens ("SE III", "L2") make one requisition into many rows. */
const TRAILING_LEVEL = /\s+(i{1,3}|iv|v|l[1-5]|sde[\s-]?(i{1,3}|iv|1|2|3)?|\d)$/;

function normalizeTitle(title: string): string {
  let value = title
    .replace(MARKETING_PREFIXES, ' ')
    .replace(/\[[^\]]*\]/g, ' ') // requisition ids: [T500-28321]
    .replace(/\([^)]*\)/g, ' ') // (R0001807), -INF(5-8)YRS
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [pattern, replacement] of COMPOUNDS) {
    value = value.replace(pattern, replacement);
  }
  // Strip at most two trailing level tokens ("engineer iii 2").
  value = value.replace(TRAILING_LEVEL, '').replace(TRAILING_LEVEL, '').trim();
  return value.replace(/\s+/g, '-');
}

/**
 * Two postings are the same job when title, company and location agree after
 * normalisation. Deliberately not hashed — a readable key makes a bad collapse
 * obvious in the database instead of invisible (FR-5.1). Location goes through
 * the alias table, never the raw string (§3.3).
 */
export function makeDedupeKey(input: {
  title: string;
  companyName: string | null;
  location: string | null;
}): string {
  const normCompany = (input.companyName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return [
    normalizeTitle(input.title),
    normCompany,
    normalizeLocation(input.location).replace(/\s+/g, '-'),
  ].join('|');
}

/** Lower index wins. Sources absent from a list never overwrite a present one. */
function preferBySource<T>(
  order: JobSource[],
  existing: { source: JobSource; value: T | null },
  incoming: { source: JobSource; value: T | null },
): T | null {
  if (incoming.value == null) return existing.value;
  if (existing.value == null) return incoming.value;
  const rank = (s: JobSource) => {
    const idx = order.indexOf(s);
    return idx === -1 ? order.length : idx;
  };
  return rank(incoming.source) < rank(existing.source) ? incoming.value : existing.value;
}

const SALARY_PRIORITY: JobSource[] = ['naukri', 'glassdoor', 'indeed', 'linkedin', 'foundit'];
const APPLY_URL_PRIORITY: JobSource[] = ['indeed', 'glassdoor', 'linkedin', 'naukri', 'foundit'];
const CAREERS_URL_PRIORITY: JobSource[] = ['glassdoor', 'indeed'];
const RATING_PRIORITY: JobSource[] = ['glassdoor', 'naukri'];

const AGENCY_HINTS = [
  'consultancy',
  'consulting services',
  'staffing',
  'recruitment',
  'manpower',
  'hiring partner',
  'placement',
];

/**
 * Flagged, never hidden — each flag carries the one-line reason the card shows
 * (FR-6.3). A job with an undisclosed salary is never excluded (hard rule 7).
 */
export function credibilityFlags(
  job: NormalizedJob,
  repostCount: number,
): CredibilityFlag[] {
  const flags: CredibilityFlag[] = [];

  if (!job.companyName) {
    flags.push({
      code: 'employer_withheld',
      reason: 'The employer name is not disclosed on this listing.',
    });
  }

  if (
    job.salaryDisclosed &&
    job.salaryMin != null &&
    job.salaryMax != null &&
    job.salaryMin > 0 &&
    job.salaryMax / job.salaryMin >= 4
  ) {
    flags.push({
      code: 'implausible_salary_spread',
      reason: 'The advertised salary range is unusually wide for one role.',
    });
  }

  if (repostCount >= 3) {
    flags.push({
      code: 'frequent_repost',
      reason: `This listing has been reposted ${repostCount} times.`,
    });
  }

  const company = (job.companyName ?? '').toLowerCase();
  if (job.isConsultantPosting || AGENCY_HINTS.some((hint) => company.includes(hint))) {
    flags.push({
      code: 'staffing_agency',
      reason: 'Posted by a staffing agency rather than the employer directly.',
    });
  }

  return flags;
}

/**
 * A posting seen on 3+ boards is real and actively distributed — the one
 * positive credibility signal in the set (§6).
 */
function distinctSourceCount(sourceUrls: string[]): number {
  const hosts = new Set<string>();
  for (const url of sourceUrls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      // Fold subdomains of the same board (in.linkedin.com, in.indeed.com).
      const board = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'foundit'].find((b) =>
        host.includes(b),
      );
      hosts.add(board ?? host);
    } catch {
      // Unparseable URL contributes nothing.
    }
  }
  return hosts.size;
}

export type UpsertResult = {
  jobId: string;
  isNew: boolean;
};

/**
 * Insert new jobs, fold repeats into the existing row. A repeat keeps its
 * original `firstSeenAt` and collects the new source URL, so the user can still
 * pick where to apply after a collapse (FR-5.1).
 */
export async function upsertJobs(
  userId: string,
  incoming: (NormalizedJob & { scoreDeferred?: boolean })[],
): Promise<UpsertResult[]> {
  const results: UpsertResult[] = [];
  const ts = now();

  for (const job of incoming) {
    const dedupeKey = makeDedupeKey(job);

    const existing = (
      await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.userId, userId), eq(jobs.dedupeKey, dedupeKey)))
        .limit(1)
    )[0];

    if (existing) {
      const repostCount = existing.repostCount + 1;
      const sourceUrls = Array.from(
        new Set([...existing.sourceUrls, job.sourceUrl].filter((u): u is string => !!u)),
      );

      // Field-wise merge by source priority (§6): each board is best at
      // something, so the collapsed row takes each field from its best source.
      const salaryFrom = preferBySource(
        SALARY_PRIORITY,
        { source: existing.source, value: existing.salaryDisclosed ? existing.salaryMin : null },
        { source: job.source, value: job.salaryDisclosed ? job.salaryMin : null },
      );
      const takeIncomingSalary = job.salaryDisclosed && salaryFrom === job.salaryMin;

      const flags = credibilityFlags(job, repostCount).filter((f) => f.code !== 'multi_sourced');
      if (distinctSourceCount(sourceUrls) >= 3) {
        flags.push({
          code: 'multi_sourced',
          reason: 'Listed on three or more job boards — actively distributed.',
        });
      }

      await db
        .update(jobs)
        .set({
          lastSeenAt: ts,
          repostCount,
          sourceUrls,
          // A later crawl often carries a fuller description than the first.
          descriptionFull:
            job.descriptionFull.length > existing.descriptionFull.length
              ? job.descriptionFull
              : existing.descriptionFull,
          ...(takeIncomingSalary
            ? {
                salaryMin: job.salaryMin,
                salaryMax: job.salaryMax,
                salaryCurrency: job.salaryCurrency,
                salaryPeriod: job.salaryPeriod,
                salaryDisclosed: true,
              }
            : {}),
          applyUrl: preferBySource(
            APPLY_URL_PRIORITY,
            { source: existing.source, value: existing.applyUrl },
            { source: job.source, value: job.applyUrl },
          ),
          careersUrl: preferBySource(
            CAREERS_URL_PRIORITY,
            { source: existing.source, value: existing.careersUrl },
            { source: job.source, value: job.careersUrl },
          ),
          companyRating: preferBySource(
            RATING_PRIORITY,
            { source: existing.source, value: existing.companyRating },
            { source: job.source, value: job.companyRating },
          ),
          // Applicant counts exist on LinkedIn only — keep whichever is real.
          applicantCount: existing.applicantCount ?? job.applicantCount,
          isEarlyApplicant: existing.isEarlyApplicant ?? job.isEarlyApplicant,
          keywordMatchPercent: existing.keywordMatchPercent ?? job.keywordMatchPercent,
          // A job first seen 3 days ago is 3 days old regardless of which
          // portal re-listed it today — keep the earliest date (§3.4).
          postedDate:
            existing.postedDate != null && job.postedDate != null
              ? Math.min(existing.postedDate, job.postedDate)
              : (existing.postedDate ?? job.postedDate),
          // A row already worth scoring never becomes deferred by a repeat.
          scoreDeferred: existing.scoreDeferred && (job.scoreDeferred ?? false),
          credibilityFlags: flags,
          updatedAt: ts,
          syncedAt: null,
        })
        .where(eq(jobs.id, existing.id));
      results.push({ jobId: existing.id, isNew: false });
      continue;
    }

    const id = newId();
    const { scoreDeferred, ...jobFields } = job;
    await db.insert(jobs).values({
      id,
      userId,
      dedupeKey,
      ...jobFields,
      scoreDeferred: scoreDeferred ?? false,
      sourceUrls: job.sourceUrl ? [job.sourceUrl] : [],
      credibilityFlags: credibilityFlags(job, 0),
      firstSeenAt: ts,
      lastSeenAt: ts,
      repostCount: 0,
      createdAt: ts,
      updatedAt: ts,
    });
    results.push({ jobId: id, isNew: true });
  }

  return results;
}

export type CustomJobInput = {
  title: string;
  companyName: string | null;
  location: string | null;
  descriptionFull: string;
  employmentType: EmploymentType | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  applyUrl: string | null;
  postedDate: number | null;
};

/**
 * A job the user entered by hand. Stored in the same table as crawled rows so
 * scoring, the tracker and history all work on it unchanged; `source` records
 * where it came from.
 */
export async function createCustomJob(
  userId: string,
  input: CustomJobInput,
): Promise<Job> {
  const ts = now();
  const dedupeKey = makeDedupeKey(input);

  const existing = (
    await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.dedupeKey, dedupeKey)))
      .limit(1)
  )[0];
  if (existing) return existing;

  const [row] = await db
    .insert(jobs)
    .values({
      id: newId(),
      userId,
      dedupeKey,
      title: input.title,
      companyName: input.companyName,
      location: input.location,
      isRemote: input.workMode === 'remote',
      employmentType: input.employmentType,
      workMode: input.workMode,
      experienceMinYears: null,
      experienceMaxYears: null,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      salaryCurrency: input.salaryCurrency,
      salaryPeriod: input.salaryPeriod,
      salaryDisclosed: input.salaryMin != null || input.salaryMax != null,
      descriptionFull: input.descriptionFull,
      postedDate: input.postedDate,
      applicantCount: null,
      // Manual entries are attributed to the board the user says they came from;
      // 'linkedin' is the schema default rather than a claim about origin.
      source: 'linkedin' as JobSource,
      sourceUrl: input.applyUrl,
      sourceUrls: input.applyUrl ? [input.applyUrl] : [],
      applyUrl: input.applyUrl,
      firstSeenAt: ts,
      lastSeenAt: ts,
      repostCount: 0,
      credibilityFlags: [],
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

export async function deleteJob(jobId: string) {
  await db.delete(jobs).where(eq(jobs.id, jobId));
}
