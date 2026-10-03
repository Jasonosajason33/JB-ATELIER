-- =====================================================================
-- JB Flow — migration V1.12 (V26.39) : acomptes d'IS — date de clôture et calculs enregistrés
-- is_data est chiffré dans l'application quand le chiffrement est activé (comme le nom du dossier).
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
alter table public.clients add column if not exists is_acompte boolean not null default false;
alter table public.clients add column if not exists is_cloture text;
alter table public.clients add column if not exists is_data text;