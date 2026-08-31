import type { JobSource } from '@db/schema';
import { indeedAdapter } from './indeed';
import { linkedinAdapter } from './linkedin';
import { naukriAdapter } from './naukri';
import { glassdoorAdapter } from './glassdoor';
import { founditAdapter } from './foundit';
import type { SourceAdapter } from './types';

export const ADAPTERS: Record<JobSource, SourceAdapter> = {
  linkedin: linkedinAdapter,
  indeed: indeedAdapter,
  naukri: naukriAdapter,
  glassdoor: glassdoorAdapter,
  foundit: founditAdapter,
};

export const ALL_SOURCES: JobSource[] = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'foundit'];

/** Tier 1 always runs; Tier 2 only when Tier 1 comes up short (§4.1). */
export const TIER1_SOURCES: JobSource[] = ['linkedin', 'indeed', 'naukri', 'glassdoor'];
export const TIER2_SOURCES: JobSource[] = ['foundit'];

export const SOURCE_LABEL: Record<JobSource, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  naukri: 'Naukri',
  glassdoor: 'Glassdoor',
  foundit: 'Foundit',
};

export type { NormalizedJob, SourceAdapter, AdapterContext } from './types';
