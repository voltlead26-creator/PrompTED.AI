import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findFunctionsDeployCommands,
  isContractDrivenDeployCommand,
  projectRefFromUrl,
  scanFunctionTableUsage,
  scanRpcCalls,
  scanSupabaseDataOperations,
  scanTableCalls,
  validateContract,
  validateNetlifySecretScanConfig,
  validateProductionWorkflow,
  validateWorkflowAuthority,
} from "./check-deployment-contract.mjs";

const SAFE_NETLIFY_SECRET_SCAN_CONFIG = `
[build.environment]
  NODE_VERSION = "22.23.2"
  PNPM_VERSION = "10.33.0"
  SECRETS_SCAN_ENABLED = "true"
  SECRETS_SCAN_OMIT_PATHS = ""
  SECRETS_SCAN_OMIT_KEYS = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_REVENUECAT_WEB_KEY,NEXT_PUBLIC_SENTRY_DSN,NEXT_PUBLIC_POSTHOG_KEY"
`;

const SAFE_WEB_API_GATEWAY = `
export const runtime = "nodejs";
proxyEdgeFunctionRequest(request, segments);
`;

const SAFE_WEB_API_PROXY = `
import deploymentContract from "../../../../supabase/deployment-contract.json";
import { getPublicSupabaseConfig } from "@/lib/supabase/public-config";
if (entry.status !== "active") continue;
new URL(\`/functions/v1/\${functionName}\`, getPublicSupabaseConfig().url);
`;

// Minimal, self-consistent baseline state. Each test below mutates exactly
// one thing away from this baseline to trigger exactly one violation class.
function baseState() {
  return {
    manifest: {
      projectRef: "abcdefghijklmnopqrst",
      preMigrationInventory: {
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
      },
      schemaAttestation: {
        rpc: "attest_prompted_release_schema",
        requiredMigration: "20260901050000_release_schema_attestation",
        argumentTypesRequiredMigration: "20260901091000_ingest_upload_exact_replay",
      },
      capacityAttestation: {
        rpc: "attest_openai_capacity_configuration",
        requiredMigration: "20260901107000_openai_capacity_release_attestation",
        environment: "production",
        fingerprintEnvironmentVariables: {
          fast: "PROD_OPENAI_FAST_CAPACITY_FINGERPRINT",
          deep: "PROD_OPENAI_DEEP_CAPACITY_FINGERPRINT",
          research: "PROD_OPENAI_RESEARCH_CAPACITY_FINGERPRINT",
          review: "PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT",
        },
      },
      routingAttestation: {
        rpc: "attest_openai_routing_configuration",
        requiredMigration: "20260902017000_openai_routing_release_attestation",
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
      },
      requiredRpcSignatures: {
        attest_openai_capacity_configuration: "text, text[]",
        attest_openai_routing_configuration: "text, text[]",
        consume_rate_limit: "uuid, text, integer, integer",
      },
      sharedRequestGuard: {
        requiredRpcs: ["consume_rate_limit"],
      },
      functions: {
        clarify: {
          status: "active",
          authMode: "anon",
          clientRoute: "/api/clarify",
          usesSharedRequestGuard: true,
          requiredRpcs: [],
        },
        "openai-chat": {
          status: "dormant",
          authMode: "jwt",
          clientRoute: null,
          usesSharedRequestGuard: true,
          requiredRpcs: [],
        },
        "openai-responses": {
          status: "dormant",
          authMode: "jwt",
          clientRoute: null,
          usesSharedRequestGuard: true,
          requiredRpcs: [],
        },
        "openai-stream": {
          status: "dormant",
          authMode: "jwt",
          clientRoute: null,
          usesSharedRequestGuard: true,
          requiredRpcs: [],
        },
      },
    },
    configFunctions: new Map([
      ["clarify", { enabled: true, verifyJwt: false }],
      ["openai-chat", { enabled: false, verifyJwt: true }],
      ["openai-responses", { enabled: false, verifyJwt: true }],
      ["openai-stream", { enabled: false, verifyJwt: true }],
    ]),
    configProjectId: "abcdefghijklmnopqrst",
    redirects: [],
    netlifyTomlText: SAFE_NETLIFY_SECRET_SCAN_CONFIG,
    webApiGatewaySource: SAFE_WEB_API_GATEWAY,
    webApiProxySource: SAFE_WEB_API_PROXY,
    schemaProbeSource:
      "fetchHostedInventory(manifest); validateHostedInventory(manifest); fetchHostedFunctionInventory(manifest); fetchSchemaAttestation(manifest); fetchCapacityAttestation(manifest); fetchRoutingAttestation(manifest); manifest.capacityAttestation.fingerprintEnvironmentVariables; manifest.routingAttestation; manifest.webRequirements.requiredTablePrivileges; manifest.requiredRpcSignatures;",
    schemaAttestationMigrationExists: true,
    rpcArgumentAttestationMigrationExists: true,
    capacityAttestationMigrationExists: true,
    routingAttestationMigrationExists: true,
    netlifyManifestCount: 1,
    functionRpcUsage: new Map([
      ["clarify", new Set(["consume_rate_limit"])],
      ["openai-chat", new Set(["consume_rate_limit"])],
      ["openai-responses", new Set(["consume_rate_limit"])],
      ["openai-stream", new Set(["consume_rate_limit"])],
    ]),
    activeRawProxyConsumers: new Set(),
    workflowDeployCommands: new Map([
      [
        "deploy-prod.yml",
        ['node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"'],
      ],
    ]),
    workflowTexts: new Map([["deploy-prod.yml", SAFE_PRODUCTION_WORKFLOW]]),
    productionWorkflowText: SAFE_PRODUCTION_WORKFLOW,
  };
}

test("baseline state has no violations", () => {
  const failures = validateContract(baseState());
  assert.deepEqual(failures, []);
});

test("requires one exact canonical argument signature for every declared RPC", () => {
  const missing = baseState();
  delete missing.manifest.requiredRpcSignatures.consume_rate_limit;
  assert.match(validateContract(missing).join("\n"), /missing its exact argument-type contract/i);

  const drifted = baseState();
  drifted.manifest.requiredRpcSignatures.consume_rate_limit = "uuid, text, number, integer";
  assert.match(validateContract(drifted).join("\n"), /invalid canonical argument-type contract/i);
});

test("requires the versioned role-aware live schema attestation seam", () => {
  const state = baseState();
  state.schemaAttestationMigrationExists = false;
  state.schemaProbeSource = "legacy OpenAPI-only probe";

  const failures = validateContract(state);
  assert(failures.some((failure) => failure.includes("schema attestation RPC and migration")));
  assert(failures.some((failure) => failure.includes("role-aware privilege attestation")));
});

test("requires the four-route production capacity attestation seam", () => {
  const state = baseState();
  delete state.manifest.capacityAttestation.fingerprintEnvironmentVariables.review;
  state.capacityAttestationMigrationExists = false;
  state.schemaProbeSource = state.schemaProbeSource.replace("fetchCapacityAttestation", "skipped");

  const failures = validateContract(state);
  assert(failures.some((failure) => failure.includes("all four production OpenAI routes")));
  assert(failures.some((failure) => failure.includes("role-aware privilege attestation")));
});

test("requires exact expiring production routing and evaluation attestation", () => {
  const state = baseState();
  state.manifest.routingAttestation.routes.review.reasoningEffort = "medium";
  state.routingAttestationMigrationExists = false;
  state.schemaProbeSource = state.schemaProbeSource.replace(
    "fetchRoutingAttestation",
    "skippedRoutingAttestation",
  );

  const failures = validateContract(state);
  assert(
    failures.some((failure) =>
      failure.includes("exact reviewed models, reasoning, routing, and expiring evaluation"),
    ),
  );
  assert(failures.some((failure) => failure.includes("role-aware privilege attestation")));
});

test("requires the exact pre-migration inventory contract and executable seams", () => {
  const drifted = baseState();
  drifted.manifest.preMigrationInventory.brandAssets.bucketId = "brand-assets";
  drifted.schemaProbeSource = drifted.schemaProbeSource
    .replace("fetchHostedInventory", "decorativeInventory")
    .replace("fetchHostedFunctionInventory", "decorativeFunctionList");

  const failures = validateContract(drifted);
  assert.ok(failures.some((failure) => failure.includes("exact reviewed pre-migration")));
  assert.ok(failures.some((failure) => failure.includes("pre-migration inventory")));
});

test("raw provider compatibility functions cannot re-enter the active production contract", () => {
  const active = baseState();
  active.manifest.functions["openai-responses"].status = "active";
  active.configFunctions.set("openai-responses", { enabled: true, verifyJwt: true });

  const failures = validateContract(active);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes('"openai-responses"') && failure.includes("must remain dormant"),
    ),
  );
  assert.ok(
    failures.some(
      (failure) => failure.includes("enabled=false") && failure.includes('"openai-responses"'),
    ),
  );
});

test("active functions cannot consume the dormant raw provider façade", () => {
  const state = baseState();
  state.activeRawProxyConsumers.add("clarify");

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes('Active function "clarify"') &&
        failure.includes("dormant raw provider compatibility façade"),
    ),
  );
});

test("requires every reviewed browser identifier from the Netlify failure surface", () => {
  for (const publicIdentifier of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_REVENUECAT_WEB_KEY",
    "NEXT_PUBLIC_SENTRY_DSN",
    "NEXT_PUBLIC_POSTHOG_KEY",
  ]) {
    const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(new RegExp(`,?${publicIdentifier}`), "");

    const failures = validateNetlifySecretScanConfig(unsafe);
    assert.ok(
      failures.some((failure) => failure.includes(publicIdentifier)),
      `Expected ${publicIdentifier} to be required`,
    );
  }
});

test("pins the required Node and pnpm releases in Netlify", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(
    'NODE_VERSION = "22.23.2"',
    'NODE_VERSION = "26"',
  ).replace('PNPM_VERSION = "10.33.0"', 'PNPM_VERSION = "10"');

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(failures.some((failure) => failure.includes('NODE_VERSION to "22.23.2"')));
  assert.ok(failures.some((failure) => failure.includes('PNPM_VERSION to "10.33.0"')));
});

test("keeps Netlify secret scanning enabled and generated-function output covered", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(
    'SECRETS_SCAN_ENABLED = "true"',
    'SECRETS_SCAN_ENABLED = "false"',
  ).replace('SECRETS_SCAN_OMIT_PATHS = ""', 'SECRETS_SCAN_OMIT_PATHS = ".netlify/**"');

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("explicitly keep secret scanning enabled")),
  );
  assert.ok(failures.some((failure) => failure.includes("must not omit any generated path")));
});

test("allows secret-scan omissions only for reviewed public identifiers", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_SUPABASE_DATABASE_URL",
  );

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_SUPABASE_DATABASE_URL")));
});

test("rejects obsolete hosted aliases as Netlify secret-scan omissions", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_KEY,NEXT_SUPABASE_PROJECT_ID,NEXT_SUPABASE_URL,NETLIFY_SITE_ID",
  );

  const failures = validateNetlifySecretScanConfig(unsafe).join("\n");
  assert.match(failures, /NEXT_SUPABASE_PROJECT_ID/);
  assert.match(failures, /NEXT_SUPABASE_URL/);
  assert.match(failures, /NETLIFY_SITE_ID/);
});

test("does not pin the retired legacy Next.js plugin in netlify.toml", () => {
  const unsafe = `${SAFE_NETLIFY_SECRET_SCAN_CONFIG}\n[[plugins]]\n  package = "@netlify/plugin-nextjs"\n`;

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(failures.some((failure) => failure.includes("legacy Next.js plugin")));
});

test("rejects a function calling an undeclared RPC", () => {
  const state = baseState();
  // clarify's real code now also calls a second RPC the contract never
  // declared -- the exact bug class this contract exists to catch
  // (e.g. deploying `clarify` before its migration/RPC is declared).
  state.functionRpcUsage.set("clarify", new Set(["consume_rate_limit", "reserve_document_credit"]));

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes('"clarify"') && f.includes("reserve_document_credit")),
    `expected an undeclared-RPC failure, got: ${JSON.stringify(failures)}`,
  );
});

test("authenticated RPC declarations participate in static closure coverage and are validated", () => {
  const state = baseState();
  state.functionRpcUsage.set(
    "clarify",
    new Set(["consume_rate_limit", "get_captured_document_operation"]),
  );
  state.manifest.functions.clarify.requiredAuthenticatedRpcs = ["get_captured_document_operation"];
  state.manifest.requiredRpcSignatures.get_captured_document_operation = "uuid";
  assert.deepEqual(validateContract(state), []);

  state.manifest.functions.clarify.requiredAuthenticatedRpcs = ["invalid-rpc-name"];
  assert(
    validateContract(state).some((failure) =>
      failure.includes("invalid requiredAuthenticatedRpcs contract"),
    ),
  );
});

test("scans durable runner RPC wrapper literals", () => {
  const calls = scanRpcCalls(`
    await rpcState(params.gateway, "renew_captured_document_operation_lease", {});
    await rpcValue(
      gateway,
      'get_captured_document_resume_payload',
      {},
    );
  `);

  assert.deepEqual([...calls].sort(), [
    "get_captured_document_resume_payload",
    "renew_captured_document_operation_lease",
  ]);
});

test("static data scan classifies table and Storage verbs without treating filters as operations", () => {
  const usage = scanSupabaseDataOperations(`
    await admin.from("documents").select("id").eq("user_id", userId).order("id");
    await admin.from("documents").insert({ id: "one" });
    await admin.from("documents").update({ title: "Updated" }).match({ id: "one" });
    await admin.from("documents").delete().in("id", ["one"]);
    await admin.from("deduplicated").upsert({ id: "one" }, { ignoreDuplicates: true }).select();
    await admin.from("mutable").upsert({ id: "one" });
    await admin.storage.from("assets").upload("one", bytes, { upsert: false });
    await admin.storage.from("assets").download("one");
    await admin.storage.from("assets").remove(["one"]);
    await admin.storage.from(bucket).list("prefix");
    Array.from(["not-a-table"]).filter(Boolean);
    Buffer.from("not-a-table");
  `);

  assert.deepEqual([...usage.tableOperations.get("documents")].sort(), [
    "delete",
    "insert",
    "select",
    "update",
  ]);
  assert.deepEqual([...usage.tableOperations.get("deduplicated")].sort(), ["insert", "select"]);
  assert.deepEqual([...usage.tableOperations.get("mutable")].sort(), ["insert", "update"]);
  assert.deepEqual([...usage.storageOperations.get("assets")].sort(), [
    "delete",
    "insert",
    "select",
  ]);
  assert.deepEqual([...usage.storageOperations.get("<dynamic>")], ["select"]);
  assert.deepEqual(usage.unclassified, []);
  assert.deepEqual(
    [...scanTableCalls(`admin.from("documents"); admin.storage.from("assets");`)],
    ["documents"],
  );
});

test("static data scan fails closed on dynamic tables and unknown direct verbs", () => {
  const usage = scanSupabaseDataOperations(`
    await admin.from(tableName).select("id");
    await admin.from("documents").archive();
    await admin.storage.from("assets").archive("one");
  `);

  assert.deepEqual(
    usage.unclassified.map(({ kind, reason }) => ({ kind, reason })),
    [
      { kind: "table", reason: "direct table names must be string literals" },
      { kind: "table", reason: 'unknown table-chain method "archive"' },
      { kind: "storage", reason: 'unknown Storage verb "archive"' },
    ],
  );
});

test("direct table privilege validation rejects exact operation drift", () => {
  const state = baseState();
  state.functionTableUsage = new Map([
    ["clarify", scanSupabaseDataOperations('await admin.from("subscriptions").select("plan");')],
  ]);
  let failures = validateContract(state);
  assert(
    failures.some(
      (failure) => failure.includes('table "subscriptions"') && failure.includes("not declared"),
    ),
  );

  state.manifest.sharedRequestGuard.requiredTables = ["subscriptions"];
  failures = validateContract(state);
  assert(
    failures.some((failure) => failure.includes("without declared service-role table privileges")),
  );

  state.manifest.sharedRequestGuard.requiredTablePrivileges = { subscriptions: ["insert"] };
  failures = validateContract(state);
  assert(
    failures.some(
      (failure) =>
        failure.includes('performs "select"') && failure.includes("declares only [insert]"),
    ),
  );

  state.manifest.sharedRequestGuard.requiredTablePrivileges = { subscriptions: ["select"] };
  assert.deepEqual(validateContract(state), []);
});

test("an explicit empty table privilege contract is valid only for a declared zero-grant table", () => {
  const state = baseState();
  state.manifest.webRequirements = {
    requiredTables: ["ted_artifact_versions"],
    requiredTablePrivileges: { ted_artifact_versions: [] },
  };
  assert.deepEqual(validateContract(state), []);

  state.manifest.webRequirements.requiredTables = [];
  assert(
    validateContract(state).some((failure) =>
      failure.includes('names undeclared table "ted_artifact_versions"'),
    ),
  );
});

test("function and shared privilege declarations merge instead of overwriting one another", () => {
  const state = baseState();
  state.manifest.functions.clarify.requiredTables = ["usage_ledger"];
  state.manifest.functions.clarify.requiredTablePrivileges = { usage_ledger: ["insert"] };
  state.manifest.sharedRequestGuard.requiredTables = ["usage_ledger"];
  state.manifest.sharedRequestGuard.requiredTablePrivileges = { usage_ledger: ["select"] };
  state.functionTableUsage = new Map([
    [
      "clarify",
      scanSupabaseDataOperations(`
        await admin.from("usage_ledger").insert({ event_type: "model_call" });
        await admin.from("usage_ledger").select("id").eq("user_id", userId);
      `),
    ],
  ]);

  assert.deepEqual(validateContract(state), []);
});

test("known Storage operations remain outside table ACL declarations but unknown verbs fail closed", () => {
  const state = baseState();
  state.functionTableUsage = new Map([
    ["clarify", scanSupabaseDataOperations("await admin.storage.from(bucket).remove(paths);")],
  ]);
  assert.deepEqual(validateContract(state), []);

  state.functionTableUsage.set(
    "clarify",
    scanSupabaseDataOperations('await admin.storage.from("assets").archive("one");'),
  );
  assert(
    validateContract(state).some(
      (failure) => failure.includes("unclassifiable") && failure.includes("unknown Storage verb"),
    ),
  );
});

test("function table scan includes operations from the recursive imported dependency closure", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "prompted-deployment-contract-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const functionDirectory = join(repoRoot, "supabase/functions/example");
  const sharedDirectory = join(repoRoot, "supabase/functions/_shared");
  await mkdir(functionDirectory, { recursive: true });
  await mkdir(sharedDirectory, { recursive: true });
  await writeFile(
    join(functionDirectory, "index.ts"),
    'import { updateDocument } from "../_shared/first.ts";\nexport { updateDocument };\n',
  );
  await writeFile(
    join(sharedDirectory, "first.ts"),
    'export { updateDocument } from "./second.ts";\n',
  );
  await writeFile(
    join(sharedDirectory, "second.ts"),
    'export const updateDocument = (admin) => admin.from("documents").update({ title: "x" }).eq("id", "one");\n',
  );

  const usage = await scanFunctionTableUsage(repoRoot, ["example"]);
  assert.deepEqual([...usage.get("example").tableOperations.get("documents")], ["update"]);
  assert.deepEqual(usage.get("example").unclassified, []);
});

test("rejects a Netlify redirect that bypasses the environment-scoped gateway", () => {
  const state = baseState();
  state.redirects.push({
    from: "/api/clarify",
    to: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/clarify",
  });

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes("bypasses") && f.includes("/api/clarify")),
    `expected a gateway-bypass failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects a second Netlify manifest", () => {
  const state = baseState();
  state.netlifyManifestCount = 2;

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes("Netlify manifest")),
    `expected a two-Netlify-manifests failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects a project-pinned Supabase origin in netlify.toml", () => {
  const state = baseState();
  state.netlifyTomlText += "\n# https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/clarify\n";

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes("must not pin browser API traffic")),
    `expected a project-pinning failure, got: ${JSON.stringify(failures)}`,
  );
});

test("requires the reviewed Next.js gateway and contract-derived proxy", () => {
  const state = baseState();
  state.webApiGatewaySource = "";
  state.webApiProxySource = "";

  const failures = validateContract(state);
  assert.ok(failures.some((failure) => failure.includes("stable browser API surface")));
  assert.ok(failures.some((failure) => failure.includes("derive active routes")));
});

test("projectRefFromUrl accepts only an exact HTTPS Supabase hostname", () => {
  assert.equal(
    projectRefFromUrl("https://jjsykocqpjlekgsbylkd.supabase.co/functions/v1/clarify"),
    "jjsykocqpjlekgsbylkd",
  );

  for (const target of [
    "http://jjsykocqpjlekgsbylkd.supabase.co/functions/v1/clarify",
    "https://user:password@jjsykocqpjlekgsbylkd.supabase.co/functions/v1/clarify",
    "https://jjsykocqpjlekgsbylkd.supabase.co:8443/functions/v1/clarify",
    "https://jjsykocqpjlekgsbylkd.supabase.co.attacker.example/functions/v1/clarify",
    "not a URL",
  ]) {
    assert.equal(projectRefFromUrl(target), null, target);
  }
});

test("rejects a deployment list missing a configured function", () => {
  const state = baseState();
  // supabase/config.toml enables a function that was never added to the
  // deployment contract -- exactly how `clarify` could ship without anyone
  // declaring it depends on consume_rate_limit.
  state.configFunctions.set("recommend", { enabled: true, verifyJwt: false });

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes('"recommend"') && f.includes("no entry")),
    `expected a missing-from-contract failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects an invalid function identifier in the deployment contract", () => {
  const state = baseState();
  state.manifest.functions["clarify; echo injected"] = {
    ...state.manifest.functions.clarify,
    clientRoute: null,
  };

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("clarify; echo injected") &&
        failure.includes("invalid function identifier"),
    ),
    `expected an invalid-function-identifier failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects authMode drift between the contract and supabase/config.toml", () => {
  const state = baseState();
  state.configFunctions.set("clarify", { enabled: true, verifyJwt: true });

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes('"clarify"') && f.includes("authMode")),
    `expected an authMode-drift failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects authMode values outside the exact deployment enum", () => {
  const state = baseState();
  state.manifest.functions.clarify.authMode = "jtw";
  state.configFunctions.set("clarify", { enabled: true, verifyJwt: false });

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes('Function "clarify"') && failure.includes('invalid authMode "jtw"'),
    ),
    `expected an exact authMode-enum failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects an internal service-role function that is exposed as a browser route", () => {
  const state = baseState();
  state.manifest.functions["extract-upload"] = {
    status: "active",
    authMode: "anon",
    clientRoute: "/api/extract-upload",
    usesSharedRequestGuard: true,
    internalServiceRole: true,
    requiredRpcs: [],
  };
  state.configFunctions.set("extract-upload", {
    enabled: true,
    verifyJwt: false,
  });
  state.functionRpcUsage.set("extract-upload", new Set());

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes('"extract-upload"') && failure.includes("internal service-role boundary"),
    ),
    `expected an internal-boundary failure, got: ${JSON.stringify(failures)}`,
  );
});

test("requires an internal service-role function to declare a strict 405 endpoint probe", () => {
  const state = baseState();
  state.manifest.functions["extract-upload"] = {
    status: "active",
    authMode: "internal-service-role",
    clientRoute: null,
    usesSharedRequestGuard: false,
    internalServiceRole: true,
    requiredRpcs: [],
    smokeProbe: { kind: "rpc", name: "load_upload_extraction_snapshot" },
  };
  state.configFunctions.set("extract-upload", {
    enabled: true,
    verifyJwt: false,
  });
  state.functionRpcUsage.set("extract-upload", new Set());

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes('Function "extract-upload"') &&
        failure.includes("strict unauthenticated 405 endpoint probe"),
    ),
    `expected an internal endpoint-probe failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects a function dependency that is missing or inactive", () => {
  const state = baseState();
  state.manifest.functions.clarify.requiredFunctions = ["extract-upload"];

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes('"clarify"') && failure.includes('active dependency "extract-upload"'),
    ),
    `expected a function-dependency failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects a blanket (non-contract-driven) function deploy command", () => {
  const state = baseState();
  // A blanket deploy would still redeploy a function this contract marks
  // retired -- exactly the gap flagged in review: a workflow that deploys
  // "everything supabase/config.toml has enabled" instead of the contract's
  // active-function set.
  state.workflowDeployCommands.set("deploy-prod.yml", [
    'supabase functions deploy --use-api --project-ref "$SUPABASE_PROJECT_REF"',
  ]);

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes("deploy-prod.yml") && f.includes("not driven by")),
    `expected a non-contract-driven-deploy failure, got: ${JSON.stringify(failures)}`,
  );
});

test("requires the production workflow to own function deployment", () => {
  const state = baseState();
  state.workflowDeployCommands.delete("deploy-prod.yml");

  const failures = validateContract(state);
  assert.ok(
    failures.some((f) => f.includes("deploy-prod.yml") && f.includes("must own")),
    `expected a missing-production-deploy failure, got: ${JSON.stringify(failures)}`,
  );
});

test("rejects an independent function-deployment bypass", () => {
  const state = baseState();
  state.workflowDeployCommands.set("deploy-supabase-functions.yml", [
    'node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"',
  ]);

  const failures = validateContract(state);
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("deploy-supabase-functions.yml") &&
        failure.includes("independent function-deployment bypass"),
    ),
    `expected an independent-deployment failure, got: ${JSON.stringify(failures)}`,
  );
});

test("findFunctionsDeployCommands extracts only deploy lines", () => {
  const workflowText = [
    "steps:",
    '  - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"',
    "  - run: |",
    '      supabase functions deploy clarify recommend --use-api --project-ref "$SUPABASE_PROJECT_REF"',
    '  - run: echo "not a deploy command"',
  ].join("\n");

  const commands = findFunctionsDeployCommands(workflowText);
  assert.deepEqual(commands, [
    'supabase functions deploy clarify recommend --use-api --project-ref "$SUPABASE_PROJECT_REF"',
  ]);
});

test("isContractDrivenDeployCommand accepts only the safe argument-array launcher", () => {
  assert.equal(
    isContractDrivenDeployCommand(
      'node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"',
    ),
    true,
  );
  assert.equal(
    isContractDrivenDeployCommand("supabase functions deploy --use-api --project-ref x"),
    false,
  );
  assert.equal(
    isContractDrivenDeployCommand(
      "supabase functions deploy ${{ steps.functions.outputs.names }} --use-api --project-ref x",
    ),
    false,
  );
});

const SAFE_PRODUCTION_WORKFLOW = `
permissions: {}
concurrency:
  group: production-release
  cancel-in-progress: false
jobs:
  verify-release:
    timeout-minutes: 45
    permissions:
      contents: read
    steps:
      - uses: denoland/setup-deno@pinned
        with:
          deno-version: v2.9.5
      - uses: supabase/setup-cli@pinned
        with:
          version: "2.114.0"
      - run: test "$GITHUB_REF" = "refs/heads/Thought-Enhanced-Document"
      - run: pnpm verify:web
      - run: deno check supabase/functions/*/index.ts
      - run: deno test --allow-env --allow-read supabase/functions
      - run: rg -n '(anthropic|google[_-]?ai|gemini)' supabase/functions
      - run: supabase start -x studio,imgproxy,mailpit,logflare,vector,supavisor
      - run: supabase db reset --local
      - run: supabase test db
      - if: always()
        run: supabase stop --no-backup
  deploy-functions-prod:
    environment: production
    timeout-minutes: 30
    needs: verify-release
    permissions:
      contents: read
    steps:
      - run: corepack enable && corepack prepare pnpm@10.33.0 --activate
      - run: pnpm install --frozen-lockfile
      - run: node scripts/check-deployment-contract.mjs
      - name: Validate the production target before mutation
        run: node scripts/probe-supabase-contract.mjs
        env:
          SUPABASE_PROBE_MODE: target
      - run: node scripts/check-supabase-secret-names.mjs
      - name: Inventory hosted release state before mutation
        run: node scripts/probe-supabase-contract.mjs
        env:
          SUPABASE_PROBE_MODE: inventory
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
          SUPABASE_URL: \${{ secrets.PROD_SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.PROD_SUPABASE_PROJECT_REF }}
      - name: Capture immutable backend release baseline
        id: backend_baseline
        run: node scripts/backend-release-baseline.mjs capture --path "$RUNNER_TEMP/prompted-backend-release-baseline.json" --git-sha "$GITHUB_SHA"
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
          SUPABASE_URL: \${{ secrets.PROD_SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.PROD_SUPABASE_PROJECT_REF }}
      - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"
        env:
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
      - name: Revalidate immutable backend release baseline
        run: node scripts/backend-release-baseline.mjs verify --path "$RUNNER_TEMP/prompted-backend-release-baseline.json" --git-sha "$GITHUB_SHA"
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
          SUPABASE_URL: \${{ secrets.PROD_SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.PROD_SUPABASE_PROJECT_REF }}
      - run: supabase db push --linked
      - run: node scripts/probe-supabase-contract.mjs
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
          PROD_OPENAI_FAST_CAPACITY_FINGERPRINT: \${{ secrets.PROD_OPENAI_FAST_CAPACITY_FINGERPRINT }}
          PROD_OPENAI_DEEP_CAPACITY_FINGERPRINT: \${{ secrets.PROD_OPENAI_DEEP_CAPACITY_FINGERPRINT }}
          PROD_OPENAI_RESEARCH_CAPACITY_FINGERPRINT: \${{ secrets.PROD_OPENAI_RESEARCH_CAPACITY_FINGERPRINT }}
          PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT: \${{ secrets.PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT }}
          PROD_OPENAI_FAST_MODEL: \${{ secrets.PROD_OPENAI_FAST_MODEL }}
          PROD_OPENAI_DEEP_MODEL: \${{ secrets.PROD_OPENAI_DEEP_MODEL }}
          PROD_OPENAI_RESEARCH_MODEL: \${{ secrets.PROD_OPENAI_RESEARCH_MODEL }}
          PROD_OPENAI_REVIEW_MODEL: \${{ secrets.PROD_OPENAI_REVIEW_MODEL }}
          PROD_OPENAI_ROUTING_VERSION: \${{ secrets.PROD_OPENAI_ROUTING_VERSION }}
          PROD_OPENAI_EVALUATION_SUITE_VERSION: \${{ secrets.PROD_OPENAI_EVALUATION_SUITE_VERSION }}
          PROD_OPENAI_FAST_EVALUATION_FINGERPRINT: \${{ secrets.PROD_OPENAI_FAST_EVALUATION_FINGERPRINT }}
          PROD_OPENAI_DEEP_EVALUATION_FINGERPRINT: \${{ secrets.PROD_OPENAI_DEEP_EVALUATION_FINGERPRINT }}
          PROD_OPENAI_RESEARCH_EVALUATION_FINGERPRINT: \${{ secrets.PROD_OPENAI_RESEARCH_EVALUATION_FINGERPRINT }}
          PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT: \${{ secrets.PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT }}
      - run: node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"
      - name: Verify hosted functions and JWT modes after deployment
        run: node scripts/probe-supabase-contract.mjs
        env:
          SUPABASE_PROBE_MODE: post_function
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
          SUPABASE_URL: \${{ secrets.PROD_SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.PROD_SUPABASE_PROJECT_REF }}
      - run: node scripts/probe-supabase-contract.mjs
        env:
          SUPABASE_PROBE_MODE: smoke
      - name: Report backend state after a failed release without rollback
        if: \${{ failure() && steps.backend_baseline.outcome == 'success' }}
        run: node scripts/backend-release-baseline.mjs report --path "$RUNNER_TEMP/prompted-backend-release-baseline.json" --git-sha "$GITHUB_SHA"
        env:
          SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: \${{ secrets.PROD_SUPABASE_DB_PASSWORD }}
          SUPABASE_URL: \${{ secrets.PROD_SUPABASE_URL }}
          SUPABASE_PROJECT_REF: \${{ secrets.PROD_SUPABASE_PROJECT_REF }}
  deploy-web-prod:
    environment: production
    timeout-minutes: 90
    needs: deploy-functions-prod
    permissions:
      contents: read
    steps:
      - run: npm install -g netlify-cli@27.3.0
      - run: node scripts/deploy-netlify-production.mjs --site-id "$NETLIFY_SITE_ID" --git-sha "$GITHUB_SHA" --url "https://ted.littlemissscarlett.co"
        env:
          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_PROD_SITE_ID }}
          NEXT_PUBLIC_APP_ENV: production
          SECRETS_SCAN_ENABLED: "true"
          SECRETS_SCAN_OMIT_PATHS: ""
          SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_REVENUECAT_WEB_KEY,NEXT_PUBLIC_SENTRY_DSN,NEXT_PUBLIC_POSTHOG_KEY
`;

test("production release verification precedes every mutation", () => {
  assert.deepEqual(validateProductionWorkflow(SAFE_PRODUCTION_WORKFLOW), []);
});

test("production workflow requires bounded timeouts for every release job", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace("    timeout-minutes: 45\n", "")
    .replace("    timeout-minutes: 30\n", "    timeout-minutes: 120\n")
    .replace("    timeout-minutes: 90\n", "    timeout-minutes: 0\n");

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes('job "verify-release"') && failure.includes("45")),
  );
  assert.ok(
    failures.some(
      (failure) => failure.includes('job "deploy-functions-prod"') && failure.includes("30"),
    ),
  );
  assert.ok(
    failures.some((failure) => failure.includes('job "deploy-web-prod"') && failure.includes("90")),
  );
});

test("production function deployment installs workspace packages before the static checker", () => {
  const missingInstall = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: pnpm install --frozen-lockfile\n",
    "",
  );
  const lateInstall = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: pnpm install --frozen-lockfile\n" +
      "      - run: node scripts/check-deployment-contract.mjs\n",
    "      - run: node scripts/check-deployment-contract.mjs\n" +
      "      - run: pnpm install --frozen-lockfile\n",
  );

  for (const unsafe of [missingInstall, lateInstall]) {
    assert.ok(
      validateProductionWorkflow(unsafe).some((failure) =>
        failure.includes("install pinned workspace dependencies"),
      ),
    );
  }
});

test("production workflow rejects mutation before the complete release gate", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace("    needs: verify-release\n", "").replace(
    "      - run: pnpm verify:web",
    "      - run: pnpm lint",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("pnpm verify:web")));
  assert.ok(failures.some((failure) => failure.includes('need "verify-release"')));
});

test("production workflow requires Edge and fresh-database gates before mutation", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: deno check supabase/functions/*/index.ts\n",
    "",
  )
    .replace("      - run: deno test --allow-env --allow-read supabase/functions\n", "")
    .replace("      - run: rg -n '(anthropic|google[_-]?ai|gemini)' supabase/functions\n", "")
    .replace(
      "      - run: supabase start -x studio,imgproxy,mailpit,logflare,vector,supavisor\n",
      "",
    )
    .replace("      - run: supabase db reset --local\n", "")
    .replace("      - run: supabase test db\n", "");

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("Edge Function type-check")));
  assert.ok(failures.some((failure) => failure.includes("Edge Function tests")));
  assert.ok(failures.some((failure) => failure.includes("non-OpenAI provider code")));
  assert.ok(failures.some((failure) => failure.includes("fresh local database")));
  assert.ok(failures.some((failure) => failure.includes("database tests")));
});

test("production workflow requires an exact production-ref guard", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    '      - run: test "$GITHUB_REF" = "refs/heads/Thought-Enhanced-Document"\n',
    "",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("refs/heads/Thought-Enhanced-Document")),
    `expected a production-ref failure, got: ${JSON.stringify(failures)}`,
  );
});

test("production workflow requires target validation before the first mutation", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace("          SUPABASE_PROBE_MODE: target\n", "");

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("target identity")),
    `expected a pre-mutation target-identity failure, got: ${JSON.stringify(failures)}`,
  );
});

test("production workflow requires post-function inventory before smoke", () => {
  const postStep =
    "      - name: Verify hosted functions and JWT modes after deployment\n" +
    "        run: node scripts/probe-supabase-contract.mjs\n" +
    "        env:\n" +
    "          SUPABASE_PROBE_MODE: post_function\n" +
    "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n" +
    "          SUPABASE_DB_PASSWORD: ${{ secrets.PROD_SUPABASE_DB_PASSWORD }}\n" +
    "          SUPABASE_URL: ${{ secrets.PROD_SUPABASE_URL }}\n" +
    "          SUPABASE_PROJECT_REF: ${{ secrets.PROD_SUPABASE_PROJECT_REF }}\n";
  const removed = SAFE_PRODUCTION_WORKFLOW.replace(postStep, "");
  const reordered = SAFE_PRODUCTION_WORKFLOW.replace(postStep, "").replace(
    '      - run: node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"\n',
    postStep +
      '      - run: node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"\n',
  );
  for (const unsafe of [removed, reordered]) {
    assert.ok(
      validateProductionWorkflow(unsafe).some((failure) =>
        failure.includes("post-function inventory"),
      ),
    );
  }
});

test("production workflow requires metadata-only secret readiness before mutation", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: node scripts/check-supabase-secret-names.mjs\n",
    "",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("secret names before mutation")),
    `expected a secret-readiness failure, got: ${JSON.stringify(failures)}`,
  );
});

test("production workflow requires hosted inventory before link and database push", () => {
  const withoutInventory = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - name: Inventory hosted release state before mutation\n" +
      "        run: node scripts/probe-supabase-contract.mjs\n" +
      "        env:\n" +
      "          SUPABASE_PROBE_MODE: inventory\n" +
      "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n" +
      "          SUPABASE_DB_PASSWORD: ${{ secrets.PROD_SUPABASE_DB_PASSWORD }}\n" +
      "          SUPABASE_URL: ${{ secrets.PROD_SUPABASE_URL }}\n" +
      "          SUPABASE_PROJECT_REF: ${{ secrets.PROD_SUPABASE_PROJECT_REF }}\n",
    "",
  );
  assert.ok(
    validateProductionWorkflow(withoutInventory).some((failure) =>
      failure.includes("hosted release inventory"),
    ),
  );

  const inventoryStep = SAFE_PRODUCTION_WORKFLOW.match(
    /      - name: Inventory hosted release state before mutation[\s\S]*?PROD_SUPABASE_PROJECT_REF \}\}\n/,
  )?.[0];
  assert.ok(inventoryStep);
  const afterPush = SAFE_PRODUCTION_WORKFLOW.replace(inventoryStep, "").replace(
    "      - run: supabase db push --linked\n",
    "      - run: supabase db push --linked\n" + inventoryStep,
  );
  assert.ok(
    validateProductionWorkflow(afterPush).some((failure) =>
      failure.includes("hosted release inventory"),
    ),
  );
});

test("production inventory requires its exact mode and scoped CLI credentials", () => {
  for (const [needle, replacement, expected] of [
    ["SUPABASE_PROBE_MODE: inventory", "SUPABASE_PROBE_MODE: target", "inventory"],
    [
      "SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
      "SUPABASE_ACCESS_TOKEN:",
      "SUPABASE_ACCESS_TOKEN",
    ],
    [
      "SUPABASE_DB_PASSWORD: ${{ secrets.PROD_SUPABASE_DB_PASSWORD }}",
      "SUPABASE_DB_PASSWORD:",
      "PROD_SUPABASE_DB_PASSWORD",
    ],
    ["SUPABASE_URL: ${{ secrets.PROD_SUPABASE_URL }}", "SUPABASE_URL:", "PROD_SUPABASE_URL"],
    [
      "SUPABASE_PROJECT_REF: ${{ secrets.PROD_SUPABASE_PROJECT_REF }}",
      "SUPABASE_PROJECT_REF:",
      "PROD_SUPABASE_PROJECT_REF",
    ],
  ]) {
    const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(needle, replacement);
    assert.ok(
      validateProductionWorkflow(unsafe).some((failure) => failure.includes(expected)),
      expected,
    );
  }
});

test("production backend mutation is bound to one immutable baseline and immediate revalidation", () => {
  const withoutCapture = SAFE_PRODUCTION_WORKFLOW.replace(
    /      - name: Capture immutable backend release baseline[\s\S]*?          SUPABASE_PROJECT_REF: \$\{\{ secrets[.]PROD_SUPABASE_PROJECT_REF \}\}\n/,
    "",
  );
  const withoutVerify = SAFE_PRODUCTION_WORKFLOW.replace(
    /      - name: Revalidate immutable backend release baseline[\s\S]*?          SUPABASE_PROJECT_REF: \$\{\{ secrets[.]PROD_SUPABASE_PROJECT_REF \}\}\n/,
    "",
  );
  const verifyAfterPush = SAFE_PRODUCTION_WORKFLOW.replace(
    /      - name: Revalidate immutable backend release baseline[\s\S]*?          SUPABASE_PROJECT_REF: \$\{\{ secrets[.]PROD_SUPABASE_PROJECT_REF \}\}\n/,
    "",
  ).replace(
    "      - run: supabase db push --linked\n",
    "      - run: supabase db push --linked\n" +
      SAFE_PRODUCTION_WORKFLOW.match(
        /      - name: Revalidate immutable backend release baseline[\s\S]*?          SUPABASE_PROJECT_REF: \$\{\{ secrets[.]PROD_SUPABASE_PROJECT_REF \}\}\n/,
      )[0],
  );
  const interveningMutation = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: supabase db push --linked\n",
    "      - run: supabase functions deploy unsafe\n" + "      - run: supabase db push --linked\n",
  );

  for (const unsafe of [withoutCapture, withoutVerify, verifyAfterPush, interveningMutation]) {
    assert.ok(
      validateProductionWorkflow(unsafe).some((failure) =>
        failure.includes("immutable backend release baseline"),
      ),
    );
  }
});

test("production backend failures emit a read-only report and never automate database rollback", () => {
  const withoutReport = SAFE_PRODUCTION_WORKFLOW.replace(
    /      - name: Report backend state after a failed release without rollback[\s\S]*?          SUPABASE_PROJECT_REF: \$\{\{ secrets[.]PROD_SUPABASE_PROJECT_REF \}\}\n/,
    "",
  );
  const automaticRepair = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: supabase db push --linked\n",
    "      - run: supabase db push --linked\n" +
      "      - run: supabase migration repair --status reverted 20260902018000\n",
  );

  assert.ok(
    validateProductionWorkflow(withoutReport).some((failure) =>
      failure.includes("read-only backend failure report"),
    ),
  );
  assert.ok(
    validateProductionWorkflow(automaticRepair).some((failure) =>
      failure.includes("automated database rollback"),
    ),
  );
});

test("production web deployment remains strictly blocked by any backend failure", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "  deploy-web-prod:\n",
    "  deploy-web-prod:\n    if: always()\n",
  );
  assert.ok(
    validateProductionWorkflow(unsafe).some((failure) =>
      failure.includes("strictly require backend success"),
    ),
  );
});

test("production Supabase link receives the protected database password non-interactively", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    '      - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"\n' +
      "        env:\n" +
      "          SUPABASE_DB_PASSWORD: ${{ secrets.PROD_SUPABASE_DB_PASSWORD }}\n",
    '      - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"\n',
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("Supabase link") && failure.includes("password")),
  );
});

test("production probes the applied schema with scoped database credentials before functions", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - run: supabase db push --linked\n",
    "",
  ).replace(
    "      - run: node scripts/probe-supabase-contract.mjs\n" +
      "        env:\n" +
      "          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n" +
      "          SUPABASE_DB_PASSWORD: ${{ secrets.PROD_SUPABASE_DB_PASSWORD }}\n",
    "",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("probe the applied live schema")));
  assert.ok(failures.some((failure) => failure.includes("applied-schema probe")));
});

test("production schema probe requires all approved capacity fingerprints", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "          PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT: ${{ secrets.PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT }}\n",
    "",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert(failures.some((failure) => failure.includes("PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT")));
});

test("production schema probe requires exact routing and evaluation inputs", () => {
  for (const variable of [
    "PROD_OPENAI_FAST_MODEL",
    "PROD_OPENAI_DEEP_MODEL",
    "PROD_OPENAI_RESEARCH_MODEL",
    "PROD_OPENAI_REVIEW_MODEL",
    "PROD_OPENAI_ROUTING_VERSION",
    "PROD_OPENAI_EVALUATION_SUITE_VERSION",
    "PROD_OPENAI_FAST_EVALUATION_FINGERPRINT",
    "PROD_OPENAI_DEEP_EVALUATION_FINGERPRINT",
    "PROD_OPENAI_RESEARCH_EVALUATION_FINGERPRINT",
    "PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT",
  ]) {
    const line = `          ${variable}: \${{ secrets.${variable} }}\n`;
    const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(line, "");
    assert(
      validateProductionWorkflow(unsafe).some((failure) => failure.includes(variable)),
      variable,
    );
  }
});

test("production workflow requires least privilege and non-cancelling serialization", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "permissions: {}\n",
    "permissions:\n  contents: write\n",
  ).replace("  cancel-in-progress: false", "  cancel-in-progress: true");

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("top-level permissions")));
  assert.ok(failures.some((failure) => failure.includes("cancel-in-progress")));
});

test("production web deployment pins the current CLI and preserves narrow secret scanning", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace("netlify-cli@27.3.0", "netlify-cli@17")
    .replace("          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_PROD_SITE_ID }}\n", "")
    .replace("          NEXT_PUBLIC_APP_ENV: production\n", "")
    .replace('          SECRETS_SCAN_ENABLED: "true"', '          SECRETS_SCAN_ENABLED: "false"')
    .replace(
      '          SECRETS_SCAN_OMIT_PATHS: ""',
      '          SECRETS_SCAN_OMIT_PATHS: ".netlify/**"',
    )
    .replace(
      "SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL",
      "SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_DATABASE_URL",
    );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("netlify-cli@27.3.0")));
  assert.ok(failures.some((failure) => failure.includes("NETLIFY_PROD_SITE_ID")));
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_APP_ENV")));
  assert.ok(failures.some((failure) => failure.includes("secret scanning enabled")));
  assert.ok(failures.some((failure) => failure.includes("must not omit any generated path")));
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_SUPABASE_DATABASE_URL")));
});

test("production web deployment rejects safe job-level decoys around an unsafe launcher step", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "    permissions:\n      contents: read\n    steps:\n      - run: npm install -g netlify-cli@27.3.0",
    `    permissions:
      contents: read
    env:
      NETLIFY_SITE_ID: \${{ secrets.NETLIFY_PROD_SITE_ID }}
      NEXT_PUBLIC_APP_ENV: production
      SECRETS_SCAN_ENABLED: "true"
      SECRETS_SCAN_OMIT_PATHS: ""
      SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_REVENUECAT_WEB_KEY,NEXT_PUBLIC_SENTRY_DSN,NEXT_PUBLIC_POSTHOG_KEY
    steps:
      - run: npm install -g netlify-cli@27.3.0`,
  )
    .replace(
      "          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_PROD_SITE_ID }}",
      "          NETLIFY_SITE_ID: \${{ secrets.WRONG_SITE_ID }}",
    )
    .replace("          NEXT_PUBLIC_APP_ENV: production", "          NEXT_PUBLIC_APP_ENV: preview")
    .replace('          SECRETS_SCAN_ENABLED: "true"', '          SECRETS_SCAN_ENABLED: "false"')
    .replace(
      '          SECRETS_SCAN_OMIT_PATHS: ""',
      '          SECRETS_SCAN_OMIT_PATHS: ".netlify/**"',
    )
    .replace(
      "          SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL",
      "          SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_DATABASE_URL",
    );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("NETLIFY_PROD_SITE_ID")));
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_APP_ENV")));
  assert.ok(failures.some((failure) => failure.includes("secret scanning enabled")));
  assert.ok(failures.some((failure) => failure.includes("must not omit any generated path")));
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_SUPABASE_DATABASE_URL")));
});

test("production web deployment rejects duplicate launcher steps", () => {
  const duplicateLauncher = `
      - run: node scripts/deploy-netlify-production.mjs --site-id "$NETLIFY_SITE_ID" --git-sha "$GITHUB_SHA" --url "https://ted.littlemissscarlett.co"
        env:
          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_PROD_SITE_ID }}
          NEXT_PUBLIC_APP_ENV: production
          SECRETS_SCAN_ENABLED: "true"
          SECRETS_SCAN_OMIT_PATHS: ""
          SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_REVENUECAT_WEB_KEY,NEXT_PUBLIC_SENTRY_DSN,NEXT_PUBLIC_POSTHOG_KEY`;
  const unsafe = SAFE_PRODUCTION_WORKFLOW + duplicateLauncher;

  assert.ok(
    validateProductionWorkflow(unsafe).some((failure) =>
      failure.includes("exactly one validated shell-free Netlify production launcher"),
    ),
  );
});

test("production web deployment rejects duplicate launcher-step secret-scan keys", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    '          SECRETS_SCAN_OMIT_PATHS: ""',
    '          SECRETS_SCAN_OMIT_PATHS: ""\n          SECRETS_SCAN_OMIT_PATHS: ".netlify/**"',
  );

  assert.ok(
    validateProductionWorkflow(unsafe).some((failure) =>
      failure.includes("must set SECRETS_SCAN_OMIT_PATHS exactly once to an empty value"),
    ),
  );
});

test("production mutation jobs require the exact production environment and retain the shell-free web launcher", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "  deploy-functions-prod:\n    environment: production\n",
    "  deploy-functions-prod:\n",
  )
    .replace(
      "  deploy-web-prod:\n    environment: production\n",
      "  deploy-web-prod:\n    environment: PrompTED.AI\n",
    )
    .replace(
      'node scripts/deploy-netlify-production.mjs --site-id "$NETLIFY_SITE_ID" --git-sha "$GITHUB_SHA" --url "https://ted.littlemissscarlett.co"',
      'netlify deploy --prod --site "$NETLIFY_SITE_ID"',
    );

  const failures = validateProductionWorkflow(unsafe);
  assert.equal(
    failures.filter((failure) => failure.includes('must declare exactly "environment: production"'))
      .length,
    2,
  );
  assert.ok(failures.some((failure) => failure.includes("shell-free Netlify")));
  assert.ok(failures.some((failure) => failure.includes("raw shell syntax")));
});

test("workflow authority rejects branch-writing controllers and write contents", () => {
  const unsafe = `
permissions:
  contents: write
jobs:
  controller:
    permissions:
      contents: write
    steps:
      - run: |
          git checkout --ours -- unsafe.ts
          git add -A
          git rebase origin/Thought-Enhanced-Document
          git push origin HEAD:Thought-Enhanced-Document
`;

  const failures = validateWorkflowAuthority("controller.yml", unsafe);
  assert.ok(failures.some((failure) => failure.includes("contents: write")));
  assert.ok(failures.some((failure) => failure.includes("automatic --ours")));
  assert.ok(failures.some((failure) => failure.includes("broad git add")));
  assert.ok(failures.some((failure) => failure.includes("git rebase")));
  assert.ok(failures.some((failure) => failure.includes("git push")));
});

test("workflow authority requires explicit permissions for every workflow and job", () => {
  const unsafe = `
name: Missing permissions
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`;

  const failures = validateWorkflowAuthority("missing.yml", unsafe);
  assert.ok(failures.some((failure) => failure.includes("top-level permissions")));
  assert.ok(failures.some((failure) => failure.includes('job "test"')));
});

test("workflow authority requires the locally verified Deno and Supabase CLI versions", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "deno-version: v2.9.5",
    "deno-version: v2.x",
  ).replace('version: "2.114.0"', 'version: "2.84.2"');

  const failures = validateWorkflowAuthority("deploy-prod.yml", unsafe);
  assert.ok(failures.some((failure) => failure.includes("Deno to v2.9.5")));
  assert.ok(failures.some((failure) => failure.includes("Supabase CLI to 2.114.0")));
});

test("workflow authority rejects one drifting setup even when another setup is pinned", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "      - uses: supabase/setup-cli@pinned\n",
    "      - uses: supabase/setup-cli@stale\n" +
      "        with:\n" +
      '          version: "2.84.2"\n' +
      "      - uses: supabase/setup-cli@pinned\n",
  );

  const failures = validateWorkflowAuthority("deploy-prod.yml", unsafe);
  assert.ok(failures.some((failure) => failure.includes("Supabase CLI to 2.114.0")));
});

test("workflow authority rejects blank permission declarations", () => {
  const unsafe = `
name: Blank permissions
permissions:
jobs:
  test:
    permissions:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`;

  const failures = validateWorkflowAuthority("blank-permissions.yml", unsafe);
  assert.ok(failures.some((failure) => failure.includes("top-level permissions")));
  assert.ok(failures.some((failure) => failure.includes('job "test"')));
});

test("workflow authority rejects deployment outside the production owner", () => {
  const unsafeRawDeploy = `
permissions: {}
jobs:
  deploy:
    permissions:
      contents: read
    steps:
      - run: netlify deploy --prod
`;

  const unsafeLauncher = unsafeRawDeploy.replace(
    "netlify deploy --prod",
    "node scripts/deploy-netlify-production.mjs --site-id example",
  );

  for (const unsafe of [unsafeRawDeploy, unsafeLauncher]) {
    const failures = validateWorkflowAuthority("preview.yml", unsafe);
    assert.ok(failures.some((failure) => failure.includes("independent deployment route")));
  }
});

test("workflow authority accepts read-only CI and narrowly-scoped issue housekeeping", () => {
  const ci = `
permissions: {}
jobs:
  test:
    permissions:
      contents: read
    steps:
      - run: pnpm test
`;
  const stale = `
permissions: {}
jobs:
  stale:
    permissions:
      issues: write
      pull-requests: write
    steps:
      - uses: actions/stale@v5
`;

  assert.deepEqual(validateWorkflowAuthority("ci.yml", ci), []);
  assert.deepEqual(validateWorkflowAuthority("stale.yml", stale), []);
});
