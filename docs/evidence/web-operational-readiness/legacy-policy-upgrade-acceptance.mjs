// Exact additive policy-binding upgrade in the existing disposable DB runner.
// The runner owns reset, migration application, target attestation and cleanup.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readUploadProbeBody } from "./workspace-upload-transport.mjs";

export const legacyPolicyMigration = "20260908130000_legacy_generation_policy_binding";
const predecessor = "20260907124000";
const forward = "20260908130000";
const predecessorFile = "supabase/migrations/20260907124000_workspace_upload_reads.sql";
const predecessorSha = "3fca86b80b086b730f8546eee19b412e7012138cad929425089b9558ec18f997";
const regressionFile = "supabase/tests/legacy_generation_policy_binding.test.sql";

export function validateLegacyPolicyUpgradePlan(manifest, currentSource) {
  const currentSql = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => file.startsWith("supabase/migrations/") || file.startsWith("supabase/tests/")));
  assert.deepEqual(manifest, currentSql, "Legacy policy upgrade must exercise all current SQL");
  const versions = [];
  for (const [file, digest] of Object.entries(manifest)) {
    assert.match(file, /^supabase\/(?:migrations|tests)\/[^/]+\.sql$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (file.startsWith("supabase/migrations/")) {
      assert.match(file, /^supabase\/migrations\/\d{14}_[^/]+\.sql$/);
      versions.push(file.split("/").at(-1).slice(0, 14));
    }
  }
  versions.sort();
  assert.equal(new Set(versions).size, versions.length, "Duplicate migration version");
  assert.equal(manifest[predecessorFile], predecessorSha, "Reviewed policy predecessor changed");
  assert.deepEqual(versions.filter(version => version > predecessor), [forward],
    "Legacy policy permits exactly its reviewed forward migration");
  assert.ok(manifest[`supabase/migrations/${legacyPolicyMigration}.sql`], "Missing policy-binding migration");
  assert.ok(manifest[regressionFile], "Missing policy-binding SQL regression");
  return { predecessor, forward, versions };
}

const origin = "http://127.0.0.1:58321";
const policyVersion = "legacy-template-policy.1";
const sha = value => createHash("sha256").update(value).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const readKeys = ["contract_version", "user_id", "request_id", "route_key", "request_sha256", "state",
  "reservation_id", "reservation_status", "expires_at", "execution_policy_version", "execution_policy_sha256",
  "has_prior_provider_work", "reconciliation_required", "replay_result"];
const reserveKeys = ["contract_version", "user_id", "request_id", "route_key", "request_sha256", "reservation_id",
  "expires_at", "state", "provider_permitted", "execution_claim_token", "execution_policy_version",
  "execution_policy_sha256", "replay_result"];
const closed = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};

export async function exerciseLegacyPolicyUpgrade({ project, workdir, env, sql, applyMigration, checkTarget, save }) {
  checkTarget();
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  // Keep credential-bearing local status and Auth responses in memory only.
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(status.status, 0, "Disposable policy-upgrade status failed");
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error("Invalid disposable policy-upgrade status"); }
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
    const raw = await readUploadProbeBody(response.body, 128 * 1024, signal);
    let data;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch { throw new Error(`${label}: invalid local JSON response`); }
    const check = { label, path: url.pathname, status: response.status };
    checks.push(check); save("legacy-policy-upgrade-http-checks.json", checks);
    if (permissionDenied) {
      assert.ok([401, 403].includes(response.status), `${label}: expected role rejection`);
      assert.equal(data.code, "42501", `${label}: invalid credentials are not permission-denial proof`);
      assert.ok(data.message.startsWith("permission denied for function "), `${label}: unexpected permission failure`);
      check.errorCode = data.code;
    } else if (expectedError) {
      assert.equal(response.status, 400, `${label}: expected exact SQL boundary failure`);
      assert.equal(data.code, "P0001"); assert.equal(data.message, expectedError);
      check.errorCode = data.message;
    } else assert.equal(response.status, 200, `${label}: unexpected local HTTP status`);
    save("legacy-policy-upgrade-http-checks.json", checks);
    return data;
  }
  const rpc = (label, name, body, options) => request(label, `/rest/v1/rpc/${name}`, body, options);
  const users = [];
  for (const slot of ["a", "b"]) {
    const email = `${project}-policy-${slot}@example.invalid`;
    const password = randomBytes(30).toString("base64url");
    const created = await request(`create synthetic owner ${slot}`, "/auth/v1/admin/users", { email, password, email_confirm: true });
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    const session = await request(`authenticate synthetic owner ${slot}`, "/auth/v1/token?grant_type=password",
      { email, password }, { token: config.ANON_KEY });
    assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
    assert.ok(typeof session.access_token === "string" && session.access_token.length > 20);
    users.push({ id: created.id, token: session.access_token });
  }
  const [owner, other] = users; assert.notEqual(owner.id, other.id);
  assert.equal(Number(sql("legacy-policy-predecessor-function-absent", `select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('read_document_allowance_replay','reserve_document_allowance_with_policy');`)), 0);
  const base = requestId => ({ p_user_id: owner.id, p_request_id: requestId, p_route_key: "generate-document",
    p_request_sha256: sha(`${project}/${requestId}/accepted-body`), p_plan: "pro", p_monthly_cap: 20, p_ttl_seconds: 1800 });
  const legacySettled = base("historical-settled");
  const legacyPending = base("historical-pending");
  const historicalPayload = { contract_version: "allowance-result.1", route_key: "generate-document", transport: "sse",
    payload: { events: [{ type: "section", key: "legacy", label: "Original", content: "Synthetic wording." }] } };
  const reserved = await rpc("reserve predecessor settled fixture", "reserve_document_allowance_with_result", legacySettled);
  assert.equal(reserved.state, "reserved"); assert.equal(reserved.provider_permitted, true);
  assert.match(reserved.reservation_id, /^[0-9a-f-]{36}$/);
  const settleArgs = { p_user_id: owner.id, p_reservation_id: reserved.reservation_id,
    p_request_id: legacySettled.p_request_id, p_task: "document", p_provider: "openai",
    p_input_tokens: 10, p_output_tokens: 5, p_response_payload: historicalPayload };
  const settled = await rpc("settle predecessor exact receipt", "settle_document_allowance_with_result", settleArgs);
  assert.equal(settled.state, "settled"); assert.equal(settled.reservation_id, reserved.reservation_id);
  const pending = await rpc("reserve predecessor pending fixture", "reserve_document_allowance_with_result", legacyPending);
  assert.equal(pending.state, "reserved"); assert.equal(pending.provider_permitted, true);
  assert.notEqual(pending.reservation_id, reserved.reservation_id);
  const requestIds = [legacySettled.p_request_id, legacyPending.p_request_id];
  const snapshot = (label, ids = requestIds, omitNewColumns = false) => JSON.parse(sql(label, `select jsonb_build_object(
    'reservations',(select coalesce(jsonb_agg(${omitNewColumns ? "to_jsonb(r)-array['execution_policy_version','execution_policy_sha256']" : "to_jsonb(r)"} order by r.id),'[]'::jsonb)
      from private.document_allowance_reservations r where r.user_id=${literal(owner.id)}::uuid and r.request_id in (${ids.map(literal).join(",")})),
    'results',(select coalesce(jsonb_agg(to_jsonb(r) order by r.reservation_id),'[]'::jsonb)
      from private.document_allowance_results r where r.user_id=${literal(owner.id)}::uuid and r.request_id in (${ids.map(literal).join(",")})),
    'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.reservation_id),'[]'::jsonb)
      from private.legacy_generation_execution_claims c where c.user_id=${literal(owner.id)}::uuid and c.logical_request_id in (${ids.map(literal).join(",")})),
    'usage',(select coalesce(jsonb_agg(to_jsonb(u) order by u.id),'[]'::jsonb)
      from public.usage_ledger u where u.user_id=${literal(owner.id)}::uuid and u.generation_request_id in (${ids.map(literal).join(",")}))
  );`));
  const before = snapshot("legacy-policy-history-before", requestIds, true);
  assert.equal(before.reservations.length, 2); assert.equal(before.results.length, 1); assert.equal(before.usage.length, 1);
  assert.equal(before.claims.length, 2);
  for (const [input, reservation] of [[legacySettled, reserved], [legacyPending, pending]]) {
    const claim = before.claims.find(value => value.reservation_id === reservation.reservation_id);
    assert.ok(claim, "Missing positively created historical execution claim");
    assert.equal(claim.user_id, owner.id); assert.equal(claim.logical_request_id, input.p_request_id);
    assert.equal(claim.checkpoint_scope, input.p_route_key); assert.equal(claim.claim_token, reservation.execution_claim_token);
  }
  assert.deepEqual(before.results[0].response_payload, historicalPayload);
  save("legacy-policy-history-before.json", before);
  await applyMigration();
  assert.deepEqual(snapshot("legacy-policy-history-after-migration", requestIds, true), before,
    "Additive policy migration changed historical reservation/result/claim/usage state");
  const after = snapshot("legacy-policy-history-with-null-policy");
  for (const row of after.reservations) {
    assert.equal(row.execution_policy_version, null); assert.equal(row.execution_policy_sha256, null);
  }
  const readArgs = input => Object.fromEntries(["p_user_id", "p_request_id", "p_route_key", "p_request_sha256"].map(key => [key, input[key]]));
  async function read(label, input) {
    const result = await rpc(label, "read_document_allowance_replay", readArgs(input));
    closed(result, readKeys); assert.equal(result.contract_version, "allowance-replay.1");
    for (const name of ["user_id", "request_id", "route_key", "request_sha256"]) assert.equal(result[name], input[`p_${name}`]);
    assert.equal(typeof result.has_prior_provider_work, "boolean"); assert.equal(typeof result.reconciliation_required, "boolean");
    return result;
  }
  const historicalReplay = await read("read exact historical settled receipt", legacySettled);
  assert.equal(historicalReplay.state, "settled"); assert.equal(historicalReplay.reservation_id, reserved.reservation_id);
  assert.equal(historicalReplay.reservation_status, "settled"); assert.deepEqual(historicalReplay.replay_result, historicalPayload);
  assert.equal(historicalReplay.execution_policy_version, null); assert.equal(historicalReplay.execution_policy_sha256, null);
  assert.deepEqual(await read("repeat exact historical receipt read", legacySettled), historicalReplay);
  const historicalPending = await read("read historical pending state", legacyPending);
  assert.equal(historicalPending.state, "unsettled"); assert.equal(historicalPending.reservation_id, pending.reservation_id);
  assert.equal(historicalPending.execution_policy_version, null); assert.equal(historicalPending.execution_policy_sha256, null);
  assert.equal(historicalPending.replay_result, null);
  const legacyReplay = await rpc("legacy settled caller retains receipt", "reserve_document_allowance_with_result", legacySettled);
  assert.equal(legacyReplay.state, "settled"); assert.equal(legacyReplay.provider_permitted, false);
  assert.deepEqual(legacyReplay.replay_result, historicalPayload);
  assert.deepEqual(snapshot("legacy-policy-history-after-reads", requestIds, true), before, "Reading history mutated it");

  const fresh = { ...base("policy-bound-retry"), p_execution_policy_version: policyVersion,
    p_execution_policy_sha256: sha(`${project}/reviewed-server-policy`), p_legacy_execution_policy_sha256: null };
  async function reserve(label, input) {
    const result = await rpc(label, "reserve_document_allowance_with_policy", input);
    closed(result, reserveKeys); assert.equal(result.contract_version, "allowance-policy-reservation.1");
    for (const name of ["user_id", "request_id", "route_key", "request_sha256", "execution_policy_version", "execution_policy_sha256"]) {
      assert.equal(result[name], input[`p_${name}`]);
    }
    return result;
  }
  const accepted = await reserve("accept one fresh policy-bound request", fresh);
  assert.equal(accepted.state, "reserved"); assert.equal(accepted.provider_permitted, true);
  assert.match(accepted.reservation_id, /^[0-9a-f-]{36}$/); assert.match(accepted.execution_claim_token, /^[0-9a-f-]{36}$/);
  const newIds = [fresh.p_request_id];
  const acceptedState = snapshot("legacy-policy-bound-state-before-retry", newIds);
  assert.equal(acceptedState.reservations.length, 1); assert.equal(acceptedState.results.length, 0); assert.equal(acceptedState.usage.length, 0);
  assert.equal(acceptedState.claims.length, 1);
  assert.equal(acceptedState.claims[0].reservation_id, accepted.reservation_id);
  assert.equal(acceptedState.claims[0].user_id, owner.id);
  assert.equal(acceptedState.claims[0].logical_request_id, fresh.p_request_id);
  assert.equal(acceptedState.claims[0].claim_token, accepted.execution_claim_token);
  assert.equal(acceptedState.reservations[0].id, accepted.reservation_id);
  assert.equal(acceptedState.reservations[0].execution_policy_version, policyVersion);
  assert.equal(acceptedState.reservations[0].execution_policy_sha256, fresh.p_execution_policy_sha256);
  const retry = await reserve("retry accepted request through a new RPC call", fresh);
  assert.equal(retry.reservation_id, accepted.reservation_id); assert.equal(retry.provider_permitted, false);
  assert.equal(retry.state, "reserved");
  const freshRead = await read("read durable interrupted policy request", fresh);
  assert.equal(freshRead.reservation_id, accepted.reservation_id); assert.equal(freshRead.state, "unsettled");
  assert.equal(freshRead.execution_policy_version, policyVersion); assert.equal(freshRead.execution_policy_sha256, fresh.p_execution_policy_sha256);
  assert.equal(freshRead.has_prior_provider_work, false); assert.equal(freshRead.reconciliation_required, false);
  assert.equal(freshRead.replay_result, null);
  const otherRead = await read("other owner cannot read the first owner's receipt", { ...fresh, p_user_id: other.id });
  assert.equal(otherRead.state, "absent"); assert.equal(otherRead.reservation_id, null); assert.equal(otherRead.replay_result, null);
  assert.equal(otherRead.execution_policy_version, null); assert.equal(otherRead.execution_policy_sha256, null);
  assert.equal(otherRead.has_prior_provider_work, false); assert.equal(otherRead.reconciliation_required, false);
  assert.deepEqual(snapshot("legacy-policy-bound-state-after-retry", newIds), acceptedState, "Retry/read changed accepted request state");

  await rpc("changed request body cannot replace acceptance", "reserve_document_allowance_with_policy",
    { ...fresh, p_request_sha256: sha("different body") }, { expectedError: "ALLOWANCE_REQUEST_REPLAY_CONFLICT" });
  await rpc("replay read requires the exact accepted request body", "read_document_allowance_replay",
    { ...readArgs(fresh), p_request_sha256: sha("different body") }, { expectedError: "ALLOWANCE_REQUEST_REPLAY_CONFLICT" });
  await rpc("changed policy cannot replace acceptance", "reserve_document_allowance_with_policy",
    { ...fresh, p_execution_policy_sha256: sha("different policy") }, { expectedError: "ALLOWANCE_EXECUTION_POLICY_CONFLICT" });
  await rpc("legacy entry cannot reacquire policy-bound work", "reserve_document_allowance_with_result", base(fresh.p_request_id),
    { expectedError: "ALLOWANCE_EXECUTION_POLICY_REQUIRED" });
  await rpc("bare legacy entry cannot reacquire policy-bound work", "reserve_document_allowance", base(fresh.p_request_id),
    { expectedError: "ALLOWANCE_EXECUTION_POLICY_REQUIRED" });
  for (const [name, args] of [["read_document_allowance_replay", readArgs(fresh)], ["reserve_document_allowance_with_policy", fresh]]) {
    for (const [role, token] of [["authenticated", owner.token], ["anon", config.ANON_KEY]]) {
      await rpc(`${role} cannot call ${name}`, name, args, { token, permissionDenied: true });
    }
  }
  assert.deepEqual(snapshot("legacy-policy-bound-state-after-rejections", newIds), acceptedState, "Rejected calls mutated bound work");
  const freshPayload = { ...historicalPayload, payload: { events: [{ type: "section", key: "new", label: "New", content: "New synthetic wording." }] } };
  const freshSettle = { ...settleArgs, p_reservation_id: accepted.reservation_id, p_request_id: fresh.p_request_id, p_response_payload: freshPayload };
  const final = await rpc("settle exact policy-bound result", "settle_document_allowance_with_result", freshSettle);
  assert.equal(final.state, "settled"); assert.equal(final.reservation_id, accepted.reservation_id);
  const finalReplay = await read("read exact policy-bound settled result", fresh);
  assert.equal(finalReplay.state, "settled"); assert.deepEqual(finalReplay.replay_result, freshPayload);
  const settledState = snapshot("legacy-policy-bound-state-settled", newIds);
  assert.equal(settledState.reservations.length, 1); assert.equal(settledState.results.length, 1); assert.equal(settledState.usage.length, 1);
  const finalRetry = await reserve("retry settled policy-bound request", fresh);
  assert.equal(finalRetry.state, "settled"); assert.equal(finalRetry.provider_permitted, false);
  assert.deepEqual(finalRetry.replay_result, freshPayload);
  await rpc("changed settled payload cannot overwrite receipt", "settle_document_allowance_with_result",
    { ...freshSettle, p_response_payload: historicalPayload }, { expectedError: "ALLOWANCE_RESULT_REPLAY_CONFLICT" });
  assert.deepEqual(snapshot("legacy-policy-bound-state-after-final-replays", newIds), settledState);
  assert.deepEqual(snapshot("legacy-policy-history-final", requestIds, true), before, "New policy work altered historical state");
  save("legacy-policy-upgrade-proofs.json", { passed: true, project, predecessor, forward,
    historicalReservationIds: before.reservations.map(row => row.id), historicalStatePreserved: true,
    historicalResponseSha256: before.results[0].response_sha256,
    policyReservationId: accepted.reservation_id, executionPolicyVersion: policyVersion,
    executionPolicySha256: fresh.p_execution_policy_sha256, policyResponseSha256: settledState.results[0].response_sha256,
    singlePolicyReservation: true, singlePolicyAllowance: true, exactRequestAndPolicyEnforced: true,
    readOnlyReplay: true, browserRolesDenied: true,
    scope: "Real disposable Auth/PostgREST upgrade and independent SQL; no provider dispatch, browser, generated wording or hosted execution." });
}
