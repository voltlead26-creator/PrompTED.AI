import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExactMigrationPrefix,
  isReviewedHostedMigrationTransition,
  loadReviewedHostedMigrationTransition,
} from "./reviewed-hosted-migration-transition.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const projectRef = "jjsykocqpjlekgsbylkd";
async function reviewedInput() {
  const baseline = JSON.parse(
    await readFile(
      new URL(
        "../docs/evidence/web-operational-readiness/hosted-ledger-upgrade-baseline.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return {
    repoRoot,
    projectRef,
    migrationLedger: {
      localVersions: (await readdir(`${repoRoot}/supabase/migrations`))
        .sort()
        .map((name) => name.slice(0, 14)),
      remoteVersions: baseline.hosted_versions,
    },
  };
}

test("the exact rehearsed history yields an immutable source-bound transition", async () => {
  const input = await reviewedInput();
  const before = structuredClone(input);
  const transition = await loadReviewedHostedMigrationTransition(input);
  assert.deepEqual(input, before);
  assert.equal(transition.remoteVersions.length, 68);
  assert.equal(transition.localVersions.length, 94);
  assert.equal(transition.pendingFiles.length, 26);
  assert.equal(
    transition.pendingFiles[0],
    "supabase/migrations/20260906000500_captured_exact_wording_assessment.sql",
  );
  assert.equal(
    isReviewedHostedMigrationTransition(transition, projectRef, input.migrationLedger),
    true,
  );
  assert.equal(
    isReviewedHostedMigrationTransition({ ...transition }, projectRef, input.migrationLedger),
    false,
  );
  assert.throws(() => transition.remoteVersions.push("20990101000000"));
  assert.throws(() => {
    transition.projectRef = "a".repeat(20);
  });
});

test("filling the earlier reviewed gap returns to the ordinary prefix path", async () => {
  const input = await reviewedInput();
  input.migrationLedger.remoteVersions.push("20260906000500");
  input.migrationLedger.remoteVersions.sort();
  assert.equal(isExactMigrationPrefix(input.migrationLedger), true);
  assert.equal(await loadReviewedHostedMigrationTransition(input), null);
  input.migrationLedger.remoteVersions = [...input.migrationLedger.localVersions];
  assert.equal(await loadReviewedHostedMigrationTransition(input), null);
});

test("wrong project, reordered, duplicate and unknown histories cannot authorize the exception", async () => {
  const input = await reviewedInput();
  await assert.rejects(
    loadReviewedHostedMigrationTransition({ ...input, projectRef: "a".repeat(20) }),
    /no reviewed transition/,
  );
  for (const mutate of [
    (value) => value.remoteVersions.reverse(),
    (value) => value.remoteVersions.push(value.remoteVersions.at(-1)),
    (value) => {
      value.remoteVersions[10] = "20260708180000";
      value.remoteVersions.sort();
    },
    (value) => value.localVersions.push("20990101000000"),
  ]) {
    const changed = structuredClone(input);
    mutate(changed.migrationLedger);
    await assert.rejects(loadReviewedHostedMigrationTransition(changed));
  }
});

test("changed migration bytes, missing regression and unreviewed extra SQL fail closed", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "prompted-transition-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const directory of ["migrations", "tests"])
    await cp(`${repoRoot}/supabase/${directory}`, `${temporary}/supabase/${directory}`, {
      recursive: true,
    });
  const input = { ...(await reviewedInput()), repoRoot: temporary };
  const migration = `${temporary}/supabase/migrations/20260906000500_captured_exact_wording_assessment.sql`;
  const original = await readFile(migration);
  await writeFile(migration, Buffer.concat([original, Buffer.from("\n-- unreviewed\n")]));
  await assert.rejects(loadReviewedHostedMigrationTransition(input));
  await writeFile(migration, original);
  const regression = `${temporary}/supabase/tests/library_manual_plan_routing.test.sql`;
  const testBytes = await readFile(regression);
  await unlink(regression);
  await assert.rejects(loadReviewedHostedMigrationTransition(input));
  await writeFile(regression, testBytes);
  await writeFile(`${temporary}/supabase/migrations/20990101000000_unknown.sql`, "select 1;\n");
  await assert.rejects(loadReviewedHostedMigrationTransition(input));
});
