import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertDisposableReset } from "./disposable-database-reset.mjs";

// Actual snapshots from the failed acceptance run: the CLI replaced the owned
// container/cluster while preserving every target binding. No services start.
const evidence = new URL("./db-20260906163458380-8b03111a/", import.meta.url);
const before = JSON.parse(readFileSync(new URL("source-database-before-historical-reset.json", evidence)));
const after = JSON.parse(readFileSync(new URL("source-database-before-upgrade.json", evidence)));

test("accepts the observed owned container and cluster replacement after reset", () => {
  assert.notEqual(after.container, before.container);
  assert.notEqual(after.identity.cluster, before.identity.cluster);
  assertDisposableReset(before, after);
  assertDisposableReset(before, before);
});

for (const [label, change] of [
  ["project", value => { value.project = "another-project"; }],
  ["database", value => { value.identity.database = "another-database"; }],
  ["database version", value => { value.identity.version = "17.7"; }],
  ["internal port", value => { value.identity.port = "5433"; }],
  ["published port", value => { value.ports["5432/tcp"][0].HostPort = "54322"; }],
  ["network", value => { value.networks = ["shared-network"]; }],
  ["volume", value => { value.mounts[0].Name = "shared-volume"; }],
  ["mount path", value => { value.mounts[0].Destination = "/different/data"; }],
  ["image", value => { value.image = "another-image"; }],
  ["missing identity", value => { delete value.identity; }],
  ["malformed container", value => { value.container = ""; }],
  ["malformed cluster", value => { value.identity.cluster = null; }],
]) {
  test(`rejects ${label} drift at the reset boundary`, () => {
    const changed = structuredClone(after);
    change(changed);
    assert.throws(() => assertDisposableReset(before, changed));
  });
}
