import { withPaidPlanFixtures, paidPlanFixtureRevisions } from "./paid-plan-fixture-revisions.mjs";
// Exact additive upgrade; reset, source attribution, target checks and cleanup
// remain owned by run-isolated-db-baseline.mjs. Never use against hosted data.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readUploadProbeBody } from "./workspace-upload-transport.mjs";

export const legacyAuditMigration = "20260908150000_legacy_document_audit_binding";
export const legacyAuditMigrationFile = `supabase/migrations/${legacyAuditMigration}.sql`;
export const legacyAuditMigrationSha = "c50026119bda6235692d13adfa78d857427eb544e8358685d8811914ce8ef32a";
export const legacyAuditTestFile = "supabase/tests/legacy_document_audit_binding.test.sql";
export const legacyAuditTestSha = paidPlanFixtureRevisions[legacyAuditTestFile].after;
const baselineSha = "169a29351621721b26af2451cbdfce69aa004e28b263286b495430a53ab7758b";
const sha = value => createHash("sha256").update(value).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const origin = "http://127.0.0.1:58321";
const wrapper = "read_legacy_document_audit_checkpoint_v1";
const policySha = sha("Synthetic reviewed audit-upgrade policy.1");

export function validateLegacyAuditUpgradePlan(manifest, currentSource, baselineBytes = readFileSync(
  new URL("./legacy-audit-upgrade-sql-baseline.json", import.meta.url))) {
  assert.equal(sha(baselineBytes), baselineSha, "Reviewed audit SQL baseline changed");
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.contract_version, "legacy-audit-upgrade-sql.1");
  assert.equal(baseline.source_run, "db-20260908161352471-1eadec09");
  assert.equal(baseline.predecessor, "20260908140000");
  const currentSql = Object.fromEntries(Object.entries(currentSource).filter(([file]) =>
    file.startsWith("supabase/migrations/") || file.startsWith("supabase/tests/")));
  assert.deepEqual(manifest, currentSql, "Audit upgrade must exercise all current SQL");
  const prefixManifest = withPaidPlanFixtures(baseline.manifest);
  const expected = { ...prefixManifest, [legacyAuditMigrationFile]: legacyAuditMigrationSha,
    [legacyAuditTestFile]: legacyAuditTestSha };
  assert.deepEqual(manifest, expected, "Audit upgrade requires the exact reviewed SQL manifest");
  const versions = Object.keys(manifest).filter(file => file.startsWith("supabase/migrations/"))
    .map(file => file.split("/").at(-1).slice(0, 14)).sort();
  assert.equal(versions.length, 79); assert.equal(new Set(versions).size, 79);
  assert.deepEqual(versions.filter(version => version > baseline.predecessor), ["20260908150000"]);
  assert.equal(Object.keys(baseline.manifest).length, 125);
  return { predecessor: baseline.predecessor, forward: "20260908150000", versions,
    prefixManifest, manifest: expected, baselineSha,
    migrationFile: legacyAuditMigrationFile, migrationSha: legacyAuditMigrationSha,
    testFile: legacyAuditTestFile, testSha: legacyAuditTestSha };
}

export function assertLegacyAuditPhase(plan, phase, actualManifest, heldSha) {
  assert.ok(phase === "full" || phase === "predecessor", "Unknown audit SQL phase");
  assert.deepEqual(actualManifest, phase === "full" ? plan.manifest : plan.prefixManifest,
    "Copied SQL differs from the exact audit phase");
  assert.deepEqual(heldSha, phase === "full" ? { migration: null, test: null } :
    { migration: legacyAuditMigrationSha, test: legacyAuditTestSha },
  "Held audit migration/test is missing, changed or present in the wrong phase");
}

// A fixture codec, not a runtime policy: independent Node framing is compared
// with reviewed TS/SQL vectors and with PostgreSQL's actual persisted digest.
const framedSha = fields => sha(fields.map(value => `${Buffer.byteLength(value, "utf8")}:${value}`).join(""));
export function legacyAuditFixture(kind = "quality", sources = ["I was charged $10 twice.", "", "", "", ""]) {
  assert.ok(kind === "quality" || kind === "grounding");
  assert.equal(sources.length, 5); for (const value of sources) assert.equal(typeof value, "string");
  const sections = [{ key: "issue", label: "Issue", content: "I was charged $10 twice." },
    { key: "request", label: "Request", content: "Please review the duplicate charge." }];
  return { sources: [...sources], binding: {
    version: "legacy-document-audit-binding.1", digest_version: "legacy-document-audit-digests.1",
    validator_version: "legacy-wording-assessment.1", unit_policy_version: "legacy-factual-units.2",
    review_kind: kind, round: 0, output_schema_name: `prompted_document_${kind}_audit`,
    output_schema_version: `document-${kind}-audit.1`, evidence_mode: "verbatim",
    source_sha256: framedSha(["legacy-audit-source.1", "5", ...sources]),
    execution_policy_version: "legacy-template-policy.1", execution_policy_sha256: policySha,
    target_sha256: framedSha(["legacy-audit-target.1", String(sections.length),
      ...sections.flatMap(section => [section.key, section.label, section.content])]),
    sections: sections.map(({ key, label, content }) => ({ key, label, content_sha256: sha(content) })),
    units: [{ id: "issue#1", section_key: "issue", content_sha256: sha(sections[0].content) }],
  } };
}

const closed = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};
const ackKeys = ["usage_ledger_id", "model_call_key", "idempotent_replay", "result_id",
  "result_response_sha256", "result_idempotent_replay"];

export async function exerciseLegacyAuditUpgrade({ project, workdir, env, sql, applyMigration, checkTarget, save }) {
  checkTarget();
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(!status.error && !status.signal && status.status === 0, "Disposable audit status failed");
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error("Invalid disposable audit status"); }
  assert.equal(config.API_URL, origin, "Unexpected API origin; no request sent");
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) assert.ok(typeof config[key] === "string" && config[key].length > 20);
  const checks = [];
  async function request(label, path, body, { token = config.SERVICE_ROLE_KEY, expectedError, permissionDenied = false } = {}) {
    checkTarget();
    const url = new URL(path, origin); assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/rpc/"));
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { method: "POST", redirect: "error", signal, cache: "no-store",
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body) });
    const bytes = await readUploadProbeBody(response.body, 256 * 1024, signal);
    let data;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error(`${label}: invalid local JSON response`); }
    const check = { label, path: url.pathname, status: response.status };
    checks.push(check); save("legacy-audit-upgrade-http-checks.json", checks);
    if (permissionDenied) {
      assert.ok([401, 403].includes(response.status), `${label}: expected role rejection`);
      assert.equal(data.code, "42501", `${label}: authentication failure is not permission proof`);
      assert.equal(data.message, `permission denied for function ${wrapper}`);
      check.errorCode = data.code;
    } else if (expectedError) {
      assert.equal(response.status, 400, `${label}: wrong HTTP failure`);
      assert.equal(data.code, "P0001"); assert.equal(data.message, expectedError); check.errorCode = data.message;
    } else assert.equal(response.status, 200, `${label}: unexpected local HTTP status`);
    save("legacy-audit-upgrade-http-checks.json", checks);
    return data;
  }
  const rpc = (label, name, args, options) => request(label, `/rest/v1/rpc/${name}`, args, options);
  const users = [];
  for (const slot of ["a", "b"]) {
    const email = `${project}-audit-${slot}@example.invalid`, password = randomBytes(30).toString("base64url");
    const created = await request(`create audit owner ${slot}`, "/auth/v1/admin/users", { email, password, email_confirm: true });
    assert.match(created.id, uuid);
    const session = await request(`authenticate audit owner ${slot}`, "/auth/v1/token?grant_type=password",
      { email, password }, { token: config.ANON_KEY });
    assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
    assert.ok(typeof session.access_token === "string" && session.access_token.length > 20);
    users.push({ id: created.id, token: session.access_token });
  }
  const [owner, other] = users; assert.notEqual(owner.id, other.id);
  const readJson = (label, query) => JSON.parse(sql(label, query));
  assert.equal(Number(sql("audit-predecessor-wrapper-absent", `select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${literal(wrapper)};`)), 0);
  async function reserve(name, user = owner) {
    const args = { p_user_id: user.id, p_request_id: `audit-upgrade-${name}`, p_route_key: "generate-document",
      p_request_sha256: sha(`${project}/${name}/request`), p_plan: "business", p_monthly_cap: 1000, p_ttl_seconds: 1800,
      p_execution_policy_version: "legacy-template-policy.1", p_execution_policy_sha256: policySha,
      p_legacy_execution_policy_sha256: null };
    const value = await rpc(`reserve ${name}`, "reserve_document_allowance_with_policy", args);
    assert.equal(value.state, "reserved"); assert.equal(value.provider_permitted, true);
    assert.match(value.reservation_id, uuid); assert.match(value.execution_claim_token, uuid);
    assert.equal(value.user_id, user.id); assert.equal(value.request_id, args.p_request_id);
    return { name, args, value, user };
  }
  const oldArgs = (fixture, kind = "quality", allocate = false) => ({ p_user_id: fixture.user.id,
    p_checkpoint_scope: "generate-document", p_origin_reservation_id: fixture.value.reservation_id,
    p_logical_request_id: fixture.args.p_request_id, p_logical_stage_key: `generate-document.${kind}:round-0`,
    p_request_sha256: sha(`${project}/${fixture.name}/${kind}/provider-body`), p_max_attempts: 2,
    p_execution_claim_token: fixture.value.execution_claim_token, p_allocate_attempt: allocate });
  const oldRead = (fixture, allocate = false, kind = "quality", fallback = false) => rpc(
    `old ${fallback ? "fallback " : ""}read ${fixture.name} ${kind} ${allocate}`, fallback ?
      "read_legacy_model_call_checkpoint_with_fallback" : "read_legacy_model_call_checkpoint", oldArgs(fixture, kind, allocate));
  const newArgs = (fixture, { kind = "quality", allocate = false, fallback = false,
    data = legacyAuditFixture(kind) } = {}) => ({ ...oldArgs(fixture, kind, allocate),
    p_audit_binding: data.binding, p_with_fallback: fallback, p_source_snapshot: data.sources });
  const audited = (label, fixture, options = {}, failure) => rpc(label, wrapper, newArgs(fixture, options), failure);
  async function dispatch(fixture, prepared, kind = "quality") {
    const input = oldArgs(fixture, kind);
    const result = await rpc(`mark synthetic dispatch ${fixture.name} ${kind}`, "mark_legacy_model_attempt_dispatched", {
      p_user_id: input.p_user_id, p_checkpoint_scope: input.p_checkpoint_scope,
      p_origin_reservation_id: input.p_origin_reservation_id, p_logical_request_id: input.p_logical_request_id,
      p_logical_stage_key: input.p_logical_stage_key, p_request_sha256: input.p_request_sha256,
      p_attempt_number: prepared.attempt_number, p_attempt_admission_id: prepared.attempt_admission_id,
      p_execution_claim_token: input.p_execution_claim_token, p_dispatch_token: randomUUID(),
    });
    assert.equal(result.state, "dispatched"); assert.equal(result.attempt_admission_id, prepared.attempt_admission_id);
    assert.equal(result.provider_attempt_id, prepared.attempt_admission_id);
  }
  async function record(fixture, prepared, { kind = "quality", failed = false, completed = true } = {}) {
    const input = oldArgs(fixture, kind);
    const structured = kind === "quality" ? { decision: "approve", issues: [] } : { units: [{ unit_id: "issue#1",
      classification: "supported", evidence_quotes: ["I was charged $10 twice."], unsupported_fragments: [] }] };
    const envelope = completed ? { version: "legacy-provider-result.1",
      text: failed ? "malformed review" : JSON.stringify(structured), structured: failed ? null : structured,
      sources: [], route_snapshot: { provider: "openai", semanticRoute: "review", model: "synthetic-audit-model",
        reasoningEffort: "high", routingVersion: "audit-routing.test.1", structuredOutputSchemaVersion: `document-${kind}-audit.1`,
        allowedTools: [], timeoutMs: 90000, maxAttempts: 2, background: false, store: false, fallback: null } } : null;
    const result = await rpc(`record synthetic terminal ${fixture.name} ${kind}`, "record_legacy_model_call_attempt", {
      p_user_id: input.p_user_id, p_logical_request_id: input.p_logical_request_id,
      p_logical_stage_key: input.p_logical_stage_key, p_request_sha256: input.p_request_sha256,
      p_provider_attempt_id: prepared.attempt_admission_id, p_attempt_number: prepared.attempt_number,
      p_attempt_status: failed ? "failed" : "succeeded", p_provider_response_id: completed ? `response-${fixture.name}-${kind}` : null,
      p_provider_status: completed ? "completed" : "http_503",
      p_error_code: failed ? completed ? "OPENAI_INVALID_STRUCTURED_OUTPUT" : "OPENAI_UPSTREAM_ERROR" : null,
      p_input_tokens: completed ? 17 : 0, p_output_tokens: completed ? 9 : 0,
      p_started_at: "2026-09-08T01:00:00Z", p_completed_at: "2026-09-08T01:00:01Z",
      p_model: "synthetic-audit-model", p_routing_version: "audit-routing.test.1", p_semantic_route: "review",
      p_reasoning_effort: "high", p_checkpoint_scope: input.p_checkpoint_scope,
      p_origin_reservation_id: input.p_origin_reservation_id, p_result_envelope: envelope,
      p_execution_claim_token: input.p_execution_claim_token,
    });
    closed(result, ackKeys); assert.match(result.usage_ledger_id, uuid);
    assert.equal(result.model_call_key, sha(`${input.p_logical_stage_key}|${input.p_request_sha256}|${prepared.attempt_admission_id}`));
    assert.equal(result.idempotent_replay, false);
    if (completed) { assert.match(result.result_id, uuid); assert.match(result.result_response_sha256, digest); }
    else { assert.equal(result.result_id, null); assert.equal(result.result_response_sha256, null); }
    return { result, envelope };
  }
  // SQL emits only row identities/counts/digests. Full fixture rows (including
  // claim tokens and envelopes) are hashed inside PostgreSQL, never logged.
  function snapshot(label, fixtures, { omitNew = false, omitLeaseRenewals = false } = {}) {
    const names = fixtures.map(fixture => literal(fixture.args.p_request_id)).join(",");
    const ownerIds = [...new Set(fixtures.map(fixture => fixture.user.id))].map(literal).join(",");
    const tables = [
      ["reservations", "private.document_allowance_reservations", "id", "request_id", ["audit_source_snapshot", "audit_source_sha256", "audit_source_digest_version"]],
      ["claims", "private.legacy_generation_execution_claims", "reservation_id", "logical_request_id", []],
      ["admissions", "private.legacy_model_attempt_admissions", "id", "logical_request_id", ["audit_binding", "audit_binding_sha256"]],
      ["results", "private.legacy_model_call_results", "id", "logical_request_id", []],
      ["allowance_results", "private.document_allowance_results", "reservation_id", "request_id", []],
      ["usage", "public.usage_ledger", "id", "logical_request_id", []],
    ];
    return Object.fromEntries(tables.map(([name, table, id, requestKey, newColumns]) => {
      const omitted = [...(omitNew ? newColumns : []),
        ...(omitLeaseRenewals && ["claims", "admissions"].includes(name) ? ["heartbeat_at", "lease_expires_at"] : [])];
      const projection = omitted.length ? `to_jsonb(r)-array[${omitted.map(literal).join(",")}]` : "to_jsonb(r)";
      const predicate = name === "usage" ? `(r.logical_request_id in (${names}) or r.generation_request_id in (${names}))` :
        `r.${requestKey} in (${names})`;
      const value = readJson(`${label}-${name}`, `select coalesce(jsonb_agg(jsonb_build_object('id',r.${id},
        'sha256',encode(extensions.digest(convert_to((${projection})::text,'UTF8'),'sha256'),'hex')) order by r.${id}),'[]'::jsonb)
        from ${table} r where r.user_id in (${ownerIds}) and ${predicate};`);
      for (const row of value) { assert.match(row.id, uuid); assert.match(row.sha256, digest); }
      return [name, value];
    }));
  }
  async function assertRejectedWithoutMutation(label, fixtures, action) {
    const before = snapshot(`${label}-before`, fixtures);
    await action();
    assert.deepEqual(snapshot(`${label}-after`, fixtures), before, `${label}: rejected command mutated persisted state`);
  }
  function auditRows(label, fixture) {
    return readJson(label, `select jsonb_build_object('source',r.audit_source_snapshot,'source_sha256',r.audit_source_sha256,
      'digest_version',r.audit_source_digest_version,'admissions',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',a.id,'owner',a.user_id,'request',a.logical_request_id,'stage',a.logical_stage_key,
        'reservation',a.origin_reservation_id,'binding',a.audit_binding,'binding_sha256',a.audit_binding_sha256,
        'dispatched',a.dispatched_at is not null) order by a.logical_stage_key),'[]'::jsonb)
        from private.legacy_model_attempt_admissions a where a.user_id=r.user_id and a.logical_request_id=r.request_id))
      from private.document_allowance_reservations r where r.id=${literal(fixture.value.reservation_id)}::uuid
      and r.user_id=${literal(fixture.user.id)}::uuid;`);
  }
  const historical = [];
  for (const name of ["prepared", "dispatched", "success", "malformed", "http-failed", "settled"]) {
    const fixture = await reserve(name); historical.push(fixture);
    if (name === "settled") continue;
    fixture.prepared = await oldRead(fixture, true);
    assert.equal(fixture.prepared.state, "prepared"); assert.equal(fixture.prepared.provider_permitted, true);
    assert.equal(fixture.prepared.attempt_number, 1); assert.match(fixture.prepared.attempt_admission_id, uuid);
    if (name !== "prepared") await dispatch(fixture, fixture.prepared);
    if (["success", "malformed", "http-failed"].includes(name)) {
      fixture.terminal = await record(fixture, fixture.prepared, { failed: name !== "success", completed: name !== "http-failed" });
    }
    fixture.oldReplay = await oldRead(fixture);
    assert.equal(fixture.oldReplay.state, name === "prepared" ? "prepared" : name === "dispatched" ?
      "attempt_unresolved" : name === "http-failed" ? "not_found" : "replay");
    if (["success", "malformed"].includes(name)) {
      assert.deepEqual(fixture.oldReplay.response_envelope, fixture.terminal.envelope);
      assert.equal(fixture.oldReplay.usage.attempt_status, name === "success" ? "succeeded" : "failed");
    }
  }
  const settled = historical.at(-1);
  const payload = { contract_version: "allowance-result.1", route_key: "generate-document", transport: "sse",
    payload: { events: [{ type: "section", key: "original", label: "Original", content: "Preserved synthetic historical wording." }] } };
  const settledAck = await rpc("settle old allowance result", "settle_document_allowance_with_result", {
    p_user_id: owner.id, p_reservation_id: settled.value.reservation_id, p_request_id: settled.args.p_request_id,
    p_task: "document", p_provider: "openai", p_input_tokens: 17, p_output_tokens: 9, p_response_payload: payload });
  assert.equal(settledAck.state, "settled"); assert.equal(settledAck.reservation_id, settled.value.reservation_id);
  const before = snapshot("audit-history-before-migration", historical);
  assert.equal(before.reservations.length, 6); assert.equal(before.claims.length, 6);
  assert.equal(before.admissions.length, 5); assert.equal(before.results.length, 2);
  assert.equal(before.allowance_results.length, 1); assert.equal(before.usage.length, 4);
  // Positively prove each token belongs to the accepted reservation without
  // inserting a reusable token into a logged SQL command or response.
  for (const fixture of historical) {
    assert.equal(sql(`audit-claim-link-${fixture.name}`, `select count(*) from private.legacy_generation_execution_claims c
      where c.reservation_id=${literal(fixture.value.reservation_id)}::uuid and c.user_id=${literal(owner.id)}::uuid
      and c.logical_request_id=${literal(fixture.args.p_request_id)} and c.checkpoint_scope='generate-document'
      and encode(extensions.digest(convert_to(c.claim_token::text,'UTF8'),'sha256'),'hex')=${literal(sha(fixture.value.execution_claim_token))};`).trim(), "1");
  }
  save("legacy-audit-history-before.json", before);
  await applyMigration();
  assert.deepEqual(snapshot("audit-history-after-migration", historical, { omitNew: true }), before,
    "Additive audit migration changed an existing persisted column");
  for (const fixture of historical) {
    const rows = auditRows(`audit-history-null-${fixture.name}`, fixture);
    assert.equal(rows.source, null); assert.equal(rows.source_sha256, null); assert.equal(rows.digest_version, null);
    for (const admission of rows.admissions) { assert.equal(admission.binding, null); assert.equal(admission.binding_sha256, null); }
  }
  // Successful legacy readers intentionally renew only claim/admission leases.
  // Migration equality above includes every old column; this separate check
  // permits those two documented heartbeat fields only during authorized reads.
  const immutableBefore = snapshot("audit-history-before-legacy-reads", historical, { omitLeaseRenewals: true });
  for (const fixture of historical.slice(0, -1)) {
    assert.equal(sha(JSON.stringify(await oldRead(fixture))), sha(JSON.stringify(fixture.oldReplay)),
      "Old checkpoint replay changed its literal payload");
    if (["success", "malformed"].includes(fixture.name)) {
      const fallback = await oldRead(fixture, false, "quality", true);
      assert.equal(fallback.state, "replay"); assert.deepEqual(fallback.response_envelope, fixture.terminal.envelope);
    }
  }
  const settledRead = await rpc("old settled allowance literal read", "read_document_allowance_replay", {
    p_user_id: owner.id, p_request_id: settled.args.p_request_id, p_route_key: "generate-document",
    p_request_sha256: settled.args.p_request_sha256 });
  assert.equal(settledRead.state, "settled"); assert.deepEqual(settledRead.replay_result, payload);
  assert.deepEqual(snapshot("audit-history-after-legacy-reads", historical, { omitLeaseRenewals: true }), immutableBefore);
  for (const fixture of historical.filter(value => ["dispatched", "success", "malformed", "http-failed"].includes(value.name))) {
    await assertRejectedWithoutMutation(`audit-reject-old-${fixture.name}`, historical, () => audited(
      `historical ${fixture.name} cannot acquire audit proof`, fixture, { allocate: true },
      { expectedError: "LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED" }));
  }
  const prepared = historical[0];
  const probe = await audited("nonallocating old preparation remains unbound", prepared);
  closed(probe, ["contract_version", "checkpoint", "audit_binding", "audit_binding_sha256"]);
  assert.equal(sha(JSON.stringify(probe.checkpoint)), sha(JSON.stringify(prepared.oldReplay)));
  assert.equal(probe.audit_binding, null); assert.equal(probe.audit_binding_sha256, null);
  const untouched = auditRows("audit-safe-probe-stored-null", prepared);
  assert.equal(untouched.source, null); assert.equal(untouched.admissions.length, 1);
  assert.equal(untouched.admissions[0].binding, null); assert.equal(untouched.admissions[0].id, prepared.prepared.attempt_admission_id);
  const adopted = await audited("allocate safely binds the original undispatched admission", prepared, { allocate: true });
  assert.equal(adopted.checkpoint.attempt_admission_id, prepared.prepared.attempt_admission_id);
  assert.deepEqual(adopted.audit_binding, legacyAuditFixture().binding); assert.match(adopted.audit_binding_sha256, digest);

  const fresh = await reserve("fresh-pair"), otherFresh = await reserve("other-owner", other);
  const all = [...historical, fresh, otherFresh];
  const accepted = new Map();
  for (const kind of ["quality", "grounding"]) {
    const value = await audited(`fresh ${kind} admission`, fresh, { kind, allocate: true });
    closed(value, ["contract_version", "checkpoint", "audit_binding", "audit_binding_sha256"]);
    assert.equal(value.contract_version, "legacy-document-audit-checkpoint.1");
    assert.equal(value.checkpoint.state, "prepared"); assert.equal(value.checkpoint.provider_permitted, true);
    assert.equal(value.checkpoint.attempt_number, 1); assert.match(value.checkpoint.attempt_admission_id, uuid);
    assert.deepEqual(value.audit_binding, legacyAuditFixture(kind).binding); assert.match(value.audit_binding_sha256, digest);
    accepted.set(kind, value);
  }
  assert.notEqual(accepted.get("quality").checkpoint.attempt_admission_id, accepted.get("grounding").checkpoint.attempt_admission_id);
  assert.notEqual(accepted.get("quality").audit_binding_sha256, accepted.get("grounding").audit_binding_sha256);
  const rows = auditRows("audit-fresh-independent-sql", fresh);
  assert.deepEqual(rows.source, legacyAuditFixture().sources); assert.equal(rows.source_sha256, legacyAuditFixture().binding.source_sha256);
  assert.equal(rows.digest_version, "legacy-document-audit-digests.1"); assert.equal(rows.admissions.length, 2);
  for (const [kind, value] of accepted) {
    const row = rows.admissions.find(candidate => candidate.id === value.checkpoint.attempt_admission_id);
    assert.ok(row); assert.equal(row.owner, owner.id); assert.equal(row.request, fresh.args.p_request_id);
    assert.equal(row.reservation, fresh.value.reservation_id); assert.equal(row.stage, `generate-document.${kind}:round-0`);
    assert.deepEqual(row.binding, value.audit_binding); assert.equal(row.binding_sha256, value.audit_binding_sha256); assert.equal(row.dispatched, false);
  }
  const otherAccepted = await audited("second authenticated owner's positive service admission", otherFresh, { allocate: true });
  assert.equal(otherAccepted.checkpoint.state, "prepared");
  assert.equal(auditRows("audit-other-independent-sql", otherFresh).admissions[0].owner, other.id);

  const changeSource = legacyAuditFixture("quality", ["I was charged $20 twice.", "", "", "", ""]);
  const changeTarget = legacyAuditFixture(); changeTarget.binding.target_sha256 = sha("changed reviewed wording");
  const changePolicy = legacyAuditFixture(); changePolicy.binding.execution_policy_sha256 = sha("different accepted policy");
  const wrongSource = legacyAuditFixture(); wrongSource.sources[0] = "Different source without matching commitment.";
  const malformed = legacyAuditFixture(); malformed.binding.unexpected_policy = "untrusted";
  for (const [label, options, argsOverride, expectedError] of [
    ["malformed metadata", { data: malformed }, {}, "LEGACY_DOCUMENT_AUDIT_BINDING_INVALID"],
    ["source conflict", { data: changeSource }, {}, "LEGACY_DOCUMENT_AUDIT_SOURCE_CONFLICT"],
    ["target conflict", { data: changeTarget }, {}, "LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT"],
    ["policy conflict", { data: changePolicy }, {}, "LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT"],
    ["source digest mismatch", { data: wrongSource }, {}, "LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID"],
    ["other service owner", {}, { p_user_id: other.id }, "LEGACY_MODEL_RESULT_RESERVATION_INVALID"],
  ]) await assertRejectedWithoutMutation(`audit-${label.replaceAll(" ", "-")}`, all, () => rpc(label, wrapper,
    { ...newArgs(fresh, { allocate: true, ...options }), ...argsOverride }, { expectedError }));
  for (const [role, token] of [["owner browser", owner.token], ["other owner browser", other.token], ["anonymous", config.ANON_KEY]]) {
    await assertRejectedWithoutMutation(`audit-denied-${role.replaceAll(" ", "-")}`, all, () => rpc(
      `${role} cannot invoke service audit command`, wrapper, newArgs(fresh, { allocate: true }), { token, permissionDenied: true }));
  }
  for (const [kind, admission] of accepted) {
    await dispatch(fresh, admission.checkpoint, kind);
    const terminal = await record(fresh, admission.checkpoint, { kind });
    const replay = await audited(`fresh ${kind} exact terminal replay`, fresh, { kind });
    assert.equal(replay.checkpoint.state, "replay"); assert.equal(replay.checkpoint.usage.attempt_status, "succeeded");
    assert.equal(replay.checkpoint.usage.provider_attempt_id, admission.checkpoint.attempt_admission_id);
    assert.equal(replay.checkpoint.response_sha256, terminal.result.result_response_sha256);
    assert.deepEqual(replay.checkpoint.response_envelope, terminal.envelope);
    assert.deepEqual(replay.audit_binding, admission.audit_binding); assert.equal(replay.audit_binding_sha256, admission.audit_binding_sha256);
    assert.deepEqual((await audited(`repeat ${kind} replay`, fresh, { kind })).checkpoint, replay.checkpoint);
    assert.deepEqual((await audited(`fallback-aware ${kind} replay`, fresh, { kind, fallback: true })).audit_binding, admission.audit_binding);
  }
  const final = snapshot("audit-fresh-final", [fresh]);
  assert.equal(final.reservations.length, 1); assert.equal(final.admissions.length, 2);
  assert.equal(final.results.length, 2); assert.equal(final.usage.length, 2); assert.equal(final.allowance_results.length, 0);
  save("legacy-audit-upgrade-summary.json", { contract_version: "legacy-audit-upgrade-acceptance.1", project,
    predecessor: "20260908140000", forward: "20260908150000", owners: users.map(value => value.id),
    historicalCounts: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value.length])),
    historicalColumnProjectionPreserved: true, historicalReplayPreserved: true, historicalRelabellingRejected: true,
    fresh: { reservationId: fresh.value.reservation_id, requestId: fresh.args.p_request_id,
      sourceSha256: rows.source_sha256, admissions: rows.admissions.map(row => ({ id: row.id, stage: row.stage, bindingSha256: row.binding_sha256 })) },
    independentSqlRead: true, actualProviderCalled: false, approvedWordingOrWorkspaceAttachmentProven: false,
    httpChecks: checks.length, finalRowHashes: final });
  return { historicalFixtures: historical.length, pairedAdmissions: 2, httpChecks: checks.length };
}
