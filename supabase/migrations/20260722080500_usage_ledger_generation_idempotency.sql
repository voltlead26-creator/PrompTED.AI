-- Request-level billing idempotency for document credit charges.
-- The usage_ledger row itself is the idempotency record: one atomic
-- INSERT ... ON CONFLICT DO NOTHING keyed by
-- (user_id, generation_request_id, event_type).
-- Applied to the live PrompTED project on 2026-07-22 via MCP.
alter table public.usage_ledger add column if not exists generation_request_id text;

create unique index if not exists usage_ledger_generation_idempotency
  on public.usage_ledger (user_id, generation_request_id, event_type)
  where generation_request_id is not null;
