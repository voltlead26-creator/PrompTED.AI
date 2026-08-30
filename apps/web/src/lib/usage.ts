import type { UsageState } from "@prompted/shared";
import { createClient } from "@/lib/supabase/client";

/** Fetch usage state for the authenticated user from the DB. */
export async function fetchUsageState(userId: string): Promise<UsageState> {
  const supabase = createClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [subResult, usageResult] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("usage_ledger")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_type", "document_created")
      .gte("created_at", monthStart),
  ]);

  const plan = (subResult.data?.plan as UsageState["plan"]) ?? "free";
  const documentsThisMonth = usageResult.count ?? 0;
  const subscriptionStatus =
    (subResult.data?.status as UsageState["subscriptionStatus"]) ?? null;
  const currentPeriodEnd = (subResult.data?.current_period_end as string | null) ?? null;

  return { plan, documentsThisMonth, subscriptionStatus, currentPeriodEnd };
}
