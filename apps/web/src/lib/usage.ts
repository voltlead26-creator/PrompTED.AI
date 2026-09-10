import type { UsageState } from "@prompted/shared";
import { captureOwnerDispatch } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

/** Fetch usage state for the authenticated user from the DB. */
export async function fetchUsageState(userId: string, signal?: AbortSignal): Promise<UsageState> {
  const lease = captureOwnerDispatch(userId, signal);
  return withOwnerSupabase(lease, async (supabase) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [subResult, usageResult] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("plan, status, current_period_end")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("usage_ledger")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "document_created")
        .gte("created_at", monthStart),
    ]);

    if (subResult.error || usageResult.error) throw new Error("ACCOUNT_USAGE_UNAVAILABLE");
    const documentsThisMonth = usageResult.count;
    if (
      typeof documentsThisMonth !== "number" ||
      !Number.isSafeInteger(documentsThisMonth) ||
      documentsThisMonth < 0
    ) {
      throw new Error("ACCOUNT_USAGE_INVALID");
    }
    const subscription = subResult.data;
    const plan = subscription === null ? "free" : subscription?.plan;
    const subscriptionStatus = subscription === null ? null : subscription?.status;
    const currentPeriodEnd = subscription === null ? null : subscription?.current_period_end;
    if (
      (plan !== "free" && plan !== "pro" && plan !== "premium" && plan !== "business") ||
      (subscriptionStatus !== null &&
        subscriptionStatus !== "active" &&
        subscriptionStatus !== "expired" &&
        subscriptionStatus !== "cancelled" &&
        subscriptionStatus !== "trialing") ||
      (subscription !== null && subscriptionStatus === null) ||
      (currentPeriodEnd !== null &&
        (typeof currentPeriodEnd !== "string" || !Number.isFinite(Date.parse(currentPeriodEnd))))
    )
      throw new Error("ACCOUNT_USAGE_INVALID");

    return { plan, documentsThisMonth, subscriptionStatus, currentPeriodEnd };
  });
}
