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

/** `jobAge` is a STRING enum "1"|"3"|"7"|"15"|"30" — integer 3 is rejected (§4.2). */
function jobAgeFor(windowDays: number): string {
  if (windowDays <= 1) return '1';
  if (windowDays <= 3) return '3';
  if (windowDays <= 7) return '7';
  if (windowDays <= 15) return '15';
  return '30';
}

/**
 * `valig/naukri-jobs-scraper` (§4.1) — best CTC coverage of the six sources.
 * Quirks from live runs: location must be the bare city ("Bangalore" — full
 * addresses return nothing), `sort: "date"` is rejected outright, and combining
 * `experience` with `jobAge` returned zero rows on a query that returned forty
 * unfiltered. The freshness filter is advisory on every source; `runSearch`
 * applies the real date cutoff client-side.
 */
export const naukriAdapter: SourceAdapter = {
  source: 'naukri',
  tier: 1,
  actorId: 'valig/naukri-jobs-scraper',

  buildInputs: ({ filters, windowDays, perQueryLimit, terms }) =>
    terms.map((term) => ({
      keywords: term.toLowerCase(),
      location: queryLocationFor('naukri', filters.location ?? null),
      jobAge: jobAgeFor(windowDays),
      limit: perQueryLimit,
      // `experience` only when the user explicitly set it — see relaxInput.
      ...(filters.experience_min_years != null
        ? { experience: filters.experience_min_years }
        : {}),
    })),

  // A filtered query returning zero rows means "the filter combination broke",
  // not "no jobs exist" — retry once without the experience filter (§4.2).
  relaxInput: (input) => {
    if (!('experience' in input)) return null;
    const relaxed = { ...input };
    delete relaxed.experience;
    return relaxed;
  },

  normalize: (items) =>
    items.map((item) => normalizeOne(asRecord(item))).filter((job): job is NormalizedJob => job !== null),
};

function normalizeOne(raw: Raw): NormalizedJob | null {
  const title = str(raw, 'title', 'jobTitle', 'designation');
  if (!title) return null;

  const description = stripHtml(
    str(raw, 'jobDescription', 'description', 'descriptionText', 'jobDetails'),
  );
  if (!description) return null;

  const isRemote = bool(raw, 'isRemote', 'remote', 'wfh');
  // `salary.label` is a human string ("12-22 Lacs", "Not Disclosed") — parsed,
  // never rendered raw (§4.2).
  const salaryText = strPath(raw, 'salary.label', 'salary.text') ?? str(raw, 'salary', 'salaryDetail', 'ctc', 'package');
  const salary = parseSalaryText(salaryText);

  // Naukri exposes experience as its own field far more often than in prose.
  const expText = strPath(raw, 'experience.label', 'experience.text') ?? str(raw, 'experience', 'experienceRange', 'exp') ?? '';
  const parsedExp = parseExperience(expText || description);

  return {
    title,
    companyName: strPath(raw, 'companyName', 'company.name', 'company', 'employerName'),
    location: strPath(raw, 'location', 'jobLocation', 'placeholders.location'),
    isRemote,
    employmentType: toEmploymentType(raw.employmentType ?? raw.jobType),
    workMode: toWorkMode(raw.workMode ?? raw.workFromHomeType, isRemote),
    experienceMinYears: parsedExp.min ?? num(raw, 'minExperience'),
    experienceMaxYears: parsedExp.max ?? num(raw, 'maxExperience'),
    salaryMin: salary.min ?? num(raw, 'minSalary'),
    salaryMax: salary.max ?? num(raw, 'maxSalary'),
    salaryCurrency: salary.currency ?? 'INR',
    salaryPeriod: salary.period ?? toSalaryPeriod(raw.salaryPeriod) ?? 'year',
    salaryDisclosed: salary.min != null || num(raw, 'minSalary') != null,
    descriptionFull: description,
    // `createdDate` is sometimes 0 and sometimes contradicts the text — prefer
    // `createdDateText` (§4.2).
    postedDate: toEpoch(
      raw.createdDateText ?? raw.postedDate ?? raw.footerPlaceholderLabel ?? raw.createdDate,
    ),
    applicantCount: num(raw, 'applicantCount', 'applyCount'),
    isEarlyApplicant: null,
    // `consultant: true` means a staffing intermediary — surface it (§4.2).
    isConsultantPosting: bool(raw, 'consultant', 'isConsultant'),
    companyRating: num(raw, 'ambitionBoxRating', 'companyRating', 'rating'),
    keywordMatchPercent: null,
    source: 'naukri',
    sourceUrl: str(raw, 'jdURL', 'url', 'jobUrl'),
    applyUrl: str(raw, 'applyUrl', 'jdURL', 'url'),
    careersUrl: null,
  };
}
