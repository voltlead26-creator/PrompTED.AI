#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_REVENUECAT_WEB_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_SUPABASE_PROJECT_ID",
  "NEXT_SUPABASE_URL",
  "NETLIFY_SITE_ID",
]);

const APPROVED_OMIT_KEY_SET = new Set(APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS);
const BUILD_DOTENV_FILES = Object.freeze([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
]);
const CONFIDENTIAL_NAME_PATTERN =
  /(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|TOKEN|SECRET|SECRET_KEY|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|DATABASE_URL|DATABASE_URI|DB_PASSWORD|DB_URL|DB_URI|JWT|JWT_SECRET|WEBHOOK_SECRET|KEY|CREDENTIALS?|CONNECTION_STRING|POSTGRES_URL|POSTGRES_URI|REDIS_URL|REDIS_URI|MONGODB_URI|AMQP_URL|SMTP_URL|DSN)$|^PGPASSWORD$/;
const CLOUD_SUPABASE_HOST_PATTERN = /^([a-z0-9]{20})\.supabase\.co$/;
const SUPABASE_PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,512}$/;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const NETLIFY_SITE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_SUPABASE_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCAL_APP_ENVIRONMENTS = new Set(["local", "development", "test"]);

function present(value) {
  return value != null && String(value).trim().length > 0;
}

export function isConfidentialWebBuildVariableName(name, { allowOuterNetlifyToken = false } = {}) {
  if (APPROVED_OMIT_KEY_SET.has(name)) return false;
  if (allowOuterNetlifyToken && name === "NETLIFY_AUTH_TOKEN") return false;
  return CONFIDENTIAL_NAME_PATTERN.test(name);
}

function requiredPublicText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is malformed.`);
  }
  return value.trim();
}

export function validateSupabasePublicAnonKey(value, { expectedProjectRef } = {}) {
  const key = requiredPublicText(value, "Supabase anonymous key");
  if (key.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("Supabase anonymous key is malformed.");
  }
  if (SUPABASE_PUBLISHABLE_KEY_PATTERN.test(key)) return key;

  const segments = key.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !segment || !JWT_SEGMENT_PATTERN.test(segment))
  ) {
    throw new Error("Supabase anonymous key is malformed.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Supabase anonymous key is malformed.");
  }
  if (!payload || typeof payload !== "object" || payload.role !== "anon") {
    throw new Error("Supabase anonymous key must carry only the anon role.");
  }
  if (
    expectedProjectRef !== undefined &&
    (!/^[a-z0-9]{20}$/.test(expectedProjectRef) || payload.ref !== expectedProjectRef)
  ) {
    throw new Error("Supabase anonymous key is not bound to the configured project.");
  }
  return key;
}

function validateSupabaseOrigin(value, { appEnvironment, label }) {
  let parsed;
  try {
    parsed = new URL(requiredPublicText(value, label));
  } catch {
    throw new Error(`${label} must be an approved Supabase origin.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(`${label} must not contain credentials, paths, queries, or fragments.`);
  }

  const projectRef =
    parsed.protocol === "https:"
      ? (parsed.hostname.match(CLOUD_SUPABASE_HOST_PATTERN)?.[1] ?? null)
      : null;
  const isLocal =
    parsed.protocol === "http:" &&
    LOCAL_SUPABASE_HOSTS.has(parsed.hostname) &&
    parsed.port.length > 0 &&
    LOCAL_APP_ENVIRONMENTS.has(appEnvironment);
  const isSyntheticTest =
    appEnvironment === "test" &&
    parsed.protocol === "https:" &&
    parsed.hostname === "example.supabase.co";
  if (!projectRef && !isLocal && !isSyntheticTest) {
    throw new Error(`${label} must be an exact Supabase project origin.`);
  }
  return { origin: parsed.origin, projectRef };
}

function validateSentryDsn(value) {
  let parsed;
  try {
    parsed = new URL(requiredPublicText(value, "NEXT_PUBLIC_SENTRY_DSN"));
  } catch {
    return false;
  }
  return Boolean(
    parsed.protocol === "https:" &&
    parsed.hostname &&
    parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    parsed.pathname !== "/",
  );
}

function validateApprovedPublicIdentifierValues(environment) {
  const failures = [];
  const appEnvironment = String(environment.NEXT_PUBLIC_APP_ENV ?? "")
    .trim()
    .toLowerCase();
  const origins = new Map();
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_SUPABASE_URL"]) {
    if (!present(environment[name])) continue;
    try {
      origins.set(name, validateSupabaseOrigin(environment[name], { appEnvironment, label: name }));
    } catch {
      failures.push(`${name} is not a credential-free approved Supabase origin.`);
    }
  }

  const publicOrigin = origins.get("NEXT_PUBLIC_SUPABASE_URL");
  const integrationOrigin = origins.get("NEXT_SUPABASE_URL");
  if (publicOrigin && integrationOrigin && publicOrigin.origin !== integrationOrigin.origin) {
    failures.push("NEXT_PUBLIC_SUPABASE_URL and NEXT_SUPABASE_URL must identify the same origin.");
  }

  const projectId = present(environment.NEXT_SUPABASE_PROJECT_ID)
    ? String(environment.NEXT_SUPABASE_PROJECT_ID).trim()
    : null;
  if (projectId && !/^[a-z0-9]{20}$/.test(projectId)) {
    failures.push("NEXT_SUPABASE_PROJECT_ID must be a canonical public project reference.");
  }
  for (const [name, origin] of origins) {
    if (projectId && origin.projectRef && origin.projectRef !== projectId) {
      failures.push(`${name} must match NEXT_SUPABASE_PROJECT_ID.`);
    }
  }

  if (present(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    try {
      validateSupabasePublicAnonKey(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        expectedProjectRef: publicOrigin?.projectRef ?? integrationOrigin?.projectRef ?? undefined,
      });
    } catch {
      failures.push("NEXT_PUBLIC_SUPABASE_ANON_KEY must be a public anon credential.");
    }
  }

  if (
    present(environment.NETLIFY_SITE_ID) &&
    !NETLIFY_SITE_ID_PATTERN.test(String(environment.NETLIFY_SITE_ID).trim())
  ) {
    failures.push("NETLIFY_SITE_ID must be a canonical public site identifier.");
  }
  if (
    present(environment.NEXT_PUBLIC_REVENUECAT_WEB_KEY) &&
    !/^(?:rcb|test)_[A-Za-z0-9_-]{8,512}$/.test(
      String(environment.NEXT_PUBLIC_REVENUECAT_WEB_KEY).trim(),
    )
  ) {
    failures.push("NEXT_PUBLIC_REVENUECAT_WEB_KEY must be a public Web Billing SDK key.");
  }
  if (
    present(environment.NEXT_PUBLIC_POSTHOG_KEY) &&
    !/^phc_[A-Za-z0-9_-]{8,512}$/.test(String(environment.NEXT_PUBLIC_POSTHOG_KEY).trim())
  ) {
    failures.push("NEXT_PUBLIC_POSTHOG_KEY must be a public project key.");
  }
  if (
    present(environment.NEXT_PUBLIC_SENTRY_DSN) &&
    !validateSentryDsn(environment.NEXT_PUBLIC_SENTRY_DSN)
  ) {
    failures.push("NEXT_PUBLIC_SENTRY_DSN must be a public HTTPS ingestion DSN.");
  }
  return failures;
}

export function parseDotEnvVariableNames(text) {
  const names = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) names.push(match[1]);
  }
  return names;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function validateWebBuildEnvironment({
  environment = {},
  dotEnvSources = [],
  allowOuterNetlifyToken = false,
} = {}) {
  const failures = [];
  const environmentNames = Object.entries(environment)
    .filter(([, value]) => present(value))
    .map(([name]) => name);
  const confidentialEnvironmentNames = sortedUnique(
    environmentNames.filter((name) =>
      isConfidentialWebBuildVariableName(name, { allowOuterNetlifyToken }),
    ),
  );
  if (confidentialEnvironmentNames.length > 0) {
    failures.push(
      "Confidential variables must not enter the web build environment: " +
        confidentialEnvironmentNames.join(", ") +
        ".",
    );
  }
  failures.push(...validateApprovedPublicIdentifierValues(environment));

  const confidentialDotEnvNames = [];
  for (const source of dotEnvSources) {
    for (const name of source.names ?? []) {
      if (isConfidentialWebBuildVariableName(name)) {
        confidentialDotEnvNames.push(`${name} (${source.path})`);
      }
    }
    const sourceFailures = validateApprovedPublicIdentifierValues(source.environment ?? {});
    failures.push(...sourceFailures.map((failure) => `${failure} (${source.path})`));
  }
  if (confidentialDotEnvNames.length > 0) {
    failures.push(
      "Confidential variables must not be stored in web build dotenv files: " +
        sortedUnique(confidentialDotEnvNames).join(", ") +
        ".",
    );
  }

  const secretScanEnabled = String(environment.SECRETS_SCAN_ENABLED ?? "")
    .trim()
    .toLowerCase();
  if (secretScanEnabled && secretScanEnabled !== "true") {
    failures.push("SECRETS_SCAN_ENABLED must be exactly true when it is configured.");
  }

  if (present(environment.SECRETS_SCAN_OMIT_PATHS)) {
    failures.push("SECRETS_SCAN_OMIT_PATHS must be empty so every generated artifact is scanned.");
  }

  const unsupportedOmitKeys = sortedUnique(
    String(environment.SECRETS_SCAN_OMIT_KEYS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => !APPROVED_OMIT_KEY_SET.has(name)),
  );
  if (unsupportedOmitKeys.length > 0) {
    failures.push(
      "SECRETS_SCAN_OMIT_KEYS contains variables that are not reviewed public identifiers: " +
        unsupportedOmitKeys.join(", ") +
        ".",
    );
  }

  return failures;
}

async function loadDotEnvSources(repoRoot) {
  const sources = [];
  const roots = [repoRoot, resolve(repoRoot, "apps/web")];
  for (const root of roots) {
    for (const fileName of BUILD_DOTENV_FILES) {
      const absolutePath = resolve(root, fileName);
      let text;
      try {
        text = await readFile(absolutePath, "utf8");
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") continue;
        throw error;
      }
      const sourcePath = relative(repoRoot, absolutePath) || fileName;
      let environment;
      try {
        environment = parseEnv(text);
      } catch {
        throw new Error(`Web build dotenv file could not be parsed safely: ${sourcePath}.`);
      }
      sources.push({
        path: sourcePath,
        names: parseDotEnvVariableNames(text),
        environment,
      });
    }
  }
  return sources;
}

export async function assertWebBuildEnvironmentSafe({
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  environment = process.env,
  allowOuterNetlifyToken = false,
} = {}) {
  const dotEnvSources = await loadDotEnvSources(repoRoot);
  const failures = validateWebBuildEnvironment({
    environment,
    dotEnvSources,
    allowOuterNetlifyToken,
  });
  if (failures.length > 0) {
    throw new Error("Web build environment security check failed:\n- " + failures.join("\n- "));
  }
}

async function main() {
  await assertWebBuildEnvironmentSafe();
  console.log("Web build environment security check passed.");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Web build environment check failed.");
    process.exitCode = 1;
  });
}
