-- JB Flow — migration V1.17 (V26.74) : rôle Apprenti
-- Fonction « Apprenti » sur la fiche collaborateur, rattachement à un tuteur, calendrier des jours
-- de présence en entreprise, case « Apprenti » sur la fiche dossier.
-- À exécuter une fois dans Supabase > SQL Editor.
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('admin','manager','collab','apprenti'));
alter table public.collaborators add column if not exists tutor_id uuid references public.collaborators(id) on delete set null;
alter table public.collaborators add column if not exists presence_dates text[] not null default '{}';
alter table public.clients add column if not exists apprenti boolean not null default false;
alter table public.collaborators drop constraint if exists collaborators_kind_check;
alter table public.collaborators add constraint collaborators_kind_check check (kind in ('collab','rc','apprenti'));
insert into public.schema_version(version) values ('1.17') on conflict do nothing;