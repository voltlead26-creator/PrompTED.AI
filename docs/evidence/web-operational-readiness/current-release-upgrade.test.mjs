import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { assertLegacyWorkspaceCorePhase, validateLegacyWorkspaceCoreUpgradePlan,
  coreMigrationSha, coreTestSha, sourcePreparationMigrationSha, sourcePreparationTestSha } from "./legacy-workspace-core-upgrade-acceptance.mjs";
import { validateHostedLedgerUpgradePlan } from "./hosted-ledger-upgrade-acceptance.mjs";

const root = new URL("../../../", import.meta.url);
const manifest = Object.fromEntries(["supabase/migrations/", "supabase/tests/"].flatMap(dir =>
  readdirSync(new URL(dir, root)).sort().map(name => {
    assert.ok(name.endsWith(".sql"));
    const file = dir + name;
    return [file, createHash("sha256").update(readFileSync(new URL(file, root))).digest("hex")];
  })));

test("current workspace upgrade binds all 93 migrations and all 59 SQL regressions", () => {
  const plan = validateLegacyWorkspaceCoreUpgradePlan(manifest, manifest);
  assert.equal(plan.versions.length, 93);
  assert.equal(Object.keys(plan.manifest).length, 152);
  assert.equal(Object.keys(plan.prefixManifest).length, 127);
  assert.equal(Object.keys(plan.additionalHeldSql).length, 21);
});

test("current hosted-ledger rehearsal retains the observed 68 versions and applies 25 exact forward files", () => {
  const plan = validateHostedLedgerUpgradePlan(manifest, manifest);
  assert.equal(plan.versions.length, 93);
  assert.equal(plan.hostedVersions.length, 68);
  assert.equal(plan.pendingFiles.length, 25);
  assert.deepEqual(plan.manifest, manifest);
});

test("workspace predecessor holds every current extension file and rejects lost or modified held bytes", () => {
  const plan=validateLegacyWorkspaceCoreUpgradePlan(manifest,manifest);
  const held={migration:coreMigrationSha,test:coreTestSha,
    sourceMigration:sourcePreparationMigrationSha,sourceTest:sourcePreparationTestSha};
  assertLegacyWorkspaceCorePhase(plan,"predecessor",plan.prefixManifest,held,plan.additionalHeldSql);
  assert.throws(() => assertLegacyWorkspaceCorePhase(plan,"predecessor",plan.prefixManifest,held,{}),/Held current release/);
  for (const file of Object.keys(plan.additionalHeldSql)) {
    const changed={...plan.additionalHeldSql,[file]:"a".repeat(64)};
    assert.throws(() => assertLegacyWorkspaceCorePhase(plan,"predecessor",plan.prefixManifest,held,changed),/Held current release/);
  }
  const full={migration:null,test:null,sourceMigration:null,sourceTest:null};
  assertLegacyWorkspaceCorePhase(plan,"full",manifest,full,{});
  assert.throws(() => assertLegacyWorkspaceCorePhase(plan,"full",manifest,full,plan.additionalHeldSql),/Held current release/);
});

for (const validate of [validateLegacyWorkspaceCoreUpgradePlan, validateHostedLedgerUpgradePlan]) {
  for (const [label, mutate] of [
    ["missing owner regression", value => { delete value["supabase/tests/effective_product_access.test.sql"]; }],
    ["changed captured migration", value => { value["supabase/migrations/20260911151000_captured_generation_failure_budget.sql"]="a".repeat(64); }],
    ["unknown migration", value => { value["supabase/migrations/20990101000000_unknown.sql"]="a".repeat(64); }],
    ["missing historical migration", value => { delete value["supabase/migrations/20260908160000_legacy_workspace_save_core.sql"]; }],
  ]) test(`${validate.name} rejects ${label} in the current extension`, () => {
    const changed={...manifest}; mutate(changed);
    assert.throws(() => validate(changed,changed));
  });
  test(`${validate.name} still rejects omitted current source`, () => {
    const omitted={...manifest}; delete omitted["supabase/tests/effective_product_access.test.sql"];
    assert.throws(() => validate(omitted,manifest), /all current SQL/);
  });
}
