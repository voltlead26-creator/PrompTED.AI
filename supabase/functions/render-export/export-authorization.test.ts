// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  decideArtifactExport,
  decideDocumentExport,
  decideExportTarget,
} from "./export-authorization.ts";

Deno.test("export target selection requires exactly one persisted authority", () => {
  assertEquals(decideExportTarget(undefined, undefined), {
    ok: false,
    code: "EXPORT_TARGET_REQUIRED",
  });
  assertEquals(decideExportTarget("document-id", "artifact-id"), {
    ok: false,
    code: "EXPORT_TARGET_AMBIGUOUS",
  });
  assertEquals(decideExportTarget("document-id", undefined), {
    ok: true,
    kind: "document",
    id: "document-id",
  });
  assertEquals(decideExportTarget(undefined, "artifact-id"), {
    ok: true,
    kind: "artifact",
    id: "artifact-id",
  });
});

Deno.test("document export requires exact current approval for every cohort", () => {
  assertEquals(
    decideDocumentExport({ status: "approved", current_revision: 4, approved_revision: 3 }),
    { ok: false, code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL" },
  );
  assertEquals(
    decideDocumentExport({ status: "draft", current_revision: 4, approved_revision: 4 }),
    { ok: false, code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL" },
  );
  assertEquals(
    decideDocumentExport({ status: "approved", current_revision: 4, approved_revision: 4 }),
    { ok: true },
  );
});

Deno.test("artifact export requires exact parent and exact required-block approvals", () => {
  const parent = {
    status: "approved",
    quality_status: "passed",
    current_revision: 7,
    approved_revision: 7,
  };
  const approvedAction = {
    kind: "action",
    heading: "Apply",
    is_required: true,
    section_state: "final",
    approval_status: "approved",
    revision: 3,
    approved_revision: 3,
  };

  assertEquals(decideArtifactExport(parent, [approvedAction]), { ok: true });
  assertEquals(
    decideArtifactExport(parent, [
      { ...approvedAction, heading: "Optional note", is_required: false },
    ]),
    { ok: false, code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL", unapproved: [] },
  );
  assertEquals(
    decideArtifactExport({ ...parent, approved_revision: 6 }, [approvedAction]),
    { ok: false, code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL", unapproved: [] },
  );
  assertEquals(
    decideArtifactExport(parent, [{ ...approvedAction, approved_revision: null }]),
    {
      ok: false,
      code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL",
      unapproved: ["Apply"],
    },
  );
  assertEquals(
    decideArtifactExport(parent, [{ ...approvedAction, revision: 4, approved_revision: 3 }]),
    {
      ok: false,
      code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL",
      unapproved: ["Apply"],
    },
  );
});
