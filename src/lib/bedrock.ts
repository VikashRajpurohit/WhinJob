/**
 * Bedrock called directly from the device (owner decision, 2026-08-18 — no Edge
 * Functions in V1). Plain `fetch` against the Mantle endpoints rather than the
 * Anthropic SDK: the SDK pulls Node shims that do not belong in a React Native
 * bundle, and both providers here are a single POST.
 *
 * Auth is a Bedrock API key as a bearer token, so there is no SigV4 signing and
 * no AWS SDK anywhere in this file.
 */
import type { ProviderCredentials } from '@/features/settings/settingsStore';

const MAX_TOKENS = 4000;

const mantleBase = (region: string, path: string) =>
  `https://bedrock-mantle.${region}.api.aws/${path}`;

/**
 * The Mantle endpoint reads the key from `x-api-key` (verified live: a token in
 * `Authorization: Bearer` is bounced at the gateway with a bare 401 and never
 * reaches auth). Both headers are sent so either token type keeps working.
 */
const authHeaders = (key: string) => ({
  'x-api-key': key,
  Authorization: `Bearer ${key}`,
});

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Error bodies from auth/routing failures carry `error.type` and a request id,
 * never the prompt — safe to surface, and the difference between a debuggable
 * failure and a bare status code.
 */
async function describeFailure(response: Response): Promise<string> {
  let type: string | null = null;
  let requestId: string | null = null;
  try {
    const body = (await response.json()) as {
      request_id?: string;
      error?: { type?: string; code?: string };
    };
    type = body.error?.type ?? body.error?.code ?? null;
    requestId = body.request_id ?? null;
  } catch {
    // Non-JSON body: fall through to the status-only message.
  }

  if (response.status === 404) {
    return (
      'The selected model is not available on this key or region (404' +
      `${type ? `, ${type}` : ''}). Check Bedrock → Model access in the AWS console` +
      `${requestId ? ` — request ${requestId}` : ''}.`
    );
  }
  if (response.status === 401 || response.status === 403) {
    return `The Bedrock key was rejected (${response.status}${type ? `, ${type}` : ''}). Re-check the key and region in Settings.`;
  }
  if (response.status === 429) {
    return 'Bedrock rate limit reached (429). Wait a minute and retry.';
  }
  return `The model provider rejected the request (${response.status}${type ? `, ${type}` : ''}${requestId ? `, request ${requestId}` : ''}).`;
}

export function providerFor(modelId: string): 'claude' | 'openai' {
  if (modelId.startsWith('anthropic.')) return 'claude';
  if (modelId.startsWith('openai.')) return 'openai';
  throw new ProviderError(`Unrecognised model: ${modelId}`);
}

type ClaudeResponse = {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type CompletionResult = {
  raw: string;
  inputTokens: number;
  outputTokens: number;
};

async function callClaude(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  userText: string,
  maxTokens: number = MAX_TOKENS,
): Promise<CompletionResult> {
  const response = await fetch(mantleBase(credentials.awsRegion, 'anthropic/v1/messages'), {
    method: 'POST',
    headers: {
      ...authHeaders(credentials.bedrockApiKey),
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    }),
  });

  if (!response.ok) {
    throw new ProviderError(await describeFailure(response));
  }

  const body = (await response.json()) as ClaudeResponse;

  if (body.stop_reason === 'refusal') {
    throw new ProviderError('The model declined to answer for this job.');
  }
  if (body.stop_reason === 'max_tokens') {
    throw new ProviderError('The response was too long to complete.');
  }

  const raw = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  if (!raw.trim()) throw new ProviderError('The model returned nothing.');

  return {
    raw,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

type OpenAIResponse = {
  output_text?: string;
  output?: { content?: { text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function callOpenAI(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  userText: string,
  maxTokens: number = MAX_TOKENS,
): Promise<CompletionResult> {
  const response = await fetch(mantleBase(credentials.awsRegion, 'openai/v1/responses'), {
    method: 'POST',
    headers: {
      ...authHeaders(credentials.bedrockApiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_output_tokens: maxTokens,
      instructions: system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: userText }] }],
    }),
  });

  if (!response.ok) {
    throw new ProviderError(await describeFailure(response));
  }

  const body = (await response.json()) as OpenAIResponse;

  // `output_text` is a convenience the Responses API offers but does not promise.
  let raw = typeof body.output_text === 'string' ? body.output_text : '';
  if (!raw.trim()) {
    const parts: string[] = [];
    for (const item of body.output ?? []) {
      for (const block of item.content ?? []) {
        if (typeof block.text === 'string') parts.push(block.text);
      }
    }
    raw = parts.join('');
  }

  if (!raw.trim()) throw new ProviderError('The model returned nothing.');

  return {
    raw,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

export function complete(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  userText: string,
  maxTokens?: number,
): Promise<CompletionResult> {
  return providerFor(modelId) === 'claude'
    ? callClaude(credentials, modelId, system, userText, maxTokens)
    : callOpenAI(credentials, modelId, system, userText, maxTokens);
}

/**
 * A ~10-token ping with the given model so Settings can show the exact failure
 * (bad key, wrong region, model not enabled) instead of a mid-search surprise.
 */
export async function testProvider(
  credentials: ProviderCredentials,
  modelId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await complete(credentials, modelId, 'Reply with the single word: ok', 'ping', 16);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The connection test failed.',
    };
  }
}

/**
 * A PDF sent as a document block. Only PDF — the Claude document block does not
 * take DOCX, and unzipping one on-device would mean shipping a zip library for a
 * format the user can trivially re-export.
 */
export async function completeWithPdf(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  instruction: string,
  pdfBase64: string,
): Promise<CompletionResult> {
  const isClaude = providerFor(modelId) === 'claude';

  const url = isClaude
    ? mantleBase(credentials.awsRegion, 'anthropic/v1/messages')
    : mantleBase(credentials.awsRegion, 'openai/v1/responses');

  const body = isClaude
    ? {
        model: modelId,
        max_tokens: MAX_TOKENS,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              },
              { type: 'text', text: instruction },
            ],
          },
        ],
      }
    : {
        model: modelId,
        max_output_tokens: MAX_TOKENS,
        instructions: system,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                filename: 'resume.pdf',
                file_data: `data:application/pdf;base64,${pdfBase64}`,
              },
              { type: 'input_text', text: instruction },
            ],
          },
        ],
      };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(credentials.bedrockApiKey),
      'Content-Type': 'application/json',
      ...(isClaude ? { 'anthropic-version': '2023-06-01' } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ProviderError(await describeFailure(response));
  }

  const payload = (await response.json()) as ClaudeResponse & OpenAIResponse;

  if (payload.stop_reason === 'refusal') {
    throw new ProviderError('This file could not be read as a resume.');
  }
  if (payload.stop_reason === 'max_tokens') {
    throw new ProviderError('This resume is too long to read automatically.');
  }

  let raw = '';
  if (isClaude) {
    raw = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
  } else {
    raw = typeof payload.output_text === 'string' ? payload.output_text : '';
    if (!raw.trim()) {
      const parts: string[] = [];
      for (const item of payload.output ?? []) {
        for (const block of item.content ?? []) {
          if (typeof block.text === 'string') parts.push(block.text);
        }
      }
      raw = parts.join('');
    }
  }

  if (!raw.trim()) throw new ProviderError('The model returned nothing.');

  return {
    raw,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
  };
}

/**
 * Neither provider supports structured outputs on Bedrock, so the model is asked
 * for raw JSON and the result is validated by the caller. Models sometimes wrap
 * JSON in a fenced block regardless of instructions.
 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1]! : raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost brace pair — models occasionally add a preamble.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new ProviderError('The model returned a malformed response.');
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new ProviderError('The model returned a malformed response.');
    }
  }
}
