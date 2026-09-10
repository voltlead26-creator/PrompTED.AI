import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertHistoricalRowsPreserved, assertHostedLedgerPhase, validateHostedLedgerUpgradePlan } from "./hosted-ledger-upgrade-acceptance.mjs";

const bytes = readFileSync(new URL("./hosted-ledger-upgrade-baseline.json", import.meta.url));
const manifest = JSON.parse(bytes).manifest;
const hash = value => createHash("sha256").update(value).digest("hex");
test("rehearses the exact recorded 68-version ledger and its reviewed 13 forward migrations", () => {
  // Historical fixture tests retain their recorded inputs. The runner still
  // supplies ALL current SQL to the unchanged validator before an upgrade run.
  const reviewed = Object.fromEntries(Object.keys(manifest).map(file =>
    [file, hash(readFileSync(new URL(`../../../${file}`, import.meta.url)))]));
  const plan = validateHostedLedgerUpgradePlan(reviewed, reviewed);
  assert.equal(plan.hostedVersions.length, 68); assert.equal(plan.versions.length, 81);
  assert.equal(plan.pendingFiles.length, 13);
  assert.ok(plan.hostedVersions.includes("20260906010846"));
  assert.ok(!plan.hostedVersions.includes("20260906000500"));
  assert.equal(plan.pendingFiles[0], "supabase/migrations/20260906000500_captured_exact_wording_assessment.sql");
  assert.equal(Object.keys(plan.historicalManifest).filter(file => file.startsWith("supabase/migrations/")).length, 68);
  assert.equal(Object.keys(plan.historicalManifest).filter(file => file.startsWith("supabase/tests/")).length, 50);
});
for (const [label, mutate] of [
  ["unknown migration", value => { value["supabase/migrations/20990101000000_unknown.sql"] = "a".repeat(64); }],
  ["changed backfill", value => { value["supabase/migrations/20260906000500_captured_exact_wording_assessment.sql"] = "a".repeat(64); }],
  ["removed historical migration", value => { delete value["supabase/migrations/20260906010846_profile_resume_upload_reads.sql"]; }],
  ["changed regression", value => { value["supabase/tests/upload_source_preparation.test.sql"] = "a".repeat(64); }],
]) test(`rejects ${label}`, () => {
  const changed = { ...manifest }; mutate(changed);
  assert.throws(() => validateHostedLedgerUpgradePlan(changed, changed), /exact reviewed SQL manifest/);
});
test("rejects omitted current SQL and altered observed-history evidence", () => {
  assert.throws(() => validateHostedLedgerUpgradePlan(manifest, { ...manifest, "supabase/tests/omitted.sql": "a".repeat(64) }), /all current SQL/);
  assert.throws(() => validateHostedLedgerUpgradePlan(manifest, manifest, Buffer.concat([bytes, Buffer.from("\n")])), /baseline changed/);
});
test("both phases require exact active and held migration bytes", () => {
  const plan = validateHostedLedgerUpgradePlan(manifest, manifest);
  const held = Object.fromEntries(plan.pendingFiles.map(file => [file, manifest[file]]));
  assertHostedLedgerPhase(plan, "full", manifest, {});
  assertHostedLedgerPhase(plan, "historical", plan.historicalManifest, held);
  assert.throws(() => assertHostedLedgerPhase(plan, "historical", manifest, held), /phase/);
  assert.throws(() => assertHostedLedgerPhase(plan, "historical", plan.historicalManifest, {}), /Held/);
  assert.throws(() => assertHostedLedgerPhase(plan, "full", manifest, held), /Held/);
  assert.throws(() => assertHostedLedgerPhase(plan, "unknown", manifest, {}), /Unknown/);
});
test("additive schema columns preserve all existing row values", () => {
  const before = [{ id: "fixture-1", content: "  café\n", provider: "anthropic", value: null }];
  assertHistoricalRowsPreserved(before, [{ ...before[0], new_column: null }]);
  for (const after of [[], [{ ...before[0], id: "replacement" }], [{ ...before[0], content: "café" }],
    [{ ...before[0], provider: "openai" }], [{ ...before[0], value: "" }]]) {
    assert.throws(() => assertHistoricalRowsPreserved(before, after), /changed/);
  }
  assert.throws(() => assertHistoricalRowsPreserved([], []), /Positive historical rows/);
});
