/**
 * Model providers, both reached through Amazon Bedrock on one user-supplied key.
 *
 * Claude and OpenAI share the host and the credential but not the request shape:
 * Claude takes Messages-API bodies at `/anthropic/v1/messages`, OpenAI takes
 * Responses-API bodies at `/openai/v1/responses`. One adapter each, one
 * interface, selected by the model id's prefix.
 *
 * Auth is a Bedrock API key passed as a bearer token, which is why there is no
 * SigV4 signing anywhere in here. That keeps this file to plain `fetch` and the
 * standard Anthropic client, with no AWS SDK and no crypto shims.
 *
 * **Neither provider supports structured outputs on Bedrock**, and forced
 * `tool_choice` has model-specific restrictions there (Sonnet 5 cannot disable
 * thinking, which forced tool choice requires). So both adapters ask for raw
 * JSON in the response text and lean on `validateParsedResume` as the real gate.
 * A malformed response was always going to fail that check; skipping the schema
 * layer costs strictness we were re-checking anyway.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.117.1';

export type ProviderCredentials = {
  bedrockApiKey: string;
  awsRegion: string;
};

/** A document to extract from: a PDF as base64, or already-extracted text. */
export type SourceDocument =
  | { kind: 'pdf'; base64: string; filename: string }
  | { kind: 'text'; text: string };

export type ExtractionResult =
  | { ok: true; raw: string }
  | { ok: false; reason: string };

const MAX_TOKENS = 8000;

export function providerFor(modelId: string): 'claude' | 'openai' {
  if (modelId.startsWith('anthropic.')) return 'claude';
  if (modelId.startsWith('openai.')) return 'openai';
  throw new Error(`Unrecognised model id: ${modelId}`);
}

const mantleBase = (region: string, path: string) =>
  `https://bedrock-mantle.${region}.api.aws/${path}`;

/**
 * Claude via the Messages API. The standard client works against Mantle when
 * pointed at the regional base URL with the Bedrock key as the bearer token.
 */
async function extractWithClaude(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  document: SourceDocument,
): Promise<ExtractionResult> {
  const client = new Anthropic({
    apiKey: credentials.bedrockApiKey,
    baseURL: mantleBase(credentials.awsRegion, 'anthropic'),
  });

  const content =
    document.kind === 'pdf'
      ? [
          {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: document.base64,
            },
          },
          { type: 'text' as const, text: 'Extract this resume.' },
        ]
      : [{ type: 'text' as const, text: `<resume>\n${document.text}\n</resume>\n\nExtract this resume.` }];

  const message = await client.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content }],
  });

  if (message.stop_reason === 'refusal') {
    return { ok: false, reason: 'This file could not be parsed as a resume.' };
  }
  if (message.stop_reason === 'max_tokens') {
    return { ok: false, reason: 'This resume is too long to parse automatically.' };
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return text.trim() ? { ok: true, raw: text } : { ok: false, reason: 'The model returned nothing.' };
}

/** OpenAI via the Responses API on Mantle. */
async function extractWithOpenAI(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  document: SourceDocument,
): Promise<ExtractionResult> {
  const userContent =
    document.kind === 'pdf'
      ? [
          {
            type: 'input_file',
            filename: document.filename,
            file_data: `data:application/pdf;base64,${document.base64}`,
          },
          { type: 'input_text', text: 'Extract this resume.' },
        ]
      : [
          {
            type: 'input_text',
            text: `<resume>\n${document.text}\n</resume>\n\nExtract this resume.`,
          },
        ];

  const response = await fetch(mantleBase(credentials.awsRegion, 'openai/v1/responses'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.bedrockApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_output_tokens: MAX_TOKENS,
      instructions: system,
      input: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    // The body can echo request content, so it is never surfaced or logged.
    return { ok: false, reason: `The model provider rejected the request (${response.status}).` };
  }

  const body = await response.json();
  const raw = readOpenAIText(body);
  return raw ? { ok: true, raw } : { ok: false, reason: 'The model returned nothing.' };
}

/** The Responses API offers `output_text` as a convenience but does not promise it. */
// deno-lint-ignore no-explicit-any
function readOpenAIText(body: any): string {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text;

  const parts: string[] = [];
  for (const item of body?.output ?? []) {
    for (const block of item?.content ?? []) {
      if (typeof block?.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('');
}

export function extractResume(
  credentials: ProviderCredentials,
  modelId: string,
  system: string,
  document: SourceDocument,
): Promise<ExtractionResult> {
  return providerFor(modelId) === 'claude'
    ? extractWithClaude(credentials, modelId, system, document)
    : extractWithOpenAI(credentials, modelId, system, document);
}

/** Models are sent by the client, so validate the shape before trusting it. */
export function parseCredentials(body: unknown): ProviderCredentials {
  const source = (body ?? {}) as Record<string, unknown>;
  const raw = (source.credentials ?? {}) as Record<string, unknown>;
  const bedrockApiKey = typeof raw.bedrockApiKey === 'string' ? raw.bedrockApiKey.trim() : '';
  const awsRegion = typeof raw.awsRegion === 'string' ? raw.awsRegion.trim() : '';

  if (!bedrockApiKey) throw new Error('No Bedrock API key was supplied.');
  // Region becomes part of a URL — constrain it rather than interpolating freely.
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(awsRegion)) {
    throw new Error('AWS region looks malformed.');
  }

  return { bedrockApiKey, awsRegion };
}
