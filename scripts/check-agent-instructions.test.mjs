import assert from "node:assert/strict";
import test from "node:test";

import { validateInstructionFiles } from "./check-agent-instructions.mjs";

test("accepts the root AGENTS.md as the sole instruction authority", () => {
  assert.deepEqual(
    validateInstructionFiles(["AGENTS.md", "README.md", "apps/web/package.json"]),
    [],
  );
});

test("rejects a missing root instruction authority", () => {
  assert.match(validateInstructionFiles(["README.md"])[0], /found: none/);
});

test("rejects nested or singular competing instruction files", () => {
  const failures = validateInstructionFiles([
    "AGENTS.md",
    "apps/web/AGENT.md",
    "supabase/functions/AGENTS.md",
  ]);

  assert.equal(failures.length, 1);
  assert.match(failures[0], /apps\/web\/AGENT\.md/);
  assert.match(failures[0], /supabase\/functions\/AGENTS\.md/);
});

test("rejects a competing CLAUDE.md regardless of filename case", () => {
  assert.match(
    validateInstructionFiles(["AGENTS.md", "docs/claude.md"])[0],
    /docs\/claude\.md/,
  );
});

test("rejects an instruction bible while allowing a historical handoff", () => {
  const failures = validateInstructionFiles([
    "AGENTS.md",
    "prompted-codex-instruction-bible_2.md",
    "docs/quality/2026-08-23-codex-handoff.md",
  ]);

  assert.equal(failures.length, 1);
  assert.match(failures[0], /prompted-codex-instruction-bible_2\.md/);
  assert.doesNotMatch(failures[0], /2026-08-23-codex-handoff\.md/);
});
