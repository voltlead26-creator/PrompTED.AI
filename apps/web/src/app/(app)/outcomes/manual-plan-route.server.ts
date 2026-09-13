import { createClient } from "@/lib/supabase/server";
import { parseManualPlanRead } from "@prompted/shared";

export type ManualPlanRoute = { kind: "manual"; planId: string } | { kind: "other" } | { kind: "unavailable" };

const READ_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && UUID.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function hasSuccessfulEnvelope(value: unknown): value is { data: unknown; error: null } {
  return isRecord(value) && Object.hasOwn(value, "data") && Object.hasOwn(value, "error") && value.error === null;
}

/** Resolve the manual graph before starting either document hydration or TED
 * generation. Errors are explicit; a failed lookup is never a generated plan. */
export async function resolveManualPlanRoute(outcomeId: string, signal?: AbortSignal): Promise<ManualPlanRoute> {
  if (!isUuid(outcomeId) || signal?.aborted) return { kind: "unavailable" };
  return new Promise<ManualPlanRoute>(resolve => {
    const controller = new AbortController();
    const deadline = performance.now() + READ_TIMEOUT_MS;
    const retired = () => controller.signal.aborted || performance.now() >= deadline;
    let settled = false;
    const finish = (route: ManualPlanRoute) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve(retired() ? { kind: "unavailable" } : route);
    };
    const cancel = () => {
      controller.abort();
      finish({ kind: "unavailable" });
    };
    const timer = setTimeout(cancel, READ_TIMEOUT_MS);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }

    // The outer promise bounds SDK/client/auth work even when an await ignores
    // cancellation. Retirement checks prevent any late continuation dispatch.
    const read = async (): Promise<ManualPlanRoute> => {
      const client = await createClient();
      if (retired()) return { kind: "unavailable" };
      const authentication: unknown = await client.auth.getUser();
      if (retired() || !hasSuccessfulEnvelope(authentication) || !isRecord(authentication.data) ||
        !Object.hasOwn(authentication.data, "user")) return { kind: "unavailable" };
      const user = authentication.data.user;
      if (user === null) return { kind: "other" };
      if (!isRecord(user)) return { kind: "unavailable" };
      // Capture the verified owner before the next await; SDK result objects
      // must not be able to change the identity used to validate readback.
      const ownerId = user.id;
      if (!isUuid(ownerId)) return { kind: "unavailable" };
      if (retired()) return { kind: "unavailable" };
      const result: unknown = await client.rpc("get_own_manual_plan_v1", {
        p_plan_id: null, p_outcome_id: outcomeId,
      }).abortSignal(controller.signal);
      if (retired() || !hasSuccessfulEnvelope(result)) return { kind: "unavailable" };
      const response = parseManualPlanRead(result.data, ownerId);
      if (!response) return { kind: "unavailable" };
      if (response.plan === null) return { kind: "other" };
      return response.plan.outcome_id === outcomeId
        ? { kind: "manual", planId: response.plan.plan_id } : { kind: "unavailable" };
    };
    // Attach both outcomes now so a late rejection after timeout is consumed.
    void read().then(finish, () => finish({ kind: "unavailable" }));
  });
}
