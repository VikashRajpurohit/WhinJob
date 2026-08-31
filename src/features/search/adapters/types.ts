import type {
  EmploymentType,
  JobSource,
  SalaryPeriod,
  SearchFilters,
  WorkMode,
} from '@db/schema';

/**
 * What an adapter produces: everything a job row needs except the identity and
 * bookkeeping columns, which the writer owns (id, userId, dedupeKey, seen-at).
 */
export type NormalizedJob = {
  title: string;
  companyName: string | null;
  location: string | null;
  isRemote: boolean | null;
  employmentType: EmploymentType | null;
  workMode: WorkMode | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryDisclosed: boolean;
  descriptionFull: string;
  postedDate: number | null;
  applicantCount: number | null;
  isEarlyApplicant: boolean | null;
  isConsultantPosting: boolean | null;
  companyRating: number | null;
  /** Glassdoor's free server-side resume keyword match, when the actor ran one. */
  keywordMatchPercent: number | null;
  source: JobSource;
  sourceUrl: string | null;
  applyUrl: string | null;
  careersUrl: string | null;
};

export type AdapterContext = {
  filters: SearchFilters;
  /** The window actually being crawled, which may be wider than requested (FR-4.3). */
  windowDays: number;
  /** Rows requested per actor run (§3.2 PER_QUERY_LIMIT). */
  perQueryLimit: number;
  /** Fan-out terms, literal user input first (§3.2). */
  terms: string[];
  /** Parsed-resume skills for actors that run a free server-side keyword match. */
  resumeSkills: string[];
};

/**
 * One adapter per source: buildInputs → run(s) → normalize → Job[]. Adding a
 * source means adding an adapter, never touching the pipeline.
 *
 * `buildInputs` returns one entry per actor run — per-term for most actors, a
 * single batched run where the actor takes a keywords array (Glassdoor charges
 * $0.05 per actor start, so never one run per term there — §4.2).
 */
export type SourceAdapter = {
  source: JobSource;
  tier: 1 | 2;
  actorId: string;
  buildInputs: (context: AdapterContext) => Record<string, unknown>[];
  /**
   * Relaxed retry for actors where a filter combination silently returns zero
   * rows (§4.2 Naukri). Null means no relaxation applies to this input.
   */
  relaxInput?: (input: Record<string, unknown>) => Record<string, unknown> | null;
  /** Dataset projection, sent as `fields=` — mandatory for wide actors (§A.3). */
  datasetFields?: string[];
  normalize: (items: unknown[]) => NormalizedJob[];
};
