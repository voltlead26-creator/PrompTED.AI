import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EffectiveProductAccess } from "@prompted/shared/plans";
import { SubscriptionPlan } from "./SubscriptionPlan";

const access: EffectiveProductAccess = {
  userId: "81001111-0000-4000-8000-000000000001", subscriptionPlan: "free",
  effectivePlan: "free", subscriptionStatus: null, currentPeriodEnd: null,
  accessProfile: "owner", monthlyDocumentCap: 1000, aiEditing: true, businessFeatures: true,
};
describe("account access presentation", () => {
  it.each([["pro", 20], ["premium", 40], ["business", 50]] as const)(
    "shows the approved %s allowance without a server projection",
    (plan, cap) => {
      render(<SubscriptionPlan plan={plan} documentsThisMonth={cap} onUpgrade={vi.fn()} />);
      expect(screen.getByText(`${cap} documents per month`)).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
      expect(screen.queryByText("Unlimited documents")).not.toBeInTheDocument();
      if (plan === "business") expect(screen.getByRole("alert")).not.toHaveTextContent("Upgrade");
      if (plan === "business") expect(screen.getByText("Brand kit (logo, colours, footer)")).toBeInTheDocument();
    },
  );
  it("shows finite owner access separately from billing without an upgrade action", () => {
    render(<SubscriptionPlan plan="free" access={access} documentsThisMonth={999} onUpgrade={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Owner access" })).toBeInTheDocument();
    expect(screen.getByText("Subscription: Free")).toBeInTheDocument();
    expect(screen.getByText("1,000 documents per month")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upgrade" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "99.9");
  });
  it("reports the owner's real limit without offering a fake upgrade", () => {
    render(<SubscriptionPlan plan="free" access={access} documentsThisMonth={1000} onUpgrade={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("monthly limit");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upgrade");
  });
  it("uses the server cap consistently for ordinary paid account text and meter", () => {
    render(<SubscriptionPlan plan="pro" documentsThisMonth={10} access={{ ...access,
      subscriptionPlan: "pro", effectivePlan: "pro", subscriptionStatus: "active",
      accessProfile: "subscription", monthlyDocumentCap: 20, businessFeatures: false }} />);
    expect(screen.getByText("20 documents per month")).toBeInTheDocument();
    expect(screen.queryByText("50 documents per month")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });
  it.each([["premium", 40], ["business", 50]] as const)("shows the server allowance for %s and retains its features", (plan, cap) => {
    render(<SubscriptionPlan plan={plan} documentsThisMonth={20} access={{ ...access,
      subscriptionPlan: plan, effectivePlan: plan, subscriptionStatus: "active",
      accessProfile: "subscription", monthlyDocumentCap: cap, businessFeatures: plan === "business" }} />);
    expect(screen.getByText(`${cap} documents per month`)).toBeInTheDocument();
    expect(screen.queryByText("Unlimited documents")).not.toBeInTheDocument();
    expect(screen.queryByText("1,000 documents per month")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(20 / cap * 100));
    if (plan === "business") expect(screen.getByText("Brand kit (logo, colours, footer)")).toBeInTheDocument();
    else expect(screen.queryByText("Brand kit (logo, colours, footer)")).not.toBeInTheDocument();
  });
});

describe("upgrade eligibility follows effective access", () => {
  it.each(["expired", "cancelled"] as const)(
    "offers an upgrade at the effective Free cap while retaining the %s Business billing record",
    (subscriptionStatus) => {
      const onUpgrade = vi.fn();
      const expiredAccess: EffectiveProductAccess = { ...access,
        subscriptionPlan: "business", effectivePlan: "free", subscriptionStatus,
        currentPeriodEnd: "2020-10-15T12:00:00.000Z", accessProfile: "subscription",
        monthlyDocumentCap: 3, aiEditing: false, businessFeatures: false };
      render(<SubscriptionPlan plan={expiredAccess.subscriptionPlan} access={expiredAccess}
        subscriptionStatus={expiredAccess.subscriptionStatus} currentPeriodEnd={expiredAccess.currentPeriodEnd}
        documentsThisMonth={3} onUpgrade={onUpgrade} />);

      expect(screen.getByRole("heading", { name: "Business" })).toBeInTheDocument();
      expect(screen.getByText(/^Subscription period end:/)).toHaveTextContent("2020");
      expect(screen.getByText("3 documents per month")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
      expect(screen.getByRole("alert")).toHaveTextContent("Upgrade to create more documents");
      expect(screen.getByRole("alert")).not.toHaveTextContent("next month");
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(onUpgrade).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("list", { name: "Free plan features" })).toHaveTextContent("Manual editing");
      expect(screen.queryByText("Brand kit (logo, colours, footer)")).not.toBeInTheDocument();
    },
  );

  it("retains the active Business limit and features without offering another upgrade", () => {
    const activeAccess: EffectiveProductAccess = { ...access,
      subscriptionPlan: "business", effectivePlan: "business", subscriptionStatus: "active",
      currentPeriodEnd: "2030-10-15T12:00:00.000Z", accessProfile: "subscription",
      monthlyDocumentCap: 50, aiEditing: true, businessFeatures: true };
    render(<SubscriptionPlan plan={activeAccess.subscriptionPlan} access={activeAccess}
      subscriptionStatus={activeAccess.subscriptionStatus} currentPeriodEnd={activeAccess.currentPeriodEnd}
      documentsThisMonth={50} onUpgrade={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Business" })).toBeInTheDocument();
    expect(screen.getByText("50 documents per month")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("alert")).toHaveTextContent("next month");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upgrade");
    expect(screen.queryByRole("button", { name: "Upgrade" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Business plan features" }))
      .toHaveTextContent("Brand kit (logo, colours, footer)");
  });

  it("keeps finite owner access independent of an expired Business subscription", () => {
    const ownerAccess: EffectiveProductAccess = { ...access, subscriptionPlan: "business",
      subscriptionStatus: "expired", currentPeriodEnd: "2020-10-15T12:00:00.000Z" };
    render(<SubscriptionPlan plan={ownerAccess.subscriptionPlan} access={ownerAccess}
      subscriptionStatus={ownerAccess.subscriptionStatus} currentPeriodEnd={ownerAccess.currentPeriodEnd}
      documentsThisMonth={1000} onUpgrade={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Owner access" })).toBeInTheDocument();
    expect(screen.getByText("Subscription: Business")).toBeInTheDocument();
    expect(screen.getByText(/^Subscription period end:/)).toHaveTextContent("2020");
    expect(screen.getByText("1,000 documents per month")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("alert")).toHaveTextContent("next month");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upgrade");
    expect(screen.queryByRole("button", { name: "Upgrade" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Owner access features" }))
      .toHaveTextContent("Business features, including branding");
  });
});

describe("subscription period presentation", () => {
  it.each([
    ["active", "2030-10-15T12:00:00.000Z", "premium", 40],
    ["trialing", "2030-10-15T12:00:00.000Z", "premium", 40],
    ["cancelled", "2020-10-15T12:00:00.000Z", "free", 3],
    ["expired", "2020-10-15T12:00:00.000Z", "free", 3],
  ] as const)("describes the recorded period for %s access without inferring renewal", (status, periodEnd, effectivePlan, cap) => {
    // The access projection omits renewal intent. In particular, RevenueCat
    // cancellation can leave status active while will_renew is false.
    const subscriptionAccess: EffectiveProductAccess = { ...access,
      subscriptionPlan: "premium", effectivePlan, subscriptionStatus: status,
      currentPeriodEnd: periodEnd, accessProfile: "subscription", monthlyDocumentCap: cap,
      aiEditing: effectivePlan !== "free", businessFeatures: false };
    render(<SubscriptionPlan plan={subscriptionAccess.subscriptionPlan} access={subscriptionAccess}
      subscriptionStatus={subscriptionAccess.subscriptionStatus} currentPeriodEnd={subscriptionAccess.currentPeriodEnd}
      documentsThisMonth={1} />);

    const period = screen.getByText(/^Subscription period end:/);
    expect(period).toHaveTextContent("October");
    expect(period).toHaveTextContent(periodEnd.slice(0, 4));
    expect(screen.queryByText(/^(Renews|Access ends) /)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" })).toBeInTheDocument();
    expect(screen.getByText(`${cap} documents per month`)).toBeInTheDocument();
  });

  it("describes a supplied period without assuming renewal when subscription status was not fetched", () => {
    render(<SubscriptionPlan plan="pro" documentsThisMonth={1} currentPeriodEnd="2030-10-15T12:00:00.000Z" />);
    const period = screen.getByText(/^Subscription period end:/);
    expect(period).toHaveTextContent("October");
    expect(period).toHaveTextContent("2030");
    expect(screen.queryByText(/^(Renews|Access ends) /)).not.toBeInTheDocument();
  });

  it("keeps an expired subscription period separate from continuing owner access", () => {
    const ownerAccess: EffectiveProductAccess = { ...access, subscriptionPlan: "premium",
      subscriptionStatus: "expired", currentPeriodEnd: "2020-10-15T12:00:00.000Z" };
    render(<SubscriptionPlan plan={ownerAccess.subscriptionPlan} access={ownerAccess}
      subscriptionStatus={ownerAccess.subscriptionStatus} currentPeriodEnd={ownerAccess.currentPeriodEnd}
      documentsThisMonth={999} onUpgrade={vi.fn()} />);
    const period = screen.getByText(/^Subscription period end:/);
    expect(period).toHaveTextContent("October");
    expect(period).toHaveTextContent("2020");
    expect(screen.queryByText(/^(Renews|Access ends) /)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Owner access" })).toBeInTheDocument();
    expect(screen.getByText("Subscription: Premium")).toBeInTheDocument();
    expect(screen.getByText("1,000 documents per month")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upgrade" })).not.toBeInTheDocument();
  });
});
