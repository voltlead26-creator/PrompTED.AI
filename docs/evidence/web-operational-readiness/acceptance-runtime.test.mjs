import assert from "node:assert/strict";
import test from "node:test";
import { resolveAcceptanceRuntime } from "./acceptance-runtime.mjs";

const mac = { platform: "darwin", sourceRoot: "/Users/kaichurchw/PrompTED.AI",
  nodeExecutable: "/opt/homebrew/opt/node@22/bin/node", home: "/Users/kaichurchw",
  tempDirectory: "/private/var/folders/test/T", environment: { USER: "kaichurchw" } };
const linux = { platform: "linux", sourceRoot: "/home/runner/work/PrompTED.AI/PrompTED.AI",
  nodeExecutable: "/opt/hostedtoolcache/node/22.23.2/x64/bin/node", home: "/home/runner",
  tempDirectory: "/tmp", environment: { USER: "runner", GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: "/home/runner/work/PrompTED.AI/PrompTED.AI",
    PATH: "/home/runner/.deno/bin:/home/runner/.local/bin:/usr/local/bin:/usr/bin:/bin" } };

test("preserves the existing selected Mac runtime and isolated child environment", () => {
  const runtime = resolveAcceptanceRuntime(mac);
  assert.equal(runtime.root, mac.sourceRoot);
  assert.equal(runtime.node, mac.nodeExecutable);
  assert.equal(runtime.dockerHost, "unix:///Users/kaichurchw/.docker/run/docker.sock");
  assert.equal(runtime.dockerExecutable, "/Applications/Docker.app/Contents/Resources/bin/docker");
  assert.deepEqual(runtime.env, {
    PATH: "/opt/homebrew/opt/node@22/bin:/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: mac.home, USER: "kaichurchw", TMPDIR: mac.tempDirectory,
    LANG: "en_AU.UTF-8", DOCKER_HOST: runtime.dockerHost, CI: "true", NO_COLOR: "1",
  });
});
test("selects the exact GitHub Linux checkout, installed Node and local Docker socket", () => {
  const runtime = resolveAcceptanceRuntime(linux);
  assert.equal(runtime.root, linux.sourceRoot);
  assert.equal(runtime.node, linux.nodeExecutable);
  assert.equal(runtime.dockerHost, "unix:///var/run/docker.sock");
  assert.equal(runtime.dockerExecutable, "/usr/bin/docker");
  assert.equal(runtime.env.PATH, "/opt/hostedtoolcache/node/22.23.2/x64/bin:" + linux.environment.PATH);
});
test("does not pass hosted credentials, provider settings or arbitrary variables to children", () => {
  const runtime = resolveAcceptanceRuntime({ ...linux, environment: { ...linux.environment,
    OPENAI_API_KEY: "synthetic-forbidden", SUPABASE_ACCESS_TOKEN: "synthetic-forbidden",
    NEXT_PUBLIC_SUPABASE_URL: "https://hosted.example.invalid", NODE_OPTIONS: "--inspect",
    GITHUB_TOKEN: "synthetic-forbidden", DENO_DIR: "/unreviewed/cache" } });
  assert.deepEqual(Object.keys(runtime.env).sort(),
    ["PATH", "HOME", "USER", "TMPDIR", "LANG", "DOCKER_HOST", "CI", "NO_COLOR"].sort());
});
for (const host of ["tcp://127.0.0.1:2375", "tcp://remote.example.invalid:2376", "ssh://remote.example.invalid", "unix:///tmp/other-docker.sock"]) {
  test(`rejects Docker override ${host} before any service can start`, () => {
    assert.throws(() => resolveAcceptanceRuntime({ ...linux,
      environment: { ...linux.environment, DOCKER_HOST: host } }), /Docker/);
  });
}
test("accepts an explicit matching local socket without changing the target", () => {
  assert.equal(resolveAcceptanceRuntime({ ...linux, environment: {
    ...linux.environment, DOCKER_HOST: "unix:///var/run/docker.sock" } }).dockerHost,
  "unix:///var/run/docker.sock");
});
for (const [label, change] of [
  ["unsupported operating system", { platform: "win32" }],
  ["Linux outside GitHub Actions", { environment: { ...linux.environment, GITHUB_ACTIONS: "false" } }],
  ["different checkout", { environment: { ...linux.environment, GITHUB_WORKSPACE: "/tmp/donor" } }],
  ["relative Node executable", { nodeExecutable: "node" }],
  ["relative executable search directory", { environment: { ...linux.environment, PATH: "./bin:/usr/bin" } }],
  ["empty executable search directory", { environment: { ...linux.environment, PATH: ":/usr/bin" } }],
  ["Docker context override", { environment: { ...linux.environment, DOCKER_CONTEXT: "production" } }],
  ["Docker TLS override", { environment: { ...linux.environment, DOCKER_TLS_VERIFY: "1" } }],
  ["Docker certificate override", { environment: { ...linux.environment, DOCKER_CERT_PATH: "/private/operator-certs" } }],
]) test(`rejects ${label}`, () => assert.throws(() => resolveAcceptanceRuntime({ ...linux, ...change })));
