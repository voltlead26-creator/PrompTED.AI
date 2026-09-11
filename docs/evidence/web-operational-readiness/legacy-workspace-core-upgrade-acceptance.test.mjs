import { withPaidPlanFixtures } from "./paid-plan-fixture-revisions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertLegacyWorkspaceCorePhase, assertWorkspacePublicProperties, coreMigrationFile, coreMigrationSha,
  coreTestFile, coreTestSha, sourcePreparationMigrationFile, sourcePreparationMigrationSha,
  sourcePreparationTestFile, sourcePreparationTestSha, validateLegacyWorkspaceCoreUpgradePlan } from "./legacy-workspace-core-upgrade-acceptance.mjs";

const bytes = readFileSync(new URL("./legacy-workspace-core-upgrade-sql-baseline.json", import.meta.url));
const prefix = withPaidPlanFixtures(JSON.parse(bytes).manifest);
const manifest = { ...prefix, [coreMigrationFile]: coreMigrationSha, [coreTestFile]: coreTestSha,
  [sourcePreparationMigrationFile]: sourcePreparationMigrationSha, [sourcePreparationTestFile]: sourcePreparationTestSha };
const hash = value => createHash("sha256").update(value).digest("hex");

test("the historical workspace upgrade exercises its exact reviewed SQL bytes", () => {
  // The explicit paid fixture revision needs new execution evidence; preserve the 79→81 migration pins.
  // Actual upgrade mode still validates the complete live manifest separately.
  const reviewed = Object.fromEntries(Object.keys(manifest).map(file =>
    [file, hash(readFileSync(new URL(`../../../${file}`, import.meta.url)))]));
  const plan = validateLegacyWorkspaceCoreUpgradePlan(reviewed, reviewed);
  assert.equal(plan.versions.length, 81);
  assert.deepEqual(plan.manifest, reviewed);
});

test("accepts exactly the reviewed 79/48 predecessor and the core/upload migration regressions", () => {
  const plan = validateLegacyWorkspaceCoreUpgradePlan(manifest, { ...manifest, "AGENTS.md": "a".repeat(64) });
  assert.equal(plan.predecessor, "20260908150000"); assert.equal(plan.forward, "20260908160000");
  assert.equal(plan.versions.length, 81); assert.equal(Object.keys(plan.prefixManifest).length, 127);
  assert.equal(Object.keys(plan.prefixManifest).filter(file => file.startsWith("supabase/migrations/")).length, 79);
  assert.equal(Object.keys(plan.prefixManifest).filter(file => file.startsWith("supabase/tests/")).length, 48);
  assert.equal(Object.keys(plan.manifest).length, 131);
  assert.deepEqual(plan.prefixManifest, prefix); assert.deepEqual(plan.manifest, manifest);
});
for (const [label, mutate] of [
  ["future migration", value => { value["supabase/migrations/20260908170000_unknown.sql"] = "a".repeat(64); }],
  ["extra regression", value => { value["supabase/tests/unknown.test.sql"] = "a".repeat(64); }],
  ["nested SQL", value => { value["supabase/tests/nested/unknown.sql"] = "a".repeat(64); }],
  ["missing historical test", value => { delete value["supabase/tests/legacy_document_audit_binding.test.sql"]; }],
  ["changed historical test", value => { value["supabase/tests/legacy_document_audit_binding.test.sql"] = "a".repeat(64); }],
  ["changed predecessor", value => { value["supabase/migrations/20260908150000_legacy_document_audit_binding.sql"] = "a".repeat(64); }],
  ["changed old save migration", value => { value["supabase/migrations/20260901110000_atomic_legacy_workspace_save.sql"] = "a".repeat(64); }],
  ["missing forward migration", value => { delete value[coreMigrationFile]; }],
  ["changed forward migration", value => { value[coreMigrationFile] = "a".repeat(64); }],
  ["missing new regression", value => { delete value[coreTestFile]; }],
  ["changed new regression", value => { value[coreTestFile] = "a".repeat(64); }],
  ["missing upload migration", value => { delete value[sourcePreparationMigrationFile]; }],
  ["changed upload migration", value => { value[sourcePreparationMigrationFile] = "a".repeat(64); }],
  ["missing upload regression", value => { delete value[sourcePreparationTestFile]; }],
  ["changed upload regression", value => { value[sourcePreparationTestFile] = "a".repeat(64); }],
  ["duplicate forward version", value => { value["supabase/migrations/20260908160000_duplicate.sql"] = coreMigrationSha; }],
]) test(`rejects ${label} before services`, () => {
  const changed = structuredClone(manifest); mutate(changed);
  assert.throws(() => validateLegacyWorkspaceCoreUpgradePlan(changed, changed), /exact reviewed SQL manifest/);
});
test("requires all live SQL and the immutable baseline bytes", () => {
  const omitted = { ...manifest }; delete omitted[coreTestFile];
  assert.throws(() => validateLegacyWorkspaceCoreUpgradePlan(omitted, manifest), /all current SQL/);
  assert.throws(() => validateLegacyWorkspaceCoreUpgradePlan(manifest, manifest, Buffer.concat([bytes, Buffer.from(" ")])), /baseline changed/);
});
test("forward migration and regression pins match the reviewed actual source", () => {
  assert.equal(hash(readFileSync(new URL(`../../../${coreMigrationFile}`, import.meta.url))), coreMigrationSha);
  assert.equal(hash(readFileSync(new URL(`../../../${coreTestFile}`, import.meta.url))), coreTestSha);
  assert.equal(hash(readFileSync(new URL(`../../../${sourcePreparationMigrationFile}`, import.meta.url))), sourcePreparationMigrationSha);
  assert.equal(hash(readFileSync(new URL(`../../../${sourcePreparationTestFile}`, import.meta.url))), sourcePreparationTestSha);
});
const heldFull = { migration: null, test: null, sourceMigration: null, sourceTest: null };
const heldPrefix = { migration: coreMigrationSha, test: coreTestSha,
  sourceMigration: sourcePreparationMigrationSha, sourceTest: sourcePreparationTestSha };
test("full phase has every file and no held SQL", () => {
  assertLegacyWorkspaceCorePhase(validateLegacyWorkspaceCoreUpgradePlan(manifest, manifest), "full", manifest, heldFull);
});
test("predecessor phase holds exactly both forward migrations and their tests", () => {
  assertLegacyWorkspaceCorePhase(validateLegacyWorkspaceCoreUpgradePlan(manifest, manifest), "predecessor", prefix, heldPrefix);
});
for (const [label, phase, actual, held] of [
  ["unknown phase", "unknown", manifest, heldFull],
  ["missing full files", "full", prefix, heldFull],
  ["extra predecessor files", "predecessor", manifest, heldPrefix],
  ["missing held migration", "predecessor", prefix, { ...heldPrefix, migration: null }],
  ["missing held test", "predecessor", prefix, { ...heldPrefix, test: null }],
  ["changed held migration", "predecessor", prefix, { ...heldPrefix, migration: "a".repeat(64) }],
  ["changed held test", "predecessor", prefix, { ...heldPrefix, test: "a".repeat(64) }],
  ["missing held upload migration", "predecessor", prefix, { ...heldPrefix, sourceMigration: null }],
  ["missing held upload regression", "predecessor", prefix, { ...heldPrefix, sourceTest: null }],
  ["changed held upload migration", "predecessor", prefix, { ...heldPrefix, sourceMigration: "a".repeat(64) }],
  ["changed held upload regression", "predecessor", prefix, { ...heldPrefix, sourceTest: "a".repeat(64) }],
  ["full held migration", "full", manifest, { ...heldFull, migration: coreMigrationSha }],
  ["full held test", "full", manifest, { ...heldFull, test: coreTestSha }],
  ["full held upload migration", "full", manifest, { ...heldFull, sourceMigration: sourcePreparationMigrationSha }],
  ["full held upload regression", "full", manifest, { ...heldFull, sourceTest: sourcePreparationTestSha }],
  ["unknown held file", "predecessor", prefix, { ...heldPrefix, extra: "a".repeat(64) }],
  ["changed copied predecessor", "predecessor", { ...prefix, "supabase/tests/legacy_document_audit_binding.test.sql": "a".repeat(64) },
    heldPrefix],
]) test(`phase guard rejects ${label}`, () => {
  assert.throws(() => assertLegacyWorkspaceCorePhase(validateLegacyWorkspaceCoreUpgradePlan(manifest, manifest), phase, actual, held));
});

// PostgreSQL jsonb_build_object/to_jsonb serialize OID-typed catalog fields as
// decimal strings. These harmless constants match the observed transport shape;
// no raw run log or cluster-specific OID is required by the acceptance helper.
const properties = {
  catalog_identity: { oid: "20083", proowner: "16384", proisstrict: false, prolang: "13619", prorettype: "3802", proconfig: ['search_path=""'], prosupport: "-" },
  oid: "20083", owner: "16384", acl: ["postgres=X/postgres", "authenticated=X/postgres"],
  arguments: "25 2950 2950 23 3802 3802 3802", names: ["p_idempotency_key", "p_outcome_id", "p_document_id",
    "p_expected_document_revision", "p_expected_document", "p_document", "p_sections"],
  defaults_count: 0, defaults_expression: null, language: "13619", security_definer: true, config: ['search_path=""'],
  volatility: "v", parallel: "u", result_type: "3802", result_type_name: "jsonb", strict: false, returns_set: false,
  kind: "f", argument_count: 7, all_argument_types: null, argument_modes: null, cost: 100, leakproof: false, support: "-",
  execute: { authenticated: true, anon: false, service_role: false, public: false },
};
test("public property comparison accepts the observed PostgreSQL string-OID representation unchanged", () => {
  assertWorkspacePublicProperties(properties, structuredClone(properties));
  assert.throws(() => assertWorkspacePublicProperties(null, properties), /positively exist/);
});
for (const [label, mutate] of [
  ["OID", value => { value.oid += 1; }],
  ["owner", value => { value.owner += 1; }],
  ["ACL array", value => { value.acl.push("service_role=X/postgres"); }],
  ["argument name", value => { value.names[0] = "renamed_key"; }],
  ["argument type", value => { value.arguments = "25 2950 2950 20 3802 3802 3802"; }],
  ["argument default count", value => { value.defaults_count = 1; }],
  ["argument default expression", value => { value.defaults_expression = "NULL"; }],
  ["security definer", value => { value.security_definer = false; }],
  ["search path", value => { value.config = ["search_path=public"]; }],
  ["volatility", value => { value.volatility = "s"; }],
  ["parallel", value => { value.parallel = "s"; }],
  ["STRICT null shortcut", value => { value.strict = true; }],
  ["return type", value => { value.result_type = 114; value.result_type_name = "json"; }],
  ["set return", value => { value.returns_set = true; }],
  ["function kind", value => { value.kind = "p"; }],
  ["argument count", value => { value.argument_count = 8; }],
  ["all argument types", value => { value.all_argument_types = [25]; }],
  ["argument modes", value => { value.argument_modes = ["i"]; }],
  ["language", value => { value.language += 1; }],
  ["cost", value => { value.cost += 1; }],
  ["leakproof", value => { value.leakproof = true; }],
  ["planner support", value => { value.support = "unexpected"; }],
  ["service execute", value => { value.execute.service_role = true; }],
  ["anonymous execute", value => { value.execute.anon = true; }],
  ["PUBLIC execute", value => { value.execute.public = true; }],
  ["raw catalog property", value => { value.catalog_identity.prosupport = "unexpected"; }],
  ["raw catalog omitted", value => { delete value.catalog_identity; }],
]) test(`public upgrade identity rejects changed ${label}`, () => {
  const changed = structuredClone(properties); mutate(changed);
  assert.throws(() => assertWorkspacePublicProperties(properties, changed));
});

const oidFields = [["oid", "oid"], ["owner", "proowner"], ["language", "prolang"], ["result_type", "prorettype"]];
for (const boundary of ["1", "4294967295"]) test(`canonical PostgreSQL OID boundary ${boundary} retains its exact string`, () => {
  const value = structuredClone(properties);
  for (const [projected, raw] of oidFields) { value[projected] = boundary; value.catalog_identity[raw] = boundary; }
  const untouched = structuredClone(value);
  assertWorkspacePublicProperties(value, structuredClone(value));
  assert.deepEqual(value, untouched, "OID validation must not coerce the retained catalog record");
});
test("rejects the former fabricated all-numeric catalog fixture instead of coercing it", () => {
  const value = structuredClone(properties);
  for (const [projected, raw] of oidFields) {
    value[projected] = Number(value[projected]); value.catalog_identity[raw] = value[projected];
  }
  assert.throws(() => assertWorkspacePublicProperties(value, structuredClone(value)));
});
for (const [projected, raw] of oidFields) test(`${projected} requires a canonical nonzero uint32 OID string`, () => {
  // Compare the same invalid snapshot with itself: a deep-equality mismatch
  // cannot stand in for actually validating the evidence representation.
  for (const invalid of ["", "0", "-1", "+1", "01", " 1", "1 ", "1\n", "1.0", "1e3", "0x10", "4294967296",
    "9007199254740993", null, undefined, 1, 4294967295, true, ["1"], { oid: "1" }]) {
    const value = structuredClone(properties);
    value[projected] = invalid; value.catalog_identity[raw] = invalid;
    assert.throws(() => assertWorkspacePublicProperties(value, structuredClone(value)),
      `${projected}: malformed or out-of-range catalog identity was accepted`);
  }
});
for (const [projected, raw] of oidFields) test(`${projected} must match the retained raw pg_proc ${raw}`, () => {
  const value = structuredClone(properties);
  value.catalog_identity[raw] = "123456";
  assert.notEqual(value[projected], value.catalog_identity[raw]);
  assert.throws(() => assertWorkspacePublicProperties(value, structuredClone(value)),
    "An internally inconsistent catalog projection cannot become the baseline");
});
test("unchanged raw string identities remain literal while a valid later OID change is rejected", () => {
  const before = structuredClone(properties), after = structuredClone(properties);
  const original = structuredClone(before);
  assertWorkspacePublicProperties(before, after);
  assert.deepEqual(before, original); assert.deepEqual(after, original);
  after.oid = "20084"; after.catalog_identity.oid = "20084";
  assert.throws(() => assertWorkspacePublicProperties(before, after), /changed the existing public RPC identity/);
});
