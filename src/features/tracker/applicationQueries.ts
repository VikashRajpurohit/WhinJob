import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@db/client';
import {
  applications,
  jobs,
  type Application,
  type ApplicationStatus,
  type Job,
  type NewApplication,
  type StatusHistoryEntry,
} from '@db/schema';
import { newId } from '@/lib/uuid';
import { now } from '@/lib/time';

export type TrackerRow = {
  application: Application;
  job: Job;
};

export function useApplications(userId: string | undefined, status?: ApplicationStatus) {
  const base = and(
    eq(applications.userId, userId ?? ''),
    status ? eq(applications.status, status) : undefined,
  );
  const { data, error, updatedAt } = useLiveQuery(
    db
      .select({ application: applications, job: jobs })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(base)
      .orderBy(desc(applications.updatedAt)),
  );
  return { rows: (data ?? []) as TrackerRow[], error, loading: updatedAt === undefined };
}

export async function getApplicationForJob(
  userId: string,
  jobId: string,
): Promise<Application | null> {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
    .limit(1);
  return rows[0] ?? null;
}

type ApplicationFields = Partial<
  Omit<NewApplication, 'id' | 'userId' | 'jobId' | 'createdAt' | 'updatedAt' | 'statusHistoryJson'>
>;

export async function upsertApplication(
  userId: string,
  jobId: string,
  status: ApplicationStatus,
  fields: ApplicationFields = {},
): Promise<Application> {
  const ts = now();
  const existing = await getApplicationForJob(userId, jobId);

  if (!existing) {
    const [row] = await db
      .insert(applications)
      .values({
        id: newId(),
        userId,
        jobId,
        status,
        ...fields,
        statusHistoryJson: [{ status, at: ts }],
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();
    return row!;
  }

  // Append-only: the tracker is an audit trail, not a mutable field (FR-7.3).
  const history: StatusHistoryEntry[] =
    existing.status === status
      ? existing.statusHistoryJson
      : [...existing.statusHistoryJson, { status, at: ts }];

  const [row] = await db
    .update(applications)
    .set({ status, ...fields, statusHistoryJson: history, updatedAt: ts, syncedAt: null })
    .where(eq(applications.id, existing.id))
    .returning();
  return row!;
}

export async function updateApplicationFields(
  applicationId: string,
  fields: ApplicationFields,
) {
  await db
    .update(applications)
    .set({ ...fields, updatedAt: now(), syncedAt: null })
    .where(eq(applications.id, applicationId));
}

const APPLIED_STATUSES: ApplicationStatus[] = [
  'applied',
  'applied_directly',
  'applied_through_referral',
];

export type TransitionWarning =
  | { kind: 'referral_sequencing'; message: string }
  | { kind: 'duplicate_application'; message: string; otherJobTitle: string };

/**
 * Warnings the UI must surface *before* committing a transition. Both are
 * confirmations, not blocks — the user can always proceed (FR-7.4, FR-7.5).
 */
export async function checkTransition(
  userId: string,
  jobId: string,
  next: ApplicationStatus,
): Promise<TransitionWarning[]> {
  const warnings: TransitionWarning[] = [];
  const existing = await getApplicationForJob(userId, jobId);

  // Most employers only credit a referral submitted before the portal application.
  if (existing?.status === 'referral_requested' && next === 'applied_directly') {
    warnings.push({
      kind: 'referral_sequencing',
      message:
        'You have a referral request pending. Applying directly now usually voids the referral credit.',
    });
  }

  if (APPLIED_STATUSES.includes(next)) {
    const duplicate = await findAppliedDuplicate(userId, jobId);
    if (duplicate) {
      warnings.push({
        kind: 'duplicate_application',
        message: `You already applied to this role via ${duplicate.source}.`,
        otherJobTitle: duplicate.title,
      });
    }
  }

  return warnings;
}

/** Another job sharing this job's dedupe_key that has already been applied to (FR-7.5). */
async function findAppliedDuplicate(userId: string, jobId: string) {
  const target = await db
    .select({ dedupeKey: jobs.dedupeKey })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  const dedupeKey = target[0]?.dedupeKey;
  if (!dedupeKey) return null;

  const rows = await db
    .select({ title: jobs.title, source: jobs.source })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(
      and(
        eq(applications.userId, userId),
        eq(jobs.dedupeKey, dedupeKey),
        ne(jobs.id, jobId),
        sql`${applications.status} in ('applied', 'applied_directly', 'applied_through_referral')`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Due reminders drive local notifications only; nothing is scheduled server-side (FR-7.6). */
export async function dueFollowUps(userId: string, at: number = now()) {
  return db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(
      and(
        eq(applications.userId, userId),
        sql`${applications.followUpAt} is not null and ${applications.followUpAt} <= ${at}`,
      ),
    )
    .orderBy(applications.followUpAt);
}

export async function statusCounts(userId: string) {
  const rows = await db
    .select({ status: applications.status, count: sql<number>`count(*)` })
    .from(applications)
    .where(eq(applications.userId, userId))
    .groupBy(applications.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count])) as Partial<
    Record<ApplicationStatus, number>
  >;
}
