-- =====================================================================
-- JB Flow — migration V1.13 (V26.44) : suivi des migrations
-- Crée la table schema_version et y inscrit les migrations déjà passées (détectées automatiquement).
-- L'application signale ensuite à l'administrateur les migrations manquantes.
-- À exécuter une fois dans Supabase > SQL Editor. Chaque migration future s'inscrira elle-même.
-- =====================================================================
create table if not exists public.schema_version (
  version text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_version enable row level security;
drop policy if exists "lecture membres" on public.schema_version;
create policy "lecture membres" on public.schema_version for select to authenticated using (public.is_member());

do $$
begin
  if to_regclass('public.learning_history') is not null then insert into public.schema_version(version) values ('1.7') on conflict do nothing; end if;
  if to_regclass('public.teams') is not null then insert into public.schema_version(version) values ('1.8') on conflict do nothing; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'production_by') then
    insert into public.schema_version(version) values ('1.9') on conflict do nothing; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients membre insert') then
    insert into public.schema_version(version) values ('1.10') on conflict do nothing; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'is_acompte') then
    insert into public.schema_version(version) values ('1.11') on conflict do nothing; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'is_data') then
    insert into public.schema_version(version) values ('1.12') on conflict do nothing; end if;
end $$;

insert into public.schema_version(version) values ('1.13') on conflict do nothing;
