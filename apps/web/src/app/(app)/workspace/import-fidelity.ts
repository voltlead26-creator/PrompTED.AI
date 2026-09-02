import type { Section } from "@prompted/shared";

export type ImportConfidence = "high" | "medium" | "low";

export interface ImportFidelityReport {
  sourceType: "pdf" | "docx" | "xlsx" | "text" | "unknown";
  warnings: string[];
  confidenceBySectionId: Record<string, ImportConfidence>;
  evidenceBySectionId: Record<string, string[]>;
}

function sourceTypeFor(fileName: string, mimeType: string): ImportFidelityReport["sourceType"] {
  const lower = fileName.toLowerCase();
  if (mimeType.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (mimeType.includes("wordprocessingml") || lower.endsWith(".docx")) return "docx";
  if (mimeType.includes("spreadsheetml") || lower.endsWith(".xlsx")) return "xlsx";
  if (mimeType.startsWith("text/") || /\.(txt|md|csv)$/i.test(lower)) return "text";
  return "unknown";
}

function sectionEvidence(section: Section): { confidence: ImportConfidence; evidence: string[] } {
  const content = section.content.trim();
  const evidence: string[] = [];
  let score = 0;

  if (section.name && !/^(introduction|document content|untitled)/i.test(section.name)) {
    score += 2;
    evidence.push("A distinct heading was detected.");
  } else {
    evidence.push("No reliable heading was detected.");
  }

  if (/^#{2,6}\s+/m.test(content)) {
    score += 1;
    evidence.push("Subheading structure was detected.");
  }
  if (/^[-*]\s+|^\d+[.)]\s+/m.test(content)) {
    score += 1;
    evidence.push("List structure was detected.");
  }
  if (content.split(/\n\s*\n/).filter(Boolean).length >= 2) {
    score += 1;
    evidence.push("Multiple paragraph boundaries were retained.");
  }
  if (/\t|\|\s*[^\n]+\s*\|/.test(content)) {
    score -= 2;
    evidence.push("Possible table content may need manual checking.");
  }
  if (/ {4,}\S+ {4,}\S+/.test(content)) {
    score -= 2;
    evidence.push("Possible column layout may have flattened during extraction.");
  }
  if (content.length < 60) {
    score -= 1;
    evidence.push("The section contains very little extracted text.");
  }

  return {
    confidence: score >= 4 ? "high" : score >= 2 ? "medium" : "low",
    evidence,
  };
}

export function assessImportFidelity(params: {
  fileName: string;
  mimeType: string;
  extractedText: string;
  sections: Section[];
}): ImportFidelityReport {
  const sourceType = sourceTypeFor(params.fileName, params.mimeType);
  const warnings: string[] = [];

  if (sourceType === "pdf") {
    warnings.push("PDF text can lose columns, tables, page positioning and decorative formatting during extraction.");
  }
  if (sourceType === "docx") {
    warnings.push("Word headings and paragraphs are generally clearer, but tables, text boxes and floating elements still need review.");
  }
  if (sourceType === "xlsx") {
    warnings.push("Excel cell values and sheet names were extracted, but formulas, merged cells, column widths and visual formatting need review.");
  }
  if (sourceType === "text") {
    warnings.push("Plain-text imports do not contain original visual formatting.");
  }
  if (/\t|\|\s*[^\n]+\s*\|/.test(params.extractedText)) {
    warnings.push("TED detected possible table-like content. Confirm rows and columns before continuing.");
  }
  if (/ {4,}\S+ {4,}\S+/.test(params.extractedText)) {
    warnings.push("TED detected spacing that may represent multiple columns.");
  }
  if (params.extractedText.length < 120) {
    warnings.push("Very little text was extracted. This may be a scan or image-based document.");
  }

  const confidenceBySectionId: Record<string, ImportConfidence> = {};
  const evidenceBySectionId: Record<string, string[]> = {};
  for (const section of params.sections) {
    const result = sectionEvidence(section);
    confidenceBySectionId[section.id] = result.confidence;
    evidenceBySectionId[section.id] = result.evidence;
  }

  return { sourceType, warnings, confidenceBySectionId, evidenceBySectionId };
}
