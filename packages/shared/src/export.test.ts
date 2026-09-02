import { describe, it, expect } from "vitest";
import type { BrandKit, Section } from "./types";
import {
  selectApprovedSections,
  assertExportable,
  ExportGateError,
  buildExportHtml,
  buildBudgetWorkbook,
  buildBundleManifest,
  slugifyFilename,
} from "./export";

function section(overrides: Partial<Section>): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "s1",
    document_id: "d1",
    user_id: "u1",
    name: "Section",
    order_index: 0,
    content: "",
    status: "approved",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

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

describe("export gate", () => {
  it("selects only approved sections, in order", () => {
    const sections = [
      section({ id: "b", order_index: 1, status: "approved", content: "B" }),
      section({ id: "a", order_index: 0, status: "approved", content: "A" }),
      section({ id: "c", order_index: 2, status: "draft", content: "C" }),
    ];
    const approved = selectApprovedSections(sections);
    expect(approved.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("throws when a required section is not approved", () => {
    const sections = [
      section({ id: "a", status: "approved" }),
      section({ id: "b", status: "edited", name: "Body" }),
    ];
    expect(() => assertExportable(sections)).toThrow(ExportGateError);
    try {
      assertExportable(sections);
    } catch (err) {
      expect((err as ExportGateError).unapproved).toContain("Body");
    }
  });

  it("allows export when optional sections are unapproved", () => {
    const sections = [
      section({ id: "a", status: "approved", is_required: true }),
      section({ id: "b", status: "draft", is_required: false }),
    ];
    expect(() => assertExportable(sections)).not.toThrow();
  });

  it("never exports an empty document", () => {
    expect(() => assertExportable([])).toThrow(ExportGateError);
  });
});

describe("buildExportHtml", () => {
  it("includes approved content and excludes unapproved content", () => {
    const html = buildExportHtml({
      title: "Offer Letter",
      sections: [
        section({ id: "a", name: "Intro", content: "Welcome aboard", status: "approved" }),
        section({ id: "b", name: "Secret", content: "DRAFT ONLY", status: "draft" }),
      ],
    });
    expect(html).toContain("Offer Letter");
    expect(html).toContain("Welcome aboard");
    expect(html).not.toContain("DRAFT ONLY");
    expect(html).not.toContain("Secret");
  });

  it("escapes angle brackets in genuine plain-text content", () => {
    const html = buildExportHtml({
      title: "T",
      sections: [section({ content: "2 < 3 and 4 > 1", status: "approved" })],
    });
    expect(html).toContain("2 &lt; 3 and 4 &gt; 1");
  });

  it("strips dangerous tags from rich-text content (defence in depth)", () => {
    const html = buildExportHtml({
      title: "T",
      sections: [
        section({
          content: "<p>Hi</p><script>alert(1)</script>",
          status: "approved",
        }),
      ],
    });
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("<p>Hi</p>");
  });

  it("removes inline event handlers from rich-text content", () => {
    const html = buildExportHtml({
      title: "T",
      sections: [section({ content: '<p onclick="steal()">Hi</p>', status: "approved" })],
    });
    expect(html).not.toContain("onclick");
    expect(html).toContain("Hi");
  });

  it("removes slash-delimited event handlers from rich-text content", () => {
    const html = buildExportHtml({
      title: "T",
      sections: [
        section({
          content: "<details/open/ontoggle=alert(document.domain)>Hi</details>",
          status: "approved",
        }),
      ],
    });

    expect(html).not.toContain("ontoggle");
    expect(html).not.toContain("alert(document.domain)");
    expect(html).toContain("Hi");
  });

  it("removes external-resource loads and styling from untrusted rich text", () => {
    const html = buildExportHtml({
      title: "T",
      sections: [
        section({
          content:
            '<p style="background:url(https://tracker.example/css)">Hi</p>' +
            '<img src="https://tracker.example/pixel" srcset="https://tracker.example/2x 2x">' +
            '<video poster="https://tracker.example/poster"><source src="https://tracker.example/movie"></video>' +
            '<table background="https://tracker.example/table"><tr><td>Cell</td></tr></table>' +
            '<a href="javascript:alert(1)">Unsafe link</a>',
          status: "approved",
        }),
      ],
    });

    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain('<p style="background:url(https://tracker.example/css)">');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
    expect(html).not.toContain("<source");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Hi");
    expect(html).toContain("Cell");
    expect(html).toContain("Unsafe link");
  });

  it("preserves quoted links only when their scheme is explicitly allowed", () => {
    const html = buildExportHtml({
      title: "T",
      sections: [
        section({
          content:
            '<p><a href="https://example.com/path">Web</a> ' +
            '<a href=" https://example.com/spaced">Spaced web</a> ' +
            "<a href=' mailto:person@example.com'>Spaced email</a> " +
            '<a href="mailto:person@example.com">Email</a> ' +
            '<a href="tel:+61000000000">Phone</a> ' +
            '<a href="#details">Details</a> ' +
            '<a href="javascript:alert(1)">Unsafe</a></p>',
          status: "approved",
        }),
      ],
    });

    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('href=" https://example.com/spaced"');
    expect(html).toContain("href=' mailto:person@example.com'");
    expect(html).toContain('href="mailto:person@example.com"');
    expect(html).toContain('href="tel:+61000000000"');
    expect(html).toContain('href="#details"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Unsafe");
  });

  it("applies brand kit colour, logo, and footer", () => {
    const logoUrl = `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logo.png`;
    const html = buildExportHtml({
      title: "Doc",
      sections: [section({ name: "Intro", content: "hi", status: "approved" })],
      brandKit: brandKit({
        logo_url: logoUrl,
        primary_colour: "#123456",
        footer_text: "ACME Pty Ltd",
        logo_status: "legacy_unverified",
      }),
      trustedAssetOrigin: "https://project.supabase.co",
    });
    expect(html).toContain("#123456");
    expect(html).toContain(logoUrl);
    expect(html).toContain("ACME Pty Ltd");
  });

  it("accepts an exact immutable versioned brand logo path", () => {
    const logoUrl = `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`;
    const html = buildExportHtml({
      title: "Doc",
      sections: [section({ content: "hi" })],
      brandKit: brandKit({
        logo_url: logoUrl,
        logo_operation_id: LOGO_OPERATION_ID,
        logo_storage_path: `brand-kits/${BUSINESS_ID}/logos/${LOGO_OPERATION_ID}.webp`,
        logo_content_sha256: "a".repeat(64),
        logo_media_type: "image/webp",
        logo_byte_length: 1024,
      }),
      trustedAssetOrigin: "https://project.supabase.co",
    });

    expect(html).toContain(logoUrl);
  });

  it.each([
    ["external", "https://tracker.example/logo.png"],
    [
      "wrong business",
      `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${OTHER_BUSINESS_ID}/logo.png`,
    ],
    [
      "unexpected nested path",
      `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/drafts/logo.png`,
    ],
    [
      "query-bearing path",
      `https://project.supabase.co/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logo.png?download=1`,
    ],
  ])("rejects a %s brand logo URL", (_case, logoUrl) => {
    const html = buildExportHtml({
      title: "Doc",
      sections: [section({ name: "Intro", content: "hi", status: "approved" })],
      brandKit: brandKit({
        logo_url: logoUrl,
        primary_colour: "red;background-image:url(http://169.254.169.254/latest/meta-data/)",
        logo_status: "legacy_unverified",
      }),
      trustedAssetOrigin: "https://project.supabase.co",
    });

    expect(html).not.toContain(`<img class="logo"`);
    expect(html).not.toContain("169.254.169.254");
    expect(html).toContain("#26211c");
  });
});

describe("buildBudgetWorkbook", () => {
  it("locks formula cells and leaves input cells editable", () => {
    const sheets = buildBudgetWorkbook({
      income_salary: 5000,
      expense_housing: 2000,
      savings_monthly: 1000,
    });
    const inputs = sheets.find((s) => s.name === "Inputs")!;
    const dashboard = sheets.find((s) => s.name === "Dashboard")!;

    // salary value cell is editable
    expect(inputs.rows[1]![1]!.locked).toBe(false);
    // dashboard total is locked + formula
    const totalIncome = dashboard.rows[1]![1]!;
    expect(totalIncome.locked).toBe(true);
    expect(totalIncome.formula).toMatch(/SUM/);
    expect(totalIncome.value).toBe(5000);
  });
});

describe("bundle export", () => {
  it("renders ready documents and skips ones failing the gate", () => {
    const manifest = buildBundleManifest("My Bundle", [
      {
        documentId: "d1",
        title: "Resume",
        sections: [section({ status: "approved", content: "ok" })],
      },
      {
        documentId: "d2",
        title: "Cover Letter",
        sections: [section({ status: "draft", content: "nope" })],
      },
    ]);
    expect(manifest.coverTitle).toBe("My Bundle");
    expect(manifest.documents).toHaveLength(1);
    expect(manifest.documents[0]?.title).toBe("Resume");
    expect(manifest.filenames).toEqual(["resume.pdf"]);
  });

  it("slugifies filenames safely", () => {
    expect(slugifyFilename("Offer Letter — Final!")).toBe("offer-letter-final");
    expect(slugifyFilename("   ")).toBe("document");
  });
});
