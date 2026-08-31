import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@db/client';
import {
  searchHistoryJobs,
  searches,
  type NewSearch,
  type Search,
  type SearchFilters,
  type SearchStatus,
} from '@db/schema';
import { newId } from '@/lib/uuid';
import { now, startOfToday } from '@/lib/time';

/** Mirrors the server-side cap so the UI can show the allowance (§7.3, hard rule 6). */
export const DAILY_SEARCH_CAP = 5;

export function useSearchHistory(userId: string | undefined) {
  const { data, error } = useLiveQuery(
    db
      .select()
      .from(searches)
      .where(eq(searches.userId, userId ?? ''))
      .orderBy(desc(searches.createdAt)),
  );
  return { searches: data ?? [], error };
}

export async function getSearch(searchId: string): Promise<Search | null> {
  const rows = await db.select().from(searches).where(eq(searches.id, searchId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Advisory only. The real cap is enforced in the Edge Function — this exists so
 * the user sees the remaining allowance before committing (hard rule 6).
 */
export async function searchesRemainingToday(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(searches)
    .where(and(eq(searches.userId, userId), gte(searches.createdAt, startOfToday())));
  return Math.max(0, DAILY_SEARCH_CAP - (rows[0]?.count ?? 0));
}

export async function createSearch(input: {
  userId: string;
  resumeId: string;
  filters: SearchFilters;
  windowRequestedDays: number;
  sources: NewSearch['sources'];
}): Promise<Search> {
  const ts = now();
  const [row] = await db
    .insert(searches)
    .values({
      id: newId(),
      userId: input.userId,
      resumeId: input.resumeId,
      filtersJson: input.filters,
      windowRequestedDays: input.windowRequestedDays,
      sources: input.sources,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row!;
}

export async function updateSearchStatus(
  searchId: string,
  status: SearchStatus,
  fields: Partial<Pick<
    NewSearch,
    | 'windowUsedDays'
    | 'rawResultCount'
    | 'dedupedCount'
    | 'scoredCount'
    | 'apifyRunIds'
    | 'inputTokens'
    | 'outputTokens'
    | 'errorMessage'
    | 'recallAuditJson'
  >> = {},
) {
  await db
    .update(searches)
    .set({ status, ...fields, updatedAt: now() })
    .where(eq(searches.id, searchId));
}

export async function linkJobsToSearch(
  searchId: string,
  userId: string,
  links: { jobId: string; prefilterRank: number; outsideRequestedWindow: boolean }[],
) {
  if (links.length === 0) return;
  const ts = now();
  await db
    .insert(searchHistoryJobs)
    .values(
      links.map((l) => ({
        searchId,
        userId,
        jobId: l.jobId,
        prefilterRank: l.prefilterRank,
        outsideRequestedWindow: l.outsideRequestedWindow,
        createdAt: ts,
      })),
    )
    .onConflictDoNothing();
}

/**
 * The honest label for a widened search: how many landed inside the requested
 * window versus how many came from the widened one (FR-4.3).
 */
export async function windowBreakdown(searchId: string) {
  const rows = await db
    .select({
      outside: searchHistoryJobs.outsideRequestedWindow,
      count: sql<number>`count(*)`,
    })
    .from(searchHistoryJobs)
    .where(eq(searchHistoryJobs.searchId, searchId))
    .groupBy(searchHistoryJobs.outsideRequestedWindow);

  const within = rows.find((r) => !r.outside)?.count ?? 0;
  const outside = rows.find((r) => r.outside)?.count ?? 0;
  return { within, outside };
}
