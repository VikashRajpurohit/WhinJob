import type { JobSource } from '@db/schema';

/**
 * One city, many spellings. The live runs returned eight distinct strings for
 * Bengaluru alone; without folding them, the same job dedupes into several rows
 * and Naukri returns zero rows for the fuller strings (§3.3).
 *
 * `canonical` is the storage-side form used in the dedupe key. `aliases` are the
 * inbound spellings folded onto it. `query` is the outbound per-source spelling —
 * Naukri wants the bare city, Indeed tolerates "City, State".
 */
type CityEntry = {
  canonical: string;
  aliases: string[];
  query: { default: string; naukri: string; indeed: string };
};

const CITIES: CityEntry[] = [
  {
    canonical: 'bengaluru',
    aliases: ['bangalore', 'bengaluru', 'bangalore urban', 'bengaluru east', 'bengaluru urban', 'greater bengaluru', 'bangalore city'],
    query: { default: 'Bengaluru', naukri: 'Bangalore', indeed: 'Bengaluru, Karnataka' },
  },
  {
    canonical: 'hyderabad',
    aliases: ['hyderabad', 'secunderabad', 'greater hyderabad', 'cyberabad'],
    query: { default: 'Hyderabad', naukri: 'Hyderabad', indeed: 'Hyderabad, Telangana' },
  },
  {
    canonical: 'pune',
    aliases: ['pune', 'pimpri-chinchwad', 'pimpri chinchwad', 'hinjewadi'],
    query: { default: 'Pune', naukri: 'Pune', indeed: 'Pune, Maharashtra' },
  },
  {
    canonical: 'mumbai',
    aliases: ['mumbai', 'bombay', 'navi mumbai', 'thane', 'greater mumbai', 'mumbai suburban'],
    query: { default: 'Mumbai', naukri: 'Mumbai', indeed: 'Mumbai, Maharashtra' },
  },
  {
    canonical: 'delhi ncr',
    aliases: ['delhi', 'new delhi', 'delhi ncr', 'ncr', 'delhi-ncr', 'national capital region'],
    query: { default: 'Delhi NCR', naukri: 'Delhi NCR', indeed: 'New Delhi, Delhi' },
  },
  {
    canonical: 'gurugram',
    aliases: ['gurgaon', 'gurugram'],
    query: { default: 'Gurugram', naukri: 'Gurgaon', indeed: 'Gurugram, Haryana' },
  },
  {
    canonical: 'noida',
    aliases: ['noida', 'greater noida'],
    query: { default: 'Noida', naukri: 'Noida', indeed: 'Noida, Uttar Pradesh' },
  },
  {
    canonical: 'chennai',
    aliases: ['chennai', 'madras', 'greater chennai'],
    query: { default: 'Chennai', naukri: 'Chennai', indeed: 'Chennai, Tamil Nadu' },
  },
  {
    canonical: 'kolkata',
    aliases: ['kolkata', 'calcutta'],
    query: { default: 'Kolkata', naukri: 'Kolkata', indeed: 'Kolkata, West Bengal' },
  },
  {
    canonical: 'ahmedabad',
    aliases: ['ahmedabad', 'gandhinagar'],
    query: { default: 'Ahmedabad', naukri: 'Ahmedabad', indeed: 'Ahmedabad, Gujarat' },
  },
  {
    canonical: 'jaipur',
    aliases: ['jaipur'],
    query: { default: 'Jaipur', naukri: 'Jaipur', indeed: 'Jaipur, Rajasthan' },
  },
  {
    canonical: 'kochi',
    aliases: ['kochi', 'cochin', 'ernakulam'],
    query: { default: 'Kochi', naukri: 'Kochi', indeed: 'Kochi, Kerala' },
  },
];

const clean = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function findCity(location: string): CityEntry | null {
  const lowered = clean(location);
  if (!lowered) return null;
  for (const city of CITIES) {
    if (city.aliases.some((alias) => lowered.includes(alias))) return city;
  }
  return null;
}

/**
 * Storage-side folding for the dedupe key. Unknown locations keep their first
 * comma segment, cleaned — "Bengaluru, Karnataka, India" and "bangalore" must
 * never be two different keys.
 */
export function normalizeLocation(location: string | null): string {
  if (!location) return '';
  const city = findCity(location);
  if (city) return city.canonical;
  return clean(location.split(',')[0] ?? location);
}

/** Query-side spelling for one source. Falls back to the user's own string. */
export function queryLocationFor(source: JobSource, location: string | null): string {
  if (!location) return '';
  const city = findCity(location);
  if (!city) return location;
  if (source === 'naukri') return city.query.naukri;
  if (source === 'indeed') return city.query.indeed;
  return city.query.default;
}
