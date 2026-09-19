-- Replace the production watchdog schedule with a configuration-safe command.
-- If project_url or the watchdog token is unavailable, the cron succeeds without
-- issuing an HTTP request and begins working automatically once Vault is configured.

select cron.unschedule('riseklix-autopilot-watchdog')
where exists (
  select 1 from cron.job where jobname = 'riseklix-autopilot-watchdog'
);

select cron.schedule(
  'riseklix-autopilot-watchdog',
  '*/2 * * * *',
  $cron$
    with watchdog_config as (
      select
        max(decrypted_secret) filter (where name = 'project_url') as project_url,
        max(decrypted_secret) filter (where name = 'autopilot_watchdog_token') as watchdog_token
      from vault.decrypted_secrets
    )
    select net.http_post(
      url := project_url || '/functions/v1/autopilot-watchdog',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-riseklix-watchdog-token', watchdog_token
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id
    from watchdog_config
    where project_url is not null
      and watchdog_token is not null;
  $cron$
);

