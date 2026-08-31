import { pickCareersUrl } from '@/features/enrich/careersPage';
import { queryLocationFor } from '../locationAliases';
import {
  asRecord,
  bool,
  getPath,
  num,
  parseExperience,
  parseSalaryText,
  strPath,
  stripHtml,
  toEmploymentType,
  toEpoch,
  toSalaryPeriod,
  toWorkMode,
  type Raw,
} from './shared';
import type { NormalizedJob, SourceAdapter } from './types';

/**
 * `kaix/indeed-scraper` (§4.1): 8× cheaper than the previous actor, and its
 * `urls.external` is a resolved ATS apply link — the highest-value field any
 * provider returns. `country: "IN"` uppercase works on THIS actor; the
 * lowercase-only rule applied to `valig/indeed-jobs-scraper`. Re-verify if the
 * actor is ever swapped.
 */
export const indeedAdapter: SourceAdapter = {
  source: 'indeed',
  tier: 1,
  actorId: 'kaix/indeed-scraper',

  buildInputs: ({ filters, windowDays, perQueryLimit, terms }) =>
    terms.map((term) => ({
      keyword: term,
      location: queryLocationFor('indeed', filters.location ?? null),
      country: 'IN',
      maxItems: perQueryLimit,
      fromDays: String(windowDays),
      sort: 'date',
      ...(filters.work_mode === 'remote' ? { remote: true } : {}),
    })),

  // 340 output fields — without a projection the response budget goes to
  // `classification.attributes.all.*` taxonomy codes (§4.2).
  datasetFields: [
    'title',
    'positionName',
    'company',
    'companyName',
    'description',
    'descriptionText',
    'descriptionHtml',
    'snippet',
    'location',
    'salary',
    'baseSalary_min',
    'baseSalary_max',
    'jobType',
    'employmentType',
    'remoteWorkModel',
    'postedAt',
    'datePublished',
    'dates',
    'urls',
    'url',
    'applyUrl',
  ],

  normalize: (items) =>
    items.map((item) => normalizeOne(asRecord(item))).filter((job): job is NormalizedJob => job !== null),
};

function normalizeOne(raw: Raw): NormalizedJob | null {
  const title = strPath(raw, 'title', 'positionName', 'title.text', 'jobTitle');
  if (!title) return null;

  const description = stripHtml(
    strPath(raw, 'description', 'descriptionText', 'description.text', 'descriptionHtml', 'snippet'),
  );
  if (!description) return null;

  const isRemote = bool(raw, 'remoteWorkModel', 'isRemote', 'remote');
  const salaryText = strPath(raw, 'salary.label', 'salary.text', 'salary', 'salaryText');
  const salary = parseSalaryText(salaryText);
  const experience = parseExperience(description);

  const externalApplyUrl = strPath(raw, 'urls.external', 'externalApplyLink', 'applyUrl');
  const canonicalUrl = strPath(raw, 'urls.desktop', 'url', 'jobUrl', 'link');

  return {
    title,
    companyName: strPath(raw, 'company.name', 'companyName', 'company', 'employer'),
    location: strPath(raw, 'location.formattedAddressShort', 'location', 'formattedLocation'),
    isRemote,
    employmentType: toEmploymentType(raw.jobType ?? raw.employmentType),
    workMode: toWorkMode(raw.remoteWorkModel ?? raw.workMode, isRemote),
    experienceMinYears: experience.min,
    experienceMaxYears: experience.max,
    salaryMin: salary.min ?? num(raw, 'baseSalary_min'),
    salaryMax: salary.max ?? num(raw, 'baseSalary_max'),
    salaryCurrency: salary.currency ?? 'INR',
    salaryPeriod: salary.period ?? toSalaryPeriod(raw.salaryPeriod),
    salaryDisclosed: salary.min != null || num(raw, 'baseSalary_min') != null,
    descriptionFull: description,
    postedDate: toEpoch(
      getPath(raw, 'dates.posted') ?? raw.postedAt ?? raw.datePublished ?? raw.date,
    ),
    applicantCount: num(raw, 'applicantCount', 'applicationCount'),
    isEarlyApplicant: null,
    isConsultantPosting: null,
    companyRating: num(raw, 'rating') ?? num(asRecord(raw.company), 'rating'),
    keywordMatchPercent: null,
    source: 'indeed',
    sourceUrl: canonicalUrl,
    // Applying at the ATS beats applying through the portal (§4.2).
    applyUrl: externalApplyUrl ?? canonicalUrl,
    careersUrl: pickCareersUrl({
      companyWebsite: strPath(raw, 'company.urls.website', 'company.websiteUrl'),
      externalApplyUrl,
    }),
  };
}
