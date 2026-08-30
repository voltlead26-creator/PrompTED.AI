#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const AUTHORITATIVE_PATH = "AGENTS.md";
const INSTRUCTION_FILENAMES = new Set(["AGENT.MD", "AGENTS.MD", "CLAUDE.MD"]);
const INSTRUCTION_LIKE_MARKERS = ["AGENT", "CLAUDE", "CODEX", "INSTRUCTION"];

function isInstructionLikePath(path) {
  const filename = path.split("/").at(-1)?.toUpperCase();
  if (!filename?.endsWith(".MD")) return false;
  if (INSTRUCTION_FILENAMES.has(filename)) return true;
  return INSTRUCTION_LIKE_MARKERS.some((marker) => filename.includes(marker)) &&
    !filename.includes("HANDOFF");
}

export function validateInstructionFiles(trackedPaths) {
  const instructionPaths = trackedPaths
    .filter(isInstructionLikePath)
    .sort();

  if (
    instructionPaths.length === 1 &&
    instructionPaths[0] === AUTHORITATIVE_PATH
  ) {
    return [];
  }

  const found = instructionPaths.length > 0
    ? instructionPaths.join(", ")
    : "none";
  return [
    `Expected the sole tracked agent instruction file to be "${AUTHORITATIVE_PATH}"; found: ${found}.`,
  ];
}

export function listTrackedPaths(repoRoot = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect tracked files: ${result.stderr.trim() || `git exited ${result.status}`}.`,
    );
  }
  return result.stdout.split("\0").filter(Boolean);
}

function main() {
  const failures = validateInstructionFiles(listTrackedPaths());
  if (failures.length > 0) {
    console.error("Agent instruction authority check failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Agent instruction authority check passed (${AUTHORITATIVE_PATH} only).`);
}

const isMainModule = process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
