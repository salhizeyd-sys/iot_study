-- Sharara M4 Field Schema: devices, device_tokens, iot_telemetry, iot_commands + 30-day retention
-- Paste into Supabase Dashboard -> SQL Editor and run once.

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  name text not null,
  board text not null default 'esp32:esp32:esp32',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists devices_user_idea_idx on public.devices (user_id, idea_id);

alter table public.devices enable row level security;

drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  token_hash text not null unique,
  revoked boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists device_tokens_hash_idx on public.device_tokens (token_hash);
create index if not exists device_tokens_device_idx on public.device_tokens (device_id);

alter table public.device_tokens enable row level security;

drop policy if exists "own device tokens" on public.device_tokens;
create policy "own device tokens" on public.device_tokens
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.iot_telemetry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists iot_telemetry_device_created_idx
  on public.iot_telemetry (device_id, created_at desc);
create index if not exists iot_telemetry_user_created_idx
  on public.iot_telemetry (user_id, created_at desc);

alter table public.iot_telemetry enable row level security;

drop policy if exists "own telemetry" on public.iot_telemetry;
create policy "own telemetry" on public.iot_telemetry
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.iot_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  action text not null,
  value jsonb,
  executed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists iot_commands_pending_idx
  on public.iot_commands (device_id, executed_at, expires_at);

alter table public.iot_commands enable row level security;

drop policy if exists "own commands" on public.iot_commands;
create policy "own commands" on public.iot_commands
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Retention helper: delete telemetry older than 30 days
create or replace function public.cleanup_old_telemetry()
returns int
language plpgsql
security definer
as $$
declare
  deleted_count int;
begin
  delete from public.iot_telemetry
  where created_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Optional automatic daily schedule if pg_cron is enabled on your Supabase instance
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'sharara-cleanup-telemetry-daily',
      '0 3 * * *',
      $$select public.cleanup_old_telemetry();$$
    );
  end if;
exception when others then
  -- Ignore if pg_cron is unavailable on free plan; use cleanup-telemetry Edge Function instead
  null;
end $$;

-- Enable Realtime on devices, iot_telemetry, and iot_commands
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'devices'
  ) then
    alter publication supabase_realtime add table public.devices;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'iot_telemetry'
  ) then
    alter publication supabase_realtime add table public.iot_telemetry;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'iot_commands'
  ) then
    alter publication supabase_realtime add table public.iot_commands;
  end if;
end $$;
