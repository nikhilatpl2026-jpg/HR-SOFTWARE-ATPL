create table if not exists public.dol_tombstones (
  file_hash text primary key,
  challan_type text not null check (challan_type in ('pf','esic')),
  file_name text,
  period text,
  legacy_source_id text,
  deleted_by text,
  deleted_at timestamptz not null default now()
);

alter table public.dol_tombstones enable row level security;
revoke all on table public.dol_tombstones from public, anon, authenticated;
grant select, insert, update, delete on table public.dol_tombstones to service_role;

create index if not exists dol_tombstones_type_deleted_idx
  on public.dol_tombstones (challan_type, deleted_at desc);

create table if not exists public.dol_auth_sessions (
  token_hash text not null,
  challan_type text not null check (challan_type in ('pf','esic')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (token_hash, challan_type)
);

alter table public.dol_auth_sessions enable row level security;
revoke all on table public.dol_auth_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.dol_auth_sessions to service_role;

create index if not exists dol_auth_sessions_expiry_idx
  on public.dol_auth_sessions (expires_at);
