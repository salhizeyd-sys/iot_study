-- Sharara M2 Initial Schema (ideas + idea_prototypes + RLS + Realtime)
-- Paste into Supabase Dashboard -> SQL Editor and run once.

create extension if not exists pgcrypto;

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schema_version int not null default 4,
  name text not null,
  domain text not null default 'عام',
  type text not null check (type in ('software', 'hardware', 'both')),
  status text not null default 'idea'
    check (status in ('idea', 'planned', 'doing', 'paused', 'done', 'dropped')),
  lifecycle text not null default 'idea'
    check (lifecycle in (
      'idea', 'cooldown', 'planned', 'prototype_generated',
      'reviewed', 'ready_to_flash', 'flashed', 'online', 'done'
    )),
  memory text not null default '',
  problem text not null default '',
  solution text not null default '',
  focus text not null default 'partial'
    check (focus in ('aligned', 'partial', 'distraction')),
  focus_note text not null default '',
  duration text not null default '',
  notes text not null default '',
  skills jsonb not null default '[]'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  components jsonb not null default '[]'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  plan_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe additive migrations if public.ideas already existed from SUPABASE.md v1
alter table public.ideas add column if not exists schema_version int not null default 4;
alter table public.ideas add column if not exists memory text not null default '';
alter table public.ideas add column if not exists lifecycle text not null default 'idea';

create index if not exists ideas_user_status_idx on public.ideas (user_id, status);
create index if not exists ideas_user_updated_idx on public.ideas (user_id, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ideas_touch on public.ideas;
create trigger ideas_touch
before update on public.ideas
for each row execute function public.touch_updated_at();

alter table public.ideas enable row level security;

drop policy if exists "own ideas" on public.ideas;
create policy "own ideas" on public.ideas
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Idea Prototypes (Section 7 of ARCHITECTURE.md)
create table if not exists public.idea_prototypes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  revision int not null check (revision >= 1),
  schema_version int not null default 1,
  data jsonb not null,
  change_summary text not null default '',
  created_at timestamptz not null default now(),
  unique (idea_id, revision)
);

create index if not exists idea_prototypes_user_idea_idx
  on public.idea_prototypes (user_id, idea_id, revision desc);

alter table public.idea_prototypes enable row level security;

drop policy if exists "own prototypes" on public.idea_prototypes;
create policy "own prototypes" on public.idea_prototypes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Enable Realtime for cross-device live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ideas'
  ) then
    alter publication supabase_realtime add table public.ideas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'idea_prototypes'
  ) then
    alter publication supabase_realtime add table public.idea_prototypes;
  end if;
end $$;
