-- =====================================================================
-- Planification TVA — mise à jour V1.2 (à exécuter UNE FOIS si la base
-- a été créée avec une version précédente de schema.sql).
-- Supabase : SQL Editor > New query > coller > Run. Sans risque : n'efface rien.
-- =====================================================================

-- Suivi de la demande d'informations au client, par dossier et par mois
alter table public.productions add column if not exists info_request text;
alter table public.productions add column if not exists info_request_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productions_info_request_check') then
    alter table public.productions
      add constraint productions_info_request_check check (info_request in ('faite','a_faire','non'));
  end if;
end $$;
