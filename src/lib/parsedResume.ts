/**
 * The `parsed_json` contract, mirroring `ParsedResume` in `db/schema.ts`.
 *
 * Ported from `supabase/functions/_shared/parsedResume.ts` when parsing moved
 * on-device (owner decision, 2026-08-18 — no Edge Functions in V1). The Deno
 * copy is unused while that holds; `supabase/functions` is excluded from
 * `tsconfig.json`, so the two cannot share a file without restructuring.
 *
 * Nulls are stripped so an unknown value is an absent key, never `0` or `""`
 * (hard rule 7).
 */
import type { ParsedResume } from '@db/schema';

class ShapeError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ShapeError(`${field} is not an array`);
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Keys with an undefined value are dropped so they round-trip as absent, not null. */
function compact<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T;
}

function rows<T>(
  value: unknown,
  field: string,
  map: (row: Record<string, unknown>) => T | null,
): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ShapeError(`${field} is not an array`);
  return value.filter(isObject).map(map).filter((row): row is T => row !== null);
}

/**
 * Returns null rather than throwing: one unparseable resume is a recorded
 * `parse_error` on that row, never a thrown error the caller has to catch.
 */
export function validateParsedResume(value: unknown): ParsedResume | null {
  try {
    if (!isObject(value)) throw new ShapeError('response is not an object');

    const experience = rows(value.experience, 'experience', (row) => {
      const title = optionalString(row.title);
      if (!title) return null;
      return compact({
        title,
        company: optionalString(row.company),
        months: optionalNumber(row.months),
      });
    });

    const projects = rows(value.projects, 'projects', (row) => {
      const name = optionalString(row.name);
      if (!name) return null;
      const tech = Array.isArray(row.tech)
        ? row.tech.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        : [];
      return compact({
        name,
        summary: optionalString(row.summary),
        tech: tech.length ? tech : undefined,
      });
    });

    const education = rows(value.education, 'education', (row) => {
      const degree = optionalString(row.degree);
      if (!degree) return null;
      return compact({
        degree,
        institution: optionalString(row.institution),
        year: optionalNumber(row.year),
      });
    });

    const parsed: ParsedResume = {
      skills: strings(value.skills, 'skills'),
      roles: strings(value.roles, 'roles'),
      experience,
    };
    if (projects.length) parsed.projects = projects;
    if (education.length) parsed.education = education;

    // Rev-2 fields — all optional so an older cached parse stays valid.
    const primarySkills = Array.isArray(value.primary_skills)
      ? strings(value.primary_skills, 'primary_skills')
      : [];
    if (primarySkills.length) parsed.primary_skills = primarySkills.slice(0, 8);
    const targetRoles = Array.isArray(value.target_roles)
      ? strings(value.target_roles, 'target_roles')
      : [];
    if (targetRoles.length) parsed.target_roles = targetRoles;
    const totalMonths = optionalNumber(value.total_experience_months);
    if (totalMonths !== undefined) parsed.total_experience_months = totalMonths;
    if (
      value.seniority === 'entry' ||
      value.seniority === 'mid' ||
      value.seniority === 'senior' ||
      value.seniority === 'lead'
    ) {
      parsed.seniority = value.seniority;
    }
    const currentLocation = optionalString(value.current_location);
    if (currentLocation !== undefined) parsed.current_location = currentLocation;
    const preferredLocations = Array.isArray(value.preferred_locations)
      ? strings(value.preferred_locations, 'preferred_locations')
      : [];
    if (preferredLocations.length) parsed.preferred_locations = preferredLocations;
    const noticePeriod = optionalNumber(value.notice_period_days);
    if (noticePeriod !== undefined) parsed.notice_period_days = noticePeriod;
    if (typeof value.open_to_relocate === 'boolean') {
      parsed.open_to_relocate = value.open_to_relocate;
    }

    // A resume with no skills and no experience parsed to nothing usable.
    if (parsed.skills.length === 0 && parsed.experience.length === 0) return null;

    return parsed;
  } catch {
    return null;
  }
}
