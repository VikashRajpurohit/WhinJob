# Progress

Tick a box only when the work is done, typechecks, and runs. Claude Code can tick these itself.

Spec reference: `docs/requirements.md` v1.2

---

## Where things stand

**Last updated: 2026-08-18. Phases 0–3 complete. Phases 4–7 largely complete, rebuilt
on-device. Phase 8 (sync) and parts of 6/7 still open — see the gaps list below.**

### The V1 architecture changed: no Edge Functions

Owner decision, 2026-08-18. Everything runs on the device with the user's own keys:

- **Apify** is called from `src/lib/apify.ts` (start run → poll → drain dataset), driven by
  `src/features/search/runSearch.ts` and the adapters in `src/features/search/adapters/`.
- **Bedrock** is called from `src/lib/bedrock.ts` (plain `fetch` against the Mantle endpoints,
  bearer token, no SigV4 and no AWS SDK). Scoring and deep analysis live in
  `src/features/scoring/scoreJob.ts`; resume parsing moved out of `parse-resume` into
  `resumeStorage.parseResume`.
- **`supabase/functions/**` is now dormant.** `parse-resume/index.ts` still exists but nothing
  calls it, and `_shared/parsedResume.ts` was ported to `src/lib/parsedResume.ts` because
  `supabase/functions` is excluded from `tsconfig.json` and the two cannot share a file.
- Hard rule 1 in `CLAUDE.md` was reversed accordingly, and hard rule 6 (crawl cap) now names
  `runSearch` as the only enforcement point.

**Consequence worth remembering:** the daily cap and the spend ceiling are client-side only.
A user who reinstalls or edits local state gets a fresh allowance. That is acceptable while
each user pays with their own key, and stops being acceptable the moment anyone else does.

### Shipping: which command reads which env

This is what broke build 2 and build 3, so it is worth stating plainly.

- **`npm run build:*` builds in the cloud.** It never sees your local `.env` — that file is
  gitignored and is not uploaded. It reads the EAS environment named by `environment` in
  `eas.json`. If those variables are missing, `src/lib/env.ts` throws at module scope and the
  app dies on launch with no error screen.
- **`npm run update:*` bundles locally** and is pinned to `--environment production` /
  `preview` so it uses the same EAS variables the build used, rather than whatever happens to
  be in your local `.env`.
- **`npm run env:push`** copies your local `.env` into all three EAS environments. Run it
  after changing a key; it is the only step that keeps the two in sync.
- OTA cannot rescue a crash-on-launch: the throw happens during bundle evaluation, before
  expo-updates can apply anything. A broken launch always needs a new binary.

### Known gaps (not started, not fudged)

1. **Prompt caching is not implemented.** No `cache_control` breakpoints anywhere, and Bedrock
   has no automatic caching — so the §6.5 cost model, which assumes caching, understates real
   scoring cost by roughly 2×.
2. **No monthly spend ceiling or cheaper-model fallback** (Phase 4).
3. **Per-search token spend is not written back** to `searches.input_tokens` / `output_tokens`;
   the columns exist and stay at 0.
4. **Tracker has no edit form** for referral, recruiter, follow-up or notes fields. The schema
   and the queries support them; only the UI is missing (FR-7.2).
5. **No follow-up notifications** (FR-7.6).
6. **No search-history view** (FR-8) — `useJobCardsForSearch` and `windowBreakdown` exist unused.
7. **DOCX resumes cannot be parsed on-device.** PDF only; DOCX returns a clear message asking
   for a re-upload. The Deno function had an unzipper, the client does not.
8. **Phase 8 (durable mutation queue, conflict resolution, pull cursor) is untouched.**
9. **None of this has run on a device.** Typecheck, lint and `expo export` all pass; that is
   the whole of the evidence.

This section is the session handoff. Read it first; it should be enough to resume with no
prior chat history. Update it whenever a phase closes.

### A paused project looks deleted — don't panic

A Supabase project that has auto-paused (or is mid-restore) **drops its DNS record**:
`<ref>.supabase.co` returns NXDOMAIN, every MCP SQL call times out, and
`get_publishable_keys` fails. That is indistinguishable from a deleted project from the
outside, and it was misread as one during this session. It is not. Resume the project from
the dashboard and everything comes back untouched — no migration is lost.

Supabase work goes through the Supabase MCP (no Docker on this machine, so `supabase start`
and `supabase db push` are not the path). Files under `supabase/migrations/` are named to
match the remote migration versions and exist so the repo is the record; the MCP applied
them.

### What runs today

The app boots through `AppBootGate` (runs pending local migrations before anything renders)
into `AuthProvider`, then `RootNavigator` switches on the Supabase session: no session shows
the auth stack, a session shows the four tabs. Sign-up, sign-in and sign-out are real. The
Profile screen is a working form persisting to SQLite first and pushing to Postgres after,
and now links to a Resumes screen with upload, rename, replace-by-upload, set-default,
soft-delete, offline download and explicit Claude parsing. Dashboard, Search, Tracker and
JobDetail are still placeholders.

Remote Postgres has all 7 tables with RLS, the private `resumes` storage bucket with
owner-scoped `storage.objects` policies, and the security advisor reporting zero lints.
Local SQLite mirrors the schema at migration `0000`, plus a typed query API in
`src/features/*` covering all seven tables.

Verified on 2026-08-17: `npm run typecheck` clean, `npm run lint` clean,
`npx expo export --platform ios` bundles (1118 modules). `.env` now has both the project URL
and the publishable key. Auth, storage, sync and parsing have still **never been exercised
on a device** — that is the next thing to do.

`supabase/functions/**` is excluded from `tsconfig.json`, and Deno is not installed on this
machine, so the Edge Function is **entirely unchecked** — not compiled, not linted, not run.
Expect to iterate on it once it can actually be deployed.

### Blocked on the project owner

1. **AWS credentials** as Edge Function secrets. Claude is being called through AWS, not
   the direct Anthropic API (owner, 2026-08-17), so `parse-resume` needs
   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` rather than
   `ANTHROPIC_API_KEY`. Until they are set, `parse-resume` fails on every call. That path
   is handled (the resume uploads, `parse_error` is recorded, the raw file stays usable)
   but no resume will ever be parsed.
2. **`APIFY_TOKEN`** as an Edge Function secret, for Phase 4.
3. **Email confirmation.** Decide whether Supabase Auth requires it (dashboard →
   Authentication → Providers → Email). `SignUpScreen` already handles both paths: with
   confirmation on it shows a "check your inbox" state, with it off the session lands
   immediately and the tabs appear. Turning it off makes testing faster.
4. **EAS project link** — needs an interactive login:
   ```
   npx eas-cli login && npx eas-cli init   # writes extra.eas.projectId + updates.url into app.json
   ```
   `app.json` deliberately omits `extra.eas.projectId` and `updates.url` rather than
   stubbing them with empty strings, which would break the build.

### Decisions taken during Phase 3

- **Replacing a resume means uploading a new one and deleting the old**, not swapping the
  file under an existing row. Scores are cached per `(job_id, resume_id)` and never re-run
  automatically (hard rule 4), so reusing an id after the file changed would leave every
  cached score silently describing a document that no longer exists — an error the user
  could not detect. There is deliberately no "replace" button; upload-then-remove is the
  flow.
- Storage objects are **not** deleted on soft delete. A soft delete is reversible
  server-side and cached scores still reference the row; destroying the file would turn an
  undo into data loss.
- `parse-resume` builds its Supabase client from the **caller's JWT**, never the service
  role key, so RLS applies inside the function and it resolves `storage_path` from the row
  rather than trusting a path from the client.
- DOCX is unzipped and reduced to text inside the function (`_shared/docx.ts`, ~120 lines,
  no dependency) because the Claude document content block takes PDF, not DOCX. PDFs go
  straight through as a base64 document block.
- A parse failure returns **HTTP 200** with `ok: false`. It is a recorded outcome, not an
  error: the resume is uploaded and usable, only the structured extraction is missing
  (FR-3). Non-2xx is reserved for auth and bad requests.
- Claude output is constrained by a JSON schema *and* re-validated by
  `validateParsedResume` before persistence. Optional fields are declared nullable because
  strict schemas require every property in `required`; nulls are stripped so an unknown
  value is an absent key, never `0` or `""` (hard rule 7).
- Resume files cache to the **document** directory, not the cache directory — the OS may
  evict the cache directory under storage pressure, which would silently break offline
  access. §8 asks for encrypted storage; this relies on platform sandbox encryption (iOS
  Data Protection, Android FDE) rather than hand-rolled crypto.
- **Known §8 gap:** `parsed_json` lives in plain SQLite. `expo-sqlite` does not ship
  SQLCipher, so "parsed resume JSON in encrypted storage" is not met. Flagged for the
  Phase 9 security pass rather than silently claimed.
- `clearLocalData` now also wipes the cached resume files. Clearing rows alone would leave
  the previous account's PDFs on disk for the next sign-in.
- Sync pushes non-default rows before default ones. Postgres enforces one default per user
  with a partial unique index, so pushing in row order would hit the constraint about half
  the time.

### Decisions taken during Phase 2

- Session storage is a chunked SecureStore adapter (`src/lib/secureStorage.ts`). SecureStore
  rejects values over ~2KB and a Supabase session clears that, so values are split across
  numbered chunks with the base key holding the count. A missing chunk reads as absent
  rather than handing Supabase a truncated session.
- Auto-refresh is bound to `AppState`: it runs foregrounded only. A background timer firing
  against an expired token risks discarding queued offline mutations (FR-1).
- Sign-out wipes every local table (`src/features/auth/localReset.ts`). Without it a second
  account on the same device reads the first account's rows straight out of SQLite,
  bypassing RLS entirely.
- Profile writes go to SQLite first, then push. A failed push reports "saved on this device,
  will sync when you are back online" rather than an error, and leaves `syncedAt` null.
- `markProfileSynced` deliberately does not touch `updatedAt` — bumping it would make the
  local row look newer than the server's on the next hydrate and push the same row forever.
- Full last-write-wins conflict resolution is still Phase 8. Until then `hydrateProfile`
  takes the newer `updated_at` wholesale, which is correct for a single-device user.

### Decisions taken during Phase 1

- Every table carries `user_id`, including `jobs` and `job_scores`, so RLS is a single
  owner check rather than a join. Jobs are per-user rows; `dedupe_key` is unique per user.
- `set_updated_at` / `handle_new_user` are `security definer` with `search_path = ''` and
  have `EXECUTE` revoked from `anon`/`authenticated` — otherwise PostgREST exposes them
  as `/rpc/` endpoints (advisor lints 0028/0029).
- `handle_new_user` creates the `profiles` row at sign-up, so the client never has to
  distinguish "no profile yet" from "profile failed to load".
- Local encoding diverges from Postgres only in storage: epoch-ms integers for timestamps,
  JSON text for arrays and jsonb, 0/1 for booleans. Column names are identical so the sync
  layer maps field-for-field.
- `babel.config.js` now exists solely for `babel-plugin-inline-import`, which Drizzle's
  Expo migrator needs to import `.sql` files. Path aliases still resolve from
  `tsconfig.json`, not Babel.
- Score cache is a unique index on `(job_id, resume_id)` — re-scoring overwrites in place,
  so a cached pair can never accumulate rows (hard rule 4).

### Decisions taken during Phase 0

- Navigation is React Navigation configured directly, not Expo Router.
- `@/*` → `src/*` and `@db/*` → `db/*` resolve through `tsconfig.json` paths. Metro reads
  these natively (Expo SDK 50+); there is no Babel alias plugin to keep in sync.
- `userInterfaceStyle` is `light`. There is no dark theme and the spec does not ask for one;
  `src/theme/` would need light/dark variants before that changes.
- Tables were deliberately left out of `db/schema.ts` so Phase 1 generates one migration
  covering the whole model rather than accreting several.
- Dependencies may now be added freely (owner, 2026-08-05).

### Suggested Phase 1 order

1. Postgres schema + RLS in `supabase/migrations/` — server is the stricter of the two, so
   design it first.
2. Mirror into `db/schema.ts`, reusing the `timestamps` / `syncedAt` / `primaryId` helpers
   already there.
3. `npm run db:generate` for the first local migration; wire `drizzle-orm/expo-sqlite/migrator`
   into app startup.
4. Typed query layer in `src/features/*`, reads only against SQLite (hard rule 3).

---

## Phase 0 — Foundations

- [x] Expo + TypeScript project initialised (SDK 57, RN 0.86, React 19.2.3)
- [x] `eas.json` written with development / preview / production channels
- [ ] EAS project linked — needs interactive `eas login` && `eas init`
- [x] ESLint + tsc scripts wired (`npm run lint`, `npm run typecheck` — both clean)
- [x] React Navigation shell: root stack + auth stack + 4 tabs, placeholder screens
- [x] `supabase init` — local `config.toml` present
- [ ] Supabase remote project created and CLI linked — needs interactive `supabase login`
- [x] Drizzle + expo-sqlite installed, `db/schema.ts` and `db/client.ts` scaffolded
- [x] Folder structure agreed and documented in `CLAUDE.md`
- [x] Tab bar icons via `@expo/vector-icons` (Ionicons)

## Phase 1 — Data layer

- [x] Postgres schema: `profiles`, `resumes`, `searches`, `jobs`, `job_scores`, `applications`, `search_history_jobs`
- [x] RLS policies on every table (security advisor clean)
- [x] Local SQLite schema mirroring the above
- [x] First Drizzle migration generated and applied both sides
- [x] Typed query layer over SQLite

## Phase 2 — Auth and profile

Code complete, typechecks, lints and bundles. **Not yet exercised against the live
project** — `.env` needs `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` before a real sign-up can
run. Re-verify these five by signing up on a device once the key is in.

- [x] Email/password sign-up and sign-in (FR-1)
- [x] Token storage in Keychain/Keystore
- [x] Session persistence and transparent refresh
- [x] Profile screen and persistence (FR-2)
- [x] "Anywhere / Remote" handled as a distinct value, not an empty list

## Phase 3 — Resume management

Code complete, typechecks, lints and bundles. The bucket and its policies are applied.
**Nothing here has run on a device**, and `parse-resume` is undeployed and has never been
compiled (Deno is not installed here and `supabase/functions` is excluded from
`tsconfig.json`). Re-verify every box below against a real upload.

- [x] Upload to private Storage bucket, signed URL access
- [x] Multiple resumes, rename, replace, soft delete
- [x] Exactly one default enforced
- [x] Claude parse → `parsed_json` on upload (FR-3)
- [x] Parse failure surfaces clearly and does not block use of the raw file
- [x] Resumes readable offline

## Phase 4 — Crawl and model calls (on-device, was "Edge Functions")

- [x] `runSearch`: builds Apify inputs, runs actors, normalizes results
- [x] Source adapters for LinkedIn, Indeed, Naukri (with the actor quirks handled)
- [x] Dedupe by `dedupe_key` before persistence (FR-5.1)
- [x] Adaptive freshness window with `window_used_days` recorded (FR-4.3)
- [x] Crawl cap 5/user/day — client-side only, see the architecture note above (§7.3)
- [x] Scoring: batch at concurrency 3, compact schema
- [ ] Prompt caching — not implemented; Bedrock has no automatic caching
- [x] Deep analysis: on-demand, deep schema, explicit tap only
- [x] Response schema validation; one bad response fails one job only
- [x] Model IDs read from user settings, never hard-coded
- [ ] Monthly spend ceiling with fallback to cheaper model
- [ ] Per-search token spend logged

## Rev-2 accuracy work (expected_architecutre.md, implemented 2026-08-18)

Code complete and typechecks; **none of it has run against live actors yet** — the two new
actors (kaix/indeed, cheap_scraper/glassdoor) and the valig Naukri swap need one live search
to verify field names before trusting the normalizers.

- [x] Bedrock auth fixed: key sent as `x-api-key` (Bearer alone is bounced 401); error
      bodies surfaced with `error.type` + `request_id`; "Test connection" button in Settings
- [x] Orthographic query variants computed locally (E.1) — works with no Bedrock key
- [x] LinkedIn adapter field names fixed: `limit` and `remote: ["2"]` (§4.3)
- [x] Client-side date cutoff on every source, earliest date across merged copies (§3.4)
- [x] Location alias table, 12 Indian cities; dedupe key uses canonical city (§3.3)
- [x] Glassdoor adapter (Tier 1, one batched run, resumeKeywords free prefilter)
- [x] Foundit adapter (Tier 2, runs only when Tier 1 is thin; status-row filtered)
- [x] Indeed switched to kaix/indeed-scraper with `fields=` projection; ATS `urls.external`
- [x] Naukri switched to valig/naukri-jobs-scraper (`jobAge` string enum, bare city,
      zero-row retry without `experience`)
- [x] Prefilter gates: hard exclusions + lexical coverage; low-overlap jobs saved as
      `score_deferred`, scored on tap (§8.2)
- [x] Query expansion via model (C.2), cached per resume on the `resumes` row
- [x] Score rubric with 40/25/20/15 component sub-scores; bands 85/70/55 (C.3)
- [x] Deep analysis extended: screening questions, questions to ask, concerns (C.4)
- [x] Apply kit: bullets, cover note, referral DM, screening answers, do_not_claim (C.5)
- [x] Salary enrichment: lakh grouping, ₹4/yr LPA-typo rejection; careers-page resolution
      from Glassdoor corporateLink / Indeed website / known ATS hosts — never guessed (§7)
- [x] Dedupe title normalisation: req IDs, marketing prefixes, level suffixes, closed
      compounds; field-wise merge by source priority; `multi_sourced` flag (§6)
- [x] Recall audit recorded per search in `searches.recall_audit_json` (§3.6)

## Phase 5 — Search and matching

- [x] Filter UI (FR-4.1)
- [x] Tri-state salary filter; undisclosed never auto-excluded (FR-4.4)
- [x] Stage 1 local prefilter against `description_full`, not title (FR-5.2)
- [x] Stage 1 results render immediately; scores stream in (FR-5.3)
- [x] Score cache per `(job_id, resume_id)`; no auto re-run (FR-5.4)
- [x] Remaining daily allowance visible before committing to a search

## Phase 6 — Dashboard

- [x] Job cards with band, source pill, posted date, salary or "N/A"
- [x] Response-odds indicator from applicant count (FR-6.2)
- [x] Credibility flags with one-line reason (FR-6.3)
- [x] Band primary, numeric score secondary (FR-6.4)
- [x] "Analyse this job" button → on-demand deep analysis (§6.7)
- [x] Bookmark, hide, mark applied (FR-6.5)
- [x] Virtualized list — tuned (`windowSize`, `removeClippedSubviews`), never measured at 500 rows

## Phase 7 — Tracker and history

- [x] All 13 statuses (FR-7.1) — tracker filters on all, job detail exposes the four common ones
- [ ] Tracker fields incl. referral and recruiter details (FR-7.2) — schema and queries done, no UI
- [x] Append-only `status_history_json` (FR-7.3)
- [x] Referral sequencing guard (FR-7.4)
- [x] Duplicate application guard on `dedupe_key` (FR-7.5)
- [ ] Local notification follow-up reminders (FR-7.6)
- [ ] History views, all available offline (FR-8)

## Manual job entry (added 2026-08-18, not in the original spec)

- [x] Add a job by hand; scored and tracked identically to a crawled one

## Phase 8 — Offline and sync

- [ ] Durable mutation queue surviving force-quit (FR-9.4)
- [ ] Exponential backoff replay on reconnect
- [ ] Conflict resolution: last-write-wins per field; status history merges (FR-9.5)
- [ ] Incremental pull via sync cursor (FR-9.6)
- [ ] Offline-blocked actions fail with a clear message, not a silent queue (FR-9.3)

## Phase 9 — Ship

- [ ] Performance targets met (§9)
- [ ] Security pass against §8
- [ ] EAS build + OTA channel setup
- [ ] TestFlight
- [ ] iOS release
- [ ] Android pass

---

## Decisions log

Append when something changes mid-build. Date each entry.

- 2026-08-05 — Dependency restriction lifted by the owner. Packages can be added without asking; use `npx expo install` for anything with a native module.
- 2026-08-05 — Navigation: React Navigation configured directly, not Expo Router. Explicit navigator config over file-based routing; deep links for apply-URLs get hand-configured in Phase 6.
- 2026-08-05 — Auth session persisted through a chunked `expo-secure-store` adapter rather than AsyncStorage (hard rule 9). Chunking is required because SecureStore caps values at roughly 2KB and a Supabase session exceeds that.
- 2026-08-05 — Supabase work goes through the Supabase MCP against the remote project. No Docker on this machine, so the local CLI stack (`supabase start`, `db push`) is not available. `supabase/migrations/*.sql` files are written to match remote migration versions for the record.
- 2026-08-17 — Claude is called through AWS rather than the direct Anthropic API (owner). Edge Functions authenticate with AWS credentials; see the Phase 4 notes for the Bedrock vs Claude Platform on AWS split and its Batch API consequence.
- 2026-08-17 — A paused Supabase project returns NXDOMAIN and is externally indistinguishable from a deleted one. Resume it from the dashboard before concluding anything is lost; nothing was.
- 2026-08-17 — Replacing a resume creates a new row and soft-deletes the old one rather than swapping the file under the same id, so a cached `(job_id, resume_id)` score can never describe a document that no longer exists (hard rule 4).
- 2026-08-17 — Resume files cache to the app document directory and rely on platform at-rest encryption. `parsed_json` in plain SQLite is a known §8 gap (`expo-sqlite` has no SQLCipher); deferred to the Phase 9 security pass.
- 2026-08-18 — **No Edge Functions in V1** (owner). Apify and Bedrock are called directly from the app with the user's own keys, held in Keychain/Keystore. Reverses hard rule 1 and makes the crawl cap client-side. `supabase/functions/**` is dormant, not deleted.
- 2026-08-18 — Resume parsing moved on-device and is **PDF-only**. The Claude document block does not take DOCX, and the Deno unzipper has no client equivalent worth shipping; DOCX uploads get a clear "re-upload as PDF" message rather than a silent failure.
- 2026-08-18 — Manual job entry added at the owner's request. Custom jobs share the `jobs` table so scoring, the tracker and dedupe all work on them unchanged.
- 2026-08-05 — Opus 5 for both bulk and on-demand scoring. Bulk determines visibility, and a bad rank is invisible to the user in a way a bad explanation isn't. ~$30/user/month at the 5-search cap; mitigations in §6.6.
- 2026-08-18 — UI/UX pass. `src/theme/` gained elevation, tinted `tone` trios and a fuller type scale; the chip/card/badge/empty-state markup that had been copy-pasted across five screens is now one shared kit in `src/components/`. Presentation only — no data, scoring or sync path was touched, and all nine hard rules still hold. Two real defects fixed on the way: the tab navigator was rendering its own header above each screen's in-screen heading (duplicate titles on every tab), and the job and tracker lists claimed "nothing here yet" before the first SQLite read had returned. `useJobCards`, `useBookmarkedJobs` and `useApplications` now expose `loading` off `useLiveQuery`'s `updatedAt`, since `data` starts as `[]` and cannot distinguish the two states.