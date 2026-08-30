/**
 * Layer 12 — User Accounts component tests.
 * Tests OnboardingModal, PaywallModal, SubscriptionPlan in jsdom.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingModal } from "./OnboardingModal";
import { PaywallModal } from "./PaywallModal";
import { SubscriptionPlan } from "./SubscriptionPlan";

// ---- OnboardingModal ----

describe("OnboardingModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <OnboardingModal open={false} onAccept={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows step 1 on open", () => {
    render(<OnboardingModal open onAccept={vi.fn()} />);
    expect(screen.getByText(/Hi, I'm TED/i)).toBeInTheDocument();
  });

  it("advances to step 2 on 'Meet TED'", () => {
    render(<OnboardingModal open onAccept={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /meet ted/i }));
    expect(screen.getByText(/quick word/i)).toBeInTheDocument();
  });

  it("step 2 has AI disclosure section", () => {
    render(<OnboardingModal open onAccept={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /meet ted/i }));
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/About AI-generated content/i)).toBeInTheDocument();
  });

  it("calls onAccept when Let's go clicked", () => {
    const onAccept = vi.fn();
    render(<OnboardingModal open onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button", { name: /meet ted/i }));
    fireEvent.click(screen.getByRole("button", { name: /let's go/i }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("does not have a dismiss button — cannot be closed without accepting", () => {
    render(<OnboardingModal open onAccept={vi.fn()} />);
    expect(screen.queryByLabelText(/close/i)).toBeNull();
  });

  it("has role=dialog with aria-modal=true", () => {
    render(<OnboardingModal open onAccept={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    // OnboardingModal uses role=dialog directly on its panel (no backdrop wrapper)
    expect(dialog).toBeInTheDocument();
  });
});

// ---- PaywallModal ----

describe("PaywallModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <PaywallModal
        open={false}
        currentPlan="free"
        onClose={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows plan cards for upgrade", () => {
    render(
      <PaywallModal
        open
        currentPlan="free"
        onClose={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("does not show current plan as upgrade option", () => {
    render(
      <PaywallModal
        open
        currentPlan="pro"
        onClose={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );
    // Pro is current plan; only premium and business should appear
    expect(screen.queryByRole("button", { name: /select pro plan/i })).toBeNull();
  });

  it("calls onSelectPlan when a plan is chosen", () => {
    const onSelectPlan = vi.fn();
    render(
      <PaywallModal
        open
        currentPlan="free"
        onClose={vi.fn()}
        onSelectPlan={onSelectPlan}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /select pro plan/i }));
    expect(onSelectPlan).toHaveBeenCalledWith("pro");
  });

  it("calls onClose when Not now clicked", () => {
    const onClose = vi.fn();
    render(
      <PaywallModal
        open
        currentPlan="free"
        onClose={onClose}
        onSelectPlan={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows feature description when provided", () => {
    render(
      <PaywallModal
        open
        currentPlan="free"
        feature="Edit with TED"
        onClose={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );
    expect(screen.getByText(/Upgrade to use Edit with TED/i)).toBeInTheDocument();
  });

  it("tells the user online checkout isn't live yet", () => {
    render(
      <PaywallModal
        open
        currentPlan="free"
        onClose={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );
    expect(screen.getByText(/checkout isn.t available yet/i)).toBeInTheDocument();
  });

  it("business has no upgrade options when already on business plan", () => {
    render(
      <PaywallModal
        open
        currentPlan="business"
        onClose={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

// ---- SubscriptionPlan ----

describe("SubscriptionPlan", () => {
  it("renders plan name", () => {
    render(
      <SubscriptionPlan
        plan="free"
        documentsThisMonth={1}
      />,
    );
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("shows correct usage count", () => {
    render(
      <SubscriptionPlan
        plan="free"
        documentsThisMonth={2}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/\/ 3/)).toBeInTheDocument();
  });

  it("shows 'unlimited' in usage count for premium plan", () => {
    render(
      <SubscriptionPlan
        plan="premium"
        documentsThisMonth={15}
      />,
    );
    // "/ unlimited" appears in the usage counter
    expect(screen.getByText(/\/ unlimited/i)).toBeInTheDocument();
    // no progress bar for unlimited plans
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows cap warning when at cap", () => {
    render(
      <SubscriptionPlan
        plan="free"
        documentsThisMonth={3}
      />,
    );
    expect(screen.getByText(/monthly limit/i)).toBeInTheDocument();
  });

  it("shows Upgrade button for non-business plans", () => {
    const onUpgrade = vi.fn();
    render(
      <SubscriptionPlan
        plan="free"
        documentsThisMonth={0}
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /upgrade/i }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it("does not show Upgrade button for business plan", () => {
    render(
      <SubscriptionPlan
        plan="business"
        documentsThisMonth={0}
        onUpgrade={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
  });

  it("progress bar has correct accessibility attributes", () => {
    render(
      <SubscriptionPlan
        plan="free"
        documentsThisMonth={2}
      />,
    );
    const bar = screen.getByRole("progressbar");
    const valuenow = Number(bar.getAttribute("aria-valuenow"));
    expect(valuenow).toBeCloseTo(66.67, 0);
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("shows a free-plan note instead of a renewal date", () => {
    render(<SubscriptionPlan plan="free" documentsThisMonth={0} />);
    expect(screen.getByText(/free plan/i)).toBeInTheDocument();
  });

  it("shows a renewal date for an active paid subscription", () => {
    render(
      <SubscriptionPlan
        plan="pro"
        documentsThisMonth={0}
        subscriptionStatus="active"
        currentPeriodEnd="2026-09-12T00:00:00.000Z"
      />,
    );
    expect(screen.getByText(/renews/i)).toHaveTextContent("September");
  });

  it("shows an end date for a cancelled subscription", () => {
    render(
      <SubscriptionPlan
        plan="pro"
        documentsThisMonth={0}
        subscriptionStatus="cancelled"
        currentPeriodEnd="2026-09-12T00:00:00.000Z"
      />,
    );
    expect(screen.getByText(/access ends/i)).toBeInTheDocument();
  });

  it("shows nothing extra for a paid plan with no known period end", () => {
    render(<SubscriptionPlan plan="pro" documentsThisMonth={0} />);
    expect(screen.queryByText(/renews|access ends|free plan/i)).toBeNull();
  });
});
