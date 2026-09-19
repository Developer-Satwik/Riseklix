create table public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  job_type text not null check (job_type in ('company_research','intent_generation','competitor_discovery','benchmark','evaluation','blueprint','recheck')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  stage text,
  idempotency_key text,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index research_jobs_project_idempotency_idx on public.research_jobs(project_id, idempotency_key) where idempotency_key is not null;
create index research_jobs_workspace_id_idx on public.research_jobs(workspace_id);
create index research_jobs_project_id_idx on public.research_jobs(project_id);
create index research_jobs_created_by_idx on public.research_jobs(created_by);
create index research_jobs_status_created_idx on public.research_jobs(status, created_at desc);

create table public.review_queue_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  research_job_id uuid references public.research_jobs(id) on delete set null,
  entity_type text not null check (entity_type in ('company_profile','buyer_intent','competitor','finding','blueprint')),
  entity_id uuid,
  reason text not null,
  status text not null default 'open' check (status in ('open','in_review','approved','rejected','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  assigned_to uuid references auth.users(id) on delete set null,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index review_queue_items_workspace_id_idx on public.review_queue_items(workspace_id);
create index review_queue_items_project_id_idx on public.review_queue_items(project_id);
create index review_queue_items_research_job_id_idx on public.review_queue_items(research_job_id);
create index review_queue_items_assigned_to_idx on public.review_queue_items(assigned_to);
create index review_queue_items_status_priority_idx on public.review_queue_items(status, priority, created_at);

create trigger research_jobs_set_updated_at before update on public.research_jobs for each row execute function private.set_updated_at();
create trigger review_queue_items_set_updated_at before update on public.review_queue_items for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.research_jobs to authenticated;
grant select, insert, update, delete on public.review_queue_items to authenticated;

alter table public.research_jobs enable row level security;
alter table public.review_queue_items enable row level security;

create policy research_jobs_member_all on public.research_jobs
for all to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)) and (created_by is null or created_by = (select auth.uid())));

create policy review_queue_items_member_all on public.review_queue_items
for all to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));
