create table if not exists public.ai_usage_minute (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket_start timestamptz not null,
  reasoning_requests integer not null default 0 check (reasoning_requests >= 0),
  observation_units integer not null default 0 check (observation_units >= 0),
  max_reasoning_requests integer not null default 20 check (max_reasoning_requests > 0),
  max_observation_units integer not null default 60 check (max_observation_units > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, bucket_start)
);

alter table public.ai_usage_minute enable row level security;

drop policy if exists ai_usage_minute_member_select on public.ai_usage_minute;
create policy ai_usage_minute_member_select on public.ai_usage_minute
for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

grant select on public.ai_usage_minute to authenticated;

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

  if v_workspace is null or not private.is_workspace_member(v_workspace) then
    raise exception 'Project not found or access denied';
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
grant execute on function public.consume_ai_budget(uuid,text,integer) to authenticated;

