-- =====================================================================
-- JB Flow — migration V1.15 (V26.53) : commentaire du Récap TVA
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.productions add column if not exists tva_note text;
insert into public.schema_version(version) values ('1.15') on conflict do nothing;