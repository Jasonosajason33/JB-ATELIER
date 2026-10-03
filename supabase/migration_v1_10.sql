-- =====================================================================
-- JB Flow — migration V1.10 (V26.32) : import Excel par les collaborateurs
-- Un membre peut créer / mettre à jour les dossiers qui lui sont attribués (ou à son binôme).
-- À exécuter une fois dans Supabase > SQL Editor.
-- =====================================================================
drop policy if exists "clients membre insert" on public.clients;
create policy "clients membre insert" on public.clients for insert to authenticated
  with check (public.is_member() and collaborator_id is not null and collaborator_id = public.my_collaborator_id());

drop policy if exists "clients membre update" on public.clients;
create policy "clients membre update" on public.clients for update to authenticated
  using (public.is_member() and collaborator_id is not null and (
    collaborator_id = public.my_collaborator_id()
    or collaborator_id in (select c.id from public.collaborators c where c.rc_id = public.my_collaborator_id())
    or collaborator_id = (select c.rc_id from public.collaborators c where c.id = public.my_collaborator_id())))
  with check (public.is_member() and collaborator_id is not null and (
    collaborator_id = public.my_collaborator_id()
    or collaborator_id in (select c.id from public.collaborators c where c.rc_id = public.my_collaborator_id())
    or collaborator_id = (select c.rc_id from public.collaborators c where c.id = public.my_collaborator_id())));