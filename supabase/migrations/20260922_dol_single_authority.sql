-- ATPL PF/ESIC DOL single-authority backend.
-- Idempotent migration. Browser roles never receive dol_challans access.
-- Supabase Edge Function dol-api uses SUPABASE_SERVICE_ROLE_KEY.

create extension if not exists pgcrypto;

create table if not exists public.dol_challans (
  id uuid primary key default gen_random_uuid(),
  challan_type text not null check (challan_type in ('pf','esic')),
  file_name text not null,
  file_path text not null unique,
  file_hash text not null,
  mime_type text,
  file_size bigint not null default 0,
  period text not null default '',
  uploaded_by text not null default '',
  member_ids jsonb not null default '[]'::jsonb,
  contributions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dol_challans_type_idx
  on public.dol_challans(challan_type);

create index if not exists dol_challans_hash_idx
  on public.dol_challans(file_hash);

create index if not exists dol_challans_type_period_idx
  on public.dol_challans(challan_type, period);

create or replace function public.atpl_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dol_challans_set_updated_at on public.dol_challans;
create trigger dol_challans_set_updated_at
before update on public.dol_challans
for each row execute function public.atpl_set_updated_at();

create table if not exists public.dol_sync_events (
  id uuid primary key default gen_random_uuid(),
  challan_type text not null check (challan_type in ('pf','esic')),
  created_at timestamptz not null default now()
);

create index if not exists dol_sync_events_type_created_idx
  on public.dol_sync_events(challan_type, created_at desc);

alter table public.dol_challans enable row level security;
alter table public.dol_sync_events enable row level security;

revoke all on table public.dol_challans from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.dol_challans to service_role;
grant select, insert, update, delete on table public.dol_sync_events to service_role;

-- Realtime browser clients may only read the tiny invalidation event stream.
grant usage on schema public to anon, authenticated;
grant select on table public.dol_sync_events to anon, authenticated;
revoke insert, update, delete on table public.dol_sync_events from anon, authenticated;

drop policy if exists "ATPL DOL sync read" on public.dol_sync_events;
create policy "ATPL DOL sync read"
on public.dol_sync_events
for select
to anon, authenticated
using (true);

-- Private original-file bucket. Service role writes/reads via dol-api.
insert into storage.buckets (id, name, public)
values ('dol-challans', 'dol-challans', false)
on conflict (id) do update set public = false;

-- Ensure Realtime publication contains the event table (and challan table for diagnostics).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='dol_sync_events'
  ) then
    alter publication supabase_realtime add table public.dol_sync_events;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='dol_challans'
  ) then
    alter publication supabase_realtime add table public.dol_challans;
  end if;
end $$;

-- Keep sync-event storage bounded; deleting old events is safe because they are invalidation-only.
delete from public.dol_sync_events
where created_at < now() - interval '30 days';

-- Deployment verification: every value below must be TRUE.
select
  has_schema_privilege('service_role', 'public', 'USAGE') as service_schema_usage,
  has_table_privilege('service_role', 'public.dol_challans', 'SELECT') as challans_select,
  has_table_privilege('service_role', 'public.dol_challans', 'INSERT') as challans_insert,
  has_table_privilege('service_role', 'public.dol_challans', 'UPDATE') as challans_update,
  has_table_privilege('service_role', 'public.dol_challans', 'DELETE') as challans_delete,
  has_table_privilege('service_role', 'public.dol_sync_events', 'SELECT') as events_select,
  has_table_privilege('service_role', 'public.dol_sync_events', 'INSERT') as events_insert;


-- Stable one-time legacy index authority.
-- Legacy metadata is indexed into Supabase once; original bytes are materialized
-- into Storage on first Open/Download or repaired by a matching user upload.
alter table public.dol_challans
  alter column file_path drop not null;

alter table public.dol_challans
  add column if not exists legacy_source_id text;
alter table public.dol_challans
  add column if not exists legacy_source_kind text;
alter table public.dol_challans
  add column if not exists legacy_source_key text;

create unique index if not exists dol_challans_file_hash_uq
  on public.dol_challans(file_hash);

create index if not exists dol_challans_legacy_source_idx
  on public.dol_challans(legacy_source_id)
  where legacy_source_id is not null;

create table if not exists public.dol_migration_state (
  challan_type text primary key check (challan_type in ('pf','esic')),
  indexed_at timestamptz not null default now(),
  legacy_count integer not null default 0,
  imported_count integer not null default 0,
  source_version integer not null default 1
);

alter table public.dol_migration_state enable row level security;
revoke all on table public.dol_migration_state from anon, authenticated;
grant select, insert, update, delete on table public.dol_migration_state to service_role;


alter table public.dol_migration_state add column if not exists source_version integer not null default 1;
