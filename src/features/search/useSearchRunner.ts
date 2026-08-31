import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '@db/client';
import { jobs, type Job, type JobSource, type SearchFilters } from '@db/schema';
import { inArray } from 'drizzle-orm';
import { useAuth } from '@/features/auth/AuthProvider';
import { getDefaultResume } from '@/features/resume/resumeQueries';
import { scoreJobsSequentially } from '@/features/scoring/scoreJob';
import { getCredentials, getModelForStage, loadSettings } from '@/features/settings/settingsStore';
import { runSearch, SearchCapReachedError, type SearchProgress } from './runSearch';
import { searchesRemainingToday } from './searchQueries';

export type RunnerStage =
  | { kind: 'idle' }
  | { kind: 'crawling'; label: string }
  | { kind: 'scoring'; done: number; total: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; jobCount: number; scored: number; failed: number; warnings: string[] };

const SOURCE_PROGRESS_LABEL: Record<JobSource, string> = {
  linkedin: 'Searching LinkedIn…',
  indeed: 'Searching Indeed…',
  naukri: 'Searching Naukri…',
  glassdoor: 'Searching Glassdoor…',
  foundit: 'Searching Foundit…',
};

/**
 * Owns one search end to end: crawl, persist, then score. Scoring runs after the
 * jobs are already in SQLite, so the list is populated before any score lands
 * (FR-5.3).
 */
export function useSearchRunner() {
  const { userId } = useAuth();
  const [stage, setStage] = useState<RunnerStage>({ kind: 'idle' });
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const refreshRemaining = useCallback(async () => {
    if (!userId) return;
    const value = await searchesRemainingToday(userId);
    if (mountedRef.current) setRemaining(value);
  }, [userId]);

  useEffect(() => {
    void refreshRemaining();
  }, [refreshRemaining]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStage({ kind: 'idle' });
  }, []);

  const run = useCallback(
    async (filters: SearchFilters, sources: JobSource[], windowDays: number) => {
      if (!userId) return;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const settings = await loadSettings();
        if (!settings.apifyToken) {
          setStage({
            kind: 'error',
            message: 'Add your Apify token in Settings before running a search.',
          });
          return;
        }

        const resume = await getDefaultResume(userId);
        if (!resume) {
          setStage({ kind: 'error', message: 'Add a resume before searching.' });
          return;
        }

        setStage({ kind: 'crawling', label: 'Starting…' });

        // Credentials are fetched up front: query expansion uses them when
        // available, and scoring reuses them afterwards.
        const credentials = await getCredentials();

        const result = await runSearch({
          userId,
          resumeId: resume.id,
          apifyToken: settings.apifyToken,
          filters,
          sources,
          windowRequestedDays: windowDays,
          resume: resume.parsedJson ?? null,
          credentials,
          expandModelId: credentials ? await getModelForStage('score') : null,
          signal: controller.signal,
          onProgress: (progress: SearchProgress) => {
            if (!mountedRef.current) return;
            if (progress.phase === 'expanding') {
              setStage({ kind: 'crawling', label: 'Expanding your query…' });
            } else if (progress.phase === 'crawling') {
              setStage({ kind: 'crawling', label: SOURCE_PROGRESS_LABEL[progress.source] });
            } else if (progress.phase === 'saving') {
              setStage({ kind: 'crawling', label: `Saving ${progress.count} jobs…` });
            }
          },
        });

        void refreshRemaining();

        const warnings = result.sourceErrors.map((e) => e.message);
        if (result.windowUsedDays > windowDays) {
          warnings.push(
            `Too few results in the last ${windowDays} days, so the window was widened to ${result.windowUsedDays}.`,
          );
        }
        if (result.deferredCount > 0) {
          warnings.push(
            `${result.deferredCount} low-overlap ${result.deferredCount === 1 ? 'job' : 'jobs'} saved without a score — tap any of them to score on demand.`,
          );
        }

        // Scoring needs a parsed resume; the raw file alone is not enough (FR-3).
        if (!credentials || !resume.parsedJson) {
          setStage({
            kind: 'done',
            jobCount: result.jobIds.length,
            scored: 0,
            failed: 0,
            warnings: [
              ...warnings,
              !credentials
                ? 'Jobs saved, but scoring needs your Bedrock key in Settings.'
                : 'Jobs saved, but this resume has not been read yet — parse it to enable scoring.',
            ],
          });
          return;
        }

        // Only the prefilter survivors cost model tokens; deferred jobs stay
        // visible and score on tap (§8.2).
        const toScore =
          result.jobIdsToScore.length > 0
            ? await db.select().from(jobs).where(inArray(jobs.id, result.jobIdsToScore))
            : ([] as Job[]);

        setStage({ kind: 'scoring', done: 0, total: toScore.length });

        const modelId = await getModelForStage('score');
        const { scored, failed } = await scoreJobsSequentially(
          toScore,
          {
            userId,
            resumeId: resume.id,
            resume: resume.parsedJson,
            credentials,
            modelId,
            searchId: result.searchId,
          },
          (progress) => {
            if (mountedRef.current) {
              setStage({ kind: 'scoring', done: progress.done, total: progress.total });
            }
          },
          controller.signal,
        );

        if (!mountedRef.current) return;
        setStage({
          kind: 'done',
          jobCount: result.jobIds.length,
          scored,
          failed,
          warnings,
        });
      } catch (error) {
        if (!mountedRef.current) return;
        setStage({
          kind: 'error',
          message:
            error instanceof SearchCapReachedError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Search failed.',
        });
      }
    },
    [userId, refreshRemaining],
  );

  return { stage, remaining, run, cancel, reset: () => setStage({ kind: 'idle' }) };
}
