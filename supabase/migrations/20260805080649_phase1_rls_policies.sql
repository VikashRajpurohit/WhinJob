-- RLS on every table; a user touches only their own rows (hard rule 8).
-- auth.uid() is wrapped in a subselect so Postgres evaluates it once per query
-- rather than once per row.

alter table profiles            enable row level security;
alter table resumes             enable row level security;
alter table searches            enable row level security;
alter table jobs                enable row level security;
alter table job_scores          enable row level security;
alter table applications        enable row level security;
alter table search_history_jobs enable row level security;

create policy "profiles: owner select" on profiles for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: owner insert" on profiles for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles: owner update" on profiles for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "profiles: owner delete" on profiles for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "resumes: owner select" on resumes for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "resumes: owner insert" on resumes for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "resumes: owner update" on resumes for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "resumes: owner delete" on resumes for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "searches: owner select" on searches for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "searches: owner insert" on searches for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "searches: owner update" on searches for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "searches: owner delete" on searches for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "jobs: owner select" on jobs for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "jobs: owner insert" on jobs for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "jobs: owner update" on jobs for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "jobs: owner delete" on jobs for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "job_scores: owner select" on job_scores for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "job_scores: owner insert" on job_scores for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "job_scores: owner update" on job_scores for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "job_scores: owner delete" on job_scores for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "applications: owner select" on applications for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "applications: owner insert" on applications for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "applications: owner update" on applications for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "applications: owner delete" on applications for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "search_history_jobs: owner select" on search_history_jobs for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "search_history_jobs: owner insert" on search_history_jobs for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "search_history_jobs: owner update" on search_history_jobs for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "search_history_jobs: owner delete" on search_history_jobs for delete
  to authenticated using ((select auth.uid()) = user_id);

-- A profile row exists from the moment of sign-up, so the client never has to
-- distinguish "no profile yet" from "profile failed to load".
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
