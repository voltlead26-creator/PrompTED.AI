import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute } from "node:path";

// Runtime selection is separate from admission: the caller still verifies the
// Git repository/revision, real paths, locked versions, socket and DB identity.
// Only the selected Mac checkout and an explicit GitHub Linux checkout qualify.
export function resolveAcceptanceRuntime({ platform = process.platform, sourceRoot,
  nodeExecutable = process.execPath, environment = process.env,
  home = homedir(), tempDirectory = tmpdir() } = {}) {
  assert.ok(platform === "darwin" || platform === "linux", "Unsupported acceptance operating system");
  assert.ok(typeof sourceRoot === "string" && isAbsolute(sourceRoot), "Acceptance source root must be absolute");
  assert.ok(typeof nodeExecutable === "string" && isAbsolute(nodeExecutable), "Acceptance Node executable must be absolute");
  let dockerHost;
  let dockerExecutable;
  let path;
  if (platform === "darwin") {
    assert.equal(sourceRoot, "/Users/kaichurchw/PrompTED.AI", "Unexpected local acceptance checkout");
    dockerHost = "unix:///Users/kaichurchw/.docker/run/docker.sock";
    dockerExecutable = "/Applications/Docker.app/Contents/Resources/bin/docker";
    path = "/opt/homebrew/opt/node@22/bin:/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  } else {
    assert.equal(environment.GITHUB_ACTIONS, "true", "Linux acceptance requires GitHub Actions");
    assert.equal(environment.GITHUB_WORKSPACE, sourceRoot, "Unexpected GitHub acceptance checkout");
    assert.ok(typeof environment.PATH === "string" && environment.PATH.length > 0,
      "GitHub acceptance needs installed tool directories");
    const directories = environment.PATH.split(":");
    assert.ok(directories.every(directory => isAbsolute(directory)), "Executable search directories must be absolute and non-empty");
    path = [...new Set([dirname(nodeExecutable), ...directories])].join(":");
    dockerHost = "unix:///var/run/docker.sock";
    dockerExecutable = "/usr/bin/docker";
  }
  assert.ok(!environment.DOCKER_HOST || environment.DOCKER_HOST === dockerHost,
    "Docker override differs from the selected local Unix socket");
  assert.ok(!environment.DOCKER_CONTEXT, "Docker context overrides are not accepted");
  assert.ok(!environment.DOCKER_TLS_VERIFY && !environment.DOCKER_CERT_PATH,
    "Docker TLS overrides are not accepted for the local Unix socket");
  return {
    root: sourceRoot,
    dockerHost,
    dockerExecutable,
    node: nodeExecutable,
    env: {
      PATH: path,
      HOME: home,
      USER: environment.USER ?? (platform === "darwin" ? "kaichurchw" : "runner"),
      TMPDIR: tempDirectory,
      LANG: "en_AU.UTF-8",
      DOCKER_HOST: dockerHost,
      CI: "true",
      NO_COLOR: "1",
    },
  };
}
