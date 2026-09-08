// Local-only acceptance, invoked by the existing disposable database runner.
// This exercises Auth/PostgREST/Storage, not Edge/provider/browser execution.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const origin = 'http://127.0.0.1:58321';
const predecessor = '20260907053000';
const forward = '20260907081500';
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => { assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); return value; };
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function validateV3UpgradePlan(manifest, currentSource) {
  const currentSql = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')));
  assert.deepEqual(manifest, currentSql, 'V3 must exercise all current SQL without the old slice filter');
  const versions = [];
  for (const [file, digest] of Object.entries(manifest)) {
    assert.match(file, /^supabase\/(?:migrations|tests)\/[^/]+\.sql$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (file.startsWith('supabase/migrations/')) {
      assert.match(file, /^supabase\/migrations\/\d{14}_[^/]+\.sql$/);
      versions.push(file.split('/').at(-1).slice(0, 14));
    }
  }
  versions.sort();
  assert.equal(new Set(versions).size, versions.length, 'Duplicate migration version');
  assert.ok(versions.includes(predecessor), 'V3 predecessor is missing');
  assert.deepEqual(versions.filter(version => version > predecessor), [forward], 'V3 permits exactly its reviewed forward migration');
  return { predecessor, forward, versions };
}

export function validateRtfAliasUpgradePlan(manifest, currentSource) {
  const currentSql = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')));
  assert.deepEqual(manifest, currentSql, 'RTF alias must exercise all current SQL');
  const versions = [];
  for (const [file, digest] of Object.entries(manifest)) {
    assert.match(file, /^supabase\/(?:migrations|tests)\/[^/]+\.sql$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (file.startsWith('supabase/migrations/')) {
      assert.match(file, /^supabase\/migrations\/\d{14}_[^/]+\.sql$/);
      versions.push(file.split('/').at(-1).slice(0, 14));
    }
  }
  versions.sort();
  assert.equal(new Set(versions).size, versions.length, 'Duplicate migration version');
  assert.equal(manifest['supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql'],
    'effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727', 'Accepted v3 predecessor changed');
  assert.deepEqual(versions.filter(version => version > '20260907081500'), ['20260907094500'],
    'RTF alias permits exactly its reviewed forward migration');
  assert.ok(manifest['supabase/migrations/20260907094500_upload_rtf_mime_alias.sql']);
  assert.ok(manifest['supabase/tests/upload_rtf_mime_alias.test.sql']);
  return { predecessor: '20260907081500', forward: '20260907094500', versions };
}

export function validateUploadFallbackUpgradePlan(manifest, currentSource) {
  const currentSql = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')));
  assert.deepEqual(manifest, currentSql, 'Fallback must exercise all current SQL');
  const versions = [];
  for (const [file, digest] of Object.entries(manifest)) {
    assert.match(file, /^supabase\/(?:migrations|tests)\/[^/]+\.sql$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (file.startsWith('supabase/migrations/')) {
      assert.match(file, /^supabase\/migrations\/\d{14}_[^/]+\.sql$/);
      versions.push(file.split('/').at(-1).slice(0, 14));
    }
  }
  versions.sort();
  assert.equal(new Set(versions).size, versions.length, 'Duplicate migration version');
  for (const [file, hash] of [
    ['20260907081500_upload_source_checkpoint_v3.sql', 'effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727'],
    ['20260907094500_upload_rtf_mime_alias.sql', '143fa67061b164c87529550b2aa9db5e2e83395854fd97d69fd1c604de520804'],
    ['20260907102000_upload_fallback_settlement.sql', '8fd4a9d24e3ee6c8c78c18119fc55843d97733da08079f36eda8bab01455147e'],
  ]) assert.equal(manifest[`supabase/migrations/${file}`], hash, 'Reviewed fallback upgrade input changed');
  assert.deepEqual(versions.filter(version => version > '20260907094500'), ['20260907102000'],
    'Fallback permits exactly its reviewed forward migration');
  assert.ok(manifest['supabase/tests/upload_fallback_settlement.test.sql']);
  return { predecessor: '20260907094500', forward: '20260907102000', versions };
}

export function validateSourceImportUpgradePlan(manifest, currentSource) {
  const currentSql = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')));
  assert.deepEqual(manifest, currentSql, 'Source import must exercise all current SQL');
  const versions = [];
  for (const [file, digest] of Object.entries(manifest)) {
    assert.match(file, /^supabase\/(?:migrations|tests)\/[^/]+\.sql$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (file.startsWith('supabase/migrations/')) {
      assert.match(file, /^supabase\/migrations\/\d{14}_[^/]+\.sql$/);
      versions.push(file.split('/').at(-1).slice(0, 14));
    }
  }
  versions.sort();
  assert.equal(new Set(versions).size, versions.length, 'Duplicate migration version');
  for (const [file, hash] of [
    ['20260907081500_upload_source_checkpoint_v3.sql', 'effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727'],
    ['20260907094500_upload_rtf_mime_alias.sql', '143fa67061b164c87529550b2aa9db5e2e83395854fd97d69fd1c604de520804'],
    ['20260907102000_upload_fallback_settlement.sql', '8fd4a9d24e3ee6c8c78c18119fc55843d97733da08079f36eda8bab01455147e'],
    ['20260907112000_upload_source_import_boundary.sql', '16fe5041cf52351221a1318ab1bdbbc7006196683f72ed650fd253245569294a'],
  ]) assert.equal(manifest[`supabase/migrations/${file}`], hash, 'Reviewed source import upgrade input changed');
  assert.deepEqual(versions.filter(version => version > '20260907102000'), ['20260907112000'],
    'Source import permits exactly its reviewed forward migration');
  assert.ok(manifest['supabase/tests/upload_source_import_boundary.test.sql']);
  return { predecessor: '20260907102000', forward: '20260907112000', versions };
}

export function assertStorageRejection(status, body, kind) {
  // Supabase documents both current and legacy error envelopes. A server fault,
  // timeout, successful empty body or arbitrary client error is not denial proof.
  assert.ok(['duplicate', 'denied'].includes(kind));
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.ok((kind === 'duplicate' ? [400, 409] : [400, 403, 404]).includes(status),
    'Expected Storage rejection, not service failure');
  const code = body?.code ?? body?.error;
  const accepted = kind === 'duplicate'
    ? ['ResourceAlreadyExists', 'KeyAlreadyExists', 'already_exists', 'Duplicate']
    : ['NoSuchKey', 'NoSuchBucket', 'AccessDenied', 'not_found', 'unauthorized', 'Unauthorized'];
  assert.ok(accepted.includes(code), `Unexpected Storage ${kind} error code`);
  return code;
}

export const exerciseUploadSourceV3Upgrade = options => exerciseSourceUpgrade(options, false);
export const exerciseUploadRtfAliasUpgrade = options => exerciseSourceUpgrade(options, true);
export const exerciseUploadFallbackUpgrade = options => exerciseSourceUpgrade(options, false, true);
export const exerciseSourceImportUpgrade = options => exerciseSourceUpgrade(options, false, false, true);

async function exerciseSourceUpgrade({ project, workdir, env, sql, applyMigration, checkTarget, save }, aliasUpgrade, fallbackUpgrade = false, sourceImportUpgrade = false) {
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  checkTarget();
  const status = spawnSync('supabase', ['--workdir', workdir, '--agent', 'no', 'status', '-o', 'json'], {
    cwd: workdir, env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL',
    maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(status.status, 0, 'Disposable local status failed');
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error('Invalid disposable status JSON'); }
  assert.equal(config.API_URL, origin);
  assert.equal(typeof config.ANON_KEY, 'string');
  assert.equal(typeof config.SERVICE_ROLE_KEY, 'string');
  const checks = []; const originals = [];
  async function request(label, path, { token = config.SERVICE_ROLE_KEY, method = 'POST', body,
    bytes, mime, expected = 200, binary = false, storageRejection } = {}) {
    checkTarget();
    const url = new URL(path, origin);
    assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/auth/v1/') ||
      /^\/storage\/v1\/object\/(?:public\/)?original-documents\//.test(url.pathname));
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}`,
        'Content-Type': mime ?? 'application/json', ...(bytes ? { 'x-upsert': 'false' } : {}) },
      ...(bytes ? { body: bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.body);
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength;
        assert.ok(length <= 128 * 1024, 'Local fixture response exceeds its bound');
        chunks.push(next.value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const raw = Buffer.concat(chunks);
    const check = { label, path: url.pathname, status: response.status };
    checks.push(check); save('upload-v3-http-checks.json', checks);
    if (binary && !storageRejection) {
      assert.equal(response.status, expected, `${label}: unexpected status`);
      return raw;
    }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { throw new Error(`${label}: invalid UTF-8 JSON`); }
    if (storageRejection) check.errorCode = assertStorageRejection(response.status, data, storageRejection);
    else assert.equal(response.status, expected, `${label}: unexpected status`);
    save('upload-v3-http-checks.json', checks);
    return data;
  }
  const rpc = (label, name, body, options = {}) => request(label, `/rest/v1/rpc/${name}`, { ...options, body });
  const users = [];
  for (const slot of ['a', 'b']) {
    const email = `${project}-v3-${slot}@example.invalid`; const password = randomBytes(30).toString('base64url');
    const user = await request(`create owner ${slot}`, '/auth/v1/admin/users', { body: { email, password, email_confirm: true } });
    uuid(user.id);
    const session = await request(`authenticate owner ${slot}`, '/auth/v1/token?grant_type=password', {
      token: config.ANON_KEY, body: { email, password },
    });
    assert.equal(session.user.id, user.id); assert.equal(typeof session.access_token, 'string');
    users.push({ id: user.id, token: session.access_token });
  }
  const [owner, other] = users; assert.notEqual(owner.id, other.id);
  const docx = readFileSync(`${workdir}/source-preservation.docx`);
  const docxManifest = JSON.parse(readFileSync(`${workdir}/source-manifest.json`, 'utf8'));
  assert.equal(sha(docx), docxManifest.archiveSha256); assert.equal(docx.length, docxManifest.archiveByteLength);
  const rtf = readFileSync(`${workdir}/rtf-appkit-original.rtf`);
  const rtfEvidence = JSON.parse(readFileSync(`${workdir}/rtf-appkit-producer-green.json`, 'utf8'));
  assert.equal(sha(rtf), rtfEvidence.originalSha256); assert.equal(rtf.length, rtfEvidence.originalByteLength);
  assert.equal(sha(rtfEvidence.extractedText), rtfEvidence.manifest.extractedTextSha256);
  const text = 'Retained TextEdit wording — 日本語 😀\nSecond paragraph.';
  const fixtures = {
    ...(sourceImportUpgrade ? { pdf: { bytes: readFileSync(`${workdir}/position-left.pdf`), manifest: null,
      text: 'Controlled PDF preview', format: 'pdf', mime: 'application/pdf', extension: 'pdf' } } : {}),
    docx: { bytes: docx, manifest: docxManifest, text: 'Format protected document', format: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' },
    rtf: { bytes: rtf, manifest: rtfEvidence.manifest, text: rtfEvidence.extractedText, format: 'rtf', mime: 'application/rtf', extension: 'rtf' },
    text: { bytes: Buffer.from(text), manifest: null, text, format: 'text', mime: 'text/plain', extension: 'txt' },
    textedit: { bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
      manifest: null, text, format: 'text', mime: 'text/plain', extension: 'txt' },
    md: { bytes: Buffer.from('# Retained heading\n\nOriginal **wording**.'), manifest: null,
      text: '# Retained heading\n\nOriginal **wording**.', format: 'text', mime: 'text/markdown', extension: 'md' },
  };
  const rowFor = (label, fixture, version, user = owner) => ({ ...fixture, id: randomUUID(),
    filename: `${label}.${fixture.extension}`, user, requestSha: sha(`${project}/${label}`),
    contentSha: sha(fixture.bytes), byteLength: fixture.bytes.length, version,
    policy: version === 'upload-extraction.3' ? 'upload-resource-policy.2' : 'upload-resource-policy.1' });
  const pathFor = row => `${row.user.id}/${row.id}/${row.filename}`;
  const objectRoute = row => `/storage/v1/object/original-documents/${pathFor(row).split('/').map(encodeURIComponent).join('/')}`;
  const identity = row => ({ p_upload_id: row.id, p_user_id: row.user.id, p_request_sha256: row.requestSha, p_claim_token: row.token });
  const claimArgs = (row, version = row.version) => ({ p_upload_id: row.id, p_user_id: row.user.id,
    p_storage_path: pathFor(row), p_file_type: row.mime, p_file_name: row.filename,
    p_file_size_bytes: row.byteLength, p_request_sha256: row.requestSha, p_content_sha256: row.contentSha,
    ...(version ? { p_extraction_contract_version: version } : {}) });
  const recordArgs = row => ({ ...identity(row), p_content_sha256: row.contentSha,
    p_extracted_text_sha256: sha(row.text), p_extracted_text: row.text, p_format: row.format,
    p_truncated: row.truncated ?? false, p_policy_version: row.policy,
    ...(row.version && row.version !== 'upload-extraction.1' ? {
      p_extraction_contract_version: row.version, p_source_manifest: row.manifest,
    } : {}) });
  const readCheckpoint = row => rpc('read exact checkpoint', 'get_upload_extraction_checkpoint', identity(row));
  async function advance(row, expected, next) {
    const result = await rpc('advance retained upload', 'advance_upload_ingest', {
      ...identity(row), p_expected_stage: expected, p_next_stage: next,
    });
    assert.equal(result.outcome, 'advanced'); assert.equal(result.stage, next);
  }
  async function readOriginal(row, label = 'owner reads exact original bytes') {
    const bytes = await request(label, objectRoute(row), { token: row.user.token, method: 'GET', binary: true });
    assert.equal(bytes.length, row.byteLength); assert.equal(sha(bytes), row.contentSha);
    assert.ok(bytes.equals(row.bytes), 'Original bytes changed');
  }
  async function retain(row) {
    const stored = await request('service retains original without upsert', objectRoute(row), {
      bytes: row.bytes, mime: row.storageMime ?? row.mime });
    assert.equal(stored.Key, `original-documents/${pathFor(row)}`);
    originals.push({ uploadId: row.id, ownerId: row.user.id, path: pathFor(row), length: row.byteLength, sha256: row.contentSha });
    save('upload-v3-originals.json', originals);
    await readOriginal(row);
  }
  async function prepare(row) {
    const claim = await rpc('claim exact accepted contract', 'claim_upload_ingest',
      claimArgs(row, row.version === 'upload-extraction.1' ? null : row.version));
    assert.equal(claim.outcome, 'accepted'); row.token = uuid(claim.claim_token);
    assert.equal(claim.extraction_contract_version, row.version === 'upload-extraction.1' ? undefined : row.version);
    await advance(row, 'prepared', 'storage_dispatched'); await retain(row);
    await advance(row, 'storage_dispatched', 'storage_completed');
  }
  const responseFor = row => ({ ...(row.execution ? { credit_fallback: row.execution } : {}), upload_id: row.id, storage_path: pathFor(row), extracted_text: row.text,
    original_retained: true, classification_status: 'completed', extraction_format: row.format,
    resource_policy_version: row.policy, confirm_payload: { summary: 'Controlled classification fixture',
      document_type: 'document', filename: row.filename, char_count: row.text.length, truncated: row.truncated ?? false,
      structure: [{ title: 'Document', items: ['Synthetic wording'] }] } });
  const settlement = row => ({ ...identity(row), p_ingest_status: 'completed', p_http_status: 200,
    p_response: responseFor(row), p_extracted_text: row.text, p_error_code: null, p_extracted_payload: {
      ...(row.execution ? { credit_fallback: row.execution } : {}),
      truncated: row.truncated ?? false, original_retained: true, classification_status: 'completed',
      extraction_format: row.format, resource_policy_version: row.policy,
    } });
  async function complete(row) {
    await advance(row, 'storage_completed', 'provider_dispatched');
    assert.equal((await rpc('settle exact retained checkpoint', 'settle_upload_ingest', settlement(row))).outcome, 'settled');
    row.response = responseFor(row);
  }

  const historicalImports = [];
  const importArgs = (row, wording = `Owner reviewed ${row.filename}`) => ({ p_upload_id: row.id,
    p_outcome_id: randomUUID(), p_document_id: randomUUID(), p_title: row.filename,
    p_situation_text: 'Synthetic retained source import',
    p_recommendation_payload: { primary: { template_id: 'imported_document', reason: row.filename } },
    p_sections: [{ id: randomUUID(), name: 'Document', order_index: 0, content: wording, status: 'draft',
      version_history: [{ content: wording, saved_at: new Date().toISOString(), origin: 'user_edit', label: 'Synthetic owner review' }],
      is_required: true }] });
  const importRpc = (label, args, token = owner.token, expected = 200) =>
    rpc(label, 'commit_document_import', args, { token, expected });
  const importSnapshot = label => JSON.parse(sql(label, `select json_build_object(
    'uploads',(select coalesce(json_agg(to_jsonb(u) order by id),'[]') from public.uploads u where user_id in (${users.map(u => literal(u.id)).join(',')})),
    'outcomes',(select coalesce(json_agg(to_jsonb(o) order by id),'[]') from public.outcomes o where user_id in (${users.map(u => literal(u.id)).join(',')})),
    'documents',(select coalesce(json_agg(to_jsonb(d) order by id),'[]') from public.documents d where user_id in (${users.map(u => literal(u.id)).join(',')})),
    'sections',(select coalesce(json_agg(to_jsonb(s) order by id),'[]') from public.sections s where user_id in (${users.map(u => literal(u.id)).join(',')})));`));
  async function importOnce(row, label) {
    row.importInput = importArgs(row, `<p>KEEP ${label}: ${row.filename} — original reviewed wording.</p>`);
    const first = await importRpc(`${label} first authenticated import`, row.importInput);
    assert.deepEqual(first, { status: 'committed', outcome_id: row.importInput.p_outcome_id,
      document_id: row.importInput.p_document_id, idempotent_replay: false });
    const snapshot = importSnapshot(`${label}-independent-import`);
    const stored = snapshot.sections.filter(section => section.document_id === first.document_id);
    assert.equal(stored.length, 1); assert.equal(stored[0].content, row.importInput.p_sections[0].content);
    assert.deepEqual(stored[0].version_history, row.importInput.p_sections[0].version_history);
    assert.equal(snapshot.uploads.find(upload => upload.id === row.id).document_id, first.document_id);
    row.importReplay = await importRpc(`${label} actual replay receipt`, row.importInput);
    assert.deepEqual(row.importReplay, { ...first, idempotent_replay: true });
    assert.deepEqual(importSnapshot(`${label}-after-replay`), snapshot);
  }
  const proposedReplay = row => ({ ...importArgs(row, 'REPLACEMENT MUST NOT BE SAVED'), p_title: 'Changed proposed title' });
  function expectSourceSqlRejection(label, statement) {
    sql(label, `do $probe$ begin begin ${statement}; exception when others then
      if sqlstate='P0001' and sqlerrm='UPLOAD_SOURCE_IMPORT_UNAVAILABLE' then return; end if;
      raise; end; raise exception 'TEST_EXPECTED_SOURCE_GUARD_REJECTION'; end $probe$;`);
  }

  const historical = [];
  for (const version of ['upload-extraction.1', 'upload-extraction.2']) {
    for (const state of ['processing', 'completed']) {
      const row = rowFor(`historical-${version.at(-1)}-${state}`, version.endsWith('.2') ? fixtures.docx : fixtures.text, version);
      await prepare(row);
      assert.equal((await rpc('historical record', 'record_upload_extraction_snapshot', recordArgs(row))).outcome, 'recorded');
      row.checkpoint = await readCheckpoint(row);
      assert.equal(Object.keys(row.checkpoint).length, version.endsWith('.1') ? 6 : 11);
      if (state === 'completed') await complete(row);
      historical.push(row);
    }
  }
  // Representative pre-v2 data, inserted only into this disposable database.
  // Clone a valid processing v1 checkpoint with a distinct identity and NULL
  // accepted version; never disable or bypass the existing UPDATE fence.
  const legacy = rowFor('historical-null', fixtures.text, null);
  const patch = { id: legacy.id, storage_path: pathFor(legacy), file_name: legacy.filename,
    idempotency_key: legacy.id, ingest_request_sha256: legacy.requestSha, ingest_extraction_contract_version: null };
  sql('upload-v3-seed-representative-null', `insert into public.uploads select
    (jsonb_populate_record(null::public.uploads, to_jsonb(u)||${literal(JSON.stringify(patch))}::jsonb)).*
    from public.uploads u where id=${literal(historical[0].id)};`);
  legacy.token = historical[0].token; await retain(legacy);
  legacy.checkpoint = await readCheckpoint(legacy); assert.equal(Object.keys(legacy.checkpoint).length, 6);
  if (sourceImportUpgrade) {
    await complete(legacy);
    await importOnce(legacy, 'historical-null-contract');
    assert.equal(importSnapshot('historical-null-contract-check').uploads.find(row => row.id === legacy.id).ingest_extraction_contract_version, null);
    historicalImports.push(legacy);
  }
  historical.push(legacy);
  if (aliasUpgrade || fallbackUpgrade || sourceImportUpgrade) {
    const ready = rowFor('historical-v3-ready', fixtures.rtf, 'upload-extraction.3');
    await prepare(ready);
    assert.equal((await rpc('historical v3 source record', 'record_upload_extraction_snapshot', recordArgs(ready))).outcome, 'recorded');
    await complete(ready);
    if (sourceImportUpgrade) {
      await importOnce(ready, 'historical-protected-v3'); historicalImports.push(ready);
    }
    historical.push(ready);
    const failed = rowFor('historical-v3-alias-failed', {
      ...fixtures.rtf, mime: 'rtf', storageMime: 'application/octet-stream' }, 'upload-extraction.3');
    await prepare(failed);
    failed.response = { upload_id: failed.id, error: { code: 'UPLOAD_FORMAT_MISMATCH' } };
    const result = await rpc('retain terminal alias failure receipt', 'settle_upload_ingest', {
      ...identity(failed), p_ingest_status: 'failed', p_http_status: 422, p_response: failed.response,
      p_extracted_text: null, p_extracted_payload: {}, p_error_code: 'UPLOAD_FORMAT_MISMATCH',
    });
    assert.equal(result.outcome, 'settled'); failed.terminalFailure = true; historical.push(failed);
  }
  const ids = historical.map(row => literal(uuid(row.id))).join(',');
  const fullRows = label => JSON.parse(sql(label, `select json_agg(to_jsonb(u) order by id) from public.uploads u where id in (${ids});`));
  const before = fullRows('upload-v3-historical-before'); assert.equal(before.length, aliasUpgrade || fallbackUpgrade || sourceImportUpgrade ? 7 : 5);
  // Empty-MIME JSON claims persist the extension alias, while their original
  // bytes use the ingest storage fallback MIME. Neither changes upload identity.
  const candidate = rowFor('new-rtf', aliasUpgrade ? {
    ...fixtures.rtf, mime: 'rtf', storageMime: 'application/octet-stream' } : fixtures.rtf, 'upload-extraction.3');
  const fallbackCandidates = fallbackUpgrade
    ? [candidate, rowFor('pending-fallback-docx', fixtures.docx, 'upload-extraction.2')] : [];
  const providerPolicy = { provider: 'ollama', model: 'gpt-oss:20b', modelDigest: 'a'.repeat(64),
    configurationVersion: 'upload-fallback-test.1' };
  async function recordSyntheticFallback(row) {
    row.execution = providerPolicy;
    const requestHash = sha(`provider-request/${row.id}`);
    assert.notEqual(requestHash, row.requestSha);
    const providerIdentity = { p_user_id: row.user.id, p_checkpoint_scope: 'ingest-upload',
      p_origin_reservation_id: null, p_logical_request_id: row.id,
      p_logical_stage_key: 'ingest-upload.classify', p_request_sha256: requestHash };
    const classification = { document_type: 'Imported document', purpose: 'Synthetic classification.',
      sections: [{ title: 'Document', items: ['Retained wording'] }] };
    const route = { provider: 'openai', semanticRoute: 'fast', model: 'gpt-5.6-luna', reasoningEffort: 'low',
      routingVersion: 'upload-test.1', structuredOutputSchemaVersion: 'ingest-upload.classification.1',
      allowedTools: [], timeoutMs: 30000, maxAttempts: 2, background: false, store: false,
      fallback: null, creditFallback: providerPolicy };
    for (const attempt of [1, 2]) {
      const admission = await rpc('synthetic provider attempt admitted', 'read_legacy_model_call_checkpoint_with_fallback', {
        ...providerIdentity, p_max_attempts: 2, p_execution_claim_token: null, p_allocate_attempt: true });
      assert.equal(admission.attempt_number, attempt);
      uuid(admission.attempt_admission_id); uuid(admission.execution_claim_token);
      const dispatched = await rpc('synthetic provider attempt dispatch recorded', 'mark_legacy_model_attempt_dispatched', {
        ...providerIdentity, p_attempt_number: attempt, p_attempt_admission_id: admission.attempt_admission_id,
        p_execution_claim_token: admission.execution_claim_token, p_dispatch_token: randomUUID() });
      assert.equal(dispatched.state, 'dispatched');
      const now = new Date().toISOString();
      const recorded = await rpc('synthetic provider usage and result recorded', 'record_legacy_model_call_attempt_with_provider', {
        ...providerIdentity, p_provider_attempt_id: admission.attempt_admission_id, p_attempt_number: attempt,
        p_attempt_status: attempt === 1 ? 'failed' : 'succeeded',
        p_provider_response_id: attempt === 1 ? '' : 'synthetic-upload-receipt',
        p_provider_status: attempt === 1 ? 'http_429' : 'completed',
        p_error_code: attempt === 1 ? 'OPENAI_CREDIT_EXHAUSTED' : null,
        p_input_tokens: attempt === 1 ? 0 : 17, p_output_tokens: attempt === 1 ? 0 : 9,
        p_started_at: now, p_completed_at: now, p_model: attempt === 1 ? 'gpt-5.6-luna' : providerPolicy.model,
        p_routing_version: 'upload-test.1', p_semantic_route: 'fast', p_reasoning_effort: 'low',
        p_result_envelope: attempt === 1 ? null : { version: 'legacy-provider-result.1', text: JSON.stringify(classification),
          structured: classification, sources: [], route_snapshot: route },
        p_execution_claim_token: admission.execution_claim_token, p_provider: attempt === 1 ? 'openai' : 'ollama' });
      uuid(recorded.usage_ledger_id);
    }
    row.providerRequestSha = requestHash;
  }
  const fallbackSnapshot = (label, row) => JSON.parse(sql(label, `select json_build_object(
    'upload',(select to_jsonb(u) from public.uploads u where u.id=${literal(row.id)}),
    'results',(select json_agg(to_jsonb(r) order by r.logical_stage_key) from private.legacy_model_call_results r
      where r.user_id=${literal(row.user.id)} and r.logical_request_id=${literal(row.id)}),
    'usage',(select json_agg(to_jsonb(l) order by l.provider_attempt_number) from public.usage_ledger l
      where l.user_id=${literal(row.user.id)} and l.logical_request_id=${literal(row.id)}));`));
  const assertProviderSnapshot = (snapshot, row) => {
    assert.equal(snapshot.results.length, 1); assert.equal(snapshot.usage.length, 2);
    const [primary, fallback] = snapshot.usage;
    for (const usage of snapshot.usage) {
      assert.equal(usage.checkpoint_scope, 'ingest-upload'); assert.equal(usage.logical_stage_key, 'ingest-upload.classify');
      assert.equal(usage.provider_request_sha256, row.providerRequestSha);
      assert.equal(usage.user_id, row.user.id); assert.equal(usage.logical_request_id, row.id);
    }
    assert.equal(primary.provider_attempt_number, 1); assert.equal(primary.provider, 'openai');
    assert.equal(primary.provider_error_code, 'OPENAI_CREDIT_EXHAUSTED'); assert.equal(primary.model_call_status, 'failed');
    assert.equal(primary.input_tokens + primary.output_tokens, 0);
    assert.equal(fallback.provider_attempt_number, 2); assert.equal(fallback.provider, 'ollama');
    assert.equal(fallback.model_call_status, 'succeeded'); assert.equal(fallback.provider_status, 'completed');
    assert.equal(fallback.provider_error_code, null); assert.equal(fallback.input_tokens, 17); assert.equal(fallback.output_tokens, 9);
    assert.equal(snapshot.results[0].usage_ledger_id, fallback.id);
    assert.equal(snapshot.results[0].request_sha256, row.providerRequestSha);
    assert.deepEqual(snapshot.results[0].response_envelope.route_snapshot.creditFallback, providerPolicy);
  };
  let candidateBefore;
  let importsBefore;
  const candidateRow = label => JSON.parse(sql(label,
    `select to_jsonb(u) from public.uploads u where id=${literal(candidate.id)};`));
  if (fallbackUpgrade) {
    for (const row of fallbackCandidates) {
      await prepare(row);
      assert.equal((await rpc('pending fallback source checkpoint recorded', 'record_upload_extraction_snapshot', recordArgs(row))).outcome, 'recorded');
      const checkpoint = await readCheckpoint(row);
      assert.deepEqual(checkpoint.source_manifest, row.manifest); assert.equal(checkpoint.text, row.text);
      assert.equal(checkpoint.extraction_contract_version, row.version);
      await advance(row, 'storage_completed', 'provider_dispatched');
      await recordSyntheticFallback(row);
      row.frozenSettlement = settlement(row);
      row.beforeFallback = fallbackSnapshot(`fallback-${row.format}-before-rejection`, row);
      assertProviderSnapshot(row.beforeFallback, row);
      const red = await rpc('pending actual fallback reaches predecessor settlement rejection',
        'settle_upload_ingest', row.frozenSettlement, { expected: 400 });
      assert.equal(red.code, 'P0001'); assert.equal(red.message, 'UPLOAD_INGEST_SOURCE_PRIVACY_INVALID');
      assert.deepEqual(fallbackSnapshot(`fallback-${row.format}-after-rejection`, row), row.beforeFallback);
      save(`fallback-${row.format}-upgrade-red.json`, { code: red.code, message: red.message, uploadId: row.id,
        requestSha256: row.requestSha, providerRequestSha256: row.providerRequestSha, originalSha256: row.contentSha });
    }
  } else if (aliasUpgrade) {
    await prepare(candidate);
    candidateBefore = candidateRow('rtf-alias-pending-before-rejection');
    const red = await rpc('retained bare alias reaches predecessor checkpoint rejection',
      'record_upload_extraction_snapshot', recordArgs(candidate), { expected: 400 });
    assert.equal(red.code, 'P0001'); assert.equal(red.message, 'UPLOAD_SOURCE_MANIFEST_INVALID');
    assert.equal(await readCheckpoint(candidate), null);
    assert.deepEqual(candidateRow('rtf-alias-pending-after-rejection'), candidateBefore);
    save('rtf-alias-upgrade-red.json', { code: red.code, message: red.message, retainedUploadId: candidate.id,
      requestSha256: candidate.requestSha, originalSha256: candidate.contentSha, fileType: candidate.mime });
  } else if (sourceImportUpgrade) {
    // A distinct ready source must encounter the new boundary; the already
    // committed historical source intentionally remains immutable replay.
    await prepare(candidate);
    assert.equal((await rpc('predecessor ready source checkpoint', 'record_upload_extraction_snapshot', recordArgs(candidate))).outcome, 'recorded');
    await complete(candidate);
    importsBefore = importSnapshot('source-import-full-history-before');
    assert.equal(importsBefore.documents.length, 2); assert.equal(importsBefore.outcomes.length, 2);
    assert.equal(importsBefore.sections.length, 2);
  } else {
    const red = await rpc('v3 reaches predecessor and rejects admission', 'claim_upload_ingest', claimArgs(candidate), { expected: 400 });
    assert.equal(red.code, 'P0001'); assert.equal(red.message, 'UPLOAD_INGEST_CLAIM_INVALID');
    assert.equal(sql('upload-v3-red-row-absent', `select count(*) from public.uploads where id=${literal(candidate.id)};`), '0');
    save('upload-v3-upgrade-red.json', { code: red.code, message: red.message, absentUploadId: candidate.id });
  }
  applyMigration();
  if (sourceImportUpgrade) {
    assert.deepEqual(importSnapshot('source-import-full-history-after'), importsBefore);
    for (const row of historicalImports) {
      assert.deepEqual(await importRpc('historical import rejects proposed replacement through immutable replay', proposedReplay(row)), row.importReplay);
      assert.deepEqual(importSnapshot(`source-import-${row.version ?? 'null'}-after-replay`), importsBefore);
    }
  }
  assert.deepEqual(fullRows('upload-v3-historical-after'), before, 'Forward migration changed full historical rows');
  if (aliasUpgrade) {
    assert.deepEqual(candidateRow('rtf-alias-pending-after-upgrade'), candidateBefore);
    await readOriginal(candidate, 'same pending alias original survives upgrade');
  }
  for (const row of fallbackCandidates) {
    // Check full rows immediately across migration; checkpoint RPC leases may expire.
    assert.deepEqual(fallbackSnapshot(`fallback-${row.format}-after-upgrade`, row), row.beforeFallback);
    await readOriginal(row, 'same pending fallback original survives upgrade');
  }
  for (const row of historical) {
    await readOriginal(row, 'historical original bytes survive upgrade');
    if (row.response) {
      const replay = await rpc('historical terminal replay through v3 caller', 'claim_upload_ingest', claimArgs(row, 'upload-extraction.3'));
      assert.deepEqual(replay.response, row.response);
      assert.equal(replay.outcome, row.terminalFailure ? 'failed' : 'completed');
      assert.equal(replay.http_status, row.terminalFailure ? 422 : 200);
    } else {
      sql('upload-v3-expire-exact-historical', `update public.uploads set
        ingest_heartbeat_at=clock_timestamp()-interval '121 seconds', ingest_lease_expires_at=clock_timestamp()-interval '1 second'
        where id=${literal(row.id)} and user_id=${literal(row.user.id)};`);
      const resumed = await rpc('historical recovery retains stored version', 'claim_upload_ingest', claimArgs(row, row.version?.endsWith('.2') ? 'upload-extraction.3' : null));
      assert.equal(resumed.outcome, 'resumed'); assert.notEqual(resumed.claim_token, row.token);
      row.token = uuid(resumed.claim_token);
      assert.equal(resumed.extraction_contract_version, row.version === 'upload-extraction.2' ? row.version : undefined);
      assert.deepEqual(await readCheckpoint(row), row.checkpoint);
      assert.equal((await rpc('historical record replay', 'record_upload_extraction_snapshot', recordArgs(row))).outcome, 'idempotent_replay');
    }
  }

  const importExtras = sourceImportUpgrade ? [
    rowFor('new-source-pdf', fixtures.pdf, 'upload-extraction.3'),
    rowFor('new-legacy-docx', fixtures.docx, 'upload-extraction.2'),
    { ...rowFor('new-truncated', fixtures.text, 'upload-extraction.3'), truncated: true },
    { ...rowFor('new-unsettled', fixtures.text, 'upload-extraction.3'), unsettled: true },
  ] : [];
  const current = [candidate, ...fallbackCandidates.slice(1), ...importExtras, rowFor('new-docx', fixtures.docx, 'upload-extraction.3'),
    rowFor('new-textedit', fixtures.textedit, 'upload-extraction.3'), rowFor('new-markdown', fixtures.md, 'upload-extraction.3'),
    rowFor('other-owner', fixtures.text, 'upload-extraction.3', other)];
  for (const row of current) {
    if (sourceImportUpgrade && row === candidate) {
      assert.equal(await readCheckpoint(row), null);
      await readOriginal(row, 'same ready protected original survives import upgrade');
      continue;
    }
    if (fallbackCandidates.includes(row)) {
      // Both provider attempts and the extraction are already durable. Do not
      // advance, reclaim, re-extract, retain again or dispatch again here.
      await rpc('settle same pending fallback; discard application acknowledgement', 'settle_upload_ingest', row.frozenSettlement);
      const completed = fallbackSnapshot(`fallback-${row.format}-completed`, row);
      assert.equal(completed.upload.status, 'ready'); assert.equal(completed.upload.ingest_status, 'completed');
      assert.deepEqual(completed.upload.ingest_response, row.frozenSettlement.p_response);
      assert.deepEqual(completed.upload.extracted_payload, row.frozenSettlement.p_extracted_payload);
      assert.equal(completed.upload.ingest_extraction_text, row.text);
      assert.deepEqual(completed.upload.ingest_source_manifest, row.manifest);
      assert.equal(completed.upload.ingest_source_manifest_sha256, row.beforeFallback.upload.ingest_source_manifest_sha256);
      assert.deepEqual(completed.results, row.beforeFallback.results); assert.deepEqual(completed.usage, row.beforeFallback.usage);
      assertProviderSnapshot(completed, row);
      const receipt = await rpc('recover fallback receipt after discarded acknowledgement', 'claim_upload_ingest', claimArgs(row, null));
      assert.equal(receipt.outcome, 'completed'); assert.equal(receipt.http_status, 200);
      assert.deepEqual(receipt.response, row.frozenSettlement.p_response);
      assert.equal((await rpc('same frozen fallback settlement replays', 'settle_upload_ingest', row.frozenSettlement)).outcome, 'idempotent_replay');
      assert.deepEqual(fallbackSnapshot(`fallback-${row.format}-after-replay`, row), completed);
      await readOriginal(row, 'same fallback original survives completion and receipt replay');
      save(`fallback-${row.format}-upgrade-green.json`, { uploadId: row.id, contract: row.version,
        requestSha256: row.requestSha, providerRequestSha256: row.providerRequestSha, provenance: row.execution,
        originalSha256: row.contentSha, attempts: completed.usage.length, inputTokens: 17, outputTokens: 9,
        sameFrozenSettlement: true, ignoredApplicationAcknowledgementRecovered: true });
      row.response = row.frozenSettlement.p_response;
      continue;
    }
    if (!(aliasUpgrade && row === candidate)) await prepare(row);
    const snapshot = await rpc('v3 extractor snapshot before checkpoint', 'load_upload_extraction_snapshot', identity(row));
    assert.deepEqual(snapshot, { upload_id: row.id, user_id: row.user.id, request_sha256: row.requestSha,
      claim_token: row.token, storage_path: pathFor(row), filename: row.filename, file_type: row.mime,
      byte_length: row.byteLength, content_sha256: row.contentSha, stage: 'storage_completed',
      extraction_contract_version: row.version });
    if (row === candidate) {
      const missing = await rpc('v3 blocks dispatch without checkpoint', 'advance_upload_ingest', {
        ...identity(row), p_expected_stage: 'storage_completed', p_next_stage: 'provider_dispatched',
      }, { expected: 400 });
      assert.equal(missing.message, 'UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED');
      for (const [invalid, message] of [
        [{ p_source_manifest: null }, 'UPLOAD_SOURCE_MANIFEST_INVALID'],
        [{ p_source_manifest: { ...row.manifest, originalSha256: 'f'.repeat(64) } }, 'UPLOAD_SOURCE_MANIFEST_INVALID'],
        [{ p_source_manifest: null, p_format: 'text' }, 'UPLOAD_SOURCE_MANIFEST_INVALID'],
        [{ p_policy_version: 'upload-resource-policy.1' }, 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID'],
        [{ p_extraction_contract_version: 'upload-extraction.2' }, 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT'],
      ]) {
        const rejected = await rpc('v3 invalid candidate cannot record', 'record_upload_extraction_snapshot', { ...recordArgs(row), ...invalid }, { expected: 400 });
        assert.equal(rejected.code, 'P0001');
        assert.equal(rejected.message, message);
        assert.equal(await readCheckpoint(row), null);
      }
    }
    // Discard this application acknowledgement; not a simulated network drop.
    await rpc('record checkpoint; discard application acknowledgement', 'record_upload_extraction_snapshot', recordArgs(row));
    const adopted = await readCheckpoint(row);
    assert.equal(adopted.text, row.text); assert.equal(adopted.content_sha256, row.contentSha);
    assert.equal(adopted.text_sha256, sha(row.text)); assert.equal(adopted.content_byte_length, row.byteLength);
    assert.equal(adopted.format, row.format); assert.equal(adopted.truncated, row.truncated ?? false);
    assert.equal(adopted.extraction_contract_version, row.version); assert.equal(adopted.resource_policy_version, row.policy);
    assert.deepEqual(adopted.source_manifest, row.manifest); assert.equal(Object.keys(adopted).length, 11);
    assert.equal(adopted.source_digest_version, row.manifest ? 'upload-source-manifest-jsonb.1' : null);
    assert.equal((await rpc('checkpoint retry is idempotent', 'record_upload_extraction_snapshot', recordArgs(row))).outcome, 'idempotent_replay');
    assert.deepEqual(await readCheckpoint(row), adopted);
    const independent = JSON.parse(sql('upload-v3-independent-source-read', `select json_build_object(
      'text',ingest_extraction_text,'manifest',ingest_source_manifest,'digest',ingest_source_manifest_sha256,
      'digest_matches',case when ingest_source_manifest is null then ingest_source_manifest_sha256 is null
        else ingest_source_manifest_sha256=private.upload_source_manifest_digest(ingest_source_manifest) end,
      'contract',ingest_extraction_contract_version) from public.uploads where id=${literal(row.id)};`));
    assert.deepEqual(independent, { text: row.text, manifest: row.manifest, digest: adopted.source_manifest_sha256,
      digest_matches: true, contract: row.version });
    if (row === candidate) {
      const oldIdentity = identity(row);
      sql('upload-v3-expire-exact-current', `update public.uploads set
        ingest_heartbeat_at=clock_timestamp()-interval '121 seconds', ingest_lease_expires_at=clock_timestamp()-interval '1 second'
        where id=${literal(row.id)} and user_id=${literal(row.user.id)};`);
      const resumed = await rpc('old caller resumes stored v3 checkpoint', 'claim_upload_ingest', claimArgs(row, null));
      assert.equal(resumed.outcome, 'resumed'); assert.equal(resumed.extraction_contract_version, row.version);
      assert.notEqual(resumed.claim_token, row.token); row.token = uuid(resumed.claim_token);
      assert.deepEqual(await readCheckpoint(row), adopted);
      const stale = await rpc('stale token cannot write after takeover', 'record_upload_extraction_snapshot', { ...recordArgs(row), ...oldIdentity }, { expected: 400 });
      assert.equal(stale.message, 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT');
      assert.equal(await rpc('other owner cannot read private checkpoint', 'get_upload_extraction_checkpoint', { ...identity(row), p_user_id: other.id }), null);
    }
    if (row.unsettled) {
      await advance(row, 'storage_completed', 'provider_dispatched');
      await readOriginal(row, 'unsettled source original remains retained');
      continue;
    }
    await complete(row);
    assert.equal(await readCheckpoint(row), null);
    assert.equal((await rpc('terminal settlement is idempotent', 'settle_upload_ingest', settlement(row))).outcome, 'idempotent_replay');
    assert.deepEqual((await rpc('terminal result replay', 'claim_upload_ingest', claimArgs(row, null))).response, row.response);
    assert.equal(sql('upload-v3-independent-ready-state', `select status||'/'||ingest_status from public.uploads where id=${literal(row.id)};`), 'ready/completed');
    await readOriginal(row, 'original bytes survive checkpoint recovery and settlement');
  }
  if (sourceImportUpgrade) {
    const denied = current.filter(row => row === candidate || row.format === 'pdf' ||
      (row.format === 'docx' && row.version === 'upload-extraction.3') || row.truncated || row.unsettled);
    assert.equal(denied.length, 5);
    for (const row of denied) {
      const beforeAttempt = importSnapshot(`source-import-${row.filename}-before-denial`);
      const args = importArgs(row);
      if (row === candidate) {
        args.p_outcome_id = historicalImports[0].importInput.p_outcome_id;
        args.p_document_id = historicalImports[0].importInput.p_document_id;
      }
      const rejected = await importRpc('new uneditable source import rejected before child mutation', args, owner.token, 400);
      assert.equal(rejected.code, 'P0001');
      assert.equal(rejected.message, row.unsettled ? 'UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST' :
        row.truncated ? 'UPLOAD_IMPORT_PREVIEW_INCOMPLETE' : 'UPLOAD_SOURCE_IMPORT_UNAVAILABLE');
      assert.deepEqual(importSnapshot(`source-import-${row.filename}-after-denial`), beforeAttempt);
      await readOriginal(row, 'denied import retains exact original');
    }
    const textImports = current.filter(row => row.user.id === owner.id && !denied.includes(row));
    assert.equal(textImports.length, 3); // New v2 DOCX, v3 TextEdit text, v3 Markdown.
    for (const row of textImports) {
      await importOnce(row, `supported-${row.filename}`);
      const beforeReplay = importSnapshot(`supported-${row.filename}-before-alternate-replay`);
      assert.deepEqual(await importRpc('supported import ignores alternate proposed destination and wording', proposedReplay(row)), row.importReplay);
      assert.deepEqual(importSnapshot(`supported-${row.filename}-after-alternate-replay`), beforeReplay);
      await readOriginal(row, 'supported import preserves exact original bytes');
    }
    const beforeContext = importSnapshot('source-import-before-context-attachment');
    for (const key of ['outcomes', 'documents', 'sections']) assert.equal(beforeContext[key].length, 5);
    const contextOutcome = historicalImports[0].importInput.p_outcome_id;
    const attached = await rpc('source-only remains valid outcome context', 'attach_own_upload_to_outcome', {
      p_outcome_id: contextOutcome, p_upload_id: candidate.id }, { token: owner.token });
    assert.equal(attached.outcome_id, contextOutcome);
    const afterContext = importSnapshot('source-import-after-context-attachment');
    assert.deepEqual(afterContext.documents, beforeContext.documents); assert.deepEqual(afterContext.sections, beforeContext.sections);
    const sourceBefore = beforeContext.uploads.find(row => row.id === candidate.id);
    assert.deepEqual(afterContext.uploads.find(row => row.id === candidate.id), { ...sourceBefore, outcome_id: contextOutcome });
    assert.equal(sourceBefore.document_id, null);
    const targetDocument = historicalImports[0].importInput.p_document_id;
    for (const [label, statement] of [
      ['new-source-link', `update public.uploads set document_id=${literal(targetDocument)} where id=${literal(candidate.id)}`],
      ['new-source-commit', `update public.uploads set status='committed' where id=${literal(candidate.id)}`],
      ['historical-source-reassignment', `update public.uploads set document_id=${literal(targetDocument)} where id=${literal(historicalImports[1].id)}`],
    ]) {
      expectSourceSqlRejection(label, statement);
      assert.deepEqual(importSnapshot(`${label}-after-rejection`), afterContext);
    }
    const forbiddenImport = await importRpc('other owner cannot import an existing retained source', importArgs(candidate), other.token, 400);
    assert.equal(forbiddenImport.code, 'P0001'); assert.equal(forbiddenImport.message, `UPLOAD_NOT_FOUND:${candidate.id}`);
    assert.deepEqual(importSnapshot('source-import-after-other-owner-denial'), afterContext);
    // Delete only the exact synthetic TextEdit document created above. Its
    // original stays retained; this tests the deliberate FK cleanup exception.
    const cleanup = textImports.find(row => row.filename === 'new-textedit.txt'); assert.ok(cleanup);
    assert.equal(sql('source-import-exact-fk-delete', `delete from public.documents where id=${literal(cleanup.importInput.p_document_id)}
      and user_id=${literal(owner.id)} returning id;`), cleanup.importInput.p_document_id);
    const afterDelete = importSnapshot('source-import-after-exact-fk-delete');
    const expectedAfterDelete = structuredClone(afterContext);
    expectedAfterDelete.documents = expectedAfterDelete.documents.filter(row => row.id !== cleanup.importInput.p_document_id);
    expectedAfterDelete.sections = expectedAfterDelete.sections.filter(row => row.document_id !== cleanup.importInput.p_document_id);
    expectedAfterDelete.uploads.find(row => row.id === cleanup.id).document_id = null;
    assert.deepEqual(afterDelete, expectedAfterDelete, 'Exact fixture deletion changed unrelated historical data');
    await readOriginal(cleanup, 'original survives deliberate document deletion and FK cleanup');
    await readOriginal(candidate, 'protected original survives denied edit bindings');
    save('source-import-upgrade-acceptance.json', { passed: true,
      historicalImports: historicalImports.map(row => ({ uploadId: row.id, contract: row.version, receipt: row.importReplay })),
      rejectedUploadIds: denied.map(row => row.id), supportedUploadIds: textImports.map(row => row.id),
      contextUploadId: candidate.id, deletedSyntheticDocumentId: cleanup.importInput.p_document_id,
      fullHistoryPreservedAcrossMigration: true, scope: 'Authenticated local import and replay; controlled reviewed wording and precomputed extraction. No browser or format-preserving editor/export proof.' });
  }
  for (const user of users) {
    const expected = [...historical, ...current].filter(row => row.user.id === user.id).map(row => row.id).sort();
    const rows = await request('positive authenticated public upload projection', '/rest/v1/uploads?select=id,file_name', { method: 'GET', token: user.token });
    assert.deepEqual(rows.map(row => row.id).sort(), expected);
    const denied = await request('private source columns remain inaccessible', '/rest/v1/uploads?select=ingest_source_manifest', { method: 'GET', token: user.token, expected: 403 });
    assert.equal(denied.code, '42501');
  }
  assert.equal((await rpc('browser private checkpoint command denied', 'get_upload_extraction_checkpoint', identity(candidate), { token: owner.token, expected: 403 })).code, '42501');
  for (const [row, token] of [[candidate, other.token], [current.at(-1), owner.token], [candidate, config.ANON_KEY]]) {
    await request('non-owner cannot retrieve positive original fixture', objectRoute(row), { method: 'GET', token, storageRejection: 'denied' });
  }
  await request('private original unavailable through public route', objectRoute(candidate).replace('/object/', '/object/public/'), {
    method: 'GET', token: config.ANON_KEY, storageRejection: 'denied',
  });
  await request('duplicate retain refuses overwrite', objectRoute(candidate), { bytes: Buffer.from('replacement'),
    mime: candidate.storageMime ?? candidate.mime, storageRejection: 'duplicate' });
  const forbidden = rowFor('browser-write-denied', fixtures.text, 'upload-extraction.3');
  await request('owner cannot directly insert original', objectRoute(forbidden), { token: owner.token,
    bytes: forbidden.bytes, mime: forbidden.mime, storageRejection: 'denied' });
  await readOriginal(candidate, 'original bytes remain exact after rejected mutations');
  assert.equal(sql('upload-v3-forbidden-object-absent', `select count(*) from storage.objects where bucket_id='original-documents' and name=${literal(pathFor(forbidden))};`), '0');
  save('upload-v3-upgrade-acceptance.json', { passed: true, project, origin, checks, originals,
    upgrade: sourceImportUpgrade ? 'upload-source-import-boundary' : fallbackUpgrade ? 'upload-fallback-settlement' : aliasUpgrade ? 'rtf-mime-alias' : 'upload-source-v3',
    ...(sourceImportUpgrade ? { historicalImportUploadIds: historicalImports.map(row => row.id), sourceImportBoundaryProven: true } : {}),
    ...(fallbackUpgrade ? { fallbackUploadIds: fallbackCandidates.map(row => row.id), pendingRecoveryProven: true,
      providerEvidence: 'Real local accounting RPCs with synthetic receipts, no model execution' } : {}),
    ...(aliasUpgrade ? { retainedAliasUploadId: candidate.id, pendingRecoveryProven: true,
      terminalFailureReplayedUnchanged: true } : {}),
    historicalIds: historical.map(row => row.id), currentIds: current.map(row => row.id), fixtureUserIds: users.map(user => user.id),
    scope: 'All-current local SQL upgrade; full historical rows preserved, including v3 ready/failed and the pending alias or fallback candidates in their exact modes; real Auth/PostgREST/Storage original bytes, private checkpoint replay and isolation. Controlled classification and precomputed extraction fixtures: no Edge/extractor/provider/browser/editing/export proof. Exact isolated-runner teardown owns fixture/blob cleanup.' });
}
