import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewedHostedMigrationTransition } from "./reviewed-hosted-migration-transition.mjs";

import {
  migrationApplyArguments,
  applyBackendReleaseMigrations,
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

function applyEvidence(input = rawEvidence()) {
  const evidence = createBackendReleaseEvidence(input);
  return {
    baseline: createBackendReleaseBaseline(evidence),
    collected: {
      evidence,
      migrationLedger: input.migrationLedger,
      reviewedMigrationTransition: null,
      inventoryFailureCodes: [],
    },
    linkedProjectRef: input.projectRef,
  };
}

test("ordinary prefix apply never enables include-all and rejects drift before dispatch", () => {
  const input = applyEvidence();
  assert.deepEqual(migrationApplyArguments(input), [
    "db",
    "push",
    "--linked",
    "--skip-vault",
    "--yes",
  ]);
  for (const mutate of [
    (value) => {
      value.linkedProjectRef = "a".repeat(20);
    },
    (value) => {
      value.collected.evidence.git_sha = "f".repeat(40);
    },
    (value) => {
      value.collected.inventoryFailureCodes = ["DORMANT_FUNCTION_DEPLOYED"];
    },
    (value) => {
      value.collected.migrationLedger.remoteVersions = [
        ...value.collected.migrationLedger.localVersions,
      ];
    },
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.throws(() => migrationApplyArguments(changed));
  }
});

test("only the verified exact historical upgrade receives include-all", async () => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const history = JSON.parse(
    await readFile(
      new URL(
        "../docs/evidence/web-operational-readiness/hosted-ledger-upgrade-baseline.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const migrationLedger = {
    localVersions: (await readdir(`${repoRoot}/supabase/migrations`))
      .sort()
      .map((name) => name.slice(0, 14)),
    remoteVersions: history.hosted_versions,
  };
  const migrations = await Promise.all(
    (await readdir(`${repoRoot}/supabase/migrations`)).sort().map(async (name) => ({
      name,
      contents: await readFile(`${repoRoot}/supabase/migrations/${name}`, "utf8"),
    })),
  );
  const input = applyEvidence(rawEvidence({ migrationLedger, migrations }));
  assert.throws(() => migrationApplyArguments(input), /no exact prefix or reviewed transition/);
  input.collected.reviewedMigrationTransition = await loadReviewedHostedMigrationTransition({
    repoRoot,
    projectRef: input.linkedProjectRef,
    migrationLedger,
  });
  assert.deepEqual(migrationApplyArguments(input), [
    "db",
    "push",
    "--linked",
    "--skip-vault",
    "--yes",
    "--include-all",
  ]);
  const wrongSources = applyEvidence(rawEvidence({ migrationLedger }));
  wrongSources.collected.reviewedMigrationTransition = input.collected.reviewedMigrationTransition;
  assert.throws(() => migrationApplyArguments(wrongSources), /source does not match/);
  input.collected.reviewedMigrationTransition = { ...input.collected.reviewedMigrationTransition };
  assert.throws(() => migrationApplyArguments(input), /no exact prefix or reviewed transition/);
});

test("migration executor checks linked project, checkout and source, uses direct argv and never retries", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "prompted-apply-test-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(`${repoRoot}/supabase/.temp`, { recursive: true });
  await mkdir(`${repoRoot}/supabase/migrations`);
  const raw = rawEvidence();
  await writeFile(`${repoRoot}/supabase/deployment-contract.json`, raw.deploymentContract);
  for (const migration of raw.migrations)
    await writeFile(`${repoRoot}/supabase/migrations/${migration.name}`, migration.contents);
  await writeFile(`${repoRoot}/supabase/.temp/project-ref`, raw.projectRef);
  const input = applyEvidence(raw);
  let calls = [];
  const execute = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return {
      stdout:
        executable === "git"
          ? args[0] === "rev-parse"
            ? raw.gitSha + "\n"
            : ""
          : "migration complete",
    };
  };
  const outcome = await applyBackendReleaseMigrations({
    repoRoot,
    ...input,
    execFileImpl: execute,
  });
  assert.deepEqual(outcome, { applied: true, reviewedTransition: false });
  assert.deepEqual(
    calls.map((call) => call.executable),
    ["git", "git", "supabase"],
  );
  assert.deepEqual(calls[2].args, ["db", "push", "--linked", "--skip-vault", "--yes"]);
  assert.equal(calls[2].options.shell, false);
  assert.equal(calls[2].options.cwd, repoRoot);
  assert.ok(calls[2].options.timeout <= 20 * 60 * 1000);

  calls = [];
  await writeFile(`${repoRoot}/supabase/.temp/project-ref`, "a".repeat(20));
  await assert.rejects(
    applyBackendReleaseMigrations({ repoRoot, ...input, execFileImpl: execute }),
    /Linked project/,
  );
  assert.equal(calls.length, 0);
  await writeFile(`${repoRoot}/supabase/.temp/project-ref`, raw.projectRef);
  await assert.rejects(
    applyBackendReleaseMigrations({
      repoRoot,
      ...input,
      execFileImpl: async () => ({ stdout: "b".repeat(40) }),
    }),
    /Checkout revision/,
  );
  await assert.rejects(
    applyBackendReleaseMigrations({
      repoRoot,
      ...input,
      execFileImpl: async (_executable, args) => ({
        stdout: args[0] === "rev-parse" ? raw.gitSha : " M scripts/probe-supabase-contract.mjs",
      }),
    }),
    /uncommitted changes/,
  );
  let policyDispatches = 0;
  await assert.rejects(
    applyBackendReleaseMigrations({
      repoRoot,
      ...input,
      execFileImpl: async (executable, args) => {
        if (executable === "git")
          return {
            stdout:
              args[0] === "rev-parse"
                ? raw.gitSha
                : args.includes("docs/evidence/web-operational-readiness")
                  ? " M docs/evidence/web-operational-readiness/reviewed-release-sql-extension.mjs"
                  : "",
          };
        policyDispatches++;
        return { stdout: "complete" };
      },
    }),
    /uncommitted changes/,
  );
  assert.equal(policyDispatches, 0);
  const changedPath = `${repoRoot}/supabase/migrations/${raw.migrations[0].name}`;
  await writeFile(changedPath, "select 999;\n");
  calls = [];
  await assert.rejects(
    applyBackendReleaseMigrations({ repoRoot, ...input, execFileImpl: execute }),
    /Migration source changed/,
  );
  assert.equal(calls.filter((call) => call.executable === "supabase").length, 0);
  await writeFile(changedPath, raw.migrations[0].contents);
  let attempts = 0;
  await assert.rejects(
    applyBackendReleaseMigrations({
      repoRoot,
      ...input,
      execFileImpl: async (executable, args) => {
        if (executable === "git") return { stdout: args[0] === "rev-parse" ? raw.gitSha : "" };
        attempts++;
        throw new Error("PRIVATE_CLI_OUTPUT");
      },
    }),
    (error) =>
      /stop and inspect the hosted ledger/.test(error.message) &&
      !error.message.includes("PRIVATE_CLI_OUTPUT"),
  );
  assert.equal(attempts, 1);
});
