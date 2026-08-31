# Job Hunt Assistant — Requirements (V1)

**Status:** Draft for review
**Version:** 1.2
**Last updated:** 5 August 2026

---

## 1. Overview

A React Native (Expo) application that automates the job search lifecycle: the user uploads a resume, defines a profile, runs a live multi-portal crawl, gets AI-scored and ranked results, and tracks every application from discovery to offer.

The app is offline-first. Local storage is the primary data source; Supabase is the synchronization target.

### 1.1 V1 scope boundary

V1 ships with exactly two external services:

| Service | Purpose |
|---|---|
| **Apify** | Crawling job postings from LinkedIn, Indeed India, and Naukri |
| **Claude API** | Resume parsing, job analysis, match scoring, skill-gap analysis |

Supabase (Auth, Postgres, Storage, Edge Functions) is the backend and is not counted as an external integration.

### 1.2 Explicitly deferred to V2

These are designed-for but not built in V1. The integration layer must not assume only Apify and Claude exist.

- Additional job sources: Adzuna, Jooble, Hacker News "Who is Hiring", Remotive, RemoteOK, Wellfound
- Company enrichment: AmbitionBox ratings and salary bands, company logo resolution
- Careers-page resolver (auto-discovering `company.com/careers` and ATS board URLs)
- Referral contact discovery
- Resume tailoring (Claude rewriting bullets against a specific JD)
- Calendar integration, home-screen widget, share extension
- Additional AI providers

### 1.3 Non-goals for V1

- No web application. Mobile only (iOS + Android via Expo).
- No multi-user or team features. Single-user, single-device-primary.
- No automated application submission. The app takes the user to the apply link; it never submits on their behalf.
- No scraping of sites outside the Apify actors listed in §7.

---

## 2. Findings that shape this spec

These come from live Apify runs executed against the Bangalore React Native market on 3 August 2026. They are the empirical basis for several requirements below and should not be discarded during implementation.

| # | Finding | Requirement it drives |
|---|---|---|
| F1 | A strict 3-day freshness filter cut 94 raw results to 19; filtering further to genuine React Native roles left **2**. | FR-4.3 Adaptive freshness window |
| F2 | Product companies paying the top band (Swiggy, Flipkart, CoinDCX) post mobile roles as "SDE-2" with React Native only in the description body. Title-filtering hides them. | FR-5 Two-stage matching against full JD text |
| F3 | Salary was disclosed in 4 of 19 postings, then 2 of 12. | FR-4.4 Tri-state salary filter |
| F4 | Applicant count ranged from under 25 to over 200. This predicts response rate better than match quality does. | FR-6.2 Response-odds indicator |
| F5 | One employer appeared 4× in a single dataset; the same role appeared across LinkedIn, Naukri and Indeed. | FR-5.1 Deduplication before persistence |
| F6 | One Naukri listing had a hidden employer and a quoted band of ₹0.5–8 LPA — a staffing firm harvesting resumes. | FR-6.3 Listing credibility flag |
| F7 | Company careers-page URLs had to be found by manual web search. | Deferred to V2 (§1.2) |

---

## 3. Architecture

### 3.1 Stack

- **Client:** React Native (Expo SDK), TypeScript, EAS Build with OTA channels
- **Local store:** **SQLite with Drizzle ORM** (decided, OQ-1). The dataset is relational — jobs ↔ scores ↔ applications ↔ searches — and the dashboard and history views need real joins and indexed filtering. Drizzle gives typed queries and versioned migrations, matching the migration discipline already used on prior projects.
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions (Deno)
- **External calls:** **all outbound calls to Apify and Claude route through Supabase Edge Functions** (decided, OQ-2), never from the device. This is what keeps API keys off the client, makes the per-user crawl cap enforceable server-side, and allows the scoring model to be swapped without shipping an app update.

### 3.3 Launch platform

**iOS first, Android second** (decided, OQ-8). All code stays cross-platform; no iOS-only APIs are introduced without an Android fallback path. Android ships once iOS is stable, from the same codebase.

### 3.2 Layering

```
UI (screens, components)
  ↓
State layer (queries, optimistic mutations)
  ↓
Local persistence (source of truth for reads)
  ↓
Sync engine (mutation queue, conflict resolution, incremental pull)
  ↓
Supabase (Postgres + Edge Functions)
  ↓
Apify / Claude
```

Reads never hit the network directly. Every read resolves against local storage; the sync engine refreshes it in the background.

---

## 4. Data model (core entities)

Field lists are indicative, not exhaustive.

### `profiles`
`user_id`, `full_name`, `email`, `phone`, `total_experience_months`, `notice_period_days`, `preferred_locations[]`, `open_to_remote`, `preferred_roles[]`, `current_ctc`, `expected_ctc`, `updated_at`

### `resumes`
`id`, `user_id`, `display_name`, `storage_path`, `is_default`, `parsed_json`, `parsed_at`, `file_size`, `mime_type`, `created_at`, `deleted_at`

`parsed_json` holds the Claude-extracted structured resume (skills, roles, experience spans, projects) so it can be reused across scoring runs without re-parsing.

### `searches`
`id`, `user_id`, `filters_json`, `resume_id`, `window_requested_days`, `window_used_days`, `sources[]`, `raw_result_count`, `deduped_count`, `scored_count`, `apify_run_ids[]`, `status`, `created_at`

Persisting `window_requested_days` vs `window_used_days` is what lets the UI honestly label expanded results (F1).

### `jobs`
`id`, `dedupe_key`, `title`, `company_name`, `location`, `is_remote`, `employment_type`, `experience_min_years`, `experience_max_years`, `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `salary_disclosed` (bool), `description_full`, `posted_date`, `applicant_count`, `source`, `source_url`, `apply_url`, `first_seen_at`, `last_seen_at`, `repost_count`, `credibility_flags[]`

`description_full` is mandatory, not optional — FR-5 cannot work without it (F2).

### `job_scores`
`id`, `job_id`, `resume_id`, `search_id`, `band`, `score`, `matched_skills[]`, `missing_skills[]`, `rationale`, `improvement_suggestions[]`, `model_used`, `scored_at`

### `applications`
`id`, `job_id`, `user_id`, `status`, `date_applied`, `applied_via`, `referrer_name`, `referrer_profile_url`, `referral_notes`, `recruiter_name`, `recruiter_contact`, `follow_up_at`, `notes`, `status_history_json`, `updated_at`, `synced_at`

### `search_history_jobs`
Join table linking `searches` ↔ `jobs`, so history shows what a given search surfaced even after job records are updated.

---

## 5. Functional requirements

### FR-1 Authentication
- **Email/password only in V1** (decided, OQ-7). No OAuth providers at launch; the auth layer must not hard-code assumptions that block adding them later.
- Sign-up and sign-in via Supabase Auth
- Session persistence across app restarts; secure token storage in device keychain/keystore
- Session refresh handled transparently; expired-session state must not lose queued offline mutations

### FR-2 User profile
- Editable profile per §4 `profiles`
- Preferred locations support an explicit **"Anywhere / Remote"** option distinct from an empty list
- Profile is passed to Claude as scoring context alongside the resume

### FR-3 Resume management
- Upload multiple resumes (PDF, DOCX); store in Supabase Storage under a per-user path
- Rename, replace, soft-delete; exactly one `is_default` per user
- On upload, Claude parses the file once into `parsed_json`; parsing failures must surface a clear error and still allow the raw file to be used
- Resume selection is required before a search runs; default is pre-selected
- Resumes are available offline (cached locally after first fetch)

### FR-4 Job search configuration

**FR-4.1 Filters:** job title, skills, location, work mode (remote/hybrid/onsite), experience range, salary range, posted-within, employment type, company name (optional).

**FR-4.2 Fresh crawl:** tapping *Find Jobs* triggers a new Apify run using current filters. No serving of stale cached results as if fresh.

**FR-4.3 Adaptive freshness window (from F1):**
- The user's `posted-within` value is the *requested* window
- If deduped results fall below a configurable threshold (default 10), the system automatically widens the window in steps (3 → 7 → 14 days) up to a ceiling
- Results outside the requested window must be visually distinguished and grouped separately
- The UI states the outcome plainly, e.g. "2 within your 3-day window, 10 more from the past week"

**FR-4.4 Tri-state salary filter (from F3):**
- Salary filtering resolves to one of: in-range, out-of-range, **undisclosed**
- Undisclosed jobs are **never** auto-excluded by a salary filter
- The UI shows an explicit "undisclosed" state rather than a blank or a zero

### FR-5 Matching pipeline

Two stages, in this order:

**Stage 1 — local prefilter (no API cost).** All crawled jobs are deduplicated, credibility-flagged, and ranked by a local heuristic (keyword and skill overlap against `parsed_json` and profile). This stage reads `description_full`, not just the title (F2).

**Stage 2 — Claude scoring.** Only the top N from Stage 1 (default 20, user-adjustable within a cap) are sent to Claude.

**FR-5.3 Non-blocking scoring (decided, OQ-4).** A search returns Stage-1 results to the UI immediately, ordered by the local heuristic. Claude scoring runs in the background and results stream into the list as they arrive. The user is never blocked on scoring. Each card shows a pending state until its score lands. If the app is backgrounded or killed mid-run, scoring resumes or completes server-side and results appear on next open.

**FR-5.4 Score caching (decided, OQ-5).** Scores are cached per `(job_id, resume_id)` pair and are **never** re-run automatically — not on app reopen, not on a repeat search, and not when the user switches resumes. Switching to a resume with no cached score for a job triggers scoring for that pair once. Re-scoring an already-scored pair happens only on explicit user action ("Re-score with this resume"), which must show that it consumes budget. This is a deliberate cost constraint, not an optimisation to revisit.

**FR-5.1 Deduplication (from F5):** before persistence, collapse duplicates using a `dedupe_key` derived from normalized company + normalized title + normalized location, with a secondary fuzzy match on description similarity. Retain all `source_url`s for a collapsed job so the user can choose where to apply. Increment `repost_count` when the same key reappears in a later search.

**FR-5.2 Title-independence (from F2):** a job must be matchable on description content alone. A role titled "SDE-2" whose description requires React Native must score comparably to one titled "React Native Developer" with equivalent requirements.

### FR-6 Job dashboard

**FR-6.1 Card contents:** match band and score, company, title, location, salary (or explicit "Not disclosed"), experience required, source pill, posted date, applicant count, AI rationale, matched vs missing skills, apply link.

**FR-6.2 Response-odds indicator (from F4):** where the source exposes applicant count, display a competition signal alongside the match band. Low applicant counts are surfaced prominently — they are the highest-actionability signal in the dataset.

**FR-6.3 Credibility flag (from F6):** jobs are flagged, not hidden, when any of the following hold — employer identity withheld, salary spread exceeds a plausibility ratio, `repost_count` above threshold within 60 days, staffing-agency listing patterns. Flags are shown with a one-line reason.

**FR-6.4 Score presentation:** the primary display is a **band** — Strong / Good / Stretch / Weak — with the rationale beneath it. The numeric score is secondary and de-emphasised. AI scores are estimates and the UI must not imply measurement precision.

**FR-6.5 Actions:** bookmark, hide, mark as applied. Hidden jobs are excluded from future result lists but retained in history.

### FR-7 Application tracker

**FR-7.1 Statuses:** Saved · Applied · Referral Requested · Referral Received · Applied Through Referral · Applied Directly · Interview Scheduled · HR Round · Technical Round · Manager Round · Offer Received · Rejected · Accepted

**FR-7.2 Fields:** date applied, referrer name, referrer profile URL, referral notes, recruiter contact, follow-up reminder date, personal notes.

**FR-7.3 Status history:** every transition is appended to `status_history_json` with a timestamp. The tracker is an audit trail, not a single mutable field.

**FR-7.4 Referral sequencing guard:** most employers only credit a referral submitted *before* the candidate applies through the portal. If a job's status is *Referral Requested* and the user attempts to move it to *Applied Directly*, the app warns and requires confirmation.

**FR-7.5 Duplicate application guard:** if the user marks a job as applied and another job shares its `dedupe_key`, warn before allowing a second application to the same role via a different board.

**FR-7.6 Follow-up reminders:** local notifications fire on `follow_up_at`. V1 uses local notifications only; no server-side scheduling.

### FR-8 Job history
Views for: search history (with filters used and window outcome), all discovered jobs, applied, saved, rejected, hidden. All available offline.

### FR-9 Offline-first

**FR-9.1** All reads resolve from local storage. The app is fully navigable with no connectivity.

**FR-9.2** Offline-mutable: application status, all tracker fields, notes, bookmarks, hide/unhide, profile edits, resume rename and default selection.

**FR-9.3** Offline-blocked (require connectivity, must fail with a clear message rather than queue silently): running a new search, Claude scoring, resume upload of a file not yet cached.

**FR-9.4 Mutation queue:** durable, ordered, survives app restart and force-quit. Replays on reconnect with exponential backoff.

**FR-9.5 Conflict resolution:** last-write-wins per field, with the local `updated_at` compared against server. Status transitions are append-only and merge rather than overwrite.

**FR-9.6 Incremental pull:** sync fetches only records changed since the last successful sync cursor. Never a full table pull after first hydration.

---

## 6. Claude API integration

### 6.1 Uses in V1
1. Resume parsing → structured `parsed_json` (once per resume)
2. Job scoring → band, score, matched skills, missing skills, rationale, improvement suggestions

### 6.2 Cost controls (mandatory, not optional)

- **Prompt caching.** The resume and profile block is identical across every job in a scoring batch. It is cached once per run; only the job description varies per call. This is the single largest cost lever.
- **Prefilter before scoring.** Stage 1 (FR-5) must reduce the candidate set before any Claude call. Scoring 90 jobs when 12 are relevant is waste.
- **Batch API** for any non-interactive scoring run.
- **Model tiering.** A cheaper model handles bulk scoring; the stronger model is reserved for the top results the user actually reads. See Open Question OQ-3.

### 6.3 Output contract
Claude returns strict JSON against a fixed schema. Responses are validated before persistence; a malformed response fails that job's score rather than corrupting the batch. Raw model output is never rendered to the user (§FR-6.4).

### 6.4 Key handling
The Claude API key lives server-side only. It must never be bundled into the app, stored in Expo config, or reachable from the device.

### 6.5 Cost model

Token estimates below are derived from the actual 3 August 2026 runs: 94 raw results across three sources, 19 after freshness and dedupe, Stage-2 default of 20 jobs scored.

**Per scoring call:**

| Block | Tokens | Cacheable |
|---|---|---|
| Scoring instructions + JSON schema | ~600 | Yes |
| Parsed resume (`parsed_json`) | ~1,200 | Yes |
| User profile | ~150 | Yes |
| Job description (`description_full`) | ~1,000 | No — varies per job |
| Output (compact schema) | ~200 | — |
| Output (deep analysis schema) | ~600 | — |

**Per search of 20 jobs, with prompt caching:** ~26,300 billed-equivalent input tokens (one cache write at 1.25×, nineteen cache reads at 0.10×, plus 20,000 uncached JD tokens) against ~60,000 without caching. Caching removes roughly 56% of input cost.

**Rates as of 4 August 2026** (per million tokens, standard): Haiku 4.5 $1/$5 · Sonnet 5 $2/$10 · Opus 5 $5/$25. Cache reads bill at 10% of input. Batch API is 50% off both sides. Sonnet 5's $2/$10 is a promotional rate through 31 August 2026 — budget against $3/$15.

**Cost per search, batch-processed with caching:**

| Model | Bulk score, 20 jobs | At 5 searches/day |
|---|---|---|
| Haiku 4.5 | ~$0.023 | ~$3.45 / user / month |
| Sonnet 5 | ~$0.061 (promo) / ~$0.092 | ~$9.20–13.80 / user / month |
| Opus 5 | ~$0.116 | ~$17.40 / user / month |

Because OQ-6 caps usage at 5 searches per day, these are hard per-user ceilings, not averages.

### 6.6 Model tiering (decided, OQ-3)

**Claude Opus 5 for both bulk scoring and on-demand deep analysis.**

Rationale: bulk scoring determines which jobs the user sees at all. A weaker model at that stage silently buries good matches — an error the user can never detect, because they never see what was ranked out. Deep analysis quality is visible and correctable; ranking quality is not. The most consequential call gets the strongest model.

**Cost consequence, at the 5-search/day cap:**

| Stage | Model | Rate basis | Per search | Per user / month |
|---|---|---|---|---|
| Bulk, 20 jobs | Opus 5 | Batch, cached | ~$0.116 | ~$17.40 |
| On demand, ~4 jobs | Opus 5 | Standard, cached | ~$0.084 | ~$12.60 |
| **Total** | | | **~$0.20** | **~$30.00** |

This is roughly 6× the Haiku-bulk alternative (~$4.70/user/month). At single-user or small private-beta scale the absolute number is trivial and the quality is worth it. It stops being trivial somewhere around 30–50 active users.

**Required mitigations, given this choice:**

- Model IDs are environment variables read by the Edge Function at call time — never constants in the app bundle. Downgrading bulk to a cheaper model must be a config change, not an app release.
- A monthly spend ceiling is enforced server-side, independent of the per-day search cap. On breach, bulk scoring falls back to the cheaper model and the app states plainly that it has done so.
- Per-user and aggregate token spend is logged per search so the real cost curve is measured, not estimated.

### 6.7 On-demand deep analysis trigger

Deep analysis does **not** fire on card open. It fires on an explicit button tap on the job card ("Analyse this job" or equivalent). Opening a card must never incur cost. The button shows a clear pending state, and once generated the result is cached against the `(job_id, resume_id)` pair under the same no-auto-re-run rule as FR-5.4.

---

## 7. Apify integration

### 7.1 V1 actors

| Source | Actor | Notes |
|---|---|---|
| LinkedIn | `valig/linkedin-jobs-scraper` | `datePosted` takes relative-time codes (`r86400`, `r604800`), not human strings |
| Indeed India | `valig/indeed-jobs-scraper` | `country` must be lowercase (`in`); uppercase is rejected |
| Naukri | `blackfalcondata/naukri-jobs-feed` | Its `freshness` parameter did not reliably filter in testing — **client-side date filtering is required** |

These parameter quirks were confirmed by live runs and cost several failed calls to discover. They belong in the adapter code, not in tribal knowledge.

### 7.2 Source adapter contract
Each source implements a common interface: `buildInput(filters) → run() → normalize(rawItems) → Job[]`. Adding a V2 source means adding an adapter, not touching the pipeline. Field coverage varies by source; missing fields normalize to `null` and render as "N/A", never as `0` or an empty string.

### 7.3 Cost controls
- Track last-seen job IDs per source; skip re-scoring jobs already scored against the same resume
- Deduplicate before scoring, not after
- **Crawl budget: 5 searches per user per day** (decided, OQ-6), resetting at local midnight. Enforced **server-side in the Edge Function**, not in the client — a client-side check is a suggestion, not a limit.
- The remaining daily allowance is visible in the UI before the user commits to a search, not revealed only at the cap.
- At the cap, the *Find Jobs* action is disabled with the reset time shown. Cached and previously scored results remain fully browsable — hitting the cap degrades discovery, never access to existing data.

---

## 8. Security

- Claude and Apify keys server-side only (§6.4)
- Row Level Security on every table; a user reads and writes only their own rows
- Resume files in a private Storage bucket; access via short-lived signed URLs only
- Auth tokens in Keychain (iOS) / Keystore (Android), never AsyncStorage
- Locally cached resume files and parsed resume JSON stored in encrypted storage
- All validation enforced server-side regardless of client checks
- No PII in logs or analytics events

---

## 9. Performance targets

| Metric | Target |
|---|---|
| Cold start to interactive | < 2s |
| Dashboard list scroll | 60fps with 500+ jobs |
| Local read (cached list) | < 100ms |
| Search → first results visible | Progressive; Stage 1 results render before Claude scoring completes |
| Memory, 1000 jobs cached | No unbounded growth; list virtualization required |

Scoring must stream or render progressively. The user should never watch a blocking spinner while 20 jobs are scored serially.

---

## 10. UI principles

Clean, minimal, professional, fast. Functionality over visual complexity. Consistent spacing scale, one accent colour, no decorative animation on list surfaces. Every empty state explains what to do next.

---

## 11. Decisions

| # | Question | Decision | Where specified |
|---|---|---|---|
| OQ-1 | Local persistence | SQLite + Drizzle ORM | §3.1 |
| OQ-2 | External call routing | Supabase Edge Functions | §3.1 |
| OQ-3 | Model tiering | Opus 5 for both bulk and on-demand | §6.6 |
| OQ-4 | Blocking vs background scoring | Return Stage-1 immediately, score in background | FR-5.3 |
| OQ-5 | Score re-runs | Cached per (job, resume); manual re-score only | FR-5.4 |
| OQ-6 | Crawl budget | 5 searches per user per day, server-enforced | §7.3 |
| OQ-7 | Auth | Email/password only | FR-1 |
| OQ-8 | Launch platform | iOS first, Android second | §3.3 |

### 11.1 Status

All eight open questions are resolved. The document is ready for implementation planning.

---

## 12. Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 5 Aug 2026 | Initial draft. V1 scoped to Apify + Claude. Findings F1–F7 folded in from live Bangalore market runs. |
| 1.1 | 5 Aug 2026 | OQ-1, 2, 4, 5, 6, 7, 8 resolved and written into the relevant sections. Added §3.3 launch platform, FR-5.3 non-blocking scoring, FR-5.4 score caching, §6.5 cost model. OQ-3 remains open. |
| 1.2 | 5 Aug 2026 | OQ-3 resolved: Opus 5 for both bulk and on-demand. Added §6.6 model tiering with cost consequence and required mitigations, §6.7 on-demand trigger. All open questions closed. |