/**
 * The `parsed_json` contract, mirroring `ParsedResume` in `db/schema.ts`.
 *
 * Two layers guard it: the schema below constrains what Claude may emit, and
 * `validateParsedResume` re-checks the result before anything is persisted. The
 * schema alone is not enough — a refusal or a truncated response still has to
 * fail cleanly rather than write a half-formed row.
 *
 * Optional fields are declared nullable rather than omitted, because strict
 * schemas require every property to be listed in `required`. Nulls are stripped
 * here so an unknown value is an absent key, never `0` or `""` (hard rule 7).
 */

export type ParsedResume = {
  skills: string[];
  roles: string[];
  experience: { title: string; company?: string; months?: number }[];
  projects?: { name: string; summary?: string }[];
  education?: { degree: string; institution?: string; year?: number }[];
};

const nullableString = { type: ['string', 'null'] } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;

export const parsedResumeSchema = {
  type: 'object',
  properties: {
    skills: { type: 'array', items: { type: 'string' } },
    roles: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: nullableString,
          months: nullableInteger,
        },
        required: ['title', 'company', 'months'],
        additionalProperties: false,
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, summary: nullableString },
        required: ['name', 'summary'],
        additionalProperties: false,
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          degree: { type: 'string' },
          institution: nullableString,
          year: nullableInteger,
        },
        required: ['degree', 'institution', 'year'],
        additionalProperties: false,
      },
    },
  },
  required: ['skills', 'roles', 'experience', 'projects', 'education'],
  additionalProperties: false,
} as const;

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

function rows<T>(value: unknown, field: string, map: (row: Record<string, unknown>) => T | null): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ShapeError(`${field} is not an array`);
  return value.filter(isObject).map(map).filter((row): row is T => row !== null);
}

/**
 * Returns null rather than throwing: one unparseable resume is a recorded
 * `parse_error` on that row, never a failed batch.
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
      return compact({ name, summary: optionalString(row.summary) });
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

    // A resume with no skills and no experience parsed to nothing usable.
    if (parsed.skills.length === 0 && parsed.experience.length === 0) return null;

    return parsed;
  } catch {
    return null;
  }
}
