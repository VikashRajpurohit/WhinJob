import { pickCareersUrl } from '@/features/enrich/careersPage';
import { queryLocationFor } from '../locationAliases';
import {
  asRecord,
  bool,
  num,
  parseExperience,
  parseSalaryText,
  str,
  strPath,
  stripHtml,
  toEmploymentType,
  toEpoch,
  toSalaryPeriod,
  toWorkMode,
  type Raw,
} from './shared';
import type { NormalizedJob, SourceAdapter } from './types';

const DAY_MS = 86_400_000;

/**
 * `cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs` (§4.1–4.2).
 * Highest-value new source: `company.corporateLink` is the cleanest careers-page
 * seed anywhere, and `resumeKeywords` runs a free server-side keyword match.
 *
 * $0.05 actor start — by far the highest of the six — so ALL fan-out terms go
 * into one run's `keywords` array; never one run per term.
 */
export const glassdoorAdapter: SourceAdapter = {
  source: 'glassdoor',
  tier: 1,
  actorId: 'cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs',

  buildInputs: ({ filters, windowDays, perQueryLimit, terms, resumeSkills }) => [
    {
      keywords: terms,
      // `country` must be the full display name — ISO "IN" is rejected (§4.2).
      country: 'India',
      location: queryLocationFor('glassdoor', filters.location ?? null),
      datePosted: String(windowDays),
      maxItems: Math.max(perQueryLimit * 3, 120),
      saveOnlyUniqueItems: true,
      ...(resumeSkills.length > 0
        ? { resumeKeywords: resumeSkills.slice(0, 10).map((keyword) => ({ keyword })) }
        : {}),
    },
  ],

  normalize: (items) =>
    items.map((item) => normalizeOne(asRecord(item))).filter((job): job is NormalizedJob => job !== null),
};

function normalizeOne(raw: Raw): NormalizedJob | null {
  const title = str(raw, 'title', 'jobTitle', 'position');
  if (!title) return null;

  const description = stripHtml(
    str(raw, 'description', 'descriptionText', 'jobDescription', 'descriptionHtml'),
  );
  if (!description) return null;

  const isRemote = bool(raw, 'isRemote', 'remote');
  const salaryText = strPath(raw, 'salary.label', 'salary.text') ?? str(raw, 'salary', 'payRange');
  const salary = parseSalaryText(salaryText);
  const experience = parseExperience(description);

  // `ageInDays` is reliable on this actor (§3.4).
  const ageInDays = num(raw, 'ageInDays');
  const postedDate =
    ageInDays != null
      ? Date.now() - ageInDays * DAY_MS
      : toEpoch(raw.postedDate ?? raw.datePosted ?? raw.listedAt);

  return {
    title,
    companyName: strPath(raw, 'company.name', 'companyName', 'company', 'employer'),
    location: str(raw, 'location', 'jobLocation', 'formattedLocation'),
    isRemote,
    employmentType: toEmploymentType(raw.employmentType ?? raw.jobType),
    workMode: toWorkMode(raw.workplaceType ?? raw.workMode, isRemote),
    experienceMinYears: experience.min,
    experienceMaxYears: experience.max,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency ?? 'INR',
    salaryPeriod: salary.period ?? toSalaryPeriod(raw.salaryPeriod),
    salaryDisclosed: salary.min != null,
    descriptionFull: description,
    postedDate,
    applicantCount: null,
    isEarlyApplicant: null,
    isConsultantPosting: null,
    companyRating: num(raw, 'rating', 'companyRating') ?? num(asRecord(raw.company), 'rating'),
    keywordMatchPercent: num(raw, 'keywordMatchScorePercentage', 'keywordMatchScore'),
    source: 'glassdoor',
    // `applyUrl` is a tracking redirect — `jobUrl` is canonical (§4.2).
    sourceUrl: str(raw, 'jobUrl', 'url', 'link'),
    applyUrl: str(raw, 'jobUrl', 'url'),
    careersUrl: pickCareersUrl({
      corporateLink: strPath(raw, 'company.corporateLink', 'corporateLink'),
      companyWebsite: strPath(raw, 'company.website', 'company.websiteUrl'),
    }),
  };
}
