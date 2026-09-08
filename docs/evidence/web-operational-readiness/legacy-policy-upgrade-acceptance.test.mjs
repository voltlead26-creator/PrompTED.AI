import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { legacyPolicyMigration, validateLegacyPolicyUpgradePlan } from "./legacy-policy-upgrade-acceptance.mjs";
import { validateWorkspaceReadUpgradePlan } from "./workspace-upload-read-acceptance.mjs";

const historical = JSON.parse(readFileSync(new URL("./db-20260907100737954-50e0967b/manifest.json", import.meta.url))).manifest;
const migration = `supabase/migrations/${legacyPolicyMigration}.sql`;
const regression = "supabase/tests/legacy_generation_policy_binding.test.sql";
const current = { ...historical, [migration]: "a".repeat(64), [regression]: "b".repeat(64) };
test("accepts the exact additive policy upgrade without changing historical workspace acceptance", () => {
  const plan = validateLegacyPolicyUpgradePlan(current, { ...current, "AGENTS.md": "c".repeat(64) });
  assert.equal(plan.predecessor, "20260907124000");
  assert.equal(plan.forward, "20260908130000");
  assert.equal(plan.versions.length, 77);
  assert.equal(validateWorkspaceReadUpgradePlan(historical, historical).versions.length, 76);
  assert.throws(() => validateWorkspaceReadUpgradePlan(current, current), /exactly their reviewed forward migration/);
});
for (const [label, mutate] of [
  ["missing predecessor", value => { delete value["supabase/migrations/20260907124000_workspace_upload_reads.sql"]; }],
  ["changed predecessor", value => { value["supabase/migrations/20260907124000_workspace_upload_reads.sql"] = "d".repeat(64); }],
  ["missing forward", value => { delete value[migration]; }],
  ["wrong forward filename", value => { delete value[migration]; value["supabase/migrations/20260908130000_unreviewed.sql"] = "a".repeat(64); }],
  ["missing regression", value => { delete value[regression]; }],
  ["extra forward migration", value => { value["supabase/migrations/20260908130100_unreviewed.sql"] = "a".repeat(64); }],
  ["duplicate version", value => { value["supabase/migrations/20260908130000_duplicate.sql"] = "a".repeat(64); }],
  ["invalid migration timestamp", value => { value["supabase/migrations/invalid.sql"] = "a".repeat(64); }],
  ["invalid digest", value => { value[migration] = "invalid"; }],
]) test(`rejects ${label} before service creation`, () => {
  const changed = structuredClone(current); mutate(changed);
  assert.throws(() => validateLegacyPolicyUpgradePlan(changed, changed));
});
test("cannot omit or substitute any current SQL input during copy", () => {
  const changed = structuredClone(current);
  delete changed["supabase/tests/ollama_credit_fallback.test.sql"];
  assert.throws(() => validateLegacyPolicyUpgradePlan(changed, current), /all current SQL/);
  changed["supabase/tests/ollama_credit_fallback.test.sql"] = "c".repeat(64);
  assert.throws(() => validateLegacyPolicyUpgradePlan(changed, current), /all current SQL/);
});
for (const flag of ["--profile-read-acceptance", "--upload-source-acceptance", "--upload-source-v3-acceptance",
  "--upload-rtf-alias-acceptance", "--upload-fallback-acceptance", "--upload-source-import-acceptance",
  "--workspace-read-browser-acceptance", "--workspace-upload-browser-acceptance"]) {
  test(`policy upgrade rejects simultaneous ${flag} at its own admission boundary`, () => {
    const result = spawnSync(process.execPath, [new URL("./run-isolated-db-baseline.mjs", import.meta.url).pathname,
      "--legacy-policy-upgrade-acceptance", flag], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Legacy policy upgrade mode is exclusive/);
  });
}
