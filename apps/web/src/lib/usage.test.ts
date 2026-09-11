import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "./browser-principal-state";
import { fetchUsageState } from "./usage";

const mocks = vi.hoisted(() => ({
  access: { data: null, error: null } as { data: unknown; error: unknown },
  usage: { count: 0, error: null } as { count: unknown; error: unknown },
}));

function client() {
  return {
    rpc: async (name: string) => {
      expect(name).toBe("get_effective_product_access_v1");
      return mocks.access;
    },
    from: (table: string) => {
      expect(table).toBe("usage_ledger");
      return { select: () => ({ eq: () => ({ eq: () => ({ gte: async () => mocks.usage }) }) }) };
    },
  };
}
const accessResponse = {
  contract_version: "product-access.1", user_id: "81001111-0000-4000-8000-000000000001",
  subscription_plan: "free", effective_plan: "free", subscription_status: null,
  current_period_end: null, access_profile: "subscription", monthly_document_cap: 3,
  ai_editing: false, business_features: false,
};

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
  recordBrowserPrincipal("81001111-0000-4000-8000-000000000001");
  mocks.access = { data: { ...accessResponse }, error: null };
  mocks.usage = { count: 0, error: null };
});

describe("confirmed account usage", () => {
  it("uses Free only after confirming there is no subscription and usage was read", async () => {
    await expect(fetchUsageState("81001111-0000-4000-8000-000000000001")).resolves.toEqual({
      plan: "free",
      access: expect.objectContaining({ accessProfile: "subscription", monthlyDocumentCap: 3 }),
      documentsThisMonth: 0,
      subscriptionStatus: null,
      currentPeriodEnd: null,
    });
  });

  it.each(["access", "usage"] as const)(
    "rejects %s read failures instead of inventing a free plan or zero usage",
    async (kind) => {
      mocks[kind].error = { message: "private database details" };
      await expect(fetchUsageState("81001111-0000-4000-8000-000000000001")).rejects.toThrow("ACCOUNT_USAGE_UNAVAILABLE");
    },
  );

  it.each([null, -1, 0.5, "3"])("rejects invalid usage count %s", async (count) => {
    mocks.usage.count = count;
    await expect(fetchUsageState("81001111-0000-4000-8000-000000000001")).rejects.toThrow("ACCOUNT_USAGE_INVALID");
  });

  it("rejects a malformed subscription", async () => {
    mocks.access.data = { plan: "invented", status: "active", current_period_end: null };
    await expect(fetchUsageState("81001111-0000-4000-8000-000000000001")).rejects.toThrow("ACCOUNT_USAGE_INVALID");
  });

  it("rejects another account before reading", async () => {
    await expect(fetchUsageState("user-2")).rejects.toThrow();
  });

  it("returns a valid paid subscription and exact usage without changing entitlement", async () => {
    mocks.access.data = {
      ...accessResponse,
      subscription_plan: "pro", effective_plan: "pro",
      subscription_status: "active", monthly_document_cap: 20, ai_editing: true,
      current_period_end: "2026-10-01T00:00:00Z",
    };
    mocks.usage.count = 7;
    await expect(fetchUsageState("81001111-0000-4000-8000-000000000001")).resolves.toEqual({
      plan: "pro",
      access: expect.objectContaining({ accessProfile: "subscription", monthlyDocumentCap: 20, aiEditing: true }),
      subscriptionStatus: "active",
      currentPeriodEnd: "2026-10-01T00:00:00Z",
      documentsThisMonth: 7,
    });
  });

  it("rejects a cancelled observation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchUsageState("81001111-0000-4000-8000-000000000001", controller.signal)).rejects.toThrow();
  });
});

it("returns owner access without fabricating a paid plan", async () => {
  mocks.access.data = { ...accessResponse, access_profile: "owner", monthly_document_cap: 1000,
    ai_editing: true, business_features: true };
  await expect(fetchUsageState(accessResponse.user_id)).resolves.toMatchObject({ plan: "free",
    access: { accessProfile: "owner", monthlyDocumentCap: 1000, businessFeatures: true } });
});
it("rejects a valid projection belonging to a different account", async () => {
  mocks.access.data = { ...accessResponse, user_id: "81001111-0000-4000-8000-000000000002" };
  await expect(fetchUsageState(accessResponse.user_id)).rejects.toThrow("ACCOUNT_USAGE_INVALID");
});
