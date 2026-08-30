import { describe, expect, it } from "vitest";
import {
  canCreateDocument,
  hasAiEditing,
  hasBusinessFeatures,
  nextPlanUp,
  PLAN_ORDER,
  planDefinition,
  PLANS,
  summariseUsage,
} from "./plans";

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
