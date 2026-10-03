-- =====================================================================
-- Planification TVA — mise à jour V1.4 / V1.5 (à exécuter UNE FOIS si la base a été
-- créée avec une version précédente, après migration_v1_2.sql et migration_v1_3.sql).
-- Sans risque : n'efface aucune donnée.
-- Note : si une version précédente de ce script a ajouté clients.contact_email ou
-- productions.reminded_at, ces colonnes ne sont plus utilisées et peuvent rester.
-- =====================================================================

-- Modèles de messages de relance, propres à chaque utilisateur
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null,
  body_vous text not null default '',
  body_tu text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

drop trigger if exists touch on public.message_templates;
create trigger touch before insert or update on public.message_templates for each row execute function public.tg_touch();

alter table public.message_templates enable row level security;
drop policy if exists "modeles personnels" on public.message_templates;
create policy "modeles personnels" on public.message_templates for all to authenticated
  using (public.is_member() and lower(owner_email) = lower(auth.jwt() ->> 'email'))
  with check (public.is_member() and lower(owner_email) = lower(auth.jwt() ->> 'email'));

do $$
begin
  alter publication supabase_realtime add table public.message_templates;
exception when duplicate_object then null;
end $$;
