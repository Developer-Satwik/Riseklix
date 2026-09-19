-- Preserve who/what accepted research objects.
-- NULL means legacy/unknown for records created before this migration.

alter table public.buyer_intents
  add column if not exists review_source text
  check (review_source is null or review_source in ('manual','autopilot'));

alter table public.prompt_expressions
  add column if not exists review_source text
  check (review_source is null or review_source in ('manual','autopilot'));

alter table public.findings
  add column if not exists review_source text
  check (review_source is null or review_source in ('manual','autopilot'));

comment on column public.buyer_intents.review_source is
  'How the candidate was accepted/rejected: manual human review or Autopilot policy.';

comment on column public.prompt_expressions.review_source is
  'How the question was accepted/rejected: manual human review or Autopilot policy.';

comment on column public.findings.review_source is
  'How the finding review decision was made: manual human review or Autopilot policy.';

