// Dormant reservation acceptance on the enclosing runner's attested disposable DB.
// Synthetic offer identifiers prove admission/replay only; no SDK or provider call.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readUploadProbeBody } from "./workspace-upload-transport.mjs";

const ORIGIN = "http://127.0.0.1:58321";
const CONTRACT = "business-checkout.1";
const RESERVE = "/rest/v1/rpc/reserve_business_checkout_attempt_v1";
const READ = "/rest/v1/rpc/read_own_business_checkout_attempt_v1";
const ACCESS = "/rest/v1/rpc/get_effective_product_access_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const SCOPE = "Real local confirmed Auth and separate PostgREST reservation transactions with observed advisory-lock overlap, exact replay, immutable SQL rows and owner reads. Dormant admission only; no SDK purchase, provider, entitlement grant, checkout resolution, deletion participation or hosted proof.";

function exactKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Expected an object receipt");
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function assertAttempt(value, ownerId, operationId, serverBinding, offerSnapshot) {
  exactKeys(value, ["user_id", "operation_id", "server_binding", "offer_snapshot", "request_sha256", "created_at", "state"]);
  assert.equal(value.user_id, ownerId); assert.equal(value.operation_id, operationId);
  assert.deepEqual(value.server_binding, serverBinding); assert.deepEqual(value.offer_snapshot, offerSnapshot);
  assert.equal(value.state, "unresolved");
  assert.equal(typeof value.request_sha256, "string"); assert.match(value.request_sha256, /^[0-9a-f]{64}$/);
  assert.equal(typeof value.created_at, "string"); assert.match(value.created_at, TIMESTAMP);
  assert.ok(Number.isFinite(Date.parse(value.created_at)), "Invalid reservation timestamp");
}

function assertReserve(value, command, outcome) {
  exactKeys(value, ["contract_version", "outcome", "user_id", "requested_operation_id", "dispatch_permitted", "attempt"]);
  assert.equal(value.contract_version, CONTRACT); assert.equal(value.outcome, outcome);
  assert.equal(value.user_id, command.p_user_id); assert.equal(value.requested_operation_id, command.p_operation_id);
  assert.equal(value.dispatch_permitted, outcome === "created");
}

function assertRead(value, ownerId, requestedOperationId, attempt) {
  exactKeys(value, ["contract_version", "user_id", "requested_operation_id", "dispatch_permitted", "attempt"]);
  assert.equal(value.contract_version, CONTRACT); assert.equal(value.user_id, ownerId);
  assert.equal(value.requested_operation_id, requestedOperationId); assert.equal(value.dispatch_permitted, false);
  assert.deepEqual(value.attempt, attempt);
}

export async function exerciseBusinessCheckoutReservations({ root, project, workdir, env, evidence, checkTarget, save, sql, sqlSessionCommand }) {
  checkTarget();
  assert.equal(root, realpathSync(fileURLToPath(new URL("../../../", import.meta.url))));
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.equal(realpathSync(workdir), workdir); assert.ok(workdir.includes(`${project}-`));
  assert.equal(evidence, join(root, "docs/evidence/web-operational-readiness", project.slice("prompted-".length)));

  // Keep the local service key, Auth responses and passwords out of command logs.
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(!status.error && status.status === 0, "Disposable local API status unavailable");
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error("Invalid disposable status JSON"); }
  assert.ok(config && typeof config === "object" && !Array.isArray(config) && config.API_URL === ORIGIN,
    "Unexpected disposable API origin; no request was sent");
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) {
    assert.ok(typeof config[key] === "string" && config[key].length > 20 && config[key].length <= 4096,
      "Missing or invalid disposable API credential");
  }
  const secrets = new Set([config.ANON_KEY, config.SERVICE_ROLE_KEY]);
  const redact = value => [...secrets].reduce((text, secret) => text.replaceAll(secret, "[local credential redacted]"), String(value))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[local JWT redacted]");
  const safeMessage = value => Array.from(redact(value), character => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159) ? " " : character;
  }).join("").slice(0, 512);
  const httpChecks = []; const overlaps = []; const children = []; const users = [];
  let primaryError = null; let checksPassed = false; let finalPassed = false;

  async function request(label, path, { token = config.ANON_KEY, method = "POST", body, expectedStatus = 200 } = {}) {
    checkTarget();
    const url = new URL(path, ORIGIN);
    assert.equal(url.origin, ORIGIN); assert.equal(url.pathname + url.search, path);
    assert.ok(["/auth/v1/admin/users", "/auth/v1/token", RESERVE, READ, ACCESS].includes(url.pathname));
    assert.equal(method, "POST");
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { method, redirect: "error", cache: "no-store", signal,
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const bytes = await readUploadProbeBody(response.body, 128 * 1024, signal);
    let data; let validJson = true;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { validJson = false; }
    const check = { label, path: url.pathname, method, status: response.status, expectedStatus };
    // Authentication responses can contain unregistered credentials. Retain none.
    if (!response.ok && !url.pathname.startsWith("/auth/v1/")) {
      if (!validJson) check.error = { body: "invalid_json" };
      else if (!data || typeof data !== "object" || Array.isArray(data)) check.error = { body: "invalid_shape" };
      else {
        check.error = { body: "json_object" };
        const code = typeof data.code === "string" ? redact(data.code) : null;
        if (code !== null && /^[A-Za-z0-9_]{1,64}$/.test(code)) check.error.code = code;
        if (typeof data.message === "string") check.error.message = safeMessage(data.message);
      }
    }
    httpChecks.push(check); save("business-checkout-http-checks.json", httpChecks);
    assert.equal(response.status, expectedStatus, `${label}: unexpected local HTTP status`);
    assert.ok(validJson, `${label}: invalid local UTF-8 JSON`);
    return data;
  }

  async function signIn(user, label) {
    const session = await request(label, "/auth/v1/token?grant_type=password", {
      body: { email: user.email, password: user.password } });
    // Validate without including an Auth response in assertion diagnostics.
    assert.ok(session && typeof session === "object" && session.user?.id === user.id &&
      session.user.is_anonymous === false && typeof session.user.email_confirmed_at === "string" &&
      Array.isArray(session.user.identities) && session.user.identities.length > 0 &&
      typeof session.access_token === "string" && session.access_token.length > 20,
    "Confirmed local session identity mismatch");
    secrets.add(session.access_token);
    if (typeof session.refresh_token === "string" && session.refresh_token) secrets.add(session.refresh_token);
    return session.access_token;
  }

  function terminate(record, signal) {
    if (!record.child.pid || record.result) return;
    try { process.kill(-record.child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }

  function startBarrier(label, ownerId) {
    checkTarget(); assert.match(ownerId, UUID);
    const command = sqlSessionCommand();
    const child = spawn(command.executable, command.args, { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const record = { label, child, result: null, failure: null, forcedTermination: false, output: "", outputBytes: 0 };
    children.push(record);
    const stop = reason => {
      if (record.failure || record.result) return;
      record.failure = reason; terminate(record, "SIGTERM");
      record.force = setTimeout(() => { record.forcedTermination = true; terminate(record, "SIGKILL"); }, 3000);
    };
    record.stop = stop;
    child.on("error", () => stop("SQL session could not start"));
    child.stdin.on("error", () => stop("SQL session input failed"));
    record.closed = new Promise(resolve => child.once("close", (code, signal) => {
      record.result = { code, signal }; clearTimeout(record.deadline); clearTimeout(record.force); resolve(record.result);
    }));
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
      record.outputBytes += chunk.length;
      if (record.outputBytes > 128 * 1024) { stop("SQL session output exceeded bound"); return; }
      record.output += chunk.toString();
    });
    record.deadline = setTimeout(() => stop("SQL session deadline exceeded"), 20000);
    record.applicationName = `checkout-barrier-${label}`;
    child.stdin.write(`begin; set local application_name=${literal(record.applicationName)};\nselect pg_advisory_xact_lock(hashtextextended('revenuecat-user:' || ${literal(ownerId)}::uuid::text,0));\n`);
    return record;
  }

  async function overlap(label, ownerId, commands) {
    assert.equal(commands.length, 2); assert.ok(commands.every(command => command.p_user_id === ownerId));
    const barrier = startBarrier(label, ownerId);
    let pending; let results; let failure = null;
    async function observe(name, query, accept) {
      const deadline = Date.now() + 5000;
      for (let attempt = 0; Date.now() < deadline; attempt++) {
        assert.equal(barrier.failure, null); assert.equal(barrier.result, null);
        const value = JSON.parse(sql(`checkout-${label}-${name}-${attempt}`, query));
        if (accept(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Checkout ${label} did not establish ${name}`);
    }
    try {
      const holder = await observe("holder", `select coalesce(jsonb_agg(a.pid),'[]'::jsonb)
        from pg_stat_activity a where a.application_name=${literal(barrier.applicationName)}
        and a.state='idle in transaction' and exists(select 1 from pg_locks l
          where l.pid=a.pid and l.locktype='advisory' and l.granted);`, value => Array.isArray(value) && value.length === 1);
      assert.ok(Number.isSafeInteger(holder[0]) && holder[0] > 0);
      // The first lock is essential: holding 91000 would leave the second
      // request waiting for the first request's RevenueCat lock instead.
      pending = Promise.allSettled(commands.map((body, index) => request(`${label} reservation ${index}`, RESERVE,
        { token: config.SERVICE_ROLE_KEY, body })));
      const waiters = await observe("waiters", `select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,
        'wait_event',a.wait_event,'mode',w.mode,'classid',w.classid,'objid',w.objid,'objsubid',w.objsubid) order by a.pid),'[]'::jsonb)
        from pg_locks w join pg_locks h on h.locktype=w.locktype and h.database=w.database
          and h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
        join pg_stat_activity a on a.pid=w.pid
        where h.pid=${holder[0]} and h.granted and not w.granted and w.locktype='advisory'
          and a.state='active' and a.wait_event='advisory'
          and a.query like '%reserve_business_checkout_attempt_v1%';`, value => Array.isArray(value) && value.length === 2);
      assert.equal(new Set(waiters.map(value => value.pid)).size, 2);
      for (const waiter of waiters) {
        assert.ok(Number.isSafeInteger(waiter.pid) && waiter.pid > 0 && waiter.pid !== holder[0]);
        assert.equal(waiter.wait_event, "advisory"); assert.equal(waiter.mode, "ExclusiveLock");
      }
      overlaps.push({ label, ownerId, operationIds: commands.map(command => command.p_operation_id),
        holderPid: holder[0], waiters, observedBeforeRelease: true });
      save("business-checkout-overlap-locks.json", overlaps);
    } catch (error) { failure = error; }
    finally {
      try { if (!barrier.child.stdin.destroyed) barrier.child.stdin.end("commit;\n\\q\n"); }
      catch (error) { if (!failure) failure = error; barrier.stop("SQL barrier release failed"); }
      await barrier.closed;
      // Attach both rejection handlers before observing the barrier and always
      // consume both requests, including when overlap proof itself fails.
      if (pending) results = await pending;
    }
    if (failure) throw failure;
    assert.equal(barrier.failure, null); assert.equal(barrier.result.code, 0); assert.equal(barrier.forcedTermination, false);
    assert.ok(results && results.length === 2);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    return results.map(result => result.value);
  }

  const originalState = label => JSON.parse(sql(label, `select jsonb_build_object(
    'subscriptions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.user_id,s.id),'[]'::jsonb) from public.subscriptions s),
    'access',(select coalesce(jsonb_agg(private.resolve_product_access_v1(u.id) order by u.id),'[]'::jsonb) from auth.users u),
    'usage',(select count(*) from public.usage_ledger),
    'webhook_receipts',(select count(*) from public.revenuecat_webhook_events),
    'documents',(select count(*) from public.documents),'outcomes',(select count(*) from public.outcomes),
    'model_attempts',(select count(*) from private.legacy_model_attempt_admissions),
    'model_results',(select count(*) from private.legacy_model_call_results),
    'capacity_leases',(select count(*) from private.openai_capacity_leases),
    'external_egress',(select count(*) from private.user_external_egress_dispatches));`));

  try {
    assert.equal(Number(sql("checkout-empty-attempt-inventory", "select count(*) from private.business_checkout_attempts;")), 0);
    for (const slot of ["a", "b"]) {
      const email = `${project}-checkout-${slot}@example.invalid`; const password = randomBytes(30).toString("base64url");
      secrets.add(password);
      const created = await request(`create checkout owner ${slot}`, "/auth/v1/admin/users", {
        token: config.SERVICE_ROLE_KEY, body: { email, password, email_confirm: true } });
      assert.ok(created && typeof created.id === "string" && UUID.test(created.id) && created.is_anonymous === false,
        "Auth did not create the confirmed checkout fixture owner");
      const user = { id: created.id, email, password }; users.push(user);
      user.token = await signIn(user, `sign in checkout owner ${slot}`);
    }
    const [a, b] = users; assert.notEqual(a.id, b.id);
    const before = originalState("checkout-original-state-before");
    const accessBefore = [];
    for (const user of users) {
      const access = await request("fresh owner access before reservation", ACCESS, { token: user.token, body: {} });
      assert.ok(access?.user_id === user.id && access.effective_plan === "free" && access.access_profile === "subscription");
      assert.deepEqual(access, before.access.find(value => value.user_id === user.id)); accessBefore.push(access);
      assertRead(await request("empty owner reservation before admission", READ, { token: user.token, body: {} }), user.id, null, null);
    }
    const serverBinding = { contract_version: CONTRACT, project_id: "proj12b68907", app_id: "app0e160cafea", environment: "SANDBOX" };
    const offerSnapshot = { offering_id: "business", package_id: "$rc_monthly", product_id: "prompted.business.monthly",
      option_id: "synthetic-checkout-monthly-option", price_id: "synthetic-checkout-usd-price", currency: "USD",
      amount_micros: 50000000, period: "P1M", trial: null, intro_price: null, discount: null };
    const command = (ownerId, operationId) => ({ p_user_id: ownerId, p_operation_id: operationId,
      p_server_binding: serverBinding, p_offer_snapshot: offerSnapshot });
    const distinctCommands = [command(a.id, randomUUID()), command(a.id, randomUUID())];
    assert.notEqual(distinctCommands[0].p_operation_id, distinctCommands[1].p_operation_id);
    const distinct = await overlap("distinct-operation", a.id, distinctCommands);
    assert.deepEqual(distinct.map(value => value.outcome).sort(), ["blocked", "created"]);
    const winnerIndex = distinct.findIndex(value => value.outcome === "created"); const loserIndex = 1 - winnerIndex;
    const winner = distinct[winnerIndex]; const winnerCommand = distinctCommands[winnerIndex];
    assertReserve(winner, winnerCommand, "created");
    assertAttempt(winner.attempt, a.id, winnerCommand.p_operation_id, serverBinding, offerSnapshot);
    assertReserve(distinct[loserIndex], distinctCommands[loserIndex], "blocked");
    assert.deepEqual(distinct[loserIndex].attempt, winner.attempt);
    // Before B creates its own composite identity, A's exact operation remains invisible.
    assertRead(await request("foreign operation is absent", READ, { token: b.token,
      body: { p_operation_id: winnerCommand.p_operation_id } }), b.id, winnerCommand.p_operation_id, null);
    assertRead(await request("blocked operation was not created", READ, { token: a.token,
      body: { p_operation_id: distinctCommands[loserIndex].p_operation_id } }), a.id, distinctCommands[loserIndex].p_operation_id, null);

    const sharedCommand = command(b.id, winnerCommand.p_operation_id);
    const same = await overlap("same-operation", b.id, [sharedCommand, sharedCommand]);
    assert.deepEqual(same.map(value => value.outcome).sort(), ["created", "replay"]);
    for (const receipt of same) {
      assertReserve(receipt, sharedCommand, receipt.outcome);
      assertAttempt(receipt.attempt, b.id, sharedCommand.p_operation_id, serverBinding, offerSnapshot);
    }
    assert.deepEqual(same[0].attempt, same[1].attempt);
    const bAttempt = same[0].attempt;
    const changedCommand = { ...sharedCommand, p_offer_snapshot: { ...offerSnapshot, price_id: "synthetic-checkout-conflicting-price" } };
    // PostgREST maps PostgreSQL P0001 to HTTP 400. Exact body and unchanged-row checks
    // distinguish the expected binding conflict from an infrastructure failure.
    const conflict = await request("same operation changed binding conflicts", RESERVE, {
      token: config.SERVICE_ROLE_KEY, body: changedCommand, expectedStatus: 400 });
    exactKeys(conflict, ["code", "details", "hint", "message"]);
    assert.equal(conflict.code, "P0001"); assert.equal(conflict.message, "BUSINESS_CHECKOUT_OPERATION_CONFLICT");
    assert.equal(conflict.details, null); assert.equal(conflict.hint, null);
    const replay = await request("unchanged retry never redispatches", RESERVE, { token: config.SERVICE_ROLE_KEY, body: sharedCommand });
    assertReserve(replay, sharedCommand, "replay"); assert.deepEqual(replay.attempt, bAttempt);
    const denied = await request("browser cannot reserve checkout", RESERVE, { token: a.token, body: winnerCommand, expectedStatus: 403 });
    exactKeys(denied, ["code", "details", "hint", "message"]); assert.equal(denied.code, "42501");
    assert.equal(denied.message, "permission denied for function reserve_business_checkout_attempt_v1");

    const expectedAttempts = [winner.attempt, bAttempt]; const ownerReads = [];
    for (const [index, user] of users.entries()) {
      const token = await signIn(user, `fresh sign in checkout owner ${index}`);
      const current = await request("fresh session current reservation", READ, { token, body: {} });
      assertRead(current, user.id, null, expectedAttempts[index]);
      const exact = await request("fresh session exact reservation", READ, { token, body: { p_operation_id: winnerCommand.p_operation_id } });
      assertRead(exact, user.id, winnerCommand.p_operation_id, expectedAttempts[index]);
      const absentId = randomUUID(); assert.notEqual(absentId, winnerCommand.p_operation_id);
      assertRead(await request("unknown reservation is absent", READ, { token, body: { p_operation_id: absentId } }), user.id, absentId, null);
      const access = await request("reservation did not grant access", ACCESS, { token, body: {} });
      assert.deepEqual(access, accessBefore[index]); ownerReads.push({ userId: user.id, current, exact, unknownAbsent: true, access });
    }
    const stored = JSON.parse(sql("checkout-independent-full-rows", `select coalesce(jsonb_agg(jsonb_build_object(
      'row',to_jsonb(a),'canonical_created_at',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expected_request_sha256',encode(extensions.digest(convert_to(jsonb_build_object(
        'contract_version','business-checkout.1','user_id',a.user_id,'operation_id',a.operation_id,
        'server_binding',a.server_binding,'offer_snapshot',a.offer_snapshot)::text,'UTF8'),'sha256'),'hex'))
      order by a.user_id,a.operation_id),'[]'::jsonb) from private.business_checkout_attempts a;`));
    assert.ok(Array.isArray(stored)); assert.equal(stored.length, 2);
    assert.equal(new Set(stored.map(value => value.row.user_id)).size, 2);
    for (const item of stored) {
      exactKeys(item, ["row", "canonical_created_at", "expected_request_sha256"]);
      const expected = expectedAttempts.find(value => value.user_id === item.row.user_id); assert.ok(expected);
      assert.deepEqual({ ...item.row, created_at: item.canonical_created_at }, expected);
      assert.ok(typeof item.row.created_at === "string" && Number.isFinite(Date.parse(item.row.created_at)));
      assert.equal(item.row.request_sha256, item.expected_request_sha256);
    }
    const privileges = JSON.parse(sql("checkout-independent-privileges", `select jsonb_build_object(
      'reserve_service',has_function_privilege('service_role','public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)','EXECUTE'),
      'reserve_authenticated',has_function_privilege('authenticated','public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)','EXECUTE'),
      'reserve_anon',has_function_privilege('anon','public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)','EXECUTE'),
      'read_authenticated',has_function_privilege('authenticated','public.read_own_business_checkout_attempt_v1(uuid)','EXECUTE'),
      'read_service',has_function_privilege('service_role','public.read_own_business_checkout_attempt_v1(uuid)','EXECUTE'),
      'read_anon',has_function_privilege('anon','public.read_own_business_checkout_attempt_v1(uuid)','EXECUTE'),
      'table_service',has_table_privilege('service_role','private.business_checkout_attempts','SELECT,INSERT,UPDATE,DELETE'),
      'table_authenticated',has_table_privilege('authenticated','private.business_checkout_attempts','SELECT,INSERT,UPDATE,DELETE'),
      'table_anon',has_table_privilege('anon','private.business_checkout_attempts','SELECT,INSERT,UPDATE,DELETE'));`));
    assert.deepEqual(privileges, { reserve_service: true, reserve_authenticated: false, reserve_anon: false,
      read_authenticated: true, read_service: false, read_anon: false, table_service: false, table_authenticated: false, table_anon: false });
    const after = originalState("checkout-original-state-after");
    assert.deepEqual(after, before, "Reservation changed subscription, effective access, usage, webhook or existing workflow state");
    assert.equal(overlaps.length, 2); checkTarget();
    save("business-checkout-reservation-proofs.json", { passed: true, project, fixtureUserIds: users.map(user => user.id),
      distinct, same, conflict: { code: conflict.code, message: conflict.message }, replay, ownerReads,
      rawSqlRows: stored, privileges, originalStateBefore: before, originalStateAfter: after, overlaps, scope: SCOPE });
    checksPassed = true;
  } catch (error) { primaryError = error; }
  finally {
    const cleanupFailures = [];
    for (const record of [...children].reverse()) {
      try {
        if (!record.result) { record.stop("Unfinished SQL session during cleanup"); await record.closed; }
        save(`checkout-${record.label}-barrier.log`, redact(record.output));
        if (!record.result || record.forcedTermination) cleanupFailures.push(`${record.label}: incomplete or forced cleanup`);
      } catch (error) { cleanupFailures.push(`${record.label}: ${safeMessage(error.message ?? String(error))}`); }
    }
    const sessions = children.map(({ label, result, failure, forcedTermination }) => ({ label, result, failure, forcedTermination }));
    finalPassed = checksPassed && primaryError === null && cleanupFailures.length === 0 &&
      sessions.every(session => session.result?.code === 0 && session.failure === null && !session.forcedTermination);
    try { save("business-checkout-reservation-runtime.json", { passed: finalPassed, checksPassed,
      primaryFailure: primaryError ? safeMessage(primaryError.message ?? String(primaryError)) : null,
      cleanupFailures, sessions, httpChecks, fixtureUserIds: users.map(user => user.id),
      credentialFilesWritten: false, fixtureCleanup: "Enclosing attested disposable database teardown", scope: SCOPE }); }
    catch (error) { if (!primaryError) primaryError = error; }
  }
  if (primaryError) throw new Error(safeMessage(primaryError.message ?? String(primaryError)));
  assert.ok(finalPassed, "Checkout reservation acceptance or SQL cleanup failed");
}
