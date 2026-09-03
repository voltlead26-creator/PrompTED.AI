import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildNetlifyBuildArgs,
  buildNetlifyDraftDeployArgs,
  buildNetlifyPromoteArgs,
  buildNetlifySiteLookupArgs,
  deployNetlifyProduction,
  parseDraftDeploy,
  parseNetlifySiteAttestation,
  parsePromotedDeploy,
  preflightSupabaseAnonKey,
  sealNetlifyArtifact,
  smokeProductionWeb,
  validateProductionDeployInput,
} from "./deploy-netlify-production.mjs";

const SUPABASE_PROJECT_REF = "jjsykocqpjlekgsbylkd";

function fakeSupabaseJwt({ projectRef = SUPABASE_PROJECT_REF, role = "anon" } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ref: projectRef, role })}.${"a".repeat(43)}`;
}

const SAFE_INPUT = {
  siteId: "11111111-2222-4333-8444-555555555555",
  gitSha: "5574dee72e02f44507b22bd3c761dfc9d3c3bd51",
  baseUrl: "https://app.prompted.example",
  expectedBaseUrl: "https://app.prompted.example",
  gitRef: "refs/heads/main",
  authToken: "test-token",
  appEnvironment: "production",
  supabaseUrl: `https://${SUPABASE_PROJECT_REF}.supabase.co`,
  supabaseAnonKey: fakeSupabaseJwt(),
};
const DEPLOY_ID = "5b4e23db82d3f1780abd74f2";
const PREVIOUS_DEPLOY_ID = "5b4e23db82d3f1780abd74f1";
const INTERVENING_DEPLOY_ID = "5b4e23db82d3f1780abd74f0";
const DRAFT_URL = `https://${DEPLOY_ID}--prompted.netlify.app`;
const PREVIOUS_DEPLOY_URL = `https://${PREVIOUS_DEPLOY_ID}--prompted.netlify.app`;
const SEALED_ARTIFACT = {
  algorithm: "sha256",
  digest: "a".repeat(64),
  fileCount: 12,
  byteCount: 4096,
  roots: ["apps/web/.netlify/v1", "apps/web/.next"],
};

function sitePayload(overrides = {}) {
  return {
    id: SAFE_INPUT.siteId,
    ssl_url: SAFE_INPUT.baseUrl,
    custom_domain: new URL(SAFE_INPUT.baseUrl).hostname,
    published_deploy: { id: PREVIOUS_DEPLOY_ID },
    ...overrides,
  };
}

function draftPayload(overrides = {}) {
  return {
    site_id: SAFE_INPUT.siteId,
    deploy_id: DEPLOY_ID,
    deploy_url: DRAFT_URL,
    ...overrides,
  };
}

function promotionPayload(overrides = {}) {
  return {
    id: DEPLOY_ID,
    site_id: SAFE_INPUT.siteId,
    state: "ready",
    draft: false,
    url: SAFE_INPUT.baseUrl,
    ssl_url: SAFE_INPUT.baseUrl,
    deploy_url: DRAFT_URL,
    deploy_ssl_url: DRAFT_URL,
    published_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function rollbackPayload(overrides = {}) {
  return promotionPayload({
    id: PREVIOUS_DEPLOY_ID,
    deploy_url: PREVIOUS_DEPLOY_URL,
    deploy_ssl_url: PREVIOUS_DEPLOY_URL,
    ...overrides,
  });
}

function cleanGitAttestation(args) {
  return {
    status: 0,
    stdout: args[0] === "rev-parse" ? `${SAFE_INPUT.gitSha}\n` : "",
  };
}

function smokeFetch(
  requests,
  {
    protectedStatus = 401,
    attestedSha = SAFE_INPUT.gitSha,
    corsOrigin = SAFE_INPUT.baseUrl,
    corsGetOrigin = corsOrigin,
    corsMethods = "POST, GET, OPTIONS",
  } = {},
) {
  return async (url, options = {}) => {
    requests.push({
      url,
      method: options.method ?? "GET",
      origin: options.headers?.origin ?? options.headers?.Origin ?? null,
      apiKey: options.headers?.apikey ?? null,
      authorization: options.headers?.authorization ?? null,
      redirect: options.redirect ?? null,
    });
    if (url === `${SAFE_INPUT.supabaseUrl}/rest/v1/`) {
      return new Response(null, { status: 200 });
    }
    if (url.includes("/release-attestation")) {
      return Response.json({ schemaVersion: 1, gitSha: attestedSha });
    }
    if (url.includes("/functions/v1/document-operation")) {
      const headers = {
        "Access-Control-Allow-Origin": options.method === "OPTIONS" ? corsOrigin : corsGetOrigin,
        "Access-Control-Allow-Methods": corsMethods,
      };
      if (options.method === "OPTIONS") {
        return new Response("ok", { status: 200, headers });
      }
      return Response.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: protectedStatus, headers },
      );
    }
    if (url.includes("/api/document-operation")) {
      if (options.method === "OPTIONS") {
        return new Response("ok", { status: 200 });
      }
      return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: protectedStatus });
    }
    return new Response("<!doctype html><html><body>PrompTED</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

function canonicalSmokeFailureScenario({
  siteLookups,
  rollbackResult = { status: 0, stdout: JSON.stringify(rollbackPayload()) },
  canonicalFailure = new Response("broken", { status: 503 }),
} = {}) {
  const calls = [];
  const draftFetch = smokeFetch([]);
  let siteLookupCalls = 0;
  const promise = deployNetlifyProduction(SAFE_INPUT, {
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      if (command === "git") return cleanGitAttestation(args);
      if (args[0] === "api" && args[1] === "getSite") {
        const result = siteLookups[siteLookupCalls];
        siteLookupCalls += 1;
        if (typeof result === "string") {
          return {
            status: 0,
            stdout: JSON.stringify(sitePayload({ published_deploy: { id: result } })),
          };
        }
        if (result) return result;
        throw new Error(`unexpected Netlify site lookup ${siteLookupCalls}`);
      }
      if (args[0] === "build") return { status: 0, stdout: "" };
      if (args[0] === "deploy") {
        return { status: 0, stdout: JSON.stringify(draftPayload()) };
      }
      if (args[0] === "api" && args[1] === "restoreSiteDeploy") {
        const targetDeployId = JSON.parse(args[3]).deploy_id;
        if (targetDeployId === DEPLOY_ID) {
          return { status: 0, stdout: JSON.stringify(promotionPayload()) };
        }
        if (targetDeployId === PREVIOUS_DEPLOY_ID) return rollbackResult;
        throw new Error(`unexpected restore target ${targetDeployId}`);
      }
      throw new Error(`unexpected process call: ${command} ${args.join(" ")}`);
    },
    fetchImpl: async (url, options) => {
      if (url.startsWith(SAFE_INPUT.baseUrl)) {
        if (canonicalFailure instanceof Error) throw canonicalFailure;
        return canonicalFailure;
      }
      return draftFetch(url, options);
    },
    sealArtifactImpl: async () => SEALED_ARTIFACT,
    smokeAttempts: 1,
    smokeDelayMs: 0,
  });

  return {
    calls,
    promise,
    get siteLookupCalls() {
      return siteLookupCalls;
    },
  };
}

test("production deploy input accepts only the exact branch, URL and identifier contracts", () => {
  assert.deepEqual(validateProductionDeployInput(SAFE_INPUT), {
    siteId: SAFE_INPUT.siteId,
    gitSha: SAFE_INPUT.gitSha,
    baseUrl: SAFE_INPUT.baseUrl,
  });

  for (const unsafe of [
    { ...SAFE_INPUT, siteId: `${SAFE_INPUT.siteId}; touch injected` },
    { ...SAFE_INPUT, gitSha: `${SAFE_INPUT.gitSha}$(id)` },
    { ...SAFE_INPUT, baseUrl: "http://ted.littlemissscarlett.co" },
    { ...SAFE_INPUT, baseUrl: "https://ted.littlemissscarlett.co.attacker.example" },
    { ...SAFE_INPUT, baseUrl: "https://user:pass@ted.littlemissscarlett.co" },
    { ...SAFE_INPUT, expectedBaseUrl: "https://different.prompted.example" },
    { ...SAFE_INPUT, gitRef: "refs/heads/reliably-prompTED" },
    { ...SAFE_INPUT, authToken: "" },
    { ...SAFE_INPUT, appEnvironment: "preview" },
    { ...SAFE_INPUT, supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co" },
    { ...SAFE_INPUT, supabaseAnonKey: "public-anon-key-for-build-only" },
  ]) {
    assert.throws(() => validateProductionDeployInput(unsafe));
  }
});

test("production input accepts supported public keys and rejects malformed or misbound keys", () => {
  assert.doesNotThrow(() =>
    validateProductionDeployInput({
      ...SAFE_INPUT,
      supabaseAnonKey: `sb_publishable_${"p".repeat(32)}`,
    }),
  );

  for (const supabaseAnonKey of [
    "not-a-supabase-key",
    `sb_secret_${"s".repeat(32)}`,
    fakeSupabaseJwt({ projectRef: "abcdefghijklmnopqrst" }),
    fakeSupabaseJwt({ role: "service_role" }),
  ]) {
    assert.throws(
      () => validateProductionDeployInput({ ...SAFE_INPUT, supabaseAnonKey }),
      /Supabase anonymous key/i,
    );
  }
});

test("Supabase anonymous-key preflight binds the public credential to the reviewed REST endpoint", async () => {
  const requests = [];
  const result = await preflightSupabaseAnonKey(
    SAFE_INPUT.supabaseUrl,
    SAFE_INPUT.supabaseAnonKey,
    {
      timeoutMs: 500,
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(null, { status: 204 });
      },
    },
  );

  assert.deepEqual(result, { projectRef: SUPABASE_PROJECT_REF, status: 204 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${SAFE_INPUT.supabaseUrl}/rest/v1/`);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.headers.apikey, SAFE_INPUT.supabaseAnonKey);
  assert.equal(requests[0].options.headers.authorization, `Bearer ${SAFE_INPUT.supabaseAnonKey}`);
  assert(requests[0].options.signal instanceof AbortSignal);
});

test("Supabase anonymous-key preflight fails closed without exposing credentials or response bodies", async () => {
  const privateBody = `private rejection for ${SAFE_INPUT.supabaseAnonKey}`;
  for (const status of [401, 403, 500]) {
    await assert.rejects(
      preflightSupabaseAnonKey(SAFE_INPUT.supabaseUrl, SAFE_INPUT.supabaseAnonKey, {
        fetchImpl: async () => new Response(privateBody, { status }),
      }),
      (error) =>
        error.message === `Supabase anonymous key preflight failed with HTTP ${status}.` &&
        !error.message.includes(SAFE_INPUT.supabaseAnonKey) &&
        !error.message.includes(privateBody),
    );
  }

  await assert.rejects(
    preflightSupabaseAnonKey(SAFE_INPUT.supabaseUrl, SAFE_INPUT.supabaseAnonKey, {
      fetchImpl: async () => ({
        status: 200,
        redirected: true,
        url: "https://attacker.example/rest/v1/",
        body: null,
      }),
    }),
    (error) =>
      /refused a redirected response/i.test(error.message) &&
      !error.message.includes("attacker.example"),
  );

  let observedAbort = false;
  await assert.rejects(
    preflightSupabaseAnonKey(SAFE_INPUT.supabaseUrl, SAFE_INPUT.supabaseAnonKey, {
      timeoutMs: 5,
      fetchImpl: async (_url, options) =>
        await new Promise((_resolve, reject) => {
          const keepAlive = setTimeout(() => reject(new Error("abort was not observed")), 100);
          options.signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              clearTimeout(keepAlive);
              reject(options.signal.reason);
            },
            { once: true },
          );
        }),
    }),
    (error) =>
      error.message === "Supabase anonymous key preflight failed before production publication." &&
      !error.message.includes(SAFE_INPUT.supabaseAnonKey),
  );
  assert.equal(observedAbort, true);

  await assert.rejects(
    preflightSupabaseAnonKey(SAFE_INPUT.supabaseUrl, SAFE_INPUT.supabaseAnonKey, {
      fetchImpl: async () => {
        throw new Error(privateBody);
      },
    }),
    (error) =>
      error.message === "Supabase anonymous key preflight failed before production publication." &&
      !error.message.includes(SAFE_INPUT.supabaseAnonKey) &&
      !error.message.includes(privateBody),
  );
});

test("Netlify arguments are shell-safe and promote the one uploaded draft", () => {
  assert.deepEqual(buildNetlifySiteLookupArgs(SAFE_INPUT), [
    "api",
    "getSite",
    "--data",
    JSON.stringify({ site_id: SAFE_INPUT.siteId }),
  ]);
  assert.deepEqual(buildNetlifyDraftDeployArgs(SAFE_INPUT), [
    "deploy",
    "--site",
    SAFE_INPUT.siteId,
    "--filter",
    "@prompted/web",
    "--no-build",
    "--context",
    "production",
    "--json",
    "--message",
    `Production candidate — ${SAFE_INPUT.gitSha}`,
  ]);
  assert.deepEqual(buildNetlifyBuildArgs(SAFE_INPUT), [
    "build",
    "--filter",
    "@prompted/web",
    "--context",
    "production",
    "--offline",
  ]);
  assert.deepEqual(buildNetlifyPromoteArgs(SAFE_INPUT, DEPLOY_ID), [
    "api",
    "restoreSiteDeploy",
    "--data",
    JSON.stringify({ site_id: SAFE_INPUT.siteId, deploy_id: DEPLOY_ID }),
  ]);
  assert.equal(buildNetlifySiteLookupArgs(SAFE_INPUT).includes(SAFE_INPUT.authToken), false);
  assert.equal(
    buildNetlifyPromoteArgs(SAFE_INPUT, DEPLOY_ID).includes(SAFE_INPUT.authToken),
    false,
  );
  assert.throws(() => buildNetlifyPromoteArgs(SAFE_INPUT, "not-a-deploy-id"));
});

test("site preflight binds the protected site ID to the expected production origin", () => {
  assert.deepEqual(parseNetlifySiteAttestation(JSON.stringify(sitePayload()), SAFE_INPUT), {
    siteId: SAFE_INPUT.siteId,
    baseUrl: SAFE_INPUT.baseUrl,
    previousDeployId: PREVIOUS_DEPLOY_ID,
  });

  assert.throws(
    () =>
      parseNetlifySiteAttestation(
        JSON.stringify(sitePayload({ id: "00000000-0000-4000-8000-000000000000" })),
        SAFE_INPUT,
      ),
    /site identity/i,
  );
  assert.throws(
    () =>
      parseNetlifySiteAttestation(
        JSON.stringify(
          sitePayload({
            ssl_url: "https://other.prompted.example",
            custom_domain: null,
          }),
        ),
        SAFE_INPUT,
      ),
    /production origin/i,
  );
  assert.throws(
    () =>
      parseNetlifySiteAttestation(
        JSON.stringify(sitePayload({ published_deploy: { id: "not-a-deploy-id" } })),
        SAFE_INPUT,
      ),
    /published deploy/i,
  );
  assert.throws(
    () =>
      parseNetlifySiteAttestation(
        JSON.stringify(sitePayload({ published_deploy: { id: PREVIOUS_DEPLOY_ID, locked: true } })),
        SAFE_INPUT,
      ),
    /locked/i,
  );
  assert.throws(() => parseNetlifySiteAttestation("not-json", SAFE_INPUT), /valid JSON/i);
});

test("draft output is bound to the protected site and a canonical Netlify HTTPS preview", () => {
  assert.deepEqual(parseDraftDeploy(JSON.stringify(draftPayload()), SAFE_INPUT.siteId), {
    siteId: SAFE_INPUT.siteId,
    deployId: DEPLOY_ID,
    deployUrl: DRAFT_URL,
  });
  for (const payload of [
    draftPayload({ site_id: "00000000-0000-4000-8000-000000000000" }),
    draftPayload({ deploy_id: "invalid deploy id" }),
    draftPayload({ deploy_url: "https://wrong-deploy--prompted.netlify.app" }),
    draftPayload({ deploy_url: "http://candidate--prompted.netlify.app" }),
    draftPayload({
      deploy_url: "https://candidate--prompted.netlify.app.attacker.example",
    }),
    draftPayload({
      deploy_url: "https://user:pass@candidate--prompted.netlify.app",
    }),
    draftPayload({
      deploy_url: "https://candidate--prompted.netlify.app/path",
    }),
  ]) {
    assert.throws(() => parseDraftDeploy(JSON.stringify(payload), SAFE_INPUT.siteId));
  }
  assert.throws(() => parseDraftDeploy("not-json", SAFE_INPUT.siteId));
});

test("promotion response is bound to the exact ready draft and production origin", () => {
  assert.deepEqual(
    parsePromotedDeploy(
      JSON.stringify(promotionPayload()),
      SAFE_INPUT.siteId,
      DEPLOY_ID,
      SAFE_INPUT.baseUrl,
    ),
    { siteId: SAFE_INPUT.siteId, deployId: DEPLOY_ID, baseUrl: SAFE_INPUT.baseUrl },
  );

  for (const payload of [
    promotionPayload({ id: "5b4e23db82d3f1780abd74f9" }),
    promotionPayload({ site_id: "00000000-0000-4000-8000-000000000000" }),
    promotionPayload({ state: "building" }),
    promotionPayload({ draft: true }),
    promotionPayload({ url: "https://wrong.prompted.example" }),
    promotionPayload({ deploy_ssl_url: "https://wrong--prompted.netlify.app" }),
    promotionPayload({ published_at: "not-a-timestamp" }),
  ]) {
    assert.throws(() =>
      parsePromotedDeploy(
        JSON.stringify(payload),
        SAFE_INPUT.siteId,
        DEPLOY_ID,
        SAFE_INPUT.baseUrl,
      ),
    );
  }
});

test("artifact seal deterministically covers publish and Netlify function output", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompted-netlify-seal-"));
  try {
    await mkdir(join(root, "apps/web/.next/server"), { recursive: true });
    await mkdir(join(root, "apps/web/.netlify/functions"), {
      recursive: true,
    });
    await writeFile(join(root, "apps/web/.next/server/app.js"), "publish-v1");
    await writeFile(join(root, "apps/web/.netlify/functions/server.mjs"), "function-v1");

    const confidentialValue = "netlify-private-canary-must-not-ship";
    await writeFile(
      join(root, "apps/web/.next/server/private-canary.js"),
      `export default ${JSON.stringify(confidentialValue)};`,
    );
    await assert.rejects(
      sealNetlifyArtifact(root, {
        forbiddenValues: [{ name: "NETLIFY_AUTH_TOKEN", value: confidentialValue }],
      }),
      (error) => {
        assert.match(error.message, /NETLIFY_AUTH_TOKEN/);
        assert.equal(error.message.includes(confidentialValue), false);
        return true;
      },
    );
    await rm(join(root, "apps/web/.next/server/private-canary.js"));

    const boundaryValue = "boundary-spanning-private-canary";
    await writeFile(
      join(root, "apps/web/.next/server/boundary-canary.js"),
      "a".repeat(65_530) + boundaryValue,
    );
    await assert.rejects(
      sealNetlifyArtifact(root, {
        forbiddenValues: [{ name: "NETLIFY_AUTH_TOKEN", value: boundaryValue }],
      }),
      /NETLIFY_AUTH_TOKEN/,
    );
    await rm(join(root, "apps/web/.next/server/boundary-canary.js"));

    const first = await sealNetlifyArtifact(root);
    const unchanged = await sealNetlifyArtifact(root);
    assert.deepEqual(unchanged, first);

    await writeFile(join(root, "apps/web/.next/server/app.js"), "publish-v2");
    const mutated = await sealNetlifyArtifact(root);
    assert.notEqual(mutated.digest, first.digest);

    await writeFile(join(root, "apps/web/.next/server/app.js"), "publish-v1");
    await writeFile(join(root, "apps/web/.netlify/functions/server.mjs"), "function-v2");
    const functionMutation = await sealNetlifyArtifact(root);
    assert.notEqual(functionMutation.digest, first.digest);

    await mkdir(join(root, "apps/web/.netlify/edge-functions-dist"), {
      recursive: true,
    });
    await writeFile(join(root, "apps/web/.netlify/edge-functions-dist/edge.js"), "edge-v1");
    const edgeAddition = await sealNetlifyArtifact(root);
    assert.notEqual(edgeAddition.digest, functionMutation.digest);

    await symlink("app.js", join(root, "apps/web/.next/server/linked-app.js"));
    const internalLink = await sealNetlifyArtifact(root);
    assert.notEqual(internalLink.digest, edgeAddition.digest);

    await writeFile(join(root, "apps/web/.next/server/app.js"), "publish-v3");
    const linkedTargetMutation = await sealNetlifyArtifact(root);
    assert.notEqual(linkedTargetMutation.digest, internalLink.digest);

    await symlink("missing.js", join(root, "apps/web/.next/server/broken-app.js"));
    await assert.rejects(sealNetlifyArtifact(root), /broken symbolic link/i);
    await rm(join(root, "apps/web/.next/server/broken-app.js"));

    await symlink(
      join(root, "apps/web/.next/server/app.js"),
      join(root, "apps/web/.next/server/absolute-app.js"),
    );
    await assert.rejects(sealNetlifyArtifact(root), /must be relative/i);
    await rm(join(root, "apps/web/.next/server/absolute-app.js"));

    await writeFile(join(root, "outside-artifact.js"), "not-deployable");
    await symlink(
      "../../../../outside-artifact.js",
      join(root, "apps/web/.next/server/escaping-app.js"),
    );
    await assert.rejects(sealNetlifyArtifact(root), /symbolic link escapes/i);
    await rm(join(root, "apps/web/.next/server/escaping-app.js"));

    await symlink("cycle-b.js", join(root, "apps/web/.next/server/cycle-a.js"));
    await symlink("cycle-a.js", join(root, "apps/web/.next/server/cycle-b.js"));
    await assert.rejects(sealNetlifyArtifact(root), /cyclic symbolic link/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact seal inspects expanded function archives without exposing a matched value", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompted-netlify-archive-seal-"));
  try {
    const functionRoot = join(root, "apps/web/.netlify/functions");
    const sourceRoot = join(root, "archive-source");
    await mkdir(join(root, "apps/web/.next/server"), { recursive: true });
    await mkdir(functionRoot, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(root, "apps/web/.next/server/app.js"), "publish-v1");
    const confidentialValue = "compressed-private-canary-must-not-ship";
    await writeFile(
      join(sourceRoot, "handler.mjs"),
      `export default ${JSON.stringify(confidentialValue)};`,
    );
    const archivePath = join(functionRoot, "server.zip");
    const zipResult = spawnSync("zip", ["-q", archivePath, "handler.mjs"], {
      cwd: sourceRoot,
      shell: false,
      stdio: "ignore",
    });
    assert.equal(zipResult.status, 0, "zip is required to construct the archive security fixture");

    await assert.rejects(
      sealNetlifyArtifact(root, {
        forbiddenValues: [{ name: "NETLIFY_AUTH_TOKEN", value: confidentialValue }],
      }),
      (error) => {
        assert.match(error.message, /NETLIFY_AUTH_TOKEN/);
        assert.equal(error.message.includes(confidentialValue), false);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hostile input fails before any process starts", async () => {
  let starts = 0;
  await assert.rejects(
    deployNetlifyProduction(
      { ...SAFE_INPUT, siteId: `${SAFE_INPUT.siteId}; echo injected` },
      {
        spawnImpl() {
          starts += 1;
          return { status: 0 };
        },
      },
    ),
  );
  assert.equal(starts, 0);
});

test("an unsafe web-build environment fails before any process starts", async () => {
  let starts = 0;
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      assertBuildEnvironmentImpl(options) {
        assert.equal(options.allowOuterNetlifyToken, true);
        throw new Error("Web build environment security check failed.");
      },
      spawnImpl() {
        starts += 1;
        return { status: 0 };
      },
    }),
    /Web build environment security check failed/,
  );
  assert.equal(starts, 0);
});

test("production deployment uploads once, smokes the draft, promotes its exact ID, and attests publication", async () => {
  const calls = [];
  const requests = [];
  const releaseEvents = [];
  const fetchForSmoke = smokeFetch(requests);
  let sealCalls = 0;
  const sealOptions = [];
  let siteLookupCalls = 0;
  const result = await deployNetlifyProduction(SAFE_INPUT, {
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      if (command === "git") return cleanGitAttestation(args);
      if (args[0] === "api" && args[1] === "getSite") {
        siteLookupCalls += 1;
        return {
          status: 0,
          stdout: JSON.stringify(
            sitePayload({
              published_deploy: {
                id: siteLookupCalls < 3 ? PREVIOUS_DEPLOY_ID : DEPLOY_ID,
              },
            }),
          ),
        };
      }
      if (args[0] === "build") return { status: 0, stdout: "" };
      if (args[0] === "deploy") {
        return { status: 0, stdout: JSON.stringify(draftPayload()) };
      }
      if (args[0] === "api" && args[1] === "restoreSiteDeploy") {
        releaseEvents.push("promote-deploy");
        return { status: 0, stdout: JSON.stringify(promotionPayload()) };
      }
      throw new Error(`unexpected process call: ${command} ${args.join(" ")}`);
    },
    fetchImpl: async (url, options) => {
      if (url === `${SAFE_INPUT.supabaseUrl}/rest/v1/`) {
        releaseEvents.push("supabase-key-preflight");
      }
      return fetchForSmoke(url, options);
    },
    sealArtifactImpl: async (_repoRoot, options) => {
      sealCalls += 1;
      sealOptions.push(options);
      releaseEvents.push(`artifact-seal-${sealCalls}`);
      return SEALED_ARTIFACT;
    },
    smokeAttempts: 1,
    smokeDelayMs: 0,
  });

  assert.equal(calls.length, 9);
  assert.equal(sealCalls, 2);
  assert.equal(sealOptions.length, 2);
  for (const options of sealOptions) {
    assert.deepEqual(options.forbiddenValues, [
      { name: "NETLIFY_AUTH_TOKEN", value: SAFE_INPUT.authToken },
    ]);
  }
  assert.equal(siteLookupCalls, 3);
  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args.slice(0, 2)]),
    [
      ["git", "rev-parse", "HEAD"],
      ["git", "status", "--porcelain"],
      ["netlify", "api", "getSite"],
      ["netlify", "build", "--filter"],
      ["git", "status", "--porcelain"],
      ["netlify", "deploy", "--site"],
      ["netlify", "api", "getSite"],
      ["netlify", "api", "restoreSiteDeploy"],
      ["netlify", "api", "getSite"],
    ],
  );
  assert.equal(
    calls.every(({ options }) => options.shell === false),
    true,
  );
  assert.deepEqual(
    calls.map(({ options }) => options.timeout),
    [30_000, 30_000, 60_000, 20 * 60_000, 30_000, 10 * 60_000, 60_000, 60_000, 60_000],
  );
  assert.equal(
    calls.every(
      ({ options }) =>
        options.killSignal === "SIGTERM" &&
        Number.isInteger(options.maxBuffer) &&
        options.maxBuffer > 0,
    ),
    true,
  );
  assert.equal(calls.filter(({ args }) => args[0] === "build").length, 1);
  assert.equal(calls.filter(({ args }) => args.includes("--build")).length, 0);
  assert.equal(calls.filter(({ args }) => args[0] === "deploy").length, 1);
  assert.equal(calls.find(({ args }) => args[0] === "deploy").args.includes("--no-build"), true);
  assert.equal(calls.filter(({ args }) => args.includes("--prod")).length, 0);
  assert.equal(
    calls.some(({ args }) => args.includes(SAFE_INPUT.authToken)),
    false,
  );
  assert.equal(calls[3].options.env.NEXT_PUBLIC_PROMPTED_BUILD_SHA, SAFE_INPUT.gitSha);
  assert.equal(calls[3].options.env.NETLIFY_AUTH_TOKEN, undefined);
  const netlifyControlCalls = calls.filter(
    ({ command, args }) => command === "netlify" && args[0] !== "build",
  );
  assert.ok(netlifyControlCalls.length > 0);
  for (const { args, options } of netlifyControlCalls) {
    assert.equal(args.includes(SAFE_INPUT.authToken), false);
    assert.equal(options.env.NETLIFY_AUTH_TOKEN, undefined);
    assert.equal(options.input, SAFE_INPUT.authToken);
    assert.match(options.env.NODE_OPTIONS, /netlify-cli-auth-stdin\.mjs/);
  }

  const protectedRequests = requests.filter(({ url }) => url.includes("document-operation"));
  assert.deepEqual(
    protectedRequests.map(({ method, origin }) => ({ method, origin })),
    [
      { method: "OPTIONS", origin: SAFE_INPUT.baseUrl },
      { method: "GET", origin: SAFE_INPUT.baseUrl },
      { method: "GET", origin: SAFE_INPUT.baseUrl },
      { method: "OPTIONS", origin: SAFE_INPUT.baseUrl },
      { method: "GET", origin: SAFE_INPUT.baseUrl },
      { method: "GET", origin: SAFE_INPUT.baseUrl },
    ],
  );
  const publicShellRequests = requests.filter(({ url }) =>
    ["/", "/sign-in", "/privacy"].some(
      (route) => url === `${DRAFT_URL}${route}` || url === `${SAFE_INPUT.baseUrl}${route}`,
    ),
  );
  assert.equal(publicShellRequests.length, 6);
  assert.equal(
    publicShellRequests.every(({ redirect }) => redirect === "error"),
    true,
  );
  const keyPreflightRequests = requests.filter(({ url }) => url.endsWith("/rest/v1/"));
  assert.deepEqual(keyPreflightRequests, [
    {
      url: `${SAFE_INPUT.supabaseUrl}/rest/v1/`,
      method: "GET",
      origin: null,
      apiKey: SAFE_INPUT.supabaseAnonKey,
      authorization: `Bearer ${SAFE_INPUT.supabaseAnonKey}`,
      redirect: "error",
    },
  ]);
  assert.deepEqual(releaseEvents, [
    "artifact-seal-1",
    "supabase-key-preflight",
    "artifact-seal-2",
    "promote-deploy",
  ]);
  assert.deepEqual(result, {
    baseUrl: SAFE_INPUT.baseUrl,
    draftUrl: DRAFT_URL,
    deployId: DEPLOY_ID,
    draftDeployId: DEPLOY_ID,
    previousDeployId: PREVIOUS_DEPLOY_ID,
    promotionAttestation: "direct",
    routes: [
      "/",
      "/sign-in",
      "/privacy",
      "/release-attestation",
      "/api/document-operation?operation_id=00000000-0000-4000-8000-000000000000",
    ],
  });
});

test("a checkout SHA mismatch stops before Netlify is contacted", async () => {
  const calls = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: `${"0".repeat(40)}\n` };
      },
    }),
    /checked-out commit does not match/i,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "git");
});

test("dirty tracked or untracked source stops before Netlify is contacted", async () => {
  for (const dirtyStatus of [
    " M apps/web/src/app/page.tsx\n",
    "?? apps/web/src/app/new-page.tsx\n",
  ]) {
    const calls = [];
    await assert.rejects(
      deployNetlifyProduction(SAFE_INPUT, {
        spawnImpl(command, args, options) {
          calls.push({ command, args, options });
          if (args[0] === "rev-parse") {
            return { status: 0, stdout: `${SAFE_INPUT.gitSha}\n` };
          }
          return { status: 0, stdout: dirtyStatus };
        },
      }),
      /worktree is not clean/i,
    );
    assert.deepEqual(
      calls.map(({ command, args }) => [command, ...args]),
      [
        ["git", "rev-parse", "HEAD"],
        ["git", "status", "--porcelain", "--untracked-files=all"],
      ],
    );
  }
});

test("a site/origin mismatch stops before a deploy starts", async () => {
  const calls = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        return {
          status: 0,
          stdout: JSON.stringify(
            sitePayload({
              ssl_url: "https://other.prompted.example",
              custom_domain: null,
            }),
          ),
        };
      },
    }),
    /production origin/i,
  );
  assert.equal(calls.length, 3);
  assert.equal(
    calls.some(({ args }) => args[0] === "deploy"),
    false,
  );
});

test("Netlify CLI authentication crosses stdin without remaining in the child environment", () => {
  const preloadUrl = new URL("./netlify-cli-auth-stdin.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const index = process.argv.indexOf("--auth"); console.log(JSON.stringify({ authenticated: index >= 0 && Boolean(process.argv[index + 1]), envCredential: Boolean(process.env.NETLIFY_AUTH_TOKEN), preloadInherited: Boolean(process.env.NODE_OPTIONS), markerInherited: Boolean(process.env.PROMPTED_NETLIFY_AUTH_STDIN) }));`,
    ],
    {
      encoding: "utf8",
      env: {
        NETLIFY_AUTH_TOKEN: "synthetic-env-value-that-must-be-removed",
        NODE_OPTIONS: `--import=${preloadUrl}`,
        PROMPTED_NETLIFY_AUTH_STDIN: "1",
      },
      input: SAFE_INPUT.authToken,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    authenticated: true,
    envCredential: false,
    preloadInherited: false,
    markerInherited: false,
  });
  assert.equal(result.stdout.includes(SAFE_INPUT.authToken), false);
});

test("a build or plugin source mutation stops before the draft upload", async () => {
  const calls = [];
  let statusCalls = 0;
  let sealCalls = 0;
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git" && args[0] === "rev-parse") {
          return { status: 0, stdout: `${SAFE_INPUT.gitSha}\n` };
        }
        if (command === "git" && args[0] === "status") {
          statusCalls += 1;
          return {
            status: 0,
            stdout: statusCalls === 1 ? "" : " M apps/web/src/generated.ts\n",
          };
        }
        if (args[0] === "api") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        throw new Error("draft upload must not start");
      },
      sealArtifactImpl: async () => {
        sealCalls += 1;
        return SEALED_ARTIFACT;
      },
    }),
    /worktree is not clean after the Netlify build/i,
  );
  assert.equal(statusCalls, 2);
  assert.equal(sealCalls, 0);
  assert.equal(
    calls.some(({ args }) => args[0] === "deploy"),
    false,
  );
});

test("a failed draft smoke never starts deploy promotion", async () => {
  const calls = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        return { status: 0, stdout: JSON.stringify(draftPayload()) };
      },
      fetchImpl: () => new Response("broken", { status: 503 }),
      sealArtifactImpl: async () => SEALED_ARTIFACT,
      smokeAttempts: 1,
      smokeDelayMs: 0,
    }),
  );
  assert.equal(calls.length, 6);
  assert.equal(
    calls.some(({ args }) => args[1] === "restoreSiteDeploy"),
    false,
  );
});

test("a draft candidate cannot reuse the captured prior published deploy ID", async () => {
  const calls = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api" && args[1] === "getSite") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        if (args[0] === "deploy") {
          return {
            status: 0,
            stdout: JSON.stringify(
              draftPayload({
                deploy_id: PREVIOUS_DEPLOY_ID,
                deploy_url: PREVIOUS_DEPLOY_URL,
              }),
            ),
          };
        }
        throw new Error("promotion must not start for a reused prior deploy ID");
      },
      sealArtifactImpl: async () => SEALED_ARTIFACT,
    }),
    /candidate matches the currently published deploy/i,
  );
  assert.equal(calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 0);
});

test("a timed-out Netlify build fails closed before any upload", async () => {
  const calls = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") {
          return {
            status: null,
            signal: "SIGTERM",
            error: Object.assign(new Error("Netlify build exceeded its bounded timeout."), {
              code: "ETIMEDOUT",
            }),
          };
        }
        throw new Error("an upload must not start after a build timeout");
      },
    }),
    /bounded timeout/i,
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[3].options.timeout, 20 * 60_000);
  assert.equal(
    calls.some(({ args }) => args[0] === "deploy"),
    false,
  );
});

test("a rejected Supabase anonymous key stops before deploy promotion", async () => {
  const calls = [];
  const requests = [];
  const draftFetch = smokeFetch(requests);
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api" && args[1] === "getSite") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        if (args[0] === "deploy") {
          return { status: 0, stdout: JSON.stringify(draftPayload()) };
        }
        throw new Error("deploy promotion must not start");
      },
      fetchImpl: async (url, options) => {
        if (url === `${SAFE_INPUT.supabaseUrl}/rest/v1/`) {
          return new Response("secret-bearing rejection body", { status: 401 });
        }
        return draftFetch(url, options);
      },
      sealArtifactImpl: async () => SEALED_ARTIFACT,
      smokeAttempts: 1,
      smokeDelayMs: 0,
    }),
    /Supabase anonymous key preflight failed/i,
  );
  assert.equal(
    calls.some(({ args }) => args[1] === "restoreSiteDeploy"),
    false,
  );
});

test("an artifact mutation after draft smoke blocks deploy promotion", async () => {
  const calls = [];
  let sealCalls = 0;
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        return { status: 0, stdout: JSON.stringify(draftPayload()) };
      },
      fetchImpl: smokeFetch([]),
      sealArtifactImpl: async () => {
        sealCalls += 1;
        return sealCalls === 1 ? SEALED_ARTIFACT : { ...SEALED_ARTIFACT, digest: "b".repeat(64) };
      },
      smokeAttempts: 1,
      smokeDelayMs: 0,
    }),
    /artifact changed after the draft upload/i,
  );
  assert.equal(sealCalls, 2);
  assert.equal(
    calls.some(({ args }) => args[1] === "restoreSiteDeploy"),
    false,
  );
});

for (const scenario of [
  {
    name: "an intervening production deploy",
    publishedDeploy: { id: INTERVENING_DEPLOY_ID },
    expectedError: /published deploy changed during the release/i,
  },
  {
    name: "an intervening production lock",
    publishedDeploy: { id: PREVIOUS_DEPLOY_ID, locked: true },
    expectedError: /locked/i,
  },
]) {
  test(`${scenario.name} stops before candidate promotion`, async () => {
    const calls = [];
    let siteLookupCalls = 0;
    await assert.rejects(
      deployNetlifyProduction(SAFE_INPUT, {
        spawnImpl(command, args, options) {
          calls.push({ command, args, options });
          if (command === "git") return cleanGitAttestation(args);
          if (args[0] === "api" && args[1] === "getSite") {
            siteLookupCalls += 1;
            return {
              status: 0,
              stdout: JSON.stringify(
                sitePayload({
                  published_deploy:
                    siteLookupCalls === 1 ? { id: PREVIOUS_DEPLOY_ID } : scenario.publishedDeploy,
                }),
              ),
            };
          }
          if (args[0] === "build") return { status: 0, stdout: "" };
          if (args[0] === "deploy") {
            return { status: 0, stdout: JSON.stringify(draftPayload()) };
          }
          if (args[0] === "api" && args[1] === "restoreSiteDeploy") {
            return { status: 0, stdout: JSON.stringify(promotionPayload()) };
          }
          throw new Error(`unexpected process call: ${command} ${args.join(" ")}`);
        },
        fetchImpl: smokeFetch([]),
        sealArtifactImpl: async () => SEALED_ARTIFACT,
        smokeAttempts: 1,
        smokeDelayMs: 0,
      }),
      scenario.expectedError,
    );
    assert.equal(siteLookupCalls, 2);
    assert.equal(calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 0);
  });
}

for (const scenario of [
  {
    name: "a timed-out promotion response",
    result: {
      status: null,
      signal: "SIGTERM",
      error: Object.assign(new Error("Netlify promotion response timed out."), {
        code: "ETIMEDOUT",
      }),
    },
  },
  {
    name: "a malformed promotion response",
    result: { status: 0, stdout: "not-json" },
  },
]) {
  test(`${scenario.name} is reconciled when the exact draft is published`, async () => {
    const calls = [];
    let siteLookupCalls = 0;
    const result = await deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api" && args[1] === "getSite") {
          siteLookupCalls += 1;
          return {
            status: 0,
            stdout: JSON.stringify(
              sitePayload({
                published_deploy: {
                  id: siteLookupCalls < 3 ? PREVIOUS_DEPLOY_ID : DEPLOY_ID,
                },
              }),
            ),
          };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        if (args[0] === "deploy") {
          return { status: 0, stdout: JSON.stringify(draftPayload()) };
        }
        if (args[0] === "api" && args[1] === "restoreSiteDeploy") {
          return scenario.result;
        }
        throw new Error(`unexpected process call: ${command} ${args.join(" ")}`);
      },
      fetchImpl: smokeFetch([]),
      sealArtifactImpl: async () => SEALED_ARTIFACT,
      smokeAttempts: 1,
      smokeDelayMs: 0,
    });

    assert.equal(siteLookupCalls, 3);
    assert.equal(calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 1);
    assert.equal(result.deployId, DEPLOY_ID);
    assert.equal(result.previousDeployId, PREVIOUS_DEPLOY_ID);
    assert.equal(result.promotionAttestation, "reconciled");
  });
}

test("an ambiguous promotion result fails when the exact draft is not published", async () => {
  const calls = [];
  let siteLookupCalls = 0;
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api" && args[1] === "getSite") {
          siteLookupCalls += 1;
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        if (args[0] === "deploy") {
          return { status: 0, stdout: JSON.stringify(draftPayload()) };
        }
        if (args[0] === "api" && args[1] === "restoreSiteDeploy") {
          return {
            status: null,
            signal: "SIGTERM",
            error: Object.assign(new Error("Netlify promotion response timed out."), {
              code: "ETIMEDOUT",
            }),
          };
        }
        throw new Error(`unexpected process call: ${command} ${args.join(" ")}`);
      },
      fetchImpl: smokeFetch([]),
      sealArtifactImpl: async () => SEALED_ARTIFACT,
      smokeAttempts: 1,
      smokeDelayMs: 0,
    }),
    (error) =>
      error.message.includes("could not be reconciled") &&
      error.message.includes(DEPLOY_ID) &&
      error.message.includes(PREVIOUS_DEPLOY_ID),
  );
  assert.equal(siteLookupCalls, 3);
  assert.equal(calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 1);
});

test("a stale published-deploy attestation fails before canonical smoke", async () => {
  const calls = [];
  const requests = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        if (command === "git") return cleanGitAttestation(args);
        if (args[0] === "api" && args[1] === "getSite") {
          return { status: 0, stdout: JSON.stringify(sitePayload()) };
        }
        if (args[0] === "build") return { status: 0, stdout: "" };
        if (args[0] === "deploy") {
          return { status: 0, stdout: JSON.stringify(draftPayload()) };
        }
        if (args[0] === "api" && args[1] === "restoreSiteDeploy") {
          return { status: 0, stdout: JSON.stringify(promotionPayload()) };
        }
        throw new Error(`unexpected process call: ${command} ${args.join(" ")}`);
      },
      fetchImpl: smokeFetch(requests),
      sealArtifactImpl: async () => SEALED_ARTIFACT,
      smokeAttempts: 1,
      smokeDelayMs: 0,
    }),
    /does not identify the promoted deploy/i,
  );
  assert.equal(calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 1);
  assert.equal(
    requests.some(({ url }) => url.startsWith(SAFE_INPUT.baseUrl)),
    false,
  );
});

test("a canonical smoke failure restores and attests the exact prior deploy once", async () => {
  const privateFailure = new Error(
    `private smoke detail ${SAFE_INPUT.authToken} ${SAFE_INPUT.supabaseAnonKey}`,
  );
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [PREVIOUS_DEPLOY_ID, PREVIOUS_DEPLOY_ID, DEPLOY_ID, DEPLOY_ID, PREVIOUS_DEPLOY_ID],
    canonicalFailure: privateFailure,
  });

  await assert.rejects(scenario.promise, (error) => {
    assert.match(error.message, /Canonical production smoke failed/i);
    assert.match(error.message, new RegExp(`Candidate deploy: ${DEPLOY_ID}`));
    assert.match(error.message, new RegExp(`Prior deploy: ${PREVIOUS_DEPLOY_ID}`));
    assert.match(error.message, new RegExp(`Current deploy: ${PREVIOUS_DEPLOY_ID}`));
    assert.match(error.message, /Rollback outcome: restored_prior_attested/);
    assert.equal(error.message.includes(SAFE_INPUT.authToken), false);
    assert.equal(error.message.includes(SAFE_INPUT.supabaseAnonKey), false);
    assert.equal(error.message.includes(privateFailure.message), false);
    return true;
  });

  const restorations = scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy");
  assert.equal(restorations.length, 2);
  assert.deepEqual(
    restorations.map(({ args }) => JSON.parse(args[3]).deploy_id),
    [DEPLOY_ID, PREVIOUS_DEPLOY_ID],
  );
  assert.equal(restorations[1].options.shell, false);
  assert.equal(restorations[1].options.timeout, 60_000);
  assert.equal(restorations[1].args.includes(SAFE_INPUT.authToken), false);
  assert.equal(scenario.siteLookupCalls, 5);
  assert.equal(scenario.calls.filter(({ args }) => args[0] === "build").length, 1);
  assert.equal(scenario.calls.filter(({ args }) => args[0] === "deploy").length, 1);
});

test("an ambiguous rollback acknowledgement is reconciled when the exact prior deploy is published", async () => {
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [PREVIOUS_DEPLOY_ID, PREVIOUS_DEPLOY_ID, DEPLOY_ID, DEPLOY_ID, PREVIOUS_DEPLOY_ID],
    rollbackResult: {
      status: null,
      signal: "SIGTERM",
      error: Object.assign(new Error("Netlify rollback response timed out."), {
        code: "ETIMEDOUT",
      }),
    },
  });

  await assert.rejects(
    scenario.promise,
    (error) =>
      error.message.includes(`Candidate deploy: ${DEPLOY_ID}`) &&
      error.message.includes(`Prior deploy: ${PREVIOUS_DEPLOY_ID}`) &&
      error.message.includes(`Current deploy: ${PREVIOUS_DEPLOY_ID}`) &&
      error.message.includes("Rollback outcome: restored_prior_after_ambiguous_ack"),
  );
  assert.equal(scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 2);
  assert.equal(scenario.siteLookupCalls, 5);
});

test("a failed rollback reports that the candidate remains published without retrying", async () => {
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [PREVIOUS_DEPLOY_ID, PREVIOUS_DEPLOY_ID, DEPLOY_ID, DEPLOY_ID, DEPLOY_ID],
    rollbackResult: {
      status: 1,
      stderr: `private failure ${SAFE_INPUT.authToken}`,
    },
  });

  await assert.rejects(scenario.promise, (error) => {
    assert.match(error.message, new RegExp(`Candidate deploy: ${DEPLOY_ID}`));
    assert.match(error.message, new RegExp(`Prior deploy: ${PREVIOUS_DEPLOY_ID}`));
    assert.match(error.message, new RegExp(`Current deploy: ${DEPLOY_ID}`));
    assert.match(error.message, /Rollback outcome: rollback_failed_candidate_still_published/);
    assert.equal(error.message.includes(SAFE_INPUT.authToken), false);
    return true;
  });
  assert.equal(scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 2);
  assert.equal(scenario.siteLookupCalls, 5);
});

test("a third-party deploy after canonical smoke failure prevents rollback", async () => {
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [PREVIOUS_DEPLOY_ID, PREVIOUS_DEPLOY_ID, DEPLOY_ID, INTERVENING_DEPLOY_ID],
  });

  await assert.rejects(
    scenario.promise,
    (error) =>
      error.message.includes(`Candidate deploy: ${DEPLOY_ID}`) &&
      error.message.includes(`Prior deploy: ${PREVIOUS_DEPLOY_ID}`) &&
      error.message.includes(`Current deploy: ${INTERVENING_DEPLOY_ID}`) &&
      error.message.includes("Rollback outcome: rollback_skipped_site_moved"),
  );
  const restorations = scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy");
  assert.equal(restorations.length, 1);
  assert.equal(JSON.parse(restorations[0].args[3]).deploy_id, DEPLOY_ID);
  assert.equal(scenario.siteLookupCalls, 4);
});

test("unavailable post-smoke site metadata prevents rollback and reports unknown current state", async () => {
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [
      PREVIOUS_DEPLOY_ID,
      PREVIOUS_DEPLOY_ID,
      DEPLOY_ID,
      { status: 1, stderr: `private metadata failure ${SAFE_INPUT.authToken}` },
    ],
  });

  await assert.rejects(scenario.promise, (error) => {
    assert.match(error.message, new RegExp(`Candidate deploy: ${DEPLOY_ID}`));
    assert.match(error.message, new RegExp(`Prior deploy: ${PREVIOUS_DEPLOY_ID}`));
    assert.match(error.message, /Current deploy: unknown/);
    assert.match(error.message, /Rollback outcome: rollback_not_attempted_metadata_unavailable/);
    assert.equal(error.message.includes(SAFE_INPUT.authToken), false);
    return true;
  });
  assert.equal(scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 1);
  assert.equal(scenario.siteLookupCalls, 4);
});

test("a rollback acknowledgement is not success without exact-prior publication metadata", async () => {
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [
      PREVIOUS_DEPLOY_ID,
      PREVIOUS_DEPLOY_ID,
      DEPLOY_ID,
      DEPLOY_ID,
      { status: 1, stderr: `private rollback attestation failure ${SAFE_INPUT.authToken}` },
    ],
  });

  await assert.rejects(scenario.promise, (error) => {
    assert.match(error.message, new RegExp(`Candidate deploy: ${DEPLOY_ID}`));
    assert.match(error.message, new RegExp(`Prior deploy: ${PREVIOUS_DEPLOY_ID}`));
    assert.match(error.message, /Current deploy: unknown/);
    assert.match(error.message, /Rollback outcome: rollback_state_unknown_after_attempt/);
    assert.equal(error.message.includes(SAFE_INPUT.authToken), false);
    return true;
  });
  assert.equal(scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 2);
  assert.equal(scenario.siteLookupCalls, 5);
});

test("an exact prior deploy already restored by another actor is attested without another rollback", async () => {
  const scenario = canonicalSmokeFailureScenario({
    siteLookups: [PREVIOUS_DEPLOY_ID, PREVIOUS_DEPLOY_ID, DEPLOY_ID, PREVIOUS_DEPLOY_ID],
  });

  await assert.rejects(
    scenario.promise,
    (error) =>
      error.message.includes(`Current deploy: ${PREVIOUS_DEPLOY_ID}`) &&
      error.message.includes("Rollback outcome: prior_already_published"),
  );
  assert.equal(scenario.calls.filter(({ args }) => args[1] === "restoreSiteDeploy").length, 1);
  assert.equal(scenario.siteLookupCalls, 4);
});

test("browser-origin smoke requires preflight success and an exact unauthenticated rejection", async () => {
  for (const protectedStatus of [403, 404, 429]) {
    await assert.rejects(
      smokeProductionWeb(SAFE_INPUT.baseUrl, {
        browserOrigin: SAFE_INPUT.baseUrl,
        expectedGitSha: SAFE_INPUT.gitSha,
        fetchImpl: smokeFetch([], { protectedStatus }),
        attempts: 1,
        delayMs: 0,
      }),
      /expected HTTP 401/i,
    );
  }

  await assert.rejects(
    smokeProductionWeb(SAFE_INPUT.baseUrl, {
      browserOrigin: SAFE_INPUT.baseUrl,
      expectedGitSha: SAFE_INPUT.gitSha,
      fetchImpl: async (url, options = {}) => {
        if (url.includes("/release-attestation")) {
          return Response.json({
            schemaVersion: 1,
            gitSha: SAFE_INPUT.gitSha,
          });
        }
        if (url.includes("/functions/v1/document-operation") && options.method === "OPTIONS") {
          return new Response("forbidden", { status: 403 });
        }
        return new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
      attempts: 1,
      delayMs: 0,
    }),
    /CORS preflight.*HTTP 403/i,
  );
});

test("browser-origin smoke requires exact CORS origin reflection and GET permission", async () => {
  for (const options of [
    { corsOrigin: "https://wrong.prompted.example" },
    { corsGetOrigin: "https://wrong.prompted.example" },
    { corsMethods: "POST, OPTIONS" },
  ]) {
    await assert.rejects(
      smokeProductionWeb(SAFE_INPUT.baseUrl, {
        browserOrigin: SAFE_INPUT.baseUrl,
        expectedGitSha: SAFE_INPUT.gitSha,
        fetchImpl: smokeFetch([], options),
        attempts: 1,
        delayMs: 0,
      }),
      /Access-Control-Allow-Origin|does not allow GET/i,
    );
  }
});

test("release smoke rejects a stale or missing build SHA attestation", async () => {
  await assert.rejects(
    smokeProductionWeb(SAFE_INPUT.baseUrl, {
      browserOrigin: SAFE_INPUT.baseUrl,
      expectedGitSha: SAFE_INPUT.gitSha,
      fetchImpl: smokeFetch([], { attestedSha: "0".repeat(40) }),
      attempts: 1,
      delayMs: 0,
    }),
    /release attestation.*commit/i,
  );
});
