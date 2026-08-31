import { and, eq } from 'drizzle-orm';
import { db } from '@db/client';
import {
  jobScores,
  MATCH_BANDS,
  type ApplyKit,
  type DeepAnalysis,
  type Job,
  type JobScore,
  type MatchBand,
  type ParsedResume,
  type ScoreComponents,
} from '@db/schema';
import { complete, extractJson, ProviderError } from '@/lib/bedrock';
import type { ProviderCredentials } from '@/features/settings/settingsStore';
import { newId } from '@/lib/uuid';
import { now } from '@/lib/time';

/** Descriptions run long; the tail rarely carries requirements worth paying for. */
const MAX_DESCRIPTION_CHARS = 6_000;

/** The apply kit emits the most text of any call (§C.5). */
const APPLY_KIT_MAX_TOKENS = 6_000;

/** Concurrency 3: results still stream, a 60-job batch finishes in a third of the time (§8.2). */
const SCORE_CONCURRENCY = 3;

const SCORE_SYSTEM = `You assess how well a candidate matches a job.

Return ONLY a JSON object, no prose and no code fence:
{
  "score": <integer 0-100>,
  "components": {
    "skills": <integer 0-40>,
    "experience": <integer 0-25>,
    "role": <integer 0-20>,
    "location": <integer 0-15>
  },
  "band": "strong" | "good" | "stretch" | "weak",
  "matched_skills": [<string>],
  "missing_skills": [<string>],
  "rationale": "<two sentences, plain language, addressed to the candidate>",
  "improvement_suggestions": [<string>]
}

"score" is the sum of the four components. Compute the components first, then
add them — do not decide a total and distribute backwards.

SKILLS, out of 40:
  36-40  the core stack is named in the job title
  28-35  the core stack appears in the requirements, not the title
  18-27  an adjacent stack the candidate's experience transfers to
   0-17  a different discipline

EXPERIENCE, out of 25:
  23-25  the stated band contains the candidate's years
  18-22  the candidate is within one year of the band
  10-17  the candidate is two to three years outside the band
   0-9   further outside than that
  When the posting states no band, award 20 and say so in the rationale. Do not
  penalise a candidate for a requirement the posting does not state.

ROLE, out of 20:
  18-20  same title family and same level
  14-17  same family, one level apart in either direction
   8-13  a related function
   0-7   a different function

LOCATION, out of 15:
  14-15  the candidate's target city, on-site or hybrid
  11-13  the candidate's target city, arrangement not stated
   7-10  remote-eligible from the candidate's location
   0-6   a different city with no remote option

Bands follow from the total: strong is 85 and above, good is 70 to 84, stretch is
55 to 69, weak is below 55.

Judge against what the description actually requires. Do not reward keyword
overlap that is not backed by real experience — a skill listed once in a resume
skills section is weaker evidence than one a project describes being used. Do not
penalise a candidate for requirements the description does not state.

"missing_skills" names only requirements the posting explicitly asks for and the
resume does not evidence. Do not list nice-to-haves the posting itself marks
optional.

Each entry in "improvement_suggestions" must be something the candidate could act
on before applying to this specific job — a project to surface, a resume line to
rewrite, a gap to acknowledge directly in the application. Not general career
advice. Return an empty array rather than filler.`;

const ANALYSE_SYSTEM = `You give a candidate a detailed read on one job.

Return ONLY a JSON object, no prose and no code fence:
{
  "summary": "<a short paragraph on the fit>",
  "strengths": [<string>],
  "gaps": [<string>],
  "likely_screening_questions": [{ "question": string, "how_to_answer": string }],
  "interview_focus": [<string>],
  "application_advice": [<string>],
  "questions_to_ask_them": [<string>],
  "concerns": [<string>]
}

Be specific and honest. Name the real gaps rather than softening them, and make
every piece of advice something the candidate can act on this week.

"likely_screening_questions" are the three or four questions a recruiter or
hiring manager would most plausibly open with for this posting and this
background — including the uncomfortable one about the largest gap. Each
"how_to_answer" is a concrete approach grounded in something the resume actually
contains, not a template.

"interview_focus" names what to revise, ordered by how likely it is to come up.
Be specific about the topic rather than naming a broad subject area.

"questions_to_ask_them" are questions that would genuinely inform the
candidate's decision, drawn from what this posting leaves unstated.

"concerns" names things about the posting itself the candidate should weigh — an
unusually wide experience band, a title that does not match the described work, a
staffing intermediary rather than the employer, an applicant count that suggests
the role is nearly closed, a description that reads as a different role than the
title. Return an empty array if the posting looks clean. Do not invent concerns
to fill the field.

Where the posting and the resume genuinely do not fit, say so plainly in the
summary. A candidate is better served by being told not to spend the afternoon
on an application than by being encouraged into one.`;

const APPLY_SYSTEM = `You help a candidate apply to one specific job.

Return ONLY a JSON object, no prose and no code fence:
{
  "headline": "<one line the candidate could use as a resume summary for this job>",
  "tailored_bullets": [{ "original": string|null, "rewritten": string, "why": string }],
  "cover_note": "<120-180 words>",
  "referral_message": "<under 60 words>",
  "screening_answers": [{ "question": string, "answer": string }],
  "keywords_to_add": [<string>],
  "do_not_claim": [<string>]
}

Everything you write must be supported by the resume. You may re-frame, re-order
and re-emphasise what is there. You may not add a technology, a metric, a
responsibility or an outcome the resume does not contain. This is the single most
important constraint here: a candidate who cannot defend a line in an interview
is worse off than one who never wrote it.

"tailored_bullets" rewrites three to five existing resume bullets to foreground
what this posting asks for. "original" quotes the resume line being rewritten, or
is null when you are surfacing something from a project description that was not
already a bullet. "why" names the specific requirement in the posting that the
rewrite speaks to.

"cover_note" is plain, direct and free of throat-clearing. Open with why this
specific role, not with a self-description. Name one concrete thing from the
candidate's work that maps to the posting's central requirement. Close with a
single clear next step. No "I am writing to express my interest". No adjectives
about the company the candidate could not have verified.

"referral_message" is what the candidate would send to a second-degree contact at
the company. It should be askable by a stranger: brief, specific about the role,
and easy to say yes to. Do not write "I would love to connect".

"screening_answers" covers the two or three application-form questions this kind
of posting usually asks — notice period, current and expected compensation,
reason for looking, willingness to relocate. Answer in the candidate's voice
using facts the resume supplies. Where the resume does not supply a fact, write
the answer with a clearly marked placeholder in square brackets rather than
inventing a value.

"keywords_to_add" lists terms from the posting that the candidate's experience
genuinely supports but the resume does not currently use. Only where the
underlying experience is evidenced — this is about vocabulary matching an
applicant tracking system, never about claiming new experience.

"do_not_claim" lists requirements from the posting the resume does not support,
so the candidate does not overstate them under interview pressure. This field
protects the candidate. Populate it honestly even when it is long.`;

/**
 * The structured header repeats fields that also appear in the description on
 * purpose — the model scores experience fit far more consistently when the band
 * is a field than when it has to be found in prose (§C.6).
 */
function buildUserText(job: Job, resume: ParsedResume): string {
  const experience =
    job.experienceMinYears != null || job.experienceMaxYears != null
      ? `${job.experienceMinYears ?? '?'}-${job.experienceMaxYears ?? '?'} years`
      : 'not stated';
  const salary = job.salaryDisclosed
    ? `${job.salaryMin ?? '?'}-${job.salaryMax ?? '?'} ${job.salaryCurrency ?? ''} per ${job.salaryPeriod ?? 'year'}`
    : 'not disclosed';
  const posted = job.postedDate ? new Date(job.postedDate).toISOString().slice(0, 10) : 'not stated';

  return [
    '<resume>',
    JSON.stringify(resume),
    '</resume>',
    '',
    '<job>',
    `Title: ${job.title}`,
    `Company: ${job.companyName ?? 'Not disclosed'}`,
    `Location: ${job.location ?? 'Not stated'}`,
    `Experience required: ${experience}`,
    `Salary: ${salary}`,
    `Posted: ${posted}`,
    `Source: ${job.source}`,
    `Applicants: ${job.applicantCount ?? 'not stated'}`,
    '',
    job.descriptionFull.slice(0, MAX_DESCRIPTION_CHARS),
    '</job>',
  ].join('\n');
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Band thresholds match the rubric: strong ≥85, good 70–84, stretch 55–69 (§8.1). */
function bandFromScore(score: number): MatchBand {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 55) return 'stretch';
  return 'weak';
}

const clampInt = (value: unknown, max: number): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(max, Math.round(parsed)));
};

function validateComponents(value: unknown): ScoreComponents | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const skills = clampInt(raw.skills, 40);
  const experience = clampInt(raw.experience, 25);
  const role = clampInt(raw.role, 20);
  const location = clampInt(raw.location, 15);
  if (skills == null || experience == null || role == null || location == null) return null;
  return { skills, experience, role, location };
}

type ValidatedScore = {
  score: number;
  band: MatchBand;
  components: ScoreComponents | null;
  matchedSkills: string[];
  missingSkills: string[];
  rationale: string | null;
  improvementSuggestions: string[];
};

/**
 * A malformed response fails this one job, never the batch. Raw model output is
 * never rendered — everything the UI shows passes through here first.
 */
function validateScore(payload: unknown): ValidatedScore {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('The model returned an unexpected shape.');
  }
  const raw = payload as Record<string, unknown>;

  const components = validateComponents(raw.components);
  // The rubric defines the score as the component sum; when components exist,
  // the sum is authoritative over a total that disagrees with it.
  const fromComponents =
    components != null
      ? components.skills + components.experience + components.role + components.location
      : null;
  const rawScore = clampInt(raw.score, 100);
  const score = fromComponents ?? rawScore;
  if (score == null) {
    throw new ProviderError('The model did not return a score.');
  }

  const band =
    typeof raw.band === 'string' && (MATCH_BANDS as readonly string[]).includes(raw.band)
      ? (raw.band as MatchBand)
      : bandFromScore(score);

  return {
    score,
    band,
    components,
    matchedSkills: asStringArray(raw.matched_skills),
    missingSkills: asStringArray(raw.missing_skills),
    rationale: typeof raw.rationale === 'string' && raw.rationale.trim() ? raw.rationale.trim() : null,
    improvementSuggestions: asStringArray(raw.improvement_suggestions),
  };
}

function validateAnalysis(payload: unknown): DeepAnalysis {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('The model returned an unexpected shape.');
  }
  const raw = payload as Record<string, unknown>;
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary) throw new ProviderError('The analysis came back empty.');

  const questions = (Array.isArray(raw.likely_screening_questions) ? raw.likely_screening_questions : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const q = entry as Record<string, unknown>;
      if (typeof q.question !== 'string' || typeof q.how_to_answer !== 'string') return null;
      return { question: q.question, how_to_answer: q.how_to_answer };
    })
    .filter((q): q is { question: string; how_to_answer: string } => q !== null);

  return {
    summary,
    strengths: asStringArray(raw.strengths),
    gaps: asStringArray(raw.gaps),
    interview_focus: asStringArray(raw.interview_focus),
    application_advice: asStringArray(raw.application_advice),
    likely_screening_questions: questions,
    questions_to_ask_them: asStringArray(raw.questions_to_ask_them),
    concerns: asStringArray(raw.concerns),
  };
}

function validateApplyKit(payload: unknown): ApplyKit {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('The model returned an unexpected shape.');
  }
  const raw = payload as Record<string, unknown>;
  const headline = typeof raw.headline === 'string' ? raw.headline.trim() : '';
  const coverNote = typeof raw.cover_note === 'string' ? raw.cover_note.trim() : '';
  if (!headline && !coverNote) throw new ProviderError('The apply kit came back empty.');

  const bullets = (Array.isArray(raw.tailored_bullets) ? raw.tailored_bullets : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const b = entry as Record<string, unknown>;
      if (typeof b.rewritten !== 'string' || !b.rewritten.trim()) return null;
      return {
        original: typeof b.original === 'string' ? b.original : null,
        rewritten: b.rewritten,
        why: typeof b.why === 'string' ? b.why : '',
      };
    })
    .filter((b): b is ApplyKit['tailored_bullets'][number] => b !== null);

  const answers = (Array.isArray(raw.screening_answers) ? raw.screening_answers : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const a = entry as Record<string, unknown>;
      if (typeof a.question !== 'string' || typeof a.answer !== 'string') return null;
      return { question: a.question, answer: a.answer };
    })
    .filter((a): a is { question: string; answer: string } => a !== null);

  return {
    headline,
    tailored_bullets: bullets,
    cover_note: coverNote,
    referral_message: typeof raw.referral_message === 'string' ? raw.referral_message.trim() : '',
    screening_answers: answers,
    keywords_to_add: asStringArray(raw.keywords_to_add),
    do_not_claim: asStringArray(raw.do_not_claim),
  };
}

export type ScoreArgs = {
  userId: string;
  job: Job;
  resumeId: string;
  resume: ParsedResume;
  credentials: ProviderCredentials;
  modelId: string;
  searchId?: string;
};

/**
 * Writes the cached score for this (job, resume) pair, overwriting any existing
 * row so a pair can never accumulate duplicates (FR-5.4, hard rule 4).
 */
export async function scoreJob(args: ScoreArgs): Promise<JobScore> {
  const { raw, inputTokens, outputTokens } = await complete(
    args.credentials,
    args.modelId,
    SCORE_SYSTEM,
    buildUserText(args.job, args.resume),
  );

  const validated = validateScore(extractJson(raw));
  const ts = now();

  const existing = (
    await db
      .select()
      .from(jobScores)
      .where(and(eq(jobScores.jobId, args.job.id), eq(jobScores.resumeId, args.resumeId)))
      .limit(1)
  )[0];

  const values = {
    band: validated.band,
    score: validated.score,
    scoreComponentsJson: validated.components,
    matchedSkills: validated.matchedSkills,
    missingSkills: validated.missingSkills,
    rationale: validated.rationale,
    improvementSuggestions: validated.improvementSuggestions,
    modelUsed: args.modelId,
    inputTokens,
    outputTokens,
    scoredAt: ts,
    updatedAt: ts,
    syncedAt: null,
  };

  if (existing) {
    const [row] = await db
      .update(jobScores)
      .set(values)
      .where(eq(jobScores.id, existing.id))
      .returning();
    return row!;
  }

  const [row] = await db
    .insert(jobScores)
    .values({
      id: newId(),
      userId: args.userId,
      jobId: args.job.id,
      resumeId: args.resumeId,
      searchId: args.searchId ?? null,
      createdAt: ts,
      ...values,
    })
    .returning();
  return row!;
}

/**
 * Deep analysis fires on an explicit tap, never on card open (hard rule 5), and
 * is written onto the existing score row.
 */
export async function analyseJob(args: ScoreArgs & { scoreId: string }): Promise<DeepAnalysis> {
  const { raw } = await complete(
    args.credentials,
    args.modelId,
    ANALYSE_SYSTEM,
    buildUserText(args.job, args.resume),
  );

  const analysis = validateAnalysis(extractJson(raw));
  const ts = now();

  await db
    .update(jobScores)
    .set({ deepAnalysisJson: analysis, deepAnalysedAt: ts, updatedAt: ts, syncedAt: null })
    .where(eq(jobScores.id, args.scoreId));

  return analysis;
}

/**
 * Apply kit — explicit tap only, written onto the existing score row (§C.5).
 * Everything in it must be defensible from the resume; `do_not_claim` exists so
 * honesty is structural, not aspirational.
 */
export async function buildApplyKit(args: ScoreArgs & { scoreId: string }): Promise<ApplyKit> {
  const { raw } = await complete(
    args.credentials,
    args.modelId,
    APPLY_SYSTEM,
    buildUserText(args.job, args.resume),
    APPLY_KIT_MAX_TOKENS,
  );

  const kit = validateApplyKit(extractJson(raw));
  const ts = now();

  await db
    .update(jobScores)
    .set({ applyKitJson: kit, applyKitAt: ts, updatedAt: ts, syncedAt: null })
    .where(eq(jobScores.id, args.scoreId));

  return kit;
}

export type BatchProgress = { done: number; total: number; failed: number };

/**
 * Scores a batch at a small fixed concurrency so results stream into the list
 * (FR-5.3) without a 60-job batch taking an hour. One bad response costs one
 * job, never the batch.
 */
export async function scoreJobsBatch(
  jobsToScore: Job[],
  base: Omit<ScoreArgs, 'job'>,
  onProgress?: (progress: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<{ scored: number; failed: number }> {
  let scored = 0;
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (next < jobsToScore.length) {
      if (signal?.aborted) return;
      const job = jobsToScore[next++]!;
      try {
        await scoreJob({ ...base, job });
        scored++;
      } catch {
        failed++;
      }
      onProgress?.({ done: scored + failed, total: jobsToScore.length, failed });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SCORE_CONCURRENCY, jobsToScore.length) }, () => worker()),
  );

  return { scored, failed };
}

/** @deprecated kept for callers not yet migrated — same behaviour, concurrency 3. */
export const scoreJobsSequentially = scoreJobsBatch;
