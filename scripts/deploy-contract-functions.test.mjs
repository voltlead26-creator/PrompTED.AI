import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupabaseDeployArgs,
  deployContractFunctions,
  getActiveFunctionNames,
  validateFunctionName,
} from "./deploy-contract-functions.mjs";

const PROJECT_REF = "jjsykocqpjlekgsbylkd";

test("function names use strict lower-kebab-case without shell metacharacters", () => {
  for (const name of ["clarify", "generate-document", "webhooks-revenuecat"]) {
    assert.equal(validateFunctionName(name), name);
  }

  for (const name of [
    "Clarify",
    "1clarify",
    "generate_document",
    "generate document",
    "clarify;echo-injected",
    "clarify$(whoami)",
    "--debug",
    "../clarify",
  ]) {
    assert.throws(() => validateFunctionName(name), /invalid function identifier/i, name);
  }
});

test("active function names are validated before deployment", () => {
  assert.deepEqual(
    getActiveFunctionNames({
      functions: {
        clarify: { status: "active" },
        "generate-document": { status: "active" },
        "openai-responses": { status: "dormant" },
        retired: { status: "retired" },
      },
    }),
    ["clarify", "generate-document"],
  );

  assert.throws(
    () =>
      getActiveFunctionNames({
        functions: {
          "clarify; echo injected": { status: "active" },
        },
      }),
    /invalid function identifier/i,
  );
});

test("buildSupabaseDeployArgs keeps every derived value in a separate argument", () => {
  assert.deepEqual(
    buildSupabaseDeployArgs(["clarify", "generate-document"], PROJECT_REF),
    [
      "functions",
      "deploy",
      "clarify",
      "generate-document",
      "--use-api",
      "--project-ref",
      PROJECT_REF,
    ],
  );
});

test("deployContractFunctions disables shell evaluation", async () => {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return Promise.resolve();
  };

  await deployContractFunctions({
    manifest: {
      projectRef: PROJECT_REF,
      functions: {
        clarify: { status: "active" },
        "generate-document": { status: "active" },
      },
    },
    requestedProjectRef: PROJECT_REF,
    spawnImpl,
  });

  assert.deepEqual(calls, [
    {
      command: "supabase",
      args: [
        "functions",
        "deploy",
        "clarify",
        "generate-document",
        "--use-api",
        "--project-ref",
        PROJECT_REF,
      ],
      options: { stdio: "inherit", shell: false },
    },
  ]);
});

test("deployContractFunctions rejects hostile contract data before starting Supabase CLI", async () => {
  let spawnCalls = 0;
  await assert.rejects(
    deployContractFunctions({
      manifest: {
        projectRef: PROJECT_REF,
        functions: {
          "clarify; echo injected": { status: "active" },
        },
      },
      requestedProjectRef: PROJECT_REF,
      spawnImpl: () => {
        spawnCalls += 1;
        return Promise.resolve();
      },
    }),
    /invalid function identifier/i,
  );
  assert.equal(spawnCalls, 0);
});
