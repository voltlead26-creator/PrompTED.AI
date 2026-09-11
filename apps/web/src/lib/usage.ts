import { parseEffectiveProductAccess, type UsageState } from "@prompted/shared/plans";
import { captureOwnerDispatch } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

/** Fetch usage state for the authenticated user from the DB. */
export async function fetchUsageState(userId: string, signal?: AbortSignal): Promise<UsageState> {
  const lease = captureOwnerDispatch(userId, signal);
  return withOwnerSupabase(lease, async (supabase) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [accessResult, usageResult] = await Promise.all([
      supabase.rpc("get_effective_product_access_v1"),
      supabase
        .from("usage_ledger")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "document_created")
        .gte("created_at", monthStart),
    ]);

    if (accessResult.error || usageResult.error) throw new Error("ACCOUNT_USAGE_UNAVAILABLE");
    const documentsThisMonth = usageResult.count;
    if (
      typeof documentsThisMonth !== "number" ||
      !Number.isSafeInteger(documentsThisMonth) ||
      documentsThisMonth < 0
    ) {
      throw new Error("ACCOUNT_USAGE_INVALID");
    }
    let access;
    try {
      access = parseEffectiveProductAccess(accessResult.data, userId);
    } catch {
      throw new Error("ACCOUNT_USAGE_INVALID");
    }
    return { plan: access.subscriptionPlan, access, documentsThisMonth,
      subscriptionStatus: access.subscriptionStatus, currentPeriodEnd: access.currentPeriodEnd };

  });
}
