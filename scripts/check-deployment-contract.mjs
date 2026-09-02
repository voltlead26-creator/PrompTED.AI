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
import ts from "typescript";
import { APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS } from "./check-web-build-environment.mjs";

const CONTRACT_PATH = "supabase/deployment-contract.json";
const CONFIG_TOML_PATH = "supabase/config.toml";
const NETLIFY_TOML_PATH = "netlify.toml";
const SECOND_NETLIFY_TOML_PATH = "apps/web/netlify.toml";
const WEB_API_GATEWAY_PATH = "apps/web/src/app/api/[...segments]/route.ts";
const WEB_API_PROXY_PATH = "apps/web/src/lib/edge-function-proxy.ts";
const FUNCTIONS_DIR = "supabase/functions";
const WORKFLOWS_DIR = ".github/workflows";
const PRODUCTION_DEPLOY_WORKFLOW = "deploy-prod.yml";
const SCHEMA_ATTESTATION_RPC = "attest_prompted_release_schema";
const SCHEMA_ATTESTATION_MIGRATION = "20260901050000_release_schema_attestation";
const SCHEMA_ATTESTATION_MIGRATION_PATH = `supabase/migrations/${SCHEMA_ATTESTATION_MIGRATION}.sql`;
const RPC_ARGUMENT_ATTESTATION_MIGRATION = "20260901091000_ingest_upload_exact_replay";
const RPC_ARGUMENT_ATTESTATION_MIGRATION_PATH = `supabase/migrations/${RPC_ARGUMENT_ATTESTATION_MIGRATION}.sql`;
const CAPACITY_ATTESTATION_RPC = "attest_openai_capacity_configuration";
const CAPACITY_ATTESTATION_MIGRATION = "20260901107000_openai_capacity_release_attestation";
const CAPACITY_ATTESTATION_MIGRATION_PATH = `supabase/migrations/${CAPACITY_ATTESTATION_MIGRATION}.sql`;
const ROUTING_ATTESTATION_RPC = "attest_openai_routing_configuration";
const ROUTING_ATTESTATION_MIGRATION = "20260902017000_openai_routing_release_attestation";
const ROUTING_ATTESTATION_MIGRATION_PATH = `supabase/migrations/${ROUTING_ATTESTATION_MIGRATION}.sql`;
const CAPACITY_FINGERPRINT_VARIABLES = {
  fast: "PROD_OPENAI_FAST_CAPACITY_FINGERPRINT",
  deep: "PROD_OPENAI_DEEP_CAPACITY_FINGERPRINT",
  research: "PROD_OPENAI_RESEARCH_CAPACITY_FINGERPRINT",
  review: "PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT",
};
const ROUTING_ATTESTATION_CONTRACT = {
  rpc: ROUTING_ATTESTATION_RPC,
  requiredMigration: ROUTING_ATTESTATION_MIGRATION,
  environment: "production",
  routingVersionEnvironmentVariable: "PROD_OPENAI_ROUTING_VERSION",
  evaluationSuiteEnvironmentVariable: "PROD_OPENAI_EVALUATION_SUITE_VERSION",
  minimumValiditySeconds: 86_400,
  routes: {
    fast: {
      reasoningEffort: "low",
      modelEnvironmentVariable: "PROD_OPENAI_FAST_MODEL",
      evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_FAST_EVALUATION_FINGERPRINT",
    },
    deep: {
      reasoningEffort: "medium",
      modelEnvironmentVariable: "PROD_OPENAI_DEEP_MODEL",
      evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_DEEP_EVALUATION_FINGERPRINT",
    },
    research: {
      reasoningEffort: "medium",
      modelEnvironmentVariable: "PROD_OPENAI_RESEARCH_MODEL",
      evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_RESEARCH_EVALUATION_FINGERPRINT",
    },
    review: {
      reasoningEffort: "high",
      modelEnvironmentVariable: "PROD_OPENAI_REVIEW_MODEL",
      evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT",
    },
  },
};
const SCHEMA_PROBE_PATH = "scripts/probe-supabase-contract.mjs";
const FUNCTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RAW_PROVIDER_COMPATIBILITY_FUNCTIONS = ["openai-chat", "openai-responses", "openai-stream"];
const PRE_MIGRATION_INVENTORY_CONTRACT = {
  contractVersion: "prompted-release-inventory.2",
  productionBaselineMigration: "20260527111048",
  savedRoleMigration: "20260901105000_atomic_saved_role_actions",
  brandAssetsCreationMigration: "20260901106000_brand_assets_owner_storage",
  brandAssetsMigration: "20260902016000_brand_logo_lifecycle",
  brandAssets: {
    bucketId: "assets",
    name: "assets",
    public: true,
    fileSizeLimit: 5_242_880,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    objectPathPattern:
      "^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo[.](png|jpg|webp)|logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp))$",
    policies: [
      {
        name: "assets_authenticated_owner_select",
        mode: "PERMISSIVE",
        command: "SELECT",
        roles: ["authenticated"],
        definitionSha256: "98b4d394af92e4b006bc4edcc71f502887106b5fd14d8f728f2381bb89ef56b6",
      },
    ],
    predecessorPolicies: [
      {
        name: "assets_authenticated_access",
        definitionSha256: "9637ef9c66f2aa06468f9993922c878e51125cfabc7e0aa61a9d4e3a085f2032",
      },
      {
        name: "assets_authenticated_owner_boundary",
        definitionSha256: "2a2e2c6a0f45010e41329bb8c9e0b1c343f4f1d23bd7abeedd5da281adc6e0dd",
      },
      {
        name: "assets_no_direct_client_delete",
        definitionSha256: "6d6cb20a0fa671feea603fd47ce527fa10e1ff76df27c94f0572bb2ecfdb4d2b",
      },
    ],
    requiredUnrelatedPolicies: [
      {
        name: "captured_exports_no_direct_client_access",
        definitionSha256: "48df06f778d1ae4b30c10237a66ac47eecfc0a3af6df0ed5300da4884358f050",
      },
      {
        name: "original_documents_read_own",
        definitionSha256: "be5289d83b63014f5a9975296fa3bce99371b4657b7939c87b673a01758f277b",
      },
    ],
  },
  forbidUndeclaredHostedFunctions: true,
  dormantFunctionsMustBeAbsent: true,
};

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

  for (const omitKey of omitKeys) {
    if (!APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS.includes(omitKey)) {
      failures.push(
        `netlify.toml must not exempt unreviewed variable "${omitKey}" from secret scanning.`,
      );
    }
  }

  for (const publicIdentifierKey of APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS) {
    if (!omitKeys.has(publicIdentifierKey)) {
      failures.push(
        `netlify.toml must include public identifier key "${publicIdentifierKey}" in ` +
          "SECRETS_SCAN_OMIT_KEYS so expected Next.js bundle values do not fail the deploy.",
      );
    }
  }

  if (parseNetlifyBuildEnvironmentValue(text, "SECRETS_SCAN_ENABLED") !== "true") {
    failures.push('netlify.toml must explicitly keep secret scanning enabled with "true".');
  }

  const omitPaths = (parseNetlifyBuildEnvironmentValue(text, "SECRETS_SCAN_OMIT_PATHS") ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  if (omitPaths.length > 0) {
    failures.push("netlify.toml must not omit any generated path from secret scanning.");
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
  const value =
    workflowBlock.match(new RegExp(`^\\s+${escapedKey}:\\s*([^\\n#]+?)\\s*$`, "m"))?.[1] ?? null;
  if (
    value &&
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function workflowStepContaining(jobBlock, fragment, fromIndex = 0) {
  const fragmentIndex = jobBlock.indexOf(fragment, fromIndex);
  if (fragmentIndex < 0) return "";
  const precedingMarker = jobBlock.lastIndexOf("\n      - ", fragmentIndex);
  const start = precedingMarker < 0 ? 0 : precedingMarker + 1;
  const followingMarker = jobBlock.indexOf("\n      - ", fragmentIndex + fragment.length);
  return jobBlock.slice(start, followingMarker < 0 ? jobBlock.length : followingMarker);
}

export function functionNameFromFunctionsUrl(url) {
  const match = url.match(/\/functions\/v1\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function projectRefFromUrl(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || target.port) {
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
  const denoSetupCount = workflowText.match(/denoland\/setup-deno@/g)?.length ?? 0;
  const denoSetupVersions = [
    ...workflowText.matchAll(
      /^[ \t]+(?:-[ \t]+)?uses:[ \t]*denoland\/setup-deno@[^\n]+\n[ \t]+with:[ \t]*\n[ \t]+deno-version:[ \t]*([^\s#]+)[ \t]*$/gm,
    ),
  ].map((match) => match[1]);
  if (
    denoSetupCount > 0 &&
    (denoSetupVersions.length !== denoSetupCount ||
      denoSetupVersions.some((version) => version !== "v2.9.5"))
  ) {
    failures.push(`Workflow "${workflowFile}" must pin Deno to v2.9.5.`);
  }
  const supabaseSetupCount = workflowText.match(/supabase\/setup-cli@/g)?.length ?? 0;
  const supabaseSetupVersions = [
    ...workflowText.matchAll(
      /^[ \t]+(?:-[ \t]+)?uses:[ \t]*supabase\/setup-cli@[^\n]+\n[ \t]+with:[ \t]*\n[ \t]+version:[ \t]*["']?([^"'\s#]+)["']?[ \t]*$/gm,
    ),
  ].map((match) => match[1]);
  if (
    supabaseSetupCount > 0 &&
    (supabaseSetupVersions.length !== supabaseSetupCount ||
      supabaseSetupVersions.some((version) => version !== "2.114.0"))
  ) {
    failures.push(`Workflow "${workflowFile}" must pin Supabase CLI to 2.114.0.`);
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
      failures.push(
        `Workflow "${workflowFile}" contains prohibited branch-writing automation: ${label}.`,
      );
    }
  }

  if (
    workflowFile !== PRODUCTION_DEPLOY_WORKFLOW &&
    /(?:\b(?:supabase\s+(?:link|db\s+push|functions\s+deploy)|netlify\s+deploy)\b|\bnode\s+scripts\/deploy-netlify-production\.mjs\b)/.test(
      workflowText,
    )
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
  for (const [name, block, expectedMinutes] of [
    ["verify-release", verifyJob, 45],
    ["deploy-functions-prod", functionsJob, 30],
    ["deploy-web-prod", webJob, 90],
  ]) {
    if (block && !new RegExp(`^ {4}timeout-minutes:\\s*${expectedMinutes}\\s*$`, "m").test(block)) {
      failures.push(`Production job "${name}" must set timeout-minutes to ${expectedMinutes}.`);
    }
  }
  if (!verifyJob || !/pnpm verify:web/.test(verifyJob)) {
    failures.push(
      'Production workflow must contain a "verify-release" job that runs pnpm verify:web.',
    );
  }
  if (!verifyJob || !/deno check supabase\/functions\/\*\/index\.ts/.test(verifyJob)) {
    failures.push("Production verification must run the Edge Function type-check before mutation.");
  }
  if (!verifyJob || !/deno test --allow-env --allow-read supabase\/functions/.test(verifyJob)) {
    failures.push("Production verification must run all Edge Function tests before mutation.");
  }
  if (
    !verifyJob ||
    !/\(anthropic\|google\[_-\]\?ai\|gemini\)/.test(verifyJob) ||
    !/supabase\/functions/.test(verifyJob)
  ) {
    failures.push(
      "Production verification must reject active non-OpenAI provider code before mutation.",
    );
  }
  if (verifyJob) {
    const databaseStartIndex = verifyJob.indexOf(
      "supabase start -x studio,imgproxy,mailpit,logflare,vector,supavisor",
    );
    const databaseResetIndex = verifyJob.indexOf("supabase db reset --local");
    const databaseTestIndex = verifyJob.indexOf("supabase test db");
    if (
      databaseStartIndex === -1 ||
      databaseResetIndex === -1 ||
      databaseStartIndex > databaseResetIndex
    ) {
      failures.push(
        "Production verification must apply every migration to a fresh local database before mutation.",
      );
    }
    if (
      databaseTestIndex === -1 ||
      databaseResetIndex === -1 ||
      databaseResetIndex > databaseTestIndex
    ) {
      failures.push(
        "Production verification must run the database tests after the fresh local reset.",
      );
    }
    if (!/supabase stop --no-backup/.test(verifyJob)) {
      failures.push(
        "Production verification must stop its local Supabase stack after the gates run.",
      );
    }
  }
  if (!verifyJob || !/GITHUB_REF/.test(verifyJob) || !/refs\/heads\/main/.test(verifyJob)) {
    failures.push('Production verification must refuse every ref except "refs/heads/main".');
  }
  if (!functionsJob || !/^ {4}needs:\s*verify-release\s*$/m.test(functionsJob)) {
    failures.push('Production function deployment must need "verify-release".');
  }
  if (functionsJob) {
    const dependencyInstall = functionsJob.indexOf("pnpm install --frozen-lockfile");
    const staticChecker = functionsJob.indexOf("node scripts/check-deployment-contract.mjs");
    if (
      !/corepack prepare pnpm@10\.33\.0 --activate/.test(functionsJob) ||
      dependencyInstall < 0 ||
      staticChecker < 0 ||
      dependencyInstall > staticChecker
    ) {
      failures.push(
        "Production function deployment must install pinned workspace dependencies before the static deployment checker.",
      );
    }
  }
  if (!webJob || !/^ {4}needs:\s*deploy-functions-prod\s*$/m.test(webJob)) {
    failures.push('Production web deployment must need "deploy-functions-prod".');
  }
  if (
    webJob &&
    (/^ {4}if:\s*.*always\s*\(/m.test(webJob) || /^\s+continue-on-error:\s*true\s*$/m.test(webJob))
  ) {
    failures.push(
      "Production web deployment must strictly require backend success without always-run or continue-on-error bypasses.",
    );
  }

  for (const [name, block] of [
    ["deploy-functions-prod", functionsJob],
    ["deploy-web-prod", webJob],
  ]) {
    if (block && !/^ {4}environment:\s*PrompTED\.AI\s*$/m.test(block)) {
      failures.push(
        `Production mutation job "${name}" must use the protected PrompTED.AI environment.`,
      );
    }
  }

  if (webJob) {
    if (!/npm install -g netlify-cli@27\.3\.0/.test(webJob)) {
      failures.push(
        "Production web deployment must install the pinned netlify-cli@27.3.0 release.",
      );
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
      failures.push("Production web deployment must set NEXT_PUBLIC_APP_ENV to production.");
    }

    const omitKeys = new Set(
      (parseWorkflowEnvironmentValue(webJob, "SECRETS_SCAN_OMIT_KEYS") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    );
    for (const omitKey of omitKeys) {
      if (!APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS.includes(omitKey)) {
        failures.push(
          `Production web deployment must not exempt unreviewed variable "${omitKey}" from secret scanning.`,
        );
      }
    }
    for (const publicIdentifierKey of APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS) {
      if (!omitKeys.has(publicIdentifierKey)) {
        failures.push(
          `Production web deployment must include "${publicIdentifierKey}" in SECRETS_SCAN_OMIT_KEYS.`,
        );
      }
    }

    if (parseWorkflowEnvironmentValue(webJob, "SECRETS_SCAN_ENABLED") !== "true") {
      failures.push(
        "Production web deployment must explicitly keep Netlify secret scanning enabled.",
      );
    }

    const omitPaths = (parseWorkflowEnvironmentValue(webJob, "SECRETS_SCAN_OMIT_PATHS") ?? "")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
    if (omitPaths.length > 0) {
      failures.push(
        "Production web deployment must not omit any generated path from secret scanning.",
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
    const inventoryValidationIndex = functionsJob.indexOf("SUPABASE_PROBE_MODE: inventory");
    const linkIndex = functionsJob.indexOf("supabase link");
    const databasePushIndex = functionsJob.indexOf("supabase db push");
    const mutationIndexes = [
      linkIndex,
      databasePushIndex,
      functionsJob.indexOf("deploy-contract-functions.mjs"),
    ].filter((index) => index >= 0);
    const firstMutationIndex = mutationIndexes.length > 0 ? Math.min(...mutationIndexes) : -1;
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
    const inventoryStep = workflowStepContaining(functionsJob, "SUPABASE_PROBE_MODE: inventory");
    if (
      inventoryValidationIndex === -1 ||
      targetValidationIndex > inventoryValidationIndex ||
      secretValidationIndex > inventoryValidationIndex ||
      linkIndex < 0 ||
      inventoryValidationIndex > linkIndex ||
      databasePushIndex < 0 ||
      inventoryValidationIndex > databasePushIndex ||
      !/node scripts\/probe-supabase-contract[.]mjs\b/.test(inventoryStep)
    ) {
      failures.push(
        "Production must run the metadata-only hosted release inventory after target/secret validation and before link or database push.",
      );
    }
    for (const [key, secret] of [
      ["SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"],
      ["SUPABASE_DB_PASSWORD", "PROD_SUPABASE_DB_PASSWORD"],
      ["SUPABASE_URL", "PROD_SUPABASE_URL"],
      ["SUPABASE_PROJECT_REF", "PROD_SUPABASE_PROJECT_REF"],
    ]) {
      if (
        !new RegExp(`^ {10}${key}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}\\s*$`, "m").test(
          inventoryStep,
        )
      ) {
        failures.push(
          `Production hosted release inventory must receive ${secret} through its scoped environment.`,
        );
      }
    }
    const baselineCaptureStep = workflowStepContaining(
      functionsJob,
      "node scripts/backend-release-baseline.mjs capture",
    );
    const baselineVerifyStep = workflowStepContaining(
      functionsJob,
      "node scripts/backend-release-baseline.mjs verify",
    );
    const baselineReportStep = workflowStepContaining(
      functionsJob,
      "node scripts/backend-release-baseline.mjs report",
    );
    const baselineCaptureIndex = functionsJob.indexOf(baselineCaptureStep);
    const baselineVerifyIndex = functionsJob.indexOf(baselineVerifyStep);
    const baselineReportIndex = functionsJob.indexOf(baselineReportStep);
    const nextStepAfterVerify = baselineVerifyStep
      ? functionsJob.indexOf("\n      - ", baselineVerifyIndex + baselineVerifyStep.length)
      : -1;
    const nextStep =
      nextStepAfterVerify < 0
        ? ""
        : workflowStepContaining(functionsJob, "\n      - ", nextStepAfterVerify);
    const exactBaselineCommand = (mode) =>
      new RegExp(
        `node scripts/backend-release-baseline[.]mjs\\s+${mode}\\s+--path "\\$RUNNER_TEMP/prompted-backend-release-baseline[.]json"\\s+--git-sha "\\$GITHUB_SHA"`,
      );
    const baselineCredentials = [
      ["SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"],
      ["SUPABASE_DB_PASSWORD", "PROD_SUPABASE_DB_PASSWORD"],
      ["SUPABASE_URL", "PROD_SUPABASE_URL"],
      ["SUPABASE_PROJECT_REF", "PROD_SUPABASE_PROJECT_REF"],
    ];
    const baselineStepsValid = [
      [baselineCaptureStep, "capture"],
      [baselineVerifyStep, "verify"],
      [baselineReportStep, "report"],
    ].every(
      ([step, mode]) =>
        exactBaselineCommand(mode).test(step) &&
        baselineCredentials.every(([key, secret]) =>
          new RegExp(`^ {10}${key}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}\\s*$`, "m").test(
            step,
          ),
        ),
    );
    if (
      !baselineStepsValid ||
      !/^ {8}id:\s*backend_baseline\s*$/m.test(baselineCaptureStep) ||
      baselineCaptureIndex < inventoryValidationIndex ||
      baselineCaptureIndex > linkIndex ||
      baselineVerifyIndex < linkIndex ||
      baselineVerifyIndex > databasePushIndex ||
      !nextStep.includes("supabase db push --linked")
    ) {
      failures.push(
        "Production backend mutation must use one immutable backend release baseline captured before link and revalidated immediately before database push.",
      );
    }
    if (
      !baselineReportStep ||
      baselineReportIndex < functionsJob.indexOf("SUPABASE_PROBE_MODE: smoke") ||
      !/^ {8}if:\s*\$\{\{\s*failure\(\)\s*&&\s*steps\.backend_baseline\.outcome\s*==\s*'success'\s*\}\}\s*$/m.test(
        baselineReportStep,
      )
    ) {
      failures.push(
        "Production backend failures must emit the read-only backend failure report from the captured baseline.",
      );
    }
    if (/\bsupabase\s+(?:migration\s+repair|db\s+(?:reset|rollback))\b/.test(functionsJob)) {
      failures.push(
        "Production backend failure handling must not perform automated database rollback or migration repair.",
      );
    }
    if (/^\s+continue-on-error:\s*true\s*$/m.test(functionsJob)) {
      failures.push(
        "Production backend mutation must not suppress release failures with continue-on-error.",
      );
    }
    const linkStep = workflowStepContaining(functionsJob, "supabase link");
    if (
      !/^ {10}SUPABASE_DB_PASSWORD:\s*\$\{\{\s*secrets\.PROD_SUPABASE_DB_PASSWORD\s*\}\}\s*$/m.test(
        linkStep,
      )
    ) {
      failures.push(
        "Production Supabase link must receive the protected database password (PROD_SUPABASE_DB_PASSWORD) through its scoped environment.",
      );
    }
    const functionDeployIndex = functionsJob.indexOf("deploy-contract-functions.mjs");
    const schemaProbeStep = workflowStepContaining(
      functionsJob,
      "node scripts/probe-supabase-contract.mjs",
      Math.max(0, databasePushIndex),
    );
    const schemaProbeIndex = schemaProbeStep ? functionsJob.indexOf(schemaProbeStep) : -1;
    if (
      databasePushIndex < 0 ||
      schemaProbeIndex < databasePushIndex ||
      functionDeployIndex < schemaProbeIndex
    ) {
      failures.push(
        "Production must probe the applied live schema after database push and before function deployment.",
      );
    }
    for (const [key, secret] of [
      ["SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"],
      ["SUPABASE_DB_PASSWORD", "PROD_SUPABASE_DB_PASSWORD"],
    ]) {
      if (
        !new RegExp(`^ {10}${key}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}\\s*$`, "m").test(
          schemaProbeStep,
        )
      ) {
        failures.push(
          `Production applied-schema probe must receive ${secret} through its scoped environment.`,
        );
      }
    }
    for (const variable of Object.values(CAPACITY_FINGERPRINT_VARIABLES)) {
      if (
        !new RegExp(
          `^ {10}${variable}:\\s*\\$\\{\\{\\s*secrets\\.${variable}\\s*\\}\\}\\s*$`,
          "m",
        ).test(schemaProbeStep)
      ) {
        failures.push(
          `Production applied-schema probe must receive ${variable} before function deployment.`,
        );
      }
    }
    const routingProtectedVariables = [
      ROUTING_ATTESTATION_CONTRACT.routingVersionEnvironmentVariable,
      ROUTING_ATTESTATION_CONTRACT.evaluationSuiteEnvironmentVariable,
      ...Object.values(ROUTING_ATTESTATION_CONTRACT.routes).flatMap((route) => [
        route.modelEnvironmentVariable,
        route.evaluationFingerprintEnvironmentVariable,
      ]),
    ];
    for (const variable of routingProtectedVariables) {
      if (
        !new RegExp(
          `^ {10}${variable}:\\s*\\$\\{\\{\\s*secrets\\.${variable}\\s*\\}\\}\\s*$`,
          "m",
        ).test(schemaProbeStep)
      ) {
        failures.push(
          `Production applied-schema probe must receive ${variable} before function deployment.`,
        );
      }
    }
    const postFunctionIndex = functionsJob.indexOf("SUPABASE_PROBE_MODE: post_function");
    const postFunctionStep = workflowStepContaining(
      functionsJob,
      "SUPABASE_PROBE_MODE: post_function",
    );
    const smokeIndex = functionsJob.indexOf("SUPABASE_PROBE_MODE: smoke");
    if (
      functionDeployIndex < 0 ||
      postFunctionIndex < functionDeployIndex ||
      smokeIndex < postFunctionIndex ||
      !/node scripts\/probe-supabase-contract[.]mjs\b/.test(postFunctionStep)
    ) {
      failures.push(
        "Production must run the exact post-function inventory after function deployment and before smoke or web publication.",
      );
    }
    for (const [key, secret] of [
      ["SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"],
      ["SUPABASE_DB_PASSWORD", "PROD_SUPABASE_DB_PASSWORD"],
      ["SUPABASE_URL", "PROD_SUPABASE_URL"],
      ["SUPABASE_PROJECT_REF", "PROD_SUPABASE_PROJECT_REF"],
    ]) {
      if (
        !new RegExp(`^ {10}${key}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}\\s*$`, "m").test(
          postFunctionStep,
        )
      ) {
        failures.push(
          `Production post-function inventory must receive ${secret} through its scoped environment.`,
        );
      }
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
  // The durable runner deliberately funnels service calls through typed
  // state/value wrappers. Their RPC name is the second literal argument, so
  // scan that seam as well; otherwise a newly added background RPC could be
  // absent from the deployment manifest while the direct `.rpc(name)` call
  // remains invisible to this static gate.
  for (const match of source.matchAll(
    /\b(?:rpcState|rpcValue)\(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*,\s*["'`]([a-zA-Z0-9_]+)["'`]/g,
  )) {
    rpcs.add(match[1]);
  }
  return rpcs;
}

const TABLE_OPERATION_METHODS = new Map([
  ["select", ["select"]],
  ["insert", ["insert"]],
  ["update", ["update"]],
  ["delete", ["delete"]],
]);
const TABLE_BUILDER_METHODS = new Set([
  "abortSignal",
  "containedBy",
  "contains",
  "csv",
  "eq",
  "explain",
  "filter",
  "geojson",
  "gt",
  "gte",
  "ilike",
  "in",
  "is",
  "like",
  "limit",
  "lt",
  "lte",
  "match",
  "maybeSingle",
  "neq",
  "not",
  "or",
  "order",
  "overlaps",
  "overrideTypes",
  "range",
  "rangeAdjacent",
  "rangeGt",
  "rangeGte",
  "rangeLt",
  "rangeLte",
  "returns",
  "rollback",
  "single",
  "textSearch",
  "then",
  "catch",
  "finally",
  "throwOnError",
]);
const STORAGE_OPERATION_METHODS = new Map([
  ["copy", ["select", "insert"]],
  ["createSignedUploadUrl", ["insert"]],
  ["createSignedUrl", ["select"]],
  ["createSignedUrls", ["select"]],
  ["download", ["select"]],
  ["emptyBucket", ["delete"]],
  ["exists", ["select"]],
  ["getPublicUrl", ["select"]],
  ["info", ["select"]],
  ["list", ["select"]],
  ["move", ["select", "update"]],
  ["remove", ["delete"]],
  ["update", ["update"]],
  ["uploadToSignedUrl", ["insert"]],
]);
const STORAGE_PROMISE_METHODS = new Set(["catch", "finally", "then"]);
const NON_SUPABASE_FROM_RECEIVERS = new Set([
  "Array",
  "Buffer",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Object",
  "Promise",
  "Readable",
  "String",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
]);

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function memberExpression(node) {
  const current = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(current)) {
    return { node: current, receiver: current.expression, name: current.name.text };
  }
  if (
    ts.isElementAccessExpression(current) &&
    current.argumentExpression &&
    ts.isStringLiteralLike(current.argumentExpression)
  ) {
    return {
      node: current,
      receiver: current.expression,
      name: current.argumentExpression.text,
    };
  }
  return null;
}

function literalText(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function chainedMethodCalls(fromCall) {
  const calls = [];
  let receiver = fromCall;
  while (true) {
    while (
      receiver.parent &&
      (ts.isParenthesizedExpression(receiver.parent) ||
        ts.isAsExpression(receiver.parent) ||
        ts.isTypeAssertionExpression(receiver.parent) ||
        ts.isNonNullExpression(receiver.parent) ||
        ts.isSatisfiesExpression(receiver.parent)) &&
      receiver.parent.expression === receiver
    ) {
      receiver = receiver.parent;
    }

    const access = memberExpression(receiver.parent);
    if (!access || unwrapExpression(access.receiver) !== receiver) break;
    const call = access.node.parent;
    if (!ts.isCallExpression(call) || unwrapExpression(call.expression) !== access.node) break;
    calls.push({ name: access.name, call });
    receiver = call;
  }
  return calls;
}

function objectBooleanProperty(node, propertyName) {
  if (!node || !ts.isObjectLiteralExpression(unwrapExpression(node))) return null;
  for (const property of unwrapExpression(node).properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name =
      property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
        ? property.name.text
        : null;
    if (name !== propertyName) continue;
    const value = unwrapExpression(property.initializer);
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
    return null;
  }
  return null;
}

function receiverRootIdentifier(node) {
  let current = unwrapExpression(node);
  while (true) {
    if (ts.isIdentifier(current)) return current.text;
    const member = memberExpression(current);
    if (member) {
      current = unwrapExpression(member.receiver);
      continue;
    }
    return null;
  }
}

function looksLikeSupabaseReceiver(sourceFile, node) {
  const text = unwrapExpression(node).getText(sourceFile);
  return /(?:^|\.)(?:admin|adminClient|client|db|gateway|supabase)$/i.test(text);
}

function addOperations(map, resource, operations) {
  const existing = map.get(resource) ?? new Set();
  for (const operation of operations) existing.add(operation);
  map.set(resource, existing);
}

function sourceLocation(sourceFile, node, sourceLabel) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceLabel}:${line + 1}:${character + 1}`;
}

/**
 * Classify direct Supabase table and Storage calls without treating fluent
 * filters/builders as database operations. Table operations are compared to
 * the manifest's PostgREST/public-schema privilege contract. Storage verbs are
 * still classified (and unknown verbs fail closed), but bucket policy and
 * Storage API authorization are intentionally outside requiredTablePrivileges.
 */
export function scanSupabaseDataOperations(source, sourceLabel = "<source>") {
  const tableOperations = new Map();
  const storageOperations = new Map();
  const unclassified = [];
  const sourceFile = ts.createSourceFile(
    sourceLabel,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const fromMember = memberExpression(node.expression);
      if (fromMember?.name === "from") {
        const receiver = unwrapExpression(fromMember.receiver);
        const receiverMember = memberExpression(receiver);
        const storage = receiverMember?.name === "storage";
        const rootIdentifier = receiverRootIdentifier(receiver);
        const calls = chainedMethodCalls(node);
        const knownTableCall = calls.some(
          ({ name }) => TABLE_OPERATION_METHODS.has(name) || name === "upsert",
        );
        const probableSupabaseTable =
          !storage &&
          !NON_SUPABASE_FROM_RECEIVERS.has(rootIdentifier) &&
          (knownTableCall || looksLikeSupabaseReceiver(sourceFile, receiver));

        if (storage || probableSupabaseTable) {
          const resource = literalText(node.arguments[0]) ?? "<dynamic>";
          const operations = new Set();
          let unknownStorageMethod = null;
          let unknownTableMethod = null;

          for (const { name, call } of calls) {
            if (storage) {
              if (name === "upload") {
                operations.add("insert");
                if (objectBooleanProperty(call.arguments[2], "upsert") !== false) {
                  operations.add("update");
                }
              } else if (STORAGE_OPERATION_METHODS.has(name)) {
                for (const operation of STORAGE_OPERATION_METHODS.get(name)) {
                  operations.add(operation);
                }
              } else if (!STORAGE_PROMISE_METHODS.has(name)) {
                unknownStorageMethod ??= name;
              }
              continue;
            }

            if (name === "upsert") {
              operations.add("insert");
              if (objectBooleanProperty(call.arguments[1], "ignoreDuplicates") !== true) {
                operations.add("update");
              }
            } else if (TABLE_OPERATION_METHODS.has(name)) {
              for (const operation of TABLE_OPERATION_METHODS.get(name)) {
                operations.add(operation);
              }
            } else if (!TABLE_BUILDER_METHODS.has(name)) {
              unknownTableMethod ??= name;
            }
          }

          const operationMap = storage ? storageOperations : tableOperations;
          addOperations(operationMap, resource, operations);
          const location = sourceLocation(sourceFile, node, sourceLabel);
          if (resource === "<dynamic>" && !storage) {
            unclassified.push({
              kind: "table",
              location,
              reason: "direct table names must be string literals",
            });
          } else if (storage && unknownStorageMethod) {
            unclassified.push({
              kind: "storage",
              location,
              reason: `unknown Storage verb "${unknownStorageMethod}"`,
            });
          } else if (!storage && unknownTableMethod) {
            unclassified.push({
              kind: "table",
              location,
              reason: `unknown table-chain method "${unknownTableMethod}"`,
            });
          } else if (operations.size === 0) {
            const methods = calls.map(({ name }) => name).join(", ") || "none";
            unclassified.push({
              kind: storage ? "storage" : "table",
              location,
              reason: `no classifiable data operation in chained methods (${methods})`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { tableOperations, storageOperations, unclassified };
}

export function scanTableCalls(source) {
  return new Set(scanSupabaseDataOperations(source).tableOperations.keys());
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

export async function scanFunctionTableUsage(repoRoot, functionNames) {
  const usage = new Map();
  for (const name of functionNames) {
    const entryPath = `${FUNCTIONS_DIR}/${name}/index.ts`;
    if (!existsSync(join(repoRoot, entryPath))) {
      usage.set(name, scanSupabaseDataOperations("", entryPath));
      continue;
    }
    const closure = await collectSourceClosure(repoRoot, entryPath);
    usage.set(name, scanSupabaseDataOperations(closure, `${entryPath} dependency closure`));
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
  const schemaProbeSource = await readFile(join(repoRoot, SCHEMA_PROBE_PATH), "utf8");

  const configFunctions = parseConfigToml(configTomlText);
  const configProjectId = parseConfigProjectId(configTomlText);
  const redirects = parseNetlifyRedirects(netlifyTomlText);

  let netlifyManifestCount = existsSync(join(repoRoot, NETLIFY_TOML_PATH)) ? 1 : 0;
  if (existsSync(join(repoRoot, SECOND_NETLIFY_TOML_PATH))) netlifyManifestCount += 1;

  const functionNames = Object.keys(manifest.functions ?? {});
  const functionRpcUsage = await scanFunctionRpcUsage(repoRoot, functionNames);
  const functionTableUsage = await scanFunctionTableUsage(repoRoot, functionNames);
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
    schemaProbeSource,
    schemaAttestationMigrationExists: existsSync(join(repoRoot, SCHEMA_ATTESTATION_MIGRATION_PATH)),
    rpcArgumentAttestationMigrationExists: existsSync(
      join(repoRoot, RPC_ARGUMENT_ATTESTATION_MIGRATION_PATH),
    ),
    capacityAttestationMigrationExists: existsSync(
      join(repoRoot, CAPACITY_ATTESTATION_MIGRATION_PATH),
    ),
    routingAttestationMigrationExists: existsSync(
      join(repoRoot, ROUTING_ATTESTATION_MIGRATION_PATH),
    ),
    netlifyManifestCount,
    functionRpcUsage,
    functionTableUsage,
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
    schemaProbeSource,
    schemaAttestationMigrationExists,
    rpcArgumentAttestationMigrationExists,
    capacityAttestationMigrationExists,
    routingAttestationMigrationExists,
    netlifyManifestCount,
    functionRpcUsage,
    functionTableUsage,
    activeRawProxyConsumers,
    workflowDeployCommands,
    workflowTexts,
    productionWorkflowText,
  } = state;
  const failures = [];

  const validateTablePrivileges = (label, requiredTables = [], privilegeMap = {}) => {
    const required = new Set(requiredTables);
    for (const [table, privileges] of Object.entries(privilegeMap)) {
      if (!required.has(table)) {
        failures.push(`${label} table privilege contract names undeclared table "${table}".`);
      }
      if (
        !Array.isArray(privileges) ||
        new Set(privileges).size !== privileges.length ||
        privileges.some(
          (privilege) => !["select", "insert", "update", "delete"].includes(privilege),
        )
      ) {
        failures.push(`${label} table "${table}" has an invalid privilege contract.`);
      }
    }
  };

  validateTablePrivileges(
    "Shared runtime",
    manifest.sharedRequestGuard?.requiredTables,
    manifest.sharedRequestGuard?.requiredTablePrivileges,
  );
  validateTablePrivileges(
    "Web",
    manifest.webRequirements?.requiredTables,
    manifest.webRequirements?.requiredTablePrivileges,
  );
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    validateTablePrivileges(
      `Function "${name}"`,
      entry.requiredTables,
      entry.requiredTablePrivileges,
    );
    for (const field of ["requiredRpcs", "requiredAuthenticatedRpcs"]) {
      const rpcs = entry[field];
      if (
        rpcs !== undefined &&
        (!Array.isArray(rpcs) ||
          new Set(rpcs).size !== rpcs.length ||
          rpcs.some((rpc) => typeof rpc !== "string" || !/^[a-z][a-z0-9_]*$/.test(rpc)))
      ) {
        failures.push(`Function "${name}" has an invalid ${field} contract.`);
      }
    }
  }

  const declaredRpcs = new Set([
    ...(manifest.sharedRequestGuard?.requiredRpcs ?? []),
    ...(manifest.sharedRequestGuard?.requiredAuthenticatedRpcs ?? []),
    ...(manifest.webRequirements?.requiredRpcs ?? []),
    ...(manifest.webRequirements?.requiredAuthenticatedRpcs ?? []),
    ...(manifest.capacityAttestation?.rpc ? [manifest.capacityAttestation.rpc] : []),
    ...(manifest.routingAttestation?.rpc ? [manifest.routingAttestation.rpc] : []),
  ]);
  for (const entry of Object.values(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    for (const rpc of entry.requiredRpcs ?? []) declaredRpcs.add(rpc);
    for (const rpc of entry.requiredAuthenticatedRpcs ?? []) declaredRpcs.add(rpc);
  }
  const signatureMap = manifest.requiredRpcSignatures;
  const allowedArgumentTypes = new Set([
    "bigint",
    "boolean",
    "date",
    "integer",
    "jsonb",
    "text",
    "text[]",
    "timestamp with time zone",
    "uuid",
  ]);
  if (!signatureMap || typeof signatureMap !== "object" || Array.isArray(signatureMap)) {
    failures.push(
      "The deployment contract must declare exact canonical argument types for every RPC.",
    );
  } else {
    for (const rpc of declaredRpcs) {
      if (!Object.hasOwn(signatureMap, rpc)) {
        failures.push(`RPC "${rpc}" is missing its exact argument-type contract.`);
        continue;
      }
      const signature = signatureMap[rpc];
      const types = signature === "" ? [] : String(signature).split(", ");
      if (
        typeof signature !== "string" ||
        types.some((type) => !allowedArgumentTypes.has(type)) ||
        types.join(", ") !== signature
      ) {
        failures.push(`RPC "${rpc}" has an invalid canonical argument-type contract.`);
      }
    }
    for (const rpc of Object.keys(signatureMap)) {
      if (!declaredRpcs.has(rpc)) {
        failures.push(`RPC signature contract names undeclared RPC "${rpc}".`);
      }
    }
  }

  if (
    manifest.schemaAttestation?.rpc !== SCHEMA_ATTESTATION_RPC ||
    manifest.schemaAttestation?.requiredMigration !== SCHEMA_ATTESTATION_MIGRATION ||
    manifest.schemaAttestation?.argumentTypesRequiredMigration !==
      RPC_ARGUMENT_ATTESTATION_MIGRATION ||
    !schemaAttestationMigrationExists ||
    !rpcArgumentAttestationMigrationExists
  ) {
    failures.push(
      "The deployment contract must bind the reviewed role-aware schema attestation RPC and migration.",
    );
  }
  const capacityFingerprintVariables =
    manifest.capacityAttestation?.fingerprintEnvironmentVariables;
  if (
    manifest.capacityAttestation?.rpc !== CAPACITY_ATTESTATION_RPC ||
    manifest.capacityAttestation?.requiredMigration !== CAPACITY_ATTESTATION_MIGRATION ||
    manifest.capacityAttestation?.environment !== "production" ||
    !capacityAttestationMigrationExists ||
    !capacityFingerprintVariables ||
    Object.keys(capacityFingerprintVariables).length !== 4 ||
    Object.entries(CAPACITY_FINGERPRINT_VARIABLES).some(
      ([route, variable]) => capacityFingerprintVariables[route] !== variable,
    )
  ) {
    failures.push(
      "The deployment contract must bind all four production OpenAI routes to the reviewed capacity attestation and fingerprint inputs.",
    );
  }
  const routingAttestation = manifest.routingAttestation;
  const routingComparable = routingAttestation && {
    rpc: routingAttestation.rpc,
    requiredMigration: routingAttestation.requiredMigration,
    environment: routingAttestation.environment,
    routingVersionEnvironmentVariable: routingAttestation.routingVersionEnvironmentVariable,
    evaluationSuiteEnvironmentVariable: routingAttestation.evaluationSuiteEnvironmentVariable,
    minimumValiditySeconds: routingAttestation.minimumValiditySeconds,
    routes: routingAttestation.routes,
  };
  if (
    JSON.stringify(routingComparable) !== JSON.stringify(ROUTING_ATTESTATION_CONTRACT) ||
    Object.keys(routingAttestation ?? {})
      .filter((key) => key !== "$comment")
      .sort()
      .join(",") !== Object.keys(ROUTING_ATTESTATION_CONTRACT).sort().join(",") ||
    !routingAttestationMigrationExists
  ) {
    failures.push(
      "The deployment contract must bind all four production OpenAI routes to exact reviewed models, reasoning, routing, and expiring evaluation evidence.",
    );
  }
  const inventoryContract = manifest.preMigrationInventory;
  const inventoryComparable = inventoryContract && {
    contractVersion: inventoryContract.contractVersion,
    productionBaselineMigration: inventoryContract.productionBaselineMigration,
    savedRoleMigration: inventoryContract.savedRoleMigration,
    brandAssetsCreationMigration: inventoryContract.brandAssetsCreationMigration,
    brandAssetsMigration: inventoryContract.brandAssetsMigration,
    brandAssets: inventoryContract.brandAssets,
    forbidUndeclaredHostedFunctions: inventoryContract.forbidUndeclaredHostedFunctions,
    dormantFunctionsMustBeAbsent: inventoryContract.dormantFunctionsMustBeAbsent,
  };
  if (
    JSON.stringify(inventoryComparable) !== JSON.stringify(PRE_MIGRATION_INVENTORY_CONTRACT) ||
    Object.keys(inventoryContract ?? {})
      .filter((key) => key !== "$comment")
      .sort()
      .join(",") !== Object.keys(PRE_MIGRATION_INVENTORY_CONTRACT).sort().join(",")
  ) {
    failures.push(
      "The deployment contract must bind the exact reviewed pre-migration hosted release inventory.",
    );
  }
  if (
    typeof schemaProbeSource !== "string" ||
    !schemaProbeSource.includes("fetchHostedInventory") ||
    !schemaProbeSource.includes("validateHostedInventory") ||
    !schemaProbeSource.includes("fetchHostedFunctionInventory") ||
    !schemaProbeSource.includes("fetchSchemaAttestation") ||
    !schemaProbeSource.includes("fetchCapacityAttestation") ||
    !schemaProbeSource.includes("fetchRoutingAttestation") ||
    !schemaProbeSource.includes("fingerprintEnvironmentVariables") ||
    !schemaProbeSource.includes("routingAttestation") ||
    !schemaProbeSource.includes("requiredTablePrivileges") ||
    !schemaProbeSource.includes("requiredRpcSignatures")
  ) {
    failures.push(
      `The live schema probe at ${SCHEMA_PROBE_PATH} must consume the pre-migration inventory and role-aware privilege attestation.`,
    );
  }

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
      failures.push(`Dormant raw provider function "${name}" must not expose a client route.`);
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
    failures.push(`The stable browser API surface must be owned by ${WEB_API_GATEWAY_PATH}.`);
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
  const allowedAuthModes = new Set(["anon", "jwt", "internal-service-role"]);
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (!allowedAuthModes.has(entry.authMode)) {
      failures.push(
        `Function "${name}" declares invalid authMode "${String(entry.authMode)}"; ` +
          'expected exactly "anon", "jwt", or "internal-service-role".',
      );
    }
    if (entry.status !== "active") continue;

    const configured = configFunctions.get(name);
    if (
      entry.internalServiceRole === true &&
      (entry.authMode !== "internal-service-role" ||
        entry.clientRoute !== null ||
        entry.usesSharedRequestGuard !== false)
    ) {
      failures.push(
        `Function "${name}" is an internal service-role boundary and must declare ` +
          'authMode "internal-service-role", clientRoute null, and usesSharedRequestGuard false.',
      );
    }
    if (
      entry.internalServiceRole === true &&
      (entry.smokeProbe?.kind !== "none" ||
        entry.smokeProbe?.name !== null ||
        entry.smokeProbe?.allowMethodNotAllowed !== true)
    ) {
      failures.push(
        `Function "${name}" is an internal service-role boundary and must declare a ` +
          "strict unauthenticated 405 endpoint probe.",
      );
    }
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
        failures.push(`Function "${name}" declares invalid clientRoute "${entry.clientRoute}".`);
      } else if (clientRoutes.has(entry.clientRoute)) {
        failures.push(`Duplicate clientRoute "${entry.clientRoute}" is not allowed.`);
      } else {
        clientRoutes.add(entry.clientRoute);
      }
    }

    const requiredFunctions = entry.requiredFunctions ?? [];
    if (!Array.isArray(requiredFunctions)) {
      failures.push(`Function "${name}" has an invalid requiredFunctions contract.`);
    } else {
      const seenDependencies = new Set();
      for (const dependency of requiredFunctions) {
        const dependencyEntry = manifest.functions?.[dependency];
        if (
          typeof dependency !== "string" ||
          !FUNCTION_NAME_PATTERN.test(dependency) ||
          !dependencyEntry ||
          dependencyEntry.status !== "active"
        ) {
          failures.push(
            `Function "${name}" requires missing active dependency "${String(dependency)}".`,
          );
        } else if (seenDependencies.has(dependency)) {
          failures.push(
            `Function "${name}" declares duplicate function dependency "${dependency}".`,
          );
        }
        seenDependencies.add(dependency);
      }
    }

    const declaredRpcs = new Set(entry.requiredRpcs ?? []);
    // Static source closure proves that every RPC is declared. Exact role
    // ownership is attested live: calls made through a user-token client may
    // be listed separately without becoming service-role requirements.
    for (const rpc of entry.requiredAuthenticatedRpcs ?? []) declaredRpcs.add(rpc);
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

    const declaredTables = new Set(entry.requiredTables ?? []);
    const declaredTablePrivileges = { ...(entry.requiredTablePrivileges ?? {}) };
    if (entry.usesSharedRequestGuard) {
      for (const table of manifest.sharedRequestGuard?.requiredTables ?? [])
        declaredTables.add(table);
      for (const [table, privileges] of Object.entries(
        manifest.sharedRequestGuard?.requiredTablePrivileges ?? {},
      )) {
        declaredTablePrivileges[table] = [
          ...new Set([...(declaredTablePrivileges[table] ?? []), ...privileges]),
        ];
      }
    }

    const rawDataUsage = functionTableUsage?.get(name);
    const actualTableOperations =
      rawDataUsage?.tableOperations instanceof Map
        ? rawDataUsage.tableOperations
        : rawDataUsage instanceof Map
          ? rawDataUsage
          : new Map(
              rawDataUsage instanceof Set
                ? [...rawDataUsage].map((table) => [table, new Set()])
                : [],
            );
    for (const issue of rawDataUsage?.unclassified ?? []) {
      failures.push(
        `Function "${name}" contains an unclassifiable direct Supabase ${issue.kind} ` +
          `operation at ${issue.location}: ${issue.reason}.`,
      );
    }

    for (const [table, operations] of actualTableOperations) {
      if (!declaredTables.has(table)) {
        failures.push(
          `Function "${name}" directly accesses table "${table}" which is not declared in its ` +
            "deployment-contract.json entry or sharedRequestGuard.",
        );
        continue;
      }
      const privileges = declaredTablePrivileges[table];
      if (!Array.isArray(privileges) || privileges.length === 0) {
        failures.push(
          `Function "${name}" directly accesses table "${table}" without declared ` +
            "service-role table privileges.",
        );
        continue;
      }
      for (const operation of operations) {
        if (!privileges.includes(operation)) {
          failures.push(
            `Function "${name}" directly performs "${operation}" on table "${table}" but ` +
              `deployment-contract.json declares only [${privileges.join(", ")}].`,
          );
        }
      }
    }
  }

  const dependencyState = new Map();
  const inspectDependencyCycle = (name, path) => {
    if (dependencyState.get(name) === "complete") return;
    if (dependencyState.get(name) === "visiting") {
      failures.push(`Active function dependency cycle detected: ${[...path, name].join(" -> ")}.`);
      return;
    }
    dependencyState.set(name, "visiting");
    const dependencies = manifest.functions?.[name]?.requiredFunctions;
    if (Array.isArray(dependencies)) {
      for (const dependency of dependencies) {
        if (manifest.functions?.[dependency]?.status === "active") {
          inspectDependencyCycle(dependency, [...path, name]);
        }
      }
    }
    dependencyState.set(name, "complete");
  };
  for (const [name, entry] of Object.entries(manifest.functions ?? {})) {
    if (entry.status === "active") inspectDependencyCycle(name, []);
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

const isMainModule =
  process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
