alter table public.competitor_candidates
  add column if not exists is_current boolean not null default true;

create index if not exists competitor_candidates_intent_current_idx
  on public.competitor_candidates(buyer_intent_id, is_current);
