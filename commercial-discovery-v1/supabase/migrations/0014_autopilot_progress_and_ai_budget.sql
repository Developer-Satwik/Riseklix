create table if not exists public.autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null unique references public.projects(id) on delete cascade,
  status text not null default 'running' check (status in ('running','paused','complete','failed','cancelled')),
  stage text not null default 'waiting_for_company_confirmation',
  progress smallint not null default 0 check (progress between 0 and 100),
  step_count integer not null default 0 check (step_count >= 0),
  max_steps integer not null default 80 check (max_steps between 1 and 500),
  api_call_count integer not null default 0 check (api_call_count >= 0),
  max_api_calls integer not null default 140 check (max_api_calls between 1 and 5000),
  lease_until timestamptz,
  last_heartbeat_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autopilot_runs_workspace_id_idx on public.autopilot_runs(workspace_id);
create index if not exists autopilot_runs_status_idx on public.autopilot_runs(status, updated_at desc);

alter table public.autopilot_runs enable row level security;

drop policy if exists autopilot_runs_member_all on public.autopilot_runs;
create policy autopilot_runs_member_all on public.autopilot_runs
for all to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

grant select, insert, update, delete on public.autopilot_runs to authenticated;

drop trigger if exists autopilot_runs_set_updated_at on public.autopilot_runs;
create trigger autopilot_runs_set_updated_at
before update on public.autopilot_runs
for each row execute function private.set_updated_at();

create table if not exists public.ai_usage_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_date date not null default current_date,
  reasoning_requests integer not null default 0 check (reasoning_requests >= 0),
  observation_units integer not null default 0 check (observation_units >= 0),
  max_reasoning_requests integer not null default 120 check (max_reasoning_requests > 0),
  max_observation_units integer not null default 400 check (max_observation_units > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, usage_date)
);

alter table public.ai_usage_daily enable row level security;

drop policy if exists ai_usage_daily_member_select on public.ai_usage_daily;
create policy ai_usage_daily_member_select on public.ai_usage_daily
for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

grant select on public.ai_usage_daily to authenticated;

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
  v_row public.ai_usage_daily%rowtype;
  v_allowed boolean := false;
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

  if v_workspace is null or not private.is_workspace_member(v_workspace) then
    raise exception 'Project not found or access denied';
  end if;

  insert into public.ai_usage_daily(workspace_id, usage_date)
  values (v_workspace, current_date)
  on conflict (workspace_id, usage_date) do nothing;

  select * into v_row
  from public.ai_usage_daily
  where workspace_id = v_workspace and usage_date = current_date
  for update;

  if p_kind = 'reasoning' then
    v_allowed := v_row.reasoning_requests + p_units <= v_row.max_reasoning_requests;
    if v_allowed then
      update public.ai_usage_daily
      set reasoning_requests = reasoning_requests + p_units,
          updated_at = now()
      where workspace_id = v_workspace and usage_date = current_date
      returning * into v_row;
    end if;
  else
    v_allowed := v_row.observation_units + p_units <= v_row.max_observation_units;
    if v_allowed then
      update public.ai_usage_daily
      set observation_units = observation_units + p_units,
          updated_at = now()
      where workspace_id = v_workspace and usage_date = current_date
      returning * into v_row;
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'kind', p_kind,
    'units', p_units,
    'reasoning_requests', v_row.reasoning_requests,
    'observation_units', v_row.observation_units,
    'max_reasoning_requests', v_row.max_reasoning_requests,
    'max_observation_units', v_row.max_observation_units,
    'usage_date', v_row.usage_date
  );
end;
$$;

revoke all on function public.consume_ai_budget(uuid,text,integer) from public;
grant execute on function public.consume_ai_budget(uuid,text,integer) to authenticated;

