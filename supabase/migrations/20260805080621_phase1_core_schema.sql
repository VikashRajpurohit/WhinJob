-- Phase 1 — core data model (spec §4).
-- Every table is user-scoped so RLS reduces to a single owner check (hard rule 8).

create type work_mode as enum ('remote', 'hybrid', 'onsite');
create type employment_type as enum ('full_time', 'part_time', 'contract', 'internship', 'temporary');
create type salary_period as enum ('year', 'month', 'week', 'day', 'hour');
create type job_source as enum ('linkedin', 'indeed', 'naukri');
create type match_band as enum ('strong', 'good', 'stretch', 'weak');
create type search_status as enum ('pending', 'crawling', 'prefiltered', 'scoring', 'complete', 'failed');
create type application_status as enum (
  'saved',
  'applied',
  'referral_requested',
  'referral_received',
  'applied_through_referral',
  'applied_directly',
  'interview_scheduled',
  'hr_round',
  'technical_round',
  'manager_round',
  'offer_received',
  'rejected',
  'accepted'
);

-- profiles ------------------------------------------------------------------
create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  total_experience_months integer,
  notice_period_days integer,
  -- Empty array and open_to_remote are distinct states; "Anywhere / Remote" is
  -- open_to_remote = true with no location constraint, not an empty list (FR-2).
  preferred_locations text[] not null default '{}',
  open_to_remote boolean not null default false,
  preferred_roles text[] not null default '{}',
  current_ctc numeric,
  expected_ctc numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- resumes -------------------------------------------------------------------
create table resumes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  storage_path text not null,
  is_default boolean not null default false,
  parsed_json jsonb,
  parsed_at timestamptz,
  parse_error text,
  file_size integer,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Exactly one default per user, ignoring soft-deleted rows (FR-3).
create unique index resumes_one_default_per_user
  on resumes (user_id)
  where is_default and deleted_at is null;
create index resumes_user_id_idx on resumes (user_id);

-- searches ------------------------------------------------------------------
create table searches (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  resume_id uuid references resumes (id) on delete set null,
  filters_json jsonb not null default '{}'::jsonb,
  -- Requested vs used is what lets the UI honestly label widened results (FR-4.3).
  window_requested_days integer,
  window_used_days integer,
  sources job_source[] not null default '{}',
  raw_result_count integer not null default 0,
  deduped_count integer not null default 0,
  scored_count integer not null default 0,
  apify_run_ids text[] not null default '{}',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  status search_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index searches_user_created_idx on searches (user_id, created_at desc);
create index searches_resume_id_idx on searches (resume_id);

-- jobs ----------------------------------------------------------------------
create table jobs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  dedupe_key text not null,
  title text not null,
  company_name text,
  location text,
  is_remote boolean,
  employment_type employment_type,
  work_mode work_mode,
  experience_min_years numeric,
  experience_max_years numeric,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period salary_period,
  -- Distinct from a null range: undisclosed is never the same as out-of-range (FR-4.4).
  salary_disclosed boolean not null default false,
  description_full text not null,
  posted_date timestamptz,
  applicant_count integer,
  source job_source not null,
  source_url text,
  -- Every collapsed duplicate keeps its URL so the user picks where to apply (FR-5.1).
  source_urls text[] not null default '{}',
  apply_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  repost_count integer not null default 0,
  credibility_flags jsonb not null default '[]'::jsonb,
  is_bookmarked boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index jobs_user_dedupe_key on jobs (user_id, dedupe_key);
create index jobs_user_posted_idx on jobs (user_id, posted_date desc);
create index jobs_user_visible_idx on jobs (user_id) where not is_hidden;

-- job_scores ----------------------------------------------------------------
create table job_scores (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  resume_id uuid not null references resumes (id) on delete cascade,
  search_id uuid references searches (id) on delete set null,
  band match_band not null,
  score integer not null,
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  rationale text,
  improvement_suggestions text[] not null default '{}',
  -- Deep analysis (§6.7) lands here on explicit tap; null until then.
  deep_analysis_json jsonb,
  deep_analysed_at timestamptz,
  model_used text not null,
  input_tokens integer,
  output_tokens integer,
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One cached score per pair; re-scoring overwrites, never accumulates (FR-5.4).
create unique index job_scores_job_resume_key on job_scores (job_id, resume_id);
create index job_scores_user_idx on job_scores (user_id);
create index job_scores_resume_id_idx on job_scores (resume_id);
create index job_scores_search_id_idx on job_scores (search_id);

-- applications --------------------------------------------------------------
create table applications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  status application_status not null default 'saved',
  date_applied timestamptz,
  applied_via text,
  referrer_name text,
  referrer_profile_url text,
  referral_notes text,
  recruiter_name text,
  recruiter_contact text,
  follow_up_at timestamptz,
  notes text,
  -- Append-only audit trail; sync merges rather than overwrites (FR-7.3, FR-9.5).
  status_history_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz
);

create unique index applications_user_job_key on applications (user_id, job_id);
create index applications_user_status_idx on applications (user_id, status);
create index applications_follow_up_idx on applications (user_id, follow_up_at)
  where follow_up_at is not null;

-- search_history_jobs -------------------------------------------------------
create table search_history_jobs (
  search_id uuid not null references searches (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Rank from the Stage-1 local prefilter, frozen at search time (FR-5).
  prefilter_rank integer,
  -- True when the job came from a widened window, so history can group it (FR-4.3).
  outside_requested_window boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (search_id, job_id)
);

create index search_history_jobs_job_id_idx on search_history_jobs (job_id);
create index search_history_jobs_user_id_idx on search_history_jobs (user_id);

-- updated_at ----------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger resumes_set_updated_at before update on resumes
  for each row execute function set_updated_at();
create trigger searches_set_updated_at before update on searches
  for each row execute function set_updated_at();
create trigger jobs_set_updated_at before update on jobs
  for each row execute function set_updated_at();
create trigger job_scores_set_updated_at before update on job_scores
  for each row execute function set_updated_at();
create trigger applications_set_updated_at before update on applications
  for each row execute function set_updated_at();
