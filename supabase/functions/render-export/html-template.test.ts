import { buildExportHtml } from "./html-template.ts";

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

Deno.test("server export rejects caller-supplied external brand logo URLs", () => {
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    { logo_url: "https://tracker.example/logo.png", primary_colour: "#123456" },
  );

  assert(
    !html.includes("tracker.example"),
    "untrusted brand logo URL survived",
  );
  assert(html.includes("#123456"), "valid brand colour was removed");
});

Deno.test("server export preserves a logo from the configured public brand-kit path", () => {
  const logoUrl =
    "https://project.supabase.co/storage/v1/object/public/assets/brand-kits/business/logo.png";
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    { logo_url: logoUrl, primary_colour: "#123456" },
    undefined,
    "https://project.supabase.co",
  );

  assert(html.includes(logoUrl), "trusted public brand logo was removed");
});

Deno.test("server export rejects CSS injection through the brand colour", () => {
  const html = buildExportHtml(
    "Document",
    [approvedSection("Safe wording")],
    {
      primary_colour:
        "red;background-image:url(http://169.254.169.254/latest/meta-data/)",
    },
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
