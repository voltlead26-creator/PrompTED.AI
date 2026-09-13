// One finite, local fresh-database baseline. No hosted target or provider input.
// Run through Codex Process Jobs from the verified repository. Cleanup removes
// only this run's newly created Supabase project; it never stops a shared stack.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createDenoExecutionBoundary } from "../../../scripts/deno-execution-boundary.mjs";
import { assertAcceptanceSourceIdentity, snapshotAcceptanceSources } from "./acceptance-source-identity.mjs";
import { hostedSchemaCatalogSql, observedSchemaGrantFixture } from "./hosted-schema-catalog.mjs";
import { resolveAcceptanceRuntime } from "./acceptance-runtime.mjs";
import { exerciseProfileReads } from "./profile-read-acceptance.mjs";
import { exerciseUploadSourceUpgrade } from "./upload-source-upgrade-acceptance.mjs";
import { assertDisposableReset } from "./disposable-database-reset.mjs";
import { selectUploadSourceSqlScope } from "./upload-source-sql-scope.mjs";
import { exerciseWorkspaceReads, validateWorkspaceReadUpgradePlan } from "./workspace-upload-read-acceptance.mjs";
import { exerciseWorkspaceBrowser } from "./workspace-browser-acceptance.mjs";
import { exerciseNewWorkspaceUploads } from "./workspace-upload-browser-acceptance.mjs";
import { exerciseBusinessCheckoutReservations } from "./business-checkout-reservation-acceptance.mjs";
import { assertHostedLedgerPhase, exerciseHostedLedgerUpgrade, observedOwnerRpcGrantFixture, validateHostedLedgerUpgradePlan } from "./hosted-ledger-upgrade-acceptance.mjs";
import { exerciseLegacyPolicyUpgrade, validateLegacyPolicyUpgradePlan } from "./legacy-policy-upgrade-acceptance.mjs";
import { assertLegacyWorkspaceCorePhase, exerciseLegacyWorkspaceCoreUpgrade,
  coreMigrationFile, coreMigrationSha, coreTestFile, coreTestSha,
  sourcePreparationMigrationFile, sourcePreparationMigrationSha, sourcePreparationTestFile, sourcePreparationTestSha,
  validateLegacyWorkspaceCoreUpgradePlan } from "./legacy-workspace-core-upgrade-acceptance.mjs";
import { assertLegacyAuditPhase, exerciseLegacyAuditUpgrade, legacyAuditMigrationFile,
  legacyAuditMigrationSha, legacyAuditTestFile, legacyAuditTestSha,
  validateLegacyAuditUpgradePlan } from "./legacy-audit-upgrade-acceptance.mjs";
import { assertCatalogueMigrationResult, assertCataloguePhase, catalogueSeedFile, catalogueSeedSha,
  exerciseCatalogueUpgrade, validateCatalogueUpgradePlan } from "./catalogue-upgrade-acceptance.mjs";
import { exerciseUploadSourceV3Upgrade, validateV3UpgradePlan, exerciseUploadRtfAliasUpgrade,
  validateRtfAliasUpgradePlan, validateUploadFallbackUpgradePlan, exerciseUploadFallbackUpgrade, validateSourceImportUpgradePlan, exerciseSourceImportUpgrade } from "./upload-source-v3-upgrade-acceptance.mjs";

process.umask(0o077);
assert(
  process.argv.slice(2).every(arg => ["--preflight-only", "--profile-read-acceptance", "--upload-source-acceptance", "--upload-source-v3-acceptance", "--upload-rtf-alias-acceptance", "--upload-fallback-acceptance", "--upload-source-import-acceptance", "--workspace-read-browser-acceptance", "--workspace-upload-browser-acceptance", "--legacy-policy-upgrade-acceptance", "--catalogue-upgrade-acceptance", "--legacy-audit-upgrade-acceptance", "--legacy-workspace-core-upgrade-acceptance", "--hosted-ledger-upgrade-acceptance"].includes(arg)) &&
    new Set(process.argv.slice(2)).size === process.argv.length - 2,
  "Only preflight, profile, v2 source, v3 source, RTF alias, fallback, source import, workspace browser, legacy policy, catalogue, legacy audit, workspace core and hosted-ledger upgrade acceptance flags are supported",
);
const hostedLedgerUpgradeAcceptance = process.argv.includes("--hosted-ledger-upgrade-acceptance");
assert(!(hostedLedgerUpgradeAcceptance && process.argv.slice(2).some(flag =>
  !["--hosted-ledger-upgrade-acceptance", "--preflight-only"].includes(flag))), "Hosted-ledger upgrade mode is exclusive");
const legacyWorkspaceCoreUpgradeAcceptance = process.argv.includes("--legacy-workspace-core-upgrade-acceptance");
assert(!(legacyWorkspaceCoreUpgradeAcceptance && process.argv.slice(2).some(flag =>
  !["--legacy-workspace-core-upgrade-acceptance", "--preflight-only"].includes(flag))), "Legacy workspace core upgrade mode is exclusive");
const legacyAuditUpgradeAcceptance = process.argv.includes("--legacy-audit-upgrade-acceptance");
assert(!(legacyAuditUpgradeAcceptance && process.argv.slice(2).some(flag =>
  !["--legacy-audit-upgrade-acceptance", "--preflight-only"].includes(flag))), "Legacy audit upgrade mode is exclusive");
const catalogueUpgradeAcceptance = process.argv.includes("--catalogue-upgrade-acceptance");
assert(!(catalogueUpgradeAcceptance && process.argv.slice(2).some(flag =>
  !["--catalogue-upgrade-acceptance", "--preflight-only"].includes(flag))), "Catalogue upgrade mode is exclusive");
const legacyPolicyUpgradeAcceptance = process.argv.includes("--legacy-policy-upgrade-acceptance");
assert(!(legacyPolicyUpgradeAcceptance && process.argv.slice(2).some(flag =>
  !["--legacy-policy-upgrade-acceptance", "--preflight-only"].includes(flag))), "Legacy policy upgrade mode is exclusive");
assert(!(process.argv.includes("--workspace-read-browser-acceptance") && process.argv.slice(2)
  .some(flag => !["--workspace-read-browser-acceptance", "--preflight-only"].includes(flag))),
  "Workspace browser upgrade mode is exclusive of other acceptance modes");
const workspaceUploadBrowserAcceptance = process.argv.includes("--workspace-upload-browser-acceptance");
assert(!(workspaceUploadBrowserAcceptance && process.argv.slice(2).some(flag =>
  !["--workspace-upload-browser-acceptance", "--preflight-only"].includes(flag))), "New upload browser mode is exclusive");
const workspaceBrowserAcceptance = process.argv.includes("--workspace-read-browser-acceptance");
assert(!(process.argv.includes("--upload-source-acceptance") && process.argv.includes("--upload-source-v3-acceptance")),
  "V2 and v3 upgrade modes are mutually exclusive");
assert(!(process.argv.includes("--upload-rtf-alias-acceptance") &&
  ["--upload-source-acceptance", "--upload-source-v3-acceptance", "--profile-read-acceptance"].some(flag => process.argv.includes(flag))),
  "RTF alias upgrade mode is exclusive of other acceptance modes");
assert(!(process.argv.includes("--upload-fallback-acceptance") &&
  ["--upload-source-acceptance", "--upload-source-v3-acceptance", "--upload-rtf-alias-acceptance", "--profile-read-acceptance"].some(flag => process.argv.includes(flag))),
  "Fallback upgrade mode is exclusive of other acceptance modes");
assert(!(process.argv.includes("--upload-source-import-acceptance") &&
  ["--upload-source-acceptance", "--upload-source-v3-acceptance", "--upload-rtf-alias-acceptance", "--upload-fallback-acceptance", "--profile-read-acceptance"].some(flag => process.argv.includes(flag))),
  "Source import upgrade mode is exclusive of other acceptance modes");
const sourceImportAcceptance = process.argv.includes("--upload-source-import-acceptance");
const uploadFallbackAcceptance = process.argv.includes("--upload-fallback-acceptance");
const preflightOnly = process.argv.includes("--preflight-only");
const profileReadAcceptance = process.argv.includes("--profile-read-acceptance");
const uploadSourceAcceptance = process.argv.includes("--upload-source-acceptance");
const uploadSourceV3Acceptance = process.argv.includes("--upload-source-v3-acceptance");
const uploadRtfAliasAcceptance = process.argv.includes("--upload-rtf-alias-acceptance");
const v3Inputs = [
  ["../../../scripts/deno-execution-boundary.mjs", "deno-execution-boundary.mjs"],
  ["../../../scripts/deno-execution-boundary.test.mjs", "deno-execution-boundary.test.mjs"],
  ["./paid-plan-fixture-revisions.mjs", "paid-plan-fixture-revisions.mjs"],
  ["./paid-plan-fixture-revisions.test.mjs", "paid-plan-fixture-revisions.test.mjs"],
  ["./reviewed-release-sql-extension.mjs", "reviewed-release-sql-extension.mjs"],
  ["./current-release-upgrade.test.mjs", "current-release-upgrade.test.mjs"],
  ["./hosted-ledger-upgrade-acceptance.mjs", "hosted-ledger-upgrade-acceptance.mjs"],
  ["./hosted-schema-catalog.mjs", "hosted-schema-catalog.mjs"],
  ["./hosted-ledger-upgrade-acceptance.test.mjs", "hosted-ledger-upgrade-acceptance.test.mjs"],
  ["./hosted-ledger-upgrade-baseline.json", "hosted-ledger-upgrade-baseline.json"],
  ["./legacy-workspace-core-upgrade-acceptance.mjs", "legacy-workspace-core-upgrade-acceptance.mjs"],
  ["./legacy-workspace-core-upgrade-acceptance.test.mjs", "legacy-workspace-core-upgrade-acceptance.test.mjs"],
  ["./legacy-workspace-core-upgrade-sql-baseline.json", "legacy-workspace-core-upgrade-sql-baseline.json"],
  ["./legacy-audit-upgrade-acceptance.mjs", "legacy-audit-upgrade-acceptance.mjs"],
  ["./legacy-audit-upgrade-acceptance.test.mjs", "legacy-audit-upgrade-acceptance.test.mjs"],
  ["./legacy-audit-upgrade-sql-baseline.json", "legacy-audit-upgrade-sql-baseline.json"],
  ["./catalogue-upgrade-acceptance.mjs", "catalogue-upgrade-acceptance.mjs"],
  ["./catalogue-upgrade-acceptance.test.mjs", "catalogue-upgrade-acceptance.test.mjs"],
  ["./catalogue-upgrade-sql-baseline.json", "catalogue-upgrade-sql-baseline.json"],
  ["./legacy-policy-upgrade-acceptance.mjs", "legacy-policy-upgrade-acceptance.mjs"],
  ["./legacy-policy-upgrade-acceptance.test.mjs", "legacy-policy-upgrade-acceptance.test.mjs"],
  ["./acceptance-runtime.mjs", "acceptance-runtime.mjs"],
  ["./acceptance-runtime.test.mjs", "acceptance-runtime.test.mjs"],
  ["./acceptance-source-identity.mjs", "acceptance-source-identity.mjs"],
  ["./acceptance-source-identity.test.mjs", "acceptance-source-identity.test.mjs"],
  ["./profile-sdk-retry.test.mjs", "profile-sdk-retry.test.mjs"],
  ["./upload-run-disposition.mjs", "upload-run-disposition.mjs"],
  ["./upload-run-disposition.test.mjs", "upload-run-disposition.test.mjs"],
  ["./workspace-upload-browser-acceptance.mjs", "workspace-upload-browser-acceptance.mjs"],
  ["./business-checkout-reservation-acceptance.mjs", "business-checkout-reservation-acceptance.mjs"],
  ["./workspace-upload-transport.mjs", "workspace-upload-transport.mjs"],
  ["./workspace-upload-transport.test.mjs", "workspace-upload-transport.test.mjs"],
  ["./workspace-upload-deno.ts", "workspace-upload-deno.ts"],
  ["../../../tests/e2e/workspace-upload-fixtures.ts", "workspace-upload-fixtures.ts"],
  ["../../../tests/e2e/workspace-upload-fixtures.test.ts", "workspace-upload-fixtures.test.ts"],
  ["../../../tests/e2e/workspace-upload.spec.ts", "workspace-upload.spec.ts"],
  ["../../../tests/e2e/upload.playwright.config.ts", "upload.playwright.config.ts"],
  ["./workspace-upload-read-acceptance.mjs", "workspace-upload-read-acceptance.mjs"],
  ["./workspace-upload-read-acceptance.test.mjs", "workspace-upload-read-acceptance.test.mjs"],
  ["./workspace-browser-acceptance.mjs", "workspace-browser-acceptance.mjs"],
  ["../../../playwright.config.ts", "playwright.config.ts"],
  ["../../../tests/e2e/workspace-fixtures.ts", "workspace-fixtures.ts"],
  ["../../../tests/e2e/workspace-fixtures.test.ts", "workspace-fixtures.test.ts"],
  ["../../../tests/e2e/retained-uploads.spec.ts", "retained-uploads.spec.ts"],
  ["../../../tests/e2e/tsconfig.json", "e2e-tsconfig.json"],
  ["./db-20260907100737954-50e0967b/manifest.json", "workspace-read-fresh-baseline.json"],
  ["./upload-source-v3-upgrade-acceptance.mjs", "upload-source-v3-upgrade-acceptance.mjs"],
  ["./upload-source-v3-upgrade-acceptance.test.mjs", "upload-source-v3-upgrade-acceptance.test.mjs"],
  ["./format-preservation/position-left.pdf", "position-left.pdf"],
  ["./format-preservation/rtf-appkit-original.rtf", "rtf-appkit-original.rtf"],
  ["./format-preservation/rtf-appkit-producer-green.json", "rtf-appkit-producer-green.json"],
  ["./db-20260907011342822-ed25ab1c/manifest.json", "v3-fresh-baseline.json"],
].map(([relativeUrl, target]) => {
  const url = new URL(relativeUrl, import.meta.url);
  return { url, target, sha256: sha(readFileSync(url)) };
});
const profileProbeUrl = new URL("./profile-read-acceptance.mjs", import.meta.url);
const profileProbeSha = sha(readFileSync(profileProbeUrl));
const sourceProbeUrl = new URL("./upload-source-upgrade-acceptance.mjs", import.meta.url);
const sourceProbeSha = sha(readFileSync(sourceProbeUrl));
const resetGuardUrl = new URL("./disposable-database-reset.mjs", import.meta.url);
const resetGuardSha = sha(readFileSync(resetGuardUrl));
const sqlScopeUrl = new URL("./upload-source-sql-scope.mjs", import.meta.url);
const sqlScopeSha = sha(readFileSync(sqlScopeUrl));
const sqlScopeTestUrl = new URL("./upload-source-sql-scope.test.mjs", import.meta.url);
const sqlScopeTestSha = sha(readFileSync(sqlScopeTestUrl));
const sqlBaselineUrl = new URL("./db-20260906195011905-3917f5c1/manifest.json", import.meta.url);
const sourceManifestUrl = new URL("./format-preservation/styled-left-manifest.json", import.meta.url);
const sourceManifestSha = sha(readFileSync(sourceManifestUrl));
const sourceFixtureUrl = new URL("../../../supabase/functions/extract-upload/fixtures/source-preservation.docx", import.meta.url);
const sourceFixtureSha = sha(readFileSync(sourceFixtureUrl));
const sourceRoot = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const { root, dockerHost, dockerExecutable, node, env: localEnv } = resolveAcceptanceRuntime({ sourceRoot });
const github = process.env.GITHUB_ACTIONS === undefined ? undefined : {
  actions: process.env.GITHUB_ACTIONS,
  repository: process.env.GITHUB_REPOSITORY,
  eventName: process.env.GITHUB_EVENT_NAME,
  sha: process.env.GITHUB_SHA,
  ref: process.env.GITHUB_REF,
  baseRef: process.env.GITHUB_BASE_REF ?? "",
};
let head;
const runnerSha = sha(readFileSync(new URL(import.meta.url)));
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
const project = `prompted-db-${runId}`;
const evidence = join(root, "docs/evidence/web-operational-readiness", `db-${runId}`);
const scratch = mkdtempSync(join(tmpdir(), `prompted-db-${runId}-`));
const workdir = realpathSync(scratch);
const results = [];
let attemptedStart = false;
let failed = false;
let manifest;
let initialResources;
let sourceBefore;
let configHash;
let uploadSqlScope;
let v3UpgradePlan;
let rtfAliasUpgradePlan;
let fallbackUpgradePlan;
let sourceImportUpgradePlan;
let workspaceReadUpgradePlan;
let legacyPolicyUpgradePlan;
let catalogueUpgradePlan;
let cataloguePhase = "full";
const heldCatalogueFile = join(workdir, "held-catalogue-seed.sql");
let legacyAuditUpgradePlan;
let legacyAuditPhase = "full";
const heldLegacyAuditMigration = join(workdir, "held-legacy-audit-migration.sql");
const heldLegacyAuditTest = join(workdir, "held-legacy-audit-test.sql");
let legacyWorkspaceCoreUpgradePlan;
let workspaceCorePhase = "full";
let hostedLedgerUpgradePlan;
let hostedLedgerPhase = "full";
const heldHostedMigrations = join(workdir, "held-hosted-migrations");
const heldWorkspaceCoreMigration = join(workdir, "held-workspace-core-migration.sql");
const heldWorkspaceCoreTest = join(workdir, "held-workspace-core-test.sql");
const heldWorkspaceReleaseSql = join(workdir, "held-workspace-release-sql");
const heldSourcePreparationMigration = join(workdir, "held-source-preparation-migration.sql");
const heldSourcePreparationTest = join(workdir, "held-source-preparation-test.sql");
mkdirSync(evidence, { recursive: true });
save("runner.mjs", readFileSync(new URL(import.meta.url), "utf8"));
save("profile-read-acceptance.mjs", readFileSync(profileProbeUrl, "utf8"));
save("upload-source-upgrade-acceptance.mjs", readFileSync(sourceProbeUrl, "utf8"));
save("disposable-database-reset.mjs", readFileSync(resetGuardUrl, "utf8"));
save("upload-source-sql-scope.mjs", readFileSync(sqlScopeUrl, "utf8"));
save("upload-source-sql-scope.test.mjs", readFileSync(sqlScopeTestUrl, "utf8"));
for (const input of v3Inputs) copyFileSync(input.url, join(evidence, input.target));

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
function save(name, value) {
  writeFileSync(
    join(evidence, name),
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
}
function redact(text) {
  return text
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[local JWT redacted]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[local API key redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/g, "$1[redacted]@")
    .split("\n")
    .map((line) =>
      /(?:secret key|anon key|service_role key|access key|secret access|jwt secret|password\s*[:=])/i.test(
        line,
      )
        ? "[local credential/status line redacted]"
        : line,
    )
    .join("\n");
}
function command(label, executable, args, timeout = 30_000, execution = {}) {
  const start = new Date().toISOString();
  const result = spawnSync(executable, args, {
    cwd: execution.cwd ?? root,
    env: execution.env ?? localEnv,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  save(`${label}.log`, redact(`${result.stdout ?? ""}${result.stderr ?? ""}`));
  results.push({
    label,
    executable,
    args,
    start,
    end: new Date().toISOString(),
    exit: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
  });
  save("results.json", results);
  if (result.error || result.status !== 0)
    throw new Error(
      `${label} failed (exit ${result.status}, ${result.error?.code ?? result.signal ?? "no signal"})`,
    );
  return result.stdout.trim();
}
let inspection = 0;
function docker(args) {
  return command(`inspect-${++inspection}`, dockerExecutable, ["--host", dockerHost, ...args]);
}
function resources() {
  return {
    containers: docker(["ps", "-a", "--format", "{{.ID}} {{.Names}}"]).split("\n").filter(Boolean),
    volumes: docker(["volume", "ls", "--format", "{{.Name}} {{.Driver}}"])
      .split("\n")
      .filter(Boolean),
    networks: docker(["network", "ls", "--format", "{{.ID}} {{.Name}}"])
      .split("\n")
      .filter(Boolean),
  };
}
function ownResources(all) {
  return Object.fromEntries(
    Object.entries(all).map(([kind, rows]) => [
      kind,
      rows.filter((row) => row.split(" ").some((name) => name.endsWith(`_${project}`))),
    ]),
  );
}
function attestPublishedPorts() {
  const owned = ownResources(resources());
  assert(owned.containers.length > 0);
  const bindings = [];
  for (const row of owned.containers) {
    const [container, name] = row.split(" ");
    const ports = JSON.parse(
      docker(["inspect", container, "--format", "{{json .NetworkSettings.Ports}}"]),
    );
    for (const [port, published] of Object.entries(ports ?? {})) {
      for (const binding of published ?? []) {
        assert(
          (name === `supabase_db_${project}` &&
            port === "5432/tcp" &&
            binding.HostPort === "58322") ||
            (name === `supabase_kong_${project}` &&
              port === "8000/tcp" &&
              binding.HostPort === "58321"),
          `Unexpected published port on ${name}`,
        );
        bindings.push({ container, name, port, binding });
      }
    }
  }
  assert(bindings.some((binding) => binding.binding.HostPort === "58321"));
  assert(bindings.some((binding) => binding.binding.HostPort === "58322"));
  save("published-ports.json", bindings);
}
function sourceIdentity(label) {
  const included = (file) =>
    !file.startsWith("docs/") && !file.startsWith(".agents/") && file !== "skills-lock.json";
  const files = command(`${label}-files`, "git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .filter(included);
  const deletedFiles = command(`${label}-deleted`, "git", ["ls-files", "--deleted", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter(included);
  return snapshotAcceptanceSources({ root, files, deletedFiles });
}
function copySql(relativeDir) {
  const from = join(root, relativeDir);
  const to = join(workdir, relativeDir);
  mkdirSync(to, { recursive: true });
  const copied = {};
  for (const name of readdirSync(from).sort()) {
    const original = join(from, name);
    assert(
      lstatSync(original).isFile() && name.endsWith(".sql"),
      `Unreviewed SQL input: ${original}`,
    );
    if (uploadSqlScope && !Object.hasOwn(uploadSqlScope.selected, `${relativeDir}/${name}`)) continue;
    const destination = join(to, name);
    copyFileSync(original, destination);
    copied[relative(workdir, destination)] = sha(readFileSync(destination));
    assert.equal(copied[relative(workdir, destination)], sha(readFileSync(original)));
    assert.equal(copied[relative(workdir, destination)], sourceBefore[relative(root, original)]);
  }
  return copied;
}
function checkTarget() {
  assert.equal(sha(readFileSync(new URL(import.meta.url))), runnerSha, "Runner changed");
  assert.equal(sha(readFileSync(profileProbeUrl)), profileProbeSha, "Profile probe changed");
  assert.equal(sha(readFileSync(sourceProbeUrl)), sourceProbeSha, "Upload source probe changed");
  assert.equal(sha(readFileSync(resetGuardUrl)), resetGuardSha, "Disposable reset guard changed");
  assert.equal(sha(readFileSync(sqlScopeUrl)), sqlScopeSha, "Upload SQL scope guard changed");
  assert.equal(sha(readFileSync(sqlScopeTestUrl)), sqlScopeTestSha, "Upload SQL scope tests changed");
  for (const input of v3Inputs) {
    assert.equal(sha(readFileSync(input.url)), input.sha256, `V3 input changed: ${input.target}`);
    assert.equal(sha(readFileSync(join(workdir, input.target))), input.sha256, `Copied v3 input changed: ${input.target}`);
  }
  if (uploadSqlScope) {
    assert.equal(sha(readFileSync(sqlBaselineUrl)), uploadSqlScope.baselineSha, "Upload SQL baseline changed");
    assert.deepEqual(manifest, uploadSqlScope.selected, "Copied SQL differs from accepted upload scope");
  }
  assert.equal(sha(readFileSync(sourceManifestUrl)), sourceManifestSha, "Source manifest fixture changed");
  assert.equal(sha(readFileSync(sourceFixtureUrl)), sourceFixtureSha, "Source archive fixture changed");
  assert.equal(sha(readFileSync(join(workdir, "source-manifest.json"))), sourceManifestSha);
  assert.equal(sha(readFileSync(join(workdir, "source-preservation.docx"))), sourceFixtureSha);
  assert.equal(realpathSync(workdir), workdir);
  assert(workdir !== root && !workdir.startsWith(`${root}/`));
  assert.equal(readFileSync(join(workdir, "run-owner.txt"), "utf8"), project);
  assert.equal(sha(readFileSync(join(workdir, "supabase/config.toml"))), configHash);
  for (const directory of [workdir, join(workdir, "supabase")]) {
    assert(
      !readdirSync(directory).some((name) => name === ".env" || name.startsWith(".env.")),
      "Unexpected local dotenv input",
    );
  }
  assert(!existsSync(join(workdir, "supabase/.temp/project-ref")));
  const currentFiles = ["supabase/migrations", "supabase/tests"]
    .flatMap((directory) => {
      assert(lstatSync(join(workdir, directory)).isDirectory());
      return readdirSync(join(workdir, directory)).map((name) => `${directory}/${name}`);
    })
    .sort();
  const activeManifest = catalogueUpgradePlan && cataloguePhase === "policy-prefix"
    ? catalogueUpgradePlan.prefixManifest
    : legacyAuditUpgradePlan && legacyAuditPhase === "predecessor"
      ? legacyAuditUpgradePlan.prefixManifest
      : legacyWorkspaceCoreUpgradePlan && workspaceCorePhase === "predecessor"
        ? legacyWorkspaceCoreUpgradePlan.prefixManifest
        : hostedLedgerUpgradePlan && hostedLedgerPhase === "historical"
          ? hostedLedgerUpgradePlan.historicalManifest : manifest;
  assert.deepEqual(currentFiles, Object.keys(activeManifest).sort(), "Copied SQL file inventory changed");
  const actualManifest = {};
  for (const [file, digest] of Object.entries(activeManifest)) {
    assert(lstatSync(join(workdir, file)).isFile());
    const actualSha = sha(readFileSync(join(workdir, file)));
    assert.equal(actualSha, digest, `Copied input changed: ${file}`);
    actualManifest[file] = actualSha;
  }
  if (catalogueUpgradePlan) {
    if (existsSync(heldCatalogueFile)) assert(lstatSync(heldCatalogueFile).isFile());
    assertCataloguePhase(catalogueUpgradePlan, cataloguePhase, actualManifest,
      existsSync(heldCatalogueFile) ? sha(readFileSync(heldCatalogueFile)) : null);
  }
  if (legacyAuditUpgradePlan) {
    for (const file of [heldLegacyAuditMigration, heldLegacyAuditTest]) {
      if (existsSync(file)) assert(lstatSync(file).isFile());
    }
    assertLegacyAuditPhase(legacyAuditUpgradePlan, legacyAuditPhase, actualManifest, {
      migration: existsSync(heldLegacyAuditMigration) ? sha(readFileSync(heldLegacyAuditMigration)) : null,
      test: existsSync(heldLegacyAuditTest) ? sha(readFileSync(heldLegacyAuditTest)) : null,
    });
  }
  if (legacyWorkspaceCoreUpgradePlan) {
    const additionalHeld = Object.fromEntries(readdirSync(heldWorkspaceReleaseSql).sort().map(name => {
      const file=join(heldWorkspaceReleaseSql,name);
      assert(lstatSync(file).isFile());
      return [name.replaceAll("__","/"),sha(readFileSync(file))];
    }));
    for (const file of [heldWorkspaceCoreMigration, heldWorkspaceCoreTest, heldSourcePreparationMigration, heldSourcePreparationTest]) {
      if (existsSync(file)) assert(lstatSync(file).isFile());
    }
    assertLegacyWorkspaceCorePhase(legacyWorkspaceCoreUpgradePlan, workspaceCorePhase, actualManifest, {
      migration: existsSync(heldWorkspaceCoreMigration) ? sha(readFileSync(heldWorkspaceCoreMigration)) : null,
      test: existsSync(heldWorkspaceCoreTest) ? sha(readFileSync(heldWorkspaceCoreTest)) : null,
      sourceMigration: existsSync(heldSourcePreparationMigration) ? sha(readFileSync(heldSourcePreparationMigration)) : null,
      sourceTest: existsSync(heldSourcePreparationTest) ? sha(readFileSync(heldSourcePreparationTest)) : null,
    },additionalHeld);
  }
  if (hostedLedgerUpgradePlan) {
    const held = Object.fromEntries(readdirSync(heldHostedMigrations).sort().map(name => {
      const file = join(heldHostedMigrations, name);
      assert(lstatSync(file).isFile());
      return [`supabase/migrations/${name}`, sha(readFileSync(file))];
    }));
    assertHostedLedgerPhase(hostedLedgerUpgradePlan, hostedLedgerPhase, actualManifest, held);
  }
}
function attestDatabase(label) {
  checkTarget();
  const name = `supabase_db_${project}`;
  const container = JSON.parse(docker(["inspect", name, "--format", "{{json .Id}}"]));
  assert.equal(docker(["inspect", container, "--format", "{{.Name}}"]), `/${name}`);
  const ports = JSON.parse(
    docker(["inspect", container, "--format", "{{json .NetworkSettings.Ports}}"]),
  );
  assert(ports["5432/tcp"]?.length > 0);
  assert(ports["5432/tcp"].every((port) => port.HostPort === "58322"));
  const networks = Object.keys(
    JSON.parse(docker(["inspect", container, "--format", "{{json .NetworkSettings.Networks}}"])),
  ).sort();
  assert.deepEqual(networks, [`supabase_network_${project}`]);
  const mounts = JSON.parse(docker(["inspect", container, "--format", "{{json .Mounts}}"]));
  assert.equal(mounts.length, 1, "Unexpected database mounts");
  assert.equal(mounts[0].Type, "volume");
  assert.equal(mounts[0].Name, `supabase_db_${project}`);
  assert.equal(mounts[0].Destination, "/var/lib/postgresql/data");
  assert.equal(mounts[0].Driver, "local");
  const identity = JSON.parse(
    command(label, dockerExecutable, [
      "--host",
      dockerHost,
      "exec",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-c",
      "select json_build_object('database', current_database(), 'cluster', system_identifier::text, 'port', current_setting('port'), 'version', current_setting('server_version')) from pg_catalog.pg_control_system()",
    ]),
  );
  assert.equal(identity.database, "postgres");
  assert.equal(identity.port, "5432");
  assert.match(identity.cluster, /^\d+$/);
  assert.match(identity.version, /^17\./);
  const snapshot = {
    project,
    container,
    identity,
    ports,
    networks,
    mounts,
    image: docker(["inspect", container, "--format", "{{.Config.Image}} {{.Image}}"]),
  };
  save(`${label}.json`, snapshot);
  return snapshot;
}
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ port, host: "0.0.0.0", exclusive: true }, () => server.close(resolve));
  });
}
function supabase(label, args, timeout) {
  checkTarget();
  return command(label, "supabase", ["--workdir", workdir, "--agent", "no", ...args], timeout);
}

try {
  assert.equal(realpathSync(process.cwd()), root);
  assert.equal(command("repository-root", "git", ["rev-parse", "--show-toplevel"]), root);
  head = assertAcceptanceSourceIdentity({
    head: command("head-before", "git", ["rev-parse", "HEAD"]),
    expectedHead: process.env.PROMPTED_ACCEPTANCE_EXPECTED_HEAD,
    branch: command("branch", "git", ["branch", "--show-current"]),
    origin: command("repository-origin", "git", ["remote", "get-url", "origin"]),
    github,
  });
  assert.equal(command("node-version", node, ["--version"]), "v22.23.2");
  assert.equal(command("supabase-version", "supabase", ["--version"]), "2.114.0");
  assert.equal(command("pnpm-version", "pnpm", ["--version"]), "10.33.0");
  if (workspaceUploadBrowserAcceptance) {
    assert.match(command("deno-version", "deno", ["--version"]), /^deno 2\.9\.5 \(stable, release, [^)]+\)\n/);
  }
  assert(lstatSync(dockerHost.slice("unix://".length)).isSocket());
  command("docker-version", dockerExecutable, [
    "--host",
    dockerHost,
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  sourceBefore = sourceIdentity("source-before");
  save("source-before.sha256.json", sourceBefore);
  if (uploadSourceAcceptance) {
    uploadSqlScope = selectUploadSourceSqlScope(readFileSync(sqlBaselineUrl), sourceBefore);
    save("upload-sql-scope.json", uploadSqlScope);
  }
  command("tracked-before", "git", ["diff", "--binary", "HEAD"]);
  command("status-before", "git", ["status", "--porcelain"]);
  command("source-test", node, ["--test", "scripts/deno-execution-boundary.test.mjs", "scripts/database-test-isolation.test.mjs",
    "docs/evidence/web-operational-readiness/acceptance-source-identity.test.mjs",
    "docs/evidence/web-operational-readiness/acceptance-runtime.test.mjs",
    "docs/evidence/web-operational-readiness/legacy-policy-upgrade-acceptance.test.mjs",
    "docs/evidence/web-operational-readiness/catalogue-upgrade-acceptance.test.mjs",
    "docs/evidence/web-operational-readiness/legacy-audit-upgrade-acceptance.test.mjs",
    "docs/evidence/web-operational-readiness/legacy-workspace-core-upgrade-acceptance.test.mjs",
    "docs/evidence/web-operational-readiness/paid-plan-fixture-revisions.test.mjs", "docs/evidence/web-operational-readiness/hosted-ledger-upgrade-acceptance.test.mjs",
    "docs/evidence/web-operational-readiness/current-release-upgrade.test.mjs",
    "docs/evidence/web-operational-readiness/disposable-database-reset.test.mjs",
    "docs/evidence/web-operational-readiness/upload-source-sql-scope.test.mjs",
    "docs/evidence/web-operational-readiness/upload-source-v3-upgrade-acceptance.test.mjs",
    "docs/evidence/web-operational-readiness/workspace-upload-read-acceptance.test.mjs"]);
  command("migration-check", node, ["scripts/check-migrations.mjs"]);
  initialResources = resources();
  save("resources-before.json", initialResources);
  assert(Object.values(ownResources(initialResources)).every((rows) => rows.length === 0));
  for (const port of [58320, 58321, 58322]) await requireFreePort(port);
  if (workspaceBrowserAcceptance || workspaceUploadBrowserAcceptance) await requireFreePort(58323);
  if (workspaceUploadBrowserAcceptance) for (const port of [58324, 58325, 58326]) await requireFreePort(port);
  if (workspaceUploadBrowserAcceptance) {
    command("upload-browser-fixture-tests", node, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--test", "tests/e2e/workspace-upload-fixtures.test.ts"]);
    command("upload-browser-types", "pnpm", ["exec", "tsc", "--project", "tests/e2e/tsconfig.json"]);
    command("upload-browser-transport-tests", node, ["--test", "docs/evidence/web-operational-readiness/workspace-upload-transport.test.mjs", "docs/evidence/web-operational-readiness/upload-run-disposition.test.mjs"]);
    command("profile-sdk-retry-tests", node, ["--test", "docs/evidence/web-operational-readiness/profile-sdk-retry.test.mjs"]);
    const denoBoundary = createDenoExecutionBoundary(root, localEnv);
    try {
      // Deno 2.9.5 check has no --cached-only flag. test --no-run typechecks
      // these explicit entrypoints without executing any module or fetching.
      command("upload-browser-deno-types", "deno", ["test", ...denoBoundary.flags, "--no-run",
        ...["docs/evidence/web-operational-readiness/workspace-upload-deno.ts",
          "supabase/functions/ingest-upload/index.ts", "supabase/functions/extract-upload/index.ts"].map(path => join(root, path))],
        30_000, denoBoundary);
    } finally {
      denoBoundary.close();
    }
  }
  if (workspaceBrowserAcceptance) command("workspace-browser-types", "pnpm", ["exec", "tsc", "--project", "tests/e2e/tsconfig.json"]);
  if (workspaceBrowserAcceptance) command("workspace-browser-fixture-guards", node, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--test", "tests/e2e/workspace-fixtures.test.ts"]);

  manifest = { ...copySql("supabase/migrations"), ...copySql("supabase/tests") };
  if (uploadSourceV3Acceptance) v3UpgradePlan = validateV3UpgradePlan(manifest, sourceBefore);
  if (uploadRtfAliasAcceptance) rtfAliasUpgradePlan = validateRtfAliasUpgradePlan(manifest, sourceBefore);
  if (uploadFallbackAcceptance) fallbackUpgradePlan = validateUploadFallbackUpgradePlan(manifest, sourceBefore);
  if (sourceImportAcceptance) sourceImportUpgradePlan = validateSourceImportUpgradePlan(manifest, sourceBefore);
  if (workspaceBrowserAcceptance) workspaceReadUpgradePlan = validateWorkspaceReadUpgradePlan(manifest, sourceBefore);
  if (legacyPolicyUpgradeAcceptance) legacyPolicyUpgradePlan = validateLegacyPolicyUpgradePlan(manifest, sourceBefore);
  if (catalogueUpgradeAcceptance) catalogueUpgradePlan = validateCatalogueUpgradePlan(manifest, sourceBefore);
  if (legacyAuditUpgradeAcceptance) legacyAuditUpgradePlan = validateLegacyAuditUpgradePlan(manifest, sourceBefore);
  if (legacyWorkspaceCoreUpgradeAcceptance) {
    legacyWorkspaceCoreUpgradePlan = validateLegacyWorkspaceCoreUpgradePlan(manifest, sourceBefore);
    mkdirSync(heldWorkspaceReleaseSql);
  }
  if (hostedLedgerUpgradeAcceptance) {
    hostedLedgerUpgradePlan = validateHostedLedgerUpgradePlan(manifest, sourceBefore);
    mkdirSync(heldHostedMigrations);
  }
  for (const input of v3Inputs) copyFileSync(input.url, join(workdir, input.target));
  copyFileSync(sourceManifestUrl, join(workdir, "source-manifest.json"));
  copyFileSync(sourceFixtureUrl, join(workdir, "source-preservation.docx"));
  const config = `project_id = "${project}"\n\n[api]\nport = 58321\n\n[api.tls]\nenabled = false\n\n[db]\nport = 58322\nshadow_port = 58320\nmajor_version = 17\n\n[db.seed]\nenabled = false\n\n[auth]\nenable_anonymous_sign_ins = false\n`;
  writeFileSync(join(workdir, "supabase/config.toml"), config);
  writeFileSync(join(workdir, "run-owner.txt"), project);
  configHash = sha(config);
  save("manifest.json", {
    runId,
    project,
    workdir,
    root,
    head,
    github: github ?? null,
    dockerHost,
    runnerSha,
    sourceProbeSha,
    resetGuardSha,
    sqlScopeSha,
    sqlScopeTestSha,
    sourceManifestSha,
    sourceFixtureSha,
    uploadSourceV3Acceptance,
    workspaceBrowserAcceptance,
    workspaceUploadBrowserAcceptance,
    legacyPolicyUpgradeAcceptance,
    legacyPolicyUpgradePlan: legacyPolicyUpgradePlan ?? null,
    catalogueUpgradeAcceptance,
    catalogueUpgradePlan: catalogueUpgradePlan ?? null,
    legacyAuditUpgradeAcceptance,
    legacyAuditUpgradePlan: legacyAuditUpgradePlan ?? null,
    legacyWorkspaceCoreUpgradeAcceptance,
    legacyWorkspaceCoreUpgradePlan: legacyWorkspaceCoreUpgradePlan ?? null,
    hostedLedgerUpgradeAcceptance,
    hostedLedgerUpgradePlan: hostedLedgerUpgradePlan ?? null,
    workspaceReadUpgradePlan: workspaceReadUpgradePlan ?? null,
    v3UpgradePlan: v3UpgradePlan ?? null,
    rtfAliasUpgradePlan: rtfAliasUpgradePlan ?? null,
    fallbackUpgradePlan: fallbackUpgradePlan ?? null,
    sourceImportUpgradePlan: sourceImportUpgradePlan ?? null,
    sourceImportAcceptance,
    uploadFallbackAcceptance,
    uploadRtfAliasAcceptance,
    v3Inputs: v3Inputs.map(({ target, sha256 }) => ({ target, sha256 })),
    configHash,
    manifest,
  });
  save("config.toml", config);
  checkTarget();
  assert(Object.values(ownResources(resources())).every((rows) => rows.length === 0));
  for (const port of [58320, 58321, 58322]) await requireFreePort(port);
  if (!preflightOnly) {
    attemptedStart = true;
    supabase(
      "start",
      ["start", "-x", "studio,imgproxy,mailpit,logflare,vector,supavisor,edge-runtime"],
      15 * 60_000,
    );
    save("resources-started.json", ownResources(resources()));
    attestPublishedPorts();
    const initialDatabase = attestDatabase("database-before-reset");
    supabase("fresh-reset", ["db", "reset", "--local", "--no-seed", "--yes"], 10 * 60_000);
    let database = attestDatabase("database-after-reset");
    assertDisposableReset(initialDatabase, database);
    supabase("fresh-tests", ["test", "db", "--local"], 10 * 60_000);
    if (hostedLedgerUpgradeAcceptance || legacyWorkspaceCoreUpgradeAcceptance || workspaceUploadBrowserAcceptance) {
      supabase("fresh-schema-lint", ["db", "lint", "--local", "--schema", "public,private",
        "--level", "warning", "--fail-on", "error"], 10 * 60_000);
    }
    if (hostedLedgerUpgradeAcceptance) {
      const plan = hostedLedgerUpgradePlan;
      const sql = (label, query) => {
        checkTarget();
        return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
          "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
      };
      const history = label => JSON.parse(sql(label,
        "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"));
      // Audit metadata only: compare the recorded-hosted predecessor with the
      // live catalog before claiming schema-body equivalence. No application
      // rows, credentials or function bodies are included. MD5 is only a
      // deterministic equality fingerprint, never an authenticity proof.
      const functionCatalog = label => save(`${label}.json`, JSON.parse(sql(label,
        `select coalesce(jsonb_agg(to_jsonb(r) order by schema_name,function_name,identity_arguments),'[]'::jsonb)
        from (select n.nspname as schema_name, p.proname as function_name,
          pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
          pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_md5,
          p.prosecdef as security_definer, p.provolatile as volatility, p.proacl::text as acl
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','private') and p.prokind='f') r;`)));
      const transition = next => {
        checkTarget(); assert.notEqual(next, hostedLedgerPhase);
        assert.ok(next === "full" || next === "historical");
        const moves = plan.pendingFiles.map(file => {
          const active = join(workdir, file), held = join(heldHostedMigrations, file.split("/").at(-1));
          const [from, to] = next === "historical" ? [active, held] : [held, active];
          assert(lstatSync(from).isFile()); assert.equal(sha(readFileSync(from)), plan.manifest[file]);
          assert(!existsSync(to)); return [from, to];
        });
        const moved = [];
        try {
          for (const [from, to] of moves) { renameSync(from, to); moved.push([from, to]); }
        } catch (error) {
          for (const [from, to] of moved.reverse()) renameSync(to, from);
          throw error;
        }
        hostedLedgerPhase = next; checkTarget();
      };
      assert.deepEqual(history("hosted-ledger-fresh-history"), plan.versions);
      try {
        transition("historical");
        assert.deepEqual(attestDatabase("hosted-ledger-before-reset"), database);
        supabase("hosted-ledger-historical-reset", ["db", "reset", "--local", "--no-seed", "--yes"], 10 * 60_000);
        const historicalDatabase = attestDatabase("hosted-ledger-after-reset");
        assertDisposableReset(database, historicalDatabase); database = historicalDatabase;
        assert.deepEqual(history("hosted-ledger-historical-history"), plan.hostedVersions);
        functionCatalog("hosted-ledger-historical-function-catalog");
        save("hosted-ledger-historical-schema-catalog.json", JSON.parse(sql("hosted-ledger-historical-schema-catalog", hostedSchemaCatalogSql)));
        sql("hosted-ledger-reproduce-observed-grants", observedOwnerRpcGrantFixture);
        sql("hosted-ledger-reproduce-observed-schema-grants", observedSchemaGrantFixture);
        save("hosted-ledger-observed-schema-catalog.json", JSON.parse(sql("hosted-ledger-observed-schema-catalog", hostedSchemaCatalogSql)));
        functionCatalog("hosted-ledger-observed-function-catalog");
        assert.equal(sql("hosted-ledger-observed-anon-profile-grant",
          "select has_function_privilege('anon','public.link_own_business(uuid)','EXECUTE');").trim(), "t");
        await exerciseHostedLedgerUpgrade({ project, workdir, env: localEnv, checkTarget, save, sql,
          applyMigration() {
            assert.equal(hostedLedgerPhase, "historical");
            assert.deepEqual(attestDatabase("hosted-ledger-before-forward"), database);
            assert.deepEqual(history("hosted-ledger-history-before-forward"), plan.hostedVersions);
            transition("full");
            // This flag is confined to the explicitly identified disposable
            // database. Production's strict inventory guard remains unchanged.
            supabase("hosted-ledger-apply-forward", ["migration", "up", "--local", "--include-all", "--yes"], 10 * 60_000);
            assert.deepEqual(attestDatabase("hosted-ledger-after-forward"), database);
            assert.deepEqual(history("hosted-ledger-history-after-forward"), plan.versions);
          },
        });
        assert.equal(hostedLedgerPhase, "full");
        functionCatalog("hosted-ledger-current-function-catalog");
        save("hosted-ledger-current-schema-catalog.json", JSON.parse(sql("hosted-ledger-current-schema-catalog", hostedSchemaCatalogSql)));
        supabase("hosted-ledger-upgraded-tests", ["test", "db", "--local"], 10 * 60_000);
        supabase("hosted-ledger-upgraded-schema-lint", ["db", "lint", "--local", "--schema", "public,private",
          "--level", "warning", "--fail-on", "error"], 10 * 60_000);
      } finally {
        if (hostedLedgerPhase === "historical") transition("full");
      }
    }
    if (uploadSourceAcceptance) {
      // This reset affects only the same identified disposable stack created
      // by this run. Recreate the exact predecessor schema, seed representative
      // historical rows, then apply only the pending forward migration.
      assert.deepEqual(attestDatabase("source-database-before-historical-reset"), database);
      supabase("source-historical-reset", ["db", "reset", "--local", "--no-seed", "--yes",
        "--version", "20260906010846"], 10 * 60_000);
      const historicalDatabase = attestDatabase("source-database-before-upgrade");
      assertDisposableReset(database, historicalDatabase);
      database = historicalDatabase;
      const migrationVersions = Object.keys(manifest)
        .filter(path => path.startsWith("supabase/migrations/"))
        .map(path => path.split("/").at(-1).slice(0, 14)).sort();
      assert.deepEqual(migrationVersions.filter(version => version > "20260906010846"), ["20260906160000"],
        "Upload source acceptance permits exactly one forward migration");
      const migrationHistory = label => JSON.parse(command(label, dockerExecutable, ["--host", dockerHost,
        "exec", database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c",
        "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"]));
      await exerciseUploadSourceUpgrade({ project, workdir, env: localEnv, checkTarget, save,
        applyMigration() {
          assert.deepEqual(attestDatabase("source-database-before-forward-migration"), database);
          assert.deepEqual(migrationHistory("source-migration-history-before"),
            migrationVersions.filter(version => version <= "20260906010846"));
          supabase("source-apply-forward-migration", ["migration", "up", "--local", "--yes"], 10 * 60_000);
          assert.deepEqual(attestDatabase("source-database-after-forward-migration"), database);
          assert.deepEqual(migrationHistory("source-migration-history-after"), migrationVersions);
        },
        sql(label, query) {
          checkTarget();
          return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
            "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
        },
      });
      supabase("source-upgraded-tests", ["test", "db", "--local"], 10 * 60_000);
    }
    if (uploadSourceV3Acceptance || uploadRtfAliasAcceptance || uploadFallbackAcceptance || sourceImportAcceptance || workspaceBrowserAcceptance || legacyPolicyUpgradeAcceptance) {
      const upgradePlan = legacyPolicyUpgradeAcceptance ? legacyPolicyUpgradePlan : workspaceBrowserAcceptance ? workspaceReadUpgradePlan : sourceImportAcceptance ? sourceImportUpgradePlan : uploadFallbackAcceptance ? fallbackUpgradePlan : uploadRtfAliasAcceptance ? rtfAliasUpgradePlan : v3UpgradePlan;
      const exerciseUpgrade = legacyPolicyUpgradeAcceptance ? exerciseLegacyPolicyUpgrade : workspaceBrowserAcceptance ? exerciseWorkspaceReads : sourceImportAcceptance ? exerciseSourceImportUpgrade : uploadFallbackAcceptance ? exerciseUploadFallbackUpgrade : uploadRtfAliasAcceptance ? exerciseUploadRtfAliasUpgrade : exerciseUploadSourceV3Upgrade;
      assert.deepEqual(attestDatabase("v3-before-historical-reset"), database);
      supabase("v3-historical-reset", ["db", "reset", "--local", "--no-seed", "--yes",
        "--version", upgradePlan.predecessor], 10 * 60_000);
      const historicalDatabase = attestDatabase("v3-before-upgrade");
      assertDisposableReset(database, historicalDatabase);
      database = historicalDatabase;
      const migrationHistory = label => JSON.parse(command(label, dockerExecutable, ["--host", dockerHost,
        "exec", database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c",
        "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"]));
      const expectedHistory = upgradePlan.versions.filter(version => version <= upgradePlan.predecessor);
      assert.deepEqual(migrationHistory("v3-history-after-historical-reset"), expectedHistory);
      await exerciseUpgrade({ project, workdir, env: localEnv, checkTarget, save,
        ...(workspaceBrowserAcceptance ? { exerciseBrowser: fixtures => exerciseWorkspaceBrowser({
          root, project, workdir, env: localEnv, evidence, checkTarget, save, ...fixtures,
        }) } : {}),
        applyMigration() {
          assert.deepEqual(attestDatabase("v3-before-forward-migration"), database);
          assert.deepEqual(migrationHistory("v3-history-before-forward"), expectedHistory);
          supabase("v3-apply-forward-migration", ["migration", "up", "--local", "--yes"], 10 * 60_000);
          assert.deepEqual(attestDatabase("v3-after-forward-migration"), database);
          assert.deepEqual(migrationHistory("v3-history-after-forward"), upgradePlan.versions);
        },
        sql(label, query) {
          checkTarget();
          return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
            "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
        },
      });
      supabase("v3-upgraded-tests", ["test", "db", "--local"], 10 * 60_000);
    }
    if (legacyAuditUpgradeAcceptance) {
      const plan = legacyAuditUpgradePlan;
      const phaseLog = [];
      const migrationHistory = label => JSON.parse(command(label, dockerExecutable, ["--host", dockerHost,
        "exec", database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c",
        "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"]));
      const transitionPhase = next => {
        assert.ok(next === "full" || next === "predecessor");
        assert.notEqual(next, legacyAuditPhase);
        checkTarget();
        const moves = [
          [join(workdir, legacyAuditMigrationFile), heldLegacyAuditMigration, legacyAuditMigrationSha],
          [join(workdir, legacyAuditTestFile), heldLegacyAuditTest, legacyAuditTestSha],
        ];
        // Validate both sides before either rename. A phase never changes an
        // input's bytes or silently admits additional SQL.
        for (const [active, held, digest] of moves) {
          const [from, to] = next === "predecessor" ? [active, held] : [held, active];
          assert(lstatSync(from).isFile());
          assert.equal(sha(readFileSync(from)), digest);
          assert(!existsSync(to));
        }
        const moved = [];
        try {
          for (const [active, held] of moves) {
            const [from, to] = next === "predecessor" ? [active, held] : [held, active];
            renameSync(from, to);
            moved.push([from, to]);
          }
        } catch (error) {
          for (const [from, to] of moved.reverse()) renameSync(to, from);
          throw error;
        }
        legacyAuditPhase = next;
        checkTarget();
        phaseLog.push({ phase: next, at: new Date().toISOString(),
          migrationSha: legacyAuditMigrationSha, testSha: legacyAuditTestSha,
          copiedSqlCount: Object.keys(next === "full" ? plan.manifest : plan.prefixManifest).length });
        save("legacy-audit-upgrade-phases.json", phaseLog);
      };
      assert.deepEqual(migrationHistory("legacy-audit-fresh-history"), plan.versions);
      try {
        transitionPhase("predecessor");
        assert.deepEqual(attestDatabase("legacy-audit-before-historical-reset"), database);
        supabase("legacy-audit-historical-reset", ["db", "reset", "--local", "--no-seed", "--yes",
          "--version", plan.predecessor], 10 * 60_000);
        const historicalDatabase = attestDatabase("legacy-audit-after-historical-reset");
        assertDisposableReset(database, historicalDatabase);
        database = historicalDatabase;
        const predecessorVersions = plan.versions.filter(version => version <= plan.predecessor);
        assert.deepEqual(migrationHistory("legacy-audit-history-after-reset"), predecessorVersions);
        supabase("legacy-audit-predecessor-tests", ["test", "db", "--local"], 10 * 60_000);
        await exerciseLegacyAuditUpgrade({ project, workdir, env: localEnv, checkTarget, save,
          applyMigration() {
            assert.equal(legacyAuditPhase, "predecessor");
            assert.deepEqual(attestDatabase("legacy-audit-before-forward"), database);
            assert.deepEqual(migrationHistory("legacy-audit-history-before-forward"), predecessorVersions);
            transitionPhase("full");
            supabase("legacy-audit-apply-forward", ["migration", "up", "--local", "--yes"], 10 * 60_000);
            assert.deepEqual(attestDatabase("legacy-audit-after-forward"), database);
            assert.deepEqual(migrationHistory("legacy-audit-history-after-forward"), plan.versions);
          },
          sql(label, query) {
            checkTarget();
            return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
              "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
          },
        });
        assert.equal(legacyAuditPhase, "full");
        supabase("legacy-audit-upgraded-tests", ["test", "db", "--local"], 10 * 60_000);
      } finally {
        if (legacyAuditPhase === "predecessor") transitionPhase("full");
      }
    }
    if (legacyWorkspaceCoreUpgradeAcceptance) {
      const plan = legacyWorkspaceCoreUpgradePlan;
      const phaseLog = [];
      const migrationHistory = label => JSON.parse(command(label, dockerExecutable, ["--host", dockerHost,
        "exec", database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c",
        "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"]));
      const transitionPhase = next => {
        assert.ok(next === "full" || next === "predecessor");
        assert.notEqual(next, workspaceCorePhase);
        checkTarget();
        const moves = [
          [join(workdir, coreMigrationFile), heldWorkspaceCoreMigration, coreMigrationSha],
          [join(workdir, coreTestFile), heldWorkspaceCoreTest, coreTestSha],
          [join(workdir, sourcePreparationMigrationFile), heldSourcePreparationMigration, sourcePreparationMigrationSha],
          [join(workdir, sourcePreparationTestFile), heldSourcePreparationTest, sourcePreparationTestSha],
          ...Object.entries(plan.additionalHeldSql).map(([file,digest]) =>
            [join(workdir,file),join(heldWorkspaceReleaseSql,file.replaceAll("/","__")),digest]),
        ];
        // Validate both sides before either rename. A phase never changes an
        // input's bytes or silently admits additional SQL.
        for (const [active, held, digest] of moves) {
          const [from, to] = next === "predecessor" ? [active, held] : [held, active];
          assert(lstatSync(from).isFile());
          assert.equal(sha(readFileSync(from)), digest);
          assert(!existsSync(to));
        }
        const moved = [];
        try {
          for (const [active, held] of moves) {
            const [from, to] = next === "predecessor" ? [active, held] : [held, active];
            renameSync(from, to);
            moved.push([from, to]);
          }
        } catch (error) {
          for (const [from, to] of moved.reverse()) renameSync(to, from);
          throw error;
        }
        workspaceCorePhase = next;
        checkTarget();
        phaseLog.push({ phase: next, at: new Date().toISOString(),
          migrationSha: coreMigrationSha, testSha: coreTestSha,
          sourceMigrationSha: sourcePreparationMigrationSha, sourceTestSha: sourcePreparationTestSha,
          copiedSqlCount: Object.keys(next === "full" ? plan.manifest : plan.prefixManifest).length });
        save("workspace-core-upgrade-phases.json", phaseLog);
      };
      assert.deepEqual(migrationHistory("workspace-core-fresh-history"), plan.versions);
      try {
        transitionPhase("predecessor");
        assert.deepEqual(attestDatabase("workspace-core-before-historical-reset"), database);
        supabase("workspace-core-historical-reset", ["db", "reset", "--local", "--no-seed", "--yes",
          "--version", plan.predecessor], 10 * 60_000);
        const historicalDatabase = attestDatabase("workspace-core-after-historical-reset");
        assertDisposableReset(database, historicalDatabase);
        database = historicalDatabase;
        const predecessorVersions = plan.versions.filter(version => version <= plan.predecessor);
        assert.deepEqual(migrationHistory("workspace-core-history-after-reset"), predecessorVersions);
        supabase("workspace-core-predecessor-tests", ["test", "db", "--local"], 10 * 60_000);
        await exerciseLegacyWorkspaceCoreUpgrade({ project, workdir, env: localEnv, checkTarget, save, through: plan.through,
          applyMigration() {
            assert.equal(workspaceCorePhase, "predecessor");
            assert.deepEqual(attestDatabase("workspace-core-before-forward"), database);
            assert.deepEqual(migrationHistory("workspace-core-history-before-forward"), predecessorVersions);
            transitionPhase("full");
            supabase("workspace-core-apply-forward", ["migration", "up", "--local", "--yes"], 10 * 60_000);
            assert.deepEqual(attestDatabase("workspace-core-after-forward"), database);
            assert.deepEqual(migrationHistory("workspace-core-history-after-forward"), plan.versions);
          },
          sql(label, query) {
            checkTarget();
            return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
              "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
          },
        });
        assert.equal(workspaceCorePhase, "full");
        supabase("workspace-core-upgraded-tests", ["test", "db", "--local"], 10 * 60_000);
        supabase("workspace-core-upgraded-schema-lint", ["db", "lint", "--local", "--schema", "public,private",
          "--level", "warning", "--fail-on", "error"], 10 * 60_000);
      } finally {
        if (workspaceCorePhase === "predecessor") transitionPhase("full");
      }
    }
    if (catalogueUpgradeAcceptance) {
      const plan = catalogueUpgradePlan;
      const phaseLog = [];
      const migrationHistory = label => JSON.parse(command(label, dockerExecutable, ["--host", dockerHost,
        "exec", database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c",
        "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;"]));
      const sql = (label, query) => {
        checkTarget();
        return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
          "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
      };
      const setPhase = next => {
        checkTarget();
        assert.notEqual(next, cataloguePhase);
        assert.ok(next === "full" || next === "policy-prefix");
        const activeSeed = join(workdir, catalogueSeedFile);
        if (next === "policy-prefix") renameSync(activeSeed, heldCatalogueFile);
        else renameSync(heldCatalogueFile, activeSeed);
        cataloguePhase = next;
        checkTarget();
        phaseLog.push({ phase: next, at: new Date().toISOString(), seedFile: catalogueSeedFile,
          seedSha: catalogueSeedSha, copiedSqlCount: Object.keys(next === "full" ? plan.manifest : plan.prefixManifest).length });
        save("catalogue-upgrade-phases.json", phaseLog);
      };
      // The complete fresh gate above has already run. Hide only the explicitly
      // pinned successor during the unchanged policy helper's one-step upgrade.
      setPhase("policy-prefix");
      let policyPhaseFailure;
      try {
        assert.deepEqual(attestDatabase("catalogue-before-policy-reset"), database);
        supabase("catalogue-policy-historical-reset", ["db", "reset", "--local", "--no-seed", "--yes",
          "--version", plan.policyPlan.predecessor], 10 * 60_000);
        const historicalDatabase = attestDatabase("catalogue-policy-after-reset");
        assertDisposableReset(database, historicalDatabase); database = historicalDatabase;
        const predecessorVersions = plan.policyPlan.versions.filter(version => version <= plan.policyPlan.predecessor);
        assert.deepEqual(migrationHistory("catalogue-policy-history-after-reset"), predecessorVersions);
        await exerciseLegacyPolicyUpgrade({ project, workdir, env: localEnv, sql, checkTarget, save,
          applyMigration() {
            assert.deepEqual(attestDatabase("catalogue-policy-before-forward"), database);
            assert.deepEqual(migrationHistory("catalogue-policy-history-before-forward"), predecessorVersions);
            supabase("catalogue-policy-apply-forward", ["migration", "up", "--local", "--yes"], 10 * 60_000);
            assert.deepEqual(attestDatabase("catalogue-policy-after-forward"), database);
            assert.deepEqual(migrationHistory("catalogue-policy-history-after-forward"), plan.policyPlan.versions);
          },
        });
      } catch (error) {
        policyPhaseFailure = error;
        throw error;
      } finally {
        if (cataloguePhase === "policy-prefix") {
          try { setPhase("full"); }
          catch (error) {
            save("catalogue-phase-restore-failure.txt", `${redact(error.stack ?? String(error))}\n`);
            if (!policyPhaseFailure) throw error;
          }
        }
      }
      assert.deepEqual(migrationHistory("catalogue-seed-predecessor-history"), plan.policyPlan.versions);
      await exerciseCatalogueUpgrade({ project, workdir, env: localEnv, sql, checkTarget, save,
        migrationBytes: readFileSync(join(workdir, catalogueSeedFile)),
        applyMigration() {
          assert.deepEqual(attestDatabase("catalogue-before-seed-migration"), database);
          assert.deepEqual(migrationHistory("catalogue-before-seed-history"), plan.policyPlan.versions);
          supabase("catalogue-apply-seed-migration", ["migration", "up", "--local", "--yes"], 10 * 60_000);
          assert.deepEqual(attestDatabase("catalogue-after-seed-migration"), database);
          assert.deepEqual(migrationHistory("catalogue-after-seed-history"), plan.versions);
        },
        probeMigration(label, expectedConflict) {
          assert.ok(label === "catalogue-collision-probe" || label === "catalogue-idempotent-file-replay");
          assert.equal(label === "catalogue-collision-probe", Boolean(expectedConflict));
          assert.deepEqual(attestDatabase(`${label}-database-before`), database);
          const history = migrationHistory(`${label}-history-before`);
          assert.deepEqual(history, expectedConflict ? plan.policyPlan.versions : plan.versions);
          const input = readFileSync(join(workdir, catalogueSeedFile));
          assert.equal(sha(input), catalogueSeedSha);
          // The 151 KB reviewed file exceeds the per-argument limit on Linux.
          // Stream it to psql; no shell interpolation or SQL body in argv.
          const args = ["--host", dockerHost, "exec", "-i", "-e", "PGOPTIONS=-c statement_timeout=20000 -c lock_timeout=5000",
            database.container, "psql", "-X", "-q",
            "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres", "-f", "-"];
          const start = new Date().toISOString();
          const result = spawnSync(dockerExecutable, args, { cwd: root, env: localEnv,
            input, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"] });
          save(`${label}.log`, redact(`${result.stdout ?? ""}${result.stderr ?? ""}`));
          results.push({ label, executable: dockerExecutable, args, start, end: new Date().toISOString(),
            exit: result.status, signal: result.signal, error: result.error?.code ?? null,
            stdinFile: catalogueSeedFile, stdinSha: catalogueSeedSha, expectedSqlstate: expectedConflict ? "23505" : null });
          save("results.json", results);
          assertCatalogueMigrationResult(result, expectedConflict);
          assert.deepEqual(attestDatabase(`${label}-database-after`), database);
          assert.deepEqual(migrationHistory(`${label}-history-after`), history);
        },
      });
      supabase("catalogue-composed-upgraded-tests", ["test", "db", "--local"], 10 * 60_000);
    }
    if (workspaceUploadBrowserAcceptance) {
      await exerciseNewWorkspaceUploads({ root, project, workdir, env: localEnv, evidence, checkTarget, save,
        sqlSessionCommand() {
          checkTarget();
          return { executable: dockerExecutable, args: ["--host", dockerHost, "exec", "-i",
            "-e", "PGOPTIONS=-c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000",
            database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", "postgres", "-At", "-f", "-"] };
        },
        sql(label, query) {
          checkTarget();
          return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
            "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
        },
      });
      // Keep the original browser fixtures and proofs intact. The dormant
      // checkout boundary uses separate owners after those proofs complete.
      await exerciseBusinessCheckoutReservations({ root, project, workdir, env: localEnv, evidence, checkTarget, save,
        sqlSessionCommand() {
          checkTarget();
          return { executable: dockerExecutable, args: ["--host", dockerHost, "exec", "-i",
            "-e", "PGOPTIONS=-c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000",
            database.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", "postgres", "-At", "-f", "-"] };
        },
        sql(label, query) {
          checkTarget();
          return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
            "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
        },
      });
    }
    if (profileReadAcceptance) {
      await exerciseProfileReads({ project, workdir, env: localEnv, checkTarget, save,
        sql(label, query) {
          checkTarget();
          return command(label, dockerExecutable, ["--host", dockerHost, "exec", database.container,
            "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-c", query]);
        },
      });
    }
    assert.deepEqual(attestDatabase("database-after-tests"), database);
  }
} catch (error) {
  failed = true;
  save("failure.txt", `${redact(error.stack ?? String(error))}\n`);
} finally {
  if (attemptedStart) {
    try {
      checkTarget();
      const owned = ownResources(resources());
      save("resources-before-cleanup.json", owned);
      for (const kind of Object.keys(owned)) {
        assert(owned[kind].every((resource) => !initialResources[kind].includes(resource)));
      }
      // Both workdir and exact project ID are explicit. Never use --all/prune.
      supabase("cleanup", ["stop", "--project-id", project, "--no-backup", "--yes"], 5 * 60_000);
      const after = resources();
      save("resources-after.json", after);
      assert(Object.values(ownResources(after)).every((rows) => rows.length === 0));
      for (const kind of Object.keys(initialResources)) {
        assert(
          initialResources[kind].every((resource) => after[kind].includes(resource)),
          `Pre-existing ${kind} changed`,
        );
      }
    } catch (error) {
      failed = true;
      save("cleanup-failure.txt", `${redact(error.stack ?? String(error))}\n`);
    }
  }
  // Resource-heavy gates remain sequential, after the disposable stack stops.
  if (!preflightOnly && sourceBefore && (!(uploadSourceAcceptance || catalogueUpgradeAcceptance || legacyAuditUpgradeAcceptance || legacyWorkspaceCoreUpgradeAcceptance) || attemptedStart) &&
      !existsSync(join(evidence, "cleanup-failure.txt"))) {
    try {
      command("web-gate", "pnpm", ["verify:web"], 10 * 60_000);
    } catch (error) {
      failed = true;
      save("web-failure.txt", `${redact(error.stack ?? String(error))}\n`);
    }
  }
  try {
    if (sourceBefore) {
      assert.equal(sha(readFileSync(new URL(import.meta.url))), runnerSha, "Runner changed");
      assert.equal(sha(readFileSync(profileProbeUrl)), profileProbeSha, "Profile probe changed");
      assert.equal(sha(readFileSync(sourceProbeUrl)), sourceProbeSha, "Upload source probe changed");
      assert.equal(sha(readFileSync(resetGuardUrl)), resetGuardSha, "Disposable reset guard changed");
      assert.equal(sha(readFileSync(sqlScopeUrl)), sqlScopeSha, "Upload SQL scope guard changed");
      assert.equal(sha(readFileSync(sqlScopeTestUrl)), sqlScopeTestSha, "Upload SQL scope tests changed");
      assert.equal(sha(readFileSync(sourceManifestUrl)), sourceManifestSha, "Source manifest fixture changed");
      assert.equal(sha(readFileSync(sourceFixtureUrl)), sourceFixtureSha, "Source archive fixture changed");
      for (const input of v3Inputs) assert.equal(sha(readFileSync(input.url)), input.sha256, `V3 input changed: ${input.target}`);
      if (manifest && configHash) checkTarget();
      const after = sourceIdentity("source-after");
      save("source-after.sha256.json", after);
      assert.deepEqual(after, sourceBefore, "Source changed during DB verification");
      assert.equal(command("head-after", "git", ["rev-parse", "HEAD"]), head);
      command("tracked-after", "git", ["diff", "--binary", "HEAD"]);
      assert.equal(
        readFileSync(join(evidence, "tracked-after.log"), "utf8"),
        readFileSync(join(evidence, "tracked-before.log"), "utf8"),
      );
      command("diff-check", "git", ["diff", "--check"]);
    }
  } catch (error) {
    failed = true;
    save("source-failure.txt", `${redact(error.stack ?? String(error))}\n`);
  }
  save("summary.json", {
    runId,
    project,
    workdir,
    evidence,
    passed: !failed,
    uploadSqlScope: uploadSqlScope ?? null,
    v3UpgradePlan: v3UpgradePlan ?? null,
    rtfAliasUpgradePlan: rtfAliasUpgradePlan ?? null,
    fallbackUpgradePlan: fallbackUpgradePlan ?? null,
    sourceImportUpgradePlan: sourceImportUpgradePlan ?? null,
    workspaceReadUpgradePlan: workspaceReadUpgradePlan ?? null,
    workspaceBrowserAcceptance,
    workspaceUploadBrowserAcceptance,
    legacyPolicyUpgradeAcceptance,
    legacyPolicyUpgradePlan: legacyPolicyUpgradePlan ?? null,
    catalogueUpgradeAcceptance,
    catalogueUpgradePlan: catalogueUpgradePlan ?? null,
    legacyAuditUpgradeAcceptance,
    legacyAuditUpgradePlan: legacyAuditUpgradePlan ?? null,
    legacyWorkspaceCoreUpgradeAcceptance,
    legacyWorkspaceCoreUpgradePlan: legacyWorkspaceCoreUpgradePlan ?? null,
    hostedLedgerUpgradeAcceptance,
    hostedLedgerUpgradePlan: hostedLedgerUpgradePlan ?? null,
    sourceImportAcceptance,
    uploadFallbackAcceptance,
    scope: preflightOnly
      ? "Preflight only; no database/service mutation or web gate"
      : hostedLedgerUpgradeAcceptance
        ? "All-current fresh SQL and observed migration-ledger upgrade through the current reviewed release on an identified disposable database; exact baseline and final version identities are recorded in hostedLedgerUpgradePlan. Two authenticated owners, historical workspace receipt replay, exact row preservation, owned reads and original DOCX bytes. Reviewed repository migration bodies, not a hosted schema clone. No live provider, hosted mutation, browser, format-preserving edit or generated export proof."
      : legacyWorkspaceCoreUpgradeAcceptance
        ? "All-current fresh SQL and historical workspace save-core upgrade through the current reviewed release on an identified disposable database; exact predecessor and final version identities are recorded in legacyWorkspaceCoreUpgradePlan. Real local Auth/PostgREST, unchanged public function identity/permissions, historical receipts and independent workspace reads. No generation finalizer, live provider, browser, approval/export or hosted proof."
      : legacyAuditUpgradeAcceptance
        ? "All-current fresh SQL and exact140000-to150000 audit-binding upgrade on an identified disposable database; real local Auth/PostgREST, historical literal replay and independent old-row preservation. No live provider, browser, final workspace attachment, approval/export or hosted proof."
      : catalogueUpgradeAcceptance
        ? "Exact reviewed all-current fresh SQL, unchanged124000-to-130000 policy upgrade followed by130000-to-140000 catalogue seeds; real local Auth/PostgREST, independent history/persistence, exact collision and file replay. No browser, provider, export or hosted proof."
      : legacyPolicyUpgradeAcceptance
        ? "All-current fresh SQL and exact124000-to-130000 policy-binding upgrade; real local Auth/PostgREST and independent reservation/result/claim/usage reads. Historical receipts and policy-bound retry identity checked. No live provider, browser, generated wording or hosted proof."
      : workspaceUploadBrowserAcceptance
        ? "All-current fresh SQL and actual chooser/browser/production-entrypoint integration with real local Auth/RPC/Storage and controlled Responses. No hosted, live-model, preserving edit or export proof."
      : workspaceBrowserAcceptance
        ? "All-current fresh and exact112000-to124000 upgrade SQL; real local Auth/PostgREST/Storage owner reads and original bytes, plus production-mode local browser login, source reopen/reload/download and account change. Controlled extraction fixtures; no file picker, provider, preserving editing, generated export or hosted proof."
      : sourceImportAcceptance
        ? "All-current fresh and exact102000-to-112000 source import upgrade SQL; real local Auth/PostgREST/Storage. Historical protected v3 and null-version imports preserved; exact authenticated import/replay, denied source reconstruction and original bytes checked. Controlled extraction/classification; no browser, model, preserving editor, generated export or hosted proof."
      : uploadFallbackAcceptance
        ? "All-current fresh and exact94500-to-102000 upgrade SQL; real local Auth/PostgREST/Storage and provider-accounting RPCs. Same pending v2 DOCX/v3 RTF requests recover with unchanged provider receipts, usage and original bytes. Synthetic provider receipts and extraction fixtures; no actual model, Edge, browser, editing, export or hosted proof."
      : uploadRtfAliasAcceptance
        ? "All-current fresh and exact v3-to-RTF-alias upgrade SQL; real local Auth/PostgREST/Storage. Same pending alias identity recovers; settled failure remains unchanged. Controlled extraction/classification, no Edge, provider, browser, editing, export or hosted proof."
      : uploadSourceV3Acceptance
        ? "All-current fresh and v3 historical-upgrade SQL, real local Auth/PostgREST and original-byte Storage acceptance. Controlled extraction/classification fixtures; no Edge, provider, browser, format-preserving editing, export or hosted proof."
      : uploadSourceAcceptance
        ? "Exact upload SQL slice: 70 migrations and 37 tests from the pinned RED inputs plus reviewed clock fix; later SQL is recorded separately and excluded only from this slice. Fresh and historical upgrade on an identified disposable DB with real local Auth/PostgREST source checkpoint acceptance. Full current SQL, hosted, Storage, browser, provider and editing/export acceptance remain unverified."
      : profileReadAcceptance
        ? "Fresh disposable SQL plus real local Auth/PostgREST Profile permission-upgrade acceptance; no browser, hosted or provider proof"
        : "Fresh disposable SQL baseline only; no upgrade, browser, hosted or provider proof",
    results,
  });
  console.log(JSON.stringify({ runId, project, evidence, passed: !failed }));
  process.exitCode = failed ? 1 : 0;
}
