// Composes two exact upgrades in the existing disposable runner. No hosted use.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateLegacyPolicyUpgradePlan } from "./legacy-policy-upgrade-acceptance.mjs";
import { readUploadProbeBody } from "./workspace-upload-transport.mjs";

export const catalogueSeedFile = "supabase/migrations/20260908140000_complete_catalogue_persistence_seeds.sql";
export const catalogueSeedSha = "fca22da9bc8280d49ba38eb97eed8664b8385e59e19759e09d9b42b44de67350";
const baselineSha = "9e98621c7fe1fa6adf7524ba862e56d7330edd1d1b9ee76c7b0df79e7a32891d";
const sha = value => createHash("sha256").update(value).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const seedId = suffix => `11111111-0000-4000-8000-${suffix.padStart(12, "0")}`;
const complaintId = "22222222-0000-4000-8000-000000000082";

export function validateCatalogueUpgradePlan(manifest, currentSource, baselineBytes = readFileSync(
  new URL("./catalogue-upgrade-sql-baseline.json", import.meta.url))) {
  assert.equal(sha(baselineBytes), baselineSha, "Reviewed catalogue SQL baseline changed");
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.contract_version, "catalogue-upgrade-sql.1");
  assert.equal(baseline.source_run, "db-20260908140608693-35c7238e");
  const currentSql = Object.fromEntries(Object.entries(currentSource).filter(([file]) =>
    file.startsWith("supabase/migrations/") || file.startsWith("supabase/tests/")));
  assert.deepEqual(manifest, currentSql, "Catalogue upgrade must exercise all current SQL");
  assert.deepEqual(manifest, baseline.manifest, "Catalogue upgrade requires the exact reviewed SQL manifest");
  assert.equal(manifest[catalogueSeedFile], catalogueSeedSha);
  const prefixManifest = Object.fromEntries(Object.entries(manifest).filter(([file]) => file !== catalogueSeedFile));
  // Historical validator remains strict. Only this separately pinned composition
  // derives its exact prefix, after validating every current SQL input above.
  const policyPlan = validateLegacyPolicyUpgradePlan(prefixManifest, prefixManifest);
  const versions = [...policyPlan.versions, "20260908140000"];
  assert.equal(versions.length, 78);
  return { predecessor: policyPlan.predecessor, policyForward: policyPlan.forward,
    forward: "20260908140000", versions, policyPlan, prefixManifest, manifest,
    baselineSha, seedFile: catalogueSeedFile, seedSha: catalogueSeedSha };
}

export function assertCataloguePhase(plan, phase, actualManifest, heldSha) {
  assert.ok(phase === "full" || phase === "policy-prefix", "Unknown catalogue SQL phase");
  assert.deepEqual(actualManifest, phase === "full" ? plan.manifest : plan.prefixManifest,
    "Copied SQL differs from the exact catalogue phase");
  assert.equal(heldSha, phase === "full" ? null : catalogueSeedSha,
    "Held catalogue migration is missing, changed or present in the wrong phase");
}

export function readCatalogueSeedRows(bytes) {
  assert.equal(sha(bytes), catalogueSeedSha, "Catalogue migration bytes changed");
  const parts = bytes.toString("utf8").split("$catalogue_rows$");
  assert.equal(parts.length, 3);
  const rows = JSON.parse(parts[1]);
  assert.equal(rows.length, 37); assert.equal(new Set(rows.map(row => row.id)).size, 37);
  assert.equal(rows.filter(row => row.id === complaintId).length, 1);
  assert.equal(rows.filter(row => row.id === seedId("24")).length, 1);
  return rows;
}

export function assertCatalogueMigrationResult(result, expectedConflict) {
  assert.ok(!result.error && !result.signal, "Catalogue SQL probe did not finish normally");
  if (expectedConflict) {
    assert.match(expectedConflict, /^CATALOGUE_TEMPLATE_IDENTITY_CONFLICT:[0-9a-f-]{36}:[a-z0-9-]+$/);
    assert.equal(result.status, 3, "Expected the actual seed transaction to reject its collision");
    const errors = String(result.stderr).split("\n").filter(line => /ERROR:/.test(line));
    assert.equal(errors.length, 1, "Expected one precise seed conflict");
    assert.ok(errors[0].endsWith(`ERROR:  23505: ${expectedConflict}`), "Wrong seed failure is not collision proof");
  } else assert.equal(result.status, 0, "Actual seed replay failed");
}

export async function exerciseCatalogueUpgrade({ project, workdir, env, sql, applyMigration,
  probeMigration, migrationBytes, checkTarget, save }) {
  checkTarget();
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  const rows = readCatalogueSeedRows(migrationBytes);
  const origin = "http://127.0.0.1:58321";
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(!status.error && !status.signal && status.status === 0, "Disposable catalogue status failed");
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error("Invalid disposable catalogue status"); }
  assert.equal(config.API_URL, origin, "Unexpected API origin; no request sent");
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"]) assert.ok(typeof config[key] === "string" && config[key].length > 20);
  const checks = [];
  async function request(label, path, body, { token = config.SERVICE_ROLE_KEY, error, get = false } = {}) {
    checkTarget();
    const url = new URL(path, origin); assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/"));
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { method: get ? "GET" : "POST", redirect: "error", signal, cache: "no-store",
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(get ? {} : { body: JSON.stringify(body) }) });
    const raw = await readUploadProbeBody(response.body, 256 * 1024, signal);
    let data;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch { throw new Error(`${label}: invalid local JSON response`); }
    checks.push({ label, path: url.pathname, status: response.status });
    save("catalogue-upgrade-http-checks.json", checks);
    if (error) {
      assert.equal(response.status, error.status, `${label}: wrong HTTP failure`);
      assert.equal(data.code, error.code, `${label}: wrong SQL failure`);
      assert.equal(data.message, error.message, `${label}: wrong boundary`);
    } else assert.equal(response.status, 200, `${label}: unexpected HTTP status`);
    return data;
  }
  const rpc = (label, name, args, user, error) => request(label, `/rest/v1/rpc/${name}`, args,
    { token: user.token, error });
  const owners = [];
  for (const slot of ["a", "b"]) {
    const email = `${project}-catalogue-${slot}@example.invalid`;
    const password = randomBytes(30).toString("base64url");
    const created = await request(`create catalogue owner ${slot}`, "/auth/v1/admin/users", { email, password, email_confirm: true });
    assert.match(created.id, uuid);
    const session = await request(`authenticate catalogue owner ${slot}`, "/auth/v1/token?grant_type=password",
      { email, password }, { token: config.ANON_KEY });
    assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
    assert.ok(typeof session.access_token === "string" && session.access_token.length > 20);
    owners.push({ id: created.id, token: session.access_token });
  }
  const [owner, other] = owners; assert.notEqual(owner.id, other.id);
  const ownerIds = owners.map(user => literal(user.id)).join(",");
  const readJson = (label, query) => JSON.parse(sql(label, query));
  const tableRows = (label, table, predicate = "true", order = "id") => readJson(label,
    `select coalesce(jsonb_agg(to_jsonb(r) order by r.${order}),'[]'::jsonb) from ${table} r where ${predicate};`);
  const templates = label => tableRows(label, "public.templates");
  const workspaceRows = label => Object.fromEntries([
    "public.outcomes", "public.documents", "public.sections", "private.guest_workspace_imports", "private.legacy_workspace_save_receipts",
  ].map((table, index) => [table, tableRows(`${label}-${index}`, table, `r.user_id in (${ownerIds})`)]));
  const policyRows = label => Object.fromEntries([
    ["private.document_allowance_reservations", "id"], ["private.document_allowance_results", "reservation_id"],
    ["private.legacy_generation_execution_claims", "reservation_id"], ["public.usage_ledger", "id"],
  ].map(([table, order], index) => [table, tableRows(`${label}-${index}`, table, "true", order)]));
  const originalTemplates = templates("catalogue-historical-templates");
  assert.equal(originalTemplates.length, 49);
  assert.equal(originalTemplates.filter(row => row.id === seedId("1") && row.is_published).length, 1);
  const policyBefore = policyRows("catalogue-policy-before");
  assert.equal(policyBefore["private.document_allowance_reservations"].length, 3);
  assert.equal(policyBefore["private.document_allowance_results"].length, 2);
  assert.equal(policyBefore["private.legacy_generation_execution_claims"].length, 3);
  assert.equal(policyBefore["public.usage_ledger"].length, 2);

  function guest(user, templateId, label) {
    const outcomeId = randomUUID(), documentId = randomUUID();
    const names = templateId === complaintId ? ["The Issue", "Impact", "Requested Resolution", "Closing"] :
      ["Contact Details", "Professional Summary", "Work Experience", "Education & Qualifications", "Key Skills", "Referees"];
    return { p_idempotency_key: `catalogue:${label}`, p_outcome_id: outcomeId, p_document_id: documentId,
      p_title: label, p_situation_text: "Synthetic preserved device workspace", p_recommendation_payload: {
        primary: { template_id: templateId === complaintId ? "complaint-letter" : "resume", reason: "Synthetic fixture" }, alternatives: [],
      }, p_template_id: templateId, p_document_status: "draft", p_sections: names.map((name, index) => ({
        id: randomUUID(), document_id: documentId, user_id: user.id, name, order_index: index,
        content: `Preserved owner wording for ${name}.`, status: "edited", is_required: true,
        version_history: [{ content: `Earlier wording for ${name}.`, saved_at: "2026-09-01T01:00:00.000Z", label: "Imported original", origin: "imported_original" }],
        created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T01:00:00.000Z",
      })) };
  }
  async function guestRoundtrip(args, user, label) {
    const accepted = await rpc(`${label} commit`, "commit_guest_workspace_import", args, user);
    assert.deepEqual(accepted, { status: "committed", outcome_id: args.p_outcome_id,
      document_id: args.p_document_id, idempotent_replay: false });
    const beforeReplay = workspaceRows(`${label}-before-replay`);
    for (const section of args.p_sections) {
      const stored = beforeReplay["public.sections"].find(row => row.id === section.id);
      for (const key of ["id", "document_id", "user_id", "name", "order_index", "content", "status", "is_required", "version_history"])
        assert.deepEqual(stored[key], section[key], `${label}: persisted section differs at ${key}`);
    }
    const replay = await rpc(`${label} exact replay`, "commit_guest_workspace_import", args, user);
    assert.deepEqual(replay, { ...accepted, idempotent_replay: true });
    assert.deepEqual(workspaceRows(`${label}-after-replay`), beforeReplay);
    const owned = await request(`${label} owned document read`, `/rest/v1/documents?id=eq.${args.p_document_id}&select=id,user_id,template_id`, null,
      { token: user.token, get: true });
    assert.deepEqual(owned, [{ id: args.p_document_id, user_id: user.id, template_id: args.p_template_id }]);
  }
  const historical = guest(owner, seedId("1"), "historical-resume");
  const otherHistorical = guest(other, seedId("1"), "other-resume");
  await guestRoundtrip(historical, owner, "historical");
  await guestRoundtrip(otherHistorical, other, "other-historical");
  const beforeHistoricalSave = workspaceRows("catalogue-before-historical-save");
  const historicalDocument = beforeHistoricalSave["public.documents"].find(row => row.id === historical.p_document_id);
  const historicalSections = beforeHistoricalSave["public.sections"].filter(row => row.document_id === historical.p_document_id)
    .sort((left, right) => left.order_index - right.order_index);
  assert.equal(historicalSections.length, 6);
  const historicalExpected = Object.fromEntries(["title", "status", "template_id", "unresolved_placeholders"]
    .map(key => [key, historicalDocument[key]]));
  const historicalSaveArgs = { p_idempotency_key: "catalogue:historical-saved-title", p_outcome_id: historical.p_outcome_id,
    p_document_id: historical.p_document_id, p_expected_document_revision: historicalDocument.current_revision,
    p_expected_document: historicalExpected, p_document: { ...historicalExpected, title: "Preserved saved resume title" },
    p_sections: historicalSections.map(section => {
      const metadata = { name: section.name, order_index: section.order_index, status: section.status, is_required: section.is_required };
      return { id: section.id, desired: metadata,
        expected: { ...metadata, revision: section.revision, content_sha256: sha(section.content) } };
    }) };
  const historicalSave = await rpc("historical title saved before migration", "save_own_legacy_workspace_v1", historicalSaveArgs, owner);
  assert.equal(historicalSave.contract_version, "legacy-workspace-save.v1"); assert.equal(historicalSave.state, "saved");
  assert.equal(historicalSave.idempotent_replay, false); assert.equal(historicalSave.document_id, historical.p_document_id);
  assert.equal(historicalSave.document_revision, historicalDocument.current_revision + 1);
  const history = workspaceRows("catalogue-history-before");
  assert.deepEqual(history["public.sections"], beforeHistoricalSave["public.sections"], "Saving the title altered historical section content or provenance");
  assert.equal(history["public.documents"].find(row => row.id === historical.p_document_id).title, "Preserved saved resume title");
  assert.equal(history["private.legacy_workspace_save_receipts"].length, 1);
  assert.deepEqual(history["private.legacy_workspace_save_receipts"][0].result, historicalSave);
  assert.deepEqual(await rpc("historical save exact replay before migration", "save_own_legacy_workspace_v1", historicalSaveArgs, owner),
    { ...historicalSave, idempotent_replay: true });
  assert.deepEqual(workspaceRows("catalogue-history-after-save-replay"), history);

  const identical = rows.find(row => row.id === complaintId);
  const conflictSource = rows.find(row => row.id === seedId("24"));
  const conflict = { ...conflictSource, is_published: false };
  const fields = Object.keys(identical).filter(key => key !== "slug");
  for (const field of fields) assert.match(field, /^[a-z_]+$/);
  const insertSeed = (label, row) => sql(label, `insert into public.templates (${fields.join(",")},created_at)
    select ${fields.map(field => `r.${field}`).join(",")},'2025-01-02T03:04:05Z'::timestamptz
    from jsonb_populate_record(null::public.templates,${literal(JSON.stringify(row))}::jsonb) r;`);
  insertSeed("catalogue-identical-target-fixture", identical);
  insertSeed("catalogue-conflicting-target-fixture", conflict);
  const beforeCollision = templates("catalogue-before-collision"); assert.equal(beforeCollision.length, 51);
  const collisionMessage = `CATALOGUE_TEMPLATE_IDENTITY_CONFLICT:${conflict.id}:${conflict.slug}`;
  probeMigration("catalogue-collision-probe", collisionMessage);
  assert.deepEqual(templates("catalogue-after-collision"), beforeCollision);
  assert.deepEqual(workspaceRows("catalogue-history-after-collision"), history);
  assert.deepEqual(policyRows("catalogue-policy-after-collision"), policyBefore);
  const conflictStored = beforeCollision.find(row => row.id === conflict.id);
  assert.equal(Number(sql("catalogue-remove-exact-synthetic-conflict", `with removed as (
    delete from public.templates t where t.id=${literal(conflict.id)}::uuid
      and to_jsonb(t)=${literal(JSON.stringify(conflictStored))}::jsonb
      and not exists(select 1 from public.documents d where d.template_id=t.id) returning t.id
    ) select count(*) from removed;`)), 1);
  const beforeUpgrade = templates("catalogue-before-forward"); assert.equal(beforeUpgrade.length, 50);
  applyMigration();
  const afterUpgrade = templates("catalogue-after-forward"); assert.equal(afterUpgrade.length, 86);
  for (const row of beforeUpgrade) assert.deepEqual(afterUpgrade.find(value => value.id === row.id), row,
    `Seed migration changed an existing template: ${row.id}`);
  for (const row of rows) {
    const actual = { ...afterUpgrade.find(value => value.id === row.id) }; delete actual.created_at;
    const expected = { ...row }; delete expected.slug;
    assert.deepEqual(actual, expected, `New seed differs from its reviewed metadata: ${row.id}`);
  }
  assert.deepEqual(workspaceRows("catalogue-history-after-forward"), history);
  assert.deepEqual(policyRows("catalogue-policy-after-forward"), policyBefore);
  await guestRoundtrip(guest(owner, complaintId, "new-complaint"), owner, "complaint");
  // Reopen and replay a historical operation again after the migration.
  const beforeHistoricalReplay = workspaceRows("catalogue-before-historical-save-replay");
  assert.deepEqual(await rpc("historical post-upgrade replay", "commit_guest_workspace_import", historical, owner),
    { status: "committed", outcome_id: historical.p_outcome_id, document_id: historical.p_document_id, idempotent_replay: true });
  assert.deepEqual(await rpc("historical save post-upgrade replay", "save_own_legacy_workspace_v1", historicalSaveArgs, owner),
    { ...historicalSave, idempotent_replay: true });
  assert.deepEqual(workspaceRows("catalogue-after-historical-save-replay"), beforeHistoricalReplay);
  const outcomeId = randomUUID(), documentId = randomUUID();
  sql("catalogue-create-owned-selection-outcome", `insert into public.outcomes(id,user_id,situation_text,recommendation_payload,status,is_saved)
    values(${literal(outcomeId)}::uuid,${literal(owner.id)}::uuid,'Synthetic selection criteria',
      '{"primary":{"template_id":"selection-criteria-response","reason":"Synthetic fixture"},"alternatives":[]}', 'in_progress',true);`);
  assert.equal(Number(sql("catalogue-owned-selection-positive", `select count(*) from public.outcomes where id=${literal(outcomeId)}::uuid and user_id=${literal(owner.id)}::uuid;`)), 1);
  const saveArgs = { p_idempotency_key: "catalogue:selection", p_outcome_id: outcomeId, p_document_id: documentId,
    p_expected_document_revision: 0, p_expected_document: null,
    p_document: { title: "Selection criteria response", status: "draft", template_id: seedId("24"), unresolved_placeholders: [] },
    p_sections: ["Criterion Heading", "Summary Claim", "Evidence Example", "Outcome & Relevance"].map((name, index) => ({
      id: randomUUID(), expected: null, desired: { name, order_index: index, status: "draft", is_required: true }, content: `Preserved candidate wording for ${name}.`,
    })) };
  const saved = await rpc("new selection save", "save_own_legacy_workspace_v1", saveArgs, owner);
  assert.deepEqual(Object.keys(saved).sort(), ["contract_version", "state", "outcome_id", "document_id", "idempotency_key",
    "accepted_document_revision", "document_revision", "document_status", "document_approved_revision", "document_updated_at",
    "sections", "committed_at", "idempotent_replay"].sort());
  assert.equal(saved.contract_version, "legacy-workspace-save.v1"); assert.equal(saved.state, "created");
  assert.equal(saved.document_id, documentId); assert.equal(saved.outcome_id, outcomeId);
  assert.equal(saved.document_revision, 1); assert.equal(saved.idempotent_replay, false);
  assert.equal(saved.accepted_document_revision, 0); assert.equal(saved.document_approved_revision, null);
  assert.equal(saved.idempotency_key, saveArgs.p_idempotency_key); assert.equal(saved.sections.length, 4);
  for (const section of saveArgs.p_sections) {
    const receipt = saved.sections.find(value => value.section_id === section.id);
    assert.ok(receipt, "Missing saved section receipt");
    assert.deepEqual(Object.keys(receipt).sort(), ["section_id", "status", "revision", "approved_revision", "content_sha256", "updated_at"].sort());
    assert.equal(receipt.revision, 1); assert.equal(receipt.approved_revision, null);
    assert.equal(receipt.content_sha256, sha(section.content));
  }
  const savedRows = workspaceRows("catalogue-selection-before-replay");
  assert.deepEqual(await rpc("new selection exact replay", "save_own_legacy_workspace_v1", saveArgs, owner),
    { ...saved, idempotent_replay: true });
  assert.deepEqual(workspaceRows("catalogue-selection-after-replay"), savedRows);
  const document = savedRows["public.documents"].find(row => row.id === documentId);
  assert.equal(document.template_id, seedId("24")); assert.equal(document.user_id, owner.id);
  assert.deepEqual(await request("owner can read saved selection", `/rest/v1/documents?id=eq.${documentId}&select=id,user_id,template_id`, null,
    { token: owner.token, get: true }), [{ id: documentId, user_id: owner.id, template_id: seedId("24") }]);
  for (const section of saveArgs.p_sections) {
    const stored = savedRows["public.sections"].find(row => row.id === section.id);
    assert.equal(stored.document_id, documentId); assert.equal(stored.user_id, owner.id);
    assert.equal(stored.content, section.content); assert.equal(stored.name, section.desired.name);
    assert.equal(stored.order_index, section.desired.order_index);
  }
  const unknown = "eeeeeeee-0000-4000-8000-000000000001";
  const unknownArgs = guest(owner, unknown, "unknown-template");
  await rpc("unknown guest template rejected", "commit_guest_workspace_import", unknownArgs, owner,
    { status: 400, code: "P0001", message: `GUEST_IMPORT_TEMPLATE_NOT_FOUND:${unknown}` });
  const crossGuest = { ...guest(owner, seedId("1"), "cross-owner-guest"), p_outcome_id: otherHistorical.p_outcome_id };
  await rpc("cross-owner guest collision rejected", "commit_guest_workspace_import", crossGuest, owner,
    { status: 400, code: "P0001", message: `GUEST_IMPORT_OUTCOME_ID_COLLISION:${otherHistorical.p_outcome_id}` });
  await rpc("cross-owner workspace rejected", "save_own_legacy_workspace_v1", { ...saveArgs, p_idempotency_key: "catalogue:cross-owner" }, other,
    { status: 403, code: "42501", message: "LEGACY_WORKSPACE_UNAVAILABLE" });
  // Use the real saved revision and exact persisted metadata so the missing FK,
  // rather than a stale/create conflict, is the expected failure.
  const expectedDocument = Object.fromEntries(["title", "status", "template_id", "unresolved_placeholders"].map(key => [key, document[key]]));
  const unknownSave = { ...saveArgs, p_idempotency_key: "catalogue:unknown-template-save",
    p_expected_document_revision: document.current_revision, p_expected_document: expectedDocument,
    p_document: { ...expectedDocument, template_id: unknown }, p_sections: saveArgs.p_sections.map(section => {
      const stored = savedRows["public.sections"].find(row => row.id === section.id);
      return { ...section, expected: { name: stored.name, order_index: stored.order_index, status: stored.status,
        is_required: stored.is_required, revision: stored.revision, content_sha256: sha(stored.content) } };
    }) };
  await rpc("unknown saved template rejected", "save_own_legacy_workspace_v1", unknownSave, owner,
    { status: 409, code: "23503", message: "LEGACY_WORKSPACE_TEMPLATE_UNAVAILABLE" });
  const crossRead = await request("other owner cannot read selection", `/rest/v1/documents?id=eq.${documentId}&select=id`, null,
    { token: other.token, get: true }); assert.deepEqual(crossRead, []);
  assert.deepEqual(workspaceRows("catalogue-after-denials"), savedRows);
  probeMigration("catalogue-idempotent-file-replay", null);
  assert.deepEqual(templates("catalogue-after-file-replay"), afterUpgrade);
  assert.deepEqual(workspaceRows("catalogue-history-after-file-replay"), savedRows);
  assert.deepEqual(policyRows("catalogue-policy-after-file-replay"), policyBefore);
  save("catalogue-upgrade-proofs.json", { contract_version: "catalogue-upgrade-proof.1", passed: true,
    predecessor: "20260908130000", forward: "20260908140000", seed_sha256: catalogueSeedSha,
    historical_templates_preserved: originalTemplates.length, identical_target_preserved: identical.id,
    collision_sqlstate: "23505", reviewed_seed_rows: rows.length, resulting_templates: afterUpgrade.length,
    historical_workspaces_preserved: 2, historical_guest_receipts_preserved: 2, historical_save_receipts_preserved: 1,
    new_workspaces_persisted: 2, http_checks: checks.length,
    policy_rows_preserved: Object.fromEntries(Object.entries(policyBefore).map(([table, values]) => [table, values.length])),
    scope: "Real local Auth/PostgREST, exact seed collision/replay and independent SQL. No browser, provider, export or hosted proof." });
}
