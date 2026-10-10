create table public.formwork_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.formwork_projects(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index formwork_share_links_project on public.formwork_share_links(project_id);
create unique index formwork_share_links_one_active_per_project
  on public.formwork_share_links(project_id) where revoked_at is null;

alter table public.formwork_share_links enable row level security;
create policy formwork_share_links_owner_read on public.formwork_share_links
  for select to authenticated
  using ((select formwork_private.project_role(project_id)) = 'owner');
revoke all on public.formwork_share_links from anon, authenticated;
grant select on public.formwork_share_links to authenticated;

create table formwork_private.project_share_guests (
  share_link_id uuid not null references public.formwork_share_links(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_link_id, user_id)
);
create index project_share_guests_user on formwork_private.project_share_guests(user_id);
alter table formwork_private.project_share_guests enable row level security;
revoke all on formwork_private.project_share_guests from public, anon, authenticated;

create or replace function formwork_private.project_role(project text)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.owner_id = (select auth.uid()) then 'owner'
    when m.role is not null then m.role
    when exists (
      select 1
      from formwork_private.project_share_guests g
      join public.formwork_share_links l on l.id = g.share_link_id
      where l.project_id = p.id
        and g.user_id = (select auth.uid())
        and l.revoked_at is null
    ) then 'viewer'
  end
  from public.formwork_projects p
  left join public.formwork_members m
    on m.project_id = p.id and m.email = lower((select auth.jwt()->>'email'))
  where p.id = project and (select auth.uid()) is not null
$$;
revoke all on function formwork_private.project_role(text) from public, anon;
grant execute on function formwork_private.project_role(text) to authenticated;

create function public.get_project_role(p_project_id text)
returns text language sql stable set search_path = '' as $$
  select formwork_private.project_role(p_project_id)
$$;
revoke all on function public.get_project_role(text) from public, anon, authenticated;
grant execute on function public.get_project_role(text) to authenticated;

create function public.create_project_share(p_project_id text, p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
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

create function public.claim_project_share(p_project_id text, p_token_hash text)
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
revoke all on function public.claim_project_share(text, text) from public, anon, authenticated;
grant execute on function public.claim_project_share(text, text) to authenticated;

create function public.revoke_project_share(p_project_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
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
