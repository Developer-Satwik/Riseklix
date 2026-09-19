create table if not exists public.benchmark_prompts (
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  buyer_intent_id uuid not null references public.buyer_intents(id) on delete cascade,
  prompt_expression_id uuid not null references public.prompt_expressions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (benchmark_id, prompt_expression_id)
);

create index if not exists benchmark_prompts_workspace_id_idx on public.benchmark_prompts(workspace_id);
create index if not exists benchmark_prompts_project_id_idx on public.benchmark_prompts(project_id);
create index if not exists benchmark_prompts_buyer_intent_id_idx on public.benchmark_prompts(buyer_intent_id);
create index if not exists benchmark_prompts_prompt_expression_id_idx on public.benchmark_prompts(prompt_expression_id);

alter table public.benchmark_prompts enable row level security;
grant select, insert, update, delete on public.benchmark_prompts to authenticated;

create policy benchmark_prompts_member_all on public.benchmark_prompts
for all to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));
