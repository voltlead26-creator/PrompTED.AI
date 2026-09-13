import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaywallModal } from "./PaywallModal";

describe("paid plan comparison", () => {
  it("shows approved allowances and reserves branding for Business", () => {
    render(<PaywallModal open currentPlan="free" onClose={vi.fn()} onSelectPlan={vi.fn()} />);
    expect(within(screen.getByRole("list", { name: "Pro features" })).getByText("20 documents per month")).toBeInTheDocument();
    for (const [plan, cap] of [["Premium", 40], ["Business", 50]] as const) {
      expect(within(screen.getByRole("list", { name: `${plan} features` })).getByText(`${cap} documents per month`)).toBeInTheDocument();
    }
    expect(within(screen.getByRole("list", { name: "Business features" })).getByText("Brand kit (logo, colours, footer)")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Premium features" })).queryByText("Brand kit (logo, colours, footer)")).not.toBeInTheDocument();
    expect(screen.queryByText("Unlimited documents")).not.toBeInTheDocument();
  });

  it("shows the Business allowance to Premium users without claiming checkout is available", () => {
    render(<PaywallModal open currentPlan="premium" onClose={vi.fn()} onSelectPlan={vi.fn()} />);
    expect(screen.getByText("50 documents per month")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Online checkout isn't available yet");
  });

  it("retains a supplied feature explanation and sends only the selected plan to its callback", () => {
    const onSelectPlan = vi.fn();
    const onClose = vi.fn();
    render(<PaywallModal open currentPlan="free" feature="Edit with TED"
      onClose={onClose} onSelectPlan={onSelectPlan} />);
    const dialog = within(screen.getByRole("dialog", { name: "Upgrade to use Edit with TED" }));
    expect(dialog.getByText("Edit with TED is available on paid plans.")).toBeInTheDocument();
    expect(dialog.queryByText(/reached.*limit|upgrade to keep going/i)).not.toBeInTheDocument();
    expect(onSelectPlan).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Select Premium plan" }));
    expect(onSelectPlan.mock.calls).toEqual([["premium"]]);
    expect(onClose).not.toHaveBeenCalled();
  });
});
