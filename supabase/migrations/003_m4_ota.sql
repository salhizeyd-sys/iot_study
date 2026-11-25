-- Sharara M4 OTA Schema: firmware_releases table & private firmware-bins storage bucket
-- Paste into Supabase Dashboard -> SQL Editor and run once.

create table if not exists public.firmware_releases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  version text not null,
  storage_path text not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (idea_id, version)
);

create index if not exists firmware_releases_idea_created_idx
  on public.firmware_releases (idea_id, created_at desc);

alter table public.firmware_releases enable row level security;

drop policy if exists "own firmware releases" on public.firmware_releases;
create policy "own firmware releases" on public.firmware_releases
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Private storage bucket for compiled ESP32 OTA .bin files
insert into storage.buckets (id, name, public)
values ('firmware-bins', 'firmware-bins', false)
on conflict (id) do nothing;

drop policy if exists "own firmware bins select" on storage.objects;
create policy "own firmware bins select" on storage.objects
for select
to authenticated
using (
  bucket_id = 'firmware-bins'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "own firmware bins insert" on storage.objects;
create policy "own firmware bins insert" on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'firmware-bins'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "own firmware bins update" on storage.objects;
create policy "own firmware bins update" on storage.objects
for update
to authenticated
using (
  bucket_id = 'firmware-bins'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "own firmware bins delete" on storage.objects;
create policy "own firmware bins delete" on storage.objects
for delete
to authenticated
using (
  bucket_id = 'firmware-bins'
  and (storage.foldername(name))[1] = auth.uid()::text
);
