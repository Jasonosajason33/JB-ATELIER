-- JB Flow — migration V1.18 (V26.77) : autorise la fonction « Apprenti » sur les collaborateurs
-- Corrige l'erreur « violates check constraint collaborators_kind_check » à la création d'un apprenti.
-- À exécuter une fois dans Supabase > SQL Editor (sans risque si déjà faite).
alter table public.collaborators drop constraint if exists collaborators_kind_check;
alter table public.collaborators add constraint collaborators_kind_check check (kind in ('collab','rc','apprenti'));

insert into public.schema_version(version) values ('1.18') on conflict do nothing;