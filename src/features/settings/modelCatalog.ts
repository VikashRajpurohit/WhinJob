/**
 * Selectable models, both served through Amazon Bedrock on one credential.
 *
 * Claude and OpenAI are the same host and the same key but two different request
 * shapes — Claude takes Messages-API bodies at `/anthropic/v1/messages`, OpenAI
 * takes Responses-API bodies at `/openai/v1/responses`. That is why `provider`
 * exists: it selects the adapter, not the credential.
 *
 * Prices are per million tokens and feed the estimate shown in Settings. They
 * are a display aid, not a bill — every entry carries where the number came from
 * and when it was checked, because rates move and a stale figure presented as
 * fact is worse than no figure.
 */

export type ProviderId = 'bedrock-claude' | 'bedrock-openai';

export type ModelOption = {
  /** Bedrock model id, sent as-is. */
  id: string;
  label: string;
  provider: ProviderId;
  inputPerMTok: number;
  outputPerMTok: number;
  /** Prompt-cache read price. Null where the rate is not published separately. */
  cachedInputPerMTok: number | null;
  contextTokens: number;
  maxOutputTokens: number;
  note: string;
  priceSource: string;
  verifiedOn: string;
};

const CLAUDE_CACHE_READ_MULTIPLIER = 0.1;

/**
 * Claude figures are Anthropic's published first-party rates. AWS does not
 * surface the 5-series Claude rates on its public pricing page, so **confirm
 * these against the AWS console before trusting them** — Bedrock is
 * partner-operated and prices there can differ from first-party.
 */
const CLAUDE_MODELS: ModelOption[] = [
  {
    id: 'anthropic.claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'bedrock-claude',
    inputPerMTok: 5,
    outputPerMTok: 25,
    cachedInputPerMTok: 5 * CLAUDE_CACHE_READ_MULTIPLIER,
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    note: 'Strongest reasoning. Best ranking quality, highest cost.',
    priceSource: 'Anthropic list price — confirm Bedrock rate in the AWS console',
    verifiedOn: '2026-08-17',
  },
  {
    id: 'anthropic.claude-sonnet-5',
    label: 'Claude Sonnet 5',
    provider: 'bedrock-claude',
    inputPerMTok: 3,
    outputPerMTok: 15,
    cachedInputPerMTok: 3 * CLAUDE_CACHE_READ_MULTIPLIER,
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    note: 'Near-Opus quality at around half the cost. Good default.',
    priceSource: 'Anthropic list price — confirm Bedrock rate in the AWS console',
    verifiedOn: '2026-08-17',
  },
  {
    id: 'anthropic.claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'bedrock-claude',
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedInputPerMTok: 1 * CLAUDE_CACHE_READ_MULTIPLIER,
    contextTokens: 200_000,
    maxOutputTokens: 64_000,
    note: 'Cheapest and fastest. Weaker ranking — good matches can get buried.',
    priceSource: 'Anthropic list price — confirm Bedrock rate in the AWS console',
    verifiedOn: '2026-08-17',
  },
];

/** AWS bills OpenAI models on Bedrock at OpenAI's own rates with no markup. */
const OPENAI_MODELS: ModelOption[] = [
  {
    id: 'openai.gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    provider: 'bedrock-openai',
    inputPerMTok: 5,
    outputPerMTok: 30,
    cachedInputPerMTok: 0.5,
    contextTokens: 272_000,
    maxOutputTokens: 128_000,
    note: 'OpenAI flagship. Highest output cost of the six.',
    priceSource: 'OpenAI published pricing (Bedrock bills at the same rate)',
    verifiedOn: '2026-08-17',
  },
  {
    id: 'openai.gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    provider: 'bedrock-openai',
    inputPerMTok: 2,
    outputPerMTok: 12,
    cachedInputPerMTok: 0.2,
    contextTokens: 272_000,
    maxOutputTokens: 128_000,
    note: 'Mid-tier OpenAI. Balanced cost and capability.',
    priceSource: 'OpenAI published pricing (Bedrock bills at the same rate)',
    verifiedOn: '2026-08-17',
  },
  {
    id: 'openai.gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    provider: 'bedrock-openai',
    inputPerMTok: 0.2,
    outputPerMTok: 1.2,
    cachedInputPerMTok: 0.02,
    contextTokens: 272_000,
    maxOutputTokens: 128_000,
    note: 'Cheapest option by a wide margin. Use for bulk, not for ranking.',
    priceSource: 'OpenAI published pricing (Bedrock bills at the same rate)',
    verifiedOn: '2026-08-17',
  },
];

export const MODEL_CATALOG: ModelOption[] = [...CLAUDE_MODELS, ...OPENAI_MODELS];

export function findModel(id: string): ModelOption | null {
  return MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/** Stages that pick a model independently — see spec §6.1 and §6.6. */
export type ModelStage = 'parse' | 'score' | 'analyse';

export const STAGE_LABEL: Record<ModelStage, string> = {
  parse: 'Reading resumes',
  score: 'Scoring jobs',
  analyse: 'Deep analysis',
};

export const STAGE_HINT: Record<ModelStage, string> = {
  parse: 'Runs once per resume. Cheap either way.',
  score: 'Runs on every job in a search. This is where the money goes.',
  analyse: 'Only when you tap "Analyse this job".',
};

export const DEFAULT_MODELS: Record<ModelStage, string> = {
  parse: 'anthropic.claude-sonnet-5',
  score: 'anthropic.claude-sonnet-5',
  analyse: 'anthropic.claude-opus-5',
};

/**
 * Token estimates per §6.5, derived from the 3 August 2026 runs.
 *
 * Scoring assumes prompt caching is working: one cache write for the resume and
 * instructions, then cache reads for the rest of the batch. Bedrock has no Batch
 * API, so there is **no 50% batch discount** — these are standard-tier numbers,
 * unlike the spec's original figures.
 */
const USAGE = {
  parse: { input: 2_500, output: 700 },
  /** Per job scored, amortising the cached prefix across a 20-job batch. */
  scorePerJob: { input: 1_320, output: 200 },
  analyse: { input: 2_950, output: 600 },
} as const;

function cost(model: ModelOption, input: number, output: number): number {
  return (input / 1_000_000) * model.inputPerMTok + (output / 1_000_000) * model.outputPerMTok;
}

export function estimateStageCost(model: ModelOption, stage: ModelStage): number {
  if (stage === 'parse') return cost(model, USAGE.parse.input, USAGE.parse.output);
  if (stage === 'analyse') return cost(model, USAGE.analyse.input, USAGE.analyse.output);
  return cost(model, USAGE.scorePerJob.input, USAGE.scorePerJob.output);
}

/** A whole search at the Stage-2 default of 20 scored jobs. */
export function estimateSearchCost(model: ModelOption): number {
  return estimateStageCost(model, 'score') * 20;
}

/** Sub-cent figures still need to read as money, not as "$0.00". */
export function formatUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
