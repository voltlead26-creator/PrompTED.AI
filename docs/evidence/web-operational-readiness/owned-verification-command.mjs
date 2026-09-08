import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Finite evidence commands only; child and descendants belong to this group.
export function runOwnedVerificationCommand(command, args, { cwd, env, timeout, maximumBytes = 64 * 1024 * 1024, signal }) {
  assert.ok(Number.isFinite(timeout) && timeout > 0);
  assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0);
  if (signal?.aborted) return Promise.resolve({ code: null, signal: null, failure: "cancelled", stdout: "", stderr: "" });
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let failure = null;
    let stdout = "";
    let stderr = "";
    let byteCount = 0;
    function killGroup() {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") failure ??= `cleanup:${error.code}`; }
    }
    function fail(reason) { failure ??= reason; killGroup(); }
    const cancel = () => fail("cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => fail("timeout"), timeout);
    function capture(stream, append) {
      stream.setEncoding("utf8");
      stream.on("data", chunk => {
        byteCount += Buffer.byteLength(chunk);
        if (byteCount > maximumBytes) fail("output_limit");
        else append(chunk);
      });
    }
    capture(child.stdout, chunk => { stdout += chunk; });
    capture(child.stderr, chunk => { stderr += chunk; });
    child.on("error", error => fail(`spawn:${error.code ?? "unknown"}`));
    child.once("exit", killGroup); // Remove leftover owned descendants even on exit zero.
    child.once("close", (code, terminalSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      killGroup();
      resolve({ code, signal: terminalSignal, failure, stdout, stderr });
    });
  });
}
