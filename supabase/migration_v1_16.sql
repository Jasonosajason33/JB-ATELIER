-- JB Flow — migration V1.16 (V26.72) : option « Sous-traitance en place » sur la fiche client
-- Désactivée par défaut ; à cocher manuellement. Rappel « uniquement la TVA à faire » au collaborateur.
-- À exécuter une fois dans Supabase > SQL Editor.
alter table public.clients add column if not exists sous_traitance boolean not null default false;
insert into public.schema_version(version) values ('1.16') on conflict do nothing;