import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertCatalogueMigrationResult, assertCataloguePhase, catalogueSeedFile, catalogueSeedSha,
  readCatalogueSeedRows, validateCatalogueUpgradePlan } from "./catalogue-upgrade-acceptance.mjs";
import { validateLegacyPolicyUpgradePlan } from "./legacy-policy-upgrade-acceptance.mjs";

const bytes = readFileSync(new URL("./catalogue-upgrade-sql-baseline.json", import.meta.url));
const baseline = JSON.parse(bytes).manifest;
test("composes the complete reviewed SQL with the unchanged strict historical policy validator", () => {
  const plan = validateCatalogueUpgradePlan(baseline, { ...baseline, "AGENTS.md": "a".repeat(64) });
  assert.equal(plan.versions.length, 78); assert.equal(Object.keys(plan.manifest).length, 125);
  assert.equal(plan.policyPlan.versions.length, 77);
  assert.deepEqual(plan.policyPlan, validateLegacyPolicyUpgradePlan(plan.prefixManifest, plan.prefixManifest));
  assert.throws(() => validateLegacyPolicyUpgradePlan(baseline, baseline), /exactly its reviewed forward migration/);
  assert.equal(plan.prefixManifest[catalogueSeedFile], undefined);
  assert.equal(plan.prefixManifest["supabase/tests/template_catalogue_persistence.test.sql"],
    baseline["supabase/tests/template_catalogue_persistence.test.sql"]);
});
for (const [label, mutate] of [
  ["extra migration", value => { value["supabase/migrations/20260908150000_unreviewed.sql"] = "a".repeat(64); }],
  ["extra test", value => { value["supabase/tests/unreviewed.test.sql"] = "a".repeat(64); }],
  ["missing seed", value => { delete value[catalogueSeedFile]; }],
  ["changed seed", value => { value[catalogueSeedFile] = "a".repeat(64); }],
  ["changed policy", value => { value["supabase/migrations/20260908130000_legacy_generation_policy_binding.sql"] = "a".repeat(64); }],
  ["changed test", value => { value["supabase/tests/template_catalogue_persistence.test.sql"] = "a".repeat(64); }],
  ["omitted historical test", value => { delete value["supabase/tests/ollama_credit_fallback.test.sql"]; }],
  ["duplicate version", value => { value["supabase/migrations/20260908140000_duplicate.sql"] = catalogueSeedSha; }],
]) test(`fails closed before services for ${label}`, () => {
  const current = structuredClone(baseline); mutate(current);
  assert.throws(() => validateCatalogueUpgradePlan(current, current), /exact reviewed SQL manifest/);
});
test("does not hide current SQL drift or accept replacement baseline bytes", () => {
  const omitted = { ...baseline }; delete omitted[catalogueSeedFile];
  assert.throws(() => validateCatalogueUpgradePlan(omitted, baseline), /all current SQL/);
  assert.throws(() => validateCatalogueUpgradePlan(baseline, baseline, Buffer.concat([bytes, Buffer.from(" ")])), /baseline changed/);
});
test("phase guard requires every copied file and the exact held seed", () => {
  const plan = validateCatalogueUpgradePlan(baseline, baseline);
  assertCataloguePhase(plan, "full", baseline, null);
  assertCataloguePhase(plan, "policy-prefix", plan.prefixManifest, catalogueSeedSha);
  for (const [phase, actual, held] of [
    ["unknown", baseline, null], ["full", plan.prefixManifest, null], ["full", baseline, catalogueSeedSha],
    ["policy-prefix", baseline, catalogueSeedSha], ["policy-prefix", plan.prefixManifest, null],
    ["policy-prefix", plan.prefixManifest, "a".repeat(64)],
  ]) assert.throws(() => assertCataloguePhase(plan, phase, actual, held));
});
test("actual seed payload is pinned and contains the 37 reviewed rows", () => {
  const actual = readFileSync(new URL(`../../../${catalogueSeedFile}`, import.meta.url));
  assert.ok(actual.length > 128 * 1024, "This migration must be sent over stdin, not one argv element");
  assert.equal(readCatalogueSeedRows(actual).length, 37);
  assert.throws(() => readCatalogueSeedRows(Buffer.concat([actual, Buffer.from(" ")])), /bytes changed/);
});
const message = "CATALOGUE_TEMPLATE_IDENTITY_CONFLICT:11111111-0000-4000-8000-000000000024:selection-criteria-response";
test("accepts only a normally completed exact SQLSTATE 23505 collision", () => {
  assertCatalogueMigrationResult({ status: 3, stderr: `psql:<stdin>:220: ERROR:  23505: ${message}\nCONTEXT: SQL statement\n` }, message);
  assertCatalogueMigrationResult({ status: 0 }, null);
  for (const result of [
    { status: 0, stderr: `ERROR:  23505: ${message}` },
    { status: 3, stderr: `ERROR:  P0001: ${message}` },
    { status: 3, stderr: "ERROR:  23505: wrong conflict" },
    { status: 3, stderr: `ERROR:  23505: ${message}\nERROR: another error` },
    { status: 3, signal: "SIGKILL", stderr: `ERROR:  23505: ${message}` },
    { status: null, error: { code: "ETIMEDOUT" } },
  ]) assert.throws(() => assertCatalogueMigrationResult(result, message));
  assert.throws(() => assertCatalogueMigrationResult({ status: 3 }, null));
});
for (const flag of ["--profile-read-acceptance", "--upload-source-acceptance", "--upload-source-v3-acceptance",
  "--upload-rtf-alias-acceptance", "--upload-fallback-acceptance", "--upload-source-import-acceptance",
  "--workspace-read-browser-acceptance", "--workspace-upload-browser-acceptance", "--legacy-policy-upgrade-acceptance"]) {
  test(`composed catalogue mode rejects simultaneous ${flag} before runtime resolution`, () => {
    const result = spawnSync(process.execPath, [new URL("./run-isolated-db-baseline.mjs", import.meta.url).pathname,
      "--catalogue-upgrade-acceptance", flag], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Catalogue upgrade mode is exclusive/);
  });
}
