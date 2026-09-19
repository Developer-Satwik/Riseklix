create or replace function public.bootstrap_project(
  p_company_name text,
  p_domain text,
  p_market text,
  p_industry text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id uuid;
  v_profile_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select wm.workspace_id
    into v_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = v_user_id
  order by
    case wm.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end,
    w.created_at asc
  limit 1;

  if v_workspace_id is null then
    select w.id
      into v_workspace_id
    from public.workspaces w
    where w.created_by = v_user_id
    order by w.created_at asc
    limit 1;
  end if;

  if v_workspace_id is null then
    select display_name into v_profile_name
    from public.profiles
    where id = v_user_id;

    insert into public.workspaces (name, slug, created_by)
    values (
      coalesce(nullif(trim(v_profile_name), '') || '''s Workspace', 'Personal Workspace'),
      'workspace-' || replace(gen_random_uuid()::text, '-', ''),
      v_user_id
    )
    returning id into v_workspace_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.projects (
    workspace_id,
    created_by,
    name,
    domain,
    market,
    status
  )
  values (
    v_workspace_id,
    v_user_id,
    p_company_name,
    p_domain,
    p_market,
    'draft'
  )
  returning id into v_project_id;

  insert into public.company_profile_versions (
    workspace_id,
    project_id,
    version,
    is_current,
    status,
    company_name,
    industry,
    summary
  )
  values (
    v_workspace_id,
    v_project_id,
    1,
    true,
    'draft',
    p_company_name,
    nullif(trim(p_industry), ''),
    'Company intelligence research has not been run yet.'
  );

  insert into public.audit_events (
    workspace_id,
    project_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_workspace_id,
    v_project_id,
    v_user_id,
    'project_bootstrapped',
    'project',
    v_project_id,
    jsonb_build_object(
      'domain', p_domain,
      'market', p_market,
      'bootstrap', 'security_definer_rpc'
    )
  );

  return v_project_id;
end;
$function$;

revoke all on function public.bootstrap_project(text, text, text, text) from public, anon;
grant execute on function public.bootstrap_project(text, text, text, text) to authenticated;

