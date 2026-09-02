import { describe, expect, it } from "vitest";
import type { Section } from "@prompted/shared";
import { assessImportFidelity } from "./import-fidelity";

function section(id: string, name: string, content: string): Section {
  return {
    id,
    document_id: "document-1",
    user_id: "user-1",
    name,
    order_index: 0,
    content,
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

describe("assessImportFidelity", () => {
  it("warns about PDF layout loss", () => {
    const report = assessImportFidelity({
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      extractedText: "Experience\nManaged a venue.",
      sections: [section("one", "Experience", "Managed a venue.")],
    });

    expect(report.sourceType).toBe("pdf");
    expect(report.warnings.some((warning) => warning.includes("columns"))).toBe(true);
  });

  it("flags possible tables and columns", () => {
    const report = assessImportFidelity({
      fileName: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractedText: "Name\tAmount\nRent    1000    Paid",
      sections: [section("one", "Budget", "Name\tAmount\nRent    1000    Paid")],
    });

    expect(report.warnings.some((warning) => warning.includes("table-like"))).toBe(true);
    expect(report.confidenceBySectionId.one).not.toBe("high");
  });

  it("classifies XLSX aliases and explains reduced spreadsheet fidelity", () => {
    for (const mimeType of [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ]) {
      const report = assessImportFidelity({
        fileName: "evidence.xlsx",
        mimeType,
        extractedText: "Sheet: Evidence\nClaim,Source\nConfirmed,Fixture",
        sections: [section("one", "Evidence", "Confirmed evidence")],
      });

      expect(report.sourceType).toBe("xlsx");
      expect(report.warnings.join(" ")).toMatch(/formulas.*merged cells.*visual formatting/i);
    }
  });

  it("gives high confidence when multiple structural signals are present", () => {
    const report = assessImportFidelity({
      fileName: "resume.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractedText: "Professional Experience\n\n## Venue Manager\n\n- Led operations\n- Managed staff",
      sections: [section("one", "Professional Experience", "## Venue Manager\n\n- Led operations\n- Managed staff")],
    });

    expect(report.confidenceBySectionId.one).toBe("high");
    expect((report.evidenceBySectionId.one ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
