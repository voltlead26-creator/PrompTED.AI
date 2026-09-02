// =====================================================
// PrompTED — Export HTML template (Deno / Edge runtime)
//
// Mirrors packages/shared/src/export.ts buildExportHtml. The server is
// the authority: it re-filters to approved sections and re-applies the
// brand kit here, never trusting the client to have done so.
// =====================================================

export interface ExportSection {
  name: string;
  content: string;
  status: string;
  is_required: boolean;
  order_index: number;
}

export interface BrandKit {
  id: string;
  business_id: string;
  logo_url: string | null;
  primary_colour: string;
  secondary_colour: string | null;
  footer_text: string | null;
  revision: number;
  logo_operation_id: string | null;
  logo_storage_path: string | null;
  logo_content_sha256: string | null;
  logo_media_type: "image/png" | "image/jpeg" | "image/webp" | null;
  logo_byte_length: number | null;
  logo_status: "ready" | "legacy_unverified" | "reconciliation_required";
  updated_at: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function looksLikeHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

/** Defence-in-depth strip — the server never trusts client-sanitised HTML. */
function stripDangerousHtml(html: string): string {
  return html
    .replace(
      /<\s*(script|style|iframe|object|embed|svg|math|template)[\s\S]*?<\/\s*\1\s*>/gi,
      "",
    )
    .replace(
      /<\s*(script|style|iframe|object|embed|svg|math|template)\b[^>]*\/?>/gi,
      "",
    )
    .replace(
      /<\/?\s*(img|picture|source|video|audio|track|link|meta|base|form|input|button|textarea|select|option)\b[^>]*>/gi,
      "",
    )
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(style|src|srcset|poster|background|ping|action|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(
      /\shref\s*=\s*("|')?\s*(?!https?:|mailto:|tel:|#)[^\s>"']*(?:\1)?/gi,
      "",
    );
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
    if (!match || match[1]?.toLowerCase() !== businessId.toLowerCase()) {
      return null;
    }
    return candidate.href;
  } catch {
    return null;
  }
}

function safeVerifiedBrandLogoSource(value: string | null): string | null {
  if (value === null) return null;
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      value,
    ) && value.length <= 7_100_000
    ? value
    : null;
}

function renderBody(content: string): string {
  const cleaned = content.replace(/<!--\s*prompted:[^>]*-->/gi, "").trim();
  if (!cleaned) return "";
  content = cleaned;
  if (looksLikeHtml(content)) return stripDangerousHtml(content);
  return content
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Approved sections only, in order — the export must never leak drafts. */
export function approvedOnly(sections: ExportSection[]): ExportSection[] {
  return sections
    .filter((s) => s.status === "approved")
    .sort((a, b) => a.order_index - b.order_index);
}

/** Names of required sections that are not yet approved. */
export function unapprovedRequired(sections: ExportSection[]): string[] {
  return sections
    .filter((s) => s.is_required && s.status !== "approved")
    .map((s) => s.name);
}

export function buildExportHtml(
  title: string,
  sections: ExportSection[],
  brandKit?: BrandKit | null,
  lede?: string,
  trustedAssetOrigin?: string,
  verifiedBrandLogoSource?: string | null,
): string {
  const approved = approvedOnly(sections);
  const headingColour = safeHeadingColour(brandKit?.primary_colour);
  const logoUrl = verifiedBrandLogoSource === undefined
    ? safeBrandLogoUrl(
      brandKit?.logo_url,
      trustedAssetOrigin,
      brandKit?.business_id,
    )
    : safeVerifiedBrandLogoSource(verifiedBrandLogoSource);
  const logo = logoUrl
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" />`
    : "";
  const footer = brandKit?.footer_text
    ? `<footer class="footer">${escapeHtml(brandKit.footer_text)}</footer>`
    : "";
  const ledeHtml = lede ? `<p class="lede">${escapeHtml(lede)}</p>` : "";

  const body = approved
    .map(
      (s) =>
        `<section class="section"><h2 style="color:${headingColour}">${
          escapeHtml(s.name)
        }</h2>${renderBody(s.content)}</section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${
    escapeHtml(title)
  }</title>
<style>
  body { font-family: "Nunito", Arial, sans-serif; color: #26211c; line-height: 1.7; margin: 48px; }
  .logo { max-height: 56px; margin-bottom: 24px; }
  h1 { font-size: 28px; margin: 0 0 8px; color: ${headingColour}; }
  h2 { font-size: 19px; margin: 24px 0 8px; }
  .lede { color: #5e544a; font-style: italic; margin: 0 0 24px; }
  .section { margin-bottom: 20px; }
  .footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #ddd4c5; font-size: 13px; color: #8c7f74; }
  ul, ol { padding-left: 24px; }
</style></head>
<body>${logo}<h1>${
    escapeHtml(title)
  }</h1>${ledeHtml}${body}${footer}</body></html>`;
}
