import { describe, expect, it } from "vitest";
import {
  canCreateDocument,
  hasAiEditing,
  hasBusinessFeatures,
  nextPlanUp,
  PLAN_ORDER,
  planDefinition,
  PLANS,
  parseEffectiveProductAccess,
  summariseUsage,
} from "./plans";

const accessUser = "81001111-0000-4000-8000-000000000001";
const ownerAccessResponse = {
  contract_version: "product-access.1", user_id: accessUser,
  subscription_plan: "free", effective_plan: "free", subscription_status: null,
  current_period_end: null, access_profile: "owner", monthly_document_cap: 1000,
  ai_editing: true, business_features: true,
};
describe("effective product access response boundary", () => {
  it("keeps finite owner capabilities separate from real billing and drives the usage meter", () => {
    const access = parseEffectiveProductAccess(ownerAccessResponse, accessUser);
    expect(access).toMatchObject({ userId: accessUser, subscriptionPlan: "free", effectivePlan: "free",
      accessProfile: "owner", monthlyDocumentCap: 1000, aiEditing: true, businessFeatures: true });
    expect(summariseUsage({ plan: "free", documentsThisMonth: 999, access })).toMatchObject({ cap: 1000, remaining: 1, atCap: false });
    expect(canCreateDocument({ plan: "free", documentsThisMonth: 1000, access })).toBe(false);
  });
  it.each([
    { user_id: "81001111-0000-4000-8000-000000000002" }, { contract_version: "product-access.2" },
    { monthly_document_cap: null }, { monthly_document_cap: 1001 }, { monthly_document_cap: "1000" },
    { monthly_document_cap: -1 }, { monthly_document_cap: 1.5 }, { access_profile: "owner_unlimited" },
    { effective_plan: "business" }, { ai_editing: false }, { business_features: false },
    { subscription_status: "unknown" }, { current_period_end: "2026" }, { unrelated_metadata: "private" },
    { subscription_plan: "pro" }, { current_period_end: "2026-10-01T00:00:00Z" },
  ])("rejects conflicting or malformed access %j", (change) => {
    expect(() => parseEffectiveProductAccess({ ...ownerAccessResponse, ...change }, accessUser)).toThrow("PRODUCT_ACCESS_INVALID");
  });
  it.each([null, [], "owner", {}])("rejects a missing response %j", (value) => {
    expect(() => parseEffectiveProductAccess(value, accessUser)).toThrow("PRODUCT_ACCESS_INVALID");
  });
  it("resolves cancelled paid billing to ordinary free product access", () => {
    expect(parseEffectiveProductAccess({ ...ownerAccessResponse, subscription_plan: "pro",
      subscription_status: "cancelled", access_profile: "subscription", monthly_document_cap: 3,
      ai_editing: false, business_features: false }, accessUser)).toMatchObject({
      subscriptionPlan: "pro", effectivePlan: "free", accessProfile: "subscription", monthlyDocumentCap: 3 });
  });
});

describe("PLANS definitions", () => {
  it("has all four plans", () => {
    expect(Object.keys(PLANS)).toEqual(["free", "pro", "premium", "business"]);
  });

  it("free plan has a cap of 3", () => {
    expect(PLANS.free.monthlyDocumentCap).toBe(3);
  });

  it("pro plan has a cap of 50", () => {
    expect(PLANS.pro.monthlyDocumentCap).toBe(50);
  });

  it("premium plan has unlimited documents (null cap)", () => {
    expect(PLANS.premium.monthlyDocumentCap).toBeNull();
  });

  it("business plan has unlimited documents (null cap)", () => {
    expect(PLANS.business.monthlyDocumentCap).toBeNull();
  });

  it("free plan has no AI editing", () => {
    expect(PLANS.free.aiEditing).toBe(false);
  });

  it("pro plan has AI editing", () => {
    expect(PLANS.pro.aiEditing).toBe(true);
  });

  it("only business plan has business features", () => {
    expect(PLANS.free.businessFeatures).toBe(false);
    expect(PLANS.pro.businessFeatures).toBe(false);
    expect(PLANS.premium.businessFeatures).toBe(false);
    expect(PLANS.business.businessFeatures).toBe(true);
  });
});

describe("PLAN_ORDER", () => {
  it("is ordered from lowest to highest tier", () => {
    expect(PLAN_ORDER).toEqual(["free", "pro", "premium", "business"]);
  });
});

describe("planDefinition", () => {
  it("returns the correct definition for a plan", () => {
    expect(planDefinition("pro").name).toBe("Pro");
  });
});

describe("summariseUsage", () => {
  it("free plan at 0 of 3", () => {
    const s = summariseUsage({ plan: "free", documentsThisMonth: 0 });
    expect(s.cap).toBe(3);
    expect(s.used).toBe(0);
    expect(s.remaining).toBe(3);
    expect(s.atCap).toBe(false);
    expect(s.percentUsed).toBe(0);
  });

  it("free plan at 3 of 3 — at cap", () => {
    const s = summariseUsage({ plan: "free", documentsThisMonth: 3 });
    expect(s.atCap).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.percentUsed).toBe(100);
  });

  it("premium plan — unlimited (null cap)", () => {
    const s = summariseUsage({ plan: "premium", documentsThisMonth: 200 });
    expect(s.cap).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.atCap).toBe(false);
    expect(s.percentUsed).toBeNull();
  });

  it("does not exceed 100% on overages", () => {
    const s = summariseUsage({ plan: "free", documentsThisMonth: 999 });
    expect(s.percentUsed).toBe(100);
    expect(s.remaining).toBe(0);
  });
});

describe("canCreateDocument", () => {
  it("returns true when under cap", () => {
    expect(canCreateDocument({ plan: "free", documentsThisMonth: 2 })).toBe(true);
  });

  it("returns false when at cap", () => {
    expect(canCreateDocument({ plan: "free", documentsThisMonth: 3 })).toBe(false);
  });

  it("returns false when over cap", () => {
    expect(canCreateDocument({ plan: "free", documentsThisMonth: 10 })).toBe(false);
  });

  it("always returns true for unlimited plans", () => {
    expect(canCreateDocument({ plan: "premium", documentsThisMonth: 9999 })).toBe(true);
    expect(canCreateDocument({ plan: "business", documentsThisMonth: 9999 })).toBe(true);
  });
});

describe("nextPlanUp", () => {
  it("free → pro", () => {
    expect(nextPlanUp("free")).toBe("pro");
  });

  it("pro → premium", () => {
    expect(nextPlanUp("pro")).toBe("premium");
  });

  it("premium → business", () => {
    expect(nextPlanUp("premium")).toBe("business");
  });

  it("business → null (already top tier)", () => {
    expect(nextPlanUp("business")).toBeNull();
  });
});

describe("hasAiEditing", () => {
  it("returns false for free", () => {
    expect(hasAiEditing("free")).toBe(false);
  });

  it("returns true for pro, premium, business", () => {
    expect(hasAiEditing("pro")).toBe(true);
    expect(hasAiEditing("premium")).toBe(true);
    expect(hasAiEditing("business")).toBe(true);
  });
});

describe("hasBusinessFeatures", () => {
  it("returns true only for business plan", () => {
    expect(hasBusinessFeatures("free")).toBe(false);
    expect(hasBusinessFeatures("pro")).toBe(false);
    expect(hasBusinessFeatures("premium")).toBe(false);
    expect(hasBusinessFeatures("business")).toBe(true);
  });
});
