-- Enforce workspace roles at the database boundary.
-- Viewers remain read-only. Owners, admins and members may mutate project data.
-- Audit events are append-only for authenticated writers.

create or replace function private.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.workspaces w
      where w.id = target_workspace_id
        and w.created_by = (select auth.uid())
    )
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = (select auth.uid())
        and wm.role in ('owner','admin','member')
    )
  );
$$;

revoke all on function private.can_write_workspace(uuid) from public;
grant execute on function private.can_write_workspace(uuid) to authenticated;

do $$
declare
  t text;
  tables text[] := array[
    'autopilot_runs',
    'benchmark_prompts',
    'benchmark_surfaces',
    'benchmarks',
    'blueprints',
    'buyer_intents',
    'company_profile_versions',
    'competitor_candidates',
    'evidence_links',
    'findings',
    'implementation_tasks',
    'observation_runs',
    'prompt_expressions',
    'research_sources',
    'review_queue_items'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_member_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_writer_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_writer_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_writer_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))',
      t || '_member_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.can_write_workspace(workspace_id)))',
      t || '_writer_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.can_write_workspace(workspace_id))) with check ((select private.can_write_workspace(workspace_id)))',
      t || '_writer_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.can_write_workspace(workspace_id)))',
      t || '_writer_delete', t
    );
  end loop;
end
$$;

-- Research jobs retain the created_by integrity check for user-authenticated writes.
drop policy if exists research_jobs_member_all on public.research_jobs;
drop policy if exists research_jobs_member_select on public.research_jobs;
drop policy if exists research_jobs_writer_insert on public.research_jobs;
drop policy if exists research_jobs_writer_update on public.research_jobs;
drop policy if exists research_jobs_writer_delete on public.research_jobs;

create policy research_jobs_member_select on public.research_jobs
for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy research_jobs_writer_insert on public.research_jobs
for insert to authenticated
with check (
  (select private.can_write_workspace(workspace_id))
  and (created_by is null or created_by = (select auth.uid()))
);

create policy research_jobs_writer_update on public.research_jobs
for update to authenticated
using ((select private.can_write_workspace(workspace_id)))
with check (
  (select private.can_write_workspace(workspace_id))
  and (created_by is null or created_by = (select auth.uid()))
);

create policy research_jobs_writer_delete on public.research_jobs
for delete to authenticated
using ((select private.can_write_workspace(workspace_id)));

-- Audit history is readable by all workspace members but append-only.
drop policy if exists audit_events_member_all on public.audit_events;
drop policy if exists audit_events_member_select on public.audit_events;
drop policy if exists audit_events_writer_insert on public.audit_events;
drop policy if exists audit_events_writer_update on public.audit_events;
drop policy if exists audit_events_writer_delete on public.audit_events;

create policy audit_events_member_select on public.audit_events
for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy audit_events_writer_insert on public.audit_events
for insert to authenticated
with check ((select private.can_write_workspace(workspace_id)));

-- Usage events may be read by viewers, but only non-viewers may create telemetry.
drop policy if exists ai_usage_events_member_insert on public.ai_usage_events;
drop policy if exists ai_usage_events_writer_insert on public.ai_usage_events;

create policy ai_usage_events_writer_insert on public.ai_usage_events
for insert to authenticated
with check ((select private.can_write_workspace(workspace_id)));

-- Project creation/update follows the same role boundary. Project deletion stays owner-only.
drop policy if exists projects_insert_member on public.projects;
drop policy if exists projects_update_member on public.projects;

create policy projects_insert_writer on public.projects
for insert to authenticated
with check (
  (select private.can_write_workspace(workspace_id))
  and created_by = (select auth.uid())
);

create policy projects_update_writer on public.projects
for update to authenticated
using ((select private.can_write_workspace(workspace_id)))
with check ((select private.can_write_workspace(workspace_id)));

-- A viewer must not be able to consume paid AI quota directly.
create or replace function public.consume_ai_budget(
  p_project_id uuid,
  p_kind text,
  p_units integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_day public.ai_usage_daily%rowtype;
  v_minute public.ai_usage_minute%rowtype;
  v_bucket timestamptz := date_trunc('minute', now());
  v_day_allowed boolean := false;
  v_minute_allowed boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'Invalid usage units';
  end if;

  if p_kind not in ('reasoning','observation') then
    raise exception 'Invalid usage kind';
  end if;

  select workspace_id into v_workspace
  from public.projects
  where id = p_project_id;

  if v_workspace is null or not private.can_write_workspace(v_workspace) then
    raise exception 'Project not found or write access denied';
  end if;

  insert into public.ai_usage_daily(workspace_id, usage_date)
  values (v_workspace, current_date)
  on conflict (workspace_id, usage_date) do nothing;

  insert into public.ai_usage_minute(workspace_id, bucket_start)
  values (v_workspace, v_bucket)
  on conflict (workspace_id, bucket_start) do nothing;

  select * into v_day
  from public.ai_usage_daily
  where workspace_id = v_workspace and usage_date = current_date
  for update;

  select * into v_minute
  from public.ai_usage_minute
  where workspace_id = v_workspace and bucket_start = v_bucket
  for update;

  if p_kind = 'reasoning' then
    v_day_allowed := v_day.reasoning_requests + p_units <= v_day.max_reasoning_requests;
    v_minute_allowed := v_minute.reasoning_requests + p_units <= v_minute.max_reasoning_requests;

    if v_day_allowed and v_minute_allowed then
      update public.ai_usage_daily
      set reasoning_requests = reasoning_requests + p_units,
          updated_at = now()
      where workspace_id = v_workspace and usage_date = current_date
      returning * into v_day;

      update public.ai_usage_minute
      set reasoning_requests = reasoning_requests + p_units,
          updated_at = now()
      where workspace_id = v_workspace and bucket_start = v_bucket
      returning * into v_minute;
    end if;
  else
    v_day_allowed := v_day.observation_units + p_units <= v_day.max_observation_units;
    v_minute_allowed := v_minute.observation_units + p_units <= v_minute.max_observation_units;

    if v_day_allowed and v_minute_allowed then
      update public.ai_usage_daily
      set observation_units = observation_units + p_units,
          updated_at = now()
      where workspace_id = v_workspace and usage_date = current_date
      returning * into v_day;

      update public.ai_usage_minute
      set observation_units = observation_units + p_units,
          updated_at = now()
      where workspace_id = v_workspace and bucket_start = v_bucket
      returning * into v_minute;
    end if;
  end if;

  return jsonb_build_object(
    'allowed', (v_day_allowed and v_minute_allowed),
    'kind', p_kind,
    'units', p_units,
    'blocked_scope',
      case
        when not v_day_allowed then 'daily'
        when not v_minute_allowed then 'minute'
        else null
      end,
    'reasoning_requests_today', v_day.reasoning_requests,
    'observation_units_today', v_day.observation_units,
    'max_reasoning_requests_today', v_day.max_reasoning_requests,
    'max_observation_units_today', v_day.max_observation_units,
    'reasoning_requests_this_minute', v_minute.reasoning_requests,
    'observation_units_this_minute', v_minute.observation_units,
    'max_reasoning_requests_this_minute', v_minute.max_reasoning_requests,
    'max_observation_units_this_minute', v_minute.max_observation_units,
    'usage_date', v_day.usage_date,
    'bucket_start', v_bucket
  );
end;
$$;

revoke all on function public.consume_ai_budget(uuid,text,integer) from public;
revoke all on function public.consume_ai_budget(uuid,text,integer) from anon;
grant execute on function public.consume_ai_budget(uuid,text,integer) to authenticated;
grant execute on function public.consume_ai_budget(uuid,text,integer) to service_role;

