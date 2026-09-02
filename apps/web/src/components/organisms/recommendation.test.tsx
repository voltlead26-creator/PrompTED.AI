import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Recommendation } from "@prompted/shared";

import { SummaryCard } from "./SummaryCard";
import { RecommendationCardGroup } from "./RecommendationCardGroup";
import { PhotoConfirmation } from "./PhotoConfirmation";
import { BundleSelector } from "./BundleSelector";

const recommendation: Recommendation = {
  primary: {
    name: "Offer Letter",
    format: "pdf",
    reason: "Confirms the offer in writing.",
    use_case: "Hiring a new employee",
    benefits: ["Clear terms", "Professional tone"],
  },
  alternatives: [
    { name: "Email Offer", format: "word", reason: "", use_case: "Informal offer", benefits: ["Quick"] },
    { name: "Employment Contract", format: "pdf", reason: "", use_case: "Full legal terms", benefits: ["Comprehensive"] },
  ],
};

describe("SummaryCard", () => {
  it("shows what TED understood", () => {
    render(<SummaryCard understood="You're hiring a new team member." />);
    expect(
      screen.getByRole("region", { name: "What TED understood" }),
    ).toBeDefined();
    expect(screen.getByText("You're hiring a new team member.")).toBeDefined();
  });

  it("supports inline adjust + save", async () => {
    const onUpdate = vi.fn();
    render(<SummaryCard understood="Original" onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole("button", { name: /Adjust/i }));
    const editor = screen.getByLabelText("Adjust what TED understood");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Revised");
    await userEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(onUpdate).toHaveBeenCalledWith("Revised");
  });

  it("passes axe", async () => {
    const { container } = render(
      <SummaryCard understood="x" onUpdate={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("RecommendationCardGroup", () => {
  it("shows one best-fit recommendation and keeps alternatives behind a disclosure", () => {
    render(
      <RecommendationCardGroup recommendation={recommendation} onConfirm={() => {}} />,
    );
    expect(screen.getByText("Best fit")).toBeDefined();
    expect(screen.getByRole("button", { name: /Create Offer Letter/i })).toBeDefined();
    expect(screen.getByText("See other options")).toBeDefined();
    expect(screen.getByRole("button", { name: /Choose Email Offer/i })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Choose Employment Contract/i }),
    ).toBeDefined();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("confirms with the primary item", async () => {
    const onConfirm = vi.fn();
    render(
      <RecommendationCardGroup
        recommendation={recommendation}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Create Offer Letter/i }),
    );
    expect(onConfirm.mock.calls[0]![0].name).toBe("Offer Letter");
  });

  it("confirms with a chosen variant's template", async () => {
    const onConfirm = vi.fn();
    render(
      <RecommendationCardGroup
        recommendation={recommendation}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Choose Employment Contract/i }),
    );
    expect(onConfirm.mock.calls[0]![0].name).toBe("Employment Contract");
  });

  it("passes axe", async () => {
    const { container } = render(
      <RecommendationCardGroup recommendation={recommendation} onConfirm={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("PhotoConfirmation", () => {
  it("shows extracted text and confirms it", async () => {
    const onConfirm = vi.fn();
    render(
      <PhotoConfirmation extractedText="Fine notice #123" onConfirm={onConfirm} />,
    );
    expect(screen.getByText("Fine notice #123")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: /That.s right — continue/i }),
    );
    expect(onConfirm).toHaveBeenCalledWith("Fine notice #123");
  });

  it("allows editing the extracted text before confirming", async () => {
    const onConfirm = vi.fn();
    render(<PhotoConfirmation extractedText="typo" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: /Looks wrong/i }));
    const editor = screen.getByLabelText("Correct the text TED read");
    await userEvent.clear(editor);
    await userEvent.type(editor, "fixed");
    await userEvent.click(
      screen.getByRole("button", { name: /That.s right — continue/i }),
    );
    expect(onConfirm).toHaveBeenCalledWith("fixed");
  });

  it("locks every transition while a durable confirmation is pending", () => {
    render(
      <PhotoConfirmation
        extractedText="Retain this text"
        onConfirm={() => {}}
        onCancel={() => {}}
        busy
      />,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Looks wrong/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Saving confirmation/i })).toBeDisabled();
  });
});

describe("BundleSelector", () => {
  const items = [
    { id: "1", name: "Offer Letter", reason: "Confirm the offer" },
    { id: "2", name: "Onboarding Checklist", reason: "First-week tasks" },
  ];

  it("proceeds with all items by default", async () => {
    const onProceed = vi.fn();
    render(
      <BundleSelector title="TED's bundle" items={items} onProceed={onProceed} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Generate 2 documents/i }),
    );
    expect(onProceed).toHaveBeenCalledWith(["1", "2"]);
  });

  it("skips an item without error", async () => {
    const onProceed = vi.fn();
    render(
      <BundleSelector title="TED's bundle" items={items} onProceed={onProceed} />,
    );
    const skipButtons = screen.getAllByRole("button", { name: /Skip/i });
    await userEvent.click(skipButtons[0]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Generate 1 document/i }),
    );
    expect(onProceed).toHaveBeenCalledWith(["2"]);
  });

  it("passes axe", async () => {
    const { container } = render(
      <BundleSelector title="TED's bundle" items={items} onProceed={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
