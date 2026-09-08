import assert from "node:assert/strict";

// Call only around this runner's explicit local db reset, after both snapshots
// pass live project/port/network/volume attestation. Reset may recreate the
// container and PostgreSQL cluster; no other part of the target may change.
export function assertDisposableReset(before, after) {
  const stableTarget = snapshot => {
    const { container, identity, ...target } = snapshot;
    assert.match(container, /^[0-9a-f]{64}$/);
    const { cluster, ...database } = identity;
    assert.match(cluster, /^\d+$/);
    return { ...target, identity: database };
  };
  assert.deepEqual(stableTarget(after), stableTarget(before),
    "Disposable reset changed the accepted target configuration");
}
