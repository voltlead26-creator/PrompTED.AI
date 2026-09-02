// =====================================================
// PrompTED — Export helpers (pure, framework-agnostic)
//
// The export gate, section selection, and HTML/spreadsheet document
// building. Pure so the same rules run client-side (preview/validation)
// and are mirrored by the server render Edge Function — the server is
// the authority and re-checks the gate before rendering.
// =====================================================

import type { BrandKit, Section } from "./types";
import { summariseBudget, type BudgetInputs } from "./templates/derived-fields";
import { isVisiblyEmpty } from "./visible-content";

export { isVisiblyEmpty } from "./visible-content";

export type ExportFormat = "pdf" | "word" | "excel";

export class ExportGateError extends Error {
  constructor(public readonly unapproved: string[]) {
    super("Not all required sections are approved");
    this.name = "ExportGateError";
  }
}

/** Approved sections only, in order. Unapproved content must never export. */
export function selectApprovedSections(sections: Section[]): Section[] {
  return [...sections]
    .filter((s) => s.status === "approved")
    .sort((a, b) => a.order_index - b.order_index);
}

/**
 * Throw unless every REQUIRED section is approved. The server calls this before
 * rendering so an unapproved or tampered request can never produce an export
 * (defence in depth — the UI gate is not trusted).
 */
export function assertExportable(sections: Section[]): void {
  const unapproved = sections
    .filter((s) => s.is_required && s.status !== "approved")
    .map((s) => s.name);
  if (sections.length === 0 || unapproved.length > 0) {
    throw new ExportGateError(unapproved);
  }
}

// ---- HTML rendering (PDF / Word source) ------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when content already carries HTML tags (rich text from the editor). */
function looksLikeHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

/**
 * Defence-in-depth strip for rich-text content: editor HTML is sanitised on
 * the client before storage, but the export must never trust that. Removes
 * active and resource-bearing markup, inline styling, event handlers, and
 * unsafe links. Runs in Deno too (no DOM), so it is intentionally a
 * conservative regex pass.
 */
function stripDangerousHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|template)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|template)\b[^>]*\/?>/gi, "")
    .replace(
      /<\/?\s*(img|picture|source|video|audio|track|link|meta|base|form|input|button|textarea|select|option)\b[^>]*>/gi,
      "",
    )
    .replace(/[\s/]+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /[\s/]+(style|src|srcset|poster|background|ping|action|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(/[\s/]+href\s*=\s*("|')?\s*(?!https?:|mailto:|tel:|#)[^\s>"']*(?:\1)?/gi, "");
}

function safeHeadingColour(value: string | null | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#26211c";
}

function safeBrandLogoUrl(
  value: string | null | undefined,
  trustedAssetOrigin: string | undefined,
  businessId: string | null | undefined,
): string | null {
  if (!value || !trustedAssetOrigin || !businessId) return null;
  try {
    const candidate = new URL(value);
    const trusted = new URL(trustedAssetOrigin);
    if (
      candidate.origin !== trusted.origin ||
      candidate.username !== "" ||
      candidate.password !== "" ||
      candidate.search !== "" ||
      candidate.hash !== ""
    ) {
      return null;
    }
    const match = candidate.pathname.match(
      /^\/storage\/v1\/object\/public\/assets\/brand-kits\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/(?:logo\.(?:png|jpg|webp)|logos\/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp))$/i,
    );
    if (!match || match[1]?.toLowerCase() !== businessId.toLowerCase()) return null;
    return candidate.href;
  } catch {
    return null;
  }
}

/**
 * True when content has no visible text once HTML tags and non-breaking
 * spaces are removed — a tag-only husk like "<p><br></p>" counts as empty.
 * The client uses this to keep empty sections from being approved; the
 * server-side draft validator applies the same rule as the authority.
 */
/** Render one section's content to export/preview HTML (shared so the
 * workspace mini previews show the same thing the export will). */
export function renderSectionHtml(content: string): string {
  return renderSectionBody(content);
}

function renderSectionBody(content: string): string {
  if (isVisiblyEmpty(content)) return "";
  if (looksLikeHtml(content)) return stripDangerousHtml(content);
  return content
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface ExportDocumentInput {
  title: string;
  sections: Section[];
  brandKit?: BrandKit | null;
  /** Optional lede (e.g. TED's understanding) shown under the title. */
  lede?: string;
  /** Origin allowed to serve public brand-kit logos to the renderer. */
  trustedAssetOrigin?: string;
}

/**
 * Build a complete, self-contained HTML document from the APPROVED sections.
 * This is the canonical source the server converts to PDF (headless render) or
 * serves as a Word-compatible .doc. Brand kit colours/logo/footer are applied
 * when present.
 */
export function buildExportHtml(input: ExportDocumentInput): string {
  const approved = selectApprovedSections(input.sections);
  const brand = input.brandKit;
  const headingColour = safeHeadingColour(brand?.primary_colour);

  const logoUrl = safeBrandLogoUrl(
    brand?.logo_url,
    input.trustedAssetOrigin,
    brand?.business_id,
  );
  const logo = logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" />` : "";
  const footer = brand?.footer_text
    ? `<footer class="footer">${escapeHtml(brand.footer_text)}</footer>`
    : "";
  const lede = input.lede ? `<p class="lede">${escapeHtml(input.lede)}</p>` : "";

  const body = approved
    .map(
      (s) =>
        `<section class="section"><h2 style="color:${headingColour}">${escapeHtml(s.name)}</h2>${renderSectionBody(s.content)}</section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>
  body { font-family: "Nunito", Arial, sans-serif; color: #26211c; line-height: 1.7; margin: 48px; }
  .logo { max-height: 56px; margin-bottom: 24px; }
  h1 { font-size: 28px; margin: 0 0 8px; color: ${headingColour}; }
  h2 { font-size: 19px; margin: 24px 0 8px; }
  .lede { color: #5e544a; font-style: italic; margin: 0 0 24px; }
  .section { margin-bottom: 20px; }
  .footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #ddd4c5; font-size: 13px; color: #8c7f74; }
  ul, ol { padding-left: 24px; }
</style>
</head>
<body>
${logo}
<h1>${escapeHtml(input.title)}</h1>
${lede}
${body}
${footer}
</body>
</html>`;
}

// ---- Excel (Budget Workbook) -----------------------------------

export interface SpreadsheetCell {
  value: string | number;
  /** Formula cells are locked on export; input cells stay editable. */
  locked: boolean;
  formula?: string;
}

export interface SpreadsheetSheet {
  name: string;
  rows: SpreadsheetCell[][];
}

/**
 * Build the Budget Workbook spreadsheet model: an editable inputs sheet plus a
 * locked dashboard sheet whose totals are formula/derived. The renderer turns
 * this model into a real .xlsx (formula cells protected, input cells editable).
 */
export function buildBudgetWorkbook(inputs: BudgetInputs): SpreadsheetSheet[] {
  const n = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);
  const summary = summariseBudget(inputs);

  const inputsSheet: SpreadsheetSheet = {
    name: "Inputs",
    rows: [
      [cell("Item", true), cell("Monthly amount", true)],
      [cell("Salary / wages", true), input(n(inputs.income_salary))],
      [cell("Other income", true), input(n(inputs.income_other))],
      [cell("Housing", true), input(n(inputs.expense_housing))],
      [cell("Living costs", true), input(n(inputs.expense_living))],
      [cell("Savings", true), input(n(inputs.savings_monthly))],
      [cell("Debt repayments", true), input(n(inputs.debt_repayment))],
    ],
  };

  const dashboard: SpreadsheetSheet = {
    name: "Dashboard",
    rows: [
      [cell("Measure", true), cell("Value", true)],
      [cell("Total income", true), derived(summary.totalIncome, "=SUM(Inputs!B2:B3)")],
      [cell("Total outgoings", true), derived(summary.totalOutgoings, "=SUM(Inputs!B4:B7)")],
      [cell("Surplus", true), derived(summary.surplus, "=Dashboard!B2-Dashboard!B3")],
      [
        cell("Savings rate %", true),
        derived(summary.savingsRate, "=ROUND(Inputs!B6/Dashboard!B2*100,0)"),
      ],
    ],
  };

  return [inputsSheet, dashboard];
}

function cell(value: string | number, locked: boolean): SpreadsheetCell {
  return { value, locked };
}
function input(value: number): SpreadsheetCell {
  return { value, locked: false };
}
function derived(value: number, formula: string): SpreadsheetCell {
  return { value, locked: true, formula };
}

// ---- Bundle export manifest ------------------------------------

export interface BundleExportItem {
  documentId: string;
  title: string;
  sections: Section[];
}

export interface BundleManifest {
  coverTitle: string;
  /** Documents that passed the export gate, in order. */
  documents: Array<{ documentId: string; title: string; html: string }>;
  /** Filenames for the ZIP of individual files. */
  filenames: string[];
}

/**
 * Build a bundle export: a cover title, each document rendered to HTML
 * (approved sections only), and the filenames for the per-document ZIP.
 * Documents failing the gate are skipped rather than aborting the whole bundle.
 */
export function buildBundleManifest(
  coverTitle: string,
  items: BundleExportItem[],
  brandKit?: BrandKit | null,
  trustedAssetOrigin?: string,
): BundleManifest {
  const documents: BundleManifest["documents"] = [];
  const filenames: string[] = [];
  for (const item of items) {
    try {
      assertExportable(item.sections);
    } catch {
      continue; // skip documents that aren't ready
    }
    documents.push({
      documentId: item.documentId,
      title: item.title,
      html: buildExportHtml({
        title: item.title,
        sections: item.sections,
        brandKit,
        trustedAssetOrigin,
      }),
    });
    filenames.push(`${slugifyFilename(item.title)}.pdf`);
  }
  return { coverTitle, documents, filenames };
}

/** A safe, readable filename stem from a document title. */
export function slugifyFilename(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document"
  );
}
