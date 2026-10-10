create index formwork_share_links_created_by on public.formwork_share_links(created_by);

create policy formwork_share_links_owner_create on public.formwork_share_links
  for insert to authenticated
  with check (
    (select formwork_private.project_role(project_id)) = 'owner'
    and created_by = (select auth.uid())
  );
create policy formwork_share_links_owner_update on public.formwork_share_links
  for update to authenticated
  using ((select formwork_private.project_role(project_id)) = 'owner')
  with check (
    (select formwork_private.project_role(project_id)) = 'owner'
    and created_by = (select auth.uid())
  );
grant insert, update on public.formwork_share_links to authenticated;

create policy project_share_guests_self_read on formwork_private.project_share_guests
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.create_project_share(p_project_id text, p_token_hash text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_share_id uuid;
begin
  if v_user_id is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'A signed-in owner and valid token are required';
  end if;
  if not exists (
    select 1 from public.formwork_projects
    where id = p_project_id and owner_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Only the project owner can create a guest link';
  end if;
  update public.formwork_share_links
  set revoked_at = pg_catalog.now()
  where project_id = p_project_id and revoked_at is null;
  insert into public.formwork_share_links(project_id, token_hash, created_by)
  values (p_project_id, p_token_hash, v_user_id)
  returning id into v_share_id;
  return v_share_id;
end
$$;
revoke all on function public.create_project_share(text, text) from public, anon, authenticated;
grant execute on function public.create_project_share(text, text) to authenticated;

create or replace function formwork_private.claim_project_share(p_project_id text, p_token_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_share_id uuid;
begin
  if v_user_id is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select id into v_share_id
  from public.formwork_share_links
  where project_id = p_project_id
    and token_hash = p_token_hash
    and revoked_at is null;
  if v_share_id is null then
    return false;
  end if;
  insert into formwork_private.project_share_guests(share_link_id, user_id)
  values (v_share_id, v_user_id)
  on conflict (share_link_id, user_id) do nothing;
  return true;
end
$$;
revoke all on function formwork_private.claim_project_share(text, text) from public, anon, authenticated;
grant execute on function formwork_private.claim_project_share(text, text) to authenticated;

create or replace function public.claim_project_share(p_project_id text, p_token_hash text)
returns boolean language sql security invoker set search_path = '' as $$
  select formwork_private.claim_project_share(p_project_id, p_token_hash)
$$;
revoke all on function public.claim_project_share(text, text) from public, anon, authenticated;
grant execute on function public.claim_project_share(text, text) to authenticated;

create or replace function public.revoke_project_share(p_project_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not exists (
    select 1 from public.formwork_projects
    where id = p_project_id and owner_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Only the project owner can revoke a guest link';
  end if;
  update public.formwork_share_links
  set revoked_at = pg_catalog.now()
  where project_id = p_project_id and revoked_at is null;
  return found;
end
$$;
revoke all on function public.revoke_project_share(text) from public, anon, authenticated;
grant execute on function public.revoke_project_share(text) to authenticated;
