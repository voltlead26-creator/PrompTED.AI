import assert from "node:assert/strict";
import test from "node:test";
import { assertAcceptanceSourceIdentity } from "./acceptance-source-identity.mjs";

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
