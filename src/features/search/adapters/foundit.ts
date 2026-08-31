import {
  asRecord,
  bool,
  num,
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
import { normalizeLocation } from '../locationAliases';
import type { NormalizedJob, SourceAdapter } from './types';

const DAY_MS = 86_400_000;

/**
 * `themineworks/foundit-jobs-scraper` — Tier 2 (§4.1): inventory is genuinely
 * thin (1 real row against LinkedIn's 50 in the live run), so it runs only when
 * Tier 1 comes up short. Two quirks: a status row is mixed into the dataset
 * (`_type`, `jobs_scraped`, `message` — no title), and `posted_date_text`
 * disagrees with `posted_days_ago`; trust the integer (§4.2).
 */
export const founditAdapter: SourceAdapter = {
  source: 'foundit',
  tier: 2,
  actorId: 'themineworks/foundit-jobs-scraper',

  buildInputs: ({ filters, windowDays, terms }) => [
    {
      searchKeywords: terms.map((t) => t.toLowerCase()),
      location: normalizeLocation(filters.location ?? null) || (filters.location ?? ''),
      postedWithinDays: String(windowDays),
      maxJobs: 25,
      ...(filters.experience_min_years != null
        ? { experienceMinYears: filters.experience_min_years }
        : {}),
      ...(filters.experience_max_years != null
        ? { experienceMaxYears: filters.experience_max_years }
        : {}),
    },
  ],

  normalize: (items) =>
    items.map((item) => normalizeOne(asRecord(item))).filter((job): job is NormalizedJob => job !== null),
};

function normalizeOne(raw: Raw): NormalizedJob | null {
  // Rows without a title include the actor's own status row — never a job.
  const title = str(raw, 'title', 'jobTitle', 'position');
  if (!title) return null;

  const description = stripHtml(
    str(raw, 'description', 'jobDescription', 'descriptionText', 'descriptionHtml'),
  );
  if (!description) return null;

  const isRemote = bool(raw, 'isRemote', 'remote');
  const salary = parseSalaryText(str(raw, 'salary', 'salaryText', 'package'));
  const experience = parseExperience(
    str(raw, 'experience', 'experienceText') ?? description,
  );

  const postedDaysAgo = num(raw, 'posted_days_ago', 'postedDaysAgo');
  const postedDate =
    postedDaysAgo != null
      ? Date.now() - postedDaysAgo * DAY_MS
      : toEpoch(raw.posted_date ?? raw.postedDate ?? raw.posted_date_text);

  return {
    title,
    companyName: str(raw, 'company', 'companyName', 'employer'),
    location: str(raw, 'location', 'jobLocation'),
    isRemote,
    employmentType: toEmploymentType(raw.employmentType ?? raw.jobType),
    workMode: toWorkMode(raw.workMode, isRemote),
    experienceMinYears: experience.min ?? num(raw, 'experience_min_years', 'minExperience'),
    experienceMaxYears: experience.max ?? num(raw, 'experience_max_years', 'maxExperience'),
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency ?? 'INR',
    salaryPeriod: salary.period ?? toSalaryPeriod(raw.salaryPeriod),
    salaryDisclosed: salary.min != null,
    descriptionFull: description,
    postedDate,
    applicantCount: num(raw, 'total_applicants', 'applicantCount'),
    isEarlyApplicant: null,
    isConsultantPosting: null,
    companyRating: num(raw, 'companyRating', 'rating'),
    keywordMatchPercent: null,
    source: 'foundit',
    sourceUrl: str(raw, 'url', 'jobUrl', 'link'),
    applyUrl: str(raw, 'applyUrl', 'url', 'jobUrl'),
    careersUrl: null,
  };
}
