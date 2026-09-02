begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select has_function(
  'private',
  'enforce_captured_provider_attempt_budget',
  array[]::text[],
  'captured provider-attempt budget guard exists'
);

select has_trigger(
  'private',
  'captured_document_provider_attempts',
  'captured_provider_attempt_budget_guard',
  'every new captured provider attempt crosses the durable budget guard'
);

select ok(
  not has_function_privilege(
    'service_role',
    'private.enforce_captured_provider_attempt_budget()',
    'EXECUTE'
  ),
  'the trigger helper is not directly executable through protected compute'
);

select ok(
  pg_get_functiondef(
    'private.enforce_captured_provider_attempt_budget()'::regprocedure
  ) like '%route_snapshot%maxAttempts%'
  and pg_get_functiondef(
    'private.enforce_captured_provider_attempt_budget()'::regprocedure
  ) like '%v_limit_text !~ ''^[12]$''%'
  and pg_get_functiondef(
    'private.enforce_captured_provider_attempt_budget()'::regprocedure
  ) like '%new.attempt_number > v_limit%'
  and pg_get_functiondef(
    'private.enforce_captured_provider_attempt_budget()'::regprocedure
  ) like '%CAPTURED_PROVIDER_ATTEMPT_LIMIT_EXCEEDED%',
  'the database compares cumulative attempt number to the immutable route budget'
);

select ok(
  pg_get_triggerdef(
    (
      select oid
      from pg_trigger
      where tgrelid =
        'private.captured_document_provider_attempts'::regclass
        and tgname = 'captured_provider_attempt_budget_guard'
        and not tgisinternal
    )
  ) like '%BEFORE INSERT%',
  'the ceiling is checked before a dispatchable prepared attempt is inserted'
);

select * from finish();
rollback;
