// Finite local web or upload-source Edge verification of the recorded overlay. No database,
// provider, hosted configuration or deployment activity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertAcceptanceSourceIdentity } from "./acceptance-source-identity.mjs";

process.umask(0o077);
assert.ok(process.argv.length <= 3, "Only one verification mode is accepted");
const mode = process.argv[2] ?? "web";
assert.ok(["web", "upload-source-edge", "upload-source-full"].includes(mode), "Unsupported verification mode");
const root = "/Users/kaichurchw/PrompTED.AI";
const env = {
  PATH: "/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: homedir(), USER: "kaichurchw", TMPDIR: tmpdir(), CI: "true", NO_COLOR: "1",
};
assert.equal(process.cwd(), root);
assert.equal(process.version, "v22.23.2");
function git(...args) {
  const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024, timeout: 30_000, killSignal: "SIGKILL" });
  assert.equal(result.error, undefined, "Git inventory errored");
  assert.equal(result.signal, null, "Git inventory was interrupted");
  assert.equal(result.status, 0, "Git inventory failed");
  return result.stdout;
}
const head = assertAcceptanceSourceIdentity({
  head: git("rev-parse", "HEAD").trim(),
  expectedHead: process.env.PROMPTED_ACCEPTANCE_EXPECTED_HEAD,
  branch: git("branch", "--show-current").trim(),
  origin: git("remote", "get-url", "origin").trim(),
});
const evidence = join(root, "docs/evidence/web-operational-readiness",
  `${mode === "web" ? "master-web" : mode}-gate-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`);
mkdirSync(evidence);
const save = (name, value) => writeFileSync(join(evidence, name),
  typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
const sha = value => createHash("sha256").update(value).digest("hex");
function source() {
  const tracked = new Set(git("ls-files", "-z").split("\0"));
  const paths = new Set([...tracked,
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0")]);
  return Object.fromEntries([...paths].filter(path => path &&
    !path.startsWith("docs/evidence/") && !path.startsWith(".agents/") &&
    // Another coordinated task writes browser bundles/screenshots/logs here.
    // They are not imported by runtime source. Preserve tracked-file checking
    // even if a file in this exact generated-evidence directory is later added.
    (tracked.has(path) || !path.startsWith(".codex/clarification-knowledge-verification/")))
    .sort().map(path => [path, sha(readFileSync(join(root, path)))]));
}
// Record only file metadata and whole-file digests, never dotenv values. These
// are the automatically loaded paths checked by the real web environment guard.
function webDotenvSnapshot() {
  return Object.fromEntries(["", "apps/web/"].flatMap(prefix =>
    [".env", ".env.local", ".env.production", ".env.production.local"].map(name => {
      const path = `${prefix}${name}`;
      if (!existsSync(path)) return [path, { exists: false }];
      const metadata = lstatSync(path);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), "Unexpected web dotenv file type");
      return [path, { exists: true, mode: metadata.mode & 0o777,
        sha256: sha(readFileSync(path)) }];
    })));
}
const dotenvBefore = webDotenvSnapshot();
save("web-dotenv-before.json", dotenvBefore);
const before = source();
save("source-before.json", before);
save("tracked-before.patch", git("diff", "--binary", "HEAD"));
save("status-before.log", git("status", "--porcelain=v1"));
save("runner.mjs", readFileSync(new URL(import.meta.url), "utf8"));
const results = [];
function check(name, command, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, timeout: 600_000, killSignal: "SIGKILL" });
  save(`${name}.log`, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  results.push({ name, command, args, startedAt, endedAt: new Date().toISOString(),
    exit: result.status, signal: result.signal, error: result.error?.code ?? null });
  save("results.json", results);
  if (result.error || result.signal) {
    throw new Error(`${name} did not complete (${result.error?.code ?? result.signal})`);
  }
  return result.status === 0 && !result.error && !result.signal;
}
check("pnpm-version", "pnpm", ["--version"]);
assert.equal(readFileSync(join(evidence, "pnpm-version.log"), "utf8").trim(), "10.33.0");
if (mode === "web" || mode === "upload-source-full") {
  check("web", "pnpm", ["verify:web"]);
}
if (mode !== "web") {
  check("deno-version", "deno", ["--version"]);
  assert.match(readFileSync(join(evidence, "deno-version.log"), "utf8"), /^deno 2\.9\.5\b/);
  const entries = readdirSync("supabase/functions", { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("_"))
    .map(entry => `supabase/functions/${entry.name}/index.ts`)
    .filter(entry => existsSync(entry)).sort();
  assert.ok(entries.length > 0, "No function entry points found");
  check("edge-types", "deno", ["check", ...entries,
    "supabase/functions/_shared/document-source-contract.ts",
    "supabase/functions/_shared/wordprocessingml-source.ts"]);
  check("source-lint", "deno", ["lint", "supabase/functions/_shared/bounded-xml.ts",
    "supabase/functions/_shared/bounded-rtf.ts",
    "supabase/functions/_shared/bounded-rtf.test.ts",
    "supabase/functions/_shared/rtf-source.ts",
    "supabase/functions/_shared/rtf-source.test.ts",
    "supabase/functions/_shared/upload-rtf-source.test.ts",
    "supabase/functions/_shared/bounded-xml.test.ts",
    "supabase/functions/_shared/document-source-contract.ts",
    "supabase/functions/_shared/document-source-contract.test.ts",
    "supabase/functions/_shared/wordprocessingml-source.ts",
    "supabase/functions/_shared/wordprocessingml-source.test.ts",
    "supabase/functions/_shared/upload-extraction.ts",
    "supabase/functions/_shared/upload-extraction.test.ts",
    "supabase/functions/_shared/upload-text-encoding.test.ts",
    "supabase/functions/_shared/upload-extraction-client.ts",
    "supabase/functions/_shared/upload-extraction-client.test.ts",
    "supabase/functions/_shared/upload-extraction-client-v3.test.ts",
    "supabase/functions/_shared/upload-extraction-contract.ts",
    "supabase/functions/extract-upload/index.ts",
    "supabase/functions/extract-upload/handler.ts",
    "supabase/functions/extract-upload/handler.test.ts",
    "supabase/functions/extract-upload/handler-v3.test.ts",
    "supabase/functions/extract-upload/handler-source-identity.test.ts",
    "supabase/functions/extract-upload/handler-request-lifecycle.test.ts",
    "supabase/functions/ingest-upload/handler.ts",
    "supabase/functions/ingest-upload/exact-replay.test.ts",
    "supabase/functions/ingest-upload/source-checkpoint-v3.test.ts",
    "supabase/functions/ingest-upload/source-checkpoint.test.ts",
    "supabase/functions/_shared/cost-tracker.ts",
    "supabase/functions/_shared/cost-tracker.test.ts",
    "supabase/functions/_shared/model-call-context.ts",
    "supabase/functions/_shared/model-call-context.test.ts",
    "supabase/functions/_shared/provider-router.ts",
    "supabase/functions/_shared/provider-router.test.ts",
    "supabase/functions/_shared/document-pipeline.ts",
    "supabase/functions/_shared/document-audit-binding.ts",
    "supabase/functions/_shared/document-audit-binding.test.ts",
    "supabase/functions/_shared/document-pipeline.final-audit.test.ts",
    "supabase/functions/_shared/document-pipeline-utils.ts",
    "supabase/functions/_shared/document-pipeline-utils.test.ts",
    "supabase/functions/_shared/openai-proxy.test.ts",
    "supabase/functions/_shared/section-designer.test.ts",
    "supabase/functions/_shared/document-pipeline.catalogue-profile.test.ts",
    "supabase/functions/generate-document/admission.test.ts"]);
  check("edge-tests", "deno", ["test", "--allow-env", "--allow-read", "supabase/functions"]);
}
check("diff-check", "git", ["diff", "--check"]);
const dotenvAfter = webDotenvSnapshot();
save("web-dotenv-after.json", dotenvAfter);
const webDotenvUnchanged = JSON.stringify(dotenvBefore) === JSON.stringify(dotenvAfter);
const after = source();
save("source-after.json", after);
save("tracked-after.patch", git("diff", "--binary", "HEAD"));
save("status-after.log", git("status", "--porcelain=v1"));
const sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
const headUnchanged = head === git("rev-parse", "HEAD").trim();
const summary = { evidence, head, mode, sourceUnchanged, headUnchanged, webDotenvUnchanged, results };
save("summary.json", summary);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = !sourceUnchanged || !headUnchanged || !webDotenvUnchanged ||
  results.some(result => result.exit !== 0 || result.error || result.signal) ? 1 : 0;
