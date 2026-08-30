import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates/index";
import { hasTemplateDraft } from "./templates/template-drafts";
import { buildSeedDocument, canExport, summariseApproval } from "./workspace";

describe("template seed document audit", () => {
  it("audits every catalogue template so none can be generated blank", () => {
    // Deliberately not pinned to a literal count: the real audit is the
    // per-template loop below (every section has a draft, nothing blank).
    // A hardcoded count here only goes stale every time a template is
    // added, aborting the loop before it ever runs and silently skipping
    // the actual audit for whatever was added.
    expect(TEMPLATES.length).toBeGreaterThan(0);

    for (const template of TEMPLATES) {
      const seed = buildSeedDocument({
        outcomeId: `audit-${template.slug}`,
        templateName: template.name,
        situation: `Audit context for ${template.name}`,
      });

      expect(seed.title).toBe(template.name);
      expect(seed.sections).toHaveLength(template.sections.length);
      expect(seed.sections.length).toBeGreaterThan(0);

      const expectedSections = template.sections
        .slice()
        .sort((a, b) => a.order - b.order);

      seed.sections.forEach((section, index) => {
        const expected = expectedSections[index];
        expect(expected).toBeDefined();
        // The resume template is the one deliberate exception to a flat
        // catalogue-section mapping: buildSeedDocument splits work history
        // into one section per job ("Work Experience - Job 1", "Job 2", ...)
        // instead of the single generic "Work Experience" section the
        // catalogue defines, by design (one job per section, never merged).
        if (template.slug === "resume" && expected!.key === "experience") {
          expect(section.name.startsWith("Work Experience")).toBe(true);
        } else {
          expect(section.name).toBe(expected!.name);
        }
        expect(section.is_required).toBe(expected!.is_required);
        expect(section.order_index).toBe(index);
        expect(section.status).toBe("draft");
        expect(
          hasTemplateDraft({ templateSlug: template.slug, sectionKey: expected!.key }),
          `${template.slug}:${expected!.key}`,
        ).toBe(true);
        expect(section.content.trim(), `${template.slug}:${section.name}`).not.toBe("");
        expect(section.content).toContain("prompted:template-draft");
        expect(section.content).not.toContain("TED will replace this scaffold");
        expect(section.content).not.toMatch(/Draft scaffold/i);
      });

      const required = seed.sections.filter((section) => section.is_required);
      expect(required.length, `${template.slug}:required`).toBeGreaterThan(0);
      expect(
        required.every((section) => section.content.trim().length > 0),
        `${template.slug}:required-content`,
      ).toBe(true);

      const approval = summariseApproval(seed.sections);
      expect(approval.total).toBe(seed.sections.length);
      expect(approval.required).toBe(required.length);
      expect(canExport(seed.sections)).toBe(false);
    }
  });

  it("uses a non-blank fallback draft for unknown recommendation names", () => {
    const seed = buildSeedDocument({
      outcomeId: "audit-unknown-template",
      templateName: "Custom TED Document",
      situation: "The user needs a custom output that is not in the catalogue.",
    });

    expect(seed.sections.length).toBeGreaterThan(0);
    expect(seed.sections.every((section) => section.content.trim().length > 0)).toBe(true);
    expect(seed.sections.every((section) => !section.content.includes("TED will replace this scaffold"))).toBe(true);
  });
});
