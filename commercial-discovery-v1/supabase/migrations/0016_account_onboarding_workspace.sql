alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), '')
  ),
  coalesce(
    nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(u.raw_user_meta_data ->> 'picture', '')
  )
from auth.users u
on conflict (id) do nothing;

update public.profiles p
set onboarding_completed_at = coalesce(p.onboarding_completed_at, now())
where p.onboarding_completed_at is null
  and exists (
    select 1
    from public.workspaces w
    left join public.workspace_members wm
      on wm.workspace_id = w.id
     and wm.user_id = p.id
    where w.created_by = p.id or wm.user_id = p.id
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do update
    set display_name = coalesce(public.profiles.display_name, excluded.display_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.complete_onboarding(
  p_display_name text,
  p_organization_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_display_name text := nullif(trim(p_display_name), '');
  v_organization_name text := nullif(trim(p_organization_name), '');
  v_avatar_url text;
  v_slug_base text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_display_name is null or char_length(v_display_name) < 2 or char_length(v_display_name) > 80 then
    raise exception 'Enter a name between 2 and 80 characters';
  end if;

  if v_organization_name is null or char_length(v_organization_name) < 2 or char_length(v_organization_name) > 120 then
    raise exception 'Enter an organization name between 2 and 120 characters';
  end if;

  select coalesce(
    nullif(raw_user_meta_data ->> 'avatar_url', ''),
    nullif(raw_user_meta_data ->> 'picture', '')
  )
  into v_avatar_url
  from auth.users
  where id = v_user_id;

  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    onboarding_completed_at,
    updated_at
  )
  values (
    v_user_id,
    v_display_name,
    v_avatar_url,
    now(),
    now()
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        onboarding_completed_at = now(),
        updated_at = now();

  select w.id
  into v_workspace_id
  from public.workspaces w
  left join public.workspace_members wm
    on wm.workspace_id = w.id
   and wm.user_id = v_user_id
  where w.created_by = v_user_id
     or (wm.user_id = v_user_id and wm.role = 'owner')
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    v_slug_base := lower(regexp_replace(v_organization_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug_base := trim(both '-' from v_slug_base);
    if v_slug_base = '' then v_slug_base := 'workspace'; end if;

    insert into public.workspaces (name, slug, created_by)
    values (
      v_organization_name,
      left(v_slug_base, 48) || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 7),
      v_user_id
    )
    returning id into v_workspace_id;
  else
    update public.workspaces
    set name = v_organization_name,
        updated_at = now()
    where id = v_workspace_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set role = 'owner';

  return v_workspace_id;
end;
$$;

revoke all on function public.complete_onboarding(text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text) to authenticated;

