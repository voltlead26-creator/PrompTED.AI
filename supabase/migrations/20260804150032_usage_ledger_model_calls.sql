-- One post-success row per paid model call. Model-call rows are cost telemetry
-- and do not consume the monthly document allowance.
alter table public.usage_ledger
  drop constraint if exists usage_ledger_event_type_check;

alter table public.usage_ledger
  add constraint usage_ledger_event_type_check
  check (event_type in ('document_created', 'ai_edit', 'model_call'));

alter table public.usage_ledger
  add column if not exists task text,
  add column if not exists provider text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer;

alter table public.usage_ledger
  drop constraint if exists usage_ledger_input_tokens_nonnegative,
  drop constraint if exists usage_ledger_output_tokens_nonnegative;

alter table public.usage_ledger
  add constraint usage_ledger_input_tokens_nonnegative
    check (input_tokens is null or input_tokens >= 0),
  add constraint usage_ledger_output_tokens_nonnegative
    check (output_tokens is null or output_tokens >= 0);

create index if not exists idx_usage_model_calls_created
  on public.usage_ledger (created_at desc)
  where event_type = 'model_call';;
