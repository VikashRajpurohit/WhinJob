import type { Job, MatchBand, SalaryPeriod } from '@db/schema';

/**
 * Missing data renders as "N/A", never 0 or an empty string (hard rule 7).
 * Undisclosed salary is a distinct state from out-of-range, so it gets its own label.
 */
export const NOT_AVAILABLE = 'N/A';
export const SALARY_UNDISCLOSED = 'Not disclosed';

const PERIOD_SUFFIX: Record<SalaryPeriod, string> = {
  year: '/yr',
  month: '/mo',
  week: '/wk',
  day: '/day',
  hour: '/hr',
};

function compact(amount: number, currency: string): string {
  const formatted =
    amount >= 10_000_000
      ? `${(amount / 10_000_000).toFixed(1).replace(/\.0$/, '')}Cr`
      : amount >= 100_000
        ? `${(amount / 100_000).toFixed(1).replace(/\.0$/, '')}L`
        : amount >= 1_000
          ? `${(amount / 1_000).toFixed(0)}K`
          : `${amount}`;
  return `${currency}${formatted}`;
}

export function formatSalary(
  job: Pick<
    Job,
    'salaryDisclosed' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
  >,
): string {
  if (!job.salaryDisclosed) return SALARY_UNDISCLOSED;
  if (job.salaryMin == null && job.salaryMax == null) return SALARY_UNDISCLOSED;

  const currency = job.salaryCurrency === 'INR' ? '₹' : (job.salaryCurrency ?? '');
  const suffix = job.salaryPeriod ? PERIOD_SUFFIX[job.salaryPeriod] : '';

  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax) {
    return `${compact(job.salaryMin, currency)} – ${compact(job.salaryMax, currency)}${suffix}`;
  }
  const single = job.salaryMin ?? job.salaryMax;
  return single == null ? SALARY_UNDISCLOSED : `${compact(single, currency)}${suffix}`;
}

export function formatExperience(
  job: Pick<Job, 'experienceMinYears' | 'experienceMaxYears'>,
): string {
  const { experienceMinYears: min, experienceMaxYears: max } = job;
  if (min == null && max == null) return NOT_AVAILABLE;
  if (min != null && max != null) return `${min}–${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

export function formatPostedDate(postedDate: number | null): string {
  if (postedDate == null) return NOT_AVAILABLE;
  const days = Math.floor((Date.now() - postedDate) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatApplicantCount(count: number | null): string {
  return count == null ? NOT_AVAILABLE : `${count} applicant${count === 1 ? '' : 's'}`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return NOT_AVAILABLE;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Absolute date for anything the user might need to identify later. */
export function formatDate(epochMs: number | null): string {
  if (epochMs == null) return NOT_AVAILABLE;
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const BAND_LABEL: Record<MatchBand, string> = {
  strong: 'Strong',
  good: 'Good',
  stretch: 'Stretch',
  weak: 'Weak',
};

/**
 * Low applicant counts are the highest-actionability signal in the dataset (FR-6.2),
 * so they get their own band rather than being buried in a raw number.
 */
export function responseOdds(count: number | null): 'high' | 'moderate' | 'low' | null {
  if (count == null) return null;
  if (count <= 25) return 'high';
  if (count <= 100) return 'moderate';
  return 'low';
}
