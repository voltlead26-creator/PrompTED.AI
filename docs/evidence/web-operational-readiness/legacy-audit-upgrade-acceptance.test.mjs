import { withPaidPlanFixtures } from "./paid-plan-fixture-revisions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertLegacyAuditPhase, legacyAuditFixture, legacyAuditMigrationFile, legacyAuditMigrationSha,
  legacyAuditTestFile, legacyAuditTestSha, validateLegacyAuditUpgradePlan } from "./legacy-audit-upgrade-acceptance.mjs";

const bytes = readFileSync(new URL("./legacy-audit-upgrade-sql-baseline.json", import.meta.url));
const prefix = withPaidPlanFixtures(JSON.parse(bytes).manifest);
const manifest = { ...prefix, [legacyAuditMigrationFile]: legacyAuditMigrationSha, [legacyAuditTestFile]: legacyAuditTestSha };
const hash = value => createHash("sha256").update(value).digest("hex");

test("accepts only the reviewed 78/47 predecessor plus the exact 150000 migration and regression", () => {
  const plan = validateLegacyAuditUpgradePlan(manifest, { ...manifest, "AGENTS.md": "a".repeat(64) });
  assert.equal(plan.predecessor, "20260908140000"); assert.equal(plan.forward, "20260908150000");
  assert.equal(plan.versions.length, 79); assert.equal(Object.keys(plan.prefixManifest).length, 125);
  assert.equal(Object.keys(plan.prefixManifest).filter(file => file.startsWith("supabase/migrations/")).length, 78);
  assert.equal(Object.keys(plan.prefixManifest).filter(file => file.startsWith("supabase/tests/")).length, 47);
  assert.equal(Object.keys(plan.manifest).length, 127);
  assert.deepEqual(plan.prefixManifest, prefix); assert.deepEqual(plan.manifest, manifest);
});
for (const [label, mutate] of [
  ["unknown future migration", value => { value["supabase/migrations/20260908160000_unknown.sql"] = "a".repeat(64); }],
  ["unknown extra regression", value => { value["supabase/tests/unknown.test.sql"] = "a".repeat(64); }],
  ["unknown nested SQL", value => { value["supabase/tests/nested/unknown.sql"] = "a".repeat(64); }],
  ["removed historical regression", value => { delete value["supabase/tests/template_catalogue_persistence.test.sql"]; }],
  ["changed historical regression", value => { value["supabase/tests/template_catalogue_persistence.test.sql"] = "a".repeat(64); }],
  ["changed predecessor", value => { value["supabase/migrations/20260908140000_complete_catalogue_persistence_seeds.sql"] = "a".repeat(64); }],
  ["changed old policy migration", value => { value["supabase/migrations/20260908130000_legacy_generation_policy_binding.sql"] = "a".repeat(64); }],
  ["removed forward migration", value => { delete value[legacyAuditMigrationFile]; }],
  ["changed forward migration", value => { value[legacyAuditMigrationFile] = "a".repeat(64); }],
  ["removed new regression", value => { delete value[legacyAuditTestFile]; }],
  ["changed new regression", value => { value[legacyAuditTestFile] = "a".repeat(64); }],
  ["duplicate forward version", value => { value["supabase/migrations/20260908150000_duplicate.sql"] = legacyAuditMigrationSha; }],
]) test(`rejects ${label} before services`, () => {
  const changed = structuredClone(manifest); mutate(changed);
  assert.throws(() => validateLegacyAuditUpgradePlan(changed, changed), /exact reviewed SQL manifest/);
});
test("never hides live-source drift or accepts altered baseline bytes", () => {
  const omitted = { ...manifest }; delete omitted[legacyAuditTestFile];
  assert.throws(() => validateLegacyAuditUpgradePlan(omitted, manifest), /all current SQL/);
  assert.throws(() => validateLegacyAuditUpgradePlan(manifest, manifest, Buffer.concat([bytes, Buffer.from(" ")])), /baseline changed/);
});
test("pinned forward migration and regression match actual reviewed source bytes", () => {
  assert.equal(hash(readFileSync(new URL(`../../../${legacyAuditMigrationFile}`, import.meta.url))), legacyAuditMigrationSha);
  assert.equal(hash(readFileSync(new URL(`../../../${legacyAuditTestFile}`, import.meta.url))), legacyAuditTestSha);
});
test("phase guard accepts the exact full inventory with no held files", () => {
  assertLegacyAuditPhase(validateLegacyAuditUpgradePlan(manifest, manifest), "full", manifest, { migration: null, test: null });
});
test("phase guard accepts the exact predecessor with both reviewed files held", () => {
  assertLegacyAuditPhase(validateLegacyAuditUpgradePlan(manifest, manifest), "predecessor", prefix,
    { migration: legacyAuditMigrationSha, test: legacyAuditTestSha });
});
for (const [label, phase, actual, held] of [
  ["unknown phase", "unknown", manifest, { migration: null, test: null }],
  ["missing full migration/test", "full", prefix, { migration: null, test: null }],
  ["extra predecessor migration/test", "predecessor", manifest, { migration: legacyAuditMigrationSha, test: legacyAuditTestSha }],
  ["missing held migration", "predecessor", prefix, { migration: null, test: legacyAuditTestSha }],
  ["missing held test", "predecessor", prefix, { migration: legacyAuditMigrationSha, test: null }],
  ["changed held migration", "predecessor", prefix, { migration: "a".repeat(64), test: legacyAuditTestSha }],
  ["changed held test", "predecessor", prefix, { migration: legacyAuditMigrationSha, test: "a".repeat(64) }],
  ["full phase retaining held migration", "full", manifest, { migration: legacyAuditMigrationSha, test: null }],
  ["full phase retaining held test", "full", manifest, { migration: null, test: legacyAuditTestSha }],
  ["undeclared held file", "predecessor", prefix, { migration: legacyAuditMigrationSha, test: legacyAuditTestSha, other: "a".repeat(64) }],
  ["changed copied predecessor", "predecessor", { ...prefix, "supabase/tests/template_catalogue_persistence.test.sql": "a".repeat(64) },
    { migration: legacyAuditMigrationSha, test: legacyAuditTestSha }],
]) test(`phase guard rejects ${label}`, () => {
  assert.throws(() => assertLegacyAuditPhase(validateLegacyAuditUpgradePlan(manifest, manifest), phase, actual, held));
});
test("synthetic source/target framing matches independently reviewed TS and SQL vectors", () => {
  const quality = legacyAuditFixture();
  assert.equal(quality.binding.source_sha256, "d21b160c94ff9d6bb1cccb2f6cf93d6d10771fccc6be2e723a5aed46aeb50cc6");
  assert.equal(quality.binding.target_sha256, "2a766372d7a82a4b574bd6b02fe4a9c9d2abd7cafa245c6380b217681a925eea");
  assert.equal(quality.binding.sections[0].content_sha256, hash("I was charged $10 twice."));
  const grounding = legacyAuditFixture("grounding");
  const common = value => Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["review_kind", "output_schema_name", "output_schema_version"].includes(key)));
  assert.deepEqual(common(grounding.binding), common(quality.binding));
  assert.equal(grounding.binding.output_schema_name, "prompted_document_grounding_audit");
  assert.notDeepEqual(grounding.binding, quality.binding);
});
test("source framing preserves field identity and fixture inputs own their copies", () => {
  const input = ["A\nB", "C", "", "", ""];
  const first = legacyAuditFixture("quality", input);
  const second = legacyAuditFixture("quality", ["A", "B\nC", "", "", ""]);
  assert.notEqual(first.binding.source_sha256, second.binding.source_sha256);
  input[0] = "caller mutation";
  assert.equal(first.sources[0], "A\nB");
  const unicode = legacyAuditFixture("quality", ["👩🏽‍💻\n", "", "", "", ""]);
  const field = "👩🏽‍💻\n";
  assert.equal(unicode.binding.source_sha256,
    hash(`21:legacy-audit-source.11:5${Buffer.byteLength(field, "utf8")}:${field}0:0:0:0:`));
});
