# Job Hunt Assistant — architecture and prompt reference

Revision 2, written 2026-08-18. Supersedes the 2026-08-18 rev-1 note.
Companion to `docs/requirements.md` and `docs/progress.md`.

Rev-1 described a correct system that finds *some* of the right jobs. This
revision is about the part that was missing: **finding all of them**, across six
providers, and spending model tokens only on the ones worth scoring.

---

## 0. What changed, and why

| # | Change | Reason |
|---|---|---|
| 1 | Query **fan-out** — every search issues N title variants × M location aliases per source, not one query | A single query provably misses jobs. Evidence in §3.1. |
| 2 | Providers go from 3 → **6 core + 2 fallback** | LinkedIn/Indeed/Naukri alone leave Glassdoor-only and Foundit-only postings unreachable |
| 3 | Server-side freshness filters treated as **advisory on every source**, not just Naukri | Indeed returned a 30+ day row under `fromDays=3`; Naukri returned a May posting under a 3-day query |
| 4 | Scoring prompt now carries **explicit weights** (40/25/20/15) and returns component sub-scores | Rev-1's prompt gave bands with no rubric, so scores drifted between runs and couldn't be explained in the UI |
| 5 | New **apply-kit** prompt — tailored bullets, cover note, referral DM, screening answers | The gap between "this job scores 92" and "I sent an application" was entirely manual |
| 6 | New **query-expansion** prompt — the model generates the fan-out terms | Hand-maintained synonym lists rot; the resume already contains the vocabulary |
| 7 | **Two-stage prefilter** before any Bedrock call | Fan-out multiplies rows ~6×. Scoring all of them is unaffordable. |
| 8 | **Enrichment stage**: package normalisation + careers-page resolution | Both were listed as V2. Both are cheap now and change which job you click. |
| 9 | Adapter input corrections for LinkedIn and Naukri | Rev-1's documented field names don't match the live actor schemas — see §4.3 |

Hard rules 4, 5 and 7 from rev-1 are unchanged and still binding.

---

## 1. The one-line version

There is no server. The app calls Apify and Amazon Bedrock **directly from the
device** using keys the user pastes into Settings. Every read comes from local
SQLite; the network only ever writes into it.

```
Settings (Keychain)                          SQLite (every read)
  apifyToken ──┐                                     ▲
  bedrockApiKey│                                     │
  awsRegion    │                                     │
  model ids    │                                     │
               ▼                                     │
        expandQuery ──► Bedrock ──┐                  │
                                   │                 │
        runSearch ──► Apify ×6 ──► adapters ──► merge/dedupe
                                                     │
                                                     ▼
                                              prefilter (local)
                                                     │
                                                     ▼
                                       enrich ──► scoreJob ──► jobWriter ──┘
                                                     │
                                                     ▼
                                        analyseJob / buildApplyKit
                                              (explicit tap only)
```

---

## 2. Where things live

| Path | Job |
|---|---|
| `src/lib/apify.ts` | Start an actor run, poll it, drain its dataset |
| `src/lib/bedrock.ts` | One POST to Bedrock Mantle; text or PDF |
| `src/lib/parsedResume.ts` | Validates model output before it is persisted |
| `src/features/search/adapters/` | One file per job board |
| `src/features/search/expandQuery.ts` | **new** — resume → search term and location fan-out |
| `src/features/search/runSearch.ts` | The whole crawl pipeline |
| `src/features/search/prefilter.ts` | **new** — local lexical gate before any model spend |
| `src/features/search/useSearchRunner.ts` | Screen-facing state for one search |
| `src/features/enrich/careersPage.ts` | **new** — resolve a company's own careers URL |
| `src/features/enrich/salary.ts` | **new** — normalise LPA / per-month / per-year to one shape |
| `src/features/dashboard/jobWriter.ts` | Dedupe key, upsert, credibility flags, manual jobs |
| `src/features/scoring/scoreJob.ts` | Score, deep analysis, apply kit, sequential batch |
| `src/features/settings/settingsStore.ts` | Credentials and model choices |

---

## 3. Recall — the actual hard problem

You asked for a search that doesn't miss jobs. Be clear-eyed about the target:
**100% recall against "every job that exists" is not achievable** from scrapers.
Some postings never leave a company ATS, some are referral-only, some sit behind
a login the actor can't pass. What *is* achievable, and what this design targets:

> **≥95% recall against the union of what all six providers expose**, measured by
> the recall audit in §3.6.

That is a bar you can actually verify. Chasing anything above it wastes money.

### 3.1 Why one query per source misses jobs — the evidence

From the live runs in the 14 Aug session (Bangalore, React Native, 3-day window):

- LinkedIn was queried for `React Native Developer`. It returned 50 rows. It did
  **not** return the single best match found that day — a posting titled
  `SDE-II – ReactNative Developer`. That job existed only in the Naukri results,
  under the query `react native developer`, because LinkedIn's matcher didn't
  connect the closed-compound `ReactNative` to the query.
- The same day, a strong match titled `Front End React Native` appeared on Naukri
  and nowhere else. A search for "React Native Developer" does not reliably
  surface a job whose title leads with "Front End".
- Candescent posted the *same* requisition on LinkedIn, Indeed **and** Glassdoor
  with three different titles: `Software Engineer III – React Native dev+ Basics
  of Native IOS/Android`, `Software Engineer III - React Native + Basics of
  Native Android`, and `Staff Engineer - React Native developer`. Any single
  title query catches one of the three; dedupe collapses them afterwards.
- LinkedIn dated that Candescent requisition 10 Aug. Indeed dated the same
  requisition 11 Aug. A 3-day cutoff computed from a single source's date drops a
  job that a second source says is in range.

The lesson is not "LinkedIn is bad". It is that **each provider's matcher is a
different lossy function over the same corpus**, so recall comes from union, not
from picking the best provider.

### 3.2 Query fan-out

Every search expands into a term set before any actor is called.

```ts
const FANOUT_TERMS_MAX = 6;      // per source
const FANOUT_LOCATIONS_MAX = 3;  // per source
const PER_QUERY_LIMIT = 40;      // rows requested per (term × location)
```

Terms come from `expandQuery` (Appendix C.2) and always include:

1. The user's literal input, unmodified — never drop what they typed.
2. The closed-compound and spaced variants (`React Native` / `ReactNative` /
   `React-Native`). This one line would have caught the top-scoring job above.
3. The role-family generalisation (`Mobile Engineer`, `Mobile Developer`) — this
   is where Fluxton's `Mobile App Engineer` and NTT's `Mobile Developer` live.
4. The levelled forms the user's seniority maps to (`SDE II`, `Software Engineer
   III`, `Senior <role>`) — large firms title by level, not by stack.
5. The adjacent-stack form when the resume supports it (`Frontend Engineer`) —
   only when the resume actually shows that work, or precision collapses.

**Cap the fan-out.** Six terms is the point where marginal new jobs per rupee
falls off hard. Ten terms roughly doubles cost for single-digit new rows.

### 3.3 Location aliasing

The live data returned all of these as distinct location strings for one city:

```
Bengaluru, Karnataka, India   Bengaluru East, Karnataka, India
Bangalore Urban, Karnataka    Greater Bengaluru Area
Bangalore City, Bengaluru     Bengaluru Urban District, Karnataka
Bengaluru, India              bangalore
```

Two separate jobs here:

- **Query-side**: send `Bengaluru` to LinkedIn/Glassdoor, `Bengaluru, Karnataka`
  to Indeed, and lowercase `bangalore` to Naukri. Naukri's location matcher is
  the fussiest of the six — it returned zero rows for `Bengaluru, Karnataka,
  India` and forty for `Bangalore`.
- **Storage-side**: `normalizeLocation()` folds all of the above to a canonical
  `bengaluru` for the dedupe key, while `location` keeps the original string for
  display. Never dedupe on the raw string.

Ship a static alias table for the top 12 Indian tech cities. It is 40 lines and
it removes an entire class of duplicate rows.

### 3.4 Never trust a server-side freshness filter

Rev-1 flagged this for Naukri only. It is true of **every source tested**:

| Source | Filter sent | What came back |
|---|---|---|
| Naukri | `jobAge: "3"` | a 7 Aug row and a 26 May row inside the results |
| Indeed | `fromDays: "3"` | a row labelled `30+ days ago` |
| LinkedIn | `datePosted: r604800` | honoured, but `postedDate` is day-granular with no time |
| Glassdoor | `datePosted: "3"` | honoured; `ageInDays` is reliable |
| Foundit | `postedWithinDays: "3"` | `posted_date_text` said "3 days ago", `posted_days_ago` said 2 — the two disagree |

So: **send the filter anyway** (it reduces billed rows, which is real money), then
apply the authoritative cutoff client-side over the merged set. The filter is a
cost optimisation, never a correctness guarantee.

For the date itself, prefer in order: an ISO `postedDate` → an epoch → a
`postedTimeAgo` phrase parsed relative to `dateScraped`, not to `Date.now()`.
When two sources disagree on a deduped job, **keep the earliest** — a job first
seen 3 days ago is 3 days old regardless of which portal re-listed it today.

### 3.5 Widen, then filter — never the reverse

Unchanged from rev-1 and worth restating because fan-out makes it more important:
crawl at `MAX_WINDOW_DAYS` once, filter client-side. If fewer than
`MIN_RESULTS_BEFORE_WIDENING` survive the requested window, keep the wider set
and set `windowUsedDays` so the UI can say "only 4 jobs in 3 days — showing the
last 7" instead of showing an empty screen.

### 3.6 The recall audit

This is the feature that tells you whether any of the above is working. Behind a
developer toggle, log per search:

```ts
type RecallAudit = {
  perSource: Record<JobSource, { rows: number; unique: number; cost: number }>;
  perTerm:   Record<string,    { rows: number; unique: number }>;
  overlapMatrix: Record<`${JobSource}|${JobSource}`, number>;
};
```

`unique` = jobs this source or term contributed that **no other** source or term
did. Read it monthly:

- A source with `unique: 0` across many searches is dead weight — drop it and
  bank the spend.
- A term with high `unique` is telling you the base query is too narrow.
- A high overlap between two sources means one of them can be demoted to a
  fallback tier.

Without this you are guessing about recall, and guessing about recall is how you
end up paying for six providers to return the same fifty rows.

---

## 4. Providers

### 4.1 The matrix

Tier 1 always runs. Tier 2 runs when Tier 1 returns under
`MIN_RESULTS_BEFORE_WIDENING` after filtering, or when the user pulls to refresh.

| Tier | Source | Actor | $/result | Verified | Best at |
|---|---|---|---|---|---|
| 1 | LinkedIn | `valig/linkedin-jobs-scraper` | 0.0004 | ✅ 50 rows | Applicant counts, product companies, recency |
| 1 | Naukri | `valig/naukri-jobs-scraper` | 0.0004 | ✅ 40 rows | **Salary bands** — best CTC coverage of the six |
| 1 | Indeed | `kaix/indeed-scraper` | 0.00005 | ✅ 36 rows | Cheapest by 8×; resolves ATS apply URLs |
| 1 | Glassdoor | `cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs` | 0.001 | ✅ 22 rows | **Company careers URL** + ratings; free keyword match |
| 2 | Foundit | `themineworks/foundit-jobs-scraper` | 0.0025 | ⚠️ 1 row | Skill arrays; thin inventory in RN/Bangalore |
| 2 | Naukri (deep) | `blackfalcondata/naukri-jobs-feed` | 0.0015 | — | AmbitionBox ratings, walk-in contacts |
| — | Multi-board | `openclawai/job-board-scraper` | 0.005 | ❌ failed | **Do not use as primary** — see §4.2 |
| — | LinkedIn (alt) | `curious_coder/linkedin-jobs-scraper` | 0.001 | — | Company enrichment, if `valig` degrades |

`$/result` excludes actor-start charges, which matter more than they look under
fan-out — see §4.4.

### 4.2 Verified quirks

These cost failed calls to find. Each one is a live-run finding.

**LinkedIn — `valig/linkedin-jobs-scraper`**
- `datePosted` is a relative-seconds enum: `r86400` (1d), `r604800` (7d),
  `r2592000` (30d). A human string like "Past week" is accepted and silently
  ignored — the worst failure mode there is.
- The row-count field is **`limit`**, not `rows`. The remote field is
  **`remote`**, an array of `"1"|"2"|"3"` (on-site/remote/hybrid), not
  `workplaceType`. Rev-1 documented both incorrectly.
- `applicationsCount` is a **string** — `"131 applicants"`, `"Over 200
  applicants"`, `"Be among the first 25 applicants"`. Parse to a number plus an
  `isEarlyApplicant` boolean; the "first 25" case is the highest-value timing
  signal the whole system produces.
- `applyUrl` comes back empty on most rows. Fall back to `url`.
- `postedDate` is midnight-granular. Don't compute hours from it.

**Naukri — `valig/naukri-jobs-scraper`**
- `jobAge` is a **string enum**: `"1"|"3"|"7"|"15"|"30"`. Integer `3` is rejected.
- `sort` is `"r"` (relevance) or `"f"` (fresh). `"date"` is rejected outright.
- **Combining `experience` with `jobAge` and `sort` returned zero rows** on a
  query that returned forty without the experience filter. Send `experience`
  only when the user explicitly sets it, and treat an empty result on a filtered
  query as a signal to retry unfiltered rather than as "no jobs exist".
- Location must be the bare city (`Bangalore`). Full addresses return nothing.
- `createdDate` is sometimes `0` and sometimes contradicts `createdDateText`.
  Prefer `createdDateText`.
- `salary.label` is a human string (`"12-22 Lacs"`, `"Not Disclosed"`, `"12,000"`).
  Parse in `enrich/salary.ts`, never render raw.
- `consultant: true` means a staffing intermediary. Surface it — it changes how
  the user reads the posting.

**Indeed — `kaix/indeed-scraper`**
- 340 output fields. Always project with `fields=` or you will blow the response
  budget on `classification.attributes.all.*`.
- `country: "IN"` uppercase **works** on this actor. The lowercase-only rule in
  rev-1 applies to `valig/indeed-jobs-scraper`, a different actor. If you swap
  actors, re-verify.
- `urls.external` is the resolved **ATS link** (Workday, Greenhouse, Lever,
  SmartRecruiters). This is the highest-value field any provider returns —
  applying at the ATS beats applying through the portal.
- `company.urls.website` gives the careers-page resolver a free head start.

**Glassdoor — `cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs`**
- `country` must be the **full display name** (`"India"`). ISO `"IN"` is rejected.
- `$0.05 actor-start` — by far the highest of the six. Batch all fan-out terms
  into the `keywords` array in **one run**; never one run per term.
- `resumeKeywords` runs a free keyword match server-side and returns
  `keywordMatchScorePercentage`. Feed it the parsed resume skills — it is a free
  prefilter signal, though never a substitute for the model score.
- `company.corporateLink` is the cleanest careers-page seed available anywhere.
- `applyUrl` is a tracking redirect. Store `jobUrl` as canonical.

**Foundit — `themineworks/foundit-jobs-scraper`**
- Returns a **status row mixed into the dataset** (`_type`, `jobs_scraped`,
  `message`). Filter rows without a `title` before normalising or you will write
  a junk job.
- Inventory is genuinely thin for RN/Bangalore — 1 real row against LinkedIn's
  50. Tier 2 is the right home for it. Re-evaluate quarterly via the recall audit.
- `posted_date_text` and `posted_days_ago` disagree. Trust the integer.

**`openclawai/job-board-scraper` — do not use as primary**
- Advertises five boards behind one call. In the live run Glassdoor returned
  `Proxy responded with non 200 code: 504 ETIMEDOUT` and Google returned empty,
  producing **one row that was a diagnostic message, not a job**.
- A multiplexed actor gives you one failure domain across five sources. Separate
  actors give you five independent ones, and §5 step 3 already tolerates a dead
  source. Keep it as an emergency fallback only.

### 4.3 Corrections to the current adapter inputs

Fix these in `adapters/` before shipping fan-out — the LinkedIn ones mean the
current build is silently ignoring two filters:

```diff
  // valig/linkedin-jobs-scraper
- "rows": 60,
- "workplaceType": "remote"
+ "limit": 40,
+ "remote": ["2"]        // "1" on-site · "2" remote · "3" hybrid

  // naukri — rev-1 documented blackfalcondata's field name
- "freshness": 30,
- "maxResults": 60,
+ "jobAge": "30",        // string enum, valig actor
+ "limit": 40,
```

### 4.4 What fan-out actually costs

Rows per search, six sources × six terms, before dedupe:

```
LinkedIn   6 terms × 40 = 240 rows × $0.0004  = $0.096  + $0.001 start
Naukri     6 terms × 40 = 240 rows × $0.0004  = $0.096  + $0.001 start
Indeed     6 terms × 40 = 240 rows × $0.00005 = $0.012  + $0.00001 start
Glassdoor  1 run, 6 keywords, 120 rows × $0.001 = $0.120 + $0.050 start
                                                  ───────
                                        Tier 1 ≈  $0.38 per search
```

At the 5-searches-per-day cap that is **~$1.90/day, ~$57/month** in crawl alone,
before a single Bedrock token. That number is the reason §8.2 exists.

Two levers, in order of effect:

1. **Drop `PER_QUERY_LIMIT` to 25.** Dedupe collapses most of the tail anyway;
   the live runs showed heavy overlap past row 25. Saves roughly 35%.
2. **Demote a Tier-1 source once the recall audit justifies it.** Glassdoor is
   the obvious candidate on cost — but it is also the only reliable source of
   careers-page URLs, so check the audit before cutting it.

---

## 5. The pipeline (`runSearch.ts`)

1. **Check the daily cap.** With no server this is the only enforcement point.
2. **Expand the query** (Appendix C.2). Cache the expansion per (resume, filters)
   hash — it changes only when the resume does, so this is one model call per
   resume, not per search.
3. Insert a `searches` row, status `pending`.
4. **Crawl Tier 1** at `MAX_WINDOW_DAYS` (30), all terms, in parallel across
   sources and sequential within a source. One dead source is collected into
   `sourceErrors` and never fails the search.
5. **Merge and dedupe** across sources (§6). Do this *before* filtering — a job
   dropped by one source's date field may survive on another's.
6. **Filter.** Undisclosed salary is never an exclusion reason (hard rule 7).
7. **Date-filter** to the requested window using the earliest date across merged
   copies. Under `MIN_RESULTS_BEFORE_WIDENING`, keep the wider set and record
   `windowUsedDays` (FR-4.3).
8. **Tier 2 if still thin.** Only now, and only if step 7 came up short.
9. **Prefilter** (§8.2) — local, free, no model call.
10. **Enrich** the survivors (§7).
11. **Rank** by lexical term coverage as a provisional order so the list is
    useful before scoring lands.
12. `upsertJobs` — dedupe key, link to the search with the frozen rank.
13. **Score sequentially** in the background so results stream in (FR-5.3).

Steps 4–7 are one crawl. Widening is a client-side decision over an
already-fetched superset, never a second round trip.

---

## 6. Dedupe

`makeDedupeKey` normalises title + company + location into
`backend-engineer|acme|bengaluru` — deliberately readable rather than hashed, so
a bad collapse is visible in the database instead of invisible. Unique per user.

Fan-out makes the title normalisation carry much more weight. It must strip:

- Requisition IDs — `[T500-28321]`, `(R0001807)`, `-INF(5-8)YRS`
- Level suffixes when they follow the stack — `SE III`, `IV`, `L2`
- Marketing prefixes — `Hiring For`, `Urgent`, `Walk-in ||`, `🔥`
- Punctuation and repeated whitespace, then lowercase

Then collapse closed compounds: `reactnative` → `react native`. Without that,
`SDE-II-ReactNative Developer` and `SDE II React Native Developer` are two rows.

**When a duplicate is found**, keep the original `firstSeenAt`, bump
`repostCount`, append the new source URL (the user still needs to choose where to
apply), take the **longer** description, and merge field-wise by source priority:

| Field | Preferred source |
|---|---|
| salary | Naukri → Glassdoor → Indeed |
| applyUrl | Indeed `urls.external` (ATS) → Glassdoor → LinkedIn |
| careersUrl | Glassdoor `company.corporateLink` → Indeed `company.urls.website` |
| applicantCount | LinkedIn only |
| postedDate | **earliest** across all copies |
| companyRating | Glassdoor → Naukri AmbitionBox |

A job present in 3+ sources gets `credibilityFlags.multiSourced` — genuinely
useful signal that a posting is real and actively distributed.

---

## 7. Enrichment

Both of these were V2 in rev-1. They are cheap and they change which job the
user clicks, so they move to V1.

**Salary (`enrich/salary.ts`).** Normalise every observed shape to
`{ min, max, currency, period, disclosed }`:

```
"12-22 Lacs"                 → { min: 1200000, max: 2200000, period: 'year' }
"₹7,00,000 - ₹8,00,000 a year" → { min: 700000, max: 800000, period: 'year' }
"₹10,000 - ₹20,000 a month"    → { min: 10000, max: 20000, period: 'month' }
"Not Disclosed" | ""          → { disclosed: false }
```

Two traps from the live data: Indian lakh formatting groups as `7,00,000` not
`700,000`, and one row returned `"₹4.00/yr - ₹6.00/yr"` — a recruiter typing LPA
into a rupee field. Reject any annual band under ₹50,000 as a data error rather
than showing the user a ₹4/year job.

Sort and filter on the **midpoint**, but always display the band. Never rank
undisclosed salary last by default — the highest-scoring job in the live run had
no band at all.

**Careers page (`enrich/careersPage.ts`).** In order, stop at the first hit:

1. Glassdoor `company.corporateLink` — already in the payload, free.
2. Indeed `company.urls.website` — already in the payload, free.
3. Indeed `urls.external` when the host is a known ATS (`*.myworkdayjobs.com`,
   `boards.greenhouse.io`, `grnh.se`, `jobs.lever.co`, `*.ripplehire.com`,
   `apply.workable.com`) — this is the direct apply link and beats a homepage.
4. Otherwise `careersUrl: null`. **Do not guess a domain from the company name.**
   In the live run only 3 of 22 companies exposed a verified URL; the rest were
   staffing firms with no careers page at all. A wrong link is worse than none.

Show the ATS link as the primary CTA when you have one. Portal-mediated
applications lose data; ATS applications don't.

---

## 8. Scoring

### 8.1 The rubric, made explicit

Rev-1's prompt asked for a score and bands with no stated weights, so nothing
anchored the number and it drifted between runs. The rubric is now in the prompt
and the model returns component sub-scores:

| Component | Weight | Anchors |
|---|---|---|
| Skills match | 40 | 36–40 core stack named in the title · 28–35 core stack in requirements · 18–27 adjacent stack, transferable · 0–17 different discipline |
| Experience fit | 25 | 23–25 stated band contains the candidate's years · 18–22 within 1 year of the band · 10–17 within 2–3 years · 0–9 beyond that |
| Role alignment | 20 | 18–20 same title family and level · 14–17 same family, ±1 level · 8–13 related function · 0–7 different function |
| Location fit | 15 | 14–15 target city, on-site or hybrid · 11–13 target city, arrangement unstated · 7–10 remote-eligible · 0–6 different city, no remote |

Returning sub-scores lets the job card show *why* something scored 84, and lets
you debug a bad score without re-prompting.

**Band thresholds** map to the dashboard badge colours already in use:
`strong ≥85` (green), `good 70–84` (blue), `stretch 55–69` (amber),
`weak <55` (gray).

### 8.2 Prefilter before you spend

Fan-out yields roughly 6× the rows. Scoring all of them is not affordable. Two
free gates run first, in `search/prefilter.ts`:

**Gate 1 — hard exclusions.** No model call. Drop when:
- The stated minimum experience exceeds the candidate's years by **more than 3**.
  (Three, not one. In the live run a 5–10 year posting was a legitimate stretch
  for a 3y11m candidate; an 8–13 year posting was not.)
- The title matches a disqualifier list — `Intern`, `Fresher`, `Walk-in`,
  `Trainee` — unless the user opted into them.
- The description is under 200 characters after HTML stripping. Nothing useful
  can be scored from it.

**Gate 2 — lexical coverage.** Count how many of the resume's top 20 skills
appear in the description. Below 2, defer rather than drop: keep the row, mark
`scoreDeferred: true`, and let the user tap to score it. This preserves recall —
the job is still visible and still applyable — while spending tokens on the
rows most likely to score well.

Typical effect: ~240 deduped rows → ~60 scored. That is the difference between
this being affordable and not.

Everything after the gates is unchanged from rev-1: sequential scoring so results
stream (FR-5.3), a cached score never re-runs automatically (hard rule 4), a
malformed response fails one job and never the batch.

One change worth making: run scoring at a **concurrency of 3**, not 1. Results
still stream into the list, and a 60-job batch finishes in a third of the time.

---

## 9. Bedrock

Unchanged from rev-1 and correct. Restated for completeness.

**Auth.** A Bedrock **API key** as a bearer token — *not* an AWS access key and
secret. Hence no SigV4, no AWS SDK. Plain `fetch`; the Anthropic SDK pulls Node
shims that don't belong in a React Native bundle.

```
https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages    ← Claude
https://bedrock-mantle.{region}.api.aws/openai/v1/responses      ← OpenAI
```

Routing by model-id prefix (`providerFor`). Model ids come from Settings, never
hard-coded, so downgrading is a settings change and not a release.

**Five call sites now:**

| Call | Where | Trigger |
|---|---|---|
| Resume parse | `resumeStorage.parseResume` | Upload, or explicit tap |
| Query expansion | `search/expandQuery` | On resume change — cached, not per search |
| Score | `scoring/scoreJob.scoreJob` | After a crawl, or explicit tap |
| Deep analysis | `scoring/scoreJob.analyseJob` | Explicit tap only (hard rule 5) |
| Apply kit | `scoring/scoreJob.buildApplyKit` | Explicit tap only |

**Output handling.** Neither provider supports structured outputs on Bedrock, so
the model is asked for raw JSON and the result is validated before anything is
written: `extractJson()` strips a fence or falls back to the outermost brace
pair, then `validateScore` / `validateAnalysis` / `validateParsedResume` /
`validateApplyKit` re-check the shape. Raw model output is never rendered.

---

## 10. Failure modes and what the user sees

Silent degradation is the thing to avoid. Every one of these has a visible state:

| Condition | State | UI |
|---|---|---|
| 1–2 sources failed | partial | "Searched 4 of 6 sources" + retry |
| All sources failed | error | Error with the first `sourceErrors` message |
| Fewer results than requested window | widened | "Only 4 in 3 days — showing last 7" |
| Naukri filtered query returned 0 | retried | Silent unfiltered retry; log to audit |
| Prefilter deferred a job | deferred | Gray "Tap to score" instead of a badge |
| Score validation failed | failed | "Couldn't score — retry" on that card only |
| No careers URL resolved | absent | Hide the link. Never show a guessed domain. |
| Daily cap reached | capped | Show remaining count and reset time |

---

# Appendix A — Apify wire format

```ts
const PER_QUERY_LIMIT = 40;
const FANOUT_TERMS_MAX = 6;
const FANOUT_LOCATIONS_MAX = 3;
const MAX_WINDOW_DAYS = 30;
const MIN_RESULTS_BEFORE_WIDENING = 8;
const POLL_INTERVAL_MS = 3000;
const POLL_CEILING_MS = 180000;
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

Actor ids are `user/name`; the REST path wants `user~name`. `pathId()` swaps it.

## A.2 Poll until terminal

```http
GET https://api.apify.com/v2/actor-runs/abc123?token=<APIFY_TOKEN>
```

Every 3s, ceiling 180s. Terminal: `SUCCEEDED`, `FAILED`, `ABORTED`, `TIMED-OUT`.
A single failed poll is ignored and retried on the next tick. Anything other than
`SUCCEEDED` throws `ApifyError` — a half-populated dataset would silently read as
"this search found little", which is worse than a visible error.

Not `run-sync-get-dataset-items`: the synchronous endpoint caps out well below a
real crawl.

## A.3 Drain the dataset

```http
GET https://api.apify.com/v2/datasets/def456/items?token=<APIFY_TOKEN>&clean=true&format=json&fields=<projection>
```

Returns a bare JSON array — **no `data` wrapper**, unlike A.1/A.2.

Always send `fields=`. The Indeed actor exposes 340 fields and will otherwise
return several hundred KB of taxonomy codes per run.

## A.4 What each adapter sends

`windowDays` is always `MAX_WINDOW_DAYS` at call time; the requested window is
applied client-side afterwards.

```jsonc
// valig/linkedin-jobs-scraper — one run per term
{
  "title": "React Native Developer",
  "location": "Bengaluru",
  "datePosted": "r2592000",     // r86400 ≤1d · r604800 ≤7d · r2592000 otherwise
  "limit": 40,                  // NOT "rows"
  "remote": ["2"]               // NOT "workplaceType"; omit unless remote-only
}

// kaix/indeed-scraper — one run per term
{
  "keyword": "React Native Developer",
  "location": "Bengaluru, Karnataka",
  "country": "IN",              // uppercase OK on THIS actor
  "maxItems": 40,
  "fromDays": "30",
  "sort": "date"
}

// valig/naukri-jobs-scraper — one run per term
{
  "keywords": "react native developer",
  "location": "Bangalore",      // bare city only
  "jobAge": "30",               // STRING enum: 1|3|7|15|30
  "limit": 40
  // "sort": "f"                 → omit; "date" is rejected
  // "experience": 4             → only when user-set; see §4.2
}

// cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs — ONE run, all terms
{
  "keywords": ["React Native Developer", "Mobile Engineer", "SDE II"],
  "country": "India",           // full name; "IN" is rejected
  "location": "Bangalore",
  "datePosted": "30",
  "maxItems": 120,
  "saveOnlyUniqueItems": true,
  "resumeKeywords": [
    { "keyword": "React Native", "aliases": ["RN"] },
    { "keyword": "TypeScript", "aliases": ["TS"] },
    { "keyword": "Expo" }
  ]
}

// themineworks/foundit-jobs-scraper — Tier 2
{
  "searchKeywords": ["react native", "mobile developer"],
  "location": "bangalore",
  "postedWithinDays": "30",
  "maxJobs": 25,
  "experienceMinYears": 3,
  "experienceMaxYears": 8
}
```

## A.5 What `normalize` produces

```ts
{
  title, companyName, location, locationNormalized, isRemote,
  employmentType, workMode,
  experienceMinYears, experienceMaxYears,
  salaryMin, salaryMax, salaryCurrency, salaryPeriod, salaryDisclosed,
  descriptionFull,          // HTML-stripped, required — row dropped without it
  postedDate, applicantCount, isEarlyApplicant,
  isConsultantPosting, companyRating,
  source, sourceUrl, applyUrl, careersUrl,
  keywordMatchPercent,      // Glassdoor only, free
}
```

The writer adds `id`, `userId`, `dedupeKey`, `firstSeenAt`, `lastSeenAt`,
`repostCount`, `credibilityFlags`, `scoreDeferred`.

Candidate keys per field, first non-empty wins — this is where to look first when
a source returns thin results:

| Field | Keys tried |
|---|---|
| title | `title`, `title.text`, `jobTitle`, `position`, `positionName`, `designation` |
| company | `companyName`, `company.name`, `company.companyName`, `organization`, `employer` |
| description | `descriptionText`, `description`, `description.text`, `jobDescription`, `descriptionHtml`, `snippet` |
| posted | `postedAt`, `publishedAt`, `postedDate`, `datePublished`, `dates.posted`, `listedAt`, `createdDate`, `createdDateText` |
| age | `ageInDays`, `posted_days_ago`, `dates.age`, `postedTimeAgo` |
| salary | `salary.label`, `salary.text`, `baseSalary_min`/`_max`, `salary.min`/`.max` |
| apply URL | `urls.external`, `applyUrl`, `apply.url`, `applicationUrl`, `jdURL`, `url` |
| careers URL | `company.corporateLink`, `company.urls.website`, `company.websiteUrl` |
| applicants | `applicationsCount`, `signals.applyCount`, `total_applicants` |

`adapters/shared.ts` coerces everything: `str()` / `num()` / `bool()` read the
first non-empty match, `toEpoch()` handles ISO strings, epoch numbers and
"3 days ago" phrases, `stripHtml()` makes the description matchable.

A row without a title or a description is dropped — FR-5.2 prefilters on
description content, so a job without one is unusable.

---

# Appendix B — Bedrock wire format

`MAX_TOKENS = 4000` for score, analysis and parse. `MAX_TOKENS = 2000` for query
expansion. `MAX_TOKENS = 6000` for the apply kit — it emits the most text.

## B.1 Claude — text

```http
POST https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages
x-api-key: <BEDROCK_API_KEY>
Content-Type: application/json
anthropic-version: 2023-06-01

{
  "model": "anthropic.claude-opus-5",
  "max_tokens": 4000,
  "system": "<SCORE_SYSTEM | ANALYSE_SYSTEM | APPLY_SYSTEM | EXPAND_SYSTEM>",
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
  "model": "anthropic.claude-opus-5",
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

Base64 from `new File(localUri).base64()` on the cached local copy — the file is
never re-downloaded to parse it. **PDF only**: the document block doesn't take
DOCX, and unzipping one on device means shipping a zip library for a format the
user can re-export in a click.

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
      { "type": "input_file", "filename": "resume.pdf",
        "file_data": "data:application/pdf;base64,<base64>" },
      { "type": "input_text", "text": "<user text>" }
    ]
  }]
}
```

Response text: prefer `output_text`; the Responses API offers it as a convenience
but doesn't promise it, so fall back to walking `output[].content[].text`.

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
  "primary_skills": [string],
  "roles": [string],
  "target_roles": [string],
  "total_experience_months": integer|null,
  "seniority": "entry" | "mid" | "senior" | "lead" | null,
  "experience": [{ "title": string, "company": string|null, "months": integer|null }],
  "projects": [{ "name": string, "summary": string|null, "tech": [string] }],
  "education": [{ "degree": string, "institution": string|null, "year": integer|null }],
  "current_location": string|null,
  "preferred_locations": [string],
  "notice_period_days": integer|null,
  "open_to_relocate": boolean|null
}

Report only what the document states. Do not infer a skill from a job title, do
not estimate durations that are not given, and use null when the resume does not
supply a value — an absent value is more useful than a guessed one.

"total_experience_months" comes from an explicitly stated total if the resume
gives one, otherwise from summing role durations, otherwise null. Never estimate
it from graduation year.

"primary_skills" is at most eight skills the resume itself emphasises — through a
summary line, a skills section ordering, or repetition across roles. If the
resume gives no signal about emphasis, return the same list as "skills" truncated
to eight rather than ranking them yourself.

"target_roles" comes only from an explicit objective, summary or headline. If the
resume states no target, return an empty array — do not infer one from history.

"seniority" is drawn from stated titles, not from years. A resume with a "Senior"
title is senior even at three years; a resume with no levelled title is null.

List skills as the resume names them; do not expand abbreviations or normalise
spellings. Return both forms when a resume uses both.
```

## C.2 Query expansion — **new**

`src/features/search/expandQuery.ts` → `EXPAND_SYSTEM`. Runs once per resume, not
per search. Cache on `hash(resumeId, filters)`.

```text
You generate job-board search queries.

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
boolean operators, no quotation marks, no wildcards.
```

**User turn:**

```text
<profile>
{"primary_skills":["React Native","TypeScript"],"seniority":"mid",
 "total_experience_months":47,"target_roles":["React Native Developer"]}
</profile>

<filters>
{"query":"React Native Developer","location":"Bangalore","work_mode":"any"}
</filters>
```

## C.3 Score

`src/features/scoring/scoreJob.ts` → `SCORE_SYSTEM`.

```text
You assess how well a candidate matches a job.

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
advice. Return an empty array rather than filler.
```

## C.4 Deep analysis

`src/features/scoring/scoreJob.ts` → `ANALYSE_SYSTEM`. Explicit tap only.

```text
You give a candidate a detailed read on one job.

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
on an application than by being encouraged into one.
```

## C.5 Apply kit — **new**

`src/features/scoring/scoreJob.ts` → `APPLY_SYSTEM`. Explicit tap only.
`max_tokens: 6000`.

```text
You help a candidate apply to one specific job.

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
protects the candidate. Populate it honestly even when it is long.
```

## C.6 The user turn (score, analysis and apply kit share it)

`buildUserText(job, resume)`. The description is truncated at
`MAX_DESCRIPTION_CHARS = 6000` — the tail rarely carries requirements worth
paying for.

```text
<resume>
{"skills":["react native","typescript","supabase"],"primary_skills":[…],
 "seniority":"mid","total_experience_months":47,"experience":[…],"projects":[…]}
</resume>

<job>
Title: SDE-II – ReactNative Developer
Company: Quarks Technosoft
Location: Bengaluru
Experience required: 3-6 years
Salary: not disclosed
Posted: 2026-08-13
Source: naukri
Applicants: not stated

<description_full, first 6000 chars>
</job>
```

Include the structured header fields even though they also appear in the
description. The model scores experience fit far more consistently when the band
is given as a field than when it has to be found in prose.

## C.7 Why the prompts look like this

- **JSON asked for in prose, not enforced by a schema.** Neither provider
  supports structured outputs on Bedrock, and forced `tool_choice` has
  model-specific restrictions there. `extractJson()` plus a validator was always
  the real gate, so a schema layer would re-check work already being done.
- **"no prose and no code fence"** is stated because models fence JSON anyway.
  `extractJson()` strips a fence and falls back to the outermost brace pair, so
  the instruction is a cost saving rather than a correctness guarantee.
- **Nulls, not omissions, in the parse schema.** Nulls are stripped at validation
  so an unknown value round-trips as an absent key — never `0` or `""` (hard
  rule 7).
- **The score prompt states weights and anchors.** Rev-1 gave bands with no
  rubric, which made scores unreproducible across runs and unexplainable in the
  UI. Component sub-scores also mean a bad score is debuggable without
  re-prompting.
- **"compute the components first, then add them"** is stated because models
  otherwise pick a plausible total and back-fill components to match, which
  produces a coherent-looking breakdown that isn't the reasoning behind the
  number.
- **The score prompt names both failure modes** — rewarding bare keyword overlap,
  penalising unstated requirements — because both showed up as plausible-looking
  wrong scores in the shapes this replaced.
- **The apply prompt's `do_not_claim` field exists to make honesty structural.**
  A prompt that only says "don't exaggerate" leaves the model no place to put
  what it noticed. Giving it a field means the constraint has somewhere to go and
  the candidate gets the warning as output.
- **The expansion prompt bans boolean operators** because the six actors parse
  the query field differently and several pass it through to a matcher that
  treats `OR` as a literal token.

---

# Appendix D — Cost worksheet

Per search, six terms, Tier 1 only, before dedupe:

| Line | Rows | Unit | Cost |
|---|---|---|---|
| LinkedIn crawl | 240 | $0.0004 | $0.096 |
| LinkedIn starts | 6 | $0.001 | $0.006 |
| Naukri crawl | 240 | $0.0004 | $0.096 |
| Naukri starts | 6 | $0.001 | $0.006 |
| Indeed crawl | 240 | $0.00005 | $0.012 |
| Glassdoor crawl | 120 | $0.001 | $0.120 |
| Glassdoor start | 1 | $0.05 | $0.050 |
| **Crawl subtotal** | | | **$0.386** |
| Scoring, post-prefilter | 60 jobs | ~$0.02 | $1.20 |
| **Per search** | | | **≈$1.59** |

At 5 searches/day: **~$8/day, ~$238/month**. Scoring dominates by 3:1, which is
the right conclusion to draw — the prefilter in §8.2 is worth more than any
crawl-side saving.

Three levers, largest first:

1. **Tighten Gate 2** to require 3 skill matches instead of 2. Roughly halves
   scored jobs. Deferred jobs stay visible and tappable, so recall is unaffected.
2. **Drop `PER_QUERY_LIMIT` to 25.** ~35% off crawl.
3. **Move deep analysis and apply kit behind a confirm dialog** showing estimated
   cost. They are already tap-only; making the spend visible stops accidental
   repeats.

Two structural limits worth stating plainly:

- **The daily cap and any spend limit are client-side only.** A reinstall resets
  the allowance. Acceptable while each user pays with their own key; stops being
  acceptable the moment anyone else does.
- **Prompt caching is not implemented** and Bedrock has no automatic caching, so
  the §6.5 cost model in `requirements.md` — which assumes it — understates real
  scoring cost by roughly 2×. The system prompt plus resume block is ~1.5k tokens
  resent on every one of the 60 scoring calls per search.

---

# Appendix E — Build order

If you implement one thing from this document, make it item 1. It is about
forty lines and it is the single largest recall win available.

1. **Orthographic variants in the query** (`React Native` / `ReactNative`).
   Catches the closed-compound miss from §3.1.
2. **Fix the LinkedIn adapter field names** (§4.3). Two filters are currently
   being ignored silently.
3. **Client-side date cutoff on every source** (§3.4). Correctness bug today.
4. **Location alias table** (§3.3). Kills a duplicate class and fixes Naukri.
5. **Glassdoor adapter.** Highest-value new source: careers URLs plus a free
   keyword prefilter.
6. **Prefilter gates** (§8.2). Required before fan-out is affordable.
7. **Full fan-out via `expandQuery`** (C.2).
8. **Score rubric with sub-scores** (C.3).
9. **Salary and careers-page enrichment** (§7).
10. **Recall audit** (§3.6). Do this before adding a seventh provider, so the
    decision is measured instead of guessed.
11. **Apply kit** (C.5).
12. **Foundit as Tier 2** (§4.1). Lowest yield of the six; last.