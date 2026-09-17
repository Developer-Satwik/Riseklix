alter table public.buyer_intents
  add column if not exists generation_job_id uuid references public.research_jobs(id) on delete set null,
  add column if not exists source_refs jsonb not null default '[]'::jsonb;

alter table public.competitor_candidates
  add column if not exists generation_job_id uuid references public.research_jobs(id) on delete set null,
  add column if not exists source_refs jsonb not null default '[]'::jsonb;

create index if not exists buyer_intents_generation_job_id_idx on public.buyer_intents(generation_job_id);
create index if not exists competitor_candidates_generation_job_id_idx on public.competitor_candidates(generation_job_id);
