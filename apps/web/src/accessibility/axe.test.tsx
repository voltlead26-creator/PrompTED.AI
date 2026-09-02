/**
 * Layer 16 — Accessibility tests.
 * Uses axe-core (via vitest-axe) to verify zero violations on key components.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { ChecklistItem } from "@prompted/shared";

// ---- Mocks ----------------------------------------------------------------

vi.mock("@/hooks/useChecklist", () => ({
  useChecklist: () => ({
    items: mockChecklistItems,
    loading: false,
    error: null,
    saveError: null,
    retry: vi.fn(),
    toggleDone: vi.fn(),
    updateText: vi.fn(),
    isSavingItem: () => false,
    savingItemIds: [],
    done: 1,
    total: 2,
    progress: 0.5,
  }),
  useWhatsDue: () => ({ items: [], loading: false }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const today = new Date().toISOString().split("T")[0]!;

const mockChecklistItems: ChecklistItem[] = [
  {
    id: "1",
    outcome_id: "o1",
    user_id: "u1",
    text: "Register with ASIC",
    due_date: today,
    reason: "Required by law",
    done: false,
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
    due_date: null,
    reason: null,
    done: true,
    reminder_offset_days: null,
    reminder_sent: false,
    order_index: 1,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
];

// ---- Tests ----------------------------------------------------------------

describe("Accessibility — WhatsDue", () => {
  it("has no axe violations when items are present", async () => {
    const { WhatsDue } = await import("@/components/organisms/WhatsDue");
    const { container } = render(<WhatsDue items={mockChecklistItems} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations when empty (renders null)", async () => {
    const { WhatsDue } = await import("@/components/organisms/WhatsDue");
    const { container } = render(<WhatsDue items={[]} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("Accessibility — ChecklistScreen", () => {
  it("has no axe violations", async () => {
    const { ChecklistScreen } = await import(
      "@/components/organisms/ChecklistScreen"
    );
    const { container } = render(<ChecklistScreen outcomeId="o1" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
