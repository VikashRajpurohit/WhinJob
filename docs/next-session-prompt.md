# Next-session prompt

Paste this after `/clear` to resume with no prior chat history.

---

Continue the Job Hunt Assistant build. Read `docs/progress.md` first — the "Where things
stand" section is the handoff and is current as of the Phase 3 commit.

State: Phases 0–2 are done and committed. Phase 3 (resume management) is **code complete and
applied server-side, but has never run on a device.**

Remote Postgres has all 7 tables with RLS, the private `resumes` storage bucket with
owner-scoped `storage.objects` policies, and a clean security advisor. `.env` has the project
URL and publishable key. Local SQLite mirrors the schema at migration `0000` with a typed
query layer in `src/features/*`.

Two things are outstanding:

1. **`parse-resume` is undeployed and has never been compiled.** Deno is not installed here
   and `supabase/functions` is excluded from `tsconfig.json`, so the whole Edge Function is
   unchecked. Deploy it with `deploy_edge_function` (entrypoint plus the `_shared/*.ts`
   files) and expect to iterate on real errors.
2. **Claude is called through AWS now, not the direct Anthropic API** (owner decision,
   2026-08-17). `_shared/claude.ts` and `_shared/env.ts` still construct a direct
   `new Anthropic({ apiKey })` — they need swapping to the AWS client before deploy, and
   `supabase/functions/.env.example` needs AWS credentials in place of `ANTHROPIC_API_KEY`.
   Check `docs/progress.md` for whether Amazon Bedrock or Claude Platform on AWS was chosen;
   Bedrock prefixes model ids with `anthropic.` and has **no Batch API**, which doubles the
   bulk-scoring cost the spec's §6.5 model assumes.

Then actually exercise Phases 2 and 3 on a device: sign up, fill the profile, upload a PDF
and a DOCX resume, confirm `parsed_json` lands, set a default, rename, delete, and check a
resume still opens with the network off.

Supabase work goes through the **Supabase MCP**. There is no Docker on this machine, so
`supabase start` / `supabase db push` are not available — use `apply_migration` and
`deploy_edge_function`, and keep `supabase/migrations/` as the repo's record. If the MCP
suddenly goes unreachable and the project host returns NXDOMAIN, the project is **paused,
not deleted** — resume it from the dashboard.

Still open: EAS is not linked (`eas login && eas init`), so no device build yet.

After Phase 3 verifies, next is **Phase 4 — Edge Functions** (`search-jobs`, `score-jobs`,
`analyse-job`), which also needs `APIFY_TOKEN` set as a secret. The Apify actor quirks in
`CLAUDE.md` cost real failed calls to discover — read them before writing the adapters.

Work the way `CLAUDE.md` says: plan first and show me the plan before touching code, ask
questions one at a time, and tick `docs/progress.md` only when something genuinely works.
Run `npm run typecheck`, `npm run lint` and `npx expo export --platform ios` before you call
a phase done.
