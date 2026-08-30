import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findFunctionsDeployCommands,
  isContractDrivenDeployCommand,
  projectRefFromUrl,
  validateContract,
  validateNetlifySecretScanConfig,
  validateProductionWorkflow,
  validateWorkflowAuthority,
} from "./check-deployment-contract.mjs";

const SAFE_NETLIFY_SECRET_SCAN_CONFIG = `
[build.environment]
  NODE_VERSION = "22.23.2"
  PNPM_VERSION = "10.33.0"
  SECRETS_SCAN_OMIT_KEYS = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY"
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

test("raw provider compatibility functions cannot re-enter the active production contract", () => {
  const active = baseState();
  active.manifest.functions["openai-responses"].status = "active";
  active.configFunctions.set("openai-responses", { enabled: true, verifyJwt: true });

  const failures = validateContract(active);
  assert.ok(
    failures.some((failure) =>
      failure.includes('"openai-responses"') && failure.includes("must remain dormant")
    ),
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes('enabled=false') && failure.includes('"openai-responses"')
    ),
  );
});

test("active functions cannot consume the dormant raw provider façade", () => {
  const state = baseState();
  state.activeRawProxyConsumers.add("clarify");

  const failures = validateContract(state);
  assert.ok(
    failures.some((failure) =>
      failure.includes('Active function "clarify"') &&
      failure.includes("dormant raw provider compatibility façade")
    ),
  );
});

test("requires browser-visible Supabase values in the root Netlify omit-key list", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(
    ",NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "",
  );

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY")));
});

test("pins the required Node and pnpm releases in Netlify", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG
    .replace('NODE_VERSION = "22.23.2"', 'NODE_VERSION = "26"')
    .replace('PNPM_VERSION = "10.33.0"', 'PNPM_VERSION = "10"');

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(failures.some((failure) => failure.includes('NODE_VERSION to "22.23.2"')));
  assert.ok(failures.some((failure) => failure.includes('PNPM_VERSION to "10.33.0"')));
});

test("keeps Netlify secret scanning enabled and generated-function output covered", () => {
  const unsafe = SAFE_NETLIFY_SECRET_SCAN_CONFIG.replace(
    "[build.environment]",
    '[build.environment]\n  SECRETS_SCAN_ENABLED = "false"',
  ) + '\n  SECRETS_SCAN_OMIT_PATHS = ".netlify/**"\n';

  const failures = validateNetlifySecretScanConfig(unsafe);
  assert.ok(failures.some((failure) => failure.includes("must not disable secret scanning")));
  assert.ok(failures.some((failure) => failure.includes("generated Next.js or Netlify output")));
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
  state.netlifyTomlText +=
    '\n# https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/clarify\n';

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
    failures.some((failure) =>
      failure.includes("clarify; echo injected") &&
      failure.includes("invalid function identifier")
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
    failures.some((failure) =>
      failure.includes("deploy-supabase-functions.yml") &&
      failure.includes("independent function-deployment bypass")
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
  assert.equal(isContractDrivenDeployCommand('supabase functions deploy --use-api --project-ref x'), false);
  assert.equal(
    isContractDrivenDeployCommand(
      'supabase functions deploy ${{ steps.functions.outputs.names }} --use-api --project-ref x',
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
    permissions:
      contents: read
    steps:
      - run: test "$GITHUB_REF" = "refs/heads/main"
      - run: pnpm verify:web
  deploy-functions-prod:
    environment: PrompTED.AI
    needs: verify-release
    permissions:
      contents: read
    steps:
      - name: Validate the production target before mutation
        run: node scripts/probe-supabase-contract.mjs
        env:
          SUPABASE_PROBE_MODE: target
      - run: node scripts/check-supabase-secret-names.mjs
      - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"
      - run: node scripts/deploy-contract-functions.mjs --project-ref "$SUPABASE_PROJECT_REF"
  deploy-web-prod:
    environment: PrompTED.AI
    needs: deploy-functions-prod
    permissions:
      contents: read
    steps:
      - run: npm install -g netlify-cli@27.3.0
      - run: node scripts/deploy-netlify-production.mjs --site-id "$NETLIFY_SITE_ID" --git-sha "$GITHUB_SHA" --url "https://ted.littlemissscarlett.co"
        env:
          NEXT_PUBLIC_APP_ENV: production
          SECRETS_SCAN_OMIT_KEYS: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY
`;

test("production release verification precedes every mutation", () => {
  assert.deepEqual(validateProductionWorkflow(SAFE_PRODUCTION_WORKFLOW), []);
});

test("production workflow rejects mutation before the complete release gate", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW
    .replace("    needs: verify-release\n", "")
    .replace("      - run: pnpm verify:web", "      - run: pnpm lint");

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("pnpm verify:web")));
  assert.ok(failures.some((failure) => failure.includes("need \"verify-release\"")));
});

test("production workflow requires an exact production-ref guard", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    '      - run: test "$GITHUB_REF" = "refs/heads/main"\n',
    "",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("refs/heads/main")),
    `expected a production-ref failure, got: ${JSON.stringify(failures)}`,
  );
});

test("production workflow requires target validation before the first mutation", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW.replace(
    "          SUPABASE_PROBE_MODE: target\n",
    "",
  );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(
    failures.some((failure) => failure.includes("target identity")),
    `expected a pre-mutation target-identity failure, got: ${JSON.stringify(failures)}`,
  );
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

test("production workflow requires least privilege and non-cancelling serialization", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW
    .replace("permissions: {}\n", "permissions:\n  contents: write\n")
    .replace("  cancel-in-progress: false", "  cancel-in-progress: true");

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("top-level permissions")));
  assert.ok(failures.some((failure) => failure.includes("cancel-in-progress")));
});

test("production web deployment pins the current CLI and preserves narrow secret scanning", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW
    .replace("netlify-cli@27.3.0", "netlify-cli@17")
    .replace(",NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    .replace("          NEXT_PUBLIC_APP_ENV: production\n", "")
    .replace(
      "          SECRETS_SCAN_OMIT_KEYS:",
      '          SECRETS_SCAN_OMIT_PATHS: .netlify/**\n          SECRETS_SCAN_OMIT_KEYS:',
    );

  const failures = validateProductionWorkflow(unsafe);
  assert.ok(failures.some((failure) => failure.includes("netlify-cli@27.3.0")));
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY")));
  assert.ok(failures.some((failure) => failure.includes("NEXT_PUBLIC_APP_ENV")));
  assert.ok(failures.some((failure) => failure.includes("generated Next.js or Netlify output")));
});

test("production mutation jobs require the protected environment and shell-free web launcher", () => {
  const unsafe = SAFE_PRODUCTION_WORKFLOW
    .replaceAll("    environment: PrompTED.AI\n", "")
    .replace(
      'node scripts/deploy-netlify-production.mjs --site-id "$NETLIFY_SITE_ID" --git-sha "$GITHUB_SHA" --url "https://ted.littlemissscarlett.co"',
      'netlify deploy --prod --site "$NETLIFY_SITE_ID"',
    );

  const failures = validateProductionWorkflow(unsafe);
  assert.equal(
    failures.filter((failure) => failure.includes("protected PrompTED.AI environment")).length,
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
          git rebase origin/main
          git push origin HEAD:main
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
