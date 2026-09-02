#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import {
  fetchHostedFunctionInventory,
  fetchHostedInventory,
  fetchPreMigrationLedger,
  loadManifest,
  validateHostedInventory,
  validateProbeTarget,
} from "./probe-supabase-contract.mjs";

const BASELINE_CONTRACT = "prompted.backend-release-baseline.v1";
const REPORT_CONTRACT = "prompted.backend-release-report.v1";
const MAX_BASELINE_BYTES = 32 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const MIGRATION_NAME_PATTERN = /^\d{14}_[a-z0-9_]+[.]sql$/;

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error("Release evidence contains undefined data.");
      output[key] = canonicalValue(value[key]);
    }
    return output;
  }
  throw new Error("Release evidence contains unsupported data.");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalSha256(value) {
  return sha256(canonicalJson(value));
}

function exactString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value;
}

function migrationVersions(values, label) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || !/^\d{14}$/.test(value))
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return [...values];
}

function normalizedFunctions(values) {
  if (!Array.isArray(values) || values.length > 500) {
    throw new Error("Hosted function evidence is invalid.");
  }
  const functions = values.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.name !== "string" ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.name) ||
      (entry.status !== null && typeof entry.status !== "string") ||
      (entry.version !== null &&
        typeof entry.version !== "string" &&
        typeof entry.version !== "number") ||
      (entry.verifyJwt !== null && typeof entry.verifyJwt !== "boolean")
    ) {
      throw new Error("Hosted function evidence is invalid.");
    }
    return {
      name: entry.name,
      status: entry.status ?? null,
      version: entry.version ?? null,
      verify_jwt: entry.verifyJwt ?? null,
    };
  });
  functions.sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(functions.map((entry) => entry.name)).size !== functions.length) {
    throw new Error("Hosted function evidence contains duplicate names.");
  }
  return functions;
}

function normalizedMigrations(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 500) {
    throw new Error("Migration source evidence is invalid.");
  }
  const migrations = values.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.name !== "string" ||
      !MIGRATION_NAME_PATTERN.test(entry.name) ||
      typeof entry.contents !== "string" ||
      entry.contents.length === 0 ||
      Buffer.byteLength(entry.contents, "utf8") > 4 * 1024 * 1024
    ) {
      throw new Error("Migration source evidence is invalid.");
    }
    return { name: entry.name, sha256: sha256(entry.contents) };
  });
  migrations.sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(migrations.map((entry) => entry.name)).size !== migrations.length) {
    throw new Error("Migration source evidence contains duplicate names.");
  }
  return migrations;
}

function assertEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Backend release evidence is invalid.");
  }
  exactString(evidence.project_ref, PROJECT_REF_PATTERN, "Backend project reference");
  exactString(evidence.git_sha, GIT_SHA_PATTERN, "Backend Git revision");
  for (const field of [
    "deployment_contract_sha256",
    "migration_sources_sha256",
    "migration_ledger_sha256",
    "inventory_sha256",
    "hosted_functions_sha256",
  ]) {
    exactString(evidence[field], SHA256_PATTERN, `Backend evidence ${field}`);
  }
  return evidence;
}

export function createBackendReleaseEvidence({
  projectRef,
  gitSha,
  deploymentContract,
  migrations,
  migrationLedger,
  inventory,
  hostedFunctions,
}) {
  exactString(projectRef, PROJECT_REF_PATTERN, "Backend project reference");
  exactString(gitSha, GIT_SHA_PATTERN, "Backend Git revision");
  if (
    typeof deploymentContract !== "string" ||
    deploymentContract.length === 0 ||
    Buffer.byteLength(deploymentContract, "utf8") > 1024 * 1024
  ) {
    throw new Error("Deployment contract evidence is invalid.");
  }
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("Hosted inventory evidence is invalid.");
  }
  const localVersions = migrationVersions(migrationLedger?.localVersions, "Local migration ledger");
  const remoteVersions = migrationVersions(
    migrationLedger?.remoteVersions,
    "Hosted migration ledger",
  );
  return {
    project_ref: projectRef,
    git_sha: gitSha,
    deployment_contract_sha256: sha256(deploymentContract),
    migration_sources_sha256: canonicalSha256(normalizedMigrations(migrations)),
    migration_ledger_sha256: canonicalSha256({
      local_versions: localVersions,
      remote_versions: remoteVersions,
    }),
    inventory_sha256: canonicalSha256(inventory),
    hosted_functions_sha256: canonicalSha256(normalizedFunctions(hostedFunctions)),
  };
}

export function createBackendReleaseBaseline(evidence) {
  const checked = assertEvidence({ ...evidence });
  const body = {
    contract: BASELINE_CONTRACT,
    schema_version: 1,
    project_ref: checked.project_ref,
    git_sha: checked.git_sha,
    deployment_contract_sha256: checked.deployment_contract_sha256,
    migration_sources_sha256: checked.migration_sources_sha256,
    migration_ledger_sha256: checked.migration_ledger_sha256,
    inventory_sha256: checked.inventory_sha256,
    hosted_functions_sha256: checked.hosted_functions_sha256,
  };
  return { ...body, baseline_sha256: canonicalSha256(body) };
}

function assertBaseline(baseline) {
  if (
    !baseline ||
    typeof baseline !== "object" ||
    Array.isArray(baseline) ||
    baseline.contract !== BASELINE_CONTRACT ||
    baseline.schema_version !== 1
  ) {
    throw new Error("Backend release baseline is invalid.");
  }
  const expectedKeys = [
    "baseline_sha256",
    "contract",
    "deployment_contract_sha256",
    "git_sha",
    "hosted_functions_sha256",
    "inventory_sha256",
    "migration_ledger_sha256",
    "migration_sources_sha256",
    "project_ref",
    "schema_version",
  ];
  if (JSON.stringify(Object.keys(baseline).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error("Backend release baseline shape is invalid.");
  }
  const { baseline_sha256: suppliedSha256, ...body } = baseline;
  exactString(suppliedSha256, SHA256_PATTERN, "Backend baseline integrity hash");
  if (canonicalSha256(body) !== suppliedSha256) {
    throw new Error("Backend release baseline integrity check failed.");
  }
  assertEvidence(body);
  return baseline;
}

const DIMENSIONS = [
  ["git_sha", "repository_revision"],
  ["deployment_contract_sha256", "deployment_contract"],
  ["migration_sources_sha256", "migration_sources"],
  ["migration_ledger_sha256", "hosted_migration_ledger"],
  ["inventory_sha256", "hosted_inventory"],
  ["hosted_functions_sha256", "hosted_functions"],
];

export function verifyBackendReleaseBaseline(baseline, evidence) {
  const checkedBaseline = assertBaseline({ ...baseline });
  const checkedEvidence = assertEvidence({ ...evidence });
  if (checkedEvidence.project_ref !== checkedBaseline.project_ref) {
    throw new Error("Backend release baseline target does not match the current project.");
  }
  const changedDimensions = DIMENSIONS.filter(
    ([field]) => checkedEvidence[field] !== checkedBaseline[field],
  ).map(([, dimension]) => dimension);
  return changedDimensions.length === 0
    ? {
        ok: true,
        code: "BACKEND_RELEASE_BASELINE_UNCHANGED",
        changed_dimensions: [],
      }
    : {
        ok: false,
        code: "BACKEND_RELEASE_BASELINE_DRIFT",
        changed_dimensions: changedDimensions,
      };
}

export function createBackendReleaseReport({ baseline, result, inventoryFailureCodes = [] }) {
  const checkedBaseline = assertBaseline({ ...baseline });
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.ok !== "boolean" ||
    !Array.isArray(result.changed_dimensions) ||
    result.changed_dimensions.some(
      (value) => !DIMENSIONS.some(([, dimension]) => dimension === value),
    ) ||
    !Array.isArray(inventoryFailureCodes) ||
    inventoryFailureCodes.some((code) => typeof code !== "string" || !/^[A-Z0-9_]+$/.test(code))
  ) {
    throw new Error("Backend release report input is invalid.");
  }
  return {
    contract: REPORT_CONTRACT,
    schema_version: 1,
    baseline_sha256: checkedBaseline.baseline_sha256,
    state: result.ok && inventoryFailureCodes.length === 0 ? "unchanged" : "review_required",
    changed_dimensions: [...result.changed_dimensions],
    inventory_failure_codes: [...new Set(inventoryFailureCodes)].sort(),
    automatic_rollback_attempted: false,
    next_action: "stop_and_review_hosted_state",
  };
}

async function repositoryReleaseInputs(repoRoot) {
  const deploymentContract = await readFile(
    `${repoRoot}/supabase/deployment-contract.json`,
    "utf8",
  );
  const migrationDirectory = `${repoRoot}/supabase/migrations`;
  const names = (await readdir(migrationDirectory))
    .filter((name) => MIGRATION_NAME_PATTERN.test(name))
    .sort();
  const migrations = await Promise.all(
    names.map(async (name) => ({
      name,
      contents: await readFile(`${migrationDirectory}/${name}`, "utf8"),
    })),
  );
  return { deploymentContract, migrations };
}

export async function collectBackendReleaseEvidence({
  repoRoot,
  projectRef,
  supabaseUrl,
  gitSha,
  fetchMigrationLedger = fetchPreMigrationLedger,
  fetchInventory = fetchHostedInventory,
  fetchFunctions = fetchHostedFunctionInventory,
}) {
  const manifest = await loadManifest(repoRoot);
  validateProbeTarget({
    supabaseUrl,
    manifestProjectRef: manifest.projectRef,
    environmentProjectRef: projectRef,
  });
  const repository = await repositoryReleaseInputs(repoRoot);
  const [migrationLedger, inventory, hostedFunctions] = await Promise.all([
    fetchMigrationLedger({ projectRef }),
    fetchInventory({ projectRef, manifest }),
    fetchFunctions({ projectRef }),
  ]);
  const localVersions = repository.migrations.map((entry) => entry.name.slice(0, 14));
  const fullLedger = { ...migrationLedger, localVersions };
  const validation = validateHostedInventory({
    manifest,
    migrationLedger: fullLedger,
    inventory,
    hostedFunctions,
    phase: "pre_migration",
  });
  return {
    evidence: createBackendReleaseEvidence({
      projectRef,
      gitSha,
      deploymentContract: repository.deploymentContract,
      migrations: repository.migrations,
      migrationLedger: fullLedger,
      inventory,
      hostedFunctions,
    }),
    inventoryFailureCodes: validation.failures.map((failure) => failure.code),
  };
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || index === argv.length - 1 || argv[index + 1].startsWith("--")) return null;
  if (argv.indexOf(name, index + 1) >= 0) throw new Error(`Duplicate ${name} argument.`);
  return argv[index + 1];
}

function baselinePath(argv) {
  const value = argumentValue(argv, "--path");
  if (!value || !isAbsolute(value) || !value.endsWith(".json")) {
    throw new Error("Baseline --path must be an absolute JSON file path.");
  }
  return value;
}

async function writeBaseline(path, baseline) {
  await lstat(dirname(path));
  const serialized = `${JSON.stringify(baseline, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_BASELINE_BYTES) {
    throw new Error("Backend release baseline exceeds its size limit.");
  }
  await writeFile(path, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(path, 0o400);
}

async function readBaseline(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_BASELINE_BYTES) {
    throw new Error("Backend release baseline file is invalid.");
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Backend release baseline file is invalid JSON.");
  }
  return assertBaseline(parsed);
}

async function main() {
  const mode = process.argv[2];
  if (!["capture", "verify", "report"].includes(mode)) {
    throw new Error("Expected capture, verify, or report mode.");
  }
  const path = baselinePath(process.argv.slice(3));
  const repoRoot = process.cwd();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const gitSha =
    argumentValue(process.argv.slice(3), "--git-sha") ?? process.env.GITHUB_SHA?.trim();
  const collected = await collectBackendReleaseEvidence({
    repoRoot,
    projectRef,
    supabaseUrl,
    gitSha,
  });

  if (mode === "capture") {
    if (collected.inventoryFailureCodes.length > 0) {
      throw new Error(
        `Hosted inventory blocked baseline capture: ${collected.inventoryFailureCodes.join(", ")}.`,
      );
    }
    await writeBaseline(path, createBackendReleaseBaseline(collected.evidence));
    console.log("Immutable backend release baseline captured; no hosted mutation was performed.");
    return;
  }

  const baseline = await readBaseline(path);
  const result = verifyBackendReleaseBaseline(baseline, collected.evidence);
  if (mode === "report") {
    console.log(
      JSON.stringify(
        createBackendReleaseReport({
          baseline,
          result,
          inventoryFailureCodes: collected.inventoryFailureCodes,
        }),
      ),
    );
    console.log("No automated rollback was attempted.");
    return;
  }

  if (!result.ok || collected.inventoryFailureCodes.length > 0) {
    console.error(
      JSON.stringify(
        createBackendReleaseReport({
          baseline,
          result,
          inventoryFailureCodes: collected.inventoryFailureCodes,
        }),
      ),
    );
    throw new Error("Backend release baseline changed; refusing database mutation.");
  }
  console.log("Backend release baseline is unchanged; no hosted mutation was performed.");
}

const isMainModule =
  process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((error) => {
    console.error(`Backend release baseline failed: ${error.message}`);
    process.exitCode = 1;
  });
}
