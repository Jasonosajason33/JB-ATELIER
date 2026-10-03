-- JB Flow - migration V1.21 (V26.145) : le Responsable client (RC) peut creer des dossiers pour son equipe
-- (bouton + Dossier et import Excel). A executer une fois dans Supabase > SQL Editor.
drop policy if exists "clients rc insert" on public.clients;
create policy "clients rc insert" on public.clients for insert to authenticated
  with check (public.is_member() and collaborator_id is not null and (
    collaborator_id = public.my_collaborator_id()
    or collaborator_id in (select c.id from public.collaborators c where c.rc_id = public.my_collaborator_id())));
insert into public.schema_version(version) values ('1.21') on conflict do nothing;