import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectUploadSourceSqlScope } from "./upload-source-sql-scope.mjs";

const baseline = readFileSync(new URL("./db-20260906195011905-3917f5c1/manifest.json", import.meta.url));
const clockFile = "supabase/migrations/20260906160000_upload_source_checkpoint_v2.sql";
const current = {
  ...JSON.parse(baseline).manifest,
  [clockFile]: "858cc1251294935cefc0eb0e2ae7c0fcb05bbbc5182978e47f303cfc128bcd97",
};

test("selects the exact RED SQL inputs with the reviewed clock fix before any service starts", () => {
  const result = selectUploadSourceSqlScope(baseline, current);
  assert.deepEqual(result.selected, current);
  assert.deepEqual(result.excluded, {});
  assert.equal(Object.keys(result.selected).length, 107);
});

test("records later SQL separately and never adds it to upload acceptance", () => {
  const extras = {
    "supabase/migrations/20260907053000_ollama_credit_fallback.sql": "1".repeat(64),
    "supabase/tests/other_task.test.sql": "2".repeat(64),
  };
  const result = selectUploadSourceSqlScope(baseline, { ...current, ...extras, "apps/web/package.json": "3".repeat(64) });
  assert.deepEqual(result.selected, current);
  assert.deepEqual(result.excluded, extras);
});

test("rejects changed baseline evidence, including whitespace-only changes", () => {
  assert.throws(() => selectUploadSourceSqlScope(Buffer.concat([baseline, Buffer.from("\n")]), current),
    /Upload RED evidence manifest changed/);
});

for (const [label, file, digest] of [
  ["old clock implementation", clockFile, JSON.parse(baseline).manifest[clockFile]],
  ["different clock implementation", clockFile, "f".repeat(64)],
  ["missing migration", clockFile, undefined],
  ["changed regression", "supabase/tests/upload_source_checkpoint_v2.test.sql", "0".repeat(64)],
  ["missing regression", "supabase/tests/upload_source_checkpoint_v2.test.sql", undefined],
]) {
  test(`rejects ${label} before copying SQL`, () => {
    assert.throws(() => selectUploadSourceSqlScope(baseline, { ...current, [file]: digest }),
      /Upload acceptance input changed or missing/);
  });
}
