-- =====================================================================
-- JB Flow — mise à jour V26.20 : qui produit (collaborateur / RC), congés saisis par chacun.
-- À exécuter UNE FOIS après migration_v1_8.sql. Sans risque : n'efface aucune donnée.
-- =====================================================================

-- Dans le dossier client : la production et le tableau de bord sont faits par le collaborateur ou par son RC
alter table public.clients add column if not exists production_by text not null default 'collab';
alter table public.clients add column if not exists dashboard_by text not null default 'collab';

-- Chaque membre peut noter ses propres congés et absences (information pour la planification, sans validation)
create or replace function public.my_collaborator_id() returns uuid
language sql stable security definer set search_path = public as $$
  select collaborator_id from public.app_users where lower(email) = lower(auth.jwt() ->> 'email') and active limit 1;
$$;
drop policy if exists "absences personnelles" on public.absences;
create policy "absences personnelles" on public.absences for all to authenticated
  using (public.is_member() and collaborator_id = public.my_collaborator_id())
  with check (public.is_member() and collaborator_id = public.my_collaborator_id());
