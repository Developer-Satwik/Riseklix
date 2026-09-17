alter table public.prompt_expressions
  add column if not exists generation_job_id uuid references public.research_jobs(id) on delete set null,
  add column if not exists status text not null default 'candidate' check (status in ('candidate','approved','rejected')),
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

create index if not exists prompt_expressions_generation_job_id_idx on public.prompt_expressions(generation_job_id);
create index if not exists prompt_expressions_approved_by_idx on public.prompt_expressions(approved_by);
create index if not exists prompt_expressions_intent_status_idx on public.prompt_expressions(buyer_intent_id, status);
