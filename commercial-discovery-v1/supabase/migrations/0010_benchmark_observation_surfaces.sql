create table if not exists public.benchmark_surfaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  provider text not null,
  surface text not null,
  model_label text,
  enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft','running','complete','failed','disabled')),
  expected_runs integer not null default 0 check (expected_runs >= 0),
  captured_runs integer not null default 0 check (captured_runs >= 0),
  error_runs integer not null default 0 check (error_runs >= 0),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (benchmark_id, provider, surface)
);

create index if not exists benchmark_surfaces_workspace_id_idx on public.benchmark_surfaces(workspace_id);
create index if not exists benchmark_surfaces_project_id_idx on public.benchmark_surfaces(project_id);
create index if not exists benchmark_surfaces_benchmark_id_idx on public.benchmark_surfaces(benchmark_id);
create index if not exists benchmark_surfaces_status_idx on public.benchmark_surfaces(benchmark_id, enabled, status);

alter table public.benchmark_surfaces enable row level security;
grant select, insert, update, delete on public.benchmark_surfaces to authenticated;

create policy benchmark_surfaces_member_all on public.benchmark_surfaces
for all to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));
