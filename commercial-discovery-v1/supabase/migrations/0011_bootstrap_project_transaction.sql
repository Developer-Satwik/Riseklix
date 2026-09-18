-- Transactional project bootstrap.
-- Avoids first-project RLS bootstrap failures by deriving auth.uid() inside
-- a SECURITY DEFINER function and never accepting a caller-supplied user id.

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
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select w.id
    into v_workspace_id
  from public.workspaces w
  where w.created_by = v_user_id
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    insert into public.workspaces (name, slug, created_by)
    values (
      'My Workspace',
      'workspace-' || replace(gen_random_uuid()::text, '-', ''),
      v_user_id
    )
    returning id into v_workspace_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set role = case
      when public.workspace_members.role = 'owner' then public.workspace_members.role
      else 'owner'
    end;

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
