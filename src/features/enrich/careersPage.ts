/**
 * Careers-page resolution (§7). Only verified URLs from the payloads are used —
 * never a domain guessed from the company name. In the live run only 3 of 22
 * companies exposed a real URL; a wrong link is worse than none.
 */

/** Hosts that are a direct apply link, which beats a homepage. */
const ATS_HOSTS = [
  'myworkdayjobs.com',
  'boards.greenhouse.io',
  'grnh.se',
  'jobs.lever.co',
  'ripplehire.com',
  'apply.workable.com',
  'smartrecruiters.com',
];

export function isAtsUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ATS_HOSTS.some((ats) => host === ats || host.endsWith(`.${ats}`));
  } catch {
    return false;
  }
}

/**
 * First verified hit wins: an explicit careers link from the payload, then a
 * resolved ATS apply link. Null means the UI hides the link entirely.
 */
export function pickCareersUrl(candidates: {
  corporateLink?: string | null;
  companyWebsite?: string | null;
  externalApplyUrl?: string | null;
}): string | null {
  if (candidates.corporateLink) return candidates.corporateLink;
  if (candidates.companyWebsite) return candidates.companyWebsite;
  if (candidates.externalApplyUrl && isAtsUrl(candidates.externalApplyUrl)) {
    return candidates.externalApplyUrl;
  }
  return null;
}
