-- =====================================================================
-- Planification TVA — mise à jour V1.3 (à exécuter UNE FOIS si la base a été
-- créée avec une version précédente). Exécutez d'abord migration_v1_2.sql si ce
-- n'est pas déjà fait. Sans risque : n'efface aucune donnée.
-- Supabase : SQL Editor > New query > coller > Run.
-- =====================================================================

-- 1. Temps unique par dossier (repris de tenue + lettrage + TVA pour les dossiers existants)
alter table public.clients add column if not exists time_min integer not null default 0;
update public.clients set time_min = coalesce(time_tenue, 0) + coalesce(time_lettrage, 0) + coalesce(time_tva, 0)
where time_min = 0;

-- 2. Nouvelles tâches : « production » (dossier complet) et « info » (demande d'informations)
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('tenue','lettrage','tva','production','info'));

-- 3. Répartition d'un dossier sur plusieurs jours ouvrés
alter table public.tasks add column if not exists alloc jsonb;

-- 4. Un membre peut supprimer une demande d'informations devenue inutile
drop policy if exists "suppression demande infos" on public.tasks;
create policy "suppression demande infos" on public.tasks for delete to authenticated
  using (public.is_member() and kind = 'info');
