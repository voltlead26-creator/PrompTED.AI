import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { paidPlanFixtureRevisions, withPaidPlanFixtures } from "./paid-plan-fixture-revisions.mjs";

test("each reviewed paid fixture pin matches its actual source", () => {
  for (const [file, revision] of Object.entries(paidPlanFixtureRevisions)) {
    assert.equal(createHash("sha256").update(readFileSync(new URL(`../../../${file}`, import.meta.url))).digest("hex"), revision.after);
  }
});
test("fixture revision preserves historical input and every non-fixture hash", () => {
  const source = { "supabase/migrations/retained.sql": "1".repeat(64),
    ...Object.fromEntries(Object.entries(paidPlanFixtureRevisions).map(([path, pin]) => [path, pin.before])) };
  const before = structuredClone(source), result = withPaidPlanFixtures(source);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(result), Object.keys(source));
  assert.equal(result["supabase/migrations/retained.sql"], source["supabase/migrations/retained.sql"]);
  assert.deepEqual(withPaidPlanFixtures({}), {});
  for (const file of Object.keys(paidPlanFixtureRevisions)) {
    assert.throws(() => withPaidPlanFixtures({ ...source, [file]: "0".repeat(64) }), /Unexpected historical fixture/);
  }
});
