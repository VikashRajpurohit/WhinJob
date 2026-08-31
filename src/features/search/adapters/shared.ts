import type { EmploymentType, SalaryPeriod, WorkMode } from '@db/schema';

/**
 * Scraper output is untyped and inconsistent between runs, so every read goes
 * through a coercion here rather than trusting a field's declared shape.
 */
export type Raw = Record<string, unknown>;

export const asRecord = (value: unknown): Raw =>
  value && typeof value === 'object' ? (value as Raw) : {};

/** Reads a dotted path ("company.urls.website") off untyped scraper output. */
export function getPath(raw: Raw, path: string): unknown {
  let current: unknown = raw;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Raw)[segment];
  }
  return current;
}

/** First non-empty string among several candidate keys, dotted paths allowed. */
export function strPath(raw: Raw, ...paths: string[]): string | null {
  for (const path of paths) {
    const value = getPath(raw, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * LinkedIn's `applicationsCount` is a string — "131 applicants", "Over 200
 * applicants", "Be among the first 25 applicants". The "first N" case is the
 * highest-value timing signal in the system (§4.2).
 */
export function parseApplicantCount(value: unknown): {
  count: number | null;
  isEarlyApplicant: boolean | null;
} {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { count: value, isEarlyApplicant: null };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { count: null, isEarlyApplicant: null };
  }
  const early = /first\s+\d+/i.test(value) || /be among/i.test(value);
  const match = value.match(/(\d[\d,]*)/);
  const count = match ? Number(match[1]!.replace(/,/g, '')) : null;
  return {
    count: Number.isFinite(count ?? NaN) ? count : null,
    isEarlyApplicant: early ? true : count != null ? false : null,
  };
}

/** First non-empty string among several candidate keys. */
export function str(raw: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function num(raw: Raw, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(parsed) && value.trim()) return parsed;
    }
  }
  return null;
}

export function bool(raw: Raw, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return null;
}

/** Epoch ms from an ISO string, an epoch number, or a "3 days ago" phrase. */
export function toEpoch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds vs milliseconds — anything below this threshold is seconds.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const relative = value.match(/(\d+)\s*(hour|day|week|month)/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const ms =
      unit === 'hour'
        ? 3_600_000
        : unit === 'day'
          ? 86_400_000
          : unit === 'week'
            ? 604_800_000
            : 2_592_000_000;
    return Date.now() - amount * ms;
  }
  if (/just posted|today|new/i.test(value)) return Date.now();

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  'full-time': 'full_time',
  'full time': 'full_time',
  fulltime: 'full_time',
  permanent: 'full_time',
  'part-time': 'part_time',
  'part time': 'part_time',
  contract: 'contract',
  contractual: 'contract',
  freelance: 'contract',
  internship: 'internship',
  intern: 'internship',
  temporary: 'temporary',
  temp: 'temporary',
};

export function toEmploymentType(value: unknown): EmploymentType | null {
  if (typeof value !== 'string') return null;
  return EMPLOYMENT_MAP[value.trim().toLowerCase()] ?? null;
}

export function toWorkMode(value: unknown, isRemote: boolean | null): WorkMode | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized.includes('remote')) return 'remote';
    if (normalized.includes('hybrid')) return 'hybrid';
    if (normalized.includes('on-site') || normalized.includes('onsite')) return 'onsite';
  }
  if (isRemote === true) return 'remote';
  return null;
}

const PERIOD_MAP: Record<string, SalaryPeriod> = {
  yearly: 'year',
  annually: 'year',
  annual: 'year',
  year: 'year',
  yr: 'year',
  monthly: 'month',
  month: 'month',
  mo: 'month',
  weekly: 'week',
  week: 'week',
  daily: 'day',
  day: 'day',
  hourly: 'hour',
  hour: 'hour',
  hr: 'hour',
};

export function toSalaryPeriod(value: unknown): SalaryPeriod | null {
  if (typeof value !== 'string') return null;
  return PERIOD_MAP[value.trim().toLowerCase()] ?? null;
}

/**
 * Salary text like "₹12,00,000 - ₹18,00,000 a year". Undisclosed stays
 * undisclosed — never coerced to 0 (hard rule 7).
 */
export function parseSalaryText(text: string | null): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
} {
  if (!text) return { min: null, max: null, currency: null, period: null };

  const currency = /₹|inr/i.test(text)
    ? 'INR'
    : /\$|usd/i.test(text)
      ? 'USD'
      : /£|gbp/i.test(text)
        ? 'GBP'
        : /€|eur/i.test(text)
          ? 'EUR'
          : null;

  const period = /year|annum|yr|pa\b/i.test(text)
    ? 'year'
    : /month|mo\b/i.test(text)
      ? 'month'
      : /week/i.test(text)
        ? 'week'
        : /day/i.test(text)
          ? 'day'
          : /hour|hr\b/i.test(text)
            ? 'hour'
            : null;

  const scale = /lakh|lpa|\blac\b/i.test(text) ? 100_000 : /crore|\bcr\b/i.test(text) ? 10_000_000 : 1;

  const numbers = (text.match(/\d[\d,.]*/g) ?? [])
    .map((n) => Number(n.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => n * scale);

  if (numbers.length === 0) return { min: null, max: null, currency, period };
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);

  // Live-data trap: "₹4.00/yr - ₹6.00/yr" is a recruiter typing LPA into a
  // rupee field. An annual band under ₹50,000 is a data error, not a salary —
  // undisclosed beats showing the user a ₹4/year job (§7).
  if ((currency === 'INR' || currency === null) && period === 'year' && max < 50_000 && scale === 1) {
    return { min: null, max: null, currency, period };
  }

  return { min, max: max === min ? null : max, currency, period };
}

/** Strips HTML so the description is matchable text, not markup (FR-5.2). */
export function stripHtml(value: string | null): string {
  if (!value) return '';
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Years of experience from free text, e.g. "3-5 years" or "5+ years". */
export function parseExperience(text: string): {
  min: number | null;
  max: number | null;
} {
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*\+?\s*(?:years?|yrs?)/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = text.match(/(\d+)\s*\+\s*(?:years?|yrs?)/i);
  if (single) return { min: Number(single[1]), max: null };
  const plain = text.match(/(?:minimum|at least)\s*(\d+)\s*(?:years?|yrs?)/i);
  if (plain) return { min: Number(plain[1]), max: null };
  return { min: null, max: null };
}
