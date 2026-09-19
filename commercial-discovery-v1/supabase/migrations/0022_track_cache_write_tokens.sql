alter table public.ai_usage_events
  add column if not exists cache_write_tokens bigint not null default 0;

