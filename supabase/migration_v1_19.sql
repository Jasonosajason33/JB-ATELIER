-- JB Flow - migration V1.19 (V26.127) : suivi des CFE
-- Option Suivi CFE sur la fiche du dossier + suivi annuel (montant, mode de paiement, client averti, commentaire).
-- A executer une fois dans Supabase > SQL Editor.
alter table public.clients add column if not exists cfe boolean not null default false;
alter table public.clients add column if not exists cfe_suivi jsonb not null default '{}'::jsonb;
insert into public.schema_version(version) values ('1.19') on conflict do nothing;