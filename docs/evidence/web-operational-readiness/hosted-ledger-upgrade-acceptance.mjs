// Rehearse the observed production migration ledger in the existing disposable
// runner. This does not approve a hosted migration or relax release preflight.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readUploadProbeBody } from "./workspace-upload-transport.mjs";

const baselineSha = "512ec9a63dea20b6e4808b3cb465e2e60a50357b3893194b4c5a9fc5acf375f0";
const sha = value => createHash("sha256").update(value).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const origin = "http://127.0.0.1:58321";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateHostedLedgerUpgradePlan(manifest, source, bytes = readFileSync(
  new URL("./hosted-ledger-upgrade-baseline.json", import.meta.url))) {
  assert.equal(sha(bytes), baselineSha, "Observed hosted-ledger baseline changed");
  const baseline = JSON.parse(bytes);
  assert.equal(baseline.contract_version, "hosted-ledger-upgrade-rehearsal.1");
  assert.equal(baseline.project_ref, "jjsykocqpjlekgsbylkd");
  const current = Object.fromEntries(Object.entries(source).filter(([file]) =>
    file.startsWith("supabase/migrations/") || file.startsWith("supabase/tests/")));
  assert.deepEqual(manifest, current, "Rehearsal must exercise all current SQL");
  assert.deepEqual(manifest, baseline.manifest, "Rehearsal requires the exact reviewed SQL manifest");
  const migrations = Object.keys(manifest).filter(file => file.startsWith("supabase/migrations/")).sort();
  const versions = migrations.map(file => file.split("/").at(-1).slice(0, 14));
  assert.equal(versions.length, 81); assert.equal(new Set(versions).size, 81);
  const hostedVersions = baseline.hosted_versions;
  assert.equal(hostedVersions.length, 68); assert.equal(new Set(hostedVersions).size, 68);
  assert.deepEqual(hostedVersions, versions.filter(version => hostedVersions.includes(version)));
  assert.equal(hostedVersions.at(-1), "20260906010846");
  const pendingFiles = migrations.filter(file => !hostedVersions.includes(file.split("/").at(-1).slice(0, 14)));
  assert.equal(pendingFiles.length, 13);
  assert.deepEqual(pendingFiles.filter(file => file.split("/").at(-1).slice(0, 14) < hostedVersions.at(-1)),
    ["supabase/migrations/20260906000500_captured_exact_wording_assessment.sql"]);
  const historicalManifest = Object.fromEntries(Object.entries(manifest).filter(([file]) => !pendingFiles.includes(file)));
  return { baselineSha, versions, hostedVersions, pendingFiles, manifest, historicalManifest };
}

export function assertHostedLedgerPhase(plan, phase, actualManifest, held) {
  assert.ok(phase === "full" || phase === "historical", "Unknown hosted rehearsal phase");
  assert.deepEqual(actualManifest, phase === "full" ? plan.manifest : plan.historicalManifest,
    "Copied SQL differs from the exact hosted rehearsal phase");
  assert.deepEqual(held, phase === "full" ? {} : Object.fromEntries(
    plan.pendingFiles.map(file => [file, plan.manifest[file]])), "Held migrations changed");
}

export function assertHistoricalRowsPreserved(before, after) {
  assert.ok(Array.isArray(before) && before.length > 0, "Positive historical rows are required");
  assert.ok(Array.isArray(after));
  assert.deepEqual(after.map(row => row.id), before.map(row => row.id), "Historical row identities changed");
  for (let index = 0; index < before.length; index++) {
    // Additive columns may appear. Every field that existed before the upgrade
    // must retain its exact value, including null, whitespace and provenance.
    assert.deepEqual(Object.fromEntries(Object.keys(before[index]).map(key => [key, after[index][key]])), before[index],
      "Historical wording, provenance, identity or receipt changed");
  }
}

export async function exerciseHostedLedgerUpgrade({ project, workdir, env, sql, applyMigration, checkTarget, save }) {
  checkTarget(); assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(!status.error && !status.signal && status.status === 0, "Disposable status failed");
  const config = JSON.parse(status.stdout);
  assert.equal(config.API_URL, origin, "Unexpected target; no request sent");
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) assert.ok(typeof config[key] === "string" && config[key].length > 20);
  const checks = [];
  async function request(label, path, { token = config.SERVICE_ROLE_KEY, body, method = "GET", expected = 200,
    raw = false, contentType = "application/json" } = {}) {
    checkTarget(); const url = new URL(path, origin); assert.equal(url.origin, origin);
    assert.ok(["/auth/v1/", "/rest/v1/", "/storage/v1/"].some(prefix => url.pathname.startsWith(prefix)));
    const signal = AbortSignal.timeout(15000);
    const response = await fetch(url, { method, redirect: "error", signal, cache: "no-store",
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, "content-type": contentType,
        prefer: "return=representation" }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
    const bytes = await readUploadProbeBody(response.body, 2 * 1024 * 1024, signal);
    checks.push({ label, method, path: url.pathname, status: response.status });
    save("hosted-ledger-http-checks.json", checks);
    assert.equal(response.status, expected, `${label}: unexpected HTTP status`);
    return raw ? bytes : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  const original = readFileSync(new URL("../../../supabase/functions/extract-upload/fixtures/source-preservation.docx", import.meta.url));
  const users = [];
  for (const slot of ["a", "b"]) {
    const email = `${project}-hosted-history-${slot}@example.invalid`, password = randomBytes(30).toString("base64url");
    const created = await request(`create owner ${slot}`, "/auth/v1/admin/users", {
      method: "POST", body: { email, password, email_confirm: true } });
    assert.match(created.id, uuid);
    const session = await request(`authenticate owner ${slot}`, "/auth/v1/token?grant_type=password", {
      method: "POST", token: config.ANON_KEY, body: { email, password } });
    assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
    assert.ok(typeof session.access_token === "string" && session.access_token.length > 20);
    users.push({ id: created.id, token: session.access_token });
  }
  assert.notEqual(users[0].id, users[1].id);
  const ids = users.map(user => literal(user.id)).join(",");
  const tables = ["public.outcomes", "public.documents", "public.sections", "public.uploads", "private.legacy_workspace_save_receipts"];
  const snapshot = label => Object.fromEntries(tables.map((table, index) => [table, JSON.parse(sql(`${label}-${index}`,
    `select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from ${table} r where r.user_id in (${ids});`))]));
  const fixtures = [];
  for (const [index, user] of users.entries()) {
    const outcomeId = randomUUID(), documentId = randomUUID(), uploadId = randomUUID();
    const outcomes = await request(`owner ${index} creates outcome`, "/rest/v1/outcomes", { method: "POST", token: user.token,
      expected: 201, body: { id: outcomeId, user_id: user.id, situation_text: "Synthetic historical preservation fixture.",
        recommendation_payload: { primary: { template_id: "bespoke", reason: "Synthetic fixture" }, alternatives: [] },
        status: "in_progress", is_saved: true } });
    assert.equal(outcomes.length, 1); assert.equal(outcomes[0].id, outcomeId);
    const args = { p_idempotency_key: `hosted-history:${index}:create`, p_outcome_id: outcomeId, p_document_id: documentId,
      p_expected_document_revision: 0, p_expected_document: null,
      p_document: { title: `Historical document ${index}`, status: "draft", template_id: null, unresolved_placeholders: [] },
      p_sections: ["Original wording", "Protected sibling"].map((name, order_index) => ({ id: randomUUID(), expected: null,
        desired: { name, order_index, status: "draft", is_required: order_index === 0 },
        content: order_index === 0 ? "Original café wording.\nSecond paragraph." : "  Preserve the exact sibling.\n\n• Original list.  " })) };
    const receipt = await request(`owner ${index} creates workspace`, "/rest/v1/rpc/save_own_legacy_workspace_v1", {
      method: "POST", token: user.token, body: args });
    assert.equal(receipt.contract_version, "legacy-workspace-save.v1"); assert.equal(receipt.document_id, documentId);
    assert.equal(receipt.idempotent_replay, false); assert.equal(receipt.sections.length, 2);
    const owned = await request(`owner ${index} reads workspace before upgrade`, `/rest/v1/documents?id=eq.${documentId}&select=id,user_id`, { token: user.token });
    assert.deepEqual(owned, [{ id: documentId, user_id: user.id }]);
    const storagePath = `${user.id}/${uploadId}/original.docx`;
    await request(`retain original ${index}`, `/storage/v1/object/original-documents/${storagePath}`, {
      method: "POST", raw: true, body: original, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    sql(`historical-upload-${index}`, `insert into public.uploads(id,user_id,outcome_id,storage_path,file_name,file_type,file_size_bytes,extracted_text,status)
      values (${literal(uploadId)}::uuid,${literal(user.id)}::uuid,${literal(outcomeId)}::uuid,${literal(storagePath)},'original.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',${original.length},E'  Original preview\\nSecond line.  ','ready');`);
    const bytes = await request(`owner ${index} reads original before upgrade`, `/storage/v1/object/authenticated/original-documents/${storagePath}`, { token: user.token, raw: true });
    assert.equal(sha(bytes), sha(original));
    fixtures.push({ user, outcomeId, documentId, uploadId, storagePath, args, receipt });
  }
  const before = snapshot("hosted-history-before");
  for (const table of tables) assert.ok(before[table].length >= 2, `${table}: positive fixtures required`);
  assert.equal(before["public.sections"].length, 4);
  applyMigration();
  const after = snapshot("hosted-history-after");
  for (const table of tables) assertHistoricalRowsPreserved(before[table], after[table]);
  for (const [index, fixture] of fixtures.entries()) {
    const { user, documentId, storagePath, args, receipt } = fixture;
    const replay = await request(`owner ${index} replays historical receipt`, "/rest/v1/rpc/save_own_legacy_workspace_v1", {
      method: "POST", token: user.token, body: args });
    assert.deepEqual(replay, { ...receipt, idempotent_replay: true });
    const owned = await request(`owner ${index} reads upgraded document`, `/rest/v1/documents?id=eq.${documentId}&select=id,user_id`, { token: user.token });
    assert.deepEqual(owned, [{ id: documentId, user_id: user.id }]);
    const denied = await request(`other owner cannot read document ${index}`, `/rest/v1/documents?id=eq.${documentId}&select=id,user_id`, { token: users[1-index].token });
    assert.deepEqual(denied, []);
    const bytes = await request(`owner ${index} reads original after upgrade`, `/storage/v1/object/authenticated/original-documents/${storagePath}`, { token: user.token, raw: true });
    assert.equal(sha(bytes), sha(original));
  }
  const afterReplay = snapshot("hosted-history-after-replay");
  for (const table of tables) assertHistoricalRowsPreserved(after[table], afterReplay[table]);
  save("hosted-ledger-preservation.json", { passed: true, users: users.map(user => user.id),
    fixtureIds: fixtures.map(({ outcomeId, documentId, uploadId }) => ({ outcomeId, documentId, uploadId })),
    rowCounts: Object.fromEntries(tables.map(table => [table, before[table].length])),
    originalSha256: sha(original), originalCount: 2, originalBytesPreserved: true, receiptsReplayed: 2,
    providerCalled: false, hostedMutation: false, limits: "Local rehearsal of the observed version ledger using reviewed repository SQL; does not establish hosted schema-byte equivalence, production acceptance or format-preserving editing." });
}
