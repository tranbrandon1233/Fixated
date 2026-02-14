create extension if not exists pgcrypto;

create table if not exists public.youtube_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."Users"(id) on delete cascade,
  channel_id text not null,
  channel_name text not null,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel_id)
);

create table if not exists public.youtube_cached_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."Users"(id) on delete cascade unique,
  summary_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  refresh_job_id uuid
);

create table if not exists public.youtube_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."Users"(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  channels_total integer not null default 0,
  channels_processed integer not null default 0,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists youtube_connections_user_idx
  on public.youtube_connections (user_id);

create index if not exists youtube_refresh_jobs_user_requested_idx
  on public.youtube_refresh_jobs (user_id, requested_at desc);

alter table public.youtube_connections enable row level security;
alter table public.youtube_cached_summaries enable row level security;
alter table public.youtube_refresh_jobs enable row level security;

drop policy if exists youtube_connections_select_own on public.youtube_connections;
create policy youtube_connections_select_own
  on public.youtube_connections
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists youtube_cached_summaries_select_own on public.youtube_cached_summaries;
create policy youtube_cached_summaries_select_own
  on public.youtube_cached_summaries
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists youtube_refresh_jobs_select_own on public.youtube_refresh_jobs;
create policy youtube_refresh_jobs_select_own
  on public.youtube_refresh_jobs
  for select
  to authenticated
  using (user_id = auth.uid());
