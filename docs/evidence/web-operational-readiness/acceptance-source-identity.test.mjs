import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAcceptanceSourceIdentity, snapshotAcceptanceSources } from "./acceptance-source-identity.mjs";

const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sourceDirectory(t) {
  const root = mkdtempSync(join(tmpdir(), "prompted-source-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("source snapshots retain sorted paths and exact content hashes for present files", t => {
  const root = sourceDirectory(t);
  writeFileSync(join(root, "z.ts"), "abc");
  writeFileSync(join(root, "empty.ts"), "");
  const snapshot = snapshotAcceptanceSources({ root, files: ["z.ts", "empty.ts"] });
  assert.deepEqual(Object.keys(snapshot), ["empty.ts", "z.ts"]);
  assert.deepEqual(snapshot, { "empty.ts": EMPTY_SHA256, "z.ts": ABC_SHA256 });
});

test("an explicitly Git-deleted source is retained as a null tombstone", t => {
  const root = sourceDirectory(t);
  const deleted = "apps/web/src/types/revenuecat.d.ts";
  writeFileSync(join(root, "package.json"), "abc");
  const snapshot = snapshotAcceptanceSources({
    root, files: ["package.json", deleted], deletedFiles: [deleted],
  });
  assert.deepEqual(snapshot, { [deleted]: null, "package.json": ABC_SHA256 });
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test("a deleted source reappearing changes the snapshot even with a stale deletion roster", t => {
  const root = sourceDirectory(t);
  const files = ["removed.ts"];
  const before = snapshotAcceptanceSources({ root, files, deletedFiles: files });
  assert.deepEqual(before, { "removed.ts": null });
  writeFileSync(join(root, "removed.ts"), "abc");
  const after = snapshotAcceptanceSources({ root, files, deletedFiles: [] });
  assert.deepEqual(after, { "removed.ts": ABC_SHA256 });
  assert.notDeepEqual(after, before);
  assert.deepEqual(snapshotAcceptanceSources({ root, files, deletedFiles: files }), after);
});

test("a present source becoming Git-deleted changes the snapshot without dropping its path", t => {
  const root = sourceDirectory(t);
  const files = ["removed.ts"];
  writeFileSync(join(root, "removed.ts"), "");
  const before = snapshotAcceptanceSources({ root, files });
  unlinkSync(join(root, "removed.ts"));
  const after = snapshotAcceptanceSources({ root, files, deletedFiles: files });
  assert.deepEqual(before, { "removed.ts": EMPTY_SHA256 });
  assert.deepEqual(after, { "removed.ts": null });
  assert.notDeepEqual(after, before);
});

test("a missing source outside the explicit deletion roster remains fatal", t => {
  const root = sourceDirectory(t);
  writeFileSync(join(root, "present.ts"), "abc");
  for (const deletedFiles of [[], ["present.ts"]]) {
    assert.throws(() => snapshotAcceptanceSources({
      root, files: ["missing.ts", "present.ts"], deletedFiles,
    }), { code: "ENOENT" });
  }
});

test("the deletion roster cannot introduce a path absent from the source roster", t => {
  const root = sourceDirectory(t);
  writeFileSync(join(root, "present.ts"), "abc");
  assert.throws(() => snapshotAcceptanceSources({
    root, files: ["present.ts"], deletedFiles: ["unlisted.ts"],
  }), /Deleted source is outside the source roster/);
});

for (const declaredDeleted of [false, true]) {
  test(`a directory is rejected when declared deleted is ${declaredDeleted}`, t => {
    const root = sourceDirectory(t);
    mkdirSync(join(root, "directory"));
    assert.throws(() => snapshotAcceptanceSources({
      root, files: ["directory"], deletedFiles: declaredDeleted ? ["directory"] : [],
    }), /Unexpected non-file source/);
  });
}

for (const targetKind of ["file", "directory", "missing"]) {
  test(`a symlink to a ${targetKind} is rejected even when declared deleted`, t => {
    const root = sourceDirectory(t);
    const target = join(root, "target");
    if (targetKind === "file") writeFileSync(target, "abc");
    if (targetKind === "directory") mkdirSync(target);
    symlinkSync(target, join(root, "link.ts"));
    for (const deletedFiles of [[], ["link.ts"]]) {
      assert.throws(() => snapshotAcceptanceSources({
        root, files: ["link.ts"], deletedFiles,
      }), /Unexpected non-file source/);
    }
  });
}

test("real source content changes remain visible in before/after snapshots", t => {
  const root = sourceDirectory(t);
  const files = ["source.ts"];
  writeFileSync(join(root, "source.ts"), "abc");
  const before = snapshotAcceptanceSources({ root, files });
  writeFileSync(join(root, "source.ts"), "def");
  const after = snapshotAcceptanceSources({ root, files });
  assert.deepEqual(before, { "source.ts": ABC_SHA256 });
  assert.match(after["source.ts"], /^[0-9a-f]{64}$/);
  assert.notDeepEqual(after, before);
});

const source = { head: "a".repeat(40), branch: "Thought-Enhanced-Document",
  origin: "https://github.com/voltlead26-creator/PrompTED.AI" };
test("accepts a new exact revision on the selected repository and branch", () => {
  assert.equal(assertAcceptanceSourceIdentity(source), source.head);
  assert.equal(assertAcceptanceSourceIdentity({ ...source, expectedHead: source.head }), source.head);
});
for (const [label, change] of [
  ["stale expected revision", { expectedHead: "b".repeat(40) }],
  ["branch name as revision", { head: "Thought-Enhanced-Document" }],
  ["wrong branch", { branch: "main" }],
  ["donor repository", { origin: "https://github.com/voltlead26-creator/ClaudeTED.AI" }],
  ["malformed expected revision", { expectedHead: "HEAD" }],
]) test(`rejects ${label}`, () => assert.throws(() => assertAcceptanceSourceIdentity({ ...source, ...change })));

const github = { actions: "true", repository: "voltlead26-creator/PrompTED.AI",
  eventName: "push", sha: source.head, ref: "refs/heads/Thought-Enhanced-Document", baseRef: "" };
test("accepts a detached exact canonical GitHub push revision", () => {
  assert.equal(assertAcceptanceSourceIdentity({ ...source, branch: "", expectedHead: source.head, github }), source.head);
});
test("accepts the exact pull request merge revision targeting the canonical branch", () => {
  assert.equal(assertAcceptanceSourceIdentity({ ...source, branch: "", expectedHead: source.head,
    github: { ...github, eventName: "pull_request", ref: "refs/pull/42/merge", baseRef: source.branch } }), source.head);
});
test("rejects a detached local checkout without GitHub identity", () => {
  assert.throws(() => assertAcceptanceSourceIdentity({ ...source, branch: "" }));
});
for (const [label, change] of [
  ["wrong GitHub repository", { repository: "voltlead26-creator/ClaudeTED.AI" }],
  ["different event revision", { sha: "b".repeat(40) }],
  ["unverified event revision", { sha: "HEAD" }],
  ["non-Actions context", { actions: "false" }],
  ["wrong push branch", { ref: "refs/heads/main" }],
  ["privileged pull request event", { eventName: "pull_request_target" }],
  ["unsupported workflow event", { eventName: "workflow_dispatch" }],
  ["pull request head instead of merge revision", { eventName: "pull_request", ref: "refs/pull/42/head", baseRef: source.branch }],
  ["pull request targeting another branch", { eventName: "pull_request", ref: "refs/pull/42/merge", baseRef: "main" }],
  ["invalid pull request number", { eventName: "pull_request", ref: "refs/pull/0/merge", baseRef: source.branch }],
]) test(`rejects ${label} even when the local branch otherwise matches`, () => {
  assert.throws(() => assertAcceptanceSourceIdentity({ ...source, expectedHead: source.head,
    github: { ...github, ...change } }));
});
test("requires an explicit expected revision for GitHub acceptance", () => {
  assert.throws(() => assertAcceptanceSourceIdentity({ ...source, github }));
});
