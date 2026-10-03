-- =====================================================================
-- Planification TVA — mise à jour V1.6 (à exécuter UNE FOIS si la base a été
-- créée avec une version précédente, après les migrations v1_2, v1_3 et v1_4).
-- Sans risque : n'efface aucune donnée.
-- =====================================================================

-- Régime de TVA du dossier (CA3 mensuelle par défaut), DEB et DES
alter table public.clients add column if not exists vat_regime text not null default 'ca3_mensuel';
alter table public.clients add column if not exists deb boolean not null default false;
alter table public.clients add column if not exists des boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_vat_regime_check') then
    alter table public.clients add constraint clients_vat_regime_check check (vat_regime in ('ca3_mensuel','ca3_trimestriel','ca12','aucun'));
  end if;
end $$;

-- Suivi des dépôts (jedeclare.com / impots.gouv) par dossier et par mois
alter table public.productions add column if not exists filing jsonb;

-- Temps réellement passé, saisi quand une tâche est terminée
alter table public.tasks add column if not exists actual_min integer;