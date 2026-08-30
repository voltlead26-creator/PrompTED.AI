#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MANIFEST_REPOSITORY_PATH = "docs/audits/immutable-source-import.json";

const DECISIONS = new Set([
  "retain_exact",
  "retain_historical_exact",
  "defer_exact",
  "rewrite_target",
  "exclude",
  "pending",
]);
const EXACT_DECISIONS = new Set([
  "retain_exact",
  "retain_historical_exact",
  "defer_exact",
]);
const HASH_PATTERN = /^[0-9a-f]{40}$/;
const MODE_PATTERN = /^(100644|100755|120000)$/;

function isSafeRepositoryPath(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    !path.isAbsolute(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

function count(counts, decision) {
  counts[decision] = (counts[decision] ?? 0) + 1;
}

export function validateImmutableSourceImport(
  manifest,
  targetEntries,
  targetNativeEntries = new Map(),
  immutableSourceEntries,
) {
  const failures = [];
  const counts = {};

  if (!manifest || typeof manifest !== "object") {
    return { failures: ["Manifest must be an object."], counts };
  }
  if (manifest.schemaVersion !== 1) {
    failures.push(`Unsupported schemaVersion ${String(manifest.schemaVersion)}.`);
  }
  if (!manifest.source || !HASH_PATTERN.test(String(manifest.source.commit ?? ""))) {
    failures.push("Source commit must be a full 40-character Git object ID.");
  }
  if (!manifest.source || typeof manifest.source.remote !== "string") {
    failures.push("Source remote is required.");
  }
  if (!manifest.target || typeof manifest.target.remote !== "string") {
    failures.push("Target remote is required.");
  }
  if (!Array.isArray(manifest.targetNative)) {
    failures.push("Manifest targetNative must be an array.");
  }
  if (!manifest.rules || typeof manifest.rules !== "object" || Array.isArray(manifest.rules)) {
    failures.push("Manifest rules must be an object.");
  }
  if (!Array.isArray(manifest.entries)) {
    failures.push("Manifest entries must be an array.");
    return { failures, counts };
  }
  if (manifest.source?.entryCount !== manifest.entries.length) {
    failures.push(
      `Source entryCount ${String(manifest.source?.entryCount)} does not match ${manifest.entries.length} entries.`,
    );
  }

  const seen = new Set();
  let previousPath = "";
  for (const [index, entry] of manifest.entries.entries()) {
    const label = typeof entry?.path === "string" ? entry.path : `entries[${index}]`;
    if (!entry || typeof entry !== "object") {
      failures.push(`entries[${index}] must be an object.`);
      continue;
    }
    if (!isSafeRepositoryPath(entry.path)) {
      failures.push(`${label}: invalid repository-relative path.`);
    }
    if (seen.has(entry.path)) failures.push(`${label}: duplicate path.`);
    seen.add(entry.path);
    if (previousPath && entry.path.localeCompare(previousPath) < 0) {
      failures.push(`${label}: entries must be sorted by path.`);
    }
    previousPath = entry.path;

    if (!MODE_PATTERN.test(String(entry.mode ?? ""))) {
      failures.push(`${label}: invalid source mode ${String(entry.mode)}.`);
    }
    if (!HASH_PATTERN.test(String(entry.sourceBlob ?? ""))) {
      failures.push(`${label}: invalid source blob.`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      failures.push(`${label}: bytes must be a non-negative integer.`);
    }
    if (typeof entry.rule !== "string" || !(entry.rule in (manifest.rules ?? {}))) {
      failures.push(`${label}: unknown rule ${String(entry.rule)}.`);
    }
    if (!DECISIONS.has(entry.decision)) {
      failures.push(`${label}: unknown decision ${String(entry.decision)}.`);
      continue;
    }
    count(counts, entry.decision);

    const actual = targetEntries.get(entry.path);
    if (entry.decision === "pending") {
      failures.push(`${label}: pending decision is not accepted.`);
      continue;
    }
    if (entry.decision === "exclude") {
      if (actual) failures.push(`${label}: excluded source file must be absent.`);
      continue;
    }
    if (!actual) {
      failures.push(`${label}: accepted source file is missing from target.`);
      continue;
    }

    const expectedMode = entry.targetMode ?? entry.mode;
    if (actual.mode !== expectedMode) {
      failures.push(`${label}: target mode ${actual.mode} does not match ${expectedMode}.`);
    }
    if (EXACT_DECISIONS.has(entry.decision)) {
      if (actual.blob !== entry.sourceBlob) {
        failures.push(`${label}: ${entry.decision} must match source blob ${entry.sourceBlob}.`);
      }
      continue;
    }
    if (!HASH_PATTERN.test(String(entry.targetBlob ?? ""))) {
      failures.push(`${label}: rewrite_target requires a recorded target blob.`);
      continue;
    }
    if (entry.targetBlob === entry.sourceBlob) {
      failures.push(`${label}: rewrite_target must differ from source blob.`);
    }
    if (actual.blob !== entry.targetBlob) {
      failures.push(`${label}: target does not match recorded target blob ${entry.targetBlob}.`);
    }
  }

  if (immutableSourceEntries instanceof Map) {
    for (const entry of manifest.entries) {
      if (!entry || typeof entry !== "object" || typeof entry.path !== "string") {
        continue;
      }
      const immutable = immutableSourceEntries.get(entry.path);
      if (!immutable) {
        failures.push(`${entry.path}: missing from immutable source commit.`);
        continue;
      }
      if (immutable.mode !== entry.mode) {
        failures.push(
          `${entry.path}: source mode ${entry.mode} does not match immutable commit ${immutable.mode}.`,
        );
      }
      if (immutable.blob !== entry.sourceBlob) {
        failures.push(
          `${entry.path}: source blob does not match immutable commit ${immutable.blob}.`,
        );
      }
      if (immutable.bytes !== entry.bytes) {
        failures.push(
          `${entry.path}: source byte size ${entry.bytes} does not match immutable commit ${immutable.bytes}.`,
        );
      }
    }
    for (const repositoryPath of immutableSourceEntries.keys()) {
      if (!seen.has(repositoryPath)) {
        failures.push(`${repositoryPath}: unrecorded immutable source file.`);
      }
    }
  }

  const targetNative = Array.isArray(manifest.targetNative)
    ? manifest.targetNative
    : [];
  if (manifest.target?.entryCount !== targetNative.length) {
    failures.push(
      `Target entryCount ${String(manifest.target?.entryCount)} does not match ${targetNative.length} target-native entries.`,
    );
  }

  const seenTargetNative = new Set();
  previousPath = "";
  for (const [index, entry] of targetNative.entries()) {
    const label = typeof entry?.path === "string"
      ? entry.path
      : `targetNative[${index}]`;
    if (!entry || typeof entry !== "object") {
      failures.push(`targetNative[${index}] must be an object.`);
      continue;
    }
    if (!isSafeRepositoryPath(entry.path)) {
      failures.push(`${label}: invalid repository-relative path.`);
    }
    if (seenTargetNative.has(entry.path)) {
      failures.push(`${label}: duplicate target-native path.`);
    }
    seenTargetNative.add(entry.path);
    if (previousPath && entry.path.localeCompare(previousPath) < 0) {
      failures.push(`${label}: target-native entries must be sorted by path.`);
    }
    previousPath = entry.path;

    if (seen.has(entry.path)) {
      failures.push(`${label}: target-native path also appears in source entries.`);
    }
    if (entry.path === MANIFEST_REPOSITORY_PATH) {
      failures.push(`${label}: the manifest cannot hash itself.`);
    }
    if (!MODE_PATTERN.test(String(entry.mode ?? ""))) {
      failures.push(`${label}: invalid target-native mode ${String(entry.mode)}.`);
    }
    if (!HASH_PATTERN.test(String(entry.targetBlob ?? ""))) {
      failures.push(`${label}: invalid target-native blob.`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      failures.push(`${label}: target-native bytes must be a non-negative integer.`);
    }
    if (typeof entry.rule !== "string" || !(entry.rule in (manifest.rules ?? {}))) {
      failures.push(`${label}: unknown rule ${String(entry.rule)}.`);
    }

    const actual = targetNativeEntries.get(entry.path);
    if (!actual) {
      failures.push(`${label}: target-native file is missing from target.`);
      continue;
    }
    if (actual.mode !== entry.mode) {
      failures.push(
        `${label}: target-native mode ${actual.mode} does not match ${entry.mode}.`,
      );
    }
    if (actual.blob !== entry.targetBlob) {
      failures.push(
        `${label}: target-native blob does not match ${entry.targetBlob}.`,
      );
    }
    if (actual.bytes !== entry.bytes) {
      failures.push(
        `${label}: target-native byte size ${actual.bytes} does not match ${entry.bytes}.`,
      );
    }
  }

  for (const repositoryPath of targetNativeEntries.keys()) {
    if (!seenTargetNative.has(repositoryPath)) {
      failures.push(`${repositoryPath}: unrecorded target-native file.`);
    }
  }

  return { failures, counts, targetNativeCount: targetNative.length };
}

function gitBlobOid(buffer) {
  return createHash("sha1")
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest("hex");
}

async function readTargetEntry(repositoryRoot, repositoryPath) {
  if (!isSafeRepositoryPath(repositoryPath)) {
    throw new Error(`${String(repositoryPath)}: invalid repository-relative path.`);
  }
  const absolutePath = path.join(repositoryRoot, ...repositoryPath.split("/"));
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      const value = Buffer.from(await readlink(absolutePath));
      return { mode: "120000", blob: gitBlobOid(value), bytes: value.length };
    }
    if (!stats.isFile()) return undefined;
    const value = await readFile(absolutePath);
    return {
      mode: (stats.mode & 0o111) === 0 ? "100644" : "100755",
      blob: gitBlobOid(value),
      bytes: value.length,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listVersionableRepositoryPaths(repositoryRoot) {
  const { stdout } = await execFileAsync(
    "git",
    [
      "-C",
      repositoryRoot,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.toString().split("\0").filter(Boolean).sort((left, right) =>
    left.localeCompare(right)
  );
}

export async function readImmutableSourceEntries(repositoryRoot, commit) {
  const { stdout: objectType } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "cat-file", "-t", commit],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (objectType.trim() !== "commit") {
    throw new Error(`${commit} is not a commit object in ${repositoryRoot}.`);
  }

  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "ls-tree", "-rz", "-l", commit],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  const entries = new Map();
  for (const record of stdout.toString().split("\0").filter(Boolean)) {
    const tabIndex = record.indexOf("\t");
    const [mode, type, blob, rawBytes] = record.slice(0, tabIndex).split(/ +/);
    const repositoryPath = record.slice(tabIndex + 1);
    const bytes = Number(rawBytes);
    if (
      tabIndex < 0 || type !== "blob" || !MODE_PATTERN.test(mode) ||
      !HASH_PATTERN.test(blob) || !Number.isSafeInteger(bytes) || bytes < 0
    ) {
      throw new Error(
        `Unsupported immutable source entry at ${repositoryPath || "<unknown>"}.`,
      );
    }
    entries.set(repositoryPath, { mode, blob, bytes });
  }
  return entries;
}

async function readOriginRemote(repositoryRoot) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "remote", "get-url", "origin"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

function readRequiredOption(optionName) {
  const index = process.argv.indexOf(optionName);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(
      `Usage: node scripts/immutable-source-import.mjs ${optionName} <repository-path>`,
    );
  }
  return value;
}

export async function readTargetEntries(repositoryRoot, paths) {
  const entries = new Map();
  for (const repositoryPath of paths) {
    const entry = await readTargetEntry(repositoryRoot, repositoryPath);
    if (entry) entries.set(repositoryPath, entry);
  }
  return entries;
}

async function main() {
  const repositoryRoot = process.cwd();
  const immutableSourceRoot = path.resolve(
    readRequiredOption("--source-repository"),
  );
  const manifestPath = path.join(
    repositoryRoot,
    MANIFEST_REPOSITORY_PATH,
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const targetEntries = await readTargetEntries(
    repositoryRoot,
    manifest.entries.map((entry) => entry.path),
  );
  const sourcePaths = new Set(manifest.entries.map((entry) => entry.path));
  const versionablePaths = await listVersionableRepositoryPaths(repositoryRoot);
  const targetNativePaths = versionablePaths.filter((repositoryPath) =>
    repositoryPath !== MANIFEST_REPOSITORY_PATH && !sourcePaths.has(repositoryPath)
  );
  const targetNativeEntries = await readTargetEntries(
    repositoryRoot,
    targetNativePaths,
  );
  const immutableSourceEntries = await readImmutableSourceEntries(
    immutableSourceRoot,
    manifest.source.commit,
  );
  const result = validateImmutableSourceImport(
    manifest,
    targetEntries,
    targetNativeEntries,
    immutableSourceEntries,
  );
  const [sourceRemote, targetRemote] = await Promise.all([
    readOriginRemote(immutableSourceRoot),
    readOriginRemote(repositoryRoot),
  ]);
  if (sourceRemote !== manifest.source.remote) {
    result.failures.push(
      `Source origin ${sourceRemote} does not match manifest ${manifest.source.remote}.`,
    );
  }
  if (targetRemote !== manifest.target.remote) {
    result.failures.push(
      `Target origin ${targetRemote} does not match manifest ${manifest.target.remote}.`,
    );
  }
  if (result.failures.length > 0) {
    console.error("Immutable source import validation failed:");
    for (const failure of result.failures) console.error(` - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Immutable source import passed (${manifest.entries.length} source files: ${JSON.stringify(result.counts)}; ${result.targetNativeCount} reviewed target-native files).`,
  );
}

const isMainModule = process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
