#!/usr/bin/env node
// Validates supabase/deployment-contract.json against the rest of the repo:
// supabase/config.toml (which functions are actually configured for deploy),
// the root netlify.toml, the environment-scoped Next.js API gateway, and a
// static scan of each Edge Function's own source plus the _shared/ modules it
// imports (which RPCs it actually calls). This is a *static* check -- it never
// talks to a live database. scripts/probe-supabase-contract.mjs does that half,
// against a real project, right before functions are deployed.
//
// Why this exists: an Edge Function can be deployed ahead of the migration
// that defines an RPC it depends on (e.g. `clarify` calling
// `consume_rate_limit` before 20260819000000_add_durable_rate_limits.sql is
// applied live). This script makes that class of mistake fail fast and
// loud, in CI, before anything is deployed.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const CONTRACT_PATH = "supabase/deployment-contract.json";
const CONFIG_TOML_PATH = "supabase/config.toml";
const NETLIFY_TOML_PATH = "netlify.toml";
const SECOND_NETLIFY_TOML_PATH = "apps/web/netlify.toml";
const WEB_API_GATEWAY_PATH = "apps/web/src/app/api/[...segments]/route.ts";
const WEB_API_PROXY_PATH = "apps/web/src/lib/edge-function-proxy.ts";
const FUNCTIONS_DIR = "supabase/functions";
const WORKFLOWS_DIR = ".github/workflows";
const PRODUCTION_DEPLOY_WORKFLOW = "deploy-prod.yml";
const FUNCTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RAW_PROVIDER_COMPATIBILITY_FUNCTIONS = [
  "openai-chat",
  "openai-responses",
  "openai-stream",
];

// ---- parsing helpers ------------------------------------------------------

export function parseConfigToml(text) {
  const functions = new Map();
  const sectionRe = /\[functions\.(?:"([^"]+)"|([a-zA-Z0-9_-]+))\]([\s\S]*?)(?=\n\[|\s*$)/g;
  let match;
  while ((match = sectionRe.exec(text))) {
    const name = match[1] ?? match[2];
    const body = match[3];
    const enabledMatch = body.match(/enabled\s*=\s*(true|false)/);
    const verifyJwtMatch = body.match(/verify_jwt\s*=\s*(true|false)/);
    functions.set(name, {
      enabled: enabledMatch ? enabledMatch[1] === "true" : true,
      verifyJwt: verifyJwtMatch ? verifyJwtMatch[1] === "true" : true,
    });
  }
  return functions;
}

export function parseConfigProjectId(text) {
  const match = text.match(/^project_id\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

export function parseNetlifyRedirects(text) {
  const redirects = [];
  const blockRe = /\[\[redirects\]\]([\s\S]*?)(?=\n\[\[|\n\[[a-zA-Z]|$)/g;
  let match;
  while ((match = blockRe.exec(text))) {
    const block = match[1];
    const from = block.match(/from\s*=\s*"([^"]+)"/)?.[1];
    const to = block.match(/to\s*=\s*"([^"]+)"/)?.[1];
    if (from && to) redirects.push({ from, to });
  }
  return redirects;
}

function parseNetlifyBuildEnvironmentValue(text, key) {
  const sectionMarker = "[build.environment]";
  const sectionStart = text.indexOf(sectionMarker);
  if (sectionStart === -1) return null;

  const sectionRemainder = text.slice(sectionStart + sectionMarker.length);
  const nextSectionOffset = sectionRemainder.search(/^\s*\[/m);
  const sectionBody =
    nextSectionOffset === -1 ? sectionRemainder : sectionRemainder.slice(0, nextSectionOffset);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    sectionBody.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]*)"\\s*$`, "m"))?.[1] ?? null
  );
}

export function validateNetlifySecretScanConfig(text) {
  const failures = [];
  if (parseNetlifyBuildEnvironmentValue(text, "NODE_VERSION") !== "22.23.2") {
    failures.push('netlify.toml must pin NODE_VERSION to "22.23.2".');
  }
  if (parseNetlifyBuildEnvironmentValue(text, "PNPM_VERSION") !== "10.33.0") {
    failures.push('netlify.toml must pin PNPM_VERSION to "10.33.0".');
  }
  const omitKeys = new Set(
    (parseNetlifyBuildEnvironmentValue(text, "SECRETS_SCAN_OMIT_KEYS") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );

  for (const publicIdentifierKey of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]) {
    if (!omitKeys.has(publicIdentifierKey)) {
      failures.push(
        `netlify.toml must include public identifier key "${publicIdentifierKey}" in ` +
          "SECRETS_SCAN_OMIT_KEYS so expected Next.js bundle values do not fail the deploy.",
      );
    }
  }

  if (parseNetlifyBuildEnvironmentValue(text, "SECRETS_SCAN_ENABLED") === "false") {
    failures.push("netlify.toml must not disable secret scanning with SECRETS_SCAN_ENABLED=false.");
  }

  const omitPaths = (parseNetlifyBuildEnvironmentValue(text, "SECRETS_SCAN_OMIT_PATHS") ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  if (omitPaths.some((path) => path.includes(".next") || path.includes(".netlify"))) {
    failures.push("netlify.toml must not omit generated Next.js or Netlify output from secret scanning.");
  }

  if (/package\s*=\s*["']@netlify\/plugin-nextjs["']/.test(text)) {
    failures.push(
      "netlify.toml must not pin the legacy Next.js plugin; Netlify must apply its current OpenNext adapter automatically.",
    );
  }

  return failures;
}

function parseWorkflowEnvironmentValue(workflowBlock, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return workflowBlock.match(new RegExp(`^\\s+${escapedKey}:\\s*([^\\n#]+?)\\s*$`, "m"))?.[1] ?? null;
}

export function functionNameFromFunctionsUrl(url) {
  const match = url.match(/\/functions\/v1\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function projectRefFromUrl(url) {
  try {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.port
    ) {
      return null;
    }
    return target.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// ---- deployment-workflow scan -----------------------------------------------

// Finds every line in a workflow file that invokes `supabase functions
// deploy`. There should be exactly one shape of this command across all
// function-deploying workflows: named, contract-driven (see
// isContractDrivenDeployCommand) -- never a blanket deploy that ignores
// each function's declared `status`.
export function findFunctionsDeployCommands(workflowText) {
  const commands = [];
  for (const line of workflowText.split("\n")) {
    if (
      /supabase functions deploy\b/.test(line) ||
      /node scripts\/deploy-contract-functions\.mjs\b/.test(line)
    ) {
      commands.push(line.trim().replace(/^run:\s*/, ""));
    }
  }
  return commands;
}

// A deploy command is "contract-driven" when it names functions from the
// production workflow's safe launcher rather than deploying everything
// supabase/config.toml has enabled. A blanket `supabase functions deploy
// --use-api` with no name list would still redeploy a function this
// contract marks "retired", so that shape is rejected.
export function isContractDrivenDeployCommand(line) {
  return /^node scripts\/deploy-contract-functions\.mjs --project-ref "\$SUPABASE_PROJECT_REF"$/.test(
    line,
  );
}

function workflowJobBlock(workflowText, jobName) {
  const lines = workflowText.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[a-zA-Z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function workflowJobNames(workflowText) {
  const lines = workflowText.split("\n");
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  if (jobsIndex === -1) return [];
  const names = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (match) names.push(match[1]);
  }
  return names;
}

function hasExplicitPermissions(workflowText, indentation) {
  const inlineEmptyPermissions = new RegExp(
    `^${indentation}permissions:\\s*\\{\\}\\s*(?:#.*)?$`,
    "m",
  );
  const permissionMapping = new RegExp(
    `^${indentation}permissions:\\s*\\n(?:${indentation}  [a-z-]+:\\s*(?:read|write|none)\\s*(?:#.*)?\\n?)+`,
    "m",
  );

  return inlineEmptyPermissions.test(workflowText) || permissionMapping.test(workflowText);
}

export function validateWorkflowAuthority(workflowFile, workflowText) {
  const failures = [];

  if (!hasExplicitPermissions(workflowText, "")) {
    failures.push(`Workflow "${workflowFile}" must declare explicit top-level permissions.`);
  }
  if (/^\s+contents:\s*write\s*$/m.test(workflowText)) {
    failures.push(`Workflow "${workflowFile}" must not grant contents: write.`);
  }

  for (const jobName of workflowJobNames(workflowText)) {
    const block = workflowJobBlock(workflowText, jobName);
    if (block && !hasExplicitPermissions(block, "    ")) {
      failures.push(
        `Workflow "${workflowFile}" job "${jobName}" must declare explicit permissions.`,
      );
    }
  }

  const prohibitedBranchWriting = [
    [/\bgit\s+push\b/, "git push"],
    [/\bgit\s+add\s+(?:-A|\.)\b/, "broad git add"],
    [/\bgit\s+checkout\s+--ours\b/, "automatic --ours conflict resolution"],
    [/\bgit\s+rebase\b/, "git rebase"],
    [/\bgit\s+merge\b/, "git merge"],
  ];
  for (const [pattern, label] of prohibitedBranchWriting) {
    if (pattern.test(workflowText)) {
      failures.push(`Workflow "${workflowFile}" contains prohibited branch-writing automation: ${label}.`);
    }
  }

  if (
    workflowFile !== PRODUCTION_DEPLOY_WORKFLOW &&
    /(?:\b(?:supabase\s+(?:link|db\s+push|functions\s+deploy)|netlify\s+deploy)\b|\bnode\s+scripts\/deploy-netlify-production\.mjs\b)/.test(workflowText)
  ) {
    failures.push(
      `Workflow "${workflowFile}" is an independent deployment route; hosted deployment is owned by "${PRODUCTION_DEPLOY_WORKFLOW}".`,
    );
  }

  return failures;
}

export function validateProductionWorkflow(workflowText) {
  const failures = [];
  if (!/^permissions:\s*\{\}\s*$/m.test(workflowText)) {
    failures.push('Production workflow must set top-level permissions to "{}".');
  }
  if (
    !/^concurrency:\s*\n {2}group:\s*production-release\s*\n {2}cancel-in-progress:\s*false\s*$/m.test(
      workflowText,
    )
  ) {
    failures.push(
      'Production workflow must use "production-release" concurrency with cancel-in-progress: false.',
    );
  }

  const verifyJob = workflowJobBlock(workflowText, "verify-release");
  const functionsJob = workflowJobBlock(workflowText, "deploy-functions-prod");
  const webJob = workflowJobBlock(workflowText, "deploy-web-prod");
  if (!verifyJob || !/pnpm verify:web/.test(verifyJob)) {
    failures.push(
      'Production workflow must contain a "verify-release" job that runs pnpm verify:web.',
    );
  }
  if (
    !verifyJob ||
    !/GITHUB_REF/.test(verifyJob) ||
    !/refs\/heads\/main/.test(verifyJob)
  ) {
    failures.push(
      'Production verification must refuse every ref except "refs/heads/main".',
    );
  }
  if (!functionsJob || !/^ {4}needs:\s*verify-release\s*$/m.test(functionsJob)) {
    failures.push(
      'Production function deployment must need "verify-release".',
    );
  }
  if (!webJob || !/^ {4}needs:\s*deploy-functions-prod\s*$/m.test(webJob)) {
    failures.push(
      'Production web deployment must need "deploy-functions-prod".',
    );
  }

  for (const [name, block] of [
    ["deploy-functions-prod", functionsJob],
    ["deploy-web-prod", webJob],
  ]) {
    if (block && !/^ {4}environment:\s*PrompTED\.AI\s*$/m.test(block)) {
      failures.push(`Production mutation job "${name}" must use the protected PrompTED.AI environment.`);
    }
  }


  if (webJob) {
    if (!/npm install -g netlify-cli@27\.3\.0/.test(webJob)) {
      failures.push("Production web deployment must install the pinned netlify-cli@27.3.0 release.");
    }
    if (!/node scripts\/deploy-netlify-production\.mjs\b/.test(webJob)) {
      failures.push(
        "Production web deployment must use the validated shell-free Netlify production launcher.",
      );
    }
    if (/\bnetlify\s+deploy\b/.test(webJob)) {
      failures.push("Production workflow must not invoke netlify deploy through raw shell syntax.");
    }
    if (parseWorkflowEnvironmentValue(webJob, "NEXT_PUBLIC_APP_ENV") !== "production") {
      failures.push(
        "Production web deployment must set NEXT_PUBLIC_APP_ENV to production.",
      );
    }

    const omitKeys = new Set(
      (parseWorkflowEnvironmentValue(webJob, "SECRETS_SCAN_OMIT_KEYS") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    );
    for (const publicIdentifierKey of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]) {
      if (!omitKeys.has(publicIdentifierKey)) {
        failures.push(
          `Production web deployment must include "${publicIdentifierKey}" in SECRETS_SCAN_OMIT_KEYS.`,
        );
      }
    }

    const omitPaths = (parseWorkflowEnvironmentValue(webJob, "SECRETS_SCAN_OMIT_PATHS") ?? "")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
    if (omitPaths.some((path) => path.includes(".next") || path.includes(".netlify"))) {
      failures.push(
        "Production web deployment must not omit generated Next.js or Netlify output from secret scanning.",
      );
    }
  }

  if (functionsJob) {
    if (!/node scripts\/check-supabase-secret-names\.mjs\b/.test(functionsJob)) {
      failures.push(
        "Production Supabase deployment must validate required secret names before mutation.",
      );
    }
    const targetValidationIndex = functionsJob.indexOf("SUPABASE_PROBE_MODE: target");
    const secretValidationIndex = functionsJob.indexOf(
      "node scripts/check-supabase-secret-names.mjs",
    );
    const mutationIndexes = [
      functionsJob.indexOf("supabase link"),
      functionsJob.indexOf("supabase db push"),
      functionsJob.indexOf("deploy-contract-functions.mjs"),
    ].filter((index) => index >= 0);
    const firstMutationIndex = mutationIndexes.length > 0
      ? Math.min(...mutationIndexes)
      : -1;
    if (
      targetValidationIndex === -1 ||
      secretValidationIndex === -1 ||
      firstMutationIndex === -1 ||
      targetValidationIndex > firstMutationIndex ||
      secretValidationIndex > firstMutationIndex
    ) {
      failures.push(
        "Production target identity must be validated before the first Supabase mutation.",
      );
    }
  }

  for (const [name, block] of [
    ["verify-release", verifyJob],
    ["deploy-functions-prod", functionsJob],
    ["deploy-web-prod", webJob],
  ]) {
    if (block && !/^ {4}permissions:\s*\n {6}contents:\s*read\s*$/m.test(block)) {
      failures.push(`Production job "${name}" must declare contents: read.`);
    }
  }
  return failures;
}

export function scanRpcCalls(source) {
  const rpcs = new Set();
  for (const match of source.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) {
    rpcs.add(match[1]);
  }
  return rpcs;
}

// ---- static per-function RPC dependency-closure scan -----------------------

// Follows relative imports one directory level deep (into _shared/) so that
// a function which imports _shared/auth-guard.ts (which itself imports
// _shared/rate-limiter.ts, which calls consume_rate_limit) is credited with
// that RPC call, matching what actually happens at runtime.
async function collectSourceClosure(repoRoot, entryFile, visited = new Set()) {
  const absolute = join(repoRoot, entryFile);
  if (visited.has(absolute) || !existsSync(absolute)) return "";
  visited.add(absolute);

  const content = await readFile(absolute, "utf8");
  let combined = content;

  const importRe = /from\s+["'](\.\.?\/[^"']+)["']/g;
  let match;
  while ((match = importRe.exec(content))) {
    let specifier = match[1];
    if (!specifier.endsWith(".ts")) specifier += ".ts";
    const resolved = join(dirname(entryFile), specifier);
    combined += "\n" + (await collectSourceClosure(repoRoot, resolved, visited));
  }

  return combined;
}

export async function scanFunctionRpcUsage(repoRoot, functionNames) {
  const usage = new Map();
  for (const name of functionNames) {
    const entryPath = `${FUNCTIONS_DIR}/${name}/index.ts`;
    if (!existsSync(join(repoRoot, entryPath))) {
      usage.set(name, new Set());
      continue;
    }
    const closure = await collectSourceClosure(repoRoot, entryPath);
    usage.set(name, scanRpcCalls(closure));
  }
  return usage;
}

export async function scanActiveRawProxyConsumers(repoRoot, manifest) {
  const consumers = new Set();
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry?.status !== "active") continue;
    const entryPath = `${FUNCTIONS_DIR}/${name}/index.ts`;
    const closure = await collectSourceClosure(repoRoot, entryPath);
    if (closure.includes("Stable raw-endpoint compatibility façade.")) {
      consumers.add(name);
    }
  }
  return consumers;
}

// ---- repo state loading -----------------------------------------------------

export async function loadRepoState(repoRoot) {
  const manifest = JSON.parse(await readFile(join(repoRoot, CONTRACT_PATH), "utf8"));
  const configTomlText = await readFile(join(repoRoot, CONFIG_TOML_PATH), "utf8");
  const netlifyTomlText = await readFile(join(repoRoot, NETLIFY_TOML_PATH), "utf8");
  const webApiGatewaySource = await readFile(join(repoRoot, WEB_API_GATEWAY_PATH), "utf8");
  const webApiProxySource = await readFile(join(repoRoot, WEB_API_PROXY_PATH), "utf8");

  const configFunctions = parseConfigToml(configTomlText);
  const configProjectId = parseConfigProjectId(configTomlText);
  const redirects = parseNetlifyRedirects(netlifyTomlText);

  let netlifyManifestCount = existsSync(join(repoRoot, NETLIFY_TOML_PATH)) ? 1 : 0;
  if (existsSync(join(repoRoot, SECOND_NETLIFY_TOML_PATH))) netlifyManifestCount += 1;

  const functionNames = Object.keys(manifest.functions ?? {});
  const functionRpcUsage = await scanFunctionRpcUsage(repoRoot, functionNames);
  const activeRawProxyConsumers = await scanActiveRawProxyConsumers(repoRoot, manifest);

  const workflowDeployCommands = new Map();
  const workflowTexts = new Map();
  let productionWorkflowText = null;
  const workflowFiles = await readdir(join(repoRoot, WORKFLOWS_DIR));
  for (const workflowFile of workflowFiles) {
    if (!/\.ya?ml$/.test(workflowFile)) continue;
    const workflowPath = join(repoRoot, WORKFLOWS_DIR, workflowFile);
    const workflowText = await readFile(workflowPath, "utf8");
    workflowTexts.set(workflowFile, workflowText);
    if (workflowFile === PRODUCTION_DEPLOY_WORKFLOW) {
      productionWorkflowText = workflowText;
    }
    const commands = findFunctionsDeployCommands(workflowText);
    if (commands.length > 0) {
      workflowDeployCommands.set(workflowFile, commands);
    }
  }

  return {
    manifest,
    configFunctions,
    configProjectId,
    redirects,
    netlifyTomlText,
    webApiGatewaySource,
    webApiProxySource,
    netlifyManifestCount,
    functionRpcUsage,
    activeRawProxyConsumers,
    workflowDeployCommands,
    workflowTexts,
    productionWorkflowText,
  };
}

// ---- validation --------------------------------------------------------------

export function validateContract(state) {
  const {
    manifest,
    configFunctions,
    configProjectId,
    redirects,
    netlifyTomlText,
    webApiGatewaySource,
    webApiProxySource,
    netlifyManifestCount,
    functionRpcUsage,
    activeRawProxyConsumers,
    workflowDeployCommands,
    workflowTexts,
    productionWorkflowText,
  } = state;
  const failures = [];

  for (const name of RAW_PROVIDER_COMPATIBILITY_FUNCTIONS) {
    const entry = manifest.functions?.[name];
    const configured = configFunctions.get(name);
    if (!entry || entry.status !== "dormant") {
      failures.push(
        `Raw provider compatibility function "${name}" must remain dormant; ` +
          "production inference is available only through task-specific semantic routes.",
      );
    }
    if (!configured || configured.enabled !== false) {
      failures.push(
        `supabase/config.toml must set enabled=false for dormant raw provider function "${name}".`,
      );
    }
    if (entry?.clientRoute != null) {
      failures.push(
        `Dormant raw provider function "${name}" must not expose a client route.`,
      );
    }
  }
  for (const name of activeRawProxyConsumers ?? []) {
    failures.push(
      `Active function "${name}" imports the dormant raw provider compatibility façade; ` +
        "use the semantic OpenAI route and a task-specific contract instead.",
    );
  }

  if (typeof netlifyTomlText === "string") {
    failures.push(...validateNetlifySecretScanConfig(netlifyTomlText));
  }

  for (const [workflowFile, workflowText] of workflowTexts ?? []) {
    failures.push(...validateWorkflowAuthority(workflowFile, workflowText));
  }

  if (typeof productionWorkflowText === "string") {
    failures.push(...validateProductionWorkflow(productionWorkflowText));
  }

  if (netlifyManifestCount !== 1) {
    failures.push(
      `Expected exactly one Netlify manifest (root netlify.toml); found ${netlifyManifestCount}. ` +
        `Consolidate routes into the root netlify.toml.`,
    );
  }

  if (
    typeof webApiGatewaySource !== "string" ||
    !webApiGatewaySource.includes("proxyEdgeFunctionRequest") ||
    !webApiGatewaySource.includes('runtime = "nodejs"')
  ) {
    failures.push(
      `The stable browser API surface must be owned by ${WEB_API_GATEWAY_PATH}.`,
    );
  }
  if (
    typeof webApiProxySource !== "string" ||
    !webApiProxySource.includes("deployment-contract.json") ||
    !webApiProxySource.includes("getPublicSupabaseConfig") ||
    !webApiProxySource.includes('entry.status !== "active"') ||
    !webApiProxySource.includes("/functions/v1/")
  ) {
    failures.push(
      `The API gateway proxy must derive active routes and the selected Supabase environment in ${WEB_API_PROXY_PATH}.`,
    );
  }
  if (/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(netlifyTomlText ?? "")) {
    failures.push(
      "netlify.toml must not pin browser API traffic to one Supabase project; use the environment-scoped Next.js gateway.",
    );
  }

  if (configProjectId && manifest.projectRef !== configProjectId) {
    failures.push(
      `supabase/config.toml project_id ("${configProjectId}") does not match ` +
        `deployment-contract.json projectRef ("${manifest.projectRef}").`,
    );
  }

  const manifestNames = new Set(Object.keys(manifest.functions ?? {}));
  const configNames = new Set(configFunctions.keys());

  for (const name of manifestNames) {
    if (!FUNCTION_NAME_PATTERN.test(name)) {
      failures.push(
        `deployment-contract.json contains invalid function identifier "${name}"; ` +
          "expected strict lower-kebab-case.",
      );
    }
  }

  for (const name of configNames) {
    if (!manifestNames.has(name)) {
      failures.push(
        `supabase/config.toml configures function "${name}" for deployment but ` +
          `deployment-contract.json has no entry for it.`,
      );
    }
  }
  for (const name of manifestNames) {
    if (!configNames.has(name)) {
      failures.push(
        `deployment-contract.json declares function "${name}" that is not configured ` +
          `in supabase/config.toml.`,
      );
    }
  }

  for (const redirect of redirects) {
    if (redirect.from.startsWith("/api/") || functionNameFromFunctionsUrl(redirect.to)) {
      failures.push(
        `netlify.toml redirect "${redirect.from}" bypasses the environment-scoped Next.js API gateway.`,
      );
    }
  }

  const clientRoutes = new Set();
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;

    const configured = configFunctions.get(name);
    if (configured && typeof entry.authMode === "string") {
      const expectsJwt = entry.authMode === "jwt";
      if (configured.verifyJwt !== expectsJwt) {
        failures.push(
          `Function "${name}" declares authMode "${entry.authMode}" but supabase/config.toml ` +
            `sets verify_jwt=${configured.verifyJwt}.`,
        );
      }
    }

    if (entry.clientRoute) {
      if (!/^\/api\/[a-z0-9/-]+$/.test(entry.clientRoute)) {
        failures.push(
          `Function "${name}" declares invalid clientRoute "${entry.clientRoute}".`,
        );
      } else if (clientRoutes.has(entry.clientRoute)) {
        failures.push(`Duplicate clientRoute "${entry.clientRoute}" is not allowed.`);
      } else {
        clientRoutes.add(entry.clientRoute);
      }
    }

    const declaredRpcs = new Set(entry.requiredRpcs ?? []);
    if (entry.usesSharedRequestGuard) {
      for (const rpc of manifest.sharedRequestGuard?.requiredRpcs ?? []) declaredRpcs.add(rpc);
    }

    const actualRpcs = functionRpcUsage?.get(name) ?? new Set();
    for (const rpc of actualRpcs) {
      if (!declaredRpcs.has(rpc)) {
        failures.push(
          `Function "${name}" calls RPC "${rpc}" which is not declared in its ` +
            `deployment-contract.json entry (nor in sharedRequestGuard, which it does not opt into).`,
        );
      }
    }
  }

  if (workflowDeployCommands) {
    if (!workflowDeployCommands.has(PRODUCTION_DEPLOY_WORKFLOW)) {
      failures.push(
        `"${PRODUCTION_DEPLOY_WORKFLOW}" must own the contract-driven Edge Function deployment.`,
      );
    }

    for (const [workflowFile, commands] of workflowDeployCommands) {
      if (workflowFile !== PRODUCTION_DEPLOY_WORKFLOW) {
        failures.push(
          `"${workflowFile}" is an independent function-deployment bypass; ` +
            `Edge Functions must deploy only through "${PRODUCTION_DEPLOY_WORKFLOW}".`,
        );
      }
      for (const command of commands) {
        if (!isContractDrivenDeployCommand(command)) {
          failures.push(
            `"${workflowFile}" deploys functions with a command that is not driven by the ` +
              `safe deployment-contract launcher: "${command}". Direct shell deployment ` +
              "can redeploy retired functions or evaluate untrusted contract data.",
          );
        }
      }
    }
  }

  return failures;
}

// ---- CLI entrypoint -----------------------------------------------------------

async function main() {
  const repoRoot = process.cwd();
  const state = await loadRepoState(repoRoot);
  const failures = validateContract(state);

  if (failures.length > 0) {
    console.error("Deployment contract check failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
    return;
  }

  const count = Object.keys(state.manifest.functions ?? {}).length;
  console.log(`Deployment contract check passed (${count} functions).`);
}

const isMainModule = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
