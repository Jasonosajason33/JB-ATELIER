-- =====================================================================
-- JB Flow — migration V1.14 (V26.49) : case « Nouveau dossier » (cochée à la main, marge 3 mois)
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.clients add column if not exists new_since date;
insert into public.schema_version(version) values ('1.14') on conflict do nothing;