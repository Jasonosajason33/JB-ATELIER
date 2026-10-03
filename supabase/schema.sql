-- =====================================================================
-- Planification TVA — schéma de base de données (Supabase / PostgreSQL)
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
--
-- ⚠️ AVANT d'exécuter : remplacez 'VOTRE.EMAIL@cabinet.fr' (tout en bas)
--    par l'adresse e-mail de l'administrateur.
--
-- Sécurité : Row Level Security (RLS) activée sur toutes les tables.
--  - Personne ne peut lire ni écrire sans être connecté ET inscrit (actif)
--    dans la table app_users.
--  - Seuls les administrateurs modifient collaborateurs, clients, absences,
--    paramètres et utilisateurs.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'collab' check (role in ('admin','collab')),
  active boolean not null default true,
  collaborator_id uuid,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.collaborators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  daily_capacity_min integer not null default 420 check (daily_capacity_min between 0 and 1440),
  work_days integer[] not null default '{1,2,3,4,5}',
  color text,
  active boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.collaborators(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  kind text not null default 'conge',      -- conge | absence | formation | autre
  minutes integer,                          -- null = journée entière ; sinon minutes indisponibles par jour
  note text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text,
  check (date_to >= date_from)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  frequency text not null default 'mensuel' check (frequency in ('mensuel','trimestriel','annuel')),
  reception_day integer check (reception_day between 1 and 31),
  time_tenue integer not null default 0,
  time_lettrage integer not null default 0,
  time_tva integer not null default 0,
  time_min integer not null default 0,
  time_total integer generated always as (time_tenue + time_lettrage + time_tva) stored,
  vat_due_day integer check (vat_due_day between 1 and 31),
  vat_regime text not null default 'ca3_mensuel' check (vat_regime in ('ca3_mensuel','ca3_trimestriel','ca12','aucun')),
  deb boolean not null default false,          -- déclaration d'échanges de biens
  des boolean not null default false,          -- déclaration européenne de services
  priority integer not null default 2 check (priority between 1 and 3),
  notes text,
  active boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.productions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  expected_date date,
  received_date date,
  status text not null default 'attendu',
  info_request text check (info_request in ('faite','a_faire','non')),  -- demande d'informations au client
  info_request_at timestamptz,
  filing jsonb,                               -- suivi des dépôts : {"CA3": {"via": "jedeclare"|"impots", "at": ..., "by": ...}}
  nominal_date date,                          -- date de réception habituelle (avant ajustement par l'agent)
  partial_date date,                          -- réception partielle
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (client_id, month)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,
  kind text not null check (kind in ('tenue','lettrage','tva','production','info')),
  collaborator_id uuid references public.collaborators(id) on delete set null,
  planned_date date,
  seq integer not null default 0,
  duration_min integer not null default 0,
  due_date date,
  locked boolean not null default false,
  done boolean not null default false,
  done_at timestamptz,
  actual_min integer,                         -- temps réellement passé, saisi à la clôture
  alloc jsonb,                               -- répartition sur plusieurs jours : {"AAAA-MM-JJ": minutes}
  part text check (part in ('recu','reste')),  -- réception partielle : partie reçue / reste attendu
  received_date date,                        -- date de réception de la partie reçue
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.settings (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.history (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_email text,
  entity text,
  entity_id text,
  client_id uuid,
  action text not null,
  detail jsonb
);

-- Modèles de messages de relance : propres à chaque utilisateur
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null,
  body_vous text not null default '',
  body_tu text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Historique des mois passés (import Excel) : apprentissage de l'agent de planification
create table if not exists public.learning_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  nominal_date date,
  received_date date,
  planned_min integer,
  actual_min integer,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  source text not null default 'import',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (client_id, month)
);

create index if not exists tasks_month_idx on public.tasks(month);
create index if not exists tasks_updated_idx on public.tasks(updated_at);
create index if not exists productions_month_idx on public.productions(month);
create index if not exists history_at_idx on public.history(at desc);
create index if not exists history_client_idx on public.history(client_id);

-- ---------- Version / horodatage automatiques (contrôle des conflits) ----------
create or replace function public.tg_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['app_users','collaborators','absences','clients','productions','tasks','settings','message_templates','learning_history'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.tg_touch()', t);
  end loop;
end $$;

-- ---------- Fonctions d'autorisation ----------
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users
                 where lower(email) = lower(auth.jwt() ->> 'email') and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users
                 where lower(email) = lower(auth.jwt() ->> 'email') and active and role = 'admin');
$$;

-- Taille de la base (affichée dans l'application pour surveiller la limite gratuite de 500 Mo)
create or replace function public.db_usage() returns bigint
language sql stable security definer set search_path = public as $$
  select case when public.is_member() then pg_database_size(current_database()) else null end;
$$;
revoke execute on function public.db_usage() from anon;

-- ---------- Row Level Security ----------
alter table public.app_users     enable row level security;
alter table public.collaborators enable row level security;
alter table public.absences      enable row level security;
alter table public.clients       enable row level security;
alter table public.productions   enable row level security;
alter table public.tasks         enable row level security;
alter table public.settings      enable row level security;
alter table public.history       enable row level security;
alter table public.learning_history enable row level security;

do $$
declare t text;
begin
  -- Données de référence : lecture membres, écriture administrateurs
  foreach t in array array['app_users','collaborators','absences','clients','settings','learning_history'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "ecriture admin" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "ecriture admin" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- Production du mois et tâches : lecture / création / modification membres, suppression admin
  foreach t in array array['productions','tasks'] loop
    execute format('drop policy if exists "lecture membres" on public.%I', t);
    execute format('drop policy if exists "creation membres" on public.%I', t);
    execute format('drop policy if exists "modification membres" on public.%I', t);
    execute format('drop policy if exists "suppression admin" on public.%I', t);
    execute format('create policy "lecture membres" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "creation membres" on public.%I for insert to authenticated with check (public.is_member())', t);
    execute format('create policy "modification membres" on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t);
    execute format('create policy "suppression admin" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Les demandes d'informations peuvent être supprimées par les membres (statut « non nécessaire »)
drop policy if exists "suppression demande infos" on public.tasks;
create policy "suppression demande infos" on public.tasks for delete to authenticated using (public.is_member() and kind = 'info');

-- Modèles de messages : chacun ne voit et ne modifie que les siens
alter table public.message_templates enable row level security;
drop policy if exists "modeles personnels" on public.message_templates;
create policy "modeles personnels" on public.message_templates for all to authenticated
  using (public.is_member() and lower(owner_email) = lower(auth.jwt() ->> 'email'))
  with check (public.is_member() and lower(owner_email) = lower(auth.jwt() ->> 'email'));

-- Historique : lecture membres, ajout membres (en leur nom), jamais modifié ni supprimé
drop policy if exists "lecture membres" on public.history;
drop policy if exists "ajout membres" on public.history;
create policy "lecture membres" on public.history for select to authenticated using (public.is_member());
create policy "ajout membres" on public.history for insert to authenticated
  with check (public.is_member() and lower(user_email) = lower(auth.jwt() ->> 'email'));

-- Aucun accès pour les visiteurs non connectés
revoke all on all tables in schema public from anon;

-- ---------- Temps réel ----------
do $$
declare t text;
begin
  foreach t in array array['app_users','collaborators','absences','clients','productions','tasks','settings','message_templates','learning_history'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Données initiales ----------
insert into public.settings (id, value) values ('planning', '{
  "start_day": 1, "end_day": 24, "day_start": "09:00", "warn_pct": 85, "due_soon_days": 3,
  "quarter_months": [1,4,7,10], "annual_month": 4, "holidays": true,
  "collab_see_all": true, "auto_lock_on_move": false }')
on conflict (id) do nothing;

-- ⚠️ REMPLACEZ l'adresse ci-dessous par la vôtre (administrateur) :
insert into public.app_users (email, name, role)
values ('jason.bahi@inextenso.fr', 'Administrateur', 'admin')
on conflict (email) do update set role = 'admin', active = true;

-- ---------- V26.19 (identique à migration_v1_8.sql) ----------
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

-- ---------- V26.20 (identique à migration_v1_9.sql) ----------
-- =====================================================================
-- JB Flow — mise à jour V26.20 : qui produit (collaborateur / RC), congés saisis par chacun.
-- À exécuter UNE FOIS après migration_v1_8.sql. Sans risque : n'efface aucune donnée.
-- =====================================================================

-- Dans le dossier client : la production et le tableau de bord sont faits par le collaborateur ou par son RC
alter table public.clients add column if not exists production_by text not null default 'collab';
alter table public.clients add column if not exists dashboard_by text not null default 'collab';

-- Chaque membre peut noter ses propres congés et absences (information pour la planification, sans validation)
create or replace function public.my_collaborator_id() returns uuid
language sql stable security definer set search_path = public as $$
  select collaborator_id from public.app_users where lower(email) = lower(auth.jwt() ->> 'email') and active limit 1;
$$;
drop policy if exists "absences personnelles" on public.absences;
create policy "absences personnelles" on public.absences for all to authenticated
  using (public.is_member() and collaborator_id = public.my_collaborator_id())
  with check (public.is_member() and collaborator_id = public.my_collaborator_id());

-- =====================================================================
-- JB Flow — migration V1.10 (V26.32) : import Excel par les collaborateurs
-- Un membre peut créer / mettre à jour les dossiers qui lui sont attribués (ou à son binôme).
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
drop policy if exists "clients membre insert" on public.clients;
create policy "clients membre insert" on public.clients for insert to authenticated
  with check (public.is_member() and collaborator_id is not null and collaborator_id = public.my_collaborator_id());

drop policy if exists "clients membre update" on public.clients;
create policy "clients membre update" on public.clients for update to authenticated
  using (public.is_member() and collaborator_id is not null and (
    collaborator_id = public.my_collaborator_id()
    or collaborator_id in (select c.id from public.collaborators c where c.rc_id = public.my_collaborator_id())
    or collaborator_id = (select c.rc_id from public.collaborators c where c.id = public.my_collaborator_id())))
  with check (public.is_member() and collaborator_id is not null and (
    collaborator_id = public.my_collaborator_id()
    or collaborator_id in (select c.id from public.collaborators c where c.rc_id = public.my_collaborator_id())
    or collaborator_id = (select c.rc_id from public.collaborators c where c.id = public.my_collaborator_id())));

-- =====================================================================
-- JB Flow — migration V1.11 (V26.38) : case « Acomptes IS » sur la fiche dossier
-- À exécuter une fois dans Supabase > SQL Editor. Aucun montant d'IS n'est enregistré.
-- =====================================================================
alter table public.clients add column if not exists is_acompte boolean not null default false;

-- =====================================================================
-- JB Flow — migration V1.12 (V26.39) : acomptes d'IS — date de clôture et calculs enregistrés
-- is_data est chiffré dans l'application quand le chiffrement est activé (comme le nom du dossier).
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.clients add column if not exists is_acompte boolean not null default false;
alter table public.clients add column if not exists is_cloture text;
alter table public.clients add column if not exists is_data text;

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


-- =====================================================================
-- JB Flow — migration V1.14 (V26.49) : case « Nouveau dossier » (cochée à la main, marge 3 mois)
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.clients add column if not exists new_since date;
insert into public.schema_version(version) values ('1.14') on conflict do nothing;

-- =====================================================================
-- JB Flow — migration V1.15 (V26.53) : commentaire du Récap TVA
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.productions add column if not exists tva_note text;
insert into public.schema_version(version) values ('1.15') on conflict do nothing;

-- =====================================================================
-- JB Flow — migration V1.16 (V26.72) : option « Sous-traitance en place » sur la fiche client
-- Désactivée par défaut ; à cocher manuellement. Rappel « uniquement la TVA à faire » au collaborateur.
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.clients add column if not exists sous_traitance boolean not null default false;
insert into public.schema_version(version) values ('1.16') on conflict do nothing;
-- =====================================================================
-- JB Flow — migration V1.17 (V26.74) : rôle Apprenti
-- Fonction « Apprenti » sur la fiche collaborateur, rattachement à un tuteur, calendrier des jours
-- de présence en entreprise, case « Apprenti » sur la fiche dossier.
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('admin','manager','collab','apprenti'));
alter table public.collaborators add column if not exists tutor_id uuid references public.collaborators(id) on delete set null;
alter table public.collaborators add column if not exists presence_dates text[] not null default '{}';
alter table public.clients add column if not exists apprenti boolean not null default false;
insert into public.schema_version(version) values ('1.17') on conflict do nothing;
-- =====================================================================
-- JB Flow — migration V1.18 (V26.77) : autorise la fonction « Apprenti » sur les collaborateurs
-- Corrige l'erreur « violates check constraint collaborators_kind_check » à la création d'un apprenti.
-- À exécuter une fois dans Supabase > SQL Editor (sans risque si déjà faite).
-- =====================================================================
alter table public.collaborators drop constraint if exists collaborators_kind_check;
alter table public.collaborators add constraint collaborators_kind_check check (kind in ('collab','rc','apprenti'));

insert into public.schema_version(version) values ('1.18') on conflict do nothing;
-- V1.19 : suivi des CFE
alter table public.clients add column if not exists cfe boolean not null default false;
alter table public.clients add column if not exists cfe_suivi jsonb not null default '{}'::jsonb;
insert into public.schema_version(version) values ('1.19') on conflict do nothing;

-- V1.20 : suivi de la CVAE
alter table public.clients add column if not exists cvae boolean not null default false;
alter table public.clients add column if not exists cvae_suivi jsonb not null default '{}'::jsonb;
insert into public.schema_version(version) values ('1.20') on conflict do nothing;

-- V1.21 : le RC peut creer des dossiers pour son equipe
drop policy if exists "clients rc insert" on public.clients;
create policy "clients rc insert" on public.clients for insert to authenticated
  with check (public.is_member() and collaborator_id is not null and (
    collaborator_id = public.my_collaborator_id()
    or collaborator_id in (select c.id from public.collaborators c where c.rc_id = public.my_collaborator_id())));
insert into public.schema_version(version) values ('1.21') on conflict do nothing;

