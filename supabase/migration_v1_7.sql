-- =====================================================================
-- JB Flow — mise à jour V26.16 : planning prospectif et agent de planification
-- À exécuter UNE FOIS (Supabase > SQL Editor > New query > coller > Run),
-- après les migrations précédentes. Sans risque : n'efface aucune donnée.
-- =====================================================================

-- Date de réception habituelle (avant ajustement par l'agent) et réception partielle
alter table public.productions add column if not exists nominal_date date;
alter table public.productions add column if not exists partial_date date;

-- Réception partielle : partie reçue (« recu ») et reste attendu (« reste ») d'un dossier
alter table public.tasks add column if not exists part text;
alter table public.tasks add column if not exists received_date date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_part_check') then
    alter table public.tasks add constraint tasks_part_check check (part in ('recu','reste'));
  end if;
end $$;

-- Historique des mois passés (import Excel) : sert à l'apprentissage de l'agent
create table if not exists public.learning_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  nominal_date date,            -- date de réception habituelle / prévue
  received_date date,           -- date de réception réelle
  planned_min integer,          -- temps de production prévu
  actual_min integer,           -- temps réellement passé
  collaborator_id uuid references public.collaborators(id) on delete set null,
  source text not null default 'import',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (client_id, month)
);
create index if not exists learning_history_client_idx on public.learning_history(client_id);

drop trigger if exists touch on public.learning_history;
create trigger touch before insert or update on public.learning_history for each row execute function public.tg_touch();

alter table public.learning_history enable row level security;
drop policy if exists "lecture membres" on public.learning_history;
drop policy if exists "ecriture admin" on public.learning_history;
create policy "lecture membres" on public.learning_history for select to authenticated using (public.is_member());
create policy "ecriture admin" on public.learning_history for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.learning_history from anon;

do $$
begin
  alter publication supabase_realtime add table public.learning_history;
exception when duplicate_object then null;
end $$;

-- Période de production : du 1er au 24
update public.settings set value = jsonb_set(value, '{start_day}', '1') where id = 'planning';
