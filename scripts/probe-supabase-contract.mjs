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
//   SUPABASE_PROJECT_REF       required by inventory mode; otherwise optional.
//                              It is cross-checked against SUPABASE_URL and
//                              deployment-contract.json's projectRef.
//   Migration-ledger validation is mandatory and runs via `supabase migration
//   list --linked`; the caller must link the exact reviewed project first.
//   SUPABASE_PROBE_MODE        "inventory" runs a read-only, aggregate-only
//                              migration/data/Storage/function inventory before
//                              any hosted mutation. "schema" (default) runs the
//                              post-migration check above. "smoke" runs the
//                              *post-deploy* smoke
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

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const authenticatedRpcs = new Set(entry.requiredAuthenticatedRpcs ?? []);
  const tables = new Set(entry.requiredTables ?? []);
  const tablePrivileges = new Map();

  const mergeTablePrivileges = (requirements = {}) => {
    for (const [table, privileges] of Object.entries(requirements)) {
      const merged = tablePrivileges.get(table) ?? new Set();
      for (const privilege of privileges ?? []) merged.add(privilege);
      tablePrivileges.set(table, merged);
    }
  };
  mergeTablePrivileges(entry.requiredTablePrivileges);

  if (entry.usesSharedRequestGuard && manifest.sharedRequestGuard) {
    for (const m of manifest.sharedRequestGuard.requiredMigrations ?? []) migrations.add(m);
    for (const r of manifest.sharedRequestGuard.requiredRpcs ?? []) rpcs.add(r);
    for (const t of manifest.sharedRequestGuard.requiredTables ?? []) tables.add(t);
    mergeTablePrivileges(manifest.sharedRequestGuard.requiredTablePrivileges);
  }

  return {
    migrations: [...migrations],
    rpcs: [...rpcs],
    authenticatedRpcs: [...authenticatedRpcs],
    tables: [...tables],
    tablePrivileges: Object.fromEntries(
      [...tablePrivileges].map(([table, privileges]) => [table, [...privileges]]),
    ),
  };
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
    throw new Error(
      "Supabase URL must be the canonical project origin without a path, query, or fragment.",
    );
  }

  return target;
}

export function validateProbeTarget({ supabaseUrl, manifestProjectRef, environmentProjectRef }) {
  if (!/^[a-z0-9]{20}$/.test(manifestProjectRef ?? "")) {
    throw new Error("deployment-contract.json projectRef is missing or invalid.");
  }
  if (environmentProjectRef && environmentProjectRef !== manifestProjectRef) {
    throw new Error(
      `SUPABASE_PROJECT_REF ("${environmentProjectRef}") does not match ` +
        `deployment-contract.json projectRef ("${manifestProjectRef}").`,
    );
  }

  return validateSupabaseUrl(supabaseUrl, manifestProjectRef);
}

function validateTimeoutMs(timeoutMs, label) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error(label + " must be between 1 and 60000 milliseconds.");
  }
  return timeoutMs;
}

function isTimeoutError(error) {
  return (
    error instanceof Error &&
    (["AbortError", "TimeoutError"].includes(error.name) ||
      error.code === "ETIMEDOUT" ||
      error.killed === true)
  );
}

export function requiredProbeEnvironmentVariables({
  probeMode,
  supabaseUrl,
  serviceRoleKey,
  projectRef,
  manifest,
  environment = {},
}) {
  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!["target", "inventory", "post_function"].includes(probeMode) && !serviceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (["inventory", "post_function"].includes(probeMode)) {
    if (!projectRef) missing.push("SUPABASE_PROJECT_REF");
    if (!environment.SUPABASE_ACCESS_TOKEN?.trim()) missing.push("SUPABASE_ACCESS_TOKEN");
    if (!environment.SUPABASE_DB_PASSWORD?.trim()) missing.push("SUPABASE_DB_PASSWORD");
  }
  if (probeMode === "schema") {
    for (const variable of Object.values(
      manifest?.capacityAttestation?.fingerprintEnvironmentVariables ?? {},
    )) {
      if (!/^[0-9a-f]{64}$/.test(environment[variable]?.trim() ?? "")) {
        missing.push(variable);
      }
    }
    const routingContract = manifest?.routingAttestation;
    const routingVariables = [
      routingContract?.routingVersionEnvironmentVariable,
      routingContract?.evaluationSuiteEnvironmentVariable,
      ...Object.values(routingContract?.routes ?? {}).flatMap((route) => [
        route?.modelEnvironmentVariable,
        route?.evaluationFingerprintEnvironmentVariable,
      ]),
    ].filter((variable) => typeof variable === "string");
    for (const variable of routingVariables) {
      const value = environment[variable]?.trim() ?? "";
      const isFingerprint = variable.endsWith("_EVALUATION_FINGERPRINT");
      if (
        (isFingerprint && !/^[0-9a-f]{64}$/.test(value)) ||
        (!isFingerprint && !/^[a-z0-9][a-z0-9._-]{1,99}$/.test(value))
      ) {
        missing.push(variable);
      }
    }
  }
  return [...new Set(missing)];
}

export function assertMigrationLedgerCannotBeSkipped(value) {
  if (typeof value === "string" && value.trim() !== "") {
    throw new Error(
      "SUPABASE_MIGRATION_CHECK is unsupported; the production migration ledger gate cannot be skipped.",
    );
  }
}

export async function fetchOpenApiDoc(
  supabaseUrl,
  serviceRoleKey,
  { expectedProjectRef, fetchImpl = fetch, timeoutMs = 20_000 } = {},
) {
  const target = validateSupabaseUrl(supabaseUrl, expectedProjectRef);
  const validatedTimeoutMs = validateTimeoutMs(timeoutMs, "PostgREST metadata timeout");
  const metadataUrl = new URL("/rest/v1/", target).href;
  let response;
  try {
    response = await fetchImpl(metadataUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(validatedTimeoutMs),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "PostgREST metadata request timed out."
        : "PostgREST metadata request failed.",
    );
  }
  if (!response.ok) {
    // Never echo the response body: it can carry PostgREST error detail
    // that includes schema internals we don't want in CI logs either.
    throw new Error(`PostgREST metadata request failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("PostgREST metadata response was not valid JSON.");
  }
}

export function buildSchemaAttestationRequest(manifest) {
  const tables = new Set(manifest.webRequirements?.requiredTables ?? []);
  const rpcs = new Set(manifest.webRequirements?.requiredRpcs ?? []);

  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    const requirements = effectiveRequirements(manifest, name);
    for (const table of requirements.tables) tables.add(table);
    for (const rpc of requirements.rpcs) rpcs.add(rpc);
    for (const rpc of requirements.authenticatedRpcs) rpcs.add(rpc);
  }

  return {
    tables: [...tables].sort(),
    rpcs: [...rpcs].sort(),
  };
}

export async function fetchSchemaAttestation(
  supabaseUrl,
  serviceRoleKey,
  manifest,
  { fetchImpl = fetch, timeoutMs = 20_000 } = {},
) {
  const target = validateSupabaseUrl(supabaseUrl, manifest.projectRef);
  const rpc = manifest.schemaAttestation?.rpc;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(rpc ?? "")) {
    throw new Error("Release schema attestation RPC is missing or invalid.");
  }
  const validatedTimeoutMs = validateTimeoutMs(timeoutMs, "Schema attestation timeout");
  const request = buildSchemaAttestationRequest(manifest);
  let response;
  try {
    response = await fetchImpl(new URL(`/rest/v1/rpc/${rpc}`, target).href, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(validatedTimeoutMs),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_tables: request.tables, p_rpcs: request.rpcs }),
    });
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "Release schema attestation request timed out."
        : "Release schema attestation request failed.",
    );
  }
  if (!response.ok) {
    throw new Error(`Release schema attestation failed with HTTP ${response.status}.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Release schema attestation response was not valid JSON.");
  }
  return { payload, request };
}

export function buildCapacityAttestationRequest(manifest) {
  const contract = manifest.capacityAttestation;
  const rpc = contract?.rpc;
  const environment = contract?.environment;
  const fingerprintVariables = contract?.fingerprintEnvironmentVariables;
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(rpc ?? "") ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(environment ?? "") ||
    !fingerprintVariables ||
    typeof fingerprintVariables !== "object" ||
    Array.isArray(fingerprintVariables)
  ) {
    throw new Error("OpenAI capacity attestation contract is missing or invalid.");
  }
  const routes = Object.keys(fingerprintVariables).sort();
  if (
    routes.length !== 4 ||
    routes.join(",") !== ["deep", "fast", "research", "review"].join(",") ||
    Object.values(fingerprintVariables).some(
      (variable) => typeof variable !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(variable),
    )
  ) {
    throw new Error("OpenAI capacity attestation routes are invalid.");
  }
  return { rpc, environment, routes, fingerprintVariables };
}

export async function fetchCapacityAttestation(
  supabaseUrl,
  serviceRoleKey,
  manifest,
  { fetchImpl = fetch, timeoutMs = 20_000 } = {},
) {
  const target = validateSupabaseUrl(supabaseUrl, manifest.projectRef);
  const request = buildCapacityAttestationRequest(manifest);
  const validatedTimeoutMs = validateTimeoutMs(timeoutMs, "Capacity attestation timeout");
  let response;
  try {
    response = await fetchImpl(new URL(`/rest/v1/rpc/${request.rpc}`, target).href, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(validatedTimeoutMs),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_environment: request.environment,
        p_semantic_routes: request.routes,
      }),
    });
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "OpenAI capacity attestation request timed out."
        : "OpenAI capacity attestation request failed.",
    );
  }
  if (!response.ok) {
    throw new Error(`OpenAI capacity attestation failed with HTTP ${response.status}.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenAI capacity attestation response was not valid JSON.");
  }
  return { payload, request };
}

export function validateCapacityAttestation({ payload, request, environment = {} }) {
  const failures = [];
  const checks = [];
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.contract_version !== "openai-capacity-attestation.1" ||
    payload.environment !== request.environment ||
    !Array.isArray(payload.routes)
  ) {
    return { failures: ["OpenAI capacity attestation response shape is invalid."], checks };
  }
  const facts = new Map();
  for (const fact of payload.routes) {
    if (
      !fact ||
      typeof fact !== "object" ||
      Array.isArray(fact) ||
      typeof fact.semantic_route !== "string" ||
      facts.has(fact.semantic_route)
    ) {
      return { failures: ["OpenAI capacity attestation route facts are invalid."], checks };
    }
    facts.set(fact.semantic_route, fact);
  }
  if (facts.size !== request.routes.length || request.routes.some((route) => !facts.has(route))) {
    return { failures: ["OpenAI capacity attestation routes do not match the contract."], checks };
  }
  for (const route of request.routes) {
    const fact = facts.get(route);
    const expectedVariable = request.fingerprintVariables[route];
    const expectedFingerprint = environment[expectedVariable]?.trim() ?? "";
    const ok =
      fact.configured === true &&
      fact.enabled === true &&
      Number.isInteger(fact.config_revision) &&
      fact.config_revision > 0 &&
      /^[0-9a-f]{64}$/.test(fact.fingerprint ?? "") &&
      fact.fingerprint === expectedFingerprint;
    checks.push({ function: "release", kind: "OpenAI capacity", name: route, ok });
    if (!ok) {
      failures.push(
        `OpenAI capacity route "${route}" is missing, disabled, stale, or does not match its approved fingerprint.`,
      );
    }
  }
  return { failures, checks };
}

export function buildRoutingAttestationRequest(manifest) {
  const contract = manifest.routingAttestation;
  const rpc = contract?.rpc;
  const environment = contract?.environment;
  const routesContract = contract?.routes;
  const routingVersionEnvironmentVariable = contract?.routingVersionEnvironmentVariable;
  const evaluationSuiteEnvironmentVariable = contract?.evaluationSuiteEnvironmentVariable;
  const minimumValiditySeconds = contract?.minimumValiditySeconds;
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(rpc ?? "") ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(environment ?? "") ||
    !/^[A-Z][A-Z0-9_]{0,99}$/.test(routingVersionEnvironmentVariable ?? "") ||
    !/^[A-Z][A-Z0-9_]{0,99}$/.test(evaluationSuiteEnvironmentVariable ?? "") ||
    !Number.isInteger(minimumValiditySeconds) ||
    minimumValiditySeconds < 3_600 ||
    minimumValiditySeconds > 2_592_000 ||
    !routesContract ||
    typeof routesContract !== "object" ||
    Array.isArray(routesContract)
  ) {
    throw new Error("OpenAI routing attestation contract is missing or invalid.");
  }
  const routes = Object.keys(routesContract).sort();
  if (
    routes.length !== 4 ||
    routes.join(",") !== ["deep", "fast", "research", "review"].join(",")
  ) {
    throw new Error("OpenAI routing attestation routes are invalid.");
  }
  for (const route of routes) {
    const routeContract = routesContract[route];
    if (
      !routeContract ||
      typeof routeContract !== "object" ||
      Array.isArray(routeContract) ||
      !["low", "medium", "high"].includes(routeContract.reasoningEffort) ||
      !/^[A-Z][A-Z0-9_]{0,99}$/.test(routeContract.modelEnvironmentVariable ?? "") ||
      !/^[A-Z][A-Z0-9_]{0,99}$/.test(routeContract.evaluationFingerprintEnvironmentVariable ?? "")
    ) {
      throw new Error(`OpenAI routing attestation route "${route}" is invalid.`);
    }
  }
  return {
    rpc,
    environment,
    routes,
    routesContract,
    routingVersionEnvironmentVariable,
    evaluationSuiteEnvironmentVariable,
    minimumValiditySeconds,
  };
}

export async function fetchRoutingAttestation(
  supabaseUrl,
  serviceRoleKey,
  manifest,
  { fetchImpl = fetch, timeoutMs = 20_000 } = {},
) {
  const target = validateSupabaseUrl(supabaseUrl, manifest.projectRef);
  const request = buildRoutingAttestationRequest(manifest);
  const validatedTimeoutMs = validateTimeoutMs(timeoutMs, "Routing attestation timeout");
  let response;
  try {
    response = await fetchImpl(new URL(`/rest/v1/rpc/${request.rpc}`, target).href, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(validatedTimeoutMs),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_environment: request.environment,
        p_semantic_routes: request.routes,
      }),
    });
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "OpenAI routing attestation request timed out."
        : "OpenAI routing attestation request failed.",
    );
  }
  if (!response.ok) {
    throw new Error(`OpenAI routing attestation failed with HTTP ${response.status}.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenAI routing attestation response was not valid JSON.");
  }
  return { payload, request };
}

export function validateRoutingAttestation({
  payload,
  request,
  environment = {},
  now = new Date(),
}) {
  const failures = [];
  const checks = [];
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.contract_version !== "openai-routing-attestation.1" ||
    payload.environment !== request.environment ||
    !Array.isArray(payload.routes) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return { failures: ["OpenAI routing attestation response shape is invalid."], checks };
  }
  const facts = new Map();
  for (const fact of payload.routes) {
    if (
      !fact ||
      typeof fact !== "object" ||
      Array.isArray(fact) ||
      typeof fact.semantic_route !== "string" ||
      facts.has(fact.semantic_route)
    ) {
      return { failures: ["OpenAI routing attestation route facts are invalid."], checks };
    }
    facts.set(fact.semantic_route, fact);
  }
  if (facts.size !== request.routes.length || request.routes.some((route) => !facts.has(route))) {
    return { failures: ["OpenAI routing attestation routes do not match the contract."], checks };
  }
  const expectedRoutingVersion =
    environment[request.routingVersionEnvironmentVariable]?.trim() ?? "";
  const expectedEvaluationSuite =
    environment[request.evaluationSuiteEnvironmentVariable]?.trim() ?? "";
  const minimumExpiryMs = now.getTime() + request.minimumValiditySeconds * 1_000;
  for (const route of request.routes) {
    const fact = facts.get(route);
    const routeContract = request.routesContract[route];
    const expectedModel = environment[routeContract.modelEnvironmentVariable]?.trim() ?? "";
    const expectedFingerprint =
      environment[routeContract.evaluationFingerprintEnvironmentVariable]?.trim() ?? "";
    const evaluatedAt = Date.parse(fact.evaluated_at ?? "");
    const expiresAt = Date.parse(fact.expires_at ?? "");
    const ok =
      fact.configured === true &&
      fact.enabled === true &&
      Number.isInteger(fact.config_revision) &&
      fact.config_revision > 0 &&
      fact.model === expectedModel &&
      fact.reasoning_effort === routeContract.reasoningEffort &&
      fact.routing_version === expectedRoutingVersion &&
      fact.evaluation_suite_version === expectedEvaluationSuite &&
      /^[0-9a-f]{64}$/.test(fact.evaluated_configuration_sha256 ?? "") &&
      fact.evaluated_configuration_sha256 === expectedFingerprint &&
      Number.isFinite(evaluatedAt) &&
      Number.isFinite(expiresAt) &&
      evaluatedAt <= now.getTime() + 300_000 &&
      expiresAt >= minimumExpiryMs &&
      expiresAt > evaluatedAt;
    checks.push({ function: "release", kind: "OpenAI routing", name: route, ok });
    if (!ok) {
      failures.push(
        `OpenAI routing route "${route}" is missing, disabled, expired, or does not match its approved model and evaluation evidence.`,
      );
    }
  }
  return { failures, checks };
}

// Parses `supabase migration list --linked` output. That command prints a
// pipe-delimited table of (LOCAL, REMOTE, TIME) migration timestamps; a
// migration is "applied live" only when its timestamp appears in the REMOTE
// column -- a migration can be present locally and absent remotely, which is
// exactly the "deployed ahead of its migration" bug this script exists to
// catch, so the LOCAL column must never be treated as evidence of anything.
export function parseAppliedMigrationVersions(cliOutput) {
  return new Set(parseMigrationLedgerOutput(cliOutput).remoteVersions);
}

export async function fetchAppliedMigrationVersions({
  execFileImpl = execFileAsync,
  timeoutMs = 60_000,
} = {}) {
  const validatedTimeoutMs = validateTimeoutMs(timeoutMs, "Supabase migration list timeout");
  let result;
  try {
    result = await execFileImpl("supabase", ["migration", "list", "--linked"], {
      encoding: "utf8",
      timeout: validatedTimeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "Supabase migration list timed out."
        : "Supabase migration list failed.",
    );
  }
  if (typeof result?.stdout !== "string") {
    throw new Error("Supabase migration list returned invalid output.");
  }
  return parseAppliedMigrationVersions(result.stdout);
}

function validateProjectRef(projectRef) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? "")) {
    throw new Error("Supabase project reference is missing or invalid.");
  }
  return projectRef;
}

function cliExecutionOptions(timeoutMs, label) {
  return {
    encoding: "utf8",
    timeout: validateTimeoutMs(timeoutMs, label),
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    shell: false,
  };
}

export function parseMigrationLedgerOutput(cliOutput) {
  if (typeof cliOutput !== "string" || cliOutput.length > 1024 * 1024) {
    throw new Error("Hosted migration ledger response was invalid.");
  }
  const lines = cliOutput.replace(/\r\n?/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) => {
    const columns = line.split("|").map((column) => column.trim().toUpperCase());
    return (
      columns.length >= 3 &&
      columns[0] === "LOCAL" &&
      columns[1] === "REMOTE" &&
      columns[2] === "TIME"
    );
  });
  if (headerIndex < 0) {
    throw new Error("Hosted migration ledger response was unrecognizable.");
  }
  const rows = [];
  const localVersions = [];
  const remoteVersions = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() === "" || /^[-\s|+:]+$/.test(line)) continue;
    const columns = line.split("|");
    if (columns.length < 3) {
      throw new Error("Hosted migration ledger response contained an invalid row.");
    }
    const local = columns[0].trim();
    const remote = columns[1].trim();
    const localVersion = /^\d{14}$/.test(local) ? local : null;
    const remoteVersion = /^\d{14}$/.test(remote) ? remote : null;
    if (
      (local && !localVersion) ||
      (remote && !remoteVersion) ||
      (!localVersion && !remoteVersion)
    ) {
      throw new Error("Hosted migration ledger response contained an invalid version.");
    }
    rows.push({ localVersion, remoteVersion });
    if (localVersion) localVersions.push(localVersion);
    if (remoteVersion) remoteVersions.push(remoteVersion);
  }
  if (rows.length === 0) {
    throw new Error("Hosted migration ledger response contained no migration rows.");
  }
  return { rows, localVersions, remoteVersions };
}

export async function fetchPreMigrationLedger({
  projectRef,
  execFileImpl = execFileAsync,
  timeoutMs = 60_000,
} = {}) {
  const exactProjectRef = validateProjectRef(projectRef);
  let result;
  try {
    result = await execFileImpl(
      "supabase",
      ["migration", "list", "--project-ref", exactProjectRef],
      cliExecutionOptions(timeoutMs, "Hosted migration ledger timeout"),
    );
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "Hosted migration ledger query timed out."
        : "Hosted migration ledger query failed.",
    );
  }
  return parseMigrationLedgerOutput(result?.stdout);
}

function assertInventoryContract(manifest) {
  const contract = manifest?.preMigrationInventory;
  const assets = contract?.brandAssets;
  const validPolicyFingerprints = (policies) =>
    Array.isArray(policies) &&
    policies.length > 0 &&
    policies.every(
      (policy) =>
        /^[a-z][a-z0-9_]{0,62}$/.test(policy?.name ?? "") &&
        /^[0-9a-f]{64}$/.test(policy?.definitionSha256 ?? ""),
    ) &&
    new Set(policies.map((policy) => policy.name)).size === policies.length;
  if (
    contract?.contractVersion !== "prompted-release-inventory.2" ||
    !/^\d{14}$/.test(contract?.productionBaselineMigration ?? "") ||
    !/^\d{14}_[a-z0-9_]+$/.test(contract?.savedRoleMigration ?? "") ||
    !/^\d{14}_[a-z0-9_]+$/.test(contract?.brandAssetsCreationMigration ?? "") ||
    !/^\d{14}_[a-z0-9_]+$/.test(contract?.brandAssetsMigration ?? "") ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(assets?.bucketId ?? "") ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(assets?.name ?? "") ||
    typeof assets?.public !== "boolean" ||
    !Number.isSafeInteger(assets?.fileSizeLimit) ||
    assets.fileSizeLimit < 1 ||
    assets.fileSizeLimit > 10 * 1024 * 1024 ||
    !Array.isArray(assets?.allowedMimeTypes) ||
    assets.allowedMimeTypes.length === 0 ||
    assets.allowedMimeTypes.some((value) => !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value)) ||
    typeof assets?.objectPathPattern !== "string" ||
    assets.objectPathPattern.length > 500 ||
    /[';\\\r\n]/.test(assets.objectPathPattern) ||
    assets.objectPathPattern.includes("$asset_path$") ||
    !Array.isArray(assets?.policies) ||
    assets.policies.length === 0 ||
    assets.policies.some(
      (policy) =>
        !/^[a-z][a-z0-9_]{0,62}$/.test(policy?.name ?? "") ||
        !["PERMISSIVE", "RESTRICTIVE"].includes(policy?.mode) ||
        !["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"].includes(policy?.command) ||
        !Array.isArray(policy?.roles) ||
        policy.roles.some((role) => !/^[a-z][a-z0-9_]{0,62}$/.test(role)) ||
        !/^[0-9a-f]{64}$/.test(policy?.definitionSha256 ?? ""),
    ) ||
    !validPolicyFingerprints(assets?.predecessorPolicies) ||
    !validPolicyFingerprints(assets?.requiredUnrelatedPolicies) ||
    new Set(
      [...assets.policies, ...assets.predecessorPolicies, ...assets.requiredUnrelatedPolicies].map(
        (policy) => policy.name,
      ),
    ).size !==
      assets.policies.length +
        assets.predecessorPolicies.length +
        assets.requiredUnrelatedPolicies.length
  ) {
    throw new Error("Pre-migration inventory contract is missing or invalid.");
  }
  return contract;
}

function sqlTextArray(values) {
  return `array[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
}

/**
 * Builds one fixed, read-only snapshot query. The only data-dependent values
 * returned are aggregate counts; identifiers, titles, object paths, URLs and
 * document content never leave Postgres. The payload is hex-encoded so the
 * caller can locate one exact sentinel inside the CLI's untrusted-output
 * wrapper without interpolating database text into logs.
 */
export function buildHostedInventorySql(manifest) {
  const contract = assertInventoryContract(manifest);
  const assets = contract.brandAssets;
  const policyPredicate = (policy) =>
    `(policy_record.policyname = '${policy.name}' and ` +
    `policy_record.definition_sha256 = '${policy.definitionSha256}')`;
  const expectedPolicyPredicate = assets.policies.map(policyPredicate).join(" or ");
  const predecessorPolicyPredicate = assets.predecessorPolicies.map(policyPredicate).join(" or ");
  const unrelatedPolicyPredicate = assets.requiredUnrelatedPolicies
    .map(policyPredicate)
    .join(" or ");
  const anyAllowedPolicyPredicate = [
    expectedPolicyPredicate,
    predecessorPolicyPredicate,
    unrelatedPolicyPredicate,
  ]
    .map((predicate) => `(${predicate})`)
    .join(" or ");
  const allowedMimeTypes = [...assets.allowedMimeTypes].sort();

  return `with
query_limits as materialized (
  select
    pg_catalog.set_config('statement_timeout', '20s', true),
    pg_catalog.set_config('lock_timeout', '2s', true)
),
duplicate_saved_roles as materialized (
  select
    pg_catalog.count(*)::bigint as duplicate_groups,
    coalesce(pg_catalog.sum(group_record.row_count), 0)::bigint as duplicate_rows
  from (
    select pg_catalog.count(*)::bigint as row_count
    from public.saved_roles role_record
    where role_record.company_name is null
    group by role_record.user_id, role_record.role_title
    having pg_catalog.count(*) > 1
  ) group_record
),
assets_bucket as materialized (
  select
    pg_catalog.count(*)::bigint as bucket_count,
    pg_catalog.bool_and(bucket_record.public) as bucket_public,
    pg_catalog.bool_and(bucket_record.name = '${assets.name}') as name_matches,
    pg_catalog.max(bucket_record.file_size_limit)::bigint as file_size_limit,
    coalesce((
      select pg_catalog.jsonb_agg(mime_record.mime order by mime_record.mime)
      from (
        select distinct pg_catalog.unnest(mime_bucket.allowed_mime_types) as mime
        from storage.buckets mime_bucket
        where mime_bucket.id = '${assets.bucketId}'
      ) mime_record
    ), '[]'::jsonb) as allowed_mime_types
  from storage.buckets bucket_record
  where bucket_record.id = '${assets.bucketId}'
),
assets_objects as materialized (
  select object_record.name, object_record.metadata
  from storage.objects object_record
  where object_record.bucket_id = '${assets.bucketId}'
),
assets_object_facts as materialized (
  select
    pg_catalog.count(*)::bigint as object_count,
    pg_catalog.count(*) filter (
      where object_record.name !~ $asset_path$${assets.objectPathPattern}$asset_path$
    )::bigint as noncanonical_count,
    pg_catalog.count(*) filter (
      where object_record.name ~ $asset_path$${assets.objectPathPattern}$asset_path$
        and not exists (
          select 1 from public.businesses business_record
          where business_record.id = pg_catalog.split_part(object_record.name, '/', 2)::uuid
        )
    )::bigint as orphan_count,
    pg_catalog.count(*) filter (
      where case
        when coalesce(object_record.metadata->>'size', '') ~ '^[0-9]+$'
          then (object_record.metadata->>'size')::numeric > ${assets.fileSizeLimit}
        else true
      end
    )::bigint as oversized_count,
    pg_catalog.count(*) filter (
      where not (
        pg_catalog.lower(coalesce(object_record.metadata->>'mimetype', '')) = any (
          ${sqlTextArray(allowedMimeTypes)}
        )
      )
    )::bigint as unsupported_mime_count
  from assets_objects object_record
),
assets_duplicate_businesses as materialized (
  select pg_catalog.count(*)::bigint as duplicate_business_count
  from (
    select pg_catalog.split_part(object_record.name, '/', 2)
    from assets_objects object_record
    where object_record.name ~ $asset_path$${assets.objectPathPattern}$asset_path$
    group by pg_catalog.split_part(object_record.name, '/', 2)
    having pg_catalog.count(*) > 1
  ) duplicate_business
),
storage_policy_definitions as materialized (
  select
    policy_source.*,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          policy_source.policyname || pg_catalog.chr(31) ||
          policy_source.permissive || pg_catalog.chr(31) ||
          policy_source.cmd || pg_catalog.chr(31) ||
          policy_source.roles::text || pg_catalog.chr(31) ||
          pg_catalog.regexp_replace(coalesce(policy_source.qual, ''), '[[:space:]]+', ' ', 'g') ||
          pg_catalog.chr(31) ||
          pg_catalog.regexp_replace(coalesce(policy_source.with_check, ''), '[[:space:]]+', ' ', 'g'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as definition_sha256
  from pg_catalog.pg_policies policy_source
  where policy_source.schemaname = 'storage'
    and policy_source.tablename = 'objects'
),
assets_policy_facts as materialized (
  select
    pg_catalog.count(*) filter (
      where ${expectedPolicyPredicate}
    )::bigint as expected_policy_count,
    pg_catalog.count(*) filter (
      where ${predecessorPolicyPredicate}
    )::bigint as predecessor_policy_count,
    pg_catalog.count(*) filter (
      where ${unrelatedPolicyPredicate}
    )::bigint as expected_non_assets_policy_count,
    pg_catalog.count(*) filter (
      where not (${anyAllowedPolicyPredicate})
    )::bigint as unexpected_policy_count
  from storage_policy_definitions policy_record
),
inventory_payload as materialized (
  select pg_catalog.jsonb_build_object(
    'contract_version', '${contract.contractVersion}',
    'transaction_read_only', true,
    'saved_roles_exists', pg_catalog.to_regclass('public.saved_roles') is not null,
    'businesses_exists', pg_catalog.to_regclass('public.businesses') is not null,
    'storage_buckets_exists', pg_catalog.to_regclass('storage.buckets') is not null,
    'storage_objects_exists', pg_catalog.to_regclass('storage.objects') is not null,
    'duplicate_saved_role_groups', duplicate_saved_roles.duplicate_groups,
    'duplicate_saved_role_rows', duplicate_saved_roles.duplicate_rows,
    'assets_bucket_count', assets_bucket.bucket_count,
    'assets_bucket_public', assets_bucket.bucket_public,
    'assets_bucket_name_matches', assets_bucket.name_matches,
    'assets_bucket_file_size_limit', assets_bucket.file_size_limit,
    'assets_bucket_allowed_mime_types', assets_bucket.allowed_mime_types,
    'assets_object_count', assets_object_facts.object_count,
    'assets_noncanonical_path_count', assets_object_facts.noncanonical_count,
    'assets_orphan_business_count', assets_object_facts.orphan_count,
    'assets_oversized_object_count', assets_object_facts.oversized_count,
    'assets_unsupported_mime_count', assets_object_facts.unsupported_mime_count,
    'assets_duplicate_business_count', assets_duplicate_businesses.duplicate_business_count,
    'expected_assets_policy_count', assets_policy_facts.expected_policy_count,
    'predecessor_assets_policy_count', assets_policy_facts.predecessor_policy_count,
    'expected_non_assets_policy_count', assets_policy_facts.expected_non_assets_policy_count,
    'unexpected_storage_policy_count', assets_policy_facts.unexpected_policy_count
  ) as payload
  from query_limits
  cross join duplicate_saved_roles
  cross join assets_bucket
  cross join assets_object_facts
  cross join assets_duplicate_businesses
  cross join assets_policy_facts
)
select pg_catalog.encode(
  pg_catalog.convert_to(inventory_payload.payload::text, 'UTF8'),
  'hex'
) as prompted_release_inventory_v1
from inventory_payload;`;
}

function parseHostedInventoryCliOutput(stdout) {
  if (typeof stdout !== "string" || stdout.length > 1024 * 1024) {
    throw new Error("Hosted release inventory response was invalid.");
  }
  let wrapper;
  try {
    wrapper = JSON.parse(stdout);
  } catch {
    throw new Error("Hosted release inventory response was invalid.");
  }
  const rows = Array.isArray(wrapper) ? wrapper : wrapper?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Hosted release inventory response was invalid.");
  }
  const keys = Object.keys(rows[0] ?? {});
  const encoded = rows[0]?.prompted_release_inventory_v1;
  if (
    keys.length !== 1 ||
    keys[0] !== "prompted_release_inventory_v1" ||
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > 131_072 ||
    encoded.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(encoded)
  ) {
    throw new Error("Hosted release inventory response was invalid.");
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "hex").toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    return payload;
  } catch {
    throw new Error("Hosted release inventory response was invalid.");
  }
}

export async function fetchHostedInventory({
  projectRef,
  manifest,
  execFileImpl = execFileAsync,
  timeoutMs = 60_000,
} = {}) {
  const exactProjectRef = validateProjectRef(projectRef);
  const sql = buildHostedInventorySql(manifest);
  let temporaryDirectory;
  let result;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "prompted-release-inventory-"));
    const queryPath = join(temporaryDirectory, "inventory.sql");
    await writeFile(queryPath, sql, { encoding: "utf8", mode: 0o600 });
    result = await execFileImpl(
      "supabase",
      [
        "db",
        "query",
        "--project-ref",
        exactProjectRef,
        "--output-format",
        "json",
        "--file",
        queryPath,
      ],
      cliExecutionOptions(timeoutMs, "Hosted release inventory timeout"),
    );
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "Hosted release inventory query timed out."
        : "Hosted release inventory query failed.",
    );
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
  return parseHostedInventoryCliOutput(result?.stdout);
}

function parseHostedFunctionList(stdout) {
  if (typeof stdout !== "string" || stdout.length > 1024 * 1024) {
    throw new Error("Hosted function inventory response was invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error("Hosted function inventory response was invalid.");
  }
  const functions = Array.isArray(payload) ? payload : payload?.functions;
  if (!Array.isArray(functions) || functions.length > 500) {
    throw new Error("Hosted function inventory response was invalid.");
  }
  return functions.map((entry) => {
    const name = entry?.name ?? entry?.slug;
    if (
      typeof name !== "string" ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) ||
      (entry.verify_jwt !== undefined && typeof entry.verify_jwt !== "boolean")
    ) {
      throw new Error("Hosted function inventory response was invalid.");
    }
    return {
      name,
      status: typeof entry.status === "string" ? entry.status : null,
      version:
        typeof entry.version === "number" || typeof entry.version === "string"
          ? entry.version
          : null,
      verifyJwt: typeof entry.verify_jwt === "boolean" ? entry.verify_jwt : null,
    };
  });
}

export async function fetchHostedFunctionInventory({
  projectRef,
  execFileImpl = execFileAsync,
  timeoutMs = 60_000,
} = {}) {
  const exactProjectRef = validateProjectRef(projectRef);
  let result;
  try {
    result = await execFileImpl(
      "supabase",
      ["functions", "list", "--project-ref", exactProjectRef, "--output", "json"],
      cliExecutionOptions(timeoutMs, "Hosted function inventory timeout"),
    );
  } catch (error) {
    throw new Error(
      isTimeoutError(error)
        ? "Hosted function inventory query timed out."
        : "Hosted function inventory query failed.",
    );
  }
  return parseHostedFunctionList(result?.stdout);
}

function migrationVersion(migrationName) {
  return migrationName.split("_", 1)[0];
}

function inventoryFailure(failures, code, message, count) {
  failures.push({ code, message, ...(count === undefined ? {} : { count }) });
}

function inventoryCheck(checks, code, ok, state, count) {
  checks.push({ code, ok, state, ...(count === undefined ? {} : { count }) });
}

export function validateHostedInventory({
  manifest,
  migrationLedger,
  inventory,
  hostedFunctions,
  phase = "pre_migration",
}) {
  const contract = assertInventoryContract(manifest);
  const failures = [];
  const checks = [];
  const remoteVersions = migrationLedger?.remoteVersions ?? [];
  const localVersions = migrationLedger?.localVersions ?? [];
  const remoteUnique = new Set(remoteVersions);
  const ledgerDiverged =
    remoteUnique.size !== remoteVersions.length ||
    (localVersions.length > 0 &&
      (remoteVersions.length > localVersions.length ||
        remoteVersions.some((version, index) => version !== localVersions[index])));
  inventoryCheck(checks, "MIGRATION_LEDGER_PREFIX", !ledgerDiverged, "observed");
  if (ledgerDiverged) {
    inventoryFailure(
      failures,
      "MIGRATION_LEDGER_DIVERGED",
      "The hosted migration ledger is not an exact prefix of the reviewed local ledger.",
    );
  }
  const baselinePresent = remoteUnique.has(contract.productionBaselineMigration);
  inventoryCheck(checks, "MIGRATION_LEDGER_BASELINE", baselinePresent, "observed");
  if (!baselinePresent) {
    inventoryFailure(
      failures,
      "MIGRATION_LEDGER_BASELINE_MISSING",
      "The hosted migration ledger does not include the immutable production baseline.",
    );
  }

  const requiredBooleanFields = [
    "transaction_read_only",
    "saved_roles_exists",
    "businesses_exists",
    "storage_buckets_exists",
    "storage_objects_exists",
  ];
  const countFields = [
    "duplicate_saved_role_groups",
    "duplicate_saved_role_rows",
    "assets_bucket_count",
    "assets_object_count",
    "assets_noncanonical_path_count",
    "assets_orphan_business_count",
    "assets_oversized_object_count",
    "assets_unsupported_mime_count",
    "assets_duplicate_business_count",
    "expected_assets_policy_count",
    "predecessor_assets_policy_count",
    "expected_non_assets_policy_count",
    "unexpected_storage_policy_count",
  ];
  if (
    !inventory ||
    typeof inventory !== "object" ||
    Array.isArray(inventory) ||
    inventory.contract_version !== contract.contractVersion ||
    requiredBooleanFields.some((field) => typeof inventory[field] !== "boolean") ||
    countFields.some((field) => !Number.isSafeInteger(inventory[field]) || inventory[field] < 0)
  ) {
    return {
      failures: [
        {
          code: "INVENTORY_PAYLOAD_INVALID",
          message: "The hosted release inventory payload does not match its reviewed contract.",
        },
      ],
      checks,
    };
  }
  if (!inventory.transaction_read_only) {
    inventoryFailure(
      failures,
      "INVENTORY_NOT_READ_ONLY",
      "The hosted inventory was not read-only.",
    );
  }
  for (const [field, code] of [
    ["saved_roles_exists", "SAVED_ROLES_TABLE_MISSING"],
    ["businesses_exists", "BUSINESSES_TABLE_MISSING"],
    ["storage_buckets_exists", "STORAGE_BUCKETS_TABLE_MISSING"],
    ["storage_objects_exists", "STORAGE_OBJECTS_TABLE_MISSING"],
  ]) {
    if (!inventory[field])
      inventoryFailure(failures, code, "A required hosted inventory relation is missing.");
  }

  if (inventory.duplicate_saved_role_groups > 0) {
    inventoryFailure(
      failures,
      "SAVED_ROLE_DUPLICATES",
      "Saved-role duplicate groups require explicit reconciliation before migration.",
      inventory.duplicate_saved_role_groups,
    );
  }

  const brandCreationMigrationApplied = remoteUnique.has(
    migrationVersion(contract.brandAssetsCreationMigration),
  );
  const brandMigrationApplied = remoteUnique.has(migrationVersion(contract.brandAssetsMigration));
  if (inventory.assets_bucket_count === 0) {
    if (brandCreationMigrationApplied) {
      inventoryFailure(
        failures,
        "ASSETS_BUCKET_MISSING",
        "The applied assets migration has no hosted bucket.",
      );
    } else {
      inventoryCheck(checks, "ASSETS_PLANNED_CREATE", true, "planned_create");
    }
  } else if (inventory.assets_bucket_count !== 1) {
    inventoryFailure(
      failures,
      "ASSETS_BUCKET_AMBIGUOUS",
      "The hosted assets bucket identity is ambiguous.",
    );
  } else {
    if (inventory.assets_bucket_public === false && inventory.assets_object_count > 0) {
      inventoryFailure(
        failures,
        "ASSETS_PRIVATE_WITH_OBJECTS",
        "A populated private assets bucket cannot be published without explicit review.",
        inventory.assets_object_count,
      );
    }
    const bucketContractMatches =
      inventory.assets_bucket_public === contract.brandAssets.public &&
      inventory.assets_bucket_name_matches === true &&
      inventory.assets_bucket_file_size_limit === contract.brandAssets.fileSizeLimit &&
      Array.isArray(inventory.assets_bucket_allowed_mime_types) &&
      JSON.stringify([...inventory.assets_bucket_allowed_mime_types].sort()) ===
        JSON.stringify([...contract.brandAssets.allowedMimeTypes].sort());
    if (!bucketContractMatches) {
      if (brandCreationMigrationApplied) {
        inventoryFailure(
          failures,
          "ASSETS_BUCKET_DRIFT",
          "The hosted assets bucket differs from its applied contract.",
        );
      } else {
        inventoryCheck(checks, "ASSETS_BUCKET_PLANNED_REPLACE", true, "planned_replace");
      }
    }
  }

  for (const [field, code, message] of [
    [
      "assets_noncanonical_path_count",
      "ASSETS_NONCANONICAL_PATHS",
      "Noncanonical assets paths require review.",
    ],
    [
      "assets_orphan_business_count",
      "ASSETS_ORPHAN_BUSINESSES",
      "Brand assets without an owned business require review.",
    ],
    [
      "assets_oversized_object_count",
      "ASSETS_OVERSIZED_OBJECTS",
      "Oversized or size-unknown brand assets require review.",
    ],
    [
      "assets_unsupported_mime_count",
      "ASSETS_UNSUPPORTED_MIME",
      "Unsupported or unknown brand-asset MIME types require review.",
    ],
    [
      "assets_duplicate_business_count",
      "ASSETS_DUPLICATE_BUSINESS",
      "Businesses with multiple logo objects require review.",
    ],
    [
      "unexpected_storage_policy_count",
      "STORAGE_UNDECLARED_POLICY",
      "An undeclared or predicate-drifted Storage policy requires review.",
    ],
  ]) {
    if (inventory[field] > 0) inventoryFailure(failures, code, message, inventory[field]);
  }
  if (
    inventory.expected_non_assets_policy_count !==
    contract.brandAssets.requiredUnrelatedPolicies.length
  ) {
    inventoryFailure(
      failures,
      "STORAGE_BASE_POLICY_DRIFT",
      "A required non-brand Storage policy differs from its reviewed definition.",
    );
  }
  const finalPolicyCount = inventory.expected_assets_policy_count;
  const predecessorPolicyCount = inventory.predecessor_assets_policy_count;
  if (brandMigrationApplied) {
    if (finalPolicyCount !== contract.brandAssets.policies.length || predecessorPolicyCount !== 0) {
      inventoryFailure(
        failures,
        "ASSETS_POLICY_DRIFT",
        "The hosted assets policies differ from their applied final contract.",
      );
    }
  } else if (brandCreationMigrationApplied) {
    if (
      finalPolicyCount !== 0 ||
      predecessorPolicyCount !== contract.brandAssets.predecessorPolicies.length
    ) {
      inventoryFailure(
        failures,
        "ASSETS_PREDECESSOR_POLICY_DRIFT",
        "The hosted predecessor assets policies differ from the exact pending-migration contract.",
      );
    } else {
      inventoryCheck(checks, "ASSETS_POLICY_PLANNED_REPLACE", true, "planned_replace");
    }
  } else if (finalPolicyCount !== 0 || predecessorPolicyCount !== 0) {
    inventoryFailure(
      failures,
      "ASSETS_POLICY_PREMATURE",
      "Assets policies exist before their reviewed migration boundary.",
    );
  } else {
    inventoryCheck(checks, "ASSETS_POLICY_PLANNED_CREATE", true, "planned_create");
  }

  if (!Array.isArray(hostedFunctions)) {
    inventoryFailure(
      failures,
      "HOSTED_FUNCTION_INVENTORY_INVALID",
      "The hosted function inventory is invalid.",
    );
  } else {
    const hostedByName = new Map();
    for (const hosted of hostedFunctions) {
      if (hostedByName.has(hosted.name)) {
        inventoryFailure(
          failures,
          "HOSTED_FUNCTION_DUPLICATED",
          "A hosted function name is duplicated.",
        );
        continue;
      }
      hostedByName.set(hosted.name, hosted);
      const declared = manifest.functions?.[hosted.name];
      if (!declared && contract.forbidUndeclaredHostedFunctions) {
        inventoryFailure(
          failures,
          "UNDECLARED_HOSTED_FUNCTION",
          "An undeclared Edge Function is deployed.",
        );
      } else if (declared?.status === "dormant" && contract.dormantFunctionsMustBeAbsent) {
        inventoryFailure(
          failures,
          "DORMANT_FUNCTION_DEPLOYED",
          "A dormant Edge Function remains deployed.",
        );
      } else if (declared?.status === "active") {
        if (hosted.verifyJwt === null) {
          inventoryFailure(
            failures,
            "HOSTED_FUNCTION_AUTH_METADATA_MISSING",
            "A hosted active function has no verifiable JWT-mode metadata.",
          );
        } else if (hosted.verifyJwt !== (declared.authMode === "jwt")) {
          inventoryFailure(
            failures,
            "HOSTED_FUNCTION_AUTH_DRIFT",
            "A hosted function JWT mode differs from its contract.",
          );
        }
      }
    }
    for (const [name, declared] of Object.entries(manifest.functions ?? {})) {
      if (declared.status === "active" && !hostedByName.has(name)) {
        if (phase === "post_function") {
          inventoryFailure(
            failures,
            "ACTIVE_FUNCTION_MISSING",
            "A required active Edge Function is not deployed.",
          );
        } else {
          inventoryCheck(checks, "ACTIVE_FUNCTION_PLANNED_DEPLOY", true, "planned_deploy");
        }
      }
    }
  }

  return { failures, checks };
}

async function localMigrationVersions(repoRoot) {
  const entries = await readdir(`${repoRoot}/supabase/migrations`);
  const versions = entries
    .map((name) => name.match(/^(\d{14})_[a-z0-9_]+[.]sql$/)?.[1] ?? null)
    .filter(Boolean)
    .sort();
  if (new Set(versions).size !== versions.length) {
    throw new Error("The reviewed local migration ledger contains duplicate versions.");
  }
  return versions;
}

async function runInventoryProbe({ manifest, projectRef, repoRoot, phase }) {
  let migrationLedger;
  let inventory;
  let hostedFunctions;
  try {
    [migrationLedger, inventory, hostedFunctions] = await Promise.all([
      fetchPreMigrationLedger({ projectRef }),
      fetchHostedInventory({ projectRef, manifest }),
      fetchHostedFunctionInventory({ projectRef }),
    ]);
    migrationLedger.localVersions = await localMigrationVersions(repoRoot);
  } catch (error) {
    console.error(`Hosted release inventory failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const result = validateHostedInventory({
    manifest,
    migrationLedger,
    inventory,
    hostedFunctions,
    phase,
  });
  for (const check of result.checks) {
    console.log(`[${check.ok ? "pass" : "fail"}] ${check.code}: ${check.state}`);
  }
  if (result.failures.length > 0) {
    console.error("\nHosted release inventory blocked mutation:");
    for (const failure of result.failures) {
      console.error(
        ` - ${failure.code}${failure.count === undefined ? "" : ` (${failure.count})`}: ${failure.message}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\nHosted release inventory passed for ${phase}; no hosted mutation was performed.`);
}

function indexAttestation(payload, request) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.schema_version !== 2 ||
    !Array.isArray(payload.tables) ||
    !Array.isArray(payload.rpcs)
  ) {
    throw new Error("Release schema attestation response shape is invalid.");
  }
  const tables = new Map();
  for (const fact of payload.tables) {
    if (!fact || typeof fact !== "object" || Array.isArray(fact) || typeof fact.name !== "string") {
      throw new Error("Release schema attestation table facts are invalid.");
    }
    if (tables.has(fact.name))
      throw new Error("Release schema attestation table facts are duplicated.");
    tables.set(fact.name, fact);
  }
  const rpcs = new Map();
  for (const fact of payload.rpcs) {
    if (!fact || typeof fact !== "object" || Array.isArray(fact) || typeof fact.name !== "string") {
      throw new Error("Release schema attestation RPC facts are invalid.");
    }
    if (rpcs.has(fact.name))
      throw new Error("Release schema attestation RPC facts are duplicated.");
    rpcs.set(fact.name, fact);
  }
  if (
    request.tables.some((name) => !tables.has(name)) ||
    tables.size !== request.tables.length ||
    request.rpcs.some((name) => !rpcs.has(name)) ||
    rpcs.size !== request.rpcs.length
  ) {
    throw new Error("Release schema attestation response does not match the request.");
  }
  return { tables, rpcs };
}

const VALID_TABLE_PRIVILEGES = new Set(["select", "insert", "update", "delete"]);

function mergeExpectedTablePrivileges(target, requirements = {}) {
  for (const [table, privileges] of Object.entries(requirements)) {
    const expected = target.get(table) ?? new Set();
    for (const privilege of privileges ?? []) expected.add(privilege);
    target.set(table, expected);
  }
}

export function validateLiveSchema({
  manifest,
  appliedMigrations,
  attestation,
  attestationRequest,
}) {
  const failures = [];
  const checks = [];
  let attested;
  try {
    attested = indexAttestation(attestation, attestationRequest);
  } catch (error) {
    return { failures: [error.message], checks };
  }

  const checkRpc = (scope, rpc, role) => {
    const fact = attested.rpcs.get(rpc);
    const exists = fact?.exists === true && fact?.overload_count === 1;
    const executable = fact?.[`${role}_execute`] === true;
    const expectedArgumentTypes = manifest.requiredRpcSignatures?.[rpc];
    const signatureExact =
      expectedArgumentTypes === undefined ||
      (typeof expectedArgumentTypes === "string" && fact?.argument_types === expectedArgumentTypes);
    const ok = exists && executable && signatureExact;
    checks.push({ function: scope, kind: `${role} rpc`, name: rpc, ok });
    if (!ok) {
      failures.push(
        `${scope === "web" ? "Web application" : `Function "${scope}"`} requires one unambiguous RPC ` +
          `"${rpc}" executable by ${role} with exact argument types ` +
          `"${expectedArgumentTypes ?? "<missing>"}".`,
      );
    }
  };

  const checkTable = (scope, table, role, privileges = [], { requireRls = false } = {}) => {
    const fact = attested.tables.get(table);
    const invalidPrivilege = privileges.find((privilege) => !VALID_TABLE_PRIVILEGES.has(privilege));
    const rlsValid =
      !requireRls || (["r", "p"].includes(fact?.relation_kind) && fact?.rls_enabled === true);
    const ok =
      !invalidPrivilege &&
      fact?.exists === true &&
      rlsValid &&
      privileges.every((privilege) => fact?.[role]?.[privilege] === true);
    const label =
      privileges.length > 0 ? `${role} table privileges ${privileges.join(",")}` : "table";
    checks.push({ function: scope, kind: label, name: table, ok });
    if (!ok) {
      failures.push(
        `${scope === "web" ? "Web application" : `Function "${scope}"`} requires table "${table}"` +
          (privileges.length > 0 ? ` with ${role} ${privileges.join(", ")} privilege(s)` : "") +
          (requireRls ? " and enabled row-level security." : "."),
      );
    }
  };

  const attestationMigration = manifest.schemaAttestation?.requiredMigration;
  if (attestationMigration) {
    const timestamp = attestationMigration.match(/^(\d{14})/)?.[1];
    const applied = timestamp ? appliedMigrations.has(timestamp) : false;
    checks.push({
      function: "release",
      kind: "migration",
      name: attestationMigration,
      ok: applied,
    });
    if (!applied)
      failures.push(`Release schema attestation requires migration "${attestationMigration}".`);
  }
  const argumentTypesMigration = manifest.schemaAttestation?.argumentTypesRequiredMigration;
  if (argumentTypesMigration) {
    const timestamp = argumentTypesMigration.match(/^(\d{14})/)?.[1];
    const applied = timestamp ? appliedMigrations.has(timestamp) : false;
    checks.push({
      function: "release",
      kind: "rpc argument attestation migration",
      name: argumentTypesMigration,
      ok: applied,
    });
    if (!applied) {
      failures.push(
        `Exact RPC argument attestation requires migration "${argumentTypesMigration}".`,
      );
    }
  }
  const capacityAttestationMigration = manifest.capacityAttestation?.requiredMigration;
  if (capacityAttestationMigration) {
    const timestamp = capacityAttestationMigration.match(/^(\d{14})/)?.[1];
    const applied = timestamp ? appliedMigrations.has(timestamp) : false;
    checks.push({
      function: "release",
      kind: "capacity attestation migration",
      name: capacityAttestationMigration,
      ok: applied,
    });
    if (!applied) {
      failures.push(
        `OpenAI capacity attestation requires migration "${capacityAttestationMigration}".`,
      );
    }
  }
  const routingAttestationMigration = manifest.routingAttestation?.requiredMigration;
  if (routingAttestationMigration) {
    const timestamp = routingAttestationMigration.match(/^(\d{14})/)?.[1];
    const applied = timestamp ? appliedMigrations.has(timestamp) : false;
    checks.push({
      function: "release",
      kind: "routing attestation migration",
      name: routingAttestationMigration,
      ok: applied,
    });
    if (!applied) {
      failures.push(
        `OpenAI routing attestation requires migration "${routingAttestationMigration}".`,
      );
    }
  }
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    const requirements = effectiveRequirements(manifest, name);

    for (const migration of requirements.migrations) {
      const timestamp = migration.match(/^(\d{14})/)?.[1];
      const applied = timestamp ? appliedMigrations.has(timestamp) : false;
      checks.push({ function: name, kind: "migration", name: migration, ok: applied });
      if (!applied) {
        failures.push(
          `Function "${name}" requires migration "${migration}" which is not applied on the live project.`,
        );
      }
    }
    for (const rpc of requirements.rpcs) checkRpc(name, rpc, "service_role");
    for (const rpc of requirements.authenticatedRpcs) {
      checkRpc(name, rpc, "authenticated");
    }
    for (const table of requirements.tables) {
      checkTable(name, table, "service_role", requirements.tablePrivileges[table] ?? []);
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
  for (const rpc of webRequirements.requiredRpcs ?? []) checkRpc("web", rpc, "authenticated");
  for (const table of webRequirements.requiredTables ?? []) {
    checkTable(
      "web",
      table,
      "authenticated",
      webRequirements.requiredTablePrivileges?.[table] ?? [],
      { requireRls: true },
    );
  }

  // RPC execution is an exact role contract, not merely a positive
  // capability check. A hosted grant to `anon` or `authenticated` on a
  // service-only SECURITY DEFINER function could otherwise bypass the Edge
  // authentication/entitlement boundary while still passing this release
  // probe.
  const serviceExpectedRpcs = new Set();
  const authenticatedExpectedRpcs = new Set(webRequirements.requiredRpcs ?? []);
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    const requirements = effectiveRequirements(manifest, name);
    for (const rpc of requirements.rpcs) {
      serviceExpectedRpcs.add(rpc);
    }
    for (const rpc of requirements.authenticatedRpcs) {
      authenticatedExpectedRpcs.add(rpc);
    }
  }
  const expectedRpcsByRole = new Map([
    ["anon", new Set()],
    ["authenticated", authenticatedExpectedRpcs],
    ["service_role", serviceExpectedRpcs],
  ]);
  for (const rpc of attestationRequest.rpcs) {
    const fact = attested.rpcs.get(rpc);
    for (const [role, expectedRpcs] of expectedRpcsByRole) {
      const expected = expectedRpcs.has(rpc);
      const actual = fact?.[`${role}_execute`] === true;
      const ok = fact?.exists === true && actual === expected;
      checks.push({
        function: "release",
        kind: `${role} exact rpc execution`,
        name: rpc,
        ok,
      });
      if (!ok) {
        failures.push(
          `RPC "${rpc}" ${actual ? "is" : "is not"} executable by ${role}, ` +
            `but the exact release contract ${expected ? "requires" : "forbids"} it.`,
        );
      }
    }
    const safeSearchPath =
      fact?.security_definer !== true || fact?.safe_security_definer_search_path === true;
    checks.push({
      function: "release",
      kind: "security-definer search path",
      name: rpc,
      ok: safeSearchPath,
    });
    if (!safeSearchPath) {
      failures.push(`SECURITY DEFINER RPC "${rpc}" does not fix the reviewed empty search_path.`);
    }
  }

  // Required privileges alone are not a least-privilege attestation: a role
  // with the requested SELECT plus an unintended INSERT would otherwise pass.
  // Compare every explicitly declared role/table matrix against the live
  // positive privileges and fail on any excess grant. Missing grants are
  // already reported by the scoped checks above, avoiding duplicate errors.
  const serviceExpected = new Map();
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    const requirements = effectiveRequirements(manifest, name);
    mergeExpectedTablePrivileges(serviceExpected, requirements.tablePrivileges);
  }
  const authenticatedExpected = new Map();
  mergeExpectedTablePrivileges(authenticatedExpected, webRequirements.requiredTablePrivileges);

  const checkExcessPrivileges = (role, expectedByTable) => {
    for (const [table, expected] of expectedByTable) {
      const fact = attested.tables.get(table);
      const excess = [...VALID_TABLE_PRIVILEGES].filter(
        (privilege) => fact?.[role]?.[privilege] === true && !expected.has(privilege),
      );
      const ok = fact?.exists === true && excess.length === 0;
      checks.push({
        function: "release",
        kind: `${role} exact table privileges`,
        name: table,
        ok,
      });
      if (!ok && excess.length > 0) {
        failures.push(
          `Table "${table}" gives ${role} undeclared ${excess.join(", ")} privilege(s).`,
        );
      }
    }
  };
  checkExcessPrivileges("service_role", serviceExpected);
  checkExcessPrivileges("authenticated", authenticatedExpected);

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
      allowMethodNotAllowed: entry.smokeProbe?.allowMethodNotAllowed === true,
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

export async function pingFunctionEndpoint(
  supabaseUrl,
  functionName,
  { expectedProjectRef, fetchImpl = fetch, timeoutMs = 20_000, allowMethodNotAllowed = false } = {},
) {
  const target = validateSupabaseUrl(supabaseUrl, expectedProjectRef);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(functionName ?? "")) {
    throw new Error("Supabase function name is invalid.");
  }
  const validatedTimeoutMs = validateTimeoutMs(timeoutMs, "Function smoke timeout");

  try {
    const response = await fetchImpl(new URL(`/functions/v1/${functionName}`, target).href, {
      method: "OPTIONS",
      redirect: "error",
      signal: AbortSignal.timeout(validatedTimeoutMs),
      headers: { "user-agent": "PrompTED-function-smoke/2.0" },
    });
    // A strict POST-only handler may intentionally reject OPTIONS with 405,
    // but that exception must be declared per function in the release contract.
    const ok =
      (response.status >= 200 && response.status < 300) ||
      (allowMethodNotAllowed && response.status === 405);
    return {
      status: response.status,
      ok,
      error: ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: null,
      ok: false,
      error: isTimeoutError(error) ? "request timed out" : "request failed",
    };
  }
}

export async function runFunctionSmokeProbes({
  manifest,
  supabaseUrl,
  openApiTables,
  openApiRpcs,
  fetchImpl = fetch,
  timeoutMs = 20_000,
}) {
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

    const ping = await pingFunctionEndpoint(supabaseUrl, probe.function, {
      expectedProjectRef: manifest.projectRef,
      fetchImpl,
      timeoutMs,
      allowMethodNotAllowed: probe.allowMethodNotAllowed,
    });
    checks.push({
      function: probe.function,
      kind: "endpoint",
      name: probe.function,
      ok: ping.ok,
      status: ping.status,
      error: ping.error,
    });
    if (!ping.ok) {
      failures.push(
        ping.status === null
          ? `Function "${probe.function}" smoke probe ${ping.error}.`
          : `Function "${probe.function}" smoke probe returned HTTP ${ping.status}.`,
      );
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

  const { checks, failures } = await runFunctionSmokeProbes({
    manifest,
    supabaseUrl,
    openApiTables,
    openApiRpcs,
  });

  for (const check of checks) {
    const label =
      check.kind === "endpoint"
        ? `endpoint (HTTP ${check.status})`
        : `${check.kind} "${check.name}"`;
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
  try {
    assertMigrationLedgerCannotBeSkipped(process.env.SUPABASE_MIGRATION_CHECK);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const probeMode = process.env.SUPABASE_PROBE_MODE?.trim() || "schema";

  const missing = requiredProbeEnvironmentVariables({
    probeMode,
    supabaseUrl,
    serviceRoleKey,
    projectRef,
    manifest,
    environment: process.env,
  });
  if (missing.length > 0) {
    console.error(
      `Live schema probe cannot run: missing required environment variable(s): ${missing.join(", ")}.`,
    );
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
  if (probeMode === "inventory") {
    await runInventoryProbe({ manifest, projectRef, repoRoot, phase: "pre_migration" });
    return;
  }
  if (probeMode === "post_function") {
    await runInventoryProbe({ manifest, projectRef, repoRoot, phase: "post_function" });
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
      `Unknown SUPABASE_PROBE_MODE "${probeMode}". Expected "target", "inventory", "post_function", "schema", or "smoke".`,
    );
    process.exitCode = 1;
    return;
  }

  let appliedMigrations;
  try {
    appliedMigrations = await fetchAppliedMigrationVersions();
  } catch (error) {
    console.error(`Live migration ledger probe failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let attested;
  try {
    attested = await fetchSchemaAttestation(validatedSupabaseUrl, serviceRoleKey, manifest);
  } catch (error) {
    console.error(`Live schema probe failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let capacityAttested;
  try {
    capacityAttested = await fetchCapacityAttestation(
      validatedSupabaseUrl,
      serviceRoleKey,
      manifest,
    );
  } catch (error) {
    console.error(`Live capacity probe failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let routingAttested;
  try {
    routingAttested = await fetchRoutingAttestation(validatedSupabaseUrl, serviceRoleKey, manifest);
  } catch (error) {
    console.error(`Live routing probe failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const schemaValidation = validateLiveSchema({
    manifest,
    appliedMigrations,
    attestation: attested.payload,
    attestationRequest: attested.request,
  });
  const capacityValidation = validateCapacityAttestation({
    payload: capacityAttested.payload,
    request: capacityAttested.request,
    environment: process.env,
  });
  const routingValidation = validateRoutingAttestation({
    payload: routingAttested.payload,
    request: routingAttested.request,
    environment: process.env,
  });
  const failures = [
    ...schemaValidation.failures,
    ...capacityValidation.failures,
    ...routingValidation.failures,
  ];
  const checks = [
    ...schemaValidation.checks,
    ...capacityValidation.checks,
    ...routingValidation.checks,
  ];

  for (const check of checks) {
    console.log(`[${check.ok ? "pass" : "fail"}] ${check.function}: ${check.kind} "${check.name}"`);
  }

  if (failures.length > 0) {
    console.error("\nLive schema probe failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nLive schema probe passed (${checks.length} checks across ${Object.keys(manifest.functions ?? {}).length} functions).`,
  );
}

const isMainModule =
  process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((error) => {
    console.error("Live schema probe crashed:", error.message);
    process.exitCode = 1;
  });
}
