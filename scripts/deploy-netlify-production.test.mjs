import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildNetlifyDeployArgs,
  buildNetlifyDraftDeployArgs,
  deployNetlifyProduction,
  parseDraftDeployUrl,
  smokeProductionWeb,
  validateProductionDeployInput,
} from "./deploy-netlify-production.mjs";

const SAFE_INPUT = {
  siteId: "f278cbcf-0161-43f7-a132-fd224aef2d9f",
  gitSha: "5574dee72e02f44507b22bd3c761dfc9d3c3bd51",
  baseUrl: "https://app.prompted.example",
  expectedBaseUrl: "https://app.prompted.example",
  gitRef: "refs/heads/main",
  authToken: "test-token",
  appEnvironment: "production",
  supabaseUrl: "https://jjsykocqpjlekgsbylkd.supabase.co",
  supabaseAnonKey: "public-anon-value",
};

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

test("Netlify arguments keep every derived value in a separate argument", () => {
  assert.deepEqual(buildNetlifyDeployArgs(SAFE_INPUT), [
    "deploy",
    "--site",
    SAFE_INPUT.siteId,
    "--filter",
    "@prompted/web",
    "--build",
    "--prod",
    "--message",
    `Production deploy — ${SAFE_INPUT.gitSha}`,
  ]);
  assert.deepEqual(buildNetlifyDraftDeployArgs(SAFE_INPUT), [
    "deploy",
    "--site",
    SAFE_INPUT.siteId,
    "--filter",
    "@prompted/web",
    "--build",
    "--json",
    "--message",
    `Production candidate — ${SAFE_INPUT.gitSha}`,
  ]);
});

test("draft output accepts only a canonical Netlify HTTPS preview origin", () => {
  assert.equal(
    parseDraftDeployUrl(JSON.stringify({ deploy_url: "https://candidate--prompted.netlify.app" })),
    "https://candidate--prompted.netlify.app",
  );
  for (const deploy_url of [
    "http://candidate--prompted.netlify.app",
    "https://candidate--prompted.netlify.app.attacker.example",
    "https://user:pass@candidate--prompted.netlify.app",
    "https://candidate--prompted.netlify.app/path",
  ]) {
    assert.throws(() => parseDraftDeployUrl(JSON.stringify({ deploy_url })));
  }
  assert.throws(() => parseDraftDeployUrl("not-json"));
});

test("hostile input fails before Netlify starts", async () => {
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

test("production deploy disables shell evaluation and smokes required public routes", async () => {
  const calls = [];
  const requests = [];
  await deployNetlifyProduction(SAFE_INPUT, {
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return args.includes("--prod")
        ? { status: 0 }
        : {
            status: 0,
            stdout: JSON.stringify({
              deploy_url: "https://candidate--prompted.netlify.app",
            }),
          };
    },
    fetchImpl: (url) => {
      requests.push(url);
      if (url.includes("/api/document-operation")) {
        return new Response("authentication required", { status: 401 });
      }
      return new Response("<!doctype html><html><body>PrompTED</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    smokeAttempts: 1,
    smokeDelayMs: 0,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "netlify");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].args.includes(SAFE_INPUT.authToken), false);
  assert.equal(calls[0].args.includes("--prod"), false);
  assert.equal(calls[1].args.includes("--prod"), true);
  assert.deepEqual(requests, [
    "https://candidate--prompted.netlify.app/",
    "https://candidate--prompted.netlify.app/sign-in",
    "https://candidate--prompted.netlify.app/privacy",
    "https://candidate--prompted.netlify.app/api/document-operation?operation_id=00000000-0000-4000-8000-000000000000",
    `${SAFE_INPUT.baseUrl}/`,
    `${SAFE_INPUT.baseUrl}/sign-in`,
    `${SAFE_INPUT.baseUrl}/privacy`,
    `${SAFE_INPUT.baseUrl}/api/document-operation?operation_id=00000000-0000-4000-8000-000000000000`,
  ]);
});

test("a failed draft smoke never starts a production deploy", async () => {
  const calls = [];
  await assert.rejects(
    deployNetlifyProduction(SAFE_INPUT, {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout: JSON.stringify({
            deploy_url: "https://candidate--prompted.netlify.app",
          }),
        };
      },
      fetchImpl: () => new Response("broken", { status: 503 }),
      smokeAttempts: 1,
      smokeDelayMs: 0,
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes("--prod"), false);
});

test("public smoke verification rejects empty and failing responses", async () => {
  await assert.rejects(
    smokeProductionWeb(SAFE_INPUT.baseUrl, {
      fetchImpl: () => new Response("", { status: 503 }),
      attempts: 1,
      delayMs: 0,
    }),
  );
});
