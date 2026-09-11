import { withPaidPlanFixtures } from "./paid-plan-fixture-revisions.mjs";
// Exact 79→81 upgrade acceptance inside the existing disposable runner.
// The parent runner owns database identity, start, reset, migration and cleanup.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readUploadProbeBody } from "./workspace-upload-transport.mjs";

export const coreMigrationFile = "supabase/migrations/20260908160000_legacy_workspace_save_core.sql";
export const coreMigrationSha = "2c1d3624c48f5f6c2abb7adc888515095cff44fb8b27e7b8b345e81db95576d6";
export const coreTestFile = "supabase/tests/legacy_workspace_core.test.sql";
export const coreTestSha = "25e4515639774158b963ea788d21afd22a489787686b6869dd9608f65198e982";
export const sourcePreparationMigrationFile = "supabase/migrations/20260909105519_complete_upload_source_preparation.sql";
export const sourcePreparationMigrationSha = "05a0fdc8690af10353b9fd8fbcb2e51e1d043fa505d8d4840d57c0b70fa3acc3";
export const sourcePreparationTestFile = "supabase/tests/upload_source_preparation.test.sql";
export const sourcePreparationTestSha = "e37d2c66aaf9a636ed38675c7762a4bb93a8304241b80643ff623dedd75a9d39";
const baselineSha = "ef8bb13849ce210b98fb18b273f4560414880c7f156bc2ce0598152d7ba3a6a3";
const sha = value => createHash("sha256").update(value).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const origin = "http://127.0.0.1:58321";
const publicName = "save_own_legacy_workspace_v1";
const publicSignature = `public.${publicName}(text,uuid,uuid,integer,jsonb,jsonb,jsonb)`;
const coreSignature = "private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)";
const documentKeys = ["status", "template_id", "title", "unresolved_placeholders"];
const sectionKeys = ["name", "order_index", "status", "is_required"];
const receiptKeys = ["contract_version", "state", "outcome_id", "document_id", "idempotency_key", "accepted_document_revision",
  "document_revision", "document_status", "document_approved_revision", "document_updated_at", "sections", "committed_at", "idempotent_replay"];
const sectionReceiptKeys = ["section_id", "status", "revision", "approved_revision", "content_sha256", "updated_at"];
const selectKeys = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));
const closed = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};

export function validateLegacyWorkspaceCoreUpgradePlan(manifest, currentSource, baselineBytes = readFileSync(
  new URL("./legacy-workspace-core-upgrade-sql-baseline.json", import.meta.url))) {
  assert.equal(sha(baselineBytes), baselineSha, "Reviewed workspace core SQL baseline changed");
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.contract_version, "legacy-workspace-core-upgrade-sql.1");
  assert.equal(baseline.source_run, "db-20260908164701953-5aab36ed");
  assert.equal(baseline.predecessor, "20260908150000");
  assert.match(coreMigrationSha, digest); assert.match(coreTestSha, digest);
  const currentSql = Object.fromEntries(Object.entries(currentSource).filter(([file]) =>
    file.startsWith("supabase/migrations/") || file.startsWith("supabase/tests/")));
  assert.deepEqual(manifest, currentSql, "Workspace core upgrade must exercise all current SQL");
  const prefixManifest = withPaidPlanFixtures(baseline.manifest);
  const expected = { ...prefixManifest, [coreMigrationFile]: coreMigrationSha, [coreTestFile]: coreTestSha,
    [sourcePreparationMigrationFile]: sourcePreparationMigrationSha, [sourcePreparationTestFile]: sourcePreparationTestSha };
  assert.deepEqual(manifest, expected, "Workspace core upgrade requires the exact reviewed SQL manifest");
  const versions = Object.keys(manifest).filter(file => file.startsWith("supabase/migrations/"))
    .map(file => file.split("/").at(-1).slice(0, 14)).sort();
  assert.equal(versions.length, 81); assert.equal(new Set(versions).size, 81);
  assert.deepEqual(versions.filter(version => version > baseline.predecessor), ["20260908160000", "20260909105519"]);
  assert.equal(Object.keys(baseline.manifest).length, 127);
  return { predecessor: baseline.predecessor, forward: "20260908160000", through: "20260909105519", versions,
    prefixManifest, manifest: expected, baselineSha,
    migrationFile: coreMigrationFile, migrationSha: coreMigrationSha, testFile: coreTestFile, testSha: coreTestSha };
}

export function assertLegacyWorkspaceCorePhase(plan, phase, actualManifest, heldSha) {
  assert.ok(phase === "full" || phase === "predecessor", "Unknown workspace core SQL phase");
  assert.deepEqual(actualManifest, phase === "full" ? plan.manifest : plan.prefixManifest,
    "Copied SQL differs from the exact workspace core phase");
  assert.deepEqual(heldSha, phase === "full" ? { migration: null, test: null, sourceMigration: null, sourceTest: null } :
    { migration: coreMigrationSha, test: coreTestSha, sourceMigration: sourcePreparationMigrationSha,
      sourceTest: sourcePreparationTestSha }, "Held workspace core/upload SQL differs from the exact phase");
}

export function assertWorkspacePublicProperties(before, after) {
  assert.ok(before && after, "The original public RPC must positively exist");
  for (const value of [before, after]) {
    assert.ok(value.catalog_identity && typeof value.catalog_identity === "object");
    assert.equal(value.argument_count, 7); assert.equal(value.defaults_count, 0); assert.equal(value.defaults_expression, null);
    assert.equal(value.security_definer, true); assert.equal(value.strict, false); assert.equal(value.returns_set, false);
    assert.equal(value.kind, "f"); assert.equal(value.result_type_name, "jsonb");
    assert.equal(value.volatility, "v"); assert.equal(value.parallel, "u");
    assert.deepEqual(value.config, ['search_path=""']);
    assert.deepEqual(value.names, ["p_idempotency_key", "p_outcome_id", "p_document_id", "p_expected_document_revision",
      "p_expected_document", "p_document", "p_sections"]);
    assert.deepEqual(value.execute, { authenticated: true, anon: false, service_role: false, public: false });
    // PostgreSQL emits OID types as JSON strings. Validate the canonical
    // nonzero uint32 representation without changing the retained catalog.
    for (const [projected, raw] of [["oid", "oid"], ["owner", "proowner"],
      ["language", "prolang"], ["result_type", "prorettype"]]) {
      const identifier = value[projected];
      assert.equal(typeof identifier, "string", `${projected}: expected a PostgreSQL OID string`);
      assert.match(identifier, /^[1-9][0-9]{0,9}$/);
      const numeric = BigInt(identifier);
      assert.ok(numeric <= 4294967295n && numeric.toString() === identifier, `${projected}: noncanonical or out-of-range OID`);
      assert.equal(value.catalog_identity[raw], identifier, `${projected}: raw catalog identity differs`);
    }
  }
  assert.deepEqual(after, before, "Core extraction changed the existing public RPC identity, signature or properties");
}

export async function exerciseLegacyWorkspaceCoreUpgrade({ project, workdir, env, sql, applyMigration, checkTarget, save }) {
  checkTarget(); assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/); assert.ok(workdir.includes(`${project}-`));
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(!status.error && !status.signal && status.status === 0, "Disposable workspace core status failed");
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error("Invalid disposable workspace core status"); }
  assert.equal(config.API_URL, origin, "Unexpected API origin; no request sent");
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) assert.ok(typeof config[key] === "string" && config[key].length > 20);
  const checks = [];
  async function request(label, path, body, { token = config.SERVICE_ROLE_KEY, expectedError, expectedStatus = 200, get = false } = {}) {
    checkTarget(); const url = new URL(path, origin); assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/"));
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { method: get ? "GET" : "POST", redirect: "error", signal, cache: "no-store",
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" },
      ...(get ? {} : { body: JSON.stringify(body) }) });
    const bytes = await readUploadProbeBody(response.body, 256 * 1024, signal);
    let data;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error(`${label}: invalid local JSON response`); }
    const check = { label, path: url.pathname, status: response.status }; checks.push(check);
    save("legacy-workspace-core-upgrade-http-checks.json", checks);
    assert.equal(response.status, expectedStatus, `${label}: unexpected HTTP status`);
    if (expectedError) { assert.equal(data.code, expectedError.code); assert.equal(data.message, expectedError.message); check.errorCode = data.code; }
    save("legacy-workspace-core-upgrade-http-checks.json", checks);
    return data;
  }
  const rpc = (label, args, user, options = {}) => request(label, `/rest/v1/rpc/${publicName}`, args, { token: user.token, ...options });
  const users = [];
  for (const slot of ["a", "b"]) {
    const email = `${project}-workspace-core-${slot}@example.invalid`, password = randomBytes(30).toString("base64url");
    const created = await request(`create workspace owner ${slot}`, "/auth/v1/admin/users", { email, password, email_confirm: true });
    assert.match(created.id, uuid);
    const session = await request(`authenticate workspace owner ${slot}`, "/auth/v1/token?grant_type=password",
      { email, password }, { token: config.ANON_KEY });
    assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
    assert.ok(typeof session.access_token === "string" && session.access_token.length > 20);
    users.push({ id: created.id, token: session.access_token });
  }
  const [owner, other] = users; assert.notEqual(owner.id, other.id);
  const ownerIds = users.map(user => literal(user.id)).join(",");
  const readJson = (label, query) => JSON.parse(sql(label, query));
  const publicProperties = label => readJson(label, `select jsonb_build_object(
    'catalog_identity',to_jsonb(p)-'prosrc','oid',p.oid,'owner',p.proowner,'acl',p.proacl,'arguments',p.proargtypes::text,'names',p.proargnames,
    'defaults_count',p.pronargdefaults,'defaults_expression',p.proargdefaults::text,'language',p.prolang,
    'security_definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,'parallel',p.proparallel,
    'result_type',p.prorettype,'result_type_name',p.prorettype::regtype::text,'strict',p.proisstrict,
    'returns_set',p.proretset,'kind',p.prokind,'argument_count',p.pronargs,'all_argument_types',p.proallargtypes,
    'argument_modes',p.proargmodes,'cost',p.procost,'leakproof',p.proleakproof,'support',p.prosupport,
    'execute',jsonb_build_object('authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'public',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE')))
    from pg_proc p where p.oid=to_regprocedure(${literal(publicSignature)});`);
  const beforeProperties = publicProperties("workspace-core-public-before");
  assertWorkspacePublicProperties(beforeProperties, beforeProperties);
  const beforeBodySha = sql("workspace-core-old-body-sha", `select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
    from pg_proc p where p.oid=to_regprocedure(${literal(publicSignature)});`).trim();
  assert.equal(beforeBodySha, "6a7eb1228611c35c64720b3d3c2654f039d510c797010739b34046639fa5897b");
  assert.equal(Number(sql("workspace-core-predecessor-absent", `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='save_legacy_workspace_core_v1';`)), 0);
  function snapshot(label) {
    return Object.fromEntries(["public.outcomes", "public.documents", "public.sections", "private.legacy_workspace_save_receipts"].map((table, index) => {
      const rows = readJson(`${label}-${index}`, `select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'sha256',
        encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex')) order by r.id),'[]'::jsonb)
        from ${table} r where r.user_id in (${ownerIds});`);
      for (const row of rows) { assert.match(row.id, uuid); assert.match(row.sha256, digest); }
      return [table, rows];
    }));
  }
  function workspace(label, fixture) {
    return readJson(label, `select jsonb_build_object('document',to_jsonb(d),'sections',(
      select jsonb_agg(to_jsonb(s) order by s.order_index,s.id) from public.sections s
      where s.document_id=d.id and s.user_id=d.user_id)) from public.documents d
      where d.id=${literal(fixture.documentId)}::uuid and d.user_id=${literal(fixture.user.id)}::uuid;`);
  }
  function assertReceipt(receipt, args, stored, expectedState, replay = false) {
    closed(receipt, receiptKeys); assert.equal(receipt.contract_version, "legacy-workspace-save.v1");
    assert.equal(receipt.state, expectedState); assert.equal(receipt.idempotent_replay, replay);
    assert.equal(receipt.outcome_id, args.p_outcome_id); assert.equal(receipt.document_id, args.p_document_id);
    assert.equal(receipt.idempotency_key, args.p_idempotency_key); assert.equal(receipt.accepted_document_revision, args.p_expected_document_revision);
    assert.equal(receipt.document_revision, stored.document.current_revision); assert.equal(receipt.document_status, stored.document.status);
    assert.equal(receipt.document_approved_revision, stored.document.approved_revision);
    assert.equal(Date.parse(receipt.document_updated_at), Date.parse(stored.document.updated_at));
    assert.ok(Number.isFinite(Date.parse(receipt.committed_at))); assert.equal(receipt.sections.length, stored.sections.length);
    for (const [index, row] of stored.sections.entries()) {
      const section = receipt.sections[index]; closed(section, sectionReceiptKeys);
      assert.deepEqual(selectKeys(section, ["section_id", "status", "revision", "approved_revision", "content_sha256"]), {
        section_id: row.id, status: row.status, revision: row.revision, approved_revision: row.approved_revision, content_sha256: sha(row.content) });
      assert.equal(Date.parse(section.updated_at), Date.parse(row.updated_at));
    }
  }
  async function createFixture(user, name) {
    const outcomeId = randomUUID(), documentId = randomUUID();
    const outcome = { id: outcomeId, user_id: user.id, situation_text: "Synthetic preserved workspace source.",
      recommendation_payload: { primary: { template_id: "bespoke", reason: "Synthetic fixture" }, alternatives: [] }, status: "in_progress", is_saved: true };
    const createdOutcome = await request(`${name} authenticated outcome create`, "/rest/v1/outcomes", outcome,
      { token: user.token, expectedStatus: 201 });
    assert.equal(createdOutcome.length, 1); assert.equal(createdOutcome[0].id, outcomeId); assert.equal(createdOutcome[0].user_id, user.id);
    const args = { p_idempotency_key: `core:${name}:create`, p_outcome_id: outcomeId, p_document_id: documentId,
      p_expected_document_revision: 0, p_expected_document: null,
      p_document: { title: `Synthetic ${name}`, status: "draft", template_id: null, unresolved_placeholders: [] },
      p_sections: ["Edited section", "Preserved sibling"].map((label, index) => ({ id: randomUUID(), expected: null,
        desired: { name: label, order_index: index, status: "draft", is_required: index === 0 },
        content: index === 0 ? "Original café wording.\nSecond paragraph." : "  Keep this exact sibling.\n\n• Preserve its list.  " })) };
    const receipt = await rpc(`${name} public creation`, args, user);
    const fixture = { user, name, outcomeId, documentId, createArgs: args, createReceipt: receipt };
    const stored = workspace(`${name}-create-independent-sql`, fixture);
    assertReceipt(receipt, args, stored, "created"); assert.equal(stored.sections.length, 2);
    for (const [index, row] of stored.sections.entries()) assert.equal(row.content, args.p_sections[index].content);
    const owned = await request(`${name} authenticated owned read`, `/rest/v1/documents?id=eq.${documentId}&select=id,user_id,current_revision`, null,
      { token: user.token, get: true });
    assert.deepEqual(owned, [{ id: documentId, user_id: user.id, current_revision: stored.document.current_revision }]);
    return fixture;
  }
  const first = await createFixture(owner, "historical-owner"), second = await createFixture(other, "historical-other");
  const initial = workspace("workspace-core-before-second-save", first);
  function editArgs(fixture, stored, key, content) {
    const metadata = selectKeys(stored.document, documentKeys);
    return { p_idempotency_key: key, p_outcome_id: fixture.outcomeId, p_document_id: fixture.documentId,
      p_expected_document_revision: stored.document.current_revision, p_expected_document: metadata,
      p_document: { ...metadata, title: `${metadata.title} revised` },
      p_sections: stored.sections.map((section, index) => ({ id: section.id,
        expected: { ...selectKeys(section, sectionKeys), revision: section.revision, content_sha256: sha(section.content) },
        desired: { ...selectKeys(section, sectionKeys), ...(index === 0 ? { status: "edited" } : {}) },
        ...(index === 0 ? { content } : {}) })) };
  }
  const secondArgs = editArgs(first, initial, "core:historical-owner:edit", "Revised café wording.\nKeep the exact paragraph break.");
  const secondReceipt = await rpc("historical second public save", secondArgs, owner);
  const latest = workspace("workspace-core-after-second-save", first);
  assertReceipt(secondReceipt, secondArgs, latest, "saved");
  assert.ok(latest.document.current_revision > initial.document.current_revision);
  assert.deepEqual(latest.sections[1], initial.sections[1], "Omitted sibling content or provenance changed");
  assert.equal(latest.sections[0].content, secondArgs.p_sections[0].content);
  assert.ok(latest.sections[0].version_history.length > initial.sections[0].version_history.length);
  const beforeReplay = snapshot("workspace-core-before-old-replay");
  const historicalReplay = await rpc("old receipt replays after newer public save", first.createArgs, owner);
  assert.deepEqual(historicalReplay, { ...first.createReceipt, idempotent_replay: true });
  assert.ok(historicalReplay.document_revision < latest.document.current_revision);
  assert.deepEqual(snapshot("workspace-core-after-old-replay"), beforeReplay);
  const before = snapshot("workspace-core-before-migration");
  assert.equal(before["public.outcomes"].length, 2); assert.equal(before["public.documents"].length, 2);
  assert.equal(before["public.sections"].length, 4); assert.equal(before["private.legacy_workspace_save_receipts"].length, 3);
  save("legacy-workspace-core-history-before.json", before);
  save("legacy-workspace-core-public-before.json", beforeProperties);
  await applyMigration();
  assert.deepEqual(snapshot("workspace-core-after-migration"), before, "Core extraction mutated historical workspace columns or receipts");
  const afterProperties = publicProperties("workspace-core-public-after");
  assertWorkspacePublicProperties(beforeProperties, afterProperties);
  save("legacy-workspace-core-public-after.json", afterProperties);
  const core = readJson("workspace-core-properties", `select jsonb_build_object('owner',c.proowner,
    'invoker',not c.prosecdef,'strict',c.proisstrict,'config',c.proconfig,'default_count',c.pronargdefaults,
    'argument_count',c.pronargs,'names',c.proargnames,'result_type',c.prorettype::regtype::text,
    'body_sha256',encode(extensions.digest(convert_to(c.prosrc,'UTF8'),'sha256'),'hex'),
    'owner_execute',has_function_privilege(c.proowner,c.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',c.oid,'EXECUTE'),
    'anon_execute',has_function_privilege('anon',c.oid,'EXECUTE'),
    'service_execute',has_function_privilege('service_role',c.oid,'EXECUTE'),
    'only_owner_acl',not exists(select 1 from aclexplode(coalesce(c.proacl,acldefault('f',c.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee<>c.proowner),
    'receipt_private',not has_table_privilege('authenticated','private.legacy_workspace_save_receipts','SELECT')
      and not has_table_privilege('service_role','private.legacy_workspace_save_receipts','SELECT'))
    from pg_proc c where c.oid=to_regprocedure(${literal(coreSignature)});`);
  assert.ok(core); assert.equal(core.owner, beforeProperties.owner); assert.equal(core.invoker, true);
  assert.equal(core.strict, false); assert.deepEqual(core.config, ['search_path=""']); assert.equal(core.default_count, 0);
  assert.equal(core.argument_count, 8); assert.equal(core.result_type, "jsonb");
  assert.deepEqual(core.names, ["p_actor_user_id", ...beforeProperties.names]);
  assert.equal(core.body_sha256, "cbebe21e2b42c68b96ee588075889c1c2f83e90ca7d644e59d5de1164057a756");
  assert.equal(core.owner_execute, true); assert.equal(core.authenticated_execute, false); assert.equal(core.anon_execute, false);
  assert.equal(core.service_execute, false); assert.equal(core.only_owner_acl, true); assert.equal(core.receipt_private, true);
  save("legacy-workspace-core-properties.json", core);
  for (const [label, args, accepted, user] of [
    ["old creation after upgrade", first.createArgs, first.createReceipt, owner],
    ["old edit after upgrade", secondArgs, secondReceipt, owner],
    ["second owner old creation after upgrade", second.createArgs, second.createReceipt, other],
  ]) assert.deepEqual(await rpc(label, args, user), { ...accepted, idempotent_replay: true });
  assert.deepEqual(snapshot("workspace-core-after-historical-replays"), before);
  // The core's actor is explicit; this trusted SQL call has no browser JWT and
  // only replays an existing receipt. It must share the original authority.
  const coreCall = args => `private.save_legacy_workspace_core_v1(${literal(owner.id)}::uuid,
    ${literal(args.p_idempotency_key)},${literal(args.p_outcome_id)}::uuid,${literal(args.p_document_id)}::uuid,
    ${args.p_expected_document_revision},${args.p_expected_document === null ? "null::jsonb" : `${literal(JSON.stringify(args.p_expected_document))}::jsonb`},
    ${literal(JSON.stringify(args.p_document))}::jsonb,${literal(JSON.stringify(args.p_sections))}::jsonb)`;
  const coreReplay = readJson("workspace-core-trusted-replays-public-receipt", `select ${coreCall(first.createArgs)};`);
  assert.deepEqual(coreReplay, historicalReplay); assert.deepEqual(snapshot("workspace-core-after-trusted-replay"), before);
  async function reject(label, action) {
    const rows = snapshot(`${label}-before`); await action();
    assert.deepEqual(snapshot(`${label}-after`), rows, `${label}: rejected call changed a workspace or receipt`);
  }
  const conflictArgs = { ...first.createArgs, p_document: { ...first.createArgs.p_document, title: "Changed old intent" } };
  await reject("workspace-core-replay-conflict", () => rpc("changed old save intent fails", conflictArgs, owner,
    { expectedStatus: 409, expectedError: { code: "23505", message: "LEGACY_WORKSPACE_REPLAY_CONFLICT" } }));
  const freshArgs = editArgs(first, latest, "core:after-upgrade:edit", "New exact post-upgrade wording.\nA second line.");
  await reject("workspace-core-other-owner", () => rpc("other owner cannot mutate first workspace",
    { ...freshArgs, p_idempotency_key: "core:other-owner:attempt" }, other,
    { expectedStatus: 403, expectedError: { code: "42501", message: "LEGACY_WORKSPACE_UNAVAILABLE" } }));
  for (const [role, token, expectedStatus] of [["anonymous", config.ANON_KEY, 401], ["service", config.SERVICE_ROLE_KEY, 403]]) {
    await reject(`workspace-core-public-${role}`, () => rpc(`${role} cannot execute public owner wrapper`, freshArgs, { token },
      { expectedStatus, expectedError: { code: "42501", message: `permission denied for function ${publicName}` } }));
  }
  // A private-schema PostgREST miss alone is not grant proof. Positively resolve
  // the core above, inspect its ACL, then call it under each real SQL role. This
  // temporary invoker probe catches ONLY permission failures, not missing RPCs.
  const directBefore = snapshot("workspace-core-before-direct-denials");
  const direct = sql("workspace-core-direct-role-denials", `begin;
    create function pg_temp.workspace_core_denial() returns jsonb language plpgsql security invoker as $probe$
    declare result jsonb;
    begin
      result:=${coreCall(first.createArgs)};
      return jsonb_build_object('role',current_user,'unexpected_success',true);
    exception when insufficient_privilege then
      return jsonb_build_object('role',current_user,'sqlstate',sqlstate);
    end;
    $probe$;
    grant execute on function pg_temp.workspace_core_denial() to authenticated,anon,service_role;
    set local role authenticated; select pg_temp.workspace_core_denial(); reset role;
    set local role anon; select pg_temp.workspace_core_denial(); reset role;
    set local role service_role; select pg_temp.workspace_core_denial(); reset role;
    rollback;`).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(direct, ["authenticated", "anon", "service_role"].map(role => ({ role, sqlstate: "42501" })));
  assert.deepEqual(snapshot("workspace-core-after-direct-denials"), directBefore);
  save("legacy-workspace-core-direct-denials.json", direct);
  const newReceipt = await rpc("new public save uses extracted core", freshArgs, owner);
  const finalFirst = workspace("workspace-core-after-new-save", first);
  assertReceipt(newReceipt, freshArgs, finalFirst, "saved");
  assert.ok(newReceipt.document_revision > secondReceipt.document_revision);
  assert.equal(finalFirst.sections[0].content, freshArgs.p_sections[0].content);
  assert.deepEqual(finalFirst.sections[1], latest.sections[1]);
  assert.ok(finalFirst.sections[0].version_history.length > latest.sections[0].version_history.length);
  const newSnapshot = snapshot("workspace-core-before-new-replay");
  assert.deepEqual(await rpc("new public save exact retry", freshArgs, owner), { ...newReceipt, idempotent_replay: true });
  assert.deepEqual(await rpc("old save still replays after post-upgrade edit", first.createArgs, owner), historicalReplay);
  assert.deepEqual(snapshot("workspace-core-after-new-replays"), newSnapshot);
  // Direct PostgREST maps SQLSTATE class40 to HTTP500. This probe calls
  // PostgREST directly and also requires the exact database code and message.
  // https://docs.postgrest.org/en/v14/references/errors.html#http-status-codes
  await reject("workspace-core-stale-revision", () => rpc("new intent cannot reuse stale document revision",
    { ...secondArgs, p_idempotency_key: "core:new-intent:stale" }, owner,
    { expectedStatus: 500, expectedError: { code: "40001", message: "LEGACY_WORKSPACE_DOCUMENT_CONFLICT" } }));
  const otherAfter = workspace("workspace-core-other-owner-final", second);
  assertReceipt(second.createReceipt, second.createArgs, otherAfter, "created");
  const final = snapshot("workspace-core-final");
  assert.equal(final["public.outcomes"].length, 2); assert.equal(final["public.documents"].length, 2);
  assert.equal(final["public.sections"].length, 4); assert.equal(final["private.legacy_workspace_save_receipts"].length, 4);
  const receiptRows = readJson("workspace-core-independent-receipts", `select jsonb_agg(jsonb_build_object(
    'id',r.id,'user_id',r.user_id,'key',r.idempotency_key,'request_sha256',r.request_sha256,'result',r.result,
    'result_sha256',encode(extensions.digest(convert_to(r.result::text,'UTF8'),'sha256'),'hex'),
    'accepted_revision',r.accepted_document_revision,'result_revision',r.result_document_revision) order by r.id)
    from private.legacy_workspace_save_receipts r where r.user_id in (${ownerIds});`);
  for (const row of receiptRows) { assert.match(row.request_sha256, digest); assert.match(row.result_sha256, digest); }
  assert.equal(receiptRows.length, 4);
  for (const [user, args, expected] of [[owner, first.createArgs, first.createReceipt], [owner, secondArgs, secondReceipt],
    [other, second.createArgs, second.createReceipt], [owner, freshArgs, newReceipt]]) {
    const row = receiptRows.find(value => value.user_id === user.id && value.key === args.p_idempotency_key);
    assert.ok(row); assert.deepEqual(row.result, expected);
    assert.equal(row.accepted_revision, expected.accepted_document_revision); assert.equal(row.result_revision, expected.document_revision);
  }
  save("legacy-workspace-core-upgrade-summary.json", { contract_version: "legacy-workspace-core-upgrade-acceptance.1", project,
    predecessor: "20260908150000", forward: "20260908160000", through: "20260909105519", owners: users.map(user => user.id),
    publicOidPreserved: beforeProperties.oid, publicCatalogExceptBodyPreserved: true, historicalRowsPreserved: true,
    oldReceiptReplayedBeforeCurrentRevisionValidation: true, explicitCoreReplaysSameReceipt: true,
    omittedSiblingAndHistoryPreserved: true, directRoleDenials: direct, independentReceiptRows: receiptRows,
    freshRevision: newReceipt.document_revision, historicalReceiptRevision: historicalReplay.document_revision,
    httpChecks: checks.length, finalRowHashes: final,
    providerCalled: false, generationAttachmentOrAllowanceSettlementProven: false, hostedOrBrowserWorkflowProven: false });
  return { owners: 2, historicalReceipts: 3, finalReceipts: 4, httpChecks: checks.length };
}
