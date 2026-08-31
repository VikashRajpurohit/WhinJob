/**
 * Local SQLite schema — the source of truth for every read (spec §3.2, hard rule 3).
 * Mirrors the Postgres schema in `supabase/migrations`.
 *
 * Divergences from Postgres are deliberate and limited to storage encoding:
 *   - timestamps are epoch-millisecond integers (SQLite has no date type)
 *   - Postgres arrays and jsonb are JSON-encoded text
 *   - booleans are 0/1 integers
 * Column names stay identical so the sync layer can map field-for-field.
 *
 * Never hand-edit a migration once it has been applied.
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Epoch-millisecond timestamps shared by every table. SQLite has no date type,
 * and integers keep comparisons and the sync cursor cheap and unambiguous.
 */
export const timestamps = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
};

/** Set on the local row once the mutation queue has confirmed it server-side (FR-9.4). */
export const syncedAt = integer('synced_at');

/** UUIDs are generated client-side so offline inserts get a stable id immediately. */
export const primaryId = text('id').primaryKey();

// -- enumerations -------------------------------------------------------------
// SQLite has no enum type. These unions mirror the Postgres enums exactly; the
// arrays exist so the UI can iterate options without restating the values.

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SALARY_PERIODS = ['year', 'month', 'week', 'day', 'hour'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const JOB_SOURCES = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'foundit'] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

/** Band is the primary score display; the number is secondary (FR-6.4). */
export const MATCH_BANDS = ['strong', 'good', 'stretch', 'weak'] as const;
export type MatchBand = (typeof MATCH_BANDS)[number];

export const SEARCH_STATUSES = [
  'pending',
  'crawling',
  'prefiltered',
  'scoring',
  'complete',
  'failed',
] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

/** All 13 tracker statuses, in workflow order (FR-7.1). */
export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'referral_requested',
  'referral_received',
  'applied_through_referral',
  'applied_directly',
  'interview_scheduled',
  'hr_round',
  'technical_round',
  'manager_round',
  'offer_received',
  'rejected',
  'accepted',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** One appended entry per transition — the tracker is an audit trail (FR-7.3). */
export type StatusHistoryEntry = {
  status: ApplicationStatus;
  at: number;
  note?: string;
};

/** Flagged, never hidden — each carries the one-line reason shown on the card (FR-6.3). */
export type CredibilityFlag = {
  code:
    | 'employer_withheld'
    | 'implausible_salary_spread'
    | 'frequent_repost'
    | 'staffing_agency'
    | 'multi_sourced';
  reason: string;
};

/** Claude's structured extraction, reused across scoring runs (FR-3). */
export type ParsedResume = {
  skills: string[];
  roles: string[];
  experience: { title: string; company?: string; months?: number }[];
  projects?: { name: string; summary?: string; tech?: string[] }[];
  education?: { degree: string; institution?: string; year?: number }[];
  primary_skills?: string[];
  target_roles?: string[];
  total_experience_months?: number | null;
  seniority?: 'entry' | 'mid' | 'senior' | 'lead' | null;
  current_location?: string | null;
  preferred_locations?: string[];
  notice_period_days?: number | null;
  open_to_relocate?: boolean | null;
};

/** Deep analysis payload, populated only on explicit tap (§6.7). */
export type DeepAnalysis = {
  summary: string;
  strengths: string[];
  gaps: string[];
  interview_focus: string[];
  application_advice: string[];
  likely_screening_questions?: { question: string; how_to_answer: string }[];
  questions_to_ask_them?: string[];
  concerns?: string[];
};

/** Component sub-scores under the 40/25/20/15 rubric — lets the card say *why*. */
export type ScoreComponents = {
  skills: number;
  experience: number;
  role: number;
  location: number;
};

/** Apply-kit payload, populated only on explicit tap. */
export type ApplyKit = {
  headline: string;
  tailored_bullets: { original: string | null; rewritten: string; why: string }[];
  cover_note: string;
  referral_message: string;
  screening_answers: { question: string; answer: string }[];
  keywords_to_add: string[];
  do_not_claim: string[];
};

/** Model-generated fan-out, cached per (resume, filters) — one call per resume. */
export type QueryExpansion = {
  terms: { term: string; why: string; precision: 'high' | 'medium' | 'low' }[];
  location_aliases: string[];
  disqualifier_titles: string[];
};

/** Per-search recall bookkeeping — which sources and terms earn their spend (§3.6). */
export type RecallAudit = {
  perSource: Partial<Record<JobSource, { rows: number; unique: number }>>;
  perTerm: Record<string, { rows: number; unique: number }>;
};

export type SearchFilters = {
  title?: string;
  skills?: string[];
  location?: string;
  work_mode?: WorkMode;
  experience_min_years?: number;
  experience_max_years?: number;
  salary_min?: number;
  salary_max?: number;
  posted_within_days?: number;
  employment_type?: EmploymentType;
  company_name?: string;
};

const jsonArray = <T>() =>
  text({ mode: 'json' }).$type<T[]>().notNull().default(sql`'[]'`);

// -- profiles -----------------------------------------------------------------

export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone'),
  totalExperienceMonths: integer('total_experience_months'),
  noticePeriodDays: integer('notice_period_days'),
  /**
   * An empty array means "no preference stated". "Anywhere / Remote" is
   * openToRemote = 1 with no locations — a distinct state, not an empty list (FR-2).
   */
  preferredLocations: jsonArray<string>(),
  openToRemote: integer('open_to_remote', { mode: 'boolean' }).notNull().default(false),
  preferredRoles: jsonArray<string>(),
  currentCtc: real('current_ctc'),
  expectedCtc: real('expected_ctc'),
  ...timestamps,
  syncedAt,
});

// -- resumes ------------------------------------------------------------------

export const resumes = sqliteTable(
  'resumes',
  {
    id: primaryId,
    userId: text('user_id').notNull(),
    displayName: text('display_name').notNull(),
    storagePath: text('storage_path').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    parsedJson: text('parsed_json', { mode: 'json' }).$type<ParsedResume>(),
    parsedAt: integer('parsed_at'),
    /** A parse failure is surfaced but never blocks use of the raw file (FR-3). */
    parseError: text('parse_error'),
    /** Cached query fan-out; regenerated only when `expansionKey` changes (§C.2). */
    expansionKey: text('expansion_key'),
    expansionJson: text('expansion_json', { mode: 'json' }).$type<QueryExpansion>(),
    fileSize: integer('file_size'),
    mimeType: text('mime_type'),
    /** Local path of the downloaded file, so resumes read offline (FR-3). */
    localUri: text('local_uri'),
    deletedAt: integer('deleted_at'),
    ...timestamps,
    syncedAt,
  },
  (t) => [
    index('resumes_user_id_idx').on(t.userId),
    /** Exactly one default per user, ignoring soft-deleted rows (FR-3). */
    uniqueIndex('resumes_one_default_per_user')
      .on(t.userId)
      .where(sql`${t.isDefault} = 1 and ${t.deletedAt} is null`),
  ],
);

// -- searches -----------------------------------------------------------------

export const searches = sqliteTable(
  'searches',
  {
    id: primaryId,
    userId: text('user_id').notNull(),
    resumeId: text('resume_id'),
    filtersJson: text('filters_json', { mode: 'json' })
      .$type<SearchFilters>()
      .notNull()
      .default(sql`'{}'`),
    /** Requested vs used is what lets the UI honestly label widened results (FR-4.3). */
    windowRequestedDays: integer('window_requested_days'),
    windowUsedDays: integer('window_used_days'),
    sources: jsonArray<JobSource>(),
    rawResultCount: integer('raw_result_count').notNull().default(0),
    dedupedCount: integer('deduped_count').notNull().default(0),
    scoredCount: integer('scored_count').notNull().default(0),
    apifyRunIds: jsonArray<string>(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    status: text('status').$type<SearchStatus>().notNull().default('pending'),
    errorMessage: text('error_message'),
    recallAuditJson: text('recall_audit_json', { mode: 'json' }).$type<RecallAudit>(),
    ...timestamps,
    syncedAt,
  },
  (t) => [
    index('searches_user_created_idx').on(t.userId, t.createdAt),
    index('searches_resume_id_idx').on(t.resumeId),
  ],
);

// -- jobs ---------------------------------------------------------------------

export const jobs = sqliteTable(
  'jobs',
  {
    id: primaryId,
    userId: text('user_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    title: text('title').notNull(),
    companyName: text('company_name'),
    location: text('location'),
    isRemote: integer('is_remote', { mode: 'boolean' }),
    employmentType: text('employment_type').$type<EmploymentType>(),
    workMode: text('work_mode').$type<WorkMode>(),
    experienceMinYears: real('experience_min_years'),
    experienceMaxYears: real('experience_max_years'),
    salaryMin: real('salary_min'),
    salaryMax: real('salary_max'),
    salaryCurrency: text('salary_currency'),
    salaryPeriod: text('salary_period').$type<SalaryPeriod>(),
    /** Undisclosed is a distinct state from out-of-range (FR-4.4, hard rule 7). */
    salaryDisclosed: integer('salary_disclosed', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Mandatory — FR-5.2 matches on description content, not title. */
    descriptionFull: text('description_full').notNull(),
    postedDate: integer('posted_date'),
    applicantCount: integer('applicant_count'),
    source: text('source').$type<JobSource>().notNull(),
    sourceUrl: text('source_url'),
    /** Every collapsed duplicate keeps its URL so the user picks where to apply (FR-5.1). */
    sourceUrls: jsonArray<string>(),
    applyUrl: text('apply_url'),
    /** Company's own careers/ATS link. Null means "hide the link", never guess (§7). */
    careersUrl: text('careers_url'),
    isEarlyApplicant: integer('is_early_applicant', { mode: 'boolean' }),
    isConsultantPosting: integer('is_consultant_posting', { mode: 'boolean' }),
    companyRating: real('company_rating'),
    /** Glassdoor's free server-side resume keyword match, when available. */
    keywordMatchPercent: real('keyword_match_percent'),
    /** Kept visible but not auto-scored — the user taps to score (§8.2 Gate 2). */
    scoreDeferred: integer('score_deferred', { mode: 'boolean' }).notNull().default(false),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    repostCount: integer('repost_count').notNull().default(0),
    credibilityFlags: jsonArray<CredibilityFlag>(),
    isBookmarked: integer('is_bookmarked', { mode: 'boolean' }).notNull().default(false),
    isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
    syncedAt,
  },
  (t) => [
    uniqueIndex('jobs_user_dedupe_key').on(t.userId, t.dedupeKey),
    index('jobs_user_posted_idx').on(t.userId, t.postedDate),
    index('jobs_user_visible_idx').on(t.userId, t.isHidden),
  ],
);

// -- job_scores ---------------------------------------------------------------

export const jobScores = sqliteTable(
  'job_scores',
  {
    id: primaryId,
    userId: text('user_id').notNull(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    resumeId: text('resume_id').notNull(),
    searchId: text('search_id'),
    band: text('band').$type<MatchBand>().notNull(),
    score: integer('score').notNull(),
    scoreComponentsJson: text('score_components_json', { mode: 'json' }).$type<ScoreComponents>(),
    matchedSkills: jsonArray<string>(),
    missingSkills: jsonArray<string>(),
    rationale: text('rationale'),
    improvementSuggestions: jsonArray<string>(),
    /** Null until the user taps Analyse; opening a card costs nothing (hard rule 5). */
    deepAnalysisJson: text('deep_analysis_json', { mode: 'json' }).$type<DeepAnalysis>(),
    deepAnalysedAt: integer('deep_analysed_at'),
    /** Null until the user taps "Build apply kit" — explicit tap only (§C.5). */
    applyKitJson: text('apply_kit_json', { mode: 'json' }).$type<ApplyKit>(),
    applyKitAt: integer('apply_kit_at'),
    modelUsed: text('model_used').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    scoredAt: integer('scored_at').notNull(),
    ...timestamps,
    syncedAt,
  },
  (t) => [
    /** One cached score per pair; re-scoring overwrites, never accumulates (FR-5.4). */
    uniqueIndex('job_scores_job_resume_key').on(t.jobId, t.resumeId),
    index('job_scores_user_idx').on(t.userId),
    index('job_scores_resume_id_idx').on(t.resumeId),
    index('job_scores_search_id_idx').on(t.searchId),
  ],
);

// -- applications -------------------------------------------------------------

export const applications = sqliteTable(
  'applications',
  {
    id: primaryId,
    userId: text('user_id').notNull(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: text('status').$type<ApplicationStatus>().notNull().default('saved'),
    dateApplied: integer('date_applied'),
    appliedVia: text('applied_via'),
    referrerName: text('referrer_name'),
    referrerProfileUrl: text('referrer_profile_url'),
    referralNotes: text('referral_notes'),
    recruiterName: text('recruiter_name'),
    recruiterContact: text('recruiter_contact'),
    followUpAt: integer('follow_up_at'),
    notes: text('notes'),
    /** Append-only; sync merges rather than overwrites (FR-7.3, FR-9.5). */
    statusHistoryJson: jsonArray<StatusHistoryEntry>(),
    ...timestamps,
    syncedAt,
  },
  (t) => [
    uniqueIndex('applications_user_job_key').on(t.userId, t.jobId),
    index('applications_user_status_idx').on(t.userId, t.status),
    index('applications_follow_up_idx').on(t.userId, t.followUpAt),
  ],
);

// -- search_history_jobs ------------------------------------------------------

export const searchHistoryJobs = sqliteTable(
  'search_history_jobs',
  {
    searchId: text('search_id')
      .notNull()
      .references(() => searches.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    /** Stage-1 prefilter rank, frozen at search time (FR-5). */
    prefilterRank: integer('prefilter_rank'),
    /** True when the job came from a widened window, so history can group it (FR-4.3). */
    outsideRequestedWindow: integer('outside_requested_window', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('search_history_jobs_pk').on(t.searchId, t.jobId),
    index('search_history_jobs_job_id_idx').on(t.jobId),
    index('search_history_jobs_user_id_idx').on(t.userId),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
export type Search = typeof searches.$inferSelect;
export type NewSearch = typeof searches.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobScore = typeof jobScores.$inferSelect;
export type NewJobScore = typeof jobScores.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type SearchHistoryJob = typeof searchHistoryJobs.$inferSelect;
export type NewSearchHistoryJob = typeof searchHistoryJobs.$inferInsert;
