#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  isConfidentialWebBuildVariableName,
  validateWebBuildEnvironment,
} from "./check-web-build-environment.mjs";

const WEB_BUILD_COMMAND = "pnpm";
const WEB_BUILD_ARGS = ["--filter", "@prompted/web", "build"];

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function sanitizeWebBuildEnvironment(environment = process.env, extraEnvironment = {}) {
  const sanitized = { ...environment, ...extraEnvironment };
  const stripped = [];

  for (const name of Object.keys(sanitized)) {
    if (isConfidentialWebBuildVariableName(name)) {
      delete sanitized[name];
      stripped.push(name);
    }
  }

  return {
    environment: sanitized,
    strippedNames: sortedUnique(stripped),
  };
}

export function assertSanitizedWebBuildEnvironment(environment) {
  const failures = validateWebBuildEnvironment({
    environment,
    dotEnvSources: [],
  });
  if (failures.length > 0) {
    throw new Error(
      "Netlify web build environment remained unsafe after sanitisation:\n- " +
        failures.join("\n- "),
    );
  }
}

export function buildPnpmWebBuildArgs() {
  return [...WEB_BUILD_ARGS];
}

export function runNetlifyWebBuild({
  environment = process.env,
  spawnImpl = spawnSync,
  cwd = process.cwd(),
} = {}) {
  const { environment: sanitizedEnvironment, strippedNames } = sanitizeWebBuildEnvironment(
    environment,
  );
  assertSanitizedWebBuildEnvironment(sanitizedEnvironment);

  if (strippedNames.length > 0) {
    console.log(
      `PrompTED Netlify web build removed ${strippedNames.length} confidential environment variable name(s) before Next.js build.`,
    );
  }

  const result = spawnImpl(WEB_BUILD_COMMAND, WEB_BUILD_ARGS, {
    cwd,
    env: sanitizedEnvironment,
    shell: false,
    stdio: "inherit",
  });

  if (result?.error) throw result.error;
  if (result?.signal) {
    throw new Error(`Netlify web build stopped with signal ${result.signal}.`);
  }
  return Number.isInteger(result?.status) ? result.status : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = runNetlifyWebBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Netlify web build failed.");
    process.exitCode = 1;
  }
}
