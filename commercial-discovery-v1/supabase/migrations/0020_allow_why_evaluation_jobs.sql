alter table public.research_jobs drop constraint if exists research_jobs_job_type_check;

alter table public.research_jobs
  add constraint research_jobs_job_type_check
  check (job_type in (
    'company_research',
    'intent_generation',
    'competitor_discovery',
    'prompt_generation',
    'observation_collection',
    'benchmark',
    'evaluation',
    'why_evaluation',
    'blueprint',
    'recheck'
  ));

