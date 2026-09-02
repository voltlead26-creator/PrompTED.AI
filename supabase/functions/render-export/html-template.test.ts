import { type BrandKit, buildExportHtml } from "./html-template.ts";

const BUSINESS_ID = "b7000000-0000-4000-8000-000000000001";
const OTHER_BUSINESS_ID = "b7000000-0000-4000-8000-000000000002";
const LOGO_OPERATION_ID = "b9000000-0000-8000-8000-000000000001";

function brandKit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    id: "b8000000-0000-4000-8000-000000000001",
    business_id: BUSINESS_ID,
    logo_url: null,
    primary_colour: "#dc5430",
    secondary_colour: null,
    footer_text: null,
    revision: 1,
    logo_operation_id: null,
    logo_storage_path: null,
    logo_content_sha256: null,
    logo_media_type: null,
    logo_byte_length: null,
    logo_status: "ready",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const approvedSection = (content: string) => ({
  name: "Body",
  content,
  status: "approved",
  is_required: true,
  order_index: 0,
});

Deno.test("server export strips resource-loading markup before PDF rendering", () => {
  const html = buildExportHtml("Document", [
    approvedSection(
      '<p style="background-image:url(http://169.254.169.254/latest/meta-data/)">Safe wording</p>' +
        '<img src="https://tracker.example/pixel">' +
        '<table background="https://tracker.example/table"><tr><td>Cell</td></tr></table>',
    ),
  ]);

  assert(
    !html.includes("169.254.169.254"),
    "inline CSS URL survived server sanitisation",
  );
  assert(
    !html.includes("tracker.example"),
    "resource URL survived server sanitisation",
  );
  assert(
    !html.includes("<img"),
    "resource element survived server sanitisation",
  );
  assert(html.includes("Safe wording"), "legitimate wording was removed");
  assert(html.includes("Cell"), "legitimate table content was removed");
});

Deno.test("server export strips slash-delimited active attributes before PDF rendering", () => {
  const html = buildExportHtml("Document", [
    approvedSection(
      "<details/open///ontoggle=alert(document.domain)>Visible details</details>" +
        "<p/style=background:url(https://attacker.example/style)>Visible paragraph</p>" +
        "<table/background=https://attacker.example/table><tr><td>Visible cell</td></tr></table>" +
        "<a/href=javascript:alert(document.domain)>Unsafe link text</a>" +
        "<details/open/\nontoggle=alert(document.domain)>Visible multiline details</details>" +
        '<p><strong>Safe emphasis</strong> and <a href="https://example.com/path">safe link</a> ' +
        '<a href=" https://example.com/spaced">spaced safe link</a> ' +
        "<a href=' mailto:person@example.com'>spaced safe email</a></p>",
    ),
  ]);

  for (
    const forbidden of [
      "ontoggle",
      "javascript:",
      "attacker.example",
      "background=",
      "/style=",
    ]
  ) {
    assert(
      !html.includes(forbidden),
      `dangerous export token survived: ${forbidden}`,
    );
  }
  for (
    const preserved of [
      "Visible details",
      "Visible paragraph",
      "Visible cell",
      "Unsafe link text",
      "Visible multiline details",
      "<strong>Safe emphasis</strong>",
      'href="https://example.com/path"',
      'href=" https://example.com/spaced"',
      "href=' mailto:person@example.com'",
    ]
  ) {
    assert(
      html.includes(preserved),
      `legitimate export content was removed: ${preserved}`,
    );
  }
});

Deno.test("server export rejects caller-supplied external brand logo URLs", () => {
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    brandKit({
      logo_url: "https://tracker.example/logo.png",
      primary_colour: "#123456",
      logo_status: "legacy_unverified",
    }),
  );

  assert(
    !html.includes("tracker.example"),
    "untrusted brand logo URL survived",
  );
  assert(html.includes("#123456"), "valid brand colour was removed");
});

Deno.test("server export preserves a logo from the configured public brand-kit path", () => {
  const logoUrl =
    `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logo.png`;
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    brandKit({
      logo_url: logoUrl,
      primary_colour: "#123456",
      logo_status: "legacy_unverified",
    }),
    undefined,
    "https://project.supabase.co",
  );

  assert(html.includes(logoUrl), "trusted public brand logo was removed");
});

Deno.test("server export preserves an exact immutable versioned brand logo path", () => {
  const logoUrl =
    `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`;
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    brandKit({
      logo_url: logoUrl,
      logo_operation_id: LOGO_OPERATION_ID,
      logo_storage_path:
        `brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`,
      logo_content_sha256: "a".repeat(64),
      logo_media_type: "image/webp",
      logo_byte_length: 1024,
    }),
    undefined,
    "https://project.supabase.co",
  );

  assert(html.includes(logoUrl), "versioned public brand logo was removed");
});

Deno.test("captured export renders only its already-verified immutable logo source", () => {
  const mutableLogoUrl =
    `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`;
  const verifiedSource = "data:image/webp;base64,ZXhhY3Q=";
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    brandKit({
      logo_url: mutableLogoUrl,
      logo_operation_id: LOGO_OPERATION_ID,
      logo_storage_path:
        `brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`,
      logo_content_sha256: "a".repeat(64),
      logo_media_type: "image/webp",
      logo_byte_length: 5,
    }),
    undefined,
    "https://project.supabase.co",
    verifiedSource,
  );

  assert(html.includes(verifiedSource), "verified embedded logo was omitted");
  assert(!html.includes(mutableLogoUrl), "mutable public logo URL was reused");
});

Deno.test("captured no-logo snapshot cannot fall back to a mutable public URL", () => {
  const mutableLogoUrl =
    `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`;
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    brandKit({
      logo_url: mutableLogoUrl,
      logo_operation_id: LOGO_OPERATION_ID,
      logo_storage_path:
        `brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`,
      logo_content_sha256: "a".repeat(64),
      logo_media_type: "image/webp",
      logo_byte_length: 5,
    }),
    undefined,
    "https://project.supabase.co",
    null,
  );

  assert(!html.includes("<img"), "explicit no-logo source fell back to a URL");
});

Deno.test("server export rejects cross-business and query-bearing brand logo paths", () => {
  for (
    const logoUrl of [
      `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${OTHER_BUSINESS_ID}/logo.png`,
      `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logo.png?download=1`,
    ]
  ) {
    const html = buildExportHtml(
      "Document",
      [approvedSection("Safe wording")],
      brandKit({ logo_url: logoUrl, logo_status: "legacy_unverified" }),
      undefined,
      "https://project.supabase.co",
    );
    assert(
      !html.includes('<img class="logo"'),
      "unsafe brand logo path survived",
    );
  }
});

Deno.test("server export rejects CSS injection through the brand colour", () => {
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    brandKit({
      primary_colour:
        "red;background-image:url(http://169.254.169.254/latest/meta-data/)",
    }),
  );

  assert(
    !html.includes("169.254.169.254"),
    "brand colour CSS injection survived",
  );
  assert(
    html.includes("#26211c"),
    "unsafe brand colour did not fall back safely",
  );
});
