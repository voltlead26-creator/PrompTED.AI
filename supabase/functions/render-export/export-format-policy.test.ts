import { assert, assertEquals } from "jsr:@std/assert@1";
import { resolveExportFormat } from "./export-format-policy.ts";
import { PLANS } from "../../../packages/shared/src/plans.ts";

Deno.test("plan export features match the existing activated format policy", () => {
  const activated = ["pdf", "word", "excel"].filter(format => resolveExportFormat(format).ok);
  for (const plan of Object.values(PLANS)) {
    const advertised = plan.features.filter(feature => / export$/i.test(feature))
      .flatMap(feature => feature.replace(/ export$/i, "").toLowerCase().split(/,\s*/));
    assertEquals(advertised, activated, `${plan.id} advertises only activated exports`);
  }
});

Deno.test("missing and explicit PDF formats activate inspected PDF only", () => {
  assertEquals(resolveExportFormat(undefined), { ok: true, format: "pdf" });
  assertEquals(resolveExportFormat("pdf"), { ok: true, format: "pdf" });
});

Deno.test("historical Word and Excel values fail closed without mislabelled bytes", () => {
  for (const format of ["word", "excel"]) {
    assertEquals(resolveExportFormat(format), {
      ok: false,
      status: 409,
      code: "LEGACY_EXPORT_FORMAT_NOT_ACTIVATED",
      message:
        "Inspected PDF is currently the only activated export format. Existing historical exports are unchanged.",
    });
  }
});

Deno.test("unknown, null, and malformed formats are invalid", () => {
  for (const format of [null, "", "docx", 1, {}, []]) {
    assertEquals(resolveExportFormat(format), {
      ok: false,
      status: 400,
      code: "EXPORT_FORMAT_INVALID",
      message: "Choose an activated export format.",
    });
  }
});

Deno.test("render-export gates format before durable target reads and contains no mislabelled artifact branch", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const policy = source.indexOf("resolveExportFormat(body.format)");
  const targetRead = source.indexOf('"load_legacy_export_snapshot"');

  assert(policy >= 0);
  assert(targetRead > policy);
  for (
    const prohibited of [
      "application/msword",
      "application/vnd.ms-excel",
      "buildBudgetXml",
      "filenameStem}.doc",
      "filenameStem}.xls",
      "filenameStem}.html",
    ]
  ) {
    assert(
      !source.includes(prohibited),
      `mislabelled export path survived: ${prohibited}`,
    );
  }
});
