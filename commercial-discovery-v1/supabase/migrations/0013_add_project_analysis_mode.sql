alter table public.projects
  add column if not exists analysis_mode text not null default 'manual'
  check (analysis_mode in ('manual','autopilot'));

create index if not exists projects_analysis_mode_idx on public.projects(analysis_mode);

