import { queryLocationFor } from '../locationAliases';
import {
  asRecord,
  bool,
  parseApplicantCount,
  parseExperience,
  parseSalaryText,
  str,
  stripHtml,
  toEmploymentType,
  toEpoch,
  toSalaryPeriod,
  toWorkMode,
  type Raw,
} from './shared';
import type { NormalizedJob, SourceAdapter } from './types';

/**
 * Confirmed by live runs: `datePosted` takes relative seconds codes, not human
 * strings like "Past week". Passing "Past week" is accepted and silently ignored,
 * which is why this maps explicitly and falls back to the widest bucket.
 */
function datePostedCode(windowDays: number): string {
  if (windowDays <= 1) return 'r86400';
  if (windowDays <= 7) return 'r604800';
  return 'r2592000';
}

export const linkedinAdapter: SourceAdapter = {
  source: 'linkedin',
  tier: 1,
  actorId: 'valig/linkedin-jobs-scraper',

  // §4.3: the row-count field is `limit` (not `rows`) and the remote field is
  // `remote`, an array of "1"|"2"|"3" (not `workplaceType`) — the previous
  // names were accepted and silently ignored. One run per fan-out term.
  buildInputs: ({ filters, windowDays, perQueryLimit, terms }) =>
    terms.map((term) => ({
      title: term,
      location: queryLocationFor('linkedin', filters.location ?? null),
      datePosted: datePostedCode(windowDays),
      limit: perQueryLimit,
      ...(filters.work_mode === 'remote' ? { remote: ['2'] } : {}),
    })),

  normalize: (items) =>
    items.map((item) => normalizeOne(asRecord(item))).filter((job): job is NormalizedJob => job !== null),
};

function normalizeOne(raw: Raw): NormalizedJob | null {
  const title = str(raw, 'title', 'jobTitle', 'position');
  if (!title) return null;

  const description = stripHtml(
    str(raw, 'descriptionText', 'description', 'jobDescription', 'descriptionHtml'),
  );
  // FR-5.2 prefilters on description content — a job without one is unusable.
  if (!description) return null;

  const isRemote = bool(raw, 'isRemote', 'remote');
  const salaryText = str(raw, 'salary', 'salaryInfo', 'compensation');
  const salary = parseSalaryText(salaryText);
  const experience = parseExperience(description);
  const applicants = parseApplicantCount(raw.applicationsCount ?? raw.applicantsCount ?? raw.applicantCount);

  return {
    title,
    companyName: str(raw, 'companyName', 'company', 'organization'),
    location: str(raw, 'location', 'jobLocation', 'formattedLocation'),
    isRemote,
    employmentType: toEmploymentType(raw.employmentType ?? raw.jobType ?? raw.contractType),
    workMode: toWorkMode(raw.workplaceType ?? raw.workMode, isRemote),
    experienceMinYears: experience.min,
    experienceMaxYears: experience.max,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period ?? toSalaryPeriod(raw.salaryPeriod),
    salaryDisclosed: salary.min != null,
    descriptionFull: description,
    // `postedDate` is midnight-granular — never compute hours from it (§4.2).
    postedDate: toEpoch(raw.postedAt ?? raw.publishedAt ?? raw.postedDate ?? raw.listedAt),
    applicantCount: applicants.count,
    isEarlyApplicant: applicants.isEarlyApplicant,
    isConsultantPosting: null,
    companyRating: null,
    keywordMatchPercent: null,
    source: 'linkedin',
    sourceUrl: str(raw, 'jobUrl', 'url', 'link'),
    // `applyUrl` comes back empty on most rows; fall back to `url` (§4.2).
    applyUrl: str(raw, 'applyUrl', 'applicationUrl', 'jobUrl', 'url'),
    careersUrl: null,
  };
}
