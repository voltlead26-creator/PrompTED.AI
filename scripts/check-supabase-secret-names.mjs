#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const PLATFORM_MANAGED = new Set([
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export function requiredSecretNames(manifest) {
  const names = new Set(
    (manifest.sharedSecrets ?? []).filter((name) => !PLATFORM_MANAGED.has(name)),
  );
  for (const entry of Object.values(manifest.functions ?? {})) {
    if (entry.status !== "active") continue;
    for (const name of entry.requiredSecrets ?? []) names.add(name);
  }
  return [...names].sort();
}

export function parseSecretNames(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Supabase secret metadata was not valid JSON.");
  }
  const entries = Array.isArray(parsed) ? parsed : parsed?.secrets;
  if (!Array.isArray(entries)) {
    throw new Error("Supabase secret metadata did not contain a secret list.");
  }
  return new Set(
    entries
      .map((entry) => entry?.name)
      .filter((name) => typeof name === "string" && /^[A-Z][A-Z0-9_]*$/.test(name)),
  );
}

export function missingSecretNames(manifest, availableNames) {
  return requiredSecretNames(manifest).filter((name) => !availableNames.has(name));
}

export async function checkSupabaseSecretNames({
  repoRoot = process.cwd(),
  projectRef,
  accessToken,
  execFileImpl = execFileAsync,
} = {}) {
  if (!PROJECT_REF_PATTERN.test(projectRef ?? "")) {
    throw new Error("SUPABASE_PROJECT_REF must be an exact 20-character project reference.");
  }
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("SUPABASE_ACCESS_TOKEN is required.");
  }
  const manifest = JSON.parse(
    await readFile(`${repoRoot}/supabase/deployment-contract.json`, "utf8"),
  );
  if (manifest.projectRef !== projectRef) {
    throw new Error("SUPABASE_PROJECT_REF does not match deployment-contract.json.");
  }

  const { stdout } = await execFileImpl(
    "supabase",
    ["secrets", "list", "--project-ref", projectRef, "--output", "json"],
    {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
      maxBuffer: 1024 * 1024,
    },
  );
  const available = parseSecretNames(stdout);
  const missing = missingSecretNames(manifest, available);
  if (missing.length > 0) {
    throw new Error(`Required Supabase secret names are missing: ${missing.join(", ")}.`);
  }
  return { required: requiredSecretNames(manifest) };
}

async function main() {
  const result = await checkSupabaseSecretNames({
    projectRef: process.env.SUPABASE_PROJECT_REF,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  });
  console.log(
    `Supabase secret-name gate passed (${result.required.length} required names; values were not read).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
