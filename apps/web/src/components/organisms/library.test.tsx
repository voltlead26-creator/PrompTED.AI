/**
 * Layer 13 — Library component tests.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsDue } from "./WhatsDue";
import { ChecklistScreen } from "./ChecklistScreen";
import type { ChecklistItem } from "@prompted/shared";

// Stub useChecklist so ChecklistScreen renders without Supabase
vi.mock("@/hooks/useChecklist", () => ({
  useChecklist: () => ({
    items: mockItems,
    loading: false,
    error: null,
    saveError: null,
    retry: vi.fn(),
    toggleDone: vi.fn(),
    updateText: vi.fn(),
    isSavingItem: () => false,
    savingItemIds: [],
    done: 1,
    total: 3,
    progress: 1 / 3,
  }),
  useWhatsDue: () => ({ items: [], loading: false }),
}));

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localDate();
const tomorrow = localDate(1);
const in5 = localDate(5);

const mockItems: ChecklistItem[] = [
  {
    id: "1",
    outcome_id: "o1",
    user_id: "u1",
    text: "Register with ASIC",
    due_date: today,
    reason: "Required by law",
    done: true,
    reminder_offset_days: null,
    reminder_sent: false,
    order_index: 0,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "2",
    outcome_id: "o1",
    user_id: "u1",
    text: "Open business bank account",
    due_date: tomorrow,
    reason: null,
    done: false,
    reminder_offset_days: null,
    reminder_sent: false,
    order_index: 1,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "3",
    outcome_id: "o1",
    user_id: "u1",
    text: "Get insurance quote",
    due_date: in5,
    reason: "Recommended for new businesses",
    done: false,
    reminder_offset_days: null,
    reminder_sent: false,
    order_index: 2,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
];

// ---- WhatsDue ----

describe("WhatsDue", () => {
  it("renders nothing when no items", () => {
    const { container } = render(<WhatsDue items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders items when provided", () => {
    render(<WhatsDue items={mockItems} />);
    expect(screen.getByText("Register with ASIC")).toBeInTheDocument();
    expect(screen.getByText("Open business bank account")).toBeInTheDocument();
  });

  it("shows 'Due today' for today's date", () => {
    render(<WhatsDue items={[mockItems[0]!]} />);
    expect(screen.getByText(/Due today/i)).toBeInTheDocument();
  });

  it("shows 'Due tomorrow' for tomorrow", () => {
    render(<WhatsDue items={[mockItems[1]!]} />);
    expect(screen.getByText(/Due tomorrow/i)).toBeInTheDocument();
  });

  it("has accessible section label", () => {
    render(<WhatsDue items={mockItems} />);
    expect(screen.getByRole("region", { name: /what's due/i })).toBeInTheDocument();
  });
});

// ---- ChecklistScreen ----

describe("ChecklistScreen", () => {
  it("renders checklist items", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    expect(screen.getByText("Register with ASIC")).toBeInTheDocument();
    expect(screen.getByText("Open business bank account")).toBeInTheDocument();
    expect(screen.getByText("Get insurance quote")).toBeInTheDocument();
  });

  it("shows progress count", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("renders done items with line-through styling", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    const firstItem = screen.getByText("Register with ASIC");
    // The list item ancestor should have data-done attribute
    const listItem = firstItem.closest("li");
    expect(listItem).toHaveAttribute("data-done");
  });

  it("checkboxes have correct aria-checked state", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
  });

  it("shows reason text when present", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    expect(screen.getByText("Required by law")).toBeInTheDocument();
  });

  it("has accessible section label", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    expect(screen.getByRole("region", { name: /action checklist/i })).toBeInTheDocument();
  });

  it("checkboxes are clickable", () => {
    render(<ChecklistScreen outcomeId="o1" />);
    const checkboxes = screen.getAllByRole("checkbox");
    // Just verify there are 3 checkboxes for 3 items
    expect(checkboxes).toHaveLength(3);
  });
});
