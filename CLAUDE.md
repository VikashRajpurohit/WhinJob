# Job Hunt Assistant

React Native (Expo) app that crawls job postings via Apify, scores them against the user's resume with the Claude API, and tracks applications. Offline-first. iOS first, Android second.

Full spec: `@docs/requirements.md` — read it when working on a feature, not every session.
Progress: `docs/progress.md` — tick boxes as work lands.

## Commands

```
npx expo start              # dev server
npx expo run:ios            # local iOS build
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
npm run db:generate         # drizzle-kit generate — run after every schema.ts change
npx expo export --platform ios   # proves the bundle resolves (catches @/ alias breakage)
npx supabase functions serve     # Edge Functions locally
npx supabase db push             # apply migrations to remote
```

## Stack

- Expo + TypeScript, EAS Build with OTA channels
- SQLite + Drizzle (local, source of truth for all reads)
- Supabase: Postgres, Auth, Storage, Edge Functions (Deno)
- Apify + Bedrock (Claude and OpenAI via Mantle) — called **directly from the app** with the
  user's own keys. `supabase/functions/**` is dormant; see hard rule 1.

## Folder structure

```
App.tsx                    root: SafeAreaProvider → NavigationContainer → RootNavigator
db/schema.ts               Drizzle schema (local SQLite)
db/client.ts               expo-sqlite handle + drizzle instance
db/migrations/             generated, versioned — never hand-edited
src/navigation/            RootNavigator, AuthStack, TabNavigator, types.ts
src/screens/               one file per screen
src/components/            shared presentational components
src/features/              auth, resume, search, dashboard, tracker — hooks + logic
src/lib/                   supabase client, secure storage, formatting
src/sync/                  mutation queue, conflict resolution, pull cursor
src/theme/                 colour, spacing, radius, type tokens
supabase/functions/        search-jobs, score-jobs, analyse-job
supabase/functions/_shared/adapters/   linkedin, indeed, naukri
supabase/migrations/       Postgres migrations
docs/                      requirements.md, progress.md
```

Import via `@/*` → `src/*` and `@db/*` → `db/*`. Metro resolves these from `tsconfig.json`
paths; there is no Babel alias plugin, so keep the two in sync.

Navigation is **React Navigation configured directly** (not Expo Router). Adding a screen
means adding it to `src/screens/` and registering it in the relevant navigator plus
`src/navigation/types.ts`.

## Hard rules

These are project invariants. Breaking any of them is a bug, not a style choice.

1. ~~**No API keys on the device.**~~ Reversed 2026-08-18 (owner). V1 has **no Edge Functions**: Apify and Bedrock are called directly from the app, and the user supplies their own keys in Settings. Keys live in Keychain/Keystore via `secureStorage` — never in app config, a bundled `.env`, or `expo-constants`, and never committed. Each user pays for their own crawls and model calls.
2. **Model IDs are user-selected** in Settings and read at call time from `settingsStore`. Never hard-code a model string — downgrading must be a settings change, not an app release.
3. **Reads never hit the network.** Every read resolves from SQLite. The sync engine refreshes in the background.
4. **Scores are cached per `(job_id, resume_id)` and never re-run automatically.** Only on explicit user action. This is a cost constraint.
5. **Deep analysis fires on button tap, never on card open.** Opening a card must cost nothing.
6. **Crawl cap of 5 searches/user/day.** With no Edge Function, `runSearch` is the only enforcement point — a real limit for this build, not the advisory check the spec assumed. Restore server-side enforcement if the pipeline ever moves back off-device.
7. **Missing data renders as "N/A", never `0` or `""`.** Especially salary — undisclosed is a distinct state from out-of-range.
8. **RLS on every table.** A user reads and writes only their own rows.
9. **Auth tokens in Keychain/Keystore, never AsyncStorage.**

## Conventions

- Drizzle schema in `db/schema.ts`; every change gets a generated, versioned migration. Never hand-edit applied migrations.
- Each job source is an adapter implementing `buildInput → run → normalize → Job[]` in
  `src/features/search/adapters/`. Adding a source means adding an adapter and one entry in
  that folder's `index.ts`, not touching `runSearch`.
- Claude responses are validated against a schema before persistence. A malformed response fails that one job, never the batch.
- Raw model output is never rendered to the user.
- Match quality displays as a band (Strong / Good / Stretch / Weak) with the numeric score de-emphasised.
- Lists are virtualized. Target 60fps with 500+ rows.

## Apify actor quirks

Confirmed by live runs — these cost failed calls to discover. Full detail in
`expected_architecutre.md` §4.2:

- `valig/linkedin-jobs-scraper`: `datePosted` takes relative codes (`r86400`, `r604800`), not human strings like "Past week". Row count is `limit` (not `rows`); remote is `remote: ["1"|"2"|"3"]` (not `workplaceType`) — wrong names are accepted and silently ignored.
- `kaix/indeed-scraper` (current): `country: "IN"` uppercase works; always send a `fields=` projection (340 output fields). The lowercase-only rule applied to `valig/indeed-jobs-scraper`, a different actor.
- `valig/naukri-jobs-scraper` (current): `jobAge` is a string enum `"1"|"3"|"7"|"15"|"30"`; location must be the bare city (`Bangalore`); `sort: "date"` is rejected; combining `experience` with `jobAge` can return zero rows — retry unfiltered.
- `cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs`: `country` must be the full name (`"India"`); $0.05 actor start, so batch all terms into one run's `keywords` array.
- `themineworks/foundit-jobs-scraper`: filters a status row into the dataset — drop rows without a `title`; trust `posted_days_ago` over `posted_date_text`.
- Freshness filters are advisory on **every** source. Client-side date filtering is mandatory.

## How I want you to work

- **Plan before touching code.** Show me the plan, wait for approval, then implement.
- **Ask questions one at a time.** Don't batch five questions into one message.
- **Prefer small pasteable prompts over long explanations.**
- **Keep both branches working during migrations.** Never leave the app in a state where only the new path runs.
- Tick the relevant box in `docs/progress.md` when something is genuinely done and typechecks.

## Don't

- ~~Don't add dependencies without asking.~~ Lifted 2026-08-05 — dependencies can be added
  freely on this project. Use `npx expo install <pkg>` rather than `npm install` for anything
  with a native module, so versions stay aligned to the Expo SDK.
- Don't add V2 features (extra job sources, AmbitionBox, referral discovery, resume tailoring) — see the deferred list in the spec.
- Don't write excessive comments. Explain non-obvious decisions only.
- Don't auto-exclude jobs with undisclosed salary.