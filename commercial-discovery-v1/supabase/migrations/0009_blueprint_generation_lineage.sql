alter table public.blueprints
  add column if not exists generation_job_id uuid references public.research_jobs(id) on delete set null,
  add column if not exists source_refs jsonb not null default '[]'::jsonb;

create index if not exists blueprints_generation_job_id_idx on public.blueprints(generation_job_id);
