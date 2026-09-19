-- Durable Autopilot watchdog prerequisites.
-- A database-owned token authenticates the cron -> Edge Function call without
-- exposing the project's publishable or secret API keys in the cron command.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'autopilot_watchdog_token'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'autopilot_watchdog_token',
      'Internal token for the Riseklix Autopilot watchdog cron'
    );
  end if;
end
$$;

create or replace function public.verify_autopilot_watchdog_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select p_token is not null
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'autopilot_watchdog_token'
        and decrypted_secret = p_token
    );
$$;

revoke all on function public.verify_autopilot_watchdog_token(text) from public;
revoke all on function public.verify_autopilot_watchdog_token(text) from anon;
revoke all on function public.verify_autopilot_watchdog_token(text) from authenticated;
grant execute on function public.verify_autopilot_watchdog_token(text) to service_role;

