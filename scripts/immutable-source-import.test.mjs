import assert from "node:assert/strict";
import test from "node:test";

import {
  readTargetEntries,
  validateImmutableSourceImport,
} from "./immutable-source-import.mjs";

const SOURCE = {
  remote: "https://github.com/example/source.git",
  commit: "a".repeat(40),
  entryCount: 1,
};

function manifest(entry) {
  return {
    schemaVersion: 1,
    source: { ...SOURCE },
    target: {
      remote: "https://github.com/example/target.git",
      entryCount: 0,
    },
    rules: { reviewed: "Reviewed test rule." },
    targetNative: [],
    entries: [{
      path: "README.md",
      mode: "100644",
      sourceBlob: "b".repeat(40),
      bytes: 12,
      rule: "reviewed",
      ...entry,
    }],
  };
}

test("accepts an exact retained source blob", () => {
  const result = validateImmutableSourceImport(
    manifest({ decision: "retain_exact" }),
    new Map([["README.md", { mode: "100644", blob: "b".repeat(40) }]]),
  );

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.counts, { retain_exact: 1 });
});

test("rejects target drift for an exact retained source blob", () => {
  const result = validateImmutableSourceImport(
    manifest({ decision: "retain_exact" }),
    new Map([["README.md", { mode: "100644", blob: "c".repeat(40) }]]),
  );

  assert.match(result.failures.join("\n"), /must match source blob/);
});

test("accepts a reviewed rewrite only at its recorded target blob", () => {
  const rewritten = manifest({
    decision: "rewrite_target",
    targetBlob: "c".repeat(40),
  });

  assert.deepEqual(
    validateImmutableSourceImport(
      rewritten,
      new Map([["README.md", { mode: "100644", blob: "c".repeat(40) }]]),
    ).failures,
    [],
  );
  assert.match(
    validateImmutableSourceImport(
      rewritten,
      new Map([["README.md", { mode: "100644", blob: "d".repeat(40) }]]),
    ).failures.join("\n"),
    /recorded target blob/,
  );
});

test("rejects a rewrite that records the unchanged source blob", () => {
  const result = validateImmutableSourceImport(
    manifest({ decision: "rewrite_target", targetBlob: "b".repeat(40) }),
    new Map([["README.md", { mode: "100644", blob: "b".repeat(40) }]]),
  );

  assert.match(result.failures.join("\n"), /must differ from source blob/);
});

test("requires excluded source files to be absent", () => {
  const excluded = manifest({ decision: "exclude" });

  assert.deepEqual(
    validateImmutableSourceImport(excluded, new Map()).failures,
    [],
  );
  assert.match(
    validateImmutableSourceImport(
      excluded,
      new Map([["README.md", { mode: "100644", blob: "b".repeat(40) }]]),
    ).failures.join("\n"),
    /must be absent/,
  );
});

test("rejects pending decisions, unknown rules, duplicate paths, and unsorted entries", () => {
  const invalid = manifest({ decision: "pending", rule: "missing" });
  invalid.source.entryCount = 2;
  invalid.entries = [
    { ...invalid.entries[0], path: "z.md" },
    { ...invalid.entries[0], path: "z.md" },
  ];

  const failures = validateImmutableSourceImport(invalid, new Map()).failures.join("\n");
  assert.match(failures, /unknown rule/);
  assert.match(failures, /pending decision/);
  assert.match(failures, /duplicate path/);
});

test("accepts historical and deferred exact files without treating them as active", () => {
  for (const decision of ["retain_historical_exact", "defer_exact"]) {
    const result = validateImmutableSourceImport(
      manifest({ decision }),
      new Map([["README.md", { mode: "100644", blob: "b".repeat(40) }]]),
    );
    assert.deepEqual(result.failures, []);
  }
});

test("accepts an exact, reviewed target-native inventory", () => {
  const reviewed = manifest({ decision: "retain_exact" });
  reviewed.target.entryCount = 1;
  reviewed.targetNative = [{
    path: "scripts/new-check.mjs",
    mode: "100644",
    targetBlob: "c".repeat(40),
    bytes: 21,
    rule: "reviewed",
  }];

  const result = validateImmutableSourceImport(
    reviewed,
    new Map([["README.md", { mode: "100644", blob: "b".repeat(40) }]]),
    new Map([[
      "scripts/new-check.mjs",
      { mode: "100644", blob: "c".repeat(40), bytes: 21 },
    ]]),
  );

  assert.deepEqual(result.failures, []);
  assert.equal(result.targetNativeCount, 1);
});

test("rejects missing, drifted, and unrecorded target-native files", () => {
  const reviewed = manifest({ decision: "retain_exact" });
  reviewed.target.entryCount = 1;
  reviewed.targetNative = [{
    path: "scripts/new-check.mjs",
    mode: "100644",
    targetBlob: "c".repeat(40),
    bytes: 21,
    rule: "reviewed",
  }];

  const missing = validateImmutableSourceImport(reviewed, new Map(), new Map());
  assert.match(missing.failures.join("\n"), /target-native file is missing/);

  const drifted = validateImmutableSourceImport(
    reviewed,
    new Map(),
    new Map([[
      "scripts/new-check.mjs",
      { mode: "100644", blob: "d".repeat(40), bytes: 22 },
    ]]),
  );
  assert.match(drifted.failures.join("\n"), /target-native blob/);
  assert.match(drifted.failures.join("\n"), /target-native byte size/);

  const unrecorded = validateImmutableSourceImport(
    reviewed,
    new Map(),
    new Map([
      ["scripts/new-check.mjs", { mode: "100644", blob: "c".repeat(40), bytes: 21 }],
      ["scripts/unreviewed.mjs", { mode: "100644", blob: "d".repeat(40), bytes: 5 }],
    ]),
  );
  assert.match(unrecorded.failures.join("\n"), /unrecorded target-native file/);
});

test("rejects overlapping and self-referential target-native records", () => {
  const overlapping = manifest({ decision: "retain_exact" });
  overlapping.target.entryCount = 2;
  overlapping.targetNative = [
    {
      path: "README.md",
      mode: "100644",
      targetBlob: "b".repeat(40),
      bytes: 12,
      rule: "reviewed",
    },
    {
      path: "docs/audits/immutable-source-import.json",
      mode: "100644",
      targetBlob: "c".repeat(40),
      bytes: 99,
      rule: "reviewed",
    },
  ];

  const failures = validateImmutableSourceImport(
    overlapping,
    new Map(),
    new Map(),
  ).failures.join("\n");
  assert.match(failures, /also appears in source entries/);
  assert.match(failures, /cannot hash itself/);
});

test("rejects missing, forged, and unrecorded immutable source rows", () => {
  const reviewed = manifest({ decision: "retain_exact" });
  const immutableSource = new Map([
    ["README.md", { mode: "100644", blob: "c".repeat(40), bytes: 13 }],
    ["UNRECORDED.md", { mode: "100644", blob: "d".repeat(40), bytes: 5 }],
  ]);

  const failures = validateImmutableSourceImport(
    reviewed,
    new Map([["README.md", { mode: "100644", blob: "b".repeat(40) }]]),
    new Map(),
    immutableSource,
  ).failures.join("\n");

  assert.match(failures, /source blob does not match immutable commit/);
  assert.match(failures, /source byte size/);
  assert.match(failures, /unrecorded immutable source file/);
});

test("refuses to read a target path outside the repository", async () => {
  await assert.rejects(
    readTargetEntries(process.cwd(), ["../outside.txt"]),
    /invalid repository-relative path/,
  );
});
