/**
 * Apify is called directly from the device (owner decision, 2026-08-18 — no Edge
 * Functions in V1). The token lives in SecureStore alongside the Bedrock key, so
 * every user pays for their own crawls.
 *
 * Runs are started, polled, then drained from the run's default dataset. The
 * synchronous `run-sync-get-dataset-items` endpoint exists but caps out well
 * below a real crawl, so polling is the only reliable shape here.
 */

const API = 'https://api.apify.com/v2';

/** Actor ids are `user/name` but the REST path wants `user~name`. */
const pathId = (actorId: string) => actorId.replace('/', '~');

export type ApifyRun = {
  id: string;
  status: string;
  defaultDatasetId: string;
};

const TERMINAL = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly actorId: string,
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    // The body can echo the actor input, so it is never surfaced verbatim.
    throw new Error(`Apify request failed (${response.status})`);
  }
  const body = (await response.json()) as { data: T };
  return body.data;
}

async function startRun(
  token: string,
  actorId: string,
  input: unknown,
): Promise<ApifyRun> {
  return request<ApifyRun>(`${API}/acts/${pathId(actorId)}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

async function getRun(token: string, runId: string): Promise<ApifyRun> {
  return request<ApifyRun>(`${API}/actor-runs/${runId}?token=${token}`);
}

async function datasetItems<T>(
  token: string,
  datasetId: string,
  fields?: string[],
): Promise<T[]> {
  // A projection keeps wide actors (Indeed exposes 340 fields) from returning
  // hundreds of KB of taxonomy codes per run (§A.3).
  const projection = fields?.length ? `&fields=${encodeURIComponent(fields.join(','))}` : '';
  const response = await fetch(
    `${API}/datasets/${datasetId}/items?token=${token}&clean=true&format=json${projection}`,
  );
  if (!response.ok) throw new Error(`Apify dataset read failed (${response.status})`);
  return (await response.json()) as T[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RunOptions = {
  /** Give up rather than hold the UI open forever on a wedged actor. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** Dataset projection, sent as `fields=` on the drain. */
  fields?: string[];
};

/**
 * Start an actor, wait for it to finish, return its dataset rows.
 *
 * A non-SUCCEEDED terminal status throws — a partially-populated dataset from a
 * failed run would silently look like "this search found little", which is worse
 * than a visible error.
 */
export async function runActor<T>(
  token: string,
  actorId: string,
  input: unknown,
  options: RunOptions = {},
): Promise<{ runId: string; items: T[] }> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;

  let run: ApifyRun;
  try {
    run = await startRun(token, actorId, input);
  } catch (error) {
    throw new ApifyError(
      error instanceof Error ? error.message : 'Could not start the crawl.',
      actorId,
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (!TERMINAL.includes(run.status)) {
    if (options.signal?.aborted) throw new ApifyError('Search cancelled.', actorId);
    if (Date.now() > deadline) {
      throw new ApifyError('This source took too long and was skipped.', actorId);
    }
    await sleep(pollIntervalMs);
    try {
      run = await getRun(token, run.id);
    } catch {
      // A single failed poll is not fatal — the next tick retries.
      continue;
    }
  }

  if (run.status !== 'SUCCEEDED') {
    throw new ApifyError(`Crawl ${run.status.toLowerCase()}.`, actorId);
  }

  const items = await datasetItems<T>(token, run.defaultDatasetId, options.fields);
  return { runId: run.id, items };
}
