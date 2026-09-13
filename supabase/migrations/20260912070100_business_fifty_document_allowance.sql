-- Owner decision, 12 September 2026: Pro 20, Premium 40, Business 50 per user.
-- Approved Business price: US$50 per user/month; configure billing separately.
-- Preserve subscription identity, usage and previously captured reservations.
begin;

create or replace function private.resolve_product_access_v1(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_user auth.users%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_subscription_plan text := 'free';
  v_effective_plan text := 'free';
  v_owner boolean;
  v_cap integer;
begin
  if p_user_id is null then
    raise exception 'PRODUCT_ACCESS_USER_REQUIRED' using errcode='22023';
  end if;
  select * into v_user from auth.users where id=p_user_id;
  if not found then
    raise exception 'PRODUCT_ACCESS_USER_NOT_FOUND' using errcode='22023';
  end if;
  select * into v_subscription from public.subscriptions where user_id=p_user_id
    order by updated_at desc limit 1;
  if found then
    v_subscription_plan := v_subscription.plan;
    if v_subscription.status in ('active','trialing') then
      v_effective_plan := v_subscription_plan;
    end if;
  end if;
  v_owner := coalesce(
    v_user.is_anonymous is not true
    and (v_user.email_confirmed_at is not null or v_user.phone_confirmed_at is not null)
    and jsonb_typeof(v_user.raw_app_meta_data->'prompted')='object'
    and v_user.raw_app_meta_data #> '{prompted,access_profile}' = '"owner_1000_v1"'::jsonb,
    false);
  v_cap := case when v_owner then 1000
    when v_effective_plan = 'pro' then 20
    when v_effective_plan = 'premium' then 40
    when v_effective_plan = 'business' then 50
    else 3 end;
  return jsonb_build_object(
    'contract_version','product-access.1','user_id',p_user_id,
    'subscription_plan',v_subscription_plan,'effective_plan',v_effective_plan,
    'subscription_status',v_subscription.status,'current_period_end',v_subscription.period_end,
    'access_profile',case when v_owner then 'owner' else 'subscription' end,
    'monthly_document_cap',v_cap,
    'ai_editing',v_owner or v_effective_plan in ('pro','premium','business'),
    'business_features',v_owner or v_effective_plan='business');
end;
$function$;

commit;
