import { useCallback, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@db/client';
import {
  applications,
  jobScores,
  jobs,
  type ApplicationStatus,
  type Job,
  type JobScore,
} from '@db/schema';
import { useAuth } from '@/features/auth/AuthProvider';
import { getDefaultResume } from '@/features/resume/resumeQueries';
import { analyseJob, buildApplyKit, scoreJob } from '@/features/scoring/scoreJob';
import { getCredentials, getModelForStage } from '@/features/settings/settingsStore';
import {
  checkTransition,
  upsertApplication,
  type TransitionWarning,
} from '@/features/tracker/applicationQueries';
import { setBookmarked, setHidden } from './jobQueries';
import { now } from '@/lib/time';

export type DetailBusy = 'none' | 'scoring' | 'analysing' | 'building_kit';

export function useJobDetail(jobId: string) {
  const { userId } = useAuth();
  const [busy, setBusy] = useState<DetailBusy>('none');
  const [error, setError] = useState<string | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<{
    status: ApplicationStatus;
    warnings: TransitionWarning[];
  } | null>(null);

  const jobQuery = useLiveQuery(db.select().from(jobs).where(eq(jobs.id, jobId)));
  const job = (jobQuery.data?.[0] ?? null) as Job | null;

  const scoreQuery = useLiveQuery(db.select().from(jobScores).where(eq(jobScores.jobId, jobId)));
  const score = (scoreQuery.data?.[0] ?? null) as JobScore | null;

  const appQuery = useLiveQuery(
    db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId ?? ''), eq(applications.jobId, jobId))),
  );
  const application = appQuery.data?.[0] ?? null;

  const runWithResume = useCallback(
    async (work: (args: {
      job: Job;
      resumeId: string;
      resume: NonNullable<Awaited<ReturnType<typeof getDefaultResume>>>['parsedJson'];
      credentials: NonNullable<Awaited<ReturnType<typeof getCredentials>>>;
    }) => Promise<void>) => {
      if (!job || !userId) return;
      setError(null);

      const credentials = await getCredentials();
      if (!credentials) {
        setError('Add your Bedrock key in Settings first.');
        return;
      }
      const resume = await getDefaultResume(userId);
      if (!resume) {
        setError('Add a resume first.');
        return;
      }
      if (!resume.parsedJson) {
        setError('This resume has not been read yet. Parse it from the Resumes screen.');
        return;
      }
      await work({ job, resumeId: resume.id, resume: resume.parsedJson, credentials });
    },
    [job, userId],
  );

  /** Explicit user action only — scores are never re-run automatically (hard rule 4). */
  const rescore = useCallback(async () => {
    setBusy('scoring');
    try {
      await runWithResume(async ({ job: target, resumeId, resume, credentials }) => {
        await scoreJob({
          userId: userId!,
          job: target,
          resumeId,
          resume: resume!,
          credentials,
          modelId: await getModelForStage('score'),
        });
        // A prefilter-deferred job the user chose to score is deferred no more.
        if (target.scoreDeferred) {
          await db
            .update(jobs)
            .set({ scoreDeferred: false, updatedAt: now() })
            .where(eq(jobs.id, target.id));
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scoring failed.');
    } finally {
      setBusy('none');
    }
  }, [runWithResume, userId]);

  /** Fires on tap, never on open — opening a card must cost nothing (hard rule 5). */
  const analyse = useCallback(async () => {
    if (!score) {
      setError('Score this job before running a deep analysis.');
      return;
    }
    setBusy('analysing');
    try {
      await runWithResume(async ({ job: target, resumeId, resume, credentials }) => {
        await analyseJob({
          userId: userId!,
          job: target,
          resumeId,
          resume: resume!,
          credentials,
          modelId: await getModelForStage('analyse'),
          scoreId: score.id,
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setBusy('none');
    }
  }, [runWithResume, score, userId]);

  /** Apply kit — explicit tap only, like deep analysis (§C.5). */
  const buildKit = useCallback(async () => {
    if (!score) {
      setError('Score this job before building an apply kit.');
      return;
    }
    setBusy('building_kit');
    try {
      await runWithResume(async ({ job: target, resumeId, resume, credentials }) => {
        await buildApplyKit({
          userId: userId!,
          job: target,
          resumeId,
          resume: resume!,
          credentials,
          modelId: await getModelForStage('analyse'),
          scoreId: score.id,
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The apply kit could not be built.');
    } finally {
      setBusy('none');
    }
  }, [runWithResume, score, userId]);

  const toggleBookmark = useCallback(async () => {
    if (!job) return;
    await setBookmarked(job.id, !job.isBookmarked);
  }, [job]);

  const toggleHidden = useCallback(async () => {
    if (!job) return;
    await setHidden(job.id, !job.isHidden);
  }, [job]);

  const commitStatus = useCallback(
    async (status: ApplicationStatus) => {
      if (!userId) return;
      const isApplied = status.startsWith('applied');
      await upsertApplication(userId, jobId, status, isApplied ? { dateApplied: now() } : {});
      setPendingWarnings(null);
    },
    [jobId, userId],
  );

  /**
   * Warnings are confirmations, never blocks — the user can always proceed
   * (FR-7.4, FR-7.5).
   */
  const requestStatus = useCallback(
    async (status: ApplicationStatus) => {
      if (!userId) return;
      const warnings = await checkTransition(userId, jobId, status);
      if (warnings.length > 0) {
        setPendingWarnings({ status, warnings });
        return;
      }
      await commitStatus(status);
    },
    [commitStatus, jobId, userId],
  );

  const openApply = useCallback(async () => {
    const url = job?.applyUrl ?? job?.sourceUrl;
    if (!url) {
      setError('This job has no application link.');
      return;
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      setError('That application link could not be opened.');
      return;
    }
    await Linking.openURL(url);
  }, [job]);

  const applyUrls = useMemo(() => {
    if (!job) return [];
    return Array.from(new Set([job.applyUrl, ...job.sourceUrls].filter((u): u is string => !!u)));
  }, [job]);

  return {
    job,
    score,
    application,
    busy,
    error,
    applyUrls,
    pendingWarnings,
    dismissWarnings: () => setPendingWarnings(null),
    confirmPendingStatus: () =>
      pendingWarnings ? commitStatus(pendingWarnings.status) : Promise.resolve(),
    rescore,
    analyse,
    buildKit,
    toggleBookmark,
    toggleHidden,
    requestStatus,
    openApply,
    clearError: () => setError(null),
  };
}
