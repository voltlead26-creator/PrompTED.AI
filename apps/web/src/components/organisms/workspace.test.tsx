import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import {
  summariseApproval,
  type ApprovalSummary,
  type Section,
} from "@prompted/shared";

import { SectionList } from "./SectionList";
import { LivePreview } from "./LivePreview";

function section(overrides: Partial<Section>): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "s1",
    document_id: "d1",
    user_id: "u1",
    name: "Section",
    order_index: 0,
    content: "",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const threeSections = [
  section({ id: "a", name: "Introduction", order_index: 0, status: "approved" }),
  section({ id: "b", name: "Body", order_index: 1, status: "draft" }),
  section({ id: "c", name: "Closing", order_index: 2, is_required: false }),
];

function listProps(over: Partial<React.ComponentProps<typeof SectionList>> = {}) {
  const approval: ApprovalSummary = summariseApproval(threeSections);
  return {
    sections: threeSections,
    activeSectionId: "a",
    approval,
    canExport: approval.allRequiredApproved,
    onSelect: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onApprove: vi.fn(),
    onUnapprove: vi.fn(),
    onDropAt: vi.fn(),
    onExport: vi.fn(),
    ...over,
  };
}

describe("SectionList — approval counter + export gate", () => {
  it("shows an accurate approval counter", () => {
    render(<SectionList {...listProps()} />);
    expect(screen.getByText("1 of 3 sections approved")).toBeInTheDocument();
  });

  it("disables export until all required sections are approved", () => {
    render(<SectionList {...listProps()} />);
    const btn = screen.getByRole("button", { name: /Export PDF/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText("Approve all sections to export")).toBeInTheDocument();
  });

  it("enables export once every required section is approved", () => {
    const sections = [
      section({ id: "a", status: "approved", is_required: true }),
      section({ id: "b", status: "draft", is_required: false }),
    ];
    const approval = summariseApproval(sections);
    render(
      <SectionList
        {...listProps({ sections, canExport: approval.allRequiredApproved, approval })}
      />,
    );
    expect(screen.getByRole("button", { name: /Export PDF/i })).toBeEnabled();
  });

  it("fires export when enabled and clicked", async () => {
    const sections = [section({ id: "a", status: "approved" })];
    const approval = summariseApproval(sections);
    const onExport = vi.fn();
    render(
      <SectionList
        {...listProps({ sections, approval, canExport: true, onExport })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Export PDF/i }));
    expect(onExport).toHaveBeenCalledOnce();
  });
});

describe("SectionList — reordering (keyboard equivalent)", () => {
  it("offers Move up / Move down buttons for keyboard reorder", () => {
    render(<SectionList {...listProps()} />);
    expect(
      screen.getByRole("button", { name: "Move Body up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move Body down" }),
    ).toBeInTheDocument();
  });

  it("calls onMoveDown when the keyboard control is used", async () => {
    const onMoveDown = vi.fn();
    render(<SectionList {...listProps({ onMoveDown })} />);
    await userEvent.click(screen.getByRole("button", { name: "Move Body down" }));
    expect(onMoveDown).toHaveBeenCalledWith("b");
  });

  it("disables Move up on the first and Move down on the last", () => {
    render(<SectionList {...listProps()} />);
    expect(screen.getByRole("button", { name: "Move Introduction up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Closing down" })).toBeDisabled();
  });

  it("passes axe", async () => {
    const { container } = render(<SectionList {...listProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("LivePreview", () => {
  it("renders the title and every section heading + content", () => {
    render(
      <LivePreview
        title="Offer Letter"
        sections={[section({ id: "a", name: "Introduction", content: "Hello there." })]}
        lede="You're hiring."
      />,
    );
    expect(screen.getByText("Offer Letter")).toBeInTheDocument();
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Hello there.")).toBeInTheDocument();
    expect(screen.getByText("You're hiring.")).toBeInTheDocument();
  });

  it("applies the brand kit (primary colour heading + footer text)", () => {
    render(
      <LivePreview
        title="Doc"
        sections={[section({ id: "a", name: "Intro", content: "x" })]}
        brandKit={{
          id: "bk1",
          business_id: "biz1",
          logo_url: null,
          primary_colour: "#123456",
          secondary_colour: null,
          footer_text: "ACME Pty Ltd · ABN 123",
          updated_at: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("ACME Pty Ltd · ABN 123")).toBeInTheDocument();
    const heading = screen.getByText("Doc");
    expect(heading).toHaveStyle({ color: "#123456" });
  });

  it("passes axe", async () => {
    const { container } = render(
      <LivePreview title="Doc" sections={[section({ id: "a", name: "Intro", content: "x" })]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
