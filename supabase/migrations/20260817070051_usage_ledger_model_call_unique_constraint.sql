-- cost-tracker.trackModelCall() upserts into usage_ledger with
-- onConflict: "user_id,generation_request_id,event_type" to make retries of
-- the same generation idempotent, but no unique constraint matching that
-- target ever existed. Every such upsert has been failing with "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification" —
-- silently swallowed and logged as "cost-tracker: model_call insert failed:
-- unknown" — meaning per-call cost/usage tracking has not been recording
-- data. Confirmed no existing duplicate rows before adding this.

-- Must be a full (non-partial) constraint: supabase-js's upsert(..., {
-- onConflict }) emits `ON CONFLICT (col, col, col)` with no WHERE clause, and
-- Postgres can only infer a partial unique index as the arbiter when the
-- ON CONFLICT target itself repeats a WHERE clause implying the index's
-- predicate — which the client here has no way to supply. Postgres already
-- treats every NULL as distinct under a plain unique constraint, so the
-- other (non-generation-request-scoped) insert path — which never sets
-- generation_request_id — is unaffected.
do $$
declare
  existing_definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
    into existing_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'public.usage_ledger'::regclass
    and constraint_record.conname = 'usage_ledger_model_call_dedupe';

  if existing_definition is null then
    alter table public.usage_ledger
      add constraint usage_ledger_model_call_dedupe
      unique (user_id, generation_request_id, event_type);
  elsif existing_definition <> 'UNIQUE (user_id, generation_request_id, event_type)' then
    raise exception
      'usage_ledger_model_call_dedupe exists with an incompatible definition: %',
      existing_definition;
  end if;
end;
$$;
