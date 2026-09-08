import assert from "node:assert/strict";

/** Freeze the explicitly selected repository revision before starting a local stack. */
export function assertAcceptanceSourceIdentity({ head, expectedHead, branch, origin, github }) {
  assert.match(head, /^[0-9a-f]{40}$/, "Acceptance needs an exact Git commit");
  assert.ok([
    "https://github.com/voltlead26-creator/PrompTED.AI",
    "https://github.com/voltlead26-creator/PrompTED.AI.git",
    "git@github.com:voltlead26-creator/PrompTED.AI.git",
  ].includes(origin), "Unexpected acceptance repository");
  if (github !== undefined) {
    assert.equal(github.actions, "true", "Acceptance needs an explicit GitHub Actions context");
    assert.equal(github.repository, "voltlead26-creator/PrompTED.AI", "Unexpected GitHub acceptance repository");
    assert.match(github.sha, /^[0-9a-f]{40}$/, "GitHub acceptance needs an exact event revision");
    assert.equal(head, github.sha, "Git checkout differs from the GitHub event revision");
    assert.match(expectedHead ?? "", /^[0-9a-f]{40}$/, "GitHub acceptance requires an expected revision");
    assert.ok(branch === "" || branch === "Thought-Enhanced-Document", "Unexpected acceptance branch");
    if (github.eventName === "push") {
      assert.equal(github.ref, "refs/heads/Thought-Enhanced-Document", "Unexpected GitHub push branch");
      assert.equal(github.baseRef, "", "Unexpected base branch on a push event");
    } else {
      assert.equal(github.eventName, "pull_request", "Unsupported GitHub acceptance event");
      assert.match(github.ref, /^refs\/pull\/[1-9]\d*\/merge$/, "Acceptance requires the pull request merge revision");
      assert.equal(github.baseRef, "Thought-Enhanced-Document", "Unexpected pull request base branch");
    }
  } else {
    assert.equal(branch, "Thought-Enhanced-Document", "Unexpected acceptance branch");
  }
  if (expectedHead !== undefined) {
    assert.match(expectedHead, /^[0-9a-f]{40}$/, "Expected acceptance revision is invalid");
    assert.equal(head, expectedHead, "Acceptance revision changed before execution");
  }
  return head;
}
