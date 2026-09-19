create index benchmarks_created_by_idx on public.benchmarks(created_by);
create index blueprints_approved_by_idx on public.blueprints(approved_by);
create index buyer_intents_approved_by_idx on public.buyer_intents(approved_by);
create index company_profile_versions_approved_by_idx on public.company_profile_versions(approved_by);
create index findings_reviewed_by_idx on public.findings(reviewed_by);
create index implementation_tasks_verified_by_idx on public.implementation_tasks(verified_by);
create index workspaces_created_by_idx on public.workspaces(created_by);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function private.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function private.set_updated_at();
create trigger blueprints_set_updated_at before update on public.blueprints for each row execute function private.set_updated_at();
create trigger implementation_tasks_set_updated_at before update on public.implementation_tasks for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
