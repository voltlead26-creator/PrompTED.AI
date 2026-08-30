#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const CONTRACT_PATH = "supabase/deployment-contract.json";
const FUNCTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

export function validateFunctionName(name) {
  if (typeof name !== "string" || !FUNCTION_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid function identifier "${String(name)}".`);
  }
  return name;
}

export function getActiveFunctionNames(manifest) {
  const names = Object.entries(manifest.functions ?? {})
    .filter(([, entry]) => entry?.status === "active")
    .map(([name]) => validateFunctionName(name));

  if (names.length === 0) {
    throw new Error("Deployment contract contains no active functions.");
  }
  return names;
}

function validateProjectRef(projectRef) {
  if (typeof projectRef !== "string" || !PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error(`Invalid Supabase project reference "${String(projectRef)}".`);
  }
  return projectRef;
}

export function buildSupabaseDeployArgs(functionNames, projectRef) {
  const validatedNames = functionNames.map(validateFunctionName);
  if (validatedNames.length === 0) {
    throw new Error("Refusing to deploy an empty function list.");
  }
  return [
    "functions",
    "deploy",
    ...validatedNames,
    "--use-api",
    "--project-ref",
    validateProjectRef(projectRef),
  ];
}

function spawnAndWait(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `Supabase CLI terminated by signal ${signal}.`
            : `Supabase CLI exited with status ${code}.`,
        ),
      );
    });
  });
}

export async function deployContractFunctions({
  manifest,
  requestedProjectRef,
  spawnImpl = spawnAndWait,
}) {
  const contractProjectRef = validateProjectRef(manifest.projectRef);
  const targetProjectRef = validateProjectRef(requestedProjectRef);
  if (targetProjectRef !== contractProjectRef) {
    throw new Error(
      `Requested project reference "${targetProjectRef}" does not match ` +
        `deployment-contract.json projectRef "${contractProjectRef}".`,
    );
  }

  const functionNames = getActiveFunctionNames(manifest);
  const args = buildSupabaseDeployArgs(functionNames, targetProjectRef);
  await spawnImpl("supabase", args, { stdio: "inherit", shell: false });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--project-ref") {
    throw new Error("Usage: deploy-contract-functions.mjs --project-ref <project-ref>");
  }

  const manifest = JSON.parse(await readFile(CONTRACT_PATH, "utf8"));
  await deployContractFunctions({
    manifest,
    requestedProjectRef: args[1],
  });
}

const isMainModule = process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((error) => {
    console.error(`Function deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
