// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assert } from "jsr:@std/assert@1";

Deno.test(
  "upload classification exposes and persists accounting ambiguity instead of returning empty success",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./handler.ts", import.meta.url),
    );
    assert(source.includes('"reconciliation_required"'));
    assert(source.includes('"UPLOAD_CLASSIFICATION_RECONCILIATION_REQUIRED"'));
    assert(source.includes("classification_status: classificationStatus"));
    assert(source.includes('ingestStatus: "reconciliation_required"'));
    assert(source.includes("settleResponse("));
    assert(source.includes('name: "prompted_ingest_classification"'));
    assert(source.includes("additionalProperties: false"));
    assert(source.includes("outputSchema: INGEST_CLASSIFICATION_SCHEMA"));
    assert(source.includes("result.structured"));
    assert(!source.includes("JSON.parse(raw)"));
    assert(
      !source.includes(
        "catch (_error) {\n      // Keep whatever we managed to produce",
      ),
    );
  },
);
