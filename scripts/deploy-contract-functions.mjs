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
  const entries = Object.entries(manifest.functions ?? {});
  const active = new Map(
    entries
      .filter(([, entry]) => entry?.status === "active")
      .map(([name, entry]) => [validateFunctionName(name), entry]),
  );

  if (active.size === 0) {
    throw new Error("Deployment contract contains no active functions.");
  }

  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Cyclic function dependency detected at "${name}".`);
    }
    const entry = active.get(name);
    if (!entry) {
      throw new Error(`Missing active function dependency "${name}".`);
    }
    const dependencies = entry.requiredFunctions ?? [];
    if (!Array.isArray(dependencies)) {
      throw new Error(`Function "${name}" has an invalid requiredFunctions contract.`);
    }
    visiting.add(name);
    const uniqueDependencies = new Set();
    for (const dependencyValue of dependencies) {
      const dependency = validateFunctionName(dependencyValue);
      if (uniqueDependencies.has(dependency)) {
        throw new Error(
          `Function "${name}" declares duplicate dependency "${dependency}".`,
        );
      }
      uniqueDependencies.add(dependency);
      if (!active.has(dependency)) {
        throw new Error(
          `Missing active function dependency "${dependency}" required by "${name}".`,
        );
      }
      visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  for (const name of active.keys()) visit(name);
  return ordered;
}

export function getActiveFunctionBatches(manifest) {
  const ordered = getActiveFunctionNames(manifest);
  const depths = new Map();
  const depthOf = (name) => {
    if (depths.has(name)) return depths.get(name);
    const dependencies = manifest.functions[name].requiredFunctions ?? [];
    const depth = dependencies.length === 0
      ? 0
      : Math.max(...dependencies.map((dependency) => depthOf(dependency))) + 1;
    depths.set(name, depth);
    return depth;
  };
  const batches = [];
  for (const name of ordered) {
    const depth = depthOf(name);
    (batches[depth] ??= []).push(name);
  }
  return batches.filter((batch) => batch.length > 0);
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

  const batches = getActiveFunctionBatches(manifest);
  for (const functionNames of batches) {
    const args = buildSupabaseDeployArgs(functionNames, targetProjectRef);
    await spawnImpl("supabase", args, { stdio: "inherit", shell: false });
  }
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
