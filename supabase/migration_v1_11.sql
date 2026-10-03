-- =====================================================================
-- JB Flow — migration V1.11 (V26.38) : case « Acomptes IS » sur la fiche dossier
-- À exécuter une fois dans Supabase > SQL Editor. Aucun montant d'IS n'est enregistré.
-- =====================================================================
alter table public.clients add column if not exists is_acompte boolean not null default false;