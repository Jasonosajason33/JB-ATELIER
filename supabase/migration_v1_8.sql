-- =====================================================================
-- JB Flow — mise à jour V26.19 : équipes (manager / RC / collaborateur),
-- tableaux de bord clients, chiffrement des noms de clients.
-- À exécuter UNE FOIS (Supabase > SQL Editor > New query > coller > Run),
-- après migration_v1_7.sql. Sans risque : n'efface aucune donnée.
-- =====================================================================

-- Rôles des utilisateurs : administrateur, manager, membre (RC ou collaborateur)
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('admin','manager','collab'));

-- Équipes : un manager gère une ou plusieurs équipes de RC et de collaborateurs
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  manager_id uuid references public.app_users(id) on delete set null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);
drop trigger if exists touch on public.teams;
create trigger touch before insert or update on public.teams for each row execute function public.tg_touch();

-- Collaborateur : type (collaborateur comptable / responsable client), équipe, binôme (RC du collaborateur)
alter table public.collaborators add column if not exists kind text not null default 'collab';
alter table public.collaborators add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.collaborators add column if not exists rc_id uuid references public.collaborators(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'collaborators_kind_check') then
    alter table public.collaborators add constraint collaborators_kind_check check (kind in ('collab','rc'));
  end if;
end $$;

-- Tableaux de bord clients : fréquence, jour convenu (M+1), temps
alter table public.clients add column if not exists dashboard_freq text;
alter table public.clients add column if not exists dashboard_day integer check (dashboard_day between 1 and 31);
alter table public.clients add column if not exists dashboard_min integer not null default 0;

-- Tâches « tableau de bord » : sans production associée, période couverte, publication
alter table public.tasks alter column production_id drop not null;
alter table public.tasks add column if not exists period text;
alter table public.tasks add column if not exists published_at timestamptz;
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('tenue','lettrage','tva','production','info','dashboard'));

-- Droits : administrateur ou manager
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users
                 where lower(email) = lower(auth.jwt() ->> 'email') and active and role in ('admin','manager'));
$$;

-- Les managers gèrent dossiers, collaborateurs, absences, paramètres et historique de l'agent ;
-- les utilisateurs et les équipes restent réservés à l'administrateur.
do $$
declare t text;
begin
  foreach t in array array['collaborators','absences','clients','settings','learning_history'] loop
    execute format('drop policy if exists "ecriture admin" on public.%I', t);
    execute format('drop policy if exists "ecriture managers" on public.%I', t);
    execute format('create policy "ecriture managers" on public.%I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;

alter table public.teams enable row level security;
drop policy if exists "lecture membres" on public.teams;
drop policy if exists "ecriture admin" on public.teams;
create policy "lecture membres" on public.teams for select to authenticated using (public.is_member());
create policy "ecriture admin" on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.teams from anon;

do $$
begin
  alter publication supabase_realtime add table public.teams;
exception when duplicate_object then null;
end $$;
