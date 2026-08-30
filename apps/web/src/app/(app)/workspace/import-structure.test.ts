import { describe, expect, it } from "vitest";
import { isLikelyHeading, normaliseParagraphs, splitExperienceIntoJobs, splitImportedDocument } from "./import-structure";

describe("document import structure", () => {
  it("recognises headings containing curly apostrophes", () => {
    expect(isLikelyHeading("Manager’s Summary")).toBe(true);
  });

  it("normalises Unicode bullets without corrupting text", () => {
    expect(normaliseParagraphs(["• Led a team", "• Improved service"])).toBe(
      "- Led a team\n\n- Improved service",
    );
  });

  it("splits multiple resume roles into separate jobs", () => {
    const jobs = splitExperienceIntoJobs([
      "Venue Manager at Example Hotel | 2022 — Present",
      "• Led daily operations",
      "Assistant Manager at Example Bar | 2020 — 2022",
      "• Managed rosters",
    ].join("\n"));

    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.title).toContain("Venue Manager");
    expect(jobs[1]?.title).toContain("Assistant Manager");
  });

  it("creates clean section names without mojibake", () => {
    const sections = splitImportedDocument({
      extracted: [
        "Professional Experience",
        "Venue Manager at Example Hotel | 2022 — Present",
        "• Led daily operations",
        "Assistant Manager at Example Bar | 2020 — 2022",
        "• Managed rosters",
      ].join("\n"),
      documentId: "document-1",
      userId: "user-1",
      now: "2026-07-11T00:00:00.000Z",
    });

    expect(sections).toHaveLength(2);
    expect(sections.every((section) => !section.name.includes("Ã"))).toBe(true);
    expect(sections[0]?.name).toContain("—");
  });

  it("does not create a first section from a standalone PDF page number", () => {
    const sections = splitImportedDocument({
      extracted: [
        "1",
        "",
        "Professional Summary",
        "Experienced venue manager focused on safe, welcoming operations.",
        "",
        "Page 2 of 2",
        "Professional Experience",
        "Venue Manager at Example Hotel | 2022 — Present",
        "• Led daily operations",
      ].join("\n"),
      documentId: "document-1",
      userId: "user-1",
      now: "2026-08-18T00:00:00.000Z",
    });

    expect(sections.map((section) => section.name)).not.toContain("Introduction");
    expect(sections.some((section) => section.content.trim() === "1")).toBe(false);
    expect(sections[0]?.name).toBe("Professional Summary");
  });
});
