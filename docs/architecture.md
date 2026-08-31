# How the app talks to Apify and the models

Written 2026-08-18, after the owner decision to drop Edge Functions from V1.
Companion to `docs/requirements.md` (which still describes the old server-side
shape) and `docs/progress.md` (what is actually built).

## The one-line version

There is no server. The app calls Apify and Amazon Bedrock **directly from the
device**, using keys the user pastes into Settings. Every read still comes from
local SQLite; the network only ever writes into it.

```
Settings (Keychain)          SQLite (every read)
  apifyToken ──┐                    ▲
  bedrockApiKey│                    │
  awsRegion    │                    │
  model ids    │                    │
               ▼                    │
        runSearch ──► Apify ──► adapters ──► jobWriter ──┤
               │                                          │
               └────► Bedrock ──► scoreJob ───────────────┘
```

## Where things live

| Path | Job |
|---|---|
| `src/lib/apify.ts` | Start an actor run, poll it, drain its dataset |
| `src/lib/bedrock.ts` | One POST to Bedrock Mantle; text or PDF |
| `src/lib/parsedResume.ts` | Validates model output before it is persisted |
| `src/features/search/adapters/` | One file per job board |
| `src/features/search/runSearch.ts` | The whole crawl pipeline |
| `src/features/search/useSearchRunner.ts` | Screen-facing state for one search |
| `src/features/dashboard/jobWriter.ts` | Dedupe key, upsert, credibility flags, manual jobs |
| `src/features/scoring/scoreJob.ts` | Score, deep analysis, sequential batch |
| `src/features/settings/settingsStore.ts` | Credentials and model choices |

## Apify

**Auth.** `apifyToken` from Settings, passed as a `?token=` query param.

**Three calls, in `src/lib/apify.ts`:**

```
POST /v2/acts/{user~name}/runs   → { id, status, defaultDatasetId }
GET  /v2/actor-runs/{runId}      → poll until status is terminal
GET  /v2/datasets/{id}/items     → the rows
```

Actor ids are `user/name` but the REST path wants `user~name` — `pathId()` does
that swap. Polling runs every 3s with a 180s ceiling. A single failed poll is
ignored and retried on the next tick; a non-`SUCCEEDED` terminal status throws,
because a half-populated dataset would silently read as "this search found
little", which is worse than a visible error.

**Why polling and not `run-sync-get-dataset-items`:** the synchronous endpoint
caps out well below a real crawl.

### Adapter contract

`buildInput → run → normalize → Job[]`. Adding a board means adding a file and
one line in `adapters/index.ts` — `runSearch` never changes.

```ts
type SourceAdapter = {
  source: JobSource;
  actorId: string;
  buildInput: (ctx: AdapterContext) => Record<string, unknown>;
  normalize: (items: unknown[]) => NormalizedJob[];
};
```

Scraper output is untyped and inconsistent between runs, so `adapters/shared.ts`
coerces everything: `str()` / `num()` / `bool()` read the first non-empty match
across several candidate keys, `toEpoch()` handles ISO strings, epoch numbers and
"3 days ago" phrases, `stripHtml()` makes the description matchable text.

A row without a title or a description is dropped — FR-5.2 prefilters on
description content, so a job without one is unusable.

**Actor quirks, confirmed by live runs (these cost failed calls to find):**

- LinkedIn `datePosted` takes relative seconds codes (`r86400`, `r604800`), not
  "Past week". A human string is accepted and silently ignored.
- Indeed `country` must be lowercase (`in`). Uppercase is rejected outright.
- Naukri `freshness` does not reliably filter. It is still sent, but `runSearch`
  applies the real date cutoff client-side for **every** source.

### The pipeline (`runSearch.ts`)

1. Check the daily cap. With no server this is the only enforcement point — a
   real limit for this build, not the advisory check the spec assumed.
2. Insert a `searches` row, status `pending`.
3. Crawl each source at the widest window (30d). One dead source is collected
   into `sourceErrors` and never fails the search.
4. Apply filters. Undisclosed salary is never an exclusion reason (hard rule 7).
5. Date-filter to the requested window. If fewer than 8 survive, keep the wider
   set and record `windowUsedDays` so the UI can say so honestly (FR-4.3).
6. Rank by how many of the user's terms actually appear in the description.
7. `upsertJobs` — dedupe, then link to the search with the frozen rank.

One crawl, not two: widening is a client-side decision over an already-fetched
superset.

### Dedupe

`makeDedupeKey` normalises title + company + location into
`backend-engineer|acme|bengaluru`. Deliberately readable rather than hashed, so a
bad collapse is visible in the database instead of invisible. Unique per user.

A repeat keeps its original `firstSeenAt`, bumps `repostCount`, collects the new
source URL (so the user can still pick where to apply), and takes the longer of
the two descriptions.

## Bedrock

**Auth.** A Bedrock **API key** as a bearer token — *not* an AWS access key and
secret. That is why there is no SigV4 signing and no AWS SDK anywhere in this
codebase. Plain `fetch`; the Anthropic SDK pulls Node shims that do not belong in
a React Native bundle.

**Endpoints**, both on the Mantle host:

```
https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages    ← Claude
https://bedrock-mantle.{region}.api.aws/openai/v1/responses      ← OpenAI
```

**Routing** is by model-id prefix (`providerFor`): `anthropic.*` → Messages API
shape, `openai.*` → Responses API shape. Model ids come from Settings and are
never hard-coded, so downgrading is a settings change, not a release.

### Three call sites

| Call | Where | Trigger |
|---|---|---|
| Resume parse | `resumeStorage.parseResume` | Upload, or explicit tap |
| Score | `scoring/scoreJob.scoreJob` | After a crawl, or explicit tap |
| Deep analysis | `scoring/scoreJob.analyseJob` | Explicit tap only (hard rule 5) |

Resume parse sends the PDF as a document block via `completeWithPdf`. **PDF
only** — the Claude document block does not take DOCX, and unzipping one on
device would mean shipping a zip library for a format the user can re-export in
a click.

### Output handling

Neither provider supports structured outputs on Bedrock, so the model is asked
for raw JSON and the result is validated before anything is written:

1. `extractJson()` — strips a code fence if present, falls back to the outermost
   brace pair when the model adds a preamble.
2. `validateScore` / `validateAnalysis` / `validateParsedResume` — re-check the
   shape. A malformed response fails **one job**, never the batch.

Raw model output is never rendered to the user. Everything on screen has been
through a validator.

Scoring runs sequentially rather than in parallel, so results stream into the
list instead of landing in one block at the end (FR-5.3), and a cached score is
never re-run automatically (hard rule 4) — only on an explicit tap.

## Two things this architecture gives up

1. **The daily cap and any spend limit are client-side only.** A reinstall
   resets the allowance. Acceptable while each user pays with their own key;
   stops being acceptable the moment anyone else does.
2. **Prompt caching is not implemented** and Bedrock has no automatic caching, so
   the §6.5 cost model — which assumes it — understates real scoring cost by
   roughly 2×.

---

# Appendix A — Apify wire format

Tuning constants live at the top of `runSearch.ts`:

```ts
const PER_SOURCE_LIMIT = 60;            // rows requested per source per run
const MAX_WINDOW_DAYS = 30;             // widest window ever crawled
const MIN_RESULTS_BEFORE_WIDENING = 8;  // below this, keep the wider set
```

## A.1 Start a run

```http
POST https://api.apify.com/v2/acts/valig~linkedin-jobs-scraper/runs?token=<APIFY_TOKEN>
Content-Type: application/json

{ ...adapter.buildInput(ctx) }
```

```jsonc
// 201 — only these three fields are read
{ "data": { "id": "abc123", "status": "RUNNING", "defaultDatasetId": "def456" } }
```

## A.2 Poll until terminal

```http
GET https://api.apify.com/v2/actor-runs/abc123?token=<APIFY_TOKEN>
```

Every 3s, ceiling 180s. Terminal statuses: `SUCCEEDED`, `FAILED`, `ABORTED`,
`TIMED-OUT`. Anything other than `SUCCEEDED` throws `ApifyError`.

## A.3 Drain the dataset

```http
GET https://api.apify.com/v2/datasets/def456/items?token=<APIFY_TOKEN>&clean=true&format=json
```

Returns a bare JSON array (no `data` wrapper — note the difference from A.1/A.2).

## A.4 What each adapter sends

`windowDays` is always `MAX_WINDOW_DAYS` (30) at call time; the requested window
is applied client-side afterwards.

```jsonc
// valig/linkedin-jobs-scraper
{
  "title": "Backend Engineer",
  "location": "Bengaluru",
  "datePosted": "r2592000",   // r86400 ≤1d · r604800 ≤7d · r2592000 otherwise
  "rows": 60,
  "workplaceType": "remote"   // only when work_mode === 'remote'
}

// valig/indeed-jobs-scraper
{
  "position": "Backend Engineer",
  "location": "Bengaluru",
  "country": "in",            // MUST be lowercase — uppercase is rejected
  "maxItems": 60,
  "fromDays": 30,
  "remote": true              // only when work_mode === 'remote'
}

// blackfalcondata/naukri-jobs-feed
{
  "keyword": "Backend Engineer",
  "location": "Bengaluru",
  "freshness": 30,            // sent, but does NOT reliably filter
  "maxResults": 60,
  "experience": 3             // only when experience_min_years is set
}
```

## A.5 What `normalize` produces

Every adapter returns the same `NormalizedJob` shape. The writer adds `id`,
`userId`, `dedupeKey`, `firstSeenAt`, `lastSeenAt`, `repostCount` and
`credibilityFlags`.

```ts
{
  title, companyName, location, isRemote,
  employmentType, workMode,
  experienceMinYears, experienceMaxYears,
  salaryMin, salaryMax, salaryCurrency, salaryPeriod, salaryDisclosed,
  descriptionFull,          // HTML-stripped, required — row dropped without it
  postedDate, applicantCount,
  source, sourceUrl, applyUrl,
}
```

Candidate keys read per field (first non-empty wins) — this is where to look
first when a source returns thin results:

| Field | Keys tried |
|---|---|
| title | `title`, `jobTitle`, `position`, `positionName`, `designation` |
| company | `companyName`, `company`, `organization`, `employer`, `employerName` |
| description | `descriptionText`, `description`, `jobDescription`, `descriptionHtml`, `jobDetails` |
| posted | `postedAt`, `publishedAt`, `postedDate`, `listedAt`, `postingDateParsed`, `createdDate` |
| apply URL | `applyUrl`, `applicationUrl`, `externalApplyLink`, `jdURL`, `url` |

---

# Appendix B — Bedrock wire format

`MAX_TOKENS = 4000` for every call (`src/lib/bedrock.ts`).

## B.1 Claude — text (score, deep analysis)

```http
POST https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages
Authorization: Bearer <BEDROCK_API_KEY>
Content-Type: application/json
anthropic-version: 2023-06-01

{
  "model": "anthropic.claude-sonnet-5",
  "max_tokens": 4000,
  "system": "<SCORE_SYSTEM or ANALYSE_SYSTEM>",
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "<buildUserText>" }] }
  ]
}
```

Read from the response: `stop_reason` (`refusal` and `max_tokens` each get their
own error message), `content[]` filtered to `type === 'text'`, and
`usage.input_tokens` / `usage.output_tokens`.

## B.2 Claude — PDF (resume parse)

Same endpoint and headers; the document block goes **before** the text block.

```jsonc
{
  "model": "anthropic.claude-sonnet-5",
  "max_tokens": 4000,
  "system": "<PARSE_SYSTEM>",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "document",
        "source": { "type": "base64", "media_type": "application/pdf", "data": "<base64>" } },
      { "type": "text", "text": "Extract this resume." }
    ]
  }]
}
```

Base64 comes from `new File(localUri).base64()` on the cached local copy — the
file is never re-downloaded to parse it.

## B.3 OpenAI — Responses API

Same bearer token, different host path, no `anthropic-version` header.

```jsonc
// POST .../openai/v1/responses
{
  "model": "openai.gpt-5.6-terra",
  "max_output_tokens": 4000,
  "instructions": "<system prompt>",
  "input": [{
    "role": "user",
    "content": [
      // PDF calls only:
      { "type": "input_file", "filename": "resume.pdf",
        "file_data": "data:application/pdf;base64,<base64>" },
      { "type": "input_text", "text": "<user text>" }
    ]
  }]
}
```

Response text: prefer `output_text`; the Responses API offers it as a
convenience but does not promise it, so fall back to walking
`output[].content[].text`.

---

# Appendix C — The prompts, verbatim

## C.1 Resume parse

`src/features/resume/resumeStorage.ts` → `PARSE_SYSTEM`. User instruction is the
single line `Extract this resume.` alongside the PDF block.

```text
You extract structured data from resumes.

Return only a single JSON object with this shape, and no prose, no markdown
fences and no commentary:

{
  "skills": [string],
  "roles": [string],
  "experience": [{ "title": string, "company": string|null, "months": integer|null }],
  "projects": [{ "name": string, "summary": string|null }],
  "education": [{ "degree": string, "institution": string|null, "year": integer|null }]
}

Report only what the document states. Do not infer a skill from a job title, do
not estimate durations that are not given, and use null when the resume does not
supply a value — an absent value is more useful than a guessed one.

"months" is the total duration of a role in months, and only when the resume
gives enough date information to compute it. List skills as the resume names
them; do not expand abbreviations or normalise spellings.
```

## C.2 Score

`src/features/scoring/scoreJob.ts` → `SCORE_SYSTEM`.

```text
You assess how well a candidate matches a job.

Return ONLY a JSON object, no prose and no code fence:
{
  "score": <integer 0-100>,
  "band": "strong" | "good" | "stretch" | "weak",
  "matched_skills": [<string>],
  "missing_skills": [<string>],
  "rationale": "<two sentences, plain language, addressed to the candidate>",
  "improvement_suggestions": [<string>]
}

Bands: strong = meets nearly every requirement; good = meets the core
requirements with minor gaps; stretch = meaningful gaps but a credible
application; weak = not a realistic fit.

Judge against what the description actually requires. Do not reward keyword
overlap that is not backed by real experience, and do not penalise a candidate
for requirements the description does not state.
```

## C.3 Deep analysis

`src/features/scoring/scoreJob.ts` → `ANALYSE_SYSTEM`.

```text
You give a candidate a detailed read on one job.

Return ONLY a JSON object, no prose and no code fence:
{
  "summary": "<a short paragraph on the fit>",
  "strengths": [<string>],
  "gaps": [<string>],
  "interview_focus": [<string>],
  "application_advice": [<string>]
}

Be specific and honest. Name the real gaps rather than softening them, and make
every piece of advice something the candidate can act on this week.
```

## C.4 The user turn (score and analysis share it)

`buildUserText(job, resume)`. The description is truncated at
`MAX_DESCRIPTION_CHARS = 6000` — the tail rarely carries requirements worth
paying for.

```text
<resume>
{"skills":["python","postgres"],"roles":["Backend Engineer"],"experience":[…]}
</resume>

<job>
Title: Backend Engineer
Company: Acme
Location: Bengaluru

<description_full, first 6000 chars>
</job>
```

## C.5 Why the prompts look like this

- **JSON asked for in prose, not enforced by a schema.** Neither provider
  supports structured outputs on Bedrock, and forced `tool_choice` has
  model-specific restrictions there. `extractJson()` plus a validator was always
  the real gate, so the schema layer would have been re-checking work already
  being done.
- **"no prose and no code fence"** is stated because models fence JSON anyway.
  `extractJson()` strips a fence and falls back to the outermost brace pair, so
  the instruction is a cost saving rather than a correctness guarantee.
- **Nulls, not omissions, in the parse schema.** Nulls are stripped at
  validation so an unknown value round-trips as an absent key — never `0` or
  `""` (hard rule 7).
- **The score prompt names both failure modes** (rewarding bare keyword overlap,
  penalising unstated requirements) because both showed up as plausible-looking
  wrong scores in the shapes this replaced.
