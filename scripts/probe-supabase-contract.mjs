#!/usr/bin/env node
// Live counterpart to scripts/check-deployment-contract.mjs. Where that
// script validates the *static* contract (manifest vs. repo files), this
// script validates the *live* schema of a target Supabase project against
// supabase/deployment-contract.json, right before Edge Functions are
// deployed to it. This is the step that would have caught `clarify` being
// deployable ahead of the migration that defines `consume_rate_limit`.
//
// Metadata only: this script never reads or prints row data, connection
// strings, or the value of any secret. It reports pass/fail per declared
// RPC, table, and migration version, plus a short reason on failure. The
// service-role key and access token are used only as outgoing request
// headers / CLI environment, never logged.
//
// Inputs (environment variables):
//   SUPABASE_URL               e.g. https://<ref>.supabase.co (required)
//   SUPABASE_SERVICE_ROLE_KEY  used as the apikey/Authorization header (required)
//   SUPABASE_PROJECT_REF       optional; cross-checked against SUPABASE_URL
//                              and deployment-contract.json's projectRef
//   SUPABASE_MIGRATION_CHECK   "skip" to skip the migration-ledger check
//                              (e.g. for a project the CLI can't link to);
//                              defaults to running it via `supabase migration
//                              list --linked`, which must be run after
//                              `supabase link` in the calling workflow.
//   SUPABASE_PROBE_MODE        "schema" (default) runs the pre-deploy check
//                              above. "smoke" runs the *post-deploy* smoke
//                              probe instead: for each active function, it
//                              checks the function's own declared
//                              `smokeProbe` (an RPC or table it names, via
//                              the same metadata-only OpenAPI lookup -- never
//                              invoked, since e.g. consume_rate_limit has
//                              side effects) plus a safe OPTIONS reachability
//                              ping against the function's live URL. This is
//                              what the "Smoke-probe deployed functions" step
//                              in deploy-prod.yml runs.
//
// Exit code is non-zero on any failure -- including missing required
// environment variables. This script fails closed: it never silently skips
// a check because a secret was absent.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CONTRACT_PATH = "supabase/deployment-contract.json";

export async function loadManifest(repoRoot) {
  const raw = await readFile(`${repoRoot}/${CONTRACT_PATH}`, "utf8");
  return JSON.parse(raw);
}

export function effectiveRequirements(manifest, functionName) {
  const entry = manifest.functions?.[functionName];
  if (!entry) return null;

  const migrations = new Set(entry.requiredMigrations ?? []);
  const rpcs = new Set(entry.requiredRpcs ?? []);
  const tables = new Set(entry.requiredTables ?? []);

  if (entry.usesSharedRequestGuard && manifest.sharedRequestGuard) {
    for (const m of manifest.sharedRequestGuard.requiredMigrations ?? []) migrations.add(m);
    for (const r of manifest.sharedRequestGuard.requiredRpcs ?? []) rpcs.add(r);
    for (const t of manifest.sharedRequestGuard.requiredTables ?? []) tables.add(t);
  }

  return { migrations: [...migrations], rpcs: [...rpcs], tables: [...tables] };
}

// PostgREST's root document (GET /rest/v1/) is an OpenAPI-style description
// of every table/view/function exposed through the API. Reading it is a
// metadata-only operation -- it never touches row data -- and is enough to
// prove a table or RPC exists and is reachable.
export function parseOpenApiPaths(openApiDoc) {
  const paths = openApiDoc?.paths ?? {};
  const tables = new Set();
  const rpcs = new Set();
  for (const path of Object.keys(paths)) {
    const match = path.match(/^\/rpc\/([A-Za-z0-9_]+)$/);
    if (match) {
      rpcs.add(match[1]);
      continue;
    }
    const tableMatch = path.match(/^\/([A-Za-z0-9_]+)$/);
    if (tableMatch) tables.add(tableMatch[1]);
  }
  return { tables, rpcs };
}

export function validateSupabaseUrl(supabaseUrl, expectedProjectRef) {
  if (!/^[a-z0-9]{20}$/.test(expectedProjectRef ?? "")) {
    throw new Error("Supabase project reference is missing or invalid.");
  }

  let target;
  try {
    target = new URL(supabaseUrl);
  } catch {
    throw new Error("Supabase URL is malformed.");
  }

  const expectedHostname = `${expectedProjectRef}.supabase.co`;
  if (target.protocol !== "https:") {
    throw new Error("Supabase URL must use HTTPS.");
  }
  if (target.username || target.password) {
    throw new Error("Supabase URL must not contain user information.");
  }
  if (target.port) {
    throw new Error("Supabase URL must not contain a custom port.");
  }
  if (target.hostname !== expectedHostname) {
    throw new Error(
      `Supabase URL hostname must exactly match the approved project "${expectedHostname}".`,
    );
  }
  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error("Supabase URL must be the canonical project origin without a path, query, or fragment.");
  }

  return target;
}

export function validateProbeTarget({
  supabaseUrl,
  manifestProjectRef,
  environmentProjectRef,
}) {
  if (!/^[a-z0-9]{20}$/.test(manifestProjectRef ?? "")) {
    throw new Error("deployment-contract.json projectRef is missing or invalid.");
  }
  if (
    environmentProjectRef &&
    environmentProjectRef !== manifestProjectRef
  ) {
    throw new Error(
      `SUPABASE_PROJECT_REF ("${environmentProjectRef}") does not match ` +
        `deployment-contract.json projectRef ("${manifestProjectRef}").`,
    );
  }

  return validateSupabaseUrl(supabaseUrl, manifestProjectRef);
}

export function requiredProbeEnvironmentVariables({
  probeMode,
  supabaseUrl,
  serviceRoleKey,
  projectRef,
}) {
  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (probeMode !== "target" && !serviceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  return missing;
}

export async function fetchOpenApiDoc(
  supabaseUrl,
  serviceRoleKey,
  { expectedProjectRef, fetchImpl = fetch } = {},
) {
  const target = validateSupabaseUrl(supabaseUrl, expectedProjectRef);
  const metadataUrl = new URL("/rest/v1/", target).href;
  const response = await fetchImpl(metadataUrl, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) {
    // Never echo the response body: it can carry PostgREST error detail
    // that includes schema internals we don't want in CI logs either.
    throw new Error(`PostgREST metadata request failed with HTTP ${response.status}`);
  }
  return response.json();
}

// Parses `supabase migration list --linked` output. That command prints a
// pipe-delimited table of (LOCAL, REMOTE, TIME) migration timestamps; a
// migration is "applied live" only when its timestamp appears in the REMOTE
// column -- a migration can be present locally and absent remotely, which is
// exactly the "deployed ahead of its migration" bug this script exists to
// catch, so the LOCAL column must never be treated as evidence of anything.
export function parseAppliedMigrationVersions(cliOutput) {
  const versions = new Set();
  for (const line of cliOutput.split("\n")) {
    const columns = line.split("|");
    if (columns.length < 2) continue;
    const remote = columns[1].trim();
    const match = remote.match(/^(\d{14})$/);
    if (match) versions.add(match[1]);
  }
  return versions;
}

export async function fetchAppliedMigrationVersions({ execFileImpl = execFileAsync } = {}) {
  const { stdout } = await execFileImpl("supabase", ["migration", "list", "--linked"]);
  return parseAppliedMigrationVersions(stdout);
}

export function validateLiveSchema({ manifest, appliedMigrations, openApiTables, openApiRpcs }) {
  const failures = [];
  const checks = [];

  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    const requirements = effectiveRequirements(manifest, name);

    for (const migration of requirements.migrations) {
      const timestamp = migration.match(/^(\d{14})/)?.[1];
      const applied = timestamp ? appliedMigrations.has(timestamp) : false;
      checks.push({ function: name, kind: "migration", name: migration, ok: applied });
      if (!applied) {
        failures.push(`Function "${name}" requires migration "${migration}" which is not applied on the live project.`);
      }
    }

    for (const rpc of requirements.rpcs) {
      const ok = openApiRpcs.has(rpc);
      checks.push({ function: name, kind: "rpc", name: rpc, ok });
      if (!ok) {
        failures.push(`Function "${name}" requires RPC "${rpc}" which is not exposed by the live project's schema.`);
      }
    }

    for (const table of requirements.tables) {
      const ok = openApiTables.has(table);
      checks.push({ function: name, kind: "table", name: table, ok });
      if (!ok) {
        failures.push(`Function "${name}" requires table "${table}" which is not exposed by the live project's schema.`);
      }
    }
  }

  const webRequirements = manifest.webRequirements ?? {};
  for (const migration of webRequirements.requiredMigrations ?? []) {
    const timestamp = migration.match(/^(\d{14})/)?.[1];
    const applied = timestamp ? appliedMigrations.has(timestamp) : false;
    checks.push({ function: "web", kind: "migration", name: migration, ok: applied });
    if (!applied) {
      failures.push(
        `Web application requires migration "${migration}" which is not applied on the live project.`,
      );
    }
  }
  for (const rpc of webRequirements.requiredRpcs ?? []) {
    const ok = openApiRpcs.has(rpc);
    checks.push({ function: "web", kind: "rpc", name: rpc, ok });
    if (!ok) {
      failures.push(
        `Web application requires RPC "${rpc}" which is not exposed by the live project's schema.`,
      );
    }
  }
  for (const table of webRequirements.requiredTables ?? []) {
    const ok = openApiTables.has(table);
    checks.push({ function: "web", kind: "table", name: table, ok });
    if (!ok) {
      failures.push(
        `Web application requires table "${table}" which is not exposed by the live project's schema.`,
      );
    }
  }

  return { failures, checks };
}

// ---- per-function smoke probes (post-deploy) --------------------------------

// One entry per active function, taken directly from its manifest-declared
// `smokeProbe`. This is what makes that field load-bearing instead of
// decorative: the probe actually run for a function is whatever its own
// entry names, not a one-size-fits-all check.
export function buildSmokeProbePlan(manifest) {
  const plan = [];
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    plan.push({
      function: name,
      kind: entry.smokeProbe?.kind ?? "none",
      name: entry.smokeProbe?.name ?? null,
    });
  }
  return plan;
}

// Confirms the function's declared smoke-probe target still exists in the
// live schema. Deliberately metadata-only (existence via the OpenAPI
// document), never an actual invocation: several of these RPCs (e.g.
// consume_rate_limit) have real side effects, and a smoke test must not
// mutate production state to run.
export function evaluateDeclaredSmokeProbe(probe, { openApiTables, openApiRpcs }) {
  if (probe.kind === "rpc") {
    return { ok: openApiRpcs.has(probe.name), detail: `rpc "${probe.name}"` };
  }
  if (probe.kind === "table") {
    return { ok: openApiTables.has(probe.name), detail: `table "${probe.name}"` };
  }
  return { ok: true, detail: "no schema-level smoke probe declared" };
}

export async function pingFunctionEndpoint(supabaseUrl, functionName, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`, {
    method: "OPTIONS",
  });
  return { status: response.status, ok: response.status < 500 };
}

export async function runFunctionSmokeProbes({ manifest, supabaseUrl, openApiTables, openApiRpcs, fetchImpl = fetch }) {
  const checks = [];
  const failures = [];

  for (const probe of buildSmokeProbePlan(manifest)) {
    const declared = evaluateDeclaredSmokeProbe(probe, { openApiTables, openApiRpcs });
    checks.push({ function: probe.function, kind: probe.kind, name: probe.name, ok: declared.ok });
    if (!declared.ok) {
      failures.push(
        `Function "${probe.function}"'s declared smoke probe (${declared.detail}) is not present on the live project.`,
      );
    }

    const ping = await pingFunctionEndpoint(supabaseUrl, probe.function, { fetchImpl });
    checks.push({ function: probe.function, kind: "endpoint", name: probe.function, ok: ping.ok, status: ping.status });
    if (!ping.ok) {
      failures.push(`Function "${probe.function}" smoke probe returned HTTP ${ping.status}.`);
    }
  }

  return { checks, failures };
}

async function runSmokeProbeMode({ manifest, supabaseUrl, serviceRoleKey }) {
  let openApiDoc;
  try {
    openApiDoc = await fetchOpenApiDoc(supabaseUrl, serviceRoleKey, {
      expectedProjectRef: manifest.projectRef,
    });
  } catch (error) {
    console.error(`Function smoke probe failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { tables: openApiTables, rpcs: openApiRpcs } = parseOpenApiPaths(openApiDoc);

  const { checks, failures } = await runFunctionSmokeProbes({ manifest, supabaseUrl, openApiTables, openApiRpcs });

  for (const check of checks) {
    const label = check.kind === "endpoint" ? `endpoint (HTTP ${check.status})` : `${check.kind} "${check.name}"`;
    console.log(`[${check.ok ? "pass" : "fail"}] ${check.function}: ${label}`);
  }

  if (failures.length > 0) {
    console.error("\nFunction smoke probe failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nFunction smoke probe passed (${checks.length} checks).`);
}

async function main() {
  const repoRoot = process.cwd();
  const manifest = await loadManifest(repoRoot);

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  const skipMigrationCheck = process.env.SUPABASE_MIGRATION_CHECK?.trim() === "skip";
  const probeMode = process.env.SUPABASE_PROBE_MODE?.trim() || "schema";

  const missing = requiredProbeEnvironmentVariables({
    probeMode,
    supabaseUrl,
    serviceRoleKey,
    projectRef,
  });
  if (missing.length > 0) {
    console.error(`Live schema probe cannot run: missing required environment variable(s): ${missing.join(", ")}.`);
    console.error("Refusing to deploy without a live schema probe (fail closed, not skip).");
    process.exitCode = 1;
    return;
  }

  let validatedTarget;
  try {
    validatedTarget = validateProbeTarget({
      supabaseUrl,
      manifestProjectRef: manifest.projectRef,
      environmentProjectRef: projectRef,
    });
  } catch (error) {
    console.error(`Live schema probe target validation failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const validatedSupabaseUrl = validatedTarget.origin;

  if (probeMode === "target") {
    console.log(`Deployment target validation passed for ${validatedSupabaseUrl}.`);
    return;
  }
  if (probeMode === "smoke") {
    await runSmokeProbeMode({
      manifest,
      supabaseUrl: validatedSupabaseUrl,
      serviceRoleKey,
    });
    return;
  }
  if (probeMode !== "schema") {
    console.error(
      `Unknown SUPABASE_PROBE_MODE "${probeMode}". Expected "target", "schema", or "smoke".`,
    );
    process.exitCode = 1;
    return;
  }

  let openApiDoc;
  try {
    openApiDoc = await fetchOpenApiDoc(validatedSupabaseUrl, serviceRoleKey, {
      expectedProjectRef: manifest.projectRef,
    });
  } catch (error) {
    console.error(`Live schema probe failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { tables: openApiTables, rpcs: openApiRpcs } = parseOpenApiPaths(openApiDoc);

  let appliedMigrations = new Set();
  if (!skipMigrationCheck) {
    try {
      appliedMigrations = await fetchAppliedMigrationVersions();
    } catch (error) {
      console.error(`Live migration ledger probe failed: ${error.message}`);
      console.error("Set SUPABASE_MIGRATION_CHECK=skip only if this project is intentionally unlinked.");
      process.exitCode = 1;
      return;
    }
  }

  const { failures, checks } = validateLiveSchema({ manifest, appliedMigrations, openApiTables, openApiRpcs });

  for (const check of checks) {
    console.log(`[${check.ok ? "pass" : "fail"}] ${check.function}: ${check.kind} "${check.name}"`);
  }

  if (failures.length > 0) {
    console.error("\nLive schema probe failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nLive schema probe passed (${checks.length} checks across ${Object.keys(manifest.functions ?? {}).length} functions).`);
}

const isMainModule = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((error) => {
    console.error("Live schema probe crashed:", error.message);
    process.exitCode = 1;
  });
}
