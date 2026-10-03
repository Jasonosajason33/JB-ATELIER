-- JB Flow - migration V1.20 (V26.135) : suivi de la CVAE
-- Option Suivi CVAE sur la fiche du dossier + suivi annuel (declaration 1329-DEF, montant, paiement, commentaire).
-- A executer une fois dans Supabase > SQL Editor.
alter table public.clients add column if not exists cvae boolean not null default false;
alter table public.clients add column if not exists cvae_suivi jsonb not null default '{}'::jsonb;
insert into public.schema_version(version) values ('1.20') on conflict do nothing;