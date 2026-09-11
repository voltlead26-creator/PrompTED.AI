import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EffectiveProductAccess } from "@prompted/shared/plans";
import { SubscriptionPlan } from "./SubscriptionPlan";

const access: EffectiveProductAccess = {
  userId: "81001111-0000-4000-8000-000000000001", subscriptionPlan: "free",
  effectivePlan: "free", subscriptionStatus: null, currentPeriodEnd: null,
  accessProfile: "owner", monthlyDocumentCap: 1000, aiEditing: true, businessFeatures: true,
};
describe("account access presentation", () => {
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
  it.each(["premium", "business"] as const)("shows the server allowance for %s and retains its features", (plan) => {
    render(<SubscriptionPlan plan={plan} documentsThisMonth={20} access={{ ...access,
      subscriptionPlan: plan, effectivePlan: plan, subscriptionStatus: "active",
      accessProfile: "subscription", monthlyDocumentCap: 40, businessFeatures: plan === "business" }} />);
    expect(screen.getByText("40 documents per month")).toBeInTheDocument();
    expect(screen.queryByText("Unlimited documents")).not.toBeInTheDocument();
    expect(screen.queryByText("1,000 documents per month")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    if (plan === "business") expect(screen.getByText("Brand kit (logo, colours, footer)")).toBeInTheDocument();
    else expect(screen.queryByText("Brand kit (logo, colours, footer)")).not.toBeInTheDocument();
  });
});
