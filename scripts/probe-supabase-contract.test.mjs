import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchOpenApiDoc,
  requiredProbeEnvironmentVariables,
  validateLiveSchema,
  validateProbeTarget,
  validateSupabaseUrl,
} from "./probe-supabase-contract.mjs";

const PROJECT_REF = "jjsykocqpjlekgsbylkd";

test("validateSupabaseUrl accepts only the exact canonical HTTPS project origin", () => {
  const target = validateSupabaseUrl(
    `https://${PROJECT_REF}.supabase.co`,
    PROJECT_REF,
  );

  assert.equal(target.origin, `https://${PROJECT_REF}.supabase.co`);
  assert.equal(target.pathname, "/");
});

test("validateSupabaseUrl rejects credential-exfiltration and ambiguous targets", () => {
  const invalidTargets = [
    `http://${PROJECT_REF}.supabase.co`,
    `https://user:password@${PROJECT_REF}.supabase.co`,
    `https://${PROJECT_REF}.supabase.co:8443`,
    `https://${PROJECT_REF}.supabase.co/rest/v1`,
    `https://${PROJECT_REF}.supabase.co?next=https://attacker.example`,
    `https://${PROJECT_REF}.supabase.co#attacker`,
    `https://${PROJECT_REF}.supabase.co.attacker.example`,
    `https://attacker.example/${PROJECT_REF}.supabase.co`,
    `https://wrongproject.supabase.co`,
    "not a URL",
  ];

  for (const target of invalidTargets) {
    assert.throws(
      () => validateSupabaseUrl(target, PROJECT_REF),
      /Supabase URL|project/i,
      target,
    );
  }
});

test("validateProbeTarget requires one exact project identity", () => {
  assert.equal(
    validateProbeTarget({
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      manifestProjectRef: PROJECT_REF,
      environmentProjectRef: PROJECT_REF,
    }).origin,
    `https://${PROJECT_REF}.supabase.co`,
  );

  assert.throws(
    () =>
      validateProbeTarget({
        supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
        manifestProjectRef: PROJECT_REF,
        environmentProjectRef: "anotherprojectref",
      }),
    /SUPABASE_PROJECT_REF.*does not match/i,
  );
});

test("target mode requires a URL but not a project override or service-role credential", () => {
  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "target",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      projectRef: PROJECT_REF,
      serviceRoleKey: undefined,
    }),
    [],
  );

  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "target",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      projectRef: undefined,
      serviceRoleKey: "must-not-be-needed",
    }),
    [],
  );

  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "schema",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      projectRef: PROJECT_REF,
      serviceRoleKey: undefined,
    }),
    ["SUPABASE_SERVICE_ROLE_KEY"],
  );
});

test("fetchOpenApiDoc validates the target before sending a service-role credential", async () => {
  let fetchCalls = 0;
  const fetchImpl = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("fetch must not run"));
  };

  await assert.rejects(
    fetchOpenApiDoc(
      `https://${PROJECT_REF}.supabase.co.attacker.example`,
      "service-role-secret",
      { expectedProjectRef: PROJECT_REF, fetchImpl },
    ),
    /Supabase URL/i,
  );
  assert.equal(fetchCalls, 0);
});

test("fetchOpenApiDoc sends credentials only to the validated metadata endpoint", async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ paths: {} }),
    });
  };

  await fetchOpenApiDoc(
    `https://${PROJECT_REF}.supabase.co`,
    "service-role-secret",
    { expectedProjectRef: PROJECT_REF, fetchImpl },
  );

  assert.deepEqual(calls, [
    {
      url: `https://${PROJECT_REF}.supabase.co/rest/v1/`,
      options: {
        headers: {
          apikey: "service-role-secret",
          Authorization: "Bearer service-role-secret",
        },
      },
    },
  ]);
});

test("live schema validation includes direct browser RPC and migration requirements", () => {
  const manifest = {
    functions: {},
    webRequirements: {
      requiredMigrations: ["20260831110000_atomic_guest_workspace_import"],
      requiredRpcs: ["commit_guest_workspace_import"],
      requiredTables: ["documents"],
    },
  };
  const missing = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    openApiTables: new Set(),
    openApiRpcs: new Set(),
  });
  assert.equal(missing.failures.length, 3);
  assert(missing.checks.every((check) => check.function === "web"));

  const complete = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(["20260831110000"]),
    openApiTables: new Set(["documents"]),
    openApiRpcs: new Set(["commit_guest_workspace_import"]),
  });
  assert.deepEqual(complete.failures, []);
  assert(complete.checks.every((check) => check.ok));
});
