// Synthetic local acceptance. The existing isolated runner owns every service,
// reset and migration. Extraction fixtures are controlled, not model evidence.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertStorageRejection } from './upload-source-v3-upgrade-acceptance.mjs';

const origin = 'http://127.0.0.1:58321';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = value => { assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); return value; };

export function validateWorkspaceReadUpgradePlan(manifest, currentSource) {
  const currentSql = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')));
  assert.deepEqual(manifest, currentSql, 'Workspace reads must exercise all current SQL');
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
    ['20260907112000_upload_source_import_boundary.sql', '16fe5041cf52351221a1318ab1bdbbc7006196683f72ed650fd253245569294a'],
    ['20260907124000_workspace_upload_reads.sql', '3fca86b80b086b730f8546eee19b412e7012138cad929425089b9558ec18f997'],
  ]) assert.equal(manifest[`supabase/migrations/${file}`], hash, 'Reviewed workspace read upgrade input changed');
  assert.deepEqual(versions.filter(version => version > '20260907112000'), ['20260907124000'],
    'Workspace reads permit exactly their reviewed forward migration');
  assert.ok(manifest['supabase/tests/workspace_upload_reads.test.sql']);
  return { predecessor: '20260907112000', forward: '20260907124000', versions };
}

export async function exerciseWorkspaceReads({ project, workdir, env, sql, applyMigration, checkTarget, save, exerciseBrowser }) {
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  checkTarget();
  const status = spawnSync('supabase', ['--workdir', workdir, '--agent', 'no', 'status', '-o', 'json'], {
    cwd: workdir, env, encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
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
    const response = await fetch(url, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}`,
        'Content-Type': mime ?? 'application/json', ...(bytes ? { 'x-upsert': 'false' } : {}) },
      ...(bytes ? { body: bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.body);
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try {
      for (let reads = 0; ; reads++) {
        assert.ok(reads < 10000, 'Unbounded fixture response');
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength; assert.ok(length <= 2 * 1024 * 1024);
        chunks.push(next.value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const raw = Buffer.concat(chunks);
    const check = { label, path: url.pathname, status: response.status }; checks.push(check);
    save('workspace-read-http-checks.json', checks);
    if (binary && !storageRejection) { assert.equal(response.status, expected, label); return raw; }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { throw new Error(`${label}: invalid UTF-8 JSON`); }
    if (storageRejection) check.errorCode = assertStorageRejection(response.status, data, storageRejection);
    else assert.equal(response.status, expected, label);
    save('workspace-read-http-checks.json', checks);
    return data;
  }
  const rpc = (label, name, body, options = {}) => request(label, `/rest/v1/rpc/${name}`, { ...options, body });
  const users = [];
  async function signIn(user) {
    const session = await request('real owner password sign-in', '/auth/v1/token?grant_type=password', {
      token: config.ANON_KEY, body: { email: user.email, password: user.password },
    });
    assert.equal(session.user.id, user.id); assert.equal(typeof session.access_token, 'string');
    return session.access_token;
  }
  for (const slot of ['a', 'b']) {
    const email = `${project}-reads-${slot}@example.invalid`; const password = randomBytes(30).toString('base64url');
    const created = await request(`create confirmed owner ${slot}`, '/auth/v1/admin/users', { body: { email, password, email_confirm: true } });
    const user = { id: uuid(created.id), email, password }; user.token = await signIn(user); users.push(user);
  }
  const [owner, other] = users; assert.notEqual(owner.id, other.id);
  const docx = readFileSync(`${workdir}/source-preservation.docx`);
  const docxManifest = JSON.parse(readFileSync(`${workdir}/source-manifest.json`, 'utf8'));
  assert.equal(sha(docx), docxManifest.archiveSha256);
  const rtf = readFileSync(`${workdir}/rtf-appkit-original.rtf`);
  const rtfEvidence = JSON.parse(readFileSync(`${workdir}/rtf-appkit-producer-green.json`, 'utf8'));
  assert.equal(sha(rtf), rtfEvidence.originalSha256);
  const text = '  TextEdit wording — 日本語 😀\nSecond paragraph.\n';
  const fixtures = [
    { name: 'Protected.pdf', bytes: readFileSync(`${workdir}/position-left.pdf`), format: 'pdf', mime: 'application/pdf', text: 'Controlled PDF preview', manifest: null },
    { name: 'Protected.docx', bytes: docx, format: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: 'Format protected document', manifest: docxManifest },
    { name: 'TextEdit.rtf', bytes: rtf, format: 'rtf', mime: 'application/rtf', text: rtfEvidence.extractedText, manifest: rtfEvidence.manifest },
    { name: 'TextEdit UTF16.txt', bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), format: 'text', mime: 'text/plain', text, manifest: null },
    { name: 'Plain.txt', bytes: Buffer.from(text), format: 'text', mime: 'text/plain', text, manifest: null },
    { name: 'Notes.md', bytes: Buffer.from('# Heading\n\nOriginal **wording**.\n'), format: 'text', mime: 'text/markdown', text: '# Heading\n\nOriginal **wording**.\n', manifest: null },
    { name: 'Records.csv', bytes: Buffer.from('name,value\nsynthetic,10\n'), format: 'text', mime: 'text/csv', text: 'name,value\nsynthetic,10\n', manifest: null },
  ];
  const rows = [];
  const objectRoute = path => `/storage/v1/object/original-documents/${path.split('/').map(encodeURIComponent).join('/')}`;
  function rowFor(fixture, version = 'upload-extraction.3', user = owner) {
    const row = { ...fixture, id: randomUUID(), user, version, requestSha: sha(`${project}/${randomUUID()}`),
      contentSha: sha(fixture.bytes), byteLength: fixture.bytes.length, retained: true };
    row.path = `${user.id}/${row.id}/${row.name}`;
    row.policy = version === 'upload-extraction.3' ? 'upload-resource-policy.2' : 'upload-resource-policy.1';
    rows.push(row); return row;
  }
  async function retain(row) {
    const stored = await request('retain exact original without replacement', objectRoute(row.path), { bytes: row.bytes, mime: row.mime });
    assert.equal(stored.Key, `original-documents/${row.path}`);
    const actual = await request('positive owned original before denial', objectRoute(row.path), { token: row.user.token, method: 'GET', binary: true });
    assert.ok(actual.equals(row.bytes));
    originals.push({ uploadId: row.id, ownerId: row.user.id, path: row.path, length: actual.length, sha256: sha(actual) });
    save('workspace-read-originals.json', originals);
  }
  const identity = row => ({ p_upload_id: row.id, p_user_id: row.user.id, p_request_sha256: row.requestSha, p_claim_token: row.claim });
  async function advance(row, from, to) {
    assert.equal((await rpc('advance controlled retention fixture', 'advance_upload_ingest', {
      ...identity(row), p_expected_stage: from, p_next_stage: to,
    })).outcome, 'advanced');
  }
  async function prepare(row) {
    const claim = await rpc('accept versioned source fixture', 'claim_upload_ingest', {
      p_upload_id: row.id, p_user_id: row.user.id, p_storage_path: row.path, p_file_type: row.mime,
      p_file_name: row.name, p_file_size_bytes: row.byteLength, p_request_sha256: row.requestSha,
      p_content_sha256: row.contentSha, p_extraction_contract_version: row.version,
    });
    assert.equal(claim.outcome, 'accepted'); row.claim = uuid(claim.claim_token);
    await advance(row, 'prepared', 'storage_dispatched'); await retain(row);
    await advance(row, 'storage_dispatched', 'storage_completed');
    assert.equal((await rpc('record controlled extraction checkpoint', 'record_upload_extraction_snapshot', {
      ...identity(row), p_content_sha256: row.contentSha, p_extracted_text_sha256: sha(row.text),
      p_extracted_text: row.text, p_format: row.format, p_truncated: false,
      p_policy_version: row.policy, p_extraction_contract_version: row.version, p_source_manifest: row.manifest,
    })).outcome, 'recorded');
  }
  for (const fixture of fixtures) await prepare(rowFor(fixture));
  await prepare(rowFor({ ...fixtures[4], name: 'Historical v1.txt' }, 'upload-extraction.1'));
  await prepare(rowFor({ ...fixtures[1], name: 'Historical v2.docx' }, 'upload-extraction.2'));
  await prepare(rowFor({ ...fixtures[5], name: 'Other owner.md', text: 'Other owner preview' }, 'upload-extraction.3', other));
  const completed = rows.find(row => row.name === 'Plain.txt');
  await advance(completed, 'storage_completed', 'provider_dispatched');
  const response = { upload_id: completed.id, storage_path: completed.path, extracted_text: completed.text,
    original_retained: true, classification_status: 'completed', extraction_format: completed.format,
    resource_policy_version: completed.policy, confirm_payload: { summary: 'Controlled classification fixture',
      document_type: 'document', filename: completed.name, char_count: completed.text.length, truncated: false,
      structure: [{ title: 'Document', items: ['Synthetic wording'] }] } };
  assert.equal((await rpc('settle a positive completed modern source', 'settle_upload_ingest', { ...identity(completed),
    p_ingest_status: 'completed', p_http_status: 200, p_response: response, p_extracted_text: completed.text,
    p_error_code: null, p_extracted_payload: { truncated: false, original_retained: true, classification_status: 'completed',
      extraction_format: completed.format, resource_policy_version: completed.policy },
  })).outcome, 'settled');
  completed.status = 'ready'; completed.ingestStatus = 'completed';
  const modern = rows.filter(row => row !== completed);
  sql('workspace-read-expire-checkpoint-leases', `update public.uploads set ingest_heartbeat_at=now()-interval '3 minutes',
    ingest_lease_expires_at=now()-interval '1 minute' where id in (${modern.map(row => literal(row.id)).join(',')});`);
  assert.equal(Number(sql('workspace-read-positive-expired-leases', `select count(*) from public.uploads where id in
    (${modern.map(row => literal(row.id)).join(',')}) and ingest_lease_expires_at<now();`)), modern.length);
  for (const [name, status, retained] of [
    ['Historical original.md', 'ready', true], ['Failed extraction.pdf', 'failed', true], ['Missing original.pdf', 'failed', false],
    ...Array.from({ length: 12 }, (_, i) => [`Earlier file ${i + 1}.txt`, 'processing', false]),
  ]) {
    const fixture = name.endsWith('.pdf') ? fixtures[0] : fixtures[5];
    const row = rowFor({ ...fixture, name }, null); row.retained = retained; row.status = status;
    row.path = `${owner.id}/historical/${row.id}-${name}`;
    sql('workspace-read-seed-historical-row', `insert into public.uploads(id,user_id,storage_path,file_name,file_type,file_size_bytes,
      extracted_text,extracted_payload,status,created_at) values(${literal(row.id)},${literal(owner.id)},${literal(row.path)},
      ${literal(name)},${literal(row.mime)},${row.byteLength},${literal(row.text)},'{"original_retained":true}'::jsonb,
      ${literal(status)},'2026-09-07T01:02:03.123456Z');`);
    if (retained) await retain(row);
  }
  const imported = rows.find(row => row.name === 'Historical original.md');
  const importInput = { p_upload_id: imported.id, p_outcome_id: randomUUID(), p_document_id: randomUUID(),
    p_title: imported.name, p_situation_text: 'Synthetic existing imported wording',
    p_recommendation_payload: { primary: { template_id: 'imported_document', reason: 'Synthetic owner import' } },
    p_sections: [{ id: randomUUID(), name: 'Document', order_index: 0, content: '<p>KEEP existing owner wording.</p>',
      status: 'draft', is_required: true, version_history: [] }] };
  const receipt = await rpc('positive historical authenticated import', 'commit_document_import', importInput, { token: owner.token });
  assert.deepEqual(receipt, { status: 'committed', outcome_id: importInput.p_outcome_id,
    document_id: importInput.p_document_id, idempotent_replay: false });
  imported.imported = { document_id: receipt.document_id, outcome_id: receipt.outcome_id };
  imported.status = 'committed';
  const snapshot = label => JSON.parse(sql(label, `select json_build_object(
    'uploads',(select coalesce(json_agg(to_jsonb(u) order by id),'[]') from public.uploads u where user_id in (${users.map(u => literal(u.id)).join(',')})),
    'outcomes',(select coalesce(json_agg(to_jsonb(o) order by id),'[]') from public.outcomes o where user_id in (${users.map(u => literal(u.id)).join(',')})),
    'documents',(select coalesce(json_agg(to_jsonb(d) order by id),'[]') from public.documents d where user_id in (${users.map(u => literal(u.id)).join(',')})),
    'sections',(select coalesce(json_agg(to_jsonb(s) order by id),'[]') from public.sections s where user_id in (${users.map(u => literal(u.id)).join(',')})));`));
  const before = snapshot('workspace-domain-before-upgrade');
  assert.equal(before.uploads.length, rows.length); assert.equal(before.documents.length, 1);
  assert.equal(before.sections[0].content, importInput.p_sections[0].content);
  assert.equal(sql('workspace-rpcs-absent-before-upgrade', `select to_regprocedure('public.get_own_workspace_upload_v1(uuid)') is null
    and to_regprocedure('public.list_own_workspace_uploads_v1(timestamptz,uuid)') is null;`), 't');
  for (const [name, body] of [['get_own_workspace_upload_v1', { p_upload_id: imported.id }], ['list_own_workspace_uploads_v1', {}]]) {
    assert.equal((await rpc('specific pre-upgrade missing RPC', name, body, { token: owner.token, expected: 404 })).code, 'PGRST202');
  }
  applyMigration();
  assert.deepEqual(snapshot('workspace-domain-immediately-after-upgrade'), before);
  const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), expected.sort());
  async function detail(row, user = row.user) {
    const result = await rpc('read exact owner source', 'get_own_workspace_upload_v1', { p_upload_id: row.id }, { token: user.token });
    keys(result, ['version', 'owner_user_id', 'source']);
    assert.equal(result.version, 'workspace-upload.1'); assert.equal(result.owner_user_id, user.id);
    return result.source;
  }
  for (const user of users) {
    let cursor = null; const ids = [];
    for (let page = 0; ; page++) {
      assert.ok(page < 3);
      const result = await rpc('owner list with exact returned cursor', 'list_own_workspace_uploads_v1', cursor ? {
        p_before_created_at: cursor.created_at, p_before_id: cursor.upload_id,
      } : {}, { token: user.token });
      keys(result, ['version', 'owner_user_id', 'items', 'next_cursor']);
      assert.equal(result.version, 'workspace-upload.1'); assert.equal(result.owner_user_id, user.id);
      assert.ok(result.items.length > 0 && result.items.length <= 20);
      for (const item of result.items) { assert.ok(!('preview' in item)); ids.push(item.upload_id); }
      cursor = result.next_cursor; if (!cursor) break;
      assert.equal(result.items.length, 20); assert.match(cursor.created_at, /\.123456/);
    }
    const expectedIds = JSON.parse(sql('workspace-independent-list-order', `select json_agg(id order by created_at desc,id desc)
      from public.uploads where user_id=${literal(user.id)};`));
    assert.deepEqual(ids, expectedIds); assert.equal(new Set(ids).size, ids.length);
  }
  for (const row of rows) {
    const source = await detail(row); assert.equal(source.upload_id, row.id);
    keys(source, ['upload_id', 'file_name', 'mime_type', 'byte_length', 'created_at', 'status', 'ingest_status', 'format', 'original', 'imported_document', 'preview']);
    assert.equal(source.file_name, row.name); assert.equal(source.preview.text, row.text);
    assert.equal(source.mime_type, row.mime); assert.equal(source.byte_length, row.byteLength);
    assert.equal(source.format, row.version ? row.format : null);
    assert.equal(source.status, row.status ?? 'processing');
    assert.equal(source.ingest_status, row.ingestStatus ?? (row.version ? 'processing' : 'legacy'));
    keys(source.preview, ['text', 'truncated']); assert.equal(source.preview.truncated, row.version ? false : null);
    assert.deepEqual(source.imported_document, row.imported ?? null);
    if (!row.retained) { assert.equal(source.original, null); continue; }
    keys(source.original, ['storage_path', 'sha256']);
    assert.equal(source.original.storage_path, row.path);
    assert.equal(source.original.sha256, row.version ? row.contentSha : null);
    const actual = await request('download via authoritative detail path', objectRoute(source.original.storage_path), {
      token: row.user.token, method: 'GET', binary: true });
    assert.equal(actual.length, source.byte_length); assert.equal(sha(actual), row.contentSha); assert.ok(actual.equals(row.bytes));
  }
  owner.token = await signIn(owner);
  const reopened = await detail(rows[0]);
  assert.ok((await request('fresh session reopens same original', objectRoute(reopened.original.storage_path),
    { token: owner.token, method: 'GET', binary: true })).equals(rows[0].bytes));
  assert.equal(await detail(rows[0], other), null);
  assert.equal(await detail({ id: randomUUID(), user: other }), null);
  for (const [name, body] of [['get_own_workspace_upload_v1', { p_upload_id: rows[0].id }], ['list_own_workspace_uploads_v1', {}]]) {
    assert.equal((await rpc('anonymous read denied', name, body, { token: config.ANON_KEY, expected: 401 })).code, '42501');
  }
  await request('other owner original denied', objectRoute(rows[0].path), { token: other.token, method: 'GET', storageRejection: 'denied' });
  await request('public original route denied', objectRoute(rows[0].path).replace('/object/', '/object/public/'), {
    token: config.ANON_KEY, method: 'GET', storageRejection: 'denied' });
  assert.equal((await request('private upload columns denied', '/rest/v1/uploads?select=ingest_source_manifest', {
    token: owner.token, method: 'GET', expected: 403 })).code, '42501');
  assert.equal((await rpc('private checkpoint command denied', 'get_upload_extraction_checkpoint', identity(rows[0]),
    { token: owner.token, expected: 403 })).code, '42501');
  assert.deepEqual(snapshot('workspace-domain-after-http-reads'), before);
  if (exerciseBrowser) {
    await exerciseBrowser({ anonKey: config.ANON_KEY, users: users.map(({ id, email, password }) => ({ id, email, password })),
      rows: rows.filter(row => row.retained || row.name === 'Missing original.pdf').map(row => ({ id: row.id, ownerId: row.user.id,
        name: row.name, text: row.text, bytes: row.bytes, retained: row.retained, imported: row.imported ?? null })) });
    assert.deepEqual(snapshot('workspace-domain-after-browser-reads'), before);
  }
  save('workspace-read-upgrade-acceptance.json', { passed: true, owners: users.map(user => user.id),
    uploadCount: rows.length, originalCount: originals.length, httpChecks: checks.length,
    historicalDomainRowsUnchanged: true, expiredCheckpointCount: modern.length, browserExercised: Boolean(exerciseBrowser),
    scope: 'Real local Auth/PostgREST/Storage reads and exact original bytes across112000-to124000. Controlled extraction fixtures; no upload picker, provider, preserving editing, export or hosted proof.' });
}
