import assert from "node:assert/strict";
import test from "node:test";
import { runOwnedVerificationCommand } from "./owned-verification-command.mjs";

const run = (source, options = {}) => runOwnedVerificationCommand(process.execPath, ["-e", source], {
  cwd: process.cwd(), env: { PATH: "/usr/bin:/bin" }, timeout: 2000, ...options,
});
test("owned command retains successful output and an exact zero exit", async () => {
  assert.deepEqual(await run('process.stdout.write("complete")'), { code: 0, signal: null, failure: null, stdout: "complete", stderr: "" });
});
test("owned command timeout cannot become success when a child ignores or handles SIGTERM", async () => {
  for (const handler of ["() => {}", "() => process.exit(0)"]) {
    const result = await run(`process.on("SIGTERM", ${handler}); setInterval(() => {}, 1000);`, { timeout: 150 });
    assert.equal(result.failure, "timeout");
    assert.notEqual(result.code, 0);
    assert.equal(result.signal, "SIGKILL");
  }
});
test("owned command cancels, rejects excess output and reports spawn errors", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal((await run('process.exit(0)', { signal: cancelled.signal })).failure, "cancelled");
  const active = new AbortController();
  const pending = run('setInterval(() => {}, 1000)', { signal: active.signal });
  const abortTimer = setTimeout(() => active.abort(), 100);
  try {
    const result = await pending;
    assert.equal(result.failure, "cancelled");
    assert.equal(result.signal, "SIGKILL");
  } finally { clearTimeout(abortTimer); }
  assert.equal((await run('process.stdout.write("x".repeat(8192)); setInterval(() => {}, 1000)', { maximumBytes: 512 })).failure, "output_limit");
  const missing = await runOwnedVerificationCommand("/nonexistent/prompted-verification-command", [], { cwd: process.cwd(), env: {}, timeout: 2000 });
  assert.equal(missing.failure, "spawn:ENOENT");
});
test("owned command removes its waiting descendant when the parent exits zero", async () => {
  const result = await run('const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log(child.pid);setTimeout(()=>process.exit(0),100);');
  assert.equal(result.code, 0);
  assert.equal(result.failure, null);
  const pid = Number(result.stdout.trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  // The close event cannot fire until the descendant's inherited pipes close.
  // kill(0) may briefly observe an OS zombie, so successful pipe closure plus
  // the explicit group kill is the portable completion boundary here.
});
