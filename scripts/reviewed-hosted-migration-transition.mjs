import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { validateHostedLedgerUpgradePlan } from "../docs/evidence/web-operational-readiness/hosted-ledger-upgrade-acceptance.mjs";

const PROJECT_REF = "jjsykocqpjlekgsbylkd";
const verifiedTransitions = new WeakSet();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validVersions(values) {
  return (
    Array.isArray(values) &&
    values.length <= 500 &&
    values.every((value) => typeof value === "string" && /^\d{14}$/.test(value)) &&
    new Set(values).size === values.length &&
    same(values, [...values].sort())
  );
}

export function isExactMigrationPrefix(ledger) {
  const { localVersions, remoteVersions } = ledger ?? {};
  return (
    validVersions(localVersions) &&
    localVersions.length > 0 &&
    validVersions(remoteVersions) &&
    same(remoteVersions, localVersions.slice(0, remoteVersions.length))
  );
}

// Reuse the same immutable baseline and reviewed SQL hashes as the completed
// historical-upgrade rehearsal. This produces no mutation and no skip flag.
export async function loadReviewedHostedMigrationTransition({
  repoRoot,
  projectRef,
  migrationLedger,
}) {
  if (isExactMigrationPrefix(migrationLedger)) return null;
  if (
    projectRef !== PROJECT_REF ||
    !validVersions(migrationLedger?.localVersions) ||
    !validVersions(migrationLedger?.remoteVersions)
  ) {
    throw new Error("The hosted migration history has no reviewed transition.");
  }
  const manifest = {};
  for (const directory of ["supabase/migrations", "supabase/tests"]) {
    const entries = await readdir(`${repoRoot}/${directory}`);
    if (entries.length === 0 || entries.length > 500)
      throw new Error("Reviewed SQL inventory is invalid.");
    for (const name of entries.sort()) {
      if (!/^[a-z0-9_.-]+[.]sql$/.test(name)) throw new Error("Reviewed SQL file name is invalid.");
      const path = `${directory}/${name}`;
      const metadata = await lstat(`${repoRoot}/${path}`);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4 * 1024 * 1024) {
        throw new Error("Reviewed SQL file is invalid.");
      }
      manifest[path] = createHash("sha256")
        .update(await readFile(`${repoRoot}/${path}`))
        .digest("hex");
    }
  }
  const plan = validateHostedLedgerUpgradePlan(manifest, manifest);
  if (
    !same(plan.versions, migrationLedger.localVersions) ||
    !same(plan.hostedVersions, migrationLedger.remoteVersions)
  ) {
    throw new Error("The hosted migration history differs from the exact reviewed transition.");
  }
  const transition = Object.freeze({
    projectRef,
    baselineSha256: plan.baselineSha,
    migrationSourcesSha256: createHash("sha256")
      .update(
        JSON.stringify(
          Object.entries(manifest)
            .filter(([path]) => path.startsWith("supabase/migrations/"))
            .map(([path, sha256]) => ({ name: path.split("/").at(-1), sha256 })),
        ),
      )
      .digest("hex"),
    sourceManifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    localVersions: Object.freeze([...plan.versions]),
    remoteVersions: Object.freeze([...plan.hostedVersions]),
    pendingFiles: Object.freeze([...plan.pendingFiles]),
  });
  verifiedTransitions.add(transition);
  return transition;
}

// Only a source-checked, in-process result can admit the exception. JSON,
// environment variables and copied/tampered result objects cannot create it.
export function isReviewedHostedMigrationTransition(
  transition,
  projectRef,
  ledger,
  phase = "pre_migration",
) {
  return (
    verifiedTransitions.has(transition) &&
    phase === "pre_migration" &&
    transition.projectRef === projectRef &&
    projectRef === PROJECT_REF &&
    same(transition.localVersions, ledger?.localVersions) &&
    same(transition.remoteVersions, ledger?.remoteVersions)
  );
}
