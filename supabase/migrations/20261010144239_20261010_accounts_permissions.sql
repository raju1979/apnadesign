create table public.formwork_projects (
 id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null default 'Untitled design',
 document jsonb not null check(jsonb_typeof(document)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index formwork_projects_owner on public.formwork_projects(owner_id);
create table public.formwork_members (
 project_id text not null references public.formwork_projects(id) on delete cascade,
 email text not null check(email=lower(trim(email)) and length(email)<255 and position('@' in email)>1),
 role text not null check(role in ('editor','viewer')),
 primary key(project_id,email)
);
create index formwork_members_email on public.formwork_members(email);
alter table public.formwork_projects enable row level security;
alter table public.formwork_members enable row level security;
create schema formwork_private;
revoke all on schema formwork_private from public, anon;
grant usage on schema formwork_private to authenticated;
create function formwork_private.project_role(project text) returns text language sql stable security definer set search_path='' as $$
 select case when p.owner_id=auth.uid() then 'owner' else m.role end
 from public.formwork_projects p left join public.formwork_members m on m.project_id=p.id and m.email=lower(auth.jwt()->>'email')
 where p.id=project and auth.uid() is not null
$$;
revoke all on function formwork_private.project_role(text) from public, anon;
grant execute on function formwork_private.project_role(text) to authenticated;
create policy project_read on public.formwork_projects for select to authenticated using((select formwork_private.project_role(id)) is not null);
create policy project_create on public.formwork_projects for insert to authenticated with check(owner_id=auth.uid());
create policy project_edit on public.formwork_projects for update to authenticated using((select formwork_private.project_role(id)) in ('owner','editor')) with check((select formwork_private.project_role(id)) in ('owner','editor'));
create policy project_delete on public.formwork_projects for delete to authenticated using(owner_id=auth.uid());
create policy member_read on public.formwork_members for select to authenticated using((select formwork_private.project_role(project_id))='owner' or email=lower(auth.jwt()->>'email'));
create policy member_add on public.formwork_members for insert to authenticated with check((select formwork_private.project_role(project_id))='owner');
create policy member_update on public.formwork_members for update to authenticated using((select formwork_private.project_role(project_id))='owner') with check((select formwork_private.project_role(project_id))='owner');
create policy member_remove on public.formwork_members for delete to authenticated using((select formwork_private.project_role(project_id))='owner');
revoke all on public.formwork_projects,public.formwork_members from anon,authenticated;
grant select,insert,delete on public.formwork_projects to authenticated;
grant update(title,document,updated_at) on public.formwork_projects to authenticated;
grant select,insert,update,delete on public.formwork_members to authenticated;
