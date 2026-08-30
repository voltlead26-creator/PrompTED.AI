import { describe, it, expect } from "vitest";
import type { Section } from "./types";
import {
  summariseApproval,
  canExport,
  applyContentEdit,
  approveSection,
  unapproveSection,
  toggleLock,
  pushVersion,
  reindex,
  sortByOrder,
  moveSectionTo,
  moveSectionUp,
  moveSectionDown,
  buildSeedDocument,
} from "./workspace";

function section(overrides: Partial<Section>): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: overrides.id ?? "s1",
    document_id: "d1",
    user_id: "u1",
    name: overrides.name ?? "Section",
    order_index: overrides.order_index ?? 0,
    content: overrides.content ?? "",
    status: overrides.status ?? "draft",
    version_history: overrides.version_history ?? [],
    is_required: overrides.is_required ?? true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("summariseApproval + export gate", () => {
  it("counts only approved sections and labels them", () => {
    const sections = [
      section({ id: "a", status: "approved" }),
      section({ id: "b", status: "draft" }),
      section({ id: "c", status: "edited" }),
    ];
    const s = summariseApproval(sections);
    expect(s.approved).toBe(1);
    expect(s.total).toBe(3);
    expect(s.label).toBe("1 of 3 sections approved");
  });

  it("export is gated on REQUIRED sections only — optional never blocks", () => {
    const sections = [
      section({ id: "a", status: "approved", is_required: true }),
      section({ id: "b", status: "draft", is_required: false }),
    ];
    expect(canExport(sections)).toBe(true);
    expect(summariseApproval(sections).allRequiredApproved).toBe(true);
  });

  it("export stays gated while a required section is unapproved", () => {
    const sections = [
      section({ id: "a", status: "approved", is_required: true }),
      section({ id: "b", status: "edited", is_required: true }),
    ];
    expect(canExport(sections)).toBe(false);
  });

  it("never exports an empty document", () => {
    expect(canExport([])).toBe(false);
  });

  it("uses singular label for one section", () => {
    expect(summariseApproval([section({ status: "approved" })]).label).toBe(
      "1 of 1 section approved",
    );
  });
});

describe("status transitions", () => {
  it("editing moves draft → edited and stamps updated_at", () => {
    const before = section({ status: "draft", content: "old" });
    const after = applyContentEdit(before, "new");
    expect(after.status).toBe("edited");
    expect(after.content).toBe("new");
  });

  it("editing an approved section drops it back to edited", () => {
    const after = applyContentEdit(section({ status: "approved" }), "changed");
    expect(after.status).toBe("edited");
  });

  it("locked sections reject content edits", () => {
    const locked = section({ status: "locked", content: "x" });
    expect(applyContentEdit(locked, "y")).toBe(locked);
  });

  it("identical content is a no-op (same reference)", () => {
    const s = section({ content: "same" });
    expect(applyContentEdit(s, "same")).toBe(s);
  });

  it("approve and un-approve round-trip", () => {
    const approved = approveSection(section({ status: "edited" }));
    expect(approved.status).toBe("approved");
    expect(unapproveSection(approved).status).toBe("edited");
  });

  it("toggleLock locks then unlocks", () => {
    const locked = toggleLock(section({ status: "draft" }));
    expect(locked.status).toBe("locked");
    expect(toggleLock(locked).status).toBe("edited");
  });

  it("pushVersion appends current content, never clears history", () => {
    const s = section({
      content: "v2",
      version_history: [{ content: "v1", saved_at: "2026-01-01T00:00:00.000Z" }],
    });
    const history = pushVersion(s);
    expect(history).toHaveLength(2);
    expect(history[1]?.content).toBe("v2");
  });
});

describe("reordering", () => {
  const base = [
    section({ id: "a", order_index: 0 }),
    section({ id: "b", order_index: 1 }),
    section({ id: "c", order_index: 2 }),
  ];

  it("reindex restamps order_index to array position", () => {
    const shuffled = [base[2]!, base[0]!, base[1]!];
    const result = reindex(shuffled);
    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(result.map((s) => s.order_index)).toEqual([0, 1, 2]);
  });

  it("moveSectionTo moves and reindexes without touching content", () => {
    const moved = moveSectionTo(base, "a", 2);
    expect(moved.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(moved.map((s) => s.order_index)).toEqual([0, 1, 2]);
    expect(moved.every((s) => s.content === "")).toBe(true);
  });

  it("moveSectionUp / moveSectionDown shift by one", () => {
    expect(moveSectionUp(base, "c").map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(moveSectionDown(base, "a").map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("moving the first up / last down is a no-op", () => {
    expect(moveSectionUp(base, "a")).toBe(base);
    expect(moveSectionDown(base, "c")).toBe(base);
  });

  it("locked sections cannot be moved", () => {
    const withLock = [
      section({ id: "a", order_index: 0, status: "locked" }),
      section({ id: "b", order_index: 1 }),
    ];
    expect(moveSectionDown(withLock, "a")).toBe(withLock);
  });

  it("sortByOrder returns an ordered copy", () => {
    const shuffled = [base[2]!, base[0]!, base[1]!];
    expect(sortByOrder(shuffled).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("buildSeedDocument", () => {
  it("creates a titled document with required + optional sections", () => {
    const seed = buildSeedDocument({
      outcomeId: "o1",
      templateName: "Offer Letter",
      situation: "Hiring",
    });
    expect(seed.title).toBe("Offer Letter");
    expect(seed.sections.length).toBeGreaterThan(0);
    expect(seed.sections.some((s) => s.is_required)).toBe(true);
    expect(seed.sections.some((s) => !s.is_required)).toBe(true);
    expect(seed.sections.every((s) => s.document_id === seed.documentId)).toBe(
      true,
    );
    expect(seed.sections.map((s) => s.order_index)).toEqual(
      seed.sections.map((_, i) => i),
    );
  });
});
