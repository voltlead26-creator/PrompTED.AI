#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "refs/heads/main";
const SITE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPLOY_ID_PATTERN = /^[0-9a-f]{24}$/i;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const deploymentContract = JSON.parse(
  readFileSync(new URL("../supabase/deployment-contract.json", import.meta.url), "utf8"),
);
const PRODUCTION_SUPABASE_PROJECT_REF = deploymentContract.projectRef;
if (!/^[a-z0-9]{20}$/.test(PRODUCTION_SUPABASE_PROJECT_REF ?? "")) {
  throw new Error("The deployment contract does not identify the production Supabase project.");
}

const PUBLIC_SMOKE_ROUTES = ["/", "/sign-in", "/privacy"];
const RELEASE_ATTESTATION_ROUTE = "/release-attestation";
const PROTECTED_SMOKE_ROUTE =
  "/api/document-operation?operation_id=00000000-0000-4000-8000-000000000000";
const SMOKE_TIMEOUT_MS = 20_000;
const SUPABASE_ANON_PREFLIGHT_PATH = "/rest/v1/";
const SUPABASE_ANON_PREFLIGHT_TIMEOUT_MS = 20_000;
const GIT_COMMAND_TIMEOUT_MS = 30_000;
const NETLIFY_CONTROL_TIMEOUT_MS = 60_000;
const NETLIFY_BUILD_TIMEOUT_MS = 20 * 60_000;
const NETLIFY_DEPLOY_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const SUPABASE_PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,512}$/;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ARTIFACT_FILES = 100_000;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024;
const ARTIFACT_ROOTS = [
  "apps/web/.next",
  "apps/web/.netlify/deploy/v1",
  "apps/web/.netlify/edge-functions",
  "apps/web/.netlify/v1",
  "apps/web/.netlify/static",
  "apps/web/.netlify/functions",
  "apps/web/.netlify/functions-internal",
  "apps/web/.netlify/edge-functions-dist",
  "apps/web/.netlify/deploy-config",
  "apps/web/.netlify/internal/db/migrations",
  ".netlify/v1",
  ".netlify/deploy/v1",
  ".netlify/edge-functions",
  ".netlify/static",
  ".netlify/functions",
  ".netlify/functions-internal",
  ".netlify/edge-functions-dist",
  ".netlify/deploy-config",
  ".netlify/internal/db/migrations",
].sort();

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(label + " is required.");
  }
  return value.trim();
}

function canonicalHttpsOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(requireText(value, label));
  } catch {
    throw new Error(label + " must be a valid absolute URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(label + " must be an exact HTTPS origin.");
  }
  return parsed.origin;
}

function validateSupabaseAnonKey(value) {
  const key = requireText(value, "Supabase anonymous key");
  if (key.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("The production Supabase anonymous key is malformed.");
  }
  if (SUPABASE_PUBLISHABLE_KEY_PATTERN.test(key)) return key;

  const segments = key.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0 || !JWT_SEGMENT_PATTERN.test(segment))
  ) {
    throw new Error("The production Supabase anonymous key is malformed.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("The production Supabase anonymous key is malformed.");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.ref !== PRODUCTION_SUPABASE_PROJECT_REF ||
    payload.role !== "anon"
  ) {
    throw new Error(
      "The production Supabase anonymous key is not bound to the reviewed project and anonymous role.",
    );
  }
  return key;
}

function parseJsonOutput(stdout, label) {
  try {
    return JSON.parse(requireText(stdout, label + " output"));
  } catch {
    throw new Error(label + " did not return valid JSON.");
  }
}

function processFailure(result, label) {
  if (result?.error) return result.error;
  const detail = result?.signal
    ? "signal " + result.signal
    : "exit status " + String(result?.status);
  return new Error(label + " failed with " + detail + ".");
}

function runProcess(spawnImpl, command, args, options, label) {
  const result = spawnImpl(command, args, options);
  if (result?.error || result?.status !== 0) {
    throw processFailure(result, label);
  }
  return result;
}

function netlifyProcessOptions(
  authToken,
  siteId,
  extraEnvironment = {},
  timeout = NETLIFY_CONTROL_TIMEOUT_MS,
) {
  return {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    timeout,
    killSignal: "SIGTERM",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    env: {
      ...process.env,
      ...extraEnvironment,
      NETLIFY_AUTH_TOKEN: authToken,
      NETLIFY_SITE_ID: siteId,
    },
  };
}

function gitProcessOptions() {
  return {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    killSignal: "SIGTERM",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  };
}

function assertCleanGitWorktree(spawnImpl, afterBuild = false) {
  const result = runProcess(
    spawnImpl,
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    gitProcessOptions(),
    afterBuild ? "Post-build Git cleanliness attestation" : "Git cleanliness attestation",
  );
  if (typeof result.stdout !== "string" || result.stdout.trim().length > 0) {
    throw new Error(
      afterBuild
        ? "The Git worktree is not clean after the Netlify build; refusing the draft upload."
        : "The Git worktree is not clean; refusing to contact Netlify.",
    );
  }
}

export function validateProductionDeployInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Production deployment input is required.");
  }

  const siteId = requireText(input.siteId, "Netlify site ID");
  const gitSha = requireText(input.gitSha, "Git commit SHA");
  const gitRef = requireText(input.gitRef, "Git ref");
  const authToken = requireText(input.authToken, "Netlify authentication token");
  const suppliedUrl = requireText(input.baseUrl, "Production URL");
  const expectedUrl = requireText(input.expectedBaseUrl, "Expected production URL");
  const appEnvironment = requireText(input.appEnvironment, "Application environment");
  const supabaseUrl = requireText(input.supabaseUrl, "Supabase URL");
  const supabaseAnonKey = validateSupabaseAnonKey(input.supabaseAnonKey);

  if (!SITE_ID_PATTERN.test(siteId)) {
    throw new Error("Netlify site ID must be a canonical UUID.");
  }
  if (!GIT_SHA_PATTERN.test(gitSha)) {
    throw new Error("Git commit SHA must be exactly 40 lowercase hexadecimal characters.");
  }
  if (gitRef !== PRODUCTION_REF) {
    throw new Error("Production deployment is allowed only from " + PRODUCTION_REF + ".");
  }
  if (appEnvironment !== "production") {
    throw new Error("Production deployment requires NEXT_PUBLIC_APP_ENV=production.");
  }

  let parsedSupabaseUrl;
  try {
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("The production Supabase URL must be a valid absolute URL.");
  }
  if (
    parsedSupabaseUrl.origin !== "https://" + PRODUCTION_SUPABASE_PROJECT_REF + ".supabase.co" ||
    parsedSupabaseUrl.pathname !== "/" ||
    parsedSupabaseUrl.search ||
    parsedSupabaseUrl.hash ||
    parsedSupabaseUrl.username ||
    parsedSupabaseUrl.password ||
    parsedSupabaseUrl.port
  ) {
    throw new Error("The production web build is not bound to the reviewed Supabase project.");
  }
  if (/(?:your-|replace|build-only|example)/i.test(supabaseAnonKey)) {
    throw new Error("The production web build cannot use a placeholder Supabase anonymous key.");
  }

  const parsedUrl = canonicalHttpsOrigin(suppliedUrl, "Production URL");
  const parsedExpectedUrl = canonicalHttpsOrigin(expectedUrl, "Expected production URL");
  if (parsedUrl !== parsedExpectedUrl) {
    throw new Error("Production URL does not match the protected expected target.");
  }

  // Validate the token before mutation without returning or logging it.
  void authToken;
  return {
    siteId: siteId.toLowerCase(),
    gitSha,
    baseUrl: parsedExpectedUrl,
  };
}

export async function preflightSupabaseAnonKey(
  supabaseUrl,
  supabaseAnonKey,
  { fetchImpl = globalThis.fetch, timeoutMs = SUPABASE_ANON_PREFLIGHT_TIMEOUT_MS } = {},
) {
  const origin = canonicalHttpsOrigin(supabaseUrl, "Supabase anonymous-key preflight URL");
  const expectedOrigin = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  if (origin !== expectedOrigin) {
    throw new Error("Supabase anonymous-key preflight target is not the reviewed project.");
  }
  const key = validateSupabaseAnonKey(supabaseAnonKey);
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for the Supabase anonymous-key preflight.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) {
    throw new Error(
      "Supabase anonymous-key preflight timeout must be between 1 and 20000 milliseconds.",
    );
  }

  const endpoint = new URL(SUPABASE_ANON_PREFLIGHT_PATH, origin + "/").href;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/openapi+json, application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
        "user-agent": "PrompTED-Supabase-key-preflight/1.0",
      },
    });
  } catch {
    throw new Error("Supabase anonymous key preflight failed before production publication.");
  }

  const status = Number.isInteger(response?.status) ? response.status : 0;
  const redirected = response?.redirected === true;
  const responseUrl = typeof response?.url === "string" ? response.url : "";
  if (response?.body && typeof response.body.cancel === "function") {
    try {
      await response.body.cancel();
    } catch {
      // The response status is authoritative; never surface a body-stream error
      // that could contain provider or credential-adjacent details.
    }
  }

  if (redirected || (responseUrl && responseUrl !== endpoint)) {
    throw new Error("Supabase anonymous key preflight refused a redirected response.");
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Supabase anonymous key preflight failed with HTTP ${status || "unknown"}.`);
  }

  return { projectRef: PRODUCTION_SUPABASE_PROJECT_REF, status };
}

export function buildNetlifySiteLookupArgs(input) {
  const { siteId } = validateProductionDeployInput(input);
  return ["api", "getSite", "--data", JSON.stringify({ site_id: siteId })];
}

export function buildNetlifyDraftDeployArgs(input) {
  const { siteId, gitSha } = validateProductionDeployInput(input);
  return [
    "deploy",
    "--site",
    siteId,
    "--filter",
    "@prompted/web",
    "--no-build",
    "--context",
    "production",
    "--json",
    "--message",
    "Production candidate — " + gitSha,
  ];
}

export function buildNetlifyBuildArgs(input) {
  validateProductionDeployInput(input);
  return ["build", "--filter", "@prompted/web", "--context", "production"];
}

export function buildNetlifyPromoteArgs(input, deployId) {
  const { siteId } = validateProductionDeployInput(input);
  const promotedDeployId = requireText(deployId, "Netlify deploy ID").toLowerCase();
  if (!DEPLOY_ID_PATTERN.test(promotedDeployId)) {
    throw new Error("Netlify deploy ID must be a canonical 24-character hexadecimal identifier.");
  }
  return [
    "api",
    "restoreSiteDeploy",
    "--data",
    JSON.stringify({ site_id: siteId, deploy_id: promotedDeployId }),
  ];
}

function metadataOrigins(payload) {
  const origins = new Set();
  const addUrl = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    try {
      origins.add(canonicalHttpsOrigin(value.trim(), "Netlify site URL"));
    } catch {
      // Ignore unrelated malformed or non-HTTPS metadata fields. The expected
      // origin must still be represented by one exact trusted field below.
    }
  };
  const addHostname = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    addUrl("https://" + value.trim());
  };

  addUrl(payload?.ssl_url);
  addUrl(payload?.url);
  addHostname(payload?.custom_domain);
  if (Array.isArray(payload?.domain_aliases)) {
    for (const alias of payload.domain_aliases) addHostname(alias);
  }
  return origins;
}

export function parseNetlifySiteAttestation(stdout, input) {
  const validated = validateProductionDeployInput(input);
  const payload = parseJsonOutput(stdout, "Netlify site lookup");
  const returnedSiteId = typeof payload?.id === "string" ? payload.id.trim().toLowerCase() : "";
  if (returnedSiteId !== validated.siteId) {
    throw new Error("Netlify site lookup did not attest the protected site identity.");
  }
  if (!metadataOrigins(payload).has(validated.baseUrl)) {
    throw new Error(
      "Netlify site lookup did not bind the site to the protected production origin.",
    );
  }
  const previousDeployId =
    typeof payload?.published_deploy?.id === "string"
      ? payload.published_deploy.id.trim().toLowerCase()
      : "";
  if (!DEPLOY_ID_PATTERN.test(previousDeployId)) {
    throw new Error("Netlify site lookup did not attest the currently published deploy.");
  }
  if (payload?.published_deploy?.locked === true) {
    throw new Error("The currently published Netlify deploy is locked; refusing promotion.");
  }
  return {
    siteId: validated.siteId,
    baseUrl: validated.baseUrl,
    previousDeployId,
  };
}

function lookupNetlifySiteAttestation(spawnImpl, input, label) {
  const siteResult = runProcess(
    spawnImpl,
    "netlify",
    buildNetlifySiteLookupArgs(input),
    netlifyProcessOptions(input.authToken, input.siteId),
    label,
  );
  return parseNetlifySiteAttestation(siteResult.stdout, input);
}

export function parseDraftDeploy(stdout, expectedSiteId) {
  const payload = parseJsonOutput(stdout, "Netlify draft deployment");
  const siteId = requireText(payload?.site_id, "Netlify draft site ID");
  const deployId = requireText(payload?.deploy_id, "Netlify draft deploy ID");
  const deployUrl = requireText(payload?.deploy_url, "Netlify draft deploy URL");

  if (
    !SITE_ID_PATTERN.test(siteId) ||
    siteId.toLowerCase() !== requireText(expectedSiteId, "Expected site ID").toLowerCase()
  ) {
    throw new Error("Netlify draft deployment did not target the protected site.");
  }
  if (!DEPLOY_ID_PATTERN.test(deployId)) {
    throw new Error("Netlify draft deployment returned an invalid deploy ID.");
  }

  let parsed;
  try {
    parsed = new URL(deployUrl);
  } catch {
    throw new Error("Netlify draft deployment returned an invalid preview URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.startsWith(deployId.toLowerCase() + "--") ||
    !parsed.hostname.endsWith(".netlify.app")
  ) {
    throw new Error("Netlify draft deployment returned an untrusted preview URL.");
  }

  return {
    siteId: siteId.toLowerCase(),
    deployId: deployId.toLowerCase(),
    deployUrl: parsed.origin,
  };
}

function parseDeployPermalink(value, expectedDeployId, label) {
  let parsed;
  try {
    parsed = new URL(requireText(value, label));
  } catch {
    throw new Error(label + " is not a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.startsWith(expectedDeployId + "--") ||
    !parsed.hostname.endsWith(".netlify.app")
  ) {
    throw new Error(label + " is not bound to the promoted deploy.");
  }
  return parsed.origin;
}

export function parsePromotedDeploy(stdout, expectedSiteId, expectedDeployId, expectedBaseUrl) {
  const payload = parseJsonOutput(stdout, "Netlify deploy promotion");
  const siteId = typeof payload?.site_id === "string" ? payload.site_id.trim().toLowerCase() : "";
  const deployId = typeof payload?.id === "string" ? payload.id.trim().toLowerCase() : "";
  const requiredSiteId = requireText(expectedSiteId, "Expected Netlify site ID").toLowerCase();
  const requiredDeployId = requireText(
    expectedDeployId,
    "Expected Netlify deploy ID",
  ).toLowerCase();
  const requiredBaseUrl = canonicalHttpsOrigin(expectedBaseUrl, "Expected production URL");
  if (
    !SITE_ID_PATTERN.test(requiredSiteId) ||
    !DEPLOY_ID_PATTERN.test(requiredDeployId) ||
    siteId !== requiredSiteId ||
    deployId !== requiredDeployId ||
    payload?.state !== "ready" ||
    payload?.draft !== false
  ) {
    throw new Error("Netlify did not attest the exact ready non-draft deploy promotion.");
  }

  const canonicalValues = [payload?.ssl_url, payload?.url].filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (
    canonicalValues.length === 0 ||
    canonicalValues.some(
      (value) => canonicalHttpsOrigin(value, "Netlify promoted canonical URL") !== requiredBaseUrl,
    )
  ) {
    throw new Error("Netlify deploy promotion did not attest the protected production origin.");
  }

  for (const [field, label] of [
    [payload?.deploy_ssl_url, "Netlify promoted deploy SSL URL"],
    [payload?.deploy_url, "Netlify promoted deploy URL"],
  ]) {
    if (typeof field === "string" && field.trim().length > 0) {
      parseDeployPermalink(field, requiredDeployId, label);
    }
  }
  if (
    payload?.published_at != null &&
    (typeof payload.published_at !== "string" || !Number.isFinite(Date.parse(payload.published_at)))
  ) {
    throw new Error("Netlify deploy promotion returned an invalid publication timestamp.");
  }

  return { siteId, deployId, baseUrl: requiredBaseUrl };
}

function updateHashFrame(hash, value) {
  const bytes = Buffer.from(String(value), "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function normaliseArtifactPath(value) {
  return value.split(sep).join("/");
}

async function pathStats(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function hashArtifactDirectory({ absoluteRoot, rootLabel, hash, totals }) {
  const rootStats = await pathStats(absoluteRoot);
  if (!rootStats) return false;
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Netlify artifact root is not a real directory: " + rootLabel);
  }
  const canonicalRoot = await realpath(absoluteRoot);
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const relativePath = normaliseArtifactPath(relative(absoluteRoot, absolutePath));
      const framedPath = rootLabel + "/" + relativePath;
      const stats = await lstat(absolutePath);

      if (stats.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      totals.fileCount += 1;
      if (totals.fileCount > MAX_ARTIFACT_FILES) {
        throw new Error("Netlify artifact exceeds the bounded file-count limit.");
      }

      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(absolutePath);
        if (isAbsolute(linkTarget)) {
          throw new Error(
            "Netlify artifact symbolic link must be relative and self-contained: " + framedPath,
          );
        }

        let resolvedTarget;
        try {
          resolvedTarget = await realpath(resolve(dirname(absolutePath), linkTarget));
        } catch (error) {
          const kind =
            error && typeof error === "object" && error.code === "ELOOP" ? "cyclic" : "broken";
          throw new Error(`Netlify artifact contains a ${kind} symbolic link: ${framedPath}`);
        }
        const relativeTarget = relative(canonicalRoot, resolvedTarget);
        if (
          isAbsolute(relativeTarget) ||
          relativeTarget === ".." ||
          relativeTarget.startsWith(`..${sep}`)
        ) {
          throw new Error("Netlify artifact symbolic link escapes its sealed root: " + framedPath);
        }
        const targetStats = await lstat(resolvedTarget);
        if (!targetStats.isFile() && !targetStats.isDirectory()) {
          throw new Error(
            "Netlify artifact symbolic link has an unsupported target type: " + framedPath,
          );
        }

        const linkBytes = Buffer.byteLength(linkTarget, "utf8");
        totals.byteCount += linkBytes;
        if (totals.byteCount > MAX_ARTIFACT_BYTES) {
          throw new Error("Netlify artifact exceeds the bounded byte-size limit.");
        }
        updateHashFrame(hash, "symlink");
        updateHashFrame(hash, framedPath);
        updateHashFrame(hash, linkTarget);
        updateHashFrame(hash, normaliseArtifactPath(relativeTarget));
        updateHashFrame(hash, targetStats.isDirectory() ? "directory" : "file");

        const after = await lstat(absolutePath);
        const afterTarget = await readlink(absolutePath);
        let afterResolvedTarget;
        try {
          afterResolvedTarget = await realpath(resolve(dirname(absolutePath), afterTarget));
        } catch {
          throw new Error("Netlify artifact symbolic link changed while it was being sealed.");
        }
        if (
          !after.isSymbolicLink() ||
          after.size !== stats.size ||
          after.mtimeMs !== stats.mtimeMs ||
          afterTarget !== linkTarget ||
          afterResolvedTarget !== resolvedTarget
        ) {
          throw new Error("Netlify artifact symbolic link changed while it was being sealed.");
        }
        continue;
      }
      if (stats.isFile()) {
        totals.byteCount += stats.size;
        if (totals.byteCount > MAX_ARTIFACT_BYTES) {
          throw new Error("Netlify artifact exceeds the bounded byte-size limit.");
        }
        updateHashFrame(hash, "file");
        updateHashFrame(hash, framedPath);
        updateHashFrame(hash, stats.size);
        for await (const chunk of createReadStream(absolutePath)) {
          hash.update(chunk);
        }
        const after = await lstat(absolutePath);
        if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs) {
          throw new Error("Netlify artifact changed while it was being sealed.");
        }
      } else {
        throw new Error("Netlify artifact contains an unsupported file type: " + framedPath);
      }
    }
  };

  const filesBefore = totals.fileCount;
  updateHashFrame(hash, "root");
  updateHashFrame(hash, rootLabel);
  await visit(absoluteRoot);
  return totals.fileCount > filesBefore;
}

export async function sealNetlifyArtifact(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const hash = createHash("sha256");
  const totals = { fileCount: 0, byteCount: 0 };
  const roots = [];
  let hasPublishOutput = false;
  let hasFrameworkOutput = false;

  for (const rootLabel of ARTIFACT_ROOTS) {
    const hasFiles = await hashArtifactDirectory({
      absoluteRoot: resolve(root, rootLabel),
      rootLabel,
      hash,
      totals,
    });
    if (!hasFiles) continue;
    roots.push(rootLabel);
    if (rootLabel === "apps/web/.next") hasPublishOutput = true;
    if (rootLabel.endsWith(".netlify/v1") || rootLabel.endsWith(".netlify/functions")) {
      hasFrameworkOutput = true;
    }
  }

  if (!hasPublishOutput || !hasFrameworkOutput) {
    throw new Error(
      "Netlify build did not produce complete publish and framework-function output.",
    );
  }
  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: totals.fileCount,
    byteCount: totals.byteCount,
    roots,
  };
}

function sameArtifactSeal(before, after) {
  return (
    before?.algorithm === "sha256" &&
    after?.algorithm === "sha256" &&
    /^[0-9a-f]{64}$/.test(before?.digest ?? "") &&
    before.digest === after.digest &&
    before.fileCount === after.fileCount &&
    before.byteCount === after.byteCount &&
    JSON.stringify(before.roots) === JSON.stringify(after.roots)
  );
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function smokeHeaders(extra = {}) {
  return {
    "user-agent": "PrompTED-production-smoke/2.0",
    ...extra,
  };
}

function requireCorsOrigin(response, browserOrigin, label) {
  const allowedOrigin = response.headers.get("access-control-allow-origin");
  if (allowedOrigin !== browserOrigin) {
    throw new Error(label + " did not return the exact Access-Control-Allow-Origin.");
  }
}

function requireCorsGetMethod(response, label) {
  const methods = (response.headers.get("access-control-allow-methods") ?? "")
    .split(",")
    .map((method) => method.trim().toUpperCase());
  if (!methods.includes("GET")) {
    throw new Error(label + " does not allow GET.");
  }
}

export async function smokeProductionWeb(
  baseUrl,
  {
    browserOrigin = baseUrl,
    expectedGitSha,
    supabaseUrl = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    fetchImpl = globalThis.fetch,
    attempts = 6,
    delayMs = 10_000,
  } = {},
) {
  const validatedBaseUrl = canonicalHttpsOrigin(baseUrl, "Smoke target URL");
  const validatedBrowserOrigin = canonicalHttpsOrigin(browserOrigin, "Browser Origin");
  const validatedGitSha = requireText(expectedGitSha, "Expected release commit");
  if (!GIT_SHA_PATTERN.test(validatedGitSha)) {
    throw new Error("Expected release commit must be a 40-character lowercase Git SHA.");
  }
  const validatedSupabaseOrigin = canonicalHttpsOrigin(supabaseUrl, "Supabase CORS probe URL");
  if (validatedSupabaseOrigin !== `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`) {
    throw new Error("Supabase CORS probe URL does not match the reviewed production project.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for production smoke checks.");
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error("Smoke attempts must be an integer between 1 and 20.");
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error("Smoke delay must be an integer between 0 and 60000 milliseconds.");
  }

  let lastError = new Error("Production smoke verification did not run.");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      for (const route of PUBLIC_SMOKE_ROUTES) {
        const url = new URL(route, validatedBaseUrl + "/").href;
        const response = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
          headers: smokeHeaders(),
        });
        if (!response.ok) {
          throw new Error(
            "Production smoke route " + route + " returned HTTP " + response.status + ".",
          );
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/html")) {
          throw new Error("Production smoke route " + route + " did not return HTML.");
        }
        const body = await response.text();
        if (!/<html(?:\s|>)/i.test(body)) {
          throw new Error(
            "Production smoke route " + route + " returned an invalid application shell.",
          );
        }
      }

      const attestationResponse = await fetchImpl(
        new URL(RELEASE_ATTESTATION_ROUTE, validatedBaseUrl + "/").href,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
          headers: smokeHeaders({ accept: "application/json" }),
        },
      );
      if (!attestationResponse.ok) {
        throw new Error("Release attestation returned HTTP " + attestationResponse.status + ".");
      }
      let attestation;
      try {
        attestation = await attestationResponse.json();
      } catch {
        throw new Error("Release attestation did not return valid JSON.");
      }
      if (attestation?.schemaVersion !== 1 || attestation?.gitSha !== validatedGitSha) {
        throw new Error("Release attestation does not match the requested Git commit.");
      }

      const directProtectedUrl = new URL(
        PROTECTED_SMOKE_ROUTE.replace("/api/", "/functions/v1/"),
        validatedSupabaseOrigin + "/",
      ).href;
      const preflight = await fetchImpl(directProtectedUrl, {
        method: "OPTIONS",
        redirect: "manual",
        signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
        headers: smokeHeaders({
          origin: validatedBrowserOrigin,
          "access-control-request-method": "GET",
        }),
      });
      if (!preflight.ok) {
        throw new Error(
          "Protected operation CORS preflight returned HTTP " + preflight.status + ".",
        );
      }
      requireCorsOrigin(preflight, validatedBrowserOrigin, "Protected operation CORS preflight");
      requireCorsGetMethod(preflight, "Protected operation CORS preflight");

      const directProtectedResponse = await fetchImpl(directProtectedUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
        headers: smokeHeaders({ origin: validatedBrowserOrigin }),
      });
      if (directProtectedResponse.status !== 401) {
        throw new Error(
          "Protected operation smoke returned HTTP " +
            directProtectedResponse.status +
            "; expected HTTP 401 for an unauthenticated browser request.",
        );
      }
      requireCorsOrigin(
        directProtectedResponse,
        validatedBrowserOrigin,
        "Protected operation response",
      );

      // The browser uses the stable same-origin application API. Its response
      // does not require CORS headers, but it must forward Origin upstream so
      // a broken production allow-list still fails as HTTP 403 rather than 401.
      const protectedUrl = new URL(PROTECTED_SMOKE_ROUTE, validatedBaseUrl + "/").href;
      const protectedResponse = await fetchImpl(protectedUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
        headers: smokeHeaders({ origin: validatedBrowserOrigin }),
      });
      if (protectedResponse.status !== 401) {
        throw new Error(
          "Application API smoke returned HTTP " +
            protectedResponse.status +
            "; expected HTTP 401 for an unauthenticated browser request.",
        );
      }

      return {
        baseUrl: validatedBaseUrl,
        routes: [...PUBLIC_SMOKE_ROUTES, RELEASE_ATTESTATION_ROUTE, PROTECTED_SMOKE_ROUTE],
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error("Production smoke verification failed: " + lastError.message);
}

function canonicalSmokeFailureError(candidateDeployId, priorDeployId, currentDeployId, outcome) {
  return new Error(
    "Canonical production smoke failed. Candidate deploy: " +
      candidateDeployId +
      ". Prior deploy: " +
      priorDeployId +
      ". Current deploy: " +
      (currentDeployId ?? "unknown") +
      ". Rollback outcome: " +
      outcome +
      ".",
  );
}

function rollbackAfterCanonicalSmokeFailure({
  spawnImpl,
  input,
  siteId,
  baseUrl,
  candidateDeployId,
  priorDeployId,
}) {
  let currentSite;
  try {
    currentSite = lookupNetlifySiteAttestation(
      spawnImpl,
      input,
      "Netlify post-smoke rollback preflight",
    );
  } catch {
    return canonicalSmokeFailureError(
      candidateDeployId,
      priorDeployId,
      null,
      "rollback_not_attempted_metadata_unavailable",
    );
  }

  const currentDeployId = currentSite.previousDeployId;
  if (currentDeployId !== candidateDeployId) {
    return canonicalSmokeFailureError(
      candidateDeployId,
      priorDeployId,
      currentDeployId,
      currentDeployId === priorDeployId ? "prior_already_published" : "rollback_skipped_site_moved",
    );
  }

  let rollbackAcknowledged = true;
  try {
    const rollbackResult = runProcess(
      spawnImpl,
      "netlify",
      buildNetlifyPromoteArgs(input, priorDeployId),
      netlifyProcessOptions(input.authToken, siteId),
      "Netlify prior deploy rollback",
    );
    parsePromotedDeploy(rollbackResult.stdout, siteId, priorDeployId, baseUrl);
  } catch {
    // The exact-prior restore may have succeeded even when the CLI timed out,
    // failed to acknowledge it, or returned malformed output. Reconcile once
    // against independent site metadata; never retry the mutation.
    rollbackAcknowledged = false;
  }

  let restoredSite;
  try {
    restoredSite = lookupNetlifySiteAttestation(
      spawnImpl,
      input,
      "Netlify prior deploy rollback attestation",
    );
  } catch {
    return canonicalSmokeFailureError(
      candidateDeployId,
      priorDeployId,
      null,
      "rollback_state_unknown_after_attempt",
    );
  }

  const restoredDeployId = restoredSite.previousDeployId;
  let rollbackOutcome;
  if (restoredDeployId === priorDeployId) {
    rollbackOutcome = rollbackAcknowledged
      ? "restored_prior_attested"
      : "restored_prior_after_ambiguous_ack";
  } else if (restoredDeployId === candidateDeployId) {
    rollbackOutcome = rollbackAcknowledged
      ? "rollback_acknowledged_but_candidate_still_published"
      : "rollback_failed_candidate_still_published";
  } else {
    rollbackOutcome = "rollback_not_attested_site_moved";
  }

  return canonicalSmokeFailureError(
    candidateDeployId,
    priorDeployId,
    restoredDeployId,
    rollbackOutcome,
  );
}

export async function deployNetlifyProduction(input, dependencies = {}) {
  const validated = validateProductionDeployInput(input);
  const spawnImpl = dependencies.spawnImpl ?? spawnSync;
  const sealArtifactImpl = dependencies.sealArtifactImpl ?? sealNetlifyArtifact;

  const gitResult = runProcess(
    spawnImpl,
    "git",
    ["rev-parse", "HEAD"],
    gitProcessOptions(),
    "Git revision attestation",
  );
  const checkedOutSha = requireText(gitResult.stdout, "Checked-out Git commit");
  if (checkedOutSha !== validated.gitSha) {
    throw new Error("The checked-out commit does not match the requested GITHUB_SHA.");
  }
  assertCleanGitWorktree(spawnImpl);

  const siteAttestation = lookupNetlifySiteAttestation(
    spawnImpl,
    input,
    "Netlify site identity preflight",
  );

  // Build exactly once and upload exactly once as a draft candidate. Netlify's
  // deploy command may rebundle Edge output even with --no-build, so a second
  // deploy command would not publish the already-smoked candidate. Production
  // publication therefore promotes the immutable draft deploy ID through the
  // reviewed API operation instead of rebuilding or re-uploading it.
  runProcess(
    spawnImpl,
    "netlify",
    buildNetlifyBuildArgs(input),
    netlifyProcessOptions(
      input.authToken,
      validated.siteId,
      {
        NEXT_PUBLIC_PROMPTED_BUILD_SHA: validated.gitSha,
      },
      NETLIFY_BUILD_TIMEOUT_MS,
    ),
    "Netlify production build",
  );
  assertCleanGitWorktree(spawnImpl, true);
  const sealedArtifact = await sealArtifactImpl(process.cwd());

  const draftResult = runProcess(
    spawnImpl,
    "netlify",
    buildNetlifyDraftDeployArgs(input),
    netlifyProcessOptions(input.authToken, validated.siteId, {}, NETLIFY_DEPLOY_TIMEOUT_MS),
    "Netlify draft deployment",
  );
  const draft = parseDraftDeploy(draftResult.stdout, validated.siteId);
  if (draft.deployId === siteAttestation.previousDeployId) {
    throw new Error(
      "The Netlify draft candidate matches the currently published deploy; refusing promotion.",
    );
  }
  await smokeProductionWeb(draft.deployUrl, {
    browserOrigin: validated.baseUrl,
    expectedGitSha: validated.gitSha,
    supabaseUrl: input.supabaseUrl,
    fetchImpl: dependencies.fetchImpl,
    attempts: dependencies.smokeAttempts,
    delayMs: dependencies.smokeDelayMs,
  });
  // Bind the exact configured browser credential to the reviewed Supabase
  // project before publishing the already-smoked deploy. The response body is
  // deliberately ignored and the key is never returned or included in an error.
  await preflightSupabaseAnonKey(input.supabaseUrl, input.supabaseAnonKey, {
    fetchImpl: dependencies.fetchImpl,
    timeoutMs: dependencies.supabaseAnonPreflightTimeoutMs,
  });

  const recheckedArtifact = await sealArtifactImpl(process.cwd());
  if (!sameArtifactSeal(sealedArtifact, recheckedArtifact)) {
    throw new Error(
      "The Netlify artifact changed after the draft upload; refusing to promote the candidate.",
    );
  }

  // A build, draft smoke, and key preflight can take long enough for a manual
  // deploy or production lock to appear after the initial identity check. The
  // restore API does not provide a compare-and-set precondition, so narrow that
  // race immediately before mutation and refuse to overwrite a changed release.
  const prePromotionSite = lookupNetlifySiteAttestation(
    spawnImpl,
    input,
    "Netlify pre-promotion site attestation",
  );
  if (prePromotionSite.previousDeployId !== siteAttestation.previousDeployId) {
    throw new Error(
      "The Netlify published deploy changed during the release; refusing to overwrite it.",
    );
  }

  let published = null;
  let promotionAttestation = "direct";
  let promotionFailure = null;
  try {
    const promotionResult = runProcess(
      spawnImpl,
      "netlify",
      buildNetlifyPromoteArgs(input, draft.deployId),
      netlifyProcessOptions(input.authToken, validated.siteId),
      "Netlify deploy promotion",
    );
    published = parsePromotedDeploy(
      promotionResult.stdout,
      validated.siteId,
      draft.deployId,
      validated.baseUrl,
    );
  } catch (error) {
    // The POST may have succeeded even if the CLI timed out or its response was
    // lost/malformed. Reconcile against independent site metadata instead of
    // abandoning a potentially live but unverified production mutation.
    promotionFailure = error instanceof Error ? error : new Error("Unknown promotion failure.");
    promotionAttestation = "reconciled";
  }

  let publishedSite;
  try {
    publishedSite = lookupNetlifySiteAttestation(
      spawnImpl,
      input,
      "Netlify published deploy attestation",
    );
  } catch {
    throw new Error(
      "Netlify promotion state is unknown after attempting deploy " +
        draft.deployId +
        ". Previous published deploy " +
        siteAttestation.previousDeployId +
        " remains the exact prior release reference.",
    );
  }
  if (publishedSite.previousDeployId !== draft.deployId) {
    throw new Error(
      (promotionFailure
        ? "Netlify deploy promotion could not be reconciled. "
        : "Netlify site metadata does not identify the promoted deploy as published. ") +
        "Expected " +
        draft.deployId +
        ", observed " +
        publishedSite.previousDeployId +
        ", prior " +
        siteAttestation.previousDeployId +
        ".",
    );
  }
  if (!published) {
    published = {
      siteId: publishedSite.siteId,
      deployId: draft.deployId,
      baseUrl: publishedSite.baseUrl,
    };
  }

  let production;
  try {
    production = await smokeProductionWeb(validated.baseUrl, {
      browserOrigin: validated.baseUrl,
      expectedGitSha: validated.gitSha,
      supabaseUrl: input.supabaseUrl,
      fetchImpl: dependencies.fetchImpl,
      attempts: dependencies.smokeAttempts,
      delayMs: dependencies.smokeDelayMs,
    });
  } catch {
    throw rollbackAfterCanonicalSmokeFailure({
      spawnImpl,
      input,
      siteId: validated.siteId,
      baseUrl: validated.baseUrl,
      candidateDeployId: published.deployId,
      priorDeployId: siteAttestation.previousDeployId,
    });
  }
  return {
    ...production,
    draftUrl: draft.deployUrl,
    deployId: published.deployId,
    draftDeployId: draft.deployId,
    previousDeployId: siteAttestation.previousDeployId,
    promotionAttestation,
  };
}

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set(["--site-id", "--git-sha", "--url"]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || values.has(key)) {
      throw new Error(
        "Usage: deploy-netlify-production.mjs --site-id <uuid> --git-sha <sha> --url <https-url>",
      );
    }
    values.set(key, value);
  }
  if (values.size !== allowed.size) {
    throw new Error(
      "Usage: deploy-netlify-production.mjs --site-id <uuid> --git-sha <sha> --url <https-url>",
    );
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const result = await deployNetlifyProduction({
    siteId: args.get("--site-id"),
    gitSha: args.get("--git-sha"),
    baseUrl: args.get("--url"),
    expectedBaseUrl: process.env.PROMPTED_PRODUCTION_URL,
    gitRef: process.env.GITHUB_REF,
    authToken: process.env.NETLIFY_AUTH_TOKEN,
    appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  console.log(
    "Netlify production deploy and public smoke checks passed for " +
      result.baseUrl +
      " at deploy " +
      result.deployId +
      " (promotion attestation: " +
      result.promotionAttestation +
      ")" +
      ": " +
      result.routes.join(", "),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
