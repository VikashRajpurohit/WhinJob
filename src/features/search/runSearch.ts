import type { JobSource, ParsedResume, RecallAudit, SearchFilters } from '@db/schema';
import { ADAPTERS, SOURCE_LABEL, type NormalizedJob } from './adapters';
import { makeDedupeKey, upsertJobs } from '@/features/dashboard/jobWriter';
import type { ProviderCredentials } from '@/features/settings/settingsStore';
import { runActor } from '@/lib/apify';
import { DAY_MS } from '@/lib/time';
import { getExpandedQuery } from './expandQuery';
import { prefilter } from './prefilter';
import {
  createSearch,
  linkJobsToSearch,
  searchesRemainingToday,
  updateSearchStatus,
} from './searchQueries';

/** Rows requested per (term × source) run. Dedupe collapses most of the tail past this (§4.4). */
const PER_QUERY_LIMIT = 40;

/** The widest window ever crawled. Everything narrower is filtered client-side. */
const MAX_WINDOW_DAYS = 30;

/** Below this inside the requested window, results are widened rather than shown thin (FR-4.3). */
const MIN_RESULTS_BEFORE_WIDENING = 8;

export type SearchProgress =
  | { phase: 'starting' }
  | { phase: 'expanding' }
  | { phase: 'crawling'; source: JobSource; index: number; total: number }
  | { phase: 'saving'; count: number }
  | { phase: 'done'; searchId: string; jobCount: number };

export type RunSearchInput = {
  userId: string;
  resumeId: string;
  apifyToken: string;
  filters: SearchFilters;
  sources: JobSource[];
  windowRequestedDays: number;
  /** Parsed resume: powers query expansion and the prefilter gates. Optional. */
  resume?: ParsedResume | null;
  /** Bedrock credentials for query expansion. Optional — local variants still run. */
  credentials?: ProviderCredentials | null;
  expandModelId?: string | null;
  onProgress?: (progress: SearchProgress) => void;
  signal?: AbortSignal;
};

export type RunSearchResult = {
  searchId: string;
  /** Every distinct job written, in prefilter-rank order. */
  jobIds: string[];
  /** The subset worth spending model tokens on (§8.2). */
  jobIdsToScore: string[];
  deferredCount: number;
  rawCount: number;
  dedupedCount: number;
  windowUsedDays: number;
  termsUsed: string[];
  /** Non-fatal: one source failing must not fail the search. */
  sourceErrors: { source: JobSource; message: string }[];
};

export class SearchCapReachedError extends Error {
  constructor() {
    super('You have used all 5 searches for today.');
    this.name = 'SearchCapReachedError';
  }
}

/**
 * Stage 1: rank by how much of what the user asked for actually appears in the
 * job description. Matching on the title alone is what produces plausible-looking
 * but irrelevant results (FR-5.2).
 */
function prefilterScore(job: NormalizedJob, filters: SearchFilters, terms: string[]): number {
  const haystack = `${job.title}\n${job.descriptionFull}`.toLowerCase();
  const probes = [
    ...terms.flatMap((t) => t.split(/\s+/)),
    ...(filters.skills ?? []),
  ]
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 2);

  if (probes.length === 0) return 1;
  const hits = probes.filter((term) => haystack.includes(term)).length;
  // The free Glassdoor keyword match is a real signal when present.
  const boost = job.keywordMatchPercent != null ? job.keywordMatchPercent / 500 : 0;
  return hits / probes.length + boost;
}

/** Undisclosed salary is never an exclusion reason (FR-4.4, hard rule 7). */
function passesFilters(job: NormalizedJob, filters: SearchFilters): boolean {
  if (filters.work_mode && job.workMode && job.workMode !== filters.work_mode) return false;
  if (filters.employment_type && job.employmentType && job.employmentType !== filters.employment_type) {
    return false;
  }
  if (filters.company_name && job.companyName) {
    if (!job.companyName.toLowerCase().includes(filters.company_name.toLowerCase())) return false;
  }
  if (filters.salary_min != null && job.salaryDisclosed && job.salaryMax != null) {
    if (job.salaryMax < filters.salary_min) return false;
  }
  if (filters.salary_max != null && job.salaryDisclosed && job.salaryMin != null) {
    if (job.salaryMin > filters.salary_max) return false;
  }
  return true;
}

type CollectedRow = { job: NormalizedJob; term: string };

/**
 * Crawls one source: sequential within the source (one run per fan-out term for
 * most actors, a single batched run for Glassdoor/Foundit), and retries once
 * unfiltered when a filtered query returns zero rows (§4.2).
 */
async function crawlSource(args: {
  source: JobSource;
  apifyToken: string;
  filters: SearchFilters;
  terms: string[];
  resumeSkills: string[];
  signal?: AbortSignal;
}): Promise<{ rows: CollectedRow[]; runIds: string[] }> {
  const adapter = ADAPTERS[args.source];
  const inputs = adapter.buildInputs({
    filters: args.filters,
    windowDays: MAX_WINDOW_DAYS,
    perQueryLimit: PER_QUERY_LIMIT,
    terms: args.terms,
    resumeSkills: args.resumeSkills,
  });
  const perTerm = inputs.length === args.terms.length;

  const rows: CollectedRow[] = [];
  const runIds: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    let input = inputs[i]!;
    let { runId, items } = await runActor(args.apifyToken, adapter.actorId, input, {
      signal: args.signal,
      fields: adapter.datasetFields,
    });
    runIds.push(runId);

    if (items.length === 0 && adapter.relaxInput) {
      const relaxed = adapter.relaxInput(input);
      if (relaxed) {
        const retry = await runActor(args.apifyToken, adapter.actorId, relaxed, {
          signal: args.signal,
          fields: adapter.datasetFields,
        });
        runIds.push(retry.runId);
        items = retry.items;
      }
    }

    const term = perTerm ? args.terms[i]! : '(all terms)';
    rows.push(...adapter.normalize(items).map((job) => ({ job, term })));
  }

  return { rows, runIds };
}

/**
 * The client-side pipeline over an already-fetched superset: merge → filter →
 * date-cut → widen. Merging comes before filtering so a job dropped by one
 * source's date field survives on another's (§5 step 5).
 */
function assemble(collected: CollectedRow[], filters: SearchFilters, windowRequestedDays: number) {
  // Earliest posted date per dedupe key across every copy (§3.4).
  const earliestByKey = new Map<string, number>();
  for (const { job } of collected) {
    if (job.postedDate == null) continue;
    const key = makeDedupeKey(job);
    const current = earliestByKey.get(key);
    earliestByKey.set(key, current == null ? job.postedDate : Math.min(current, job.postedDate));
  }

  const filtered = collected.filter(({ job }) => passesFilters(job, filters));

  const requestedCutoff = Date.now() - windowRequestedDays * DAY_MS;
  const dateOf = (job: NormalizedJob) => earliestByKey.get(makeDedupeKey(job)) ?? null;
  const withinWindow = filtered.filter(({ job }) => {
    const date = dateOf(job);
    return date == null || date >= requestedCutoff;
  });

  const distinct = (rows: CollectedRow[]) => new Set(rows.map(({ job }) => makeDedupeKey(job))).size;

  const widened = distinct(withinWindow) < MIN_RESULTS_BEFORE_WIDENING;
  const selected = widened ? filtered : withinWindow;
  const windowUsedDays = widened ? MAX_WINDOW_DAYS : windowRequestedDays;

  return { selected, windowUsedDays, requestedCutoff, dateOf, distinctCount: distinct(selected) };
}

function buildRecallAudit(collected: CollectedRow[]): RecallAudit {
  const keySources = new Map<string, Set<JobSource>>();
  const keyTerms = new Map<string, Set<string>>();
  for (const { job, term } of collected) {
    const key = makeDedupeKey(job);
    (keySources.get(key) ?? keySources.set(key, new Set()).get(key)!).add(job.source);
    (keyTerms.get(key) ?? keyTerms.set(key, new Set()).get(key)!).add(term);
  }

  const perSource: RecallAudit['perSource'] = {};
  const perTerm: RecallAudit['perTerm'] = {};
  for (const { job, term } of collected) {
    (perSource[job.source] ??= { rows: 0, unique: 0 }).rows++;
    (perTerm[term] ??= { rows: 0, unique: 0 }).rows++;
  }
  // `unique` = keys only this source (or term) contributed — the dead-weight
  // detector for the monthly read of the audit (§3.6).
  for (const [key, sources] of keySources) {
    if (sources.size === 1) {
      const only = [...sources][0]!;
      (perSource[only] ??= { rows: 0, unique: 0 }).unique++;
    }
    const terms = keyTerms.get(key)!;
    if (terms.size === 1) {
      const only = [...terms][0]!;
      (perTerm[only] ??= { rows: 0, unique: 0 }).unique++;
    }
  }
  return { perSource, perTerm };
}

/**
 * Runs the whole crawl on the device. There is no server, so the daily cap is
 * enforced here — it is a real limit for this build, not the advisory check the
 * spec assumed alongside an Edge Function.
 */
export async function runSearch(input: RunSearchInput): Promise<RunSearchResult> {
  const remaining = await searchesRemainingToday(input.userId);
  if (remaining <= 0) throw new SearchCapReachedError();

  input.onProgress?.({ phase: 'starting' });
  input.onProgress?.({ phase: 'expanding' });

  // One model call per resume, cached — never per search (§5 step 2). With no
  // credentials the local orthographic variants still run.
  const expansion = await getExpandedQuery({
    resumeId: input.resumeId,
    resume: input.resume ?? null,
    filters: input.filters,
    credentials: input.credentials ?? null,
    modelId: input.expandModelId ?? null,
  });
  const terms = expansion.terms;
  const resumeSkills =
    input.resume?.primary_skills?.length
      ? input.resume.primary_skills
      : (input.resume?.skills ?? []);

  const search = await createSearch({
    userId: input.userId,
    resumeId: input.resumeId,
    filters: input.filters,
    windowRequestedDays: input.windowRequestedDays,
    sources: input.sources,
  });

  const sourceErrors: RunSearchResult['sourceErrors'] = [];
  const runIds: string[] = [];
  const collected: CollectedRow[] = [];

  const crawlTier = async (sources: JobSource[]) => {
    // Parallel across sources, sequential within a source (§5 step 4).
    await Promise.all(
      sources.map(async (source, index) => {
        input.onProgress?.({ phase: 'crawling', source, index, total: sources.length });
        try {
          const { rows, runIds: sourceRunIds } = await crawlSource({
            source,
            apifyToken: input.apifyToken,
            filters: input.filters,
            terms,
            resumeSkills,
            signal: input.signal,
          });
          runIds.push(...sourceRunIds);
          collected.push(...rows);
        } catch (error) {
          // One dead source must never fail the whole search.
          sourceErrors.push({
            source,
            message:
              error instanceof Error
                ? `${SOURCE_LABEL[source]}: ${error.message}`
                : `${SOURCE_LABEL[source]} failed.`,
          });
        }
      }),
    );
  };

  try {
    await updateSearchStatus(search.id, 'crawling');

    const tier1 = input.sources.filter((s) => ADAPTERS[s].tier === 1);
    const tier2 = input.sources.filter((s) => ADAPTERS[s].tier === 2);

    await crawlTier(tier1.length > 0 ? tier1 : input.sources);

    let pipeline = assemble(collected, input.filters, input.windowRequestedDays);

    // Tier 2 only when Tier 1 came up short (§5 step 8).
    if (pipeline.distinctCount < MIN_RESULTS_BEFORE_WIDENING && tier2.length > 0) {
      await crawlTier(tier2);
      pipeline = assemble(collected, input.filters, input.windowRequestedDays);
    }

    const rawCount = collected.length;
    const { selected, windowUsedDays, requestedCutoff, dateOf } = pipeline;

    // One representative per key — the copy with the longest description —
    // feeds the gates and the ranking; every copy is still written so the
    // merged row keeps all source URLs.
    const byKey = new Map<string, CollectedRow[]>();
    for (const row of selected) {
      const key = makeDedupeKey(row.job);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else byKey.set(key, [row]);
    }
    const representatives = [...byKey.entries()].map(([key, rows]) => ({
      key,
      rows,
      job: rows.reduce((a, b) => (b.job.descriptionFull.length > a.job.descriptionFull.length ? b : a)).job,
    }));

    // Free gates before any model spend (§8.2).
    const gated = prefilter(
      representatives.map((r) => r.job),
      {
        resume: input.resume ?? null,
        filters: input.filters,
        extraDisqualifiers: expansion.disqualifierTitles,
      },
    );
    const deferredKeys = new Set(gated.deferred.map((job) => makeDedupeKey(job)));
    const keptKeys = new Set([...gated.toScore, ...gated.deferred].map((job) => makeDedupeKey(job)));

    const ranked = representatives
      .filter((r) => keptKeys.has(r.key))
      .map((r) => ({ ...r, rank: prefilterScore(r.job, input.filters, terms) }))
      .sort((a, b) => b.rank - a.rank);

    input.onProgress?.({ phase: 'saving', count: ranked.length });

    await updateSearchStatus(search.id, 'prefiltered', {
      rawResultCount: rawCount,
      dedupedCount: ranked.length,
      apifyRunIds: runIds,
      windowUsedDays,
      recallAuditJson: buildRecallAudit(collected),
    });

    // Copies of one key are written consecutively so they fold into one row
    // and the merged row takes each field from its best source (§6).
    const writes: (NormalizedJob & { scoreDeferred?: boolean })[] = [];
    const writeKeyOf: string[] = [];
    for (const r of ranked) {
      for (const { job } of r.rows) {
        writes.push({ ...job, scoreDeferred: deferredKeys.has(r.key) });
        writeKeyOf.push(r.key);
      }
    }
    const upserted = await upsertJobs(input.userId, writes);

    // First jobId per key, in rank order.
    const jobIdByKey = new Map<string, string>();
    upserted.forEach((result, i) => {
      const key = writeKeyOf[i]!;
      if (!jobIdByKey.has(key)) jobIdByKey.set(key, result.jobId);
    });

    const links = ranked
      .map((r, index) => {
        const jobId = jobIdByKey.get(r.key);
        if (!jobId) return null;
        const date = dateOf(r.job);
        return {
          jobId,
          prefilterRank: index,
          outsideRequestedWindow: date != null && date < requestedCutoff,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    await linkJobsToSearch(search.id, input.userId, links);

    await updateSearchStatus(search.id, 'complete', {
      dedupedCount: ranked.length,
      errorMessage: sourceErrors.length ? sourceErrors.map((e) => e.message).join('\n') : null,
    });

    const jobIds = links.map((l) => l.jobId);
    const jobIdsToScore = ranked
      .filter((r) => !deferredKeys.has(r.key))
      .map((r) => jobIdByKey.get(r.key))
      .filter((id): id is string => !!id);

    input.onProgress?.({ phase: 'done', searchId: search.id, jobCount: jobIds.length });

    return {
      searchId: search.id,
      jobIds,
      jobIdsToScore,
      deferredCount: deferredKeys.size,
      rawCount,
      dedupedCount: jobIds.length,
      windowUsedDays,
      termsUsed: terms,
      sourceErrors,
    };
  } catch (error) {
    await updateSearchStatus(search.id, 'failed', {
      errorMessage: error instanceof Error ? error.message : 'Search failed.',
      apifyRunIds: runIds,
    });
    throw error;
  }
}
