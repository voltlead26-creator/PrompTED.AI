import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "./browser-principal-state";
import { fetchUsageState } from "./usage";

const mocks = vi.hoisted(() => ({
  subscription: { data: null, error: null } as { data: unknown; error: unknown },
  usage: { count: 0, error: null } as { count: unknown; error: unknown },
}));

function client() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "subscriptions"
            ? {
                single: async () => mocks.subscription,
                maybeSingle: async () => mocks.subscription,
              }
            : { eq: () => ({ gte: async () => mocks.usage }) },
      }),
    }),
  };
}

vi.mock("./supabase/client", () => ({ createClient: () => client() }));
vi.mock("./supabase/owner-client", () => ({
  withOwnerSupabase: async (
    lease: { assertCurrent: () => void },
    action: (value: ReturnType<typeof client>) => Promise<unknown>,
  ) => {
    lease.assertCurrent();
    const result = await action(client());
    lease.assertCurrent();
    return result;
  },
}));

beforeEach(() => {
  recordBrowserPrincipal("user-1");
  mocks.subscription = { data: null, error: null };
  mocks.usage = { count: 0, error: null };
});

describe("confirmed account usage", () => {
  it("uses Free only after confirming there is no subscription and usage was read", async () => {
    await expect(fetchUsageState("user-1")).resolves.toEqual({
      plan: "free",
      documentsThisMonth: 0,
      subscriptionStatus: null,
      currentPeriodEnd: null,
    });
  });

  it.each(["subscription", "usage"] as const)(
    "rejects %s read failures instead of inventing a free plan or zero usage",
    async (kind) => {
      mocks[kind].error = { message: "private database details" };
      await expect(fetchUsageState("user-1")).rejects.toThrow("ACCOUNT_USAGE_UNAVAILABLE");
    },
  );

  it.each([null, -1, 0.5, "3"])("rejects invalid usage count %s", async (count) => {
    mocks.usage.count = count;
    await expect(fetchUsageState("user-1")).rejects.toThrow("ACCOUNT_USAGE_INVALID");
  });

  it("rejects a malformed subscription", async () => {
    mocks.subscription.data = { plan: "invented", status: "active", current_period_end: null };
    await expect(fetchUsageState("user-1")).rejects.toThrow("ACCOUNT_USAGE_INVALID");
  });

  it("rejects another account before reading", async () => {
    await expect(fetchUsageState("user-2")).rejects.toThrow();
  });

  it("returns a valid paid subscription and exact usage without changing entitlement", async () => {
    mocks.subscription.data = {
      plan: "pro",
      status: "active",
      current_period_end: "2026-10-01T00:00:00Z",
    };
    mocks.usage.count = 7;
    await expect(fetchUsageState("user-1")).resolves.toEqual({
      plan: "pro",
      subscriptionStatus: "active",
      currentPeriodEnd: "2026-10-01T00:00:00Z",
      documentsThisMonth: 7,
    });
  });

  it("rejects a cancelled observation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchUsageState("user-1", controller.signal)).rejects.toThrow();
  });
});
