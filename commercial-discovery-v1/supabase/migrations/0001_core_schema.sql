-- Riseklix Commercial Discovery V1
-- Core application schema, evidence lineage, RLS, and longitudinal benchmark model.

create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  domain text not null,
  market text not null,
  primary_language text not null default 'English',
  enabled_languages text[] not null default array['English']::text[],
  status text not null default 'draft' check (status in ('draft','profile_review','intents_review','running','complete','archived')),
  provider_mode text not null default 'live' check (provider_mode in ('demo','live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.research_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  url text not null,
  title text,
  source_type text not null check (source_type in ('first_party','third_party','user_supplied','ai_citation','search_result')),
  captured_at timestamptz,
  snapshot_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, url)
);

create table public.company_profile_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null check (version > 0),
  is_current boolean not null default false,
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  company_name text not null,
  summary text,
  industry text,
  business_model text,
  products jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  audiences jsonb not null default '[]'::jsonb,
  geographies jsonb not null default '[]'::jsonb,
  claims jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  uncertainty jsonb not null default '[]'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create unique index company_profile_versions_one_current_idx
  on public.company_profile_versions(project_id)
  where is_current;

create table public.buyer_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_version_id uuid not null references public.company_profile_versions(id) on delete restrict,
  intent_key text not null,
  version integer not null default 1 check (version > 0),
  parent_intent_id uuid references public.buyer_intents(id) on delete set null,
  status text not null default 'candidate' check (status in ('candidate','approved','rejected','superseded')),
  title text not null,
  buyer text,
  job_to_be_done text not null,
  constraints jsonb not null default '[]'::jsonb,
  required_capabilities jsonb not null default '[]'::jsonb,
  geography jsonb not null default '{}'::jsonb,
  commercial_model text,
  purchase_stage text,
  provenance text not null check (provenance in ('observed','adapted','exploratory')),
  provenance_reason text,
  priority text not null default 'medium' check (priority in ('critical','high','medium','monitor')),
  language_policy jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, intent_key, version)
);

create table public.competitor_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  buyer_intent_id uuid not null references public.buyer_intents(id) on delete cascade,
  company_name text not null,
  domain text,
  relationship text not null check (relationship in ('direct','near_direct','substitute','benchmark','ai_emergent')),
  discovery_layer smallint not null default 0 check (discovery_layer between 0 and 5),
  status text not null default 'candidate' check (status in ('candidate','verified','rejected')),
  matched_constraints jsonb not null default '[]'::jsonb,
  relaxed_constraints jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  evidence_strength text not null default 'weak' check (evidence_strength in ('weak','moderate','strong')),
  rationale text,
  created_at timestamptz not null default now()
);

create table public.prompt_expressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  buyer_intent_id uuid not null references public.buyer_intents(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  variant_no integer not null default 1 check (variant_no > 0),
  language text not null,
  mode text not null check (mode in ('unaided','aided')),
  prompt_text text not null,
  is_frozen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (buyer_intent_id, version, variant_no, language, mode)
);

create table public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  benchmark_type text not null check (benchmark_type in ('baseline','recheck','discovery')),
  status text not null default 'draft' check (status in ('draft','running','complete','failed')),
  parent_benchmark_id uuid references public.benchmarks(id) on delete set null,
  collection_config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, benchmark_type, version)
);

create table public.observation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  buyer_intent_id uuid not null references public.buyer_intents(id) on delete cascade,
  prompt_expression_id uuid not null references public.prompt_expressions(id) on delete cascade,
  provider text not null,
  surface text not null,
  model_label text,
  repetition integer not null default 1 check (repetition > 0),
  language text not null,
  geography text,
  session_state jsonb not null default '{}'::jsonb,
  search_mode text,
  run_status text not null check (run_status in ('captured','nc','error','refusal')),
  retrieval_status text not null default 'unknown' check (retrieval_status in ('retrieved','nr','unknown')),
  target_rank integer check (target_rank is null or target_rank > 0),
  raw_answer text,
  extracted_brands jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  claims jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique (benchmark_id, prompt_expression_id, provider, surface, repetition)
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  buyer_intent_id uuid references public.buyer_intents(id) on delete set null,
  finding_type text not null check (finding_type in ('retrieval_gap','entity_gap','capability_evidence_gap','geography_gap','commercial_association_gap','problem_language_gap','competitive_evidence_gap','healthy','uncertain')),
  severity text not null check (severity in ('urgent','opportunity','monitor','healthy')),
  decision text not null check (decision in ('fix','investigate','monitor','healthy','no_change')),
  observed text not null,
  aided_control text,
  competitor_pattern text,
  client_evidence text,
  counter_evidence text,
  explanation text,
  evidence_strength text not null default 'weak' check (evidence_strength in ('weak','moderate','strong')),
  review_status text not null default 'generated' check (review_status in ('generated','reviewed','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.blueprints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','approved','in_progress','implemented','verified')),
  title text not null,
  objective text not null,
  target_url text,
  suggested_h1 text,
  required_sections jsonb not null default '[]'::jsonb,
  evidence_required jsonb not null default '[]'::jsonb,
  claims_to_verify jsonb not null default '[]'::jsonb,
  internal_links jsonb not null default '[]'::jsonb,
  structured_data jsonb not null default '{}'::jsonb,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  generated_content jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (finding_id, version)
);

create table public.implementation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  blueprint_id uuid not null references public.blueprints(id) on delete cascade,
  route text not null check (route in ('diy','internal_team','expert','managed')),
  status text not null default 'not_started' check (status in ('not_started','in_progress','ready_for_review','verified')),
  assignee_user_id uuid references auth.users(id) on delete set null,
  external_assignee jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  delivery_evidence jsonb not null default '[]'::jsonb,
  verification_result jsonb not null default '{}'::jsonb,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.research_sources(id) on delete cascade,
  entity_type text not null check (entity_type in ('company_profile','buyer_intent','competitor','observation','finding','blueprint')),
  entity_id uuid not null,
  relation text not null check (relation in ('supports','contradicts','context')),
  claim_text text,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated by default as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Foreign-key and common access indexes.
create index workspace_members_user_id_idx on public.workspace_members(user_id);
create index projects_workspace_id_idx on public.projects(workspace_id);
create index projects_created_by_idx on public.projects(created_by);
create index research_sources_workspace_id_idx on public.research_sources(workspace_id);
create index research_sources_project_id_idx on public.research_sources(project_id);
create index company_profile_versions_workspace_id_idx on public.company_profile_versions(workspace_id);
create index company_profile_versions_project_id_idx on public.company_profile_versions(project_id);
create index buyer_intents_workspace_id_idx on public.buyer_intents(workspace_id);
create index buyer_intents_project_id_idx on public.buyer_intents(project_id);
create index buyer_intents_profile_version_id_idx on public.buyer_intents(profile_version_id);
create index buyer_intents_parent_intent_id_idx on public.buyer_intents(parent_intent_id);
create index competitor_candidates_workspace_id_idx on public.competitor_candidates(workspace_id);
create index competitor_candidates_project_id_idx on public.competitor_candidates(project_id);
create index competitor_candidates_buyer_intent_id_idx on public.competitor_candidates(buyer_intent_id);
create index prompt_expressions_workspace_id_idx on public.prompt_expressions(workspace_id);
create index prompt_expressions_project_id_idx on public.prompt_expressions(project_id);
create index prompt_expressions_buyer_intent_id_idx on public.prompt_expressions(buyer_intent_id);
create index benchmarks_workspace_id_idx on public.benchmarks(workspace_id);
create index benchmarks_project_id_idx on public.benchmarks(project_id);
create index benchmarks_parent_benchmark_id_idx on public.benchmarks(parent_benchmark_id);
create index observation_runs_workspace_id_idx on public.observation_runs(workspace_id);
create index observation_runs_project_id_idx on public.observation_runs(project_id);
create index observation_runs_benchmark_id_idx on public.observation_runs(benchmark_id);
create index observation_runs_buyer_intent_id_idx on public.observation_runs(buyer_intent_id);
create index observation_runs_prompt_expression_id_idx on public.observation_runs(prompt_expression_id);
create index findings_workspace_id_idx on public.findings(workspace_id);
create index findings_project_id_idx on public.findings(project_id);
create index findings_benchmark_id_idx on public.findings(benchmark_id);
create index findings_buyer_intent_id_idx on public.findings(buyer_intent_id);
create index blueprints_workspace_id_idx on public.blueprints(workspace_id);
create index blueprints_project_id_idx on public.blueprints(project_id);
create index blueprints_finding_id_idx on public.blueprints(finding_id);
create index implementation_tasks_workspace_id_idx on public.implementation_tasks(workspace_id);
create index implementation_tasks_project_id_idx on public.implementation_tasks(project_id);
create index implementation_tasks_blueprint_id_idx on public.implementation_tasks(blueprint_id);
create index implementation_tasks_assignee_user_id_idx on public.implementation_tasks(assignee_user_id);
create index evidence_links_workspace_id_idx on public.evidence_links(workspace_id);
create index evidence_links_project_id_idx on public.evidence_links(project_id);
create index evidence_links_source_id_idx on public.evidence_links(source_id);
create index evidence_links_entity_idx on public.evidence_links(entity_type, entity_id);
create index audit_events_workspace_id_idx on public.audit_events(workspace_id);
create index audit_events_project_id_idx on public.audit_events(project_id);
create index audit_events_actor_user_id_idx on public.audit_events(actor_user_id);

-- Secure workspace membership helpers. They always evaluate the caller's auth.uid().
create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.workspaces w
      where w.id = target_workspace_id
        and w.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = (select auth.uid())
    )
  );
$$;

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.workspaces w
      where w.id = target_workspace_id
        and w.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = (select auth.uid())
        and wm.role = 'owner'
    )
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

-- Data API privileges: authenticated only; RLS below controls row access.
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.research_sources to authenticated;
grant select, insert, update, delete on public.company_profile_versions to authenticated;
grant select, insert, update, delete on public.buyer_intents to authenticated;
grant select, insert, update, delete on public.competitor_candidates to authenticated;
grant select, insert, update, delete on public.prompt_expressions to authenticated;
grant select, insert, update, delete on public.benchmarks to authenticated;
grant select, insert, update, delete on public.observation_runs to authenticated;
grant select, insert, update, delete on public.findings to authenticated;
grant select, insert, update, delete on public.blueprints to authenticated;
grant select, insert, update, delete on public.implementation_tasks to authenticated;
grant select, insert, update, delete on public.evidence_links to authenticated;
grant select, insert, update, delete on public.audit_events to authenticated;
grant usage, select on sequence public.audit_events_id_seq to authenticated;

-- RLS on every exposed public table.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.research_sources enable row level security;
alter table public.company_profile_versions enable row level security;
alter table public.buyer_intents enable row level security;
alter table public.competitor_candidates enable row level security;
alter table public.prompt_expressions enable row level security;
alter table public.benchmarks enable row level security;
alter table public.observation_runs enable row level security;
alter table public.findings enable row level security;
alter table public.blueprints enable row level security;
alter table public.implementation_tasks enable row level security;
alter table public.evidence_links enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_delete_own on public.profiles for delete to authenticated using (id = (select auth.uid()));

create policy workspaces_select_member on public.workspaces for select to authenticated using ((select private.is_workspace_member(id)));
create policy workspaces_insert_creator on public.workspaces for insert to authenticated with check (created_by = (select auth.uid()));
create policy workspaces_update_owner on public.workspaces for update to authenticated using ((select private.is_workspace_owner(id))) with check ((select private.is_workspace_owner(id)));
create policy workspaces_delete_owner on public.workspaces for delete to authenticated using ((select private.is_workspace_owner(id)));

create policy workspace_members_select_member on public.workspace_members for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy workspace_members_insert_owner on public.workspace_members for insert to authenticated with check ((select private.is_workspace_owner(workspace_id)));
create policy workspace_members_update_owner on public.workspace_members for update to authenticated using ((select private.is_workspace_owner(workspace_id))) with check ((select private.is_workspace_owner(workspace_id)));
create policy workspace_members_delete_owner on public.workspace_members for delete to authenticated using ((select private.is_workspace_owner(workspace_id)));

create policy projects_select_member on public.projects for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy projects_insert_member on public.projects for insert to authenticated with check ((select private.is_workspace_member(workspace_id)) and created_by = (select auth.uid()));
create policy projects_update_member on public.projects for update to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy projects_delete_owner on public.projects for delete to authenticated using ((select private.is_workspace_owner(workspace_id)));

-- Standard workspace-member policies for project-owned tables.
create policy research_sources_member_all on public.research_sources for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy company_profile_versions_member_all on public.company_profile_versions for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy buyer_intents_member_all on public.buyer_intents for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy competitor_candidates_member_all on public.competitor_candidates for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy prompt_expressions_member_all on public.prompt_expressions for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy benchmarks_member_all on public.benchmarks for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy observation_runs_member_all on public.observation_runs for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy findings_member_all on public.findings for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy blueprints_member_all on public.blueprints for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy implementation_tasks_member_all on public.implementation_tasks for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy evidence_links_member_all on public.evidence_links for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
create policy audit_events_member_all on public.audit_events for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)));
