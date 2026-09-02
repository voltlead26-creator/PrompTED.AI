#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  readlink,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MANIFEST_REPOSITORY_PATH = "docs/audits/immutable-source-import.json";
const AUDIT_REPOSITORY_PATH = "docs/audits/IMMUTABLE_SOURCE_IMPORT.md";

const DECISIONS = new Set([
  "retain_exact",
  "retain_historical_exact",
  "defer_exact",
  "rewrite_target",
  "exclude",
  "pending",
]);
const EXACT_DECISIONS = new Set(["retain_exact", "retain_historical_exact", "defer_exact"]);
const HASH_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MODE_PATTERN = /^(100644|100755|120000)$/;
const REVIEWED_REWRITE_RULE = "reviewed_target_rewrite";
const REVIEWED_TARGET_NATIVE_RULE = "reviewed_target_native";

function isSafeRepositoryPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    !path.isAbsolute(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
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

  const targetNative = Array.isArray(manifest.targetNative) ? manifest.targetNative : [];
  if (manifest.target?.entryCount !== targetNative.length) {
    failures.push(
      `Target entryCount ${String(manifest.target?.entryCount)} does not match ${targetNative.length} target-native entries.`,
    );
  }

  const seenTargetNative = new Set();
  previousPath = "";
  for (const [index, entry] of targetNative.entries()) {
    const label = typeof entry?.path === "string" ? entry.path : `targetNative[${index}]`;
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
      failures.push(`${label}: target-native mode ${actual.mode} does not match ${entry.mode}.`);
    }
    if (actual.blob !== entry.targetBlob) {
      failures.push(`${label}: target-native blob does not match ${entry.targetBlob}.`);
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

export function validateImmutableAuditSummary(manifest, markdown) {
  const failures = [];
  const counts = {};
  for (const entry of manifest.entries ?? []) count(counts, entry.decision);
  for (const decision of [
    "retain_exact",
    "retain_historical_exact",
    "defer_exact",
    "rewrite_target",
    "exclude",
  ]) {
    const row = markdown.match(
      new RegExp(`\\|\\s*\`${decision}\`\\s*\\|\\s*(\\d+)\\s*\\|`),
    );
    const recorded = row ? Number(row[1]) : undefined;
    const expected = counts[decision] ?? 0;
    if (recorded !== expected) {
      failures.push(
        `${AUDIT_REPOSITORY_PATH}: ${decision} count ${String(recorded)} does not match ${expected}.`,
      );
    }
  }
  const totalRow = markdown.match(
    /\|\s*\*\*Total source paths\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/,
  );
  if (Number(totalRow?.[1]) !== (manifest.entries ?? []).length) {
    failures.push(
      `${AUDIT_REPOSITORY_PATH}: total source-path count does not match the manifest.`,
    );
  }
  const nativeRecord = markdown.match(
    /manifest also records (\d+) Git-versionable target-native files/,
  );
  if (Number(nativeRecord?.[1]) !== (manifest.targetNative ?? []).length) {
    failures.push(
      `${AUDIT_REPOSITORY_PATH}: target-native count does not match the manifest.`,
    );
  }
  if (
    manifest.target?.snapshotBaseHead &&
    !markdown.includes(manifest.target.snapshotBaseHead)
  ) {
    failures.push(
      `${AUDIT_REPOSITORY_PATH}: reviewed-overlay base HEAD does not match the manifest.`,
    );
  }
  return failures;
}

function gitBlobOid(buffer) {
  return createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
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
    ["-C", repositoryRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export async function listChangedRepositoryPaths(repositoryRoot) {
  const [{ stdout: tracked }, { stdout: untracked }] = await Promise.all([
    execFileAsync("git", ["-C", repositoryRoot, "diff", "--name-only", "-z", "HEAD"], {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    }),
    execFileAsync(
      "git",
      ["-C", repositoryRoot, "ls-files", "-z", "--others", "--exclude-standard"],
      { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    ),
  ]);
  return [
    ...new Set(`${tracked.toString()}${untracked.toString()}`.split("\0").filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
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
      tabIndex < 0 ||
      type !== "blob" ||
      !MODE_PATTERN.test(mode) ||
      !HASH_PATTERN.test(blob) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0
    ) {
      throw new Error(`Unsupported immutable source entry at ${repositoryPath || "<unknown>"}.`);
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

export function overlaySnapshotDigest(repositoryPaths, entries) {
  if (!Array.isArray(repositoryPaths) || !(entries instanceof Map)) {
    throw new Error("Overlay snapshot paths and entries are invalid.");
  }
  const normalizedPaths = [...repositoryPaths].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    new Set(normalizedPaths).size !== normalizedPaths.length ||
    normalizedPaths.some((repositoryPath) => !isSafeRepositoryPath(repositoryPath))
  ) {
    throw new Error("Overlay snapshot paths must be unique safe repository paths.");
  }
  const records = normalizedPaths.map((repositoryPath) => {
    const entry = entries.get(repositoryPath);
    return entry
      ? { path: repositoryPath, mode: entry.mode, blob: entry.blob, bytes: entry.bytes }
      : { path: repositoryPath, absent: true };
  });
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function requireReviewedOverlayPath(changedPaths, repositoryPath, reason, failures) {
  if (!changedPaths.has(repositoryPath)) {
    failures.push(
      `${repositoryPath}: ${reason} is outside the explicitly reviewed working-tree overlay.`,
    );
    return false;
  }
  return true;
}

export function refreshReviewedTargetManifest(
  manifest,
  targetEntries,
  targetNativeEntries,
  changedPaths,
) {
  if (!(changedPaths instanceof Set)) {
    throw new Error("Reviewed overlay paths must be supplied as a Set.");
  }
  if (!(targetEntries instanceof Map) || !(targetNativeEntries instanceof Map)) {
    throw new Error("Target source and target-native entries must be supplied as Maps.");
  }
  if (!manifest?.rules?.[REVIEWED_REWRITE_RULE]) {
    throw new Error(`Manifest rule ${REVIEWED_REWRITE_RULE} is required.`);
  }
  if (!manifest?.rules?.[REVIEWED_TARGET_NATIVE_RULE]) {
    throw new Error(`Manifest rule ${REVIEWED_TARGET_NATIVE_RULE} is required.`);
  }

  const refreshed = structuredClone(manifest);
  const failures = [];

  refreshed.entries = refreshed.entries.map((entry) => {
    const actual = targetEntries.get(entry.path);
    if (entry.decision === "exclude") {
      if (actual)
        failures.push(`${entry.path}: an excluded donor path cannot be restored by refresh.`);
      return entry;
    }
    if (!actual) {
      failures.push(`${entry.path}: refresh cannot remove an accepted donor path.`);
      return entry;
    }

    const sourceIsExact = actual.mode === entry.mode && actual.blob === entry.sourceBlob;
    if (EXACT_DECISIONS.has(entry.decision)) {
      if (sourceIsExact) return entry;
      if (entry.decision !== "retain_exact") {
        failures.push(
          `${entry.path}: ${entry.decision} drift requires a manual provenance decision.`,
        );
        return entry;
      }
      if (!requireReviewedOverlayPath(changedPaths, entry.path, "donor rewrite", failures))
        return entry;
      const rewritten = {
        ...entry,
        decision: "rewrite_target",
        rule: REVIEWED_REWRITE_RULE,
        targetBlob: actual.blob,
      };
      if (actual.mode === entry.mode) delete rewritten.targetMode;
      else rewritten.targetMode = actual.mode;
      return rewritten;
    }

    if (entry.decision === "rewrite_target") {
      if (sourceIsExact) {
        failures.push(
          `${entry.path}: a reviewed rewrite now matches the donor and requires manual reclassification.`,
        );
        return entry;
      }
      if (
        (entry.targetBlob !== actual.blob || (entry.targetMode ?? entry.mode) !== actual.mode) &&
        !requireReviewedOverlayPath(changedPaths, entry.path, "rewrite snapshot change", failures)
      )
        return entry;
      const rewritten = { ...entry, targetBlob: actual.blob };
      if (actual.mode === entry.mode) delete rewritten.targetMode;
      else rewritten.targetMode = actual.mode;
      return rewritten;
    }

    failures.push(`${entry.path}: decision ${String(entry.decision)} cannot be refreshed.`);
    return entry;
  });

  const previousTargetNative = new Map(
    (Array.isArray(refreshed.targetNative) ? refreshed.targetNative : []).map((entry) => [
      entry.path,
      entry,
    ]),
  );
  for (const repositoryPath of previousTargetNative.keys()) {
    if (!targetNativeEntries.has(repositoryPath)) {
      failures.push(
        `${repositoryPath}: target-native removal requires a manual provenance decision.`,
      );
    }
  }

  refreshed.targetNative = [...targetNativeEntries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repositoryPath, actual]) => {
      if (repositoryPath === MANIFEST_REPOSITORY_PATH) {
        failures.push(`${repositoryPath}: the manifest cannot hash itself.`);
      }
      const previous = previousTargetNative.get(repositoryPath);
      const changed =
        !previous ||
        previous.mode !== actual.mode ||
        previous.targetBlob !== actual.blob ||
        previous.bytes !== actual.bytes;
      if (changed) {
        requireReviewedOverlayPath(
          changedPaths,
          repositoryPath,
          previous ? "target-native snapshot change" : "new target-native file",
          failures,
        );
      }
      return {
        path: repositoryPath,
        mode: actual.mode,
        targetBlob: actual.blob,
        bytes: actual.bytes,
        rule: REVIEWED_TARGET_NATIVE_RULE,
      };
    });
  refreshed.target.entryCount = refreshed.targetNative.length;

  if (failures.length > 0) {
    throw new Error(
      `Reviewed target refresh refused:\n${failures.map((failure) => ` - ${failure}`).join("\n")}`,
    );
  }
  return refreshed;
}

function serializeManifest(manifest) {
  const header = JSON.stringify(
    {
      schemaVersion: manifest.schemaVersion,
      source: manifest.source,
      target: manifest.target,
      rules: manifest.rules,
    },
    null,
    2,
  );
  const records = (entries) =>
    entries
      .map(
        (entry, index) => `    ${JSON.stringify(entry)}${index === entries.length - 1 ? "" : ","}`,
      )
      .join("\n");
  return `${header.slice(0, -2)},\n  "targetNative": [\n${records(manifest.targetNative)}\n  ],\n  "entries": [\n${records(manifest.entries)}\n  ]\n}\n`;
}

async function readGitValue(repositoryRoot, args) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function readManifestAtRevision(repositoryRoot, revision) {
  const serialized = await readGitValue(repositoryRoot, [
    "show",
    `${revision}:${MANIFEST_REPOSITORY_PATH}`,
  ]);
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error(
      `${MANIFEST_REPOSITORY_PATH} at ${revision} is not valid JSON.`,
    );
  }
}

async function writeManifestAtomically(manifestPath, serialized) {
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, manifestPath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function main() {
  const repositoryRoot = process.cwd();
  const refreshReviewedOverlay = process.argv.includes("--refresh-reviewed-overlay");
  const printOverlaySnapshot = process.argv.includes("--print-overlay-snapshot");
  if (refreshReviewedOverlay && printOverlaySnapshot) {
    throw new Error("Choose either refresh or overlay snapshot inspection, not both.");
  }
  const manifestPath = path.join(repositoryRoot, MANIFEST_REPOSITORY_PATH);
  if (printOverlaySnapshot) {
    const expectedHead = readRequiredOption("--expected-head");
    if (!HASH_PATTERN.test(expectedHead)) {
      throw new Error("--expected-head must be one full 40-character Git object ID.");
    }
    const [currentHead, changedRepositoryPaths] = await Promise.all([
      readGitValue(repositoryRoot, ["rev-parse", "HEAD"]),
      listChangedRepositoryPaths(repositoryRoot),
    ]);
    if (currentHead !== expectedHead) {
      throw new Error(`Snapshot HEAD ${currentHead} does not match expected ${expectedHead}.`);
    }
    const changedEntries = await readTargetEntries(
      repositoryRoot,
      changedRepositoryPaths,
    );
    console.log(JSON.stringify({
      head: currentHead,
      pathCount: changedRepositoryPaths.length,
      overlaySha256: overlaySnapshotDigest(changedRepositoryPaths, changedEntries),
    }));
    return;
  }

  const immutableSourceRoot = path.resolve(readRequiredOption("--source-repository"));
  const workingManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let manifest = workingManifest;
  let expectedHead;
  let expectedChangeCount;
  let expectedOverlaySha256;
  let initialChangedRepositoryPaths;
  if (refreshReviewedOverlay) {
    expectedHead = readRequiredOption("--expected-head");
    expectedChangeCount = Number(readRequiredOption("--expected-change-count"));
    expectedOverlaySha256 = readRequiredOption("--expected-overlay-sha256");
    if (!HASH_PATTERN.test(expectedHead)) {
      throw new Error("--expected-head must be one full 40-character Git object ID.");
    }
    if (!Number.isSafeInteger(expectedChangeCount) || expectedChangeCount < 1) {
      throw new Error("--expected-change-count must be a positive integer.");
    }
    if (!SHA256_PATTERN.test(expectedOverlaySha256)) {
      throw new Error("--expected-overlay-sha256 must be one lowercase SHA-256 digest.");
    }
    const [currentHead, currentBranch, changedRepositoryPaths, baselineManifest] =
      await Promise.all([
        readGitValue(repositoryRoot, ["rev-parse", "HEAD"]),
        readGitValue(repositoryRoot, ["branch", "--show-current"]),
        listChangedRepositoryPaths(repositoryRoot),
        readManifestAtRevision(repositoryRoot, expectedHead),
      ]);
    if (currentHead !== expectedHead) {
      throw new Error(`Refresh HEAD ${currentHead} does not match expected ${expectedHead}.`);
    }
    if (currentBranch !== baselineManifest.target.branch) {
      throw new Error(
        `Refresh branch ${currentBranch || "<detached>"} does not match ${baselineManifest.target.branch}.`,
      );
    }
    if (changedRepositoryPaths.length !== expectedChangeCount) {
      throw new Error(
        `Refresh change count ${changedRepositoryPaths.length} does not match expected ${expectedChangeCount}.`,
      );
    }
    const changedEntries = await readTargetEntries(
      repositoryRoot,
      changedRepositoryPaths,
    );
    const actualOverlaySha256 = overlaySnapshotDigest(
      changedRepositoryPaths,
      changedEntries,
    );
    if (actualOverlaySha256 !== expectedOverlaySha256) {
      throw new Error(
        `Refresh overlay digest ${actualOverlaySha256} does not match expected ${expectedOverlaySha256}.`,
      );
    }
    const priorTargetNative = new Map([
      ...(baselineManifest.targetNative ?? []).map((entry) => [entry.path, entry]),
      ...(workingManifest.targetNative ?? []).map((entry) => [entry.path, entry]),
    ]);
    baselineManifest.targetNative = [...priorTargetNative.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    baselineManifest.target.entryCount = baselineManifest.targetNative.length;
    manifest = baselineManifest;
    initialChangedRepositoryPaths = changedRepositoryPaths;
  }

  const targetEntries = await readTargetEntries(
    repositoryRoot,
    manifest.entries.map((entry) => entry.path),
  );
  const sourcePaths = new Set(manifest.entries.map((entry) => entry.path));
  const versionablePaths = await listVersionableRepositoryPaths(repositoryRoot);
  const targetNativePaths = versionablePaths.filter(
    (repositoryPath) =>
      repositoryPath !== MANIFEST_REPOSITORY_PATH && !sourcePaths.has(repositoryPath),
  );
  const targetNativeEntries = await readTargetEntries(repositoryRoot, targetNativePaths);
  const immutableSourceEntries = await readImmutableSourceEntries(
    immutableSourceRoot,
    manifest.source.commit,
  );
  if (refreshReviewedOverlay) {
    manifest = refreshReviewedTargetManifest(
      manifest,
      targetEntries,
      targetNativeEntries,
      new Set(initialChangedRepositoryPaths),
    );
    manifest.target.snapshotBaseHead = expectedHead;
  }
  const result = validateImmutableSourceImport(
    manifest,
    targetEntries,
    targetNativeEntries,
    immutableSourceEntries,
  );
  const auditMarkdown = await readFile(
    path.join(repositoryRoot, AUDIT_REPOSITORY_PATH),
    "utf8",
  );
  result.failures.push(...validateImmutableAuditSummary(manifest, auditMarkdown));
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
  if (refreshReviewedOverlay) {
    const [finalHead, finalBranch, finalChangedRepositoryPaths] = await Promise.all([
      readGitValue(repositoryRoot, ["rev-parse", "HEAD"]),
      readGitValue(repositoryRoot, ["branch", "--show-current"]),
      listChangedRepositoryPaths(repositoryRoot),
    ]);
    const finalChangedEntries = await readTargetEntries(
      repositoryRoot,
      finalChangedRepositoryPaths,
    );
    const finalOverlaySha256 = overlaySnapshotDigest(
      finalChangedRepositoryPaths,
      finalChangedEntries,
    );
    if (
      finalHead !== expectedHead ||
      finalBranch !== manifest.target.branch ||
      finalChangedRepositoryPaths.length !== expectedChangeCount ||
      JSON.stringify(finalChangedRepositoryPaths) !==
        JSON.stringify(initialChangedRepositoryPaths) ||
      finalOverlaySha256 !== expectedOverlaySha256
    ) {
      throw new Error(
        "Reviewed overlay changed after validation; manifest was not written.",
      );
    }
    await writeManifestAtomically(manifestPath, serializeManifest(manifest));
    console.log(
      `Refreshed reviewed target snapshot (${manifest.entries.length} donor paths; ${result.targetNativeCount} target-native paths).`,
    );
    return;
  }
  console.log(
    `Immutable source import passed (${manifest.entries.length} source files: ${JSON.stringify(result.counts)}; ${result.targetNativeCount} reviewed target-native files).`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
