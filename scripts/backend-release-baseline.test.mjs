import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackendReleaseBaseline,
  createBackendReleaseEvidence,
  createBackendReleaseReport,
  verifyBackendReleaseBaseline,
} from "./backend-release-baseline.mjs";

const sha = (character) => character.repeat(64);

function rawEvidence(overrides = {}) {
  return {
    projectRef: "jjsykocqpjlekgsbylkd",
    gitSha: "a".repeat(40),
    deploymentContract: '{"version":1,"safe":true}\n',
    migrations: [
      { name: "20260902017000_route.sql", contents: "select 1;\n" },
      { name: "20260902018000_recovery.sql", contents: "select 2;\n" },
    ],
    migrationLedger: {
      localVersions: ["20260902017000", "20260902018000"],
      remoteVersions: ["20260902017000"],
    },
    inventory: {
      transaction_read_only: true,
      assets_object_count: 2,
      contract_version: "prompted-release-inventory.2",
    },
    hostedFunctions: [
      { name: "render-export", status: "ACTIVE", version: 9, verifyJwt: false },
      { name: "brand-logo", status: "ACTIVE", version: 3, verifyJwt: false },
    ],
    ...overrides,
  };
}

test("backend baseline fingerprints are deterministic and disclose no hosted inventory", () => {
  const first = createBackendReleaseEvidence(rawEvidence());
  const reordered = createBackendReleaseEvidence(
    rawEvidence({
      inventory: {
        contract_version: "prompted-release-inventory.2",
        assets_object_count: 2,
        transaction_read_only: true,
      },
      hostedFunctions: [...rawEvidence().hostedFunctions].reverse(),
    }),
  );
  assert.deepEqual(reordered, first);

  const baseline = createBackendReleaseBaseline(first);
  assert.match(baseline.baseline_sha256, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify(baseline);
  assert.doesNotMatch(serialized, /render-export|brand-logo|assets_object_count|select 1/);
  assert.deepEqual(verifyBackendReleaseBaseline(baseline, first), {
    ok: true,
    code: "BACKEND_RELEASE_BASELINE_UNCHANGED",
    changed_dimensions: [],
  });
});

test("backend evidence rejects malformed hosted function metadata", () => {
  assert.throws(
    () =>
      createBackendReleaseEvidence(
        rawEvidence({
          hostedFunctions: [{ name: "render-export", status: {}, version: 9, verifyJwt: false }],
        }),
      ),
    /hosted function evidence/i,
  );
});

test("baseline verification detects tampering and every release-relevant drift dimension", () => {
  const evidence = createBackendReleaseEvidence(rawEvidence());
  const baseline = createBackendReleaseBaseline(evidence);
  assert.throws(
    () =>
      verifyBackendReleaseBaseline({ ...baseline, project_ref: "aaaaaaaaaaaaaaaaaaaa" }, evidence),
    /integrity/i,
  );

  for (const [field, expectedDimension] of [
    ["git_sha", "repository_revision"],
    ["deployment_contract_sha256", "deployment_contract"],
    ["migration_sources_sha256", "migration_sources"],
    ["migration_ledger_sha256", "hosted_migration_ledger"],
    ["inventory_sha256", "hosted_inventory"],
    ["hosted_functions_sha256", "hosted_functions"],
  ]) {
    const changed = { ...evidence, [field]: sha(field === "git_sha" ? "f" : "e") };
    if (field === "git_sha") changed[field] = "f".repeat(40);
    const result = verifyBackendReleaseBaseline(baseline, changed);
    assert.equal(result.ok, false, field);
    assert.equal(result.code, "BACKEND_RELEASE_BASELINE_DRIFT", field);
    assert.deepEqual(result.changed_dimensions, [expectedDimension], field);
  }
});

test("failure reports are bounded, aggregate-only, and explicitly forbid automatic rollback", () => {
  const evidence = createBackendReleaseEvidence(rawEvidence());
  const baseline = createBackendReleaseBaseline(evidence);
  const result = verifyBackendReleaseBaseline(baseline, {
    ...evidence,
    inventory_sha256: sha("d"),
    hosted_functions_sha256: sha("e"),
  });
  const report = createBackendReleaseReport({
    baseline,
    result,
    inventoryFailureCodes: ["STORAGE_UNDECLARED_POLICY"],
  });

  assert.deepEqual(report.changed_dimensions, ["hosted_inventory", "hosted_functions"]);
  assert.deepEqual(report.inventory_failure_codes, ["STORAGE_UNDECLARED_POLICY"]);
  assert.equal(report.automatic_rollback_attempted, false);
  assert.equal(report.next_action, "stop_and_review_hosted_state");
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /render-export|brand-logo|assets_object_count|select 1/);
  assert.ok(serialized.length < 4096);
});
