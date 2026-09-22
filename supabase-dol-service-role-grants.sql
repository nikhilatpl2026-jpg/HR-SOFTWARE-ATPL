-- PF/ESIC DOL Supabase authority: Edge Function database-role privileges.
-- Safe to run repeatedly. This intentionally does NOT grant dol_challans access
-- to anon or authenticated browser roles.
begin;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.dol_challans to service_role;
grant select, insert, update, delete on table public.dol_sync_events to service_role;

commit;

select
  has_table_privilege('service_role', 'public.dol_challans', 'SELECT') as challans_select,
  has_table_privilege('service_role', 'public.dol_challans', 'INSERT') as challans_insert,
  has_table_privilege('service_role', 'public.dol_challans', 'UPDATE') as challans_update,
  has_table_privilege('service_role', 'public.dol_challans', 'DELETE') as challans_delete,
  has_table_privilege('service_role', 'public.dol_sync_events', 'SELECT') as events_select,
  has_table_privilege('service_role', 'public.dol_sync_events', 'INSERT') as events_insert;
