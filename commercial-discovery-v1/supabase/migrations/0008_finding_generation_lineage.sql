alter table public.findings
  add column if not exists generation_job_id uuid references public.research_jobs(id) on delete set null,
  add column if not exists is_current boolean not null default true,
  add column if not exists source_refs jsonb not null default '[]'::jsonb;

create index if not exists findings_generation_job_id_idx on public.findings(generation_job_id);
create index if not exists findings_benchmark_intent_current_idx on public.findings(benchmark_id, buyer_intent_id, is_current);
