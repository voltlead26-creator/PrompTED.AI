#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "refs/heads/main";
const SITE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const deploymentContract = JSON.parse(
  readFileSync(new URL("../supabase/deployment-contract.json", import.meta.url), "utf8"),
);
const PRODUCTION_SUPABASE_PROJECT_REF = deploymentContract.projectRef;
if (!/^[a-z0-9]{20}$/.test(PRODUCTION_SUPABASE_PROJECT_REF ?? "")) {
  throw new Error("The deployment contract does not identify the production Supabase project.");
}
const PUBLIC_SMOKE_ROUTES = ["/", "/sign-in", "/privacy"];
const PROTECTED_SMOKE_ROUTE =
  "/api/document-operation?operation_id=00000000-0000-4000-8000-000000000000";

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
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
  const supabaseAnonKey = requireText(input.supabaseAnonKey, "Supabase anonymous key");

  if (!SITE_ID_PATTERN.test(siteId)) {
    throw new Error("Netlify site ID must be a canonical UUID.");
  }
  if (!GIT_SHA_PATTERN.test(gitSha)) {
    throw new Error("Git commit SHA must be exactly 40 lowercase hexadecimal characters.");
  }
  if (gitRef !== PRODUCTION_REF) {
    throw new Error(`Production deployment is allowed only from ${PRODUCTION_REF}.`);
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
    parsedSupabaseUrl.origin !==
      `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` ||
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

  let parsedUrl;
  let parsedExpectedUrl;
  try {
    parsedUrl = new URL(suppliedUrl);
    parsedExpectedUrl = new URL(expectedUrl);
  } catch {
    throw new Error("Production URLs must be valid absolute URLs.");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedExpectedUrl.protocol !== "https:" ||
    parsedExpectedUrl.username ||
    parsedExpectedUrl.password ||
    parsedExpectedUrl.port ||
    parsedExpectedUrl.pathname !== "/" ||
    parsedExpectedUrl.search ||
    parsedExpectedUrl.hash ||
    parsedUrl.origin !== parsedExpectedUrl.origin
  ) {
    throw new Error("Production URL does not match the protected expected target.");
  }

  // Validate the token before mutation without returning or logging it.
  void authToken;
  return { siteId, gitSha, baseUrl: parsedExpectedUrl.origin };
}

export function buildNetlifyDeployArgs(input) {
  const { siteId, gitSha } = validateProductionDeployInput(input);
  return [
    "deploy",
    "--site",
    siteId,
    "--filter",
    "@prompted/web",
    "--build",
    "--prod",
    "--message",
    `Production deploy — ${gitSha}`,
  ];
}

export function buildNetlifyDraftDeployArgs(input) {
  const { siteId, gitSha } = validateProductionDeployInput(input);
  return [
    "deploy",
    "--site",
    siteId,
    "--filter",
    "@prompted/web",
    "--build",
    "--json",
    "--message",
    `Production candidate — ${gitSha}`,
  ];
}

export function parseDraftDeployUrl(stdout) {
  let payload;
  try {
    payload = JSON.parse(requireText(stdout, "Netlify draft deploy output"));
  } catch {
    throw new Error("Netlify draft deployment did not return valid JSON.");
  }
  const candidate = payload?.deploy_url ?? payload?.deploy_ssl_url ?? payload?.url;
  let parsed;
  try {
    parsed = new URL(requireText(candidate, "Netlify draft deploy URL"));
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
    !parsed.hostname.endsWith(".netlify.app")
  ) {
    throw new Error("Netlify draft deployment returned an untrusted preview URL.");
  }
  return parsed.origin;
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function smokeProductionWeb(
  baseUrl,
  {
    fetchImpl = globalThis.fetch,
    attempts = 6,
    delayMs = 10_000,
  } = {},
) {
  const parsed = validateProductionDeployInput({
    siteId: "00000000-0000-4000-8000-000000000000",
    gitSha: "0000000000000000000000000000000000000000",
    gitRef: PRODUCTION_REF,
    authToken: "validation-only",
    baseUrl,
    expectedBaseUrl: baseUrl,
    appEnvironment: "production",
    supabaseUrl: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    supabaseAnonKey: "validation-public-anon-value",
  });

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
        const url = new URL(route, `${parsed.baseUrl}/`).href;
        const response = await fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
          headers: { "user-agent": "PrompTED-production-smoke/1.0" },
        });
        if (!response.ok) {
          throw new Error(`Production smoke route ${route} returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/html")) {
          throw new Error(`Production smoke route ${route} did not return HTML.`);
        }
        const body = await response.text();
        if (!/<html(?:\s|>)/i.test(body)) {
          throw new Error(`Production smoke route ${route} returned an invalid application shell.`);
        }
      }

      const protectedResponse = await fetchImpl(
        new URL(PROTECTED_SMOKE_ROUTE, `${parsed.baseUrl}/`).href,
        {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
          headers: { "user-agent": "PrompTED-production-smoke/1.0" },
        },
      );
      if (![401, 403].includes(protectedResponse.status)) {
        throw new Error(
          `Protected operation smoke returned HTTP ${protectedResponse.status}; expected an authentication rejection.`,
        );
      }
      return {
        baseUrl: parsed.baseUrl,
        routes: [...PUBLIC_SMOKE_ROUTES, PROTECTED_SMOKE_ROUTE],
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error(`Production smoke verification failed: ${lastError.message}`);
}

export async function deployNetlifyProduction(input, dependencies = {}) {
  const validated = validateProductionDeployInput(input);
  const spawnImpl = dependencies.spawnImpl ?? spawnSync;

  // Upload and smoke a draft candidate first. Netlify deploys atomically, so
  // a failed draft cannot replace the currently published production deploy.
  const draftResult = spawnImpl("netlify", buildNetlifyDraftDeployArgs(input), {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      NETLIFY_AUTH_TOKEN: input.authToken,
    },
  });
  if (draftResult?.error) throw draftResult.error;
  if (draftResult?.status !== 0) {
    const detail = draftResult?.signal
      ? `signal ${draftResult.signal}`
      : `exit status ${String(draftResult?.status)}`;
    throw new Error(`Netlify draft deployment failed with ${detail}.`);
  }
  const draftUrl = parseDraftDeployUrl(draftResult.stdout);
  await smokeProductionWeb(draftUrl, {
    fetchImpl: dependencies.fetchImpl,
    attempts: dependencies.smokeAttempts,
    delayMs: dependencies.smokeDelayMs,
  });

  const result = spawnImpl("netlify", buildNetlifyDeployArgs(input), {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      NETLIFY_AUTH_TOKEN: input.authToken,
    },
  });
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    const detail = result?.signal
      ? `signal ${result.signal}`
      : `exit status ${String(result?.status)}`;
    throw new Error(`Netlify production deployment failed with ${detail}.`);
  }

  const production = await smokeProductionWeb(validated.baseUrl, {
    fetchImpl: dependencies.fetchImpl,
    attempts: dependencies.smokeAttempts,
    delayMs: dependencies.smokeDelayMs,
  });
  return { ...production, draftUrl };
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
    `Netlify production deploy and public smoke checks passed for ${result.baseUrl}: ${result.routes.join(", ")}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
