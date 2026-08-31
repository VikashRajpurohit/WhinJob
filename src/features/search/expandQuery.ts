import { eq } from 'drizzle-orm';
import { db } from '@db/client';
import {
  resumes,
  type ParsedResume,
  type QueryExpansion,
  type SearchFilters,
} from '@db/schema';
import { complete, extractJson } from '@/lib/bedrock';
import type { ProviderCredentials } from '@/features/settings/settingsStore';
import { now } from '@/lib/time';

/** Six terms is where marginal new jobs per rupee falls off hard (§3.2). */
export const FANOUT_TERMS_MAX = 6;

const EXPAND_MAX_TOKENS = 2_000;

const EXPAND_SYSTEM = `You generate job-board search queries.

Given a candidate profile and their search filters, return ONLY a JSON object,
no prose and no code fence:

{
  "terms": [{ "term": string, "why": string, "precision": "high"|"medium"|"low" }],
  "location_aliases": [string],
  "disqualifier_titles": [string]
}

Return between four and six terms, ordered most precise first. Term one must be
the user's literal input, unchanged, marked "high".

Cover these categories, at most two terms each, and only where the profile
supports them:

1. Orthographic variants of the core technology — spaced, closed-compound and
   hyphenated forms. Job boards match these as different strings, so a candidate
   whose stack is written one way in the query will not surface titles written
   the other way.
2. The role family one level more general than the input, where a posting in that
   family would still be a real fit.
3. The levelled title forms matching the candidate's seniority, as large
   employers title by level rather than by stack.
4. An adjacent-discipline title, but ONLY when the candidate's stated experience
   would make them a credible applicant for it. Omit this category entirely
   rather than reaching.

"precision" is your estimate of how many returned jobs will be genuinely
relevant: high is nearly all, medium is about half, low is a minority worth
scanning. Mark a term "low" rather than dropping it when it is broad but likely
to surface postings the precise terms cannot reach.

"location_aliases" lists every spelling and administrative variant a job board
might use for the requested city, most canonical first. Include the bare city
name, since some boards reject fuller strings.

"disqualifier_titles" lists title fragments that indicate a posting is
categorically wrong for this candidate's level — for example internship or
trainee postings for an experienced candidate. Return an empty array if none
apply.

Every term must be a phrase a person would actually type into a job board. No
boolean operators, no quotation marks, no wildcards.`;

/**
 * Orthographic variants computed locally — the single largest recall win in the
 * whole design (§3.1), and it must work even with no Bedrock key. "React Native
 * Developer" also becomes "ReactNative Developer" and "React-Native Developer";
 * "ReactNative Developer" also becomes the spaced form.
 */
export function localTermVariants(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const variants = new Set<string>([trimmed]);
  const words = trimmed.split(/\s+/);

  if (words.length >= 2) {
    const rest = words.slice(2).join(' ');
    const joined = `${words[0]}${words[1]}${rest ? ` ${rest}` : ''}`;
    const hyphenated = `${words[0]}-${words[1]}${rest ? ` ${rest}` : ''}`;
    variants.add(joined);
    variants.add(hyphenated);
  }

  // Split closed compounds written in camel case ("ReactNative" → "React Native")
  // and hyphenated forms back to spaced.
  const spaced = trimmed
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  variants.add(spaced);

  const seen = new Set<string>();
  return [...variants].filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Stable, cheap key over the inputs that actually change the expansion. */
function expansionKeyFor(filters: SearchFilters, resume: ParsedResume | null): string {
  const material = JSON.stringify({
    title: filters.title ?? '',
    location: filters.location ?? '',
    skills: resume?.primary_skills ?? resume?.skills?.slice(0, 8) ?? [],
    seniority: resume?.seniority ?? null,
  });
  let hash = 5381;
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0;
  }
  return `v1:${hash}`;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
    : [];

function validateExpansion(payload: unknown, literalInput: string): QueryExpansion | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const terms = (Array.isArray(raw.terms) ? raw.terms : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const t = entry as Record<string, unknown>;
      if (typeof t.term !== 'string' || !t.term.trim()) return null;
      const precision =
        t.precision === 'high' || t.precision === 'medium' || t.precision === 'low'
          ? t.precision
          : 'medium';
      return {
        term: t.term.trim(),
        why: typeof t.why === 'string' ? t.why : '',
        precision,
      };
    })
    .filter((t): t is QueryExpansion['terms'][number] => t !== null);

  if (terms.length === 0) return null;

  // Term one must be the user's literal input — never drop what they typed.
  if (literalInput && !terms.some((t) => t.term.toLowerCase() === literalInput.toLowerCase())) {
    terms.unshift({ term: literalInput, why: 'literal user input', precision: 'high' });
  }

  return {
    terms: terms.slice(0, FANOUT_TERMS_MAX),
    location_aliases: asStrings(raw.location_aliases),
    disqualifier_titles: asStrings(raw.disqualifier_titles),
  };
}

export type ExpandedQuery = {
  /** Deduped, capped at FANOUT_TERMS_MAX, literal input always first. */
  terms: string[];
  disqualifierTitles: string[];
  usedModel: boolean;
};

/**
 * The full fan-out for one search. Model expansion is cached on the resume row
 * and re-runs only when the resume or core filters change — one model call per
 * resume, not per search (§5 step 2). With no credentials, or on any model
 * failure, the local orthographic variants still run: recall never depends on
 * the model being reachable.
 */
export async function getExpandedQuery(args: {
  resumeId: string;
  resume: ParsedResume | null;
  filters: SearchFilters;
  credentials: ProviderCredentials | null;
  modelId: string | null;
}): Promise<ExpandedQuery> {
  const literal = (args.filters.title ?? '').trim();
  const local = localTermVariants(literal);

  let expansion: QueryExpansion | null = null;
  let usedModel = false;

  const key = expansionKeyFor(args.filters, args.resume);
  const row = (
    await db
      .select({ expansionKey: resumes.expansionKey, expansionJson: resumes.expansionJson })
      .from(resumes)
      .where(eq(resumes.id, args.resumeId))
      .limit(1)
  )[0];

  if (row?.expansionKey === key && row.expansionJson) {
    expansion = row.expansionJson;
    usedModel = true;
  } else if (args.credentials && args.modelId && args.resume) {
    try {
      const userText = [
        '<profile>',
        JSON.stringify({
          primary_skills: args.resume.primary_skills ?? args.resume.skills.slice(0, 8),
          seniority: args.resume.seniority ?? null,
          total_experience_months: args.resume.total_experience_months ?? null,
          target_roles: args.resume.target_roles ?? args.resume.roles,
        }),
        '</profile>',
        '',
        '<filters>',
        JSON.stringify({
          query: literal,
          location: args.filters.location ?? '',
          work_mode: args.filters.work_mode ?? 'any',
        }),
        '</filters>',
      ].join('\n');

      const { raw } = await complete(
        args.credentials,
        args.modelId,
        EXPAND_SYSTEM,
        userText,
        EXPAND_MAX_TOKENS,
      );
      expansion = validateExpansion(extractJson(raw), literal);
      if (expansion) {
        usedModel = true;
        await db
          .update(resumes)
          .set({ expansionKey: key, expansionJson: expansion, updatedAt: now() })
          .where(eq(resumes.id, args.resumeId));
      }
    } catch {
      // Expansion is an upgrade, never a dependency — fall back to local variants.
    }
  }

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of [literal, ...local, ...(expansion?.terms.map((t) => t.term) ?? [])]) {
    const lowered = term.toLowerCase();
    if (!term || seen.has(lowered)) continue;
    seen.add(lowered);
    terms.push(term);
    if (terms.length >= FANOUT_TERMS_MAX) break;
  }

  return {
    terms: terms.length > 0 ? terms : [literal || ''].filter(Boolean),
    disqualifierTitles: expansion?.disqualifier_titles ?? [],
    usedModel,
  };
}
