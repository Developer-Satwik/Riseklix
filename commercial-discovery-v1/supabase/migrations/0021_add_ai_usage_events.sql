create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  research_job_id uuid references public.research_jobs(id) on delete set null,
  provider text not null,
  stage text not null,
  model text not null,
  response_id text,
  service_tier text not null default 'standard',
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  reasoning_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  web_search_calls integer not null default 0,
  estimated_input_cost_usd numeric(14,8),
  estimated_output_cost_usd numeric(14,8),
  estimated_tool_cost_usd numeric(14,8),
  estimated_total_cost_usd numeric(14,8),
  price_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_usage_events_provider_check check (provider in ('openai','anthropic','google','perplexity','firecrawl'))
);

create index if not exists ai_usage_events_project_created_idx
  on public.ai_usage_events(project_id, created_at desc);

create index if not exists ai_usage_events_workspace_created_idx
  on public.ai_usage_events(workspace_id, created_at desc);

create index if not exists ai_usage_events_stage_idx
  on public.ai_usage_events(project_id, stage, created_at desc);

alter table public.ai_usage_events enable row level security;

drop policy if exists ai_usage_events_member_select on public.ai_usage_events;
create policy ai_usage_events_member_select
  on public.ai_usage_events
  for select
  using ((select private.is_workspace_member(ai_usage_events.workspace_id)));

drop policy if exists ai_usage_events_member_insert on public.ai_usage_events;
create policy ai_usage_events_member_insert
  on public.ai_usage_events
  for insert
  with check ((select private.is_workspace_member(ai_usage_events.workspace_id)));

comment on table public.ai_usage_events is
  'Per-provider call telemetry for measured token/tool usage and pricing estimates. Safety counters remain separate in ai_usage_daily.';

