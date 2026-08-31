import { and, desc, eq, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@db/client';
import {
  jobScores,
  jobs,
  searchHistoryJobs,
  type DeepAnalysis,
  type Job,
  type JobScore,
} from '@db/schema';
import { now } from '@/lib/time';

/**
 * A card is a job plus its score for the *currently selected resume*, which may
 * not exist yet — scoring streams in after Stage-1 results render (FR-5.3).
 */
export type JobCard = {
  job: Job;
  score: JobScore | null;
};

const bandRank = sql`case ${jobScores.band}
  when 'strong' then 0
  when 'good' then 1
  when 'stretch' then 2
  when 'weak' then 3
  else 4 end`;

function cardSelect(resumeId: string) {
  return db
    .select({ job: jobs, score: jobScores })
    .from(jobs)
    .leftJoin(
      jobScores,
      and(eq(jobScores.jobId, jobs.id), eq(jobScores.resumeId, resumeId)),
    );
}

/**
 * Hidden jobs are excluded from result lists but retained in history (FR-6.5).
 * Unscored jobs sort last rather than being filtered out — the list must render
 * before any score exists.
 */
export function useJobCards(userId: string | undefined, resumeId: string | undefined) {
  const { data, error, updatedAt } = useLiveQuery(
    cardSelect(resumeId ?? '')
      .where(and(eq(jobs.userId, userId ?? ''), eq(jobs.isHidden, false)))
      .orderBy(bandRank, desc(jobScores.score), desc(jobs.postedDate)),
  );
  // `data` starts as [] before the first read resolves, so only `updatedAt`
  // separates "still loading" from "genuinely empty".
  return { cards: (data ?? []) as JobCard[], error, loading: updatedAt === undefined };
}

/** Jobs a specific search surfaced, in the order Stage 1 ranked them (FR-8). */
export function useJobCardsForSearch(searchId: string, resumeId: string | undefined) {
  const { data, error } = useLiveQuery(
    cardSelect(resumeId ?? '')
      .innerJoin(searchHistoryJobs, eq(searchHistoryJobs.jobId, jobs.id))
      .where(eq(searchHistoryJobs.searchId, searchId))
      .orderBy(searchHistoryJobs.prefilterRank),
  );
  return { cards: (data ?? []) as JobCard[], error };
}

export function useBookmarkedJobs(userId: string | undefined, resumeId: string | undefined) {
  const { data, error, updatedAt } = useLiveQuery(
    cardSelect(resumeId ?? '')
      .where(and(eq(jobs.userId, userId ?? ''), eq(jobs.isBookmarked, true)))
      .orderBy(desc(jobs.updatedAt)),
  );
  return { cards: (data ?? []) as JobCard[], error, loading: updatedAt === undefined };
}

export async function getJob(jobId: string): Promise<Job | null> {
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Cached per (job_id, resume_id) and never re-run automatically (hard rule 4).
 * A null result is what triggers scoring for that pair — once.
 */
export async function getCachedScore(
  jobId: string,
  resumeId: string,
): Promise<JobScore | null> {
  const rows = await db
    .select()
    .from(jobScores)
    .where(and(eq(jobScores.jobId, jobId), eq(jobScores.resumeId, resumeId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function jobIdsNeedingScore(
  userId: string,
  resumeId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .leftJoin(jobScores, and(eq(jobScores.jobId, jobs.id), eq(jobScores.resumeId, resumeId)))
    .where(and(eq(jobs.userId, userId), eq(jobs.isHidden, false), sql`${jobScores.id} is null`))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function setBookmarked(jobId: string, isBookmarked: boolean) {
  await db
    .update(jobs)
    .set({ isBookmarked, updatedAt: now(), syncedAt: null })
    .where(eq(jobs.id, jobId));
}

export async function setHidden(jobId: string, isHidden: boolean) {
  await db
    .update(jobs)
    .set({ isHidden, updatedAt: now(), syncedAt: null })
    .where(eq(jobs.id, jobId));
}

/** Written only after the user taps Analyse; opening a card costs nothing (hard rule 5). */
export async function saveDeepAnalysis(scoreId: string, analysis: DeepAnalysis) {
  const ts = now();
  await db
    .update(jobScores)
    .set({ deepAnalysisJson: analysis, deepAnalysedAt: ts, updatedAt: ts })
    .where(eq(jobScores.id, scoreId));
}
