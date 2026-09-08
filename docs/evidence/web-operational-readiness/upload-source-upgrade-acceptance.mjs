// Real local PostgREST compatibility across the exact forward migration.
// Only the runner's identified disposable stack is accepted. Credentials and
// Auth responses remain in memory; evidence contains synthetic records only.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const origin = 'http://127.0.0.1:58321';
const sha = value => createHash('sha256').update(value).digest('hex');
export async function exerciseUploadSourceUpgrade({ project, workdir, env, sql, applyMigration, checkTarget, save }) {
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  checkTarget();
  const status = spawnSync('supabase', ['--workdir', workdir, '--agent', 'no', 'status', '-o', 'json'], {
    cwd: workdir, env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(status.status, 0, 'Disposable local status failed');
  let config;
  try { config = JSON.parse(status.stdout); }
  catch { throw new Error('Disposable local status did not return valid JSON'); }
  assert.equal(config.API_URL, origin);
  assert.equal(typeof config.ANON_KEY, 'string');
  assert.equal(typeof config.SERVICE_ROLE_KEY, 'string');
  const checks = [];
  async function request(label, path, { token = config.SERVICE_ROLE_KEY, method = 'POST', body, expected = 200 } = {}) {
    checkTarget();
    const url = new URL(path, origin);
    assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/auth/v1/'));
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.body);
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        assert.ok(bytes <= 128 * 1024, 'Unexpected local fixture response size');
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error(`${label}: local fixture response was not valid UTF-8 JSON`); }
    checks.push({ label, path: url.pathname, status: response.status, expectedStatus: expected });
    save('upload-source-http-checks.json', checks);
    assert.equal(response.status, expected, `${label}: unexpected status`);
    return data;
  }
  const rpc = (label, name, body, options = {}) => request(label, `/rest/v1/rpc/${name}`, { ...options, body });
  const users = [];
  for (const slot of ['source-a', 'source-b']) {
    const email = `${project}-${slot}@example.invalid`;
    const password = randomBytes(30).toString('base64url');
    const user = await request(`create ${slot}`, '/auth/v1/admin/users', { body: { email, password, email_confirm: true } });
    assert.match(user.id, /^[0-9a-f-]{36}$/);
    const session = await request(`authenticate ${slot}`, '/auth/v1/token?grant_type=password', {
      token: config.ANON_KEY, body: { email, password },
    });
    assert.equal(session.user.id, user.id);
    assert.equal(typeof session.access_token, 'string');
    users.push({ id: user.id, token: session.access_token });
  }
  assert.notEqual(users[0].id, users[1].id);
  const owner = users[0]; const oldRows = [];
  const identities = row => ({ p_upload_id: row.id, p_user_id: owner.id,
    p_request_sha256: row.requestSha, p_claim_token: row.token });
  const claimArgs = row => ({ p_upload_id: row.id, p_user_id: owner.id,
    p_storage_path: `${owner.id}/${row.id}/${row.filename}`, p_file_type: row.mime,
    p_file_name: row.filename, p_file_size_bytes: row.byteLength,
    p_request_sha256: row.requestSha, p_content_sha256: row.contentSha });
  const recordArgs = row => ({ ...identities(row), p_content_sha256: row.contentSha,
    p_extracted_text_sha256: sha(row.text), p_extracted_text: row.text,
    p_format: row.format, p_truncated: false, p_policy_version: 'upload-resource-policy.1' });
  async function advance(row, expected, next) {
    const receipt = await rpc('advance synthetic upload', 'advance_upload_ingest', {
      ...identities(row), p_expected_stage: expected, p_next_stage: next,
    });
    assert.equal(receipt.outcome, 'advanced');
    assert.equal(receipt.stage, next);
  }
  const responseFor = row => ({ upload_id: row.id, extracted_text: row.text,
    storage_path: `${owner.id}/${row.id}/${row.filename}`,
    original_retained: true, classification_status: 'completed', extraction_format: row.format,
    resource_policy_version: 'upload-resource-policy.1', confirm_payload: {
      summary: 'Synthetic classification for SQL acceptance', document_type: 'document',
      filename: row.filename, char_count: row.text.length, truncated: false,
      structure: [{ title: 'Document', items: ['Synthetic wording'] }],
    } });
  async function complete(row) {
    const response = responseFor(row);
    const receipt = await rpc('settle controlled classification', 'settle_upload_ingest', {
      ...identities(row), p_ingest_status: 'completed', p_http_status: 200, p_response: response,
      p_extracted_text: row.text, p_error_code: null, p_extracted_payload: {
        truncated: false, original_retained: true, classification_status: 'completed',
        extraction_format: row.format, resource_policy_version: 'upload-resource-policy.1',
      },
    });
    assert.equal(receipt.outcome, 'settled');
    return response;
  }
  for (const stage of ['processing', 'completed']) {
    const row = { id: randomUUID(), requestSha: sha(`old-${stage}`), filename: `${stage}.txt`,
      mime: 'text/plain', text: `Historical ${stage} wording 😀`, format: 'text' };
    row.byteLength = Buffer.byteLength(row.text); row.contentSha = sha(row.text);
    const claim = await rpc('old eight-argument claim', 'claim_upload_ingest', claimArgs(row));
    assert.deepEqual(Object.keys(claim).sort(), ['claim_token', 'outcome', 'stage']);
    assert.equal(claim.outcome, 'accepted'); row.token = claim.claim_token;
    await advance(row, 'prepared', 'storage_dispatched');
    await advance(row, 'storage_dispatched', 'storage_completed');
    assert.equal((await rpc('old ten-argument record', 'record_upload_extraction_snapshot', recordArgs(row))).outcome, 'recorded');
    row.checkpoint = await rpc('old checkpoint positive read', 'get_upload_extraction_checkpoint', identities(row));
    assert.deepEqual(Object.keys(row.checkpoint).sort(), ['content_sha256','format','resource_policy_version','text','text_sha256','truncated']);
    if (stage === 'completed') { await advance(row, 'storage_completed', 'provider_dispatched'); row.response = await complete(row); }
    oldRows.push(row);
  }
  const ids = oldRows.map(row => `'${row.id}'`).join(',');
  const originalRows = label => JSON.parse(sql(label, `select json_agg(to_jsonb(u) - array[
    'ingest_extraction_contract_version','ingest_source_manifest','ingest_source_manifest_sha256','ingest_source_digest_version'] order by id)
    from public.uploads u where id in (${ids});`));
  const before = originalRows('upload-source-upgrade-before');
  assert.equal(before.length, 2);
  const red = await rpc('v2 signature absent before exact migration', 'claim_upload_ingest', {
    ...claimArgs(oldRows[0]), p_extraction_contract_version: 'upload-extraction.2',
  }, { expected: 404 });
  assert.equal(red.code, 'PGRST202');
  save('upload-source-upgrade-red.json', { expected: 'PGRST202', actual: red.code,
    scope: 'Real local PostgREST cannot resolve the new contract before migration; existing old calls succeeded.' });
  const dependencies = JSON.parse(sql('upload-source-prior-dependencies', `select coalesce(json_agg(json_build_object(
    'dependent',pg_describe_object(d.classid,d.objid,d.objsubid),'dependency_type',d.deptype)), '[]'::json)
    from pg_catalog.pg_depend d where d.refclassid='pg_proc'::regclass and d.refobjid in (
      'public.claim_upload_ingest(uuid,uuid,text,text,text,integer,text,text)'::regprocedure,
      'public.record_upload_extraction_snapshot(uuid,uuid,text,uuid,text,text,text,text,boolean,text)'::regprocedure);`));
  save('upload-source-prior-dependencies.json', dependencies);
  applyMigration();
  assert.deepEqual(originalRows('upload-source-upgrade-after'), before, 'Historical row changed during forward migration');
  const historicalVersions = JSON.parse(sql('upload-source-historical-null-contracts', `select json_agg(json_build_object(
    'contract',ingest_extraction_contract_version,'manifest',ingest_source_manifest,
    'digest',ingest_source_manifest_sha256,'digest_version',ingest_source_digest_version) order by id)
    from public.uploads where id in (${ids});`));
  assert.deepEqual(historicalVersions, oldRows.map(()=>({ contract:null,manifest:null,digest:null,digest_version:null })),
    'Historical extraction contracts must not be backfilled');
  sql('upload-source-expire-historical-claim', `update public.uploads
    set ingest_heartbeat_at=clock_timestamp()-interval '121 seconds',
      ingest_lease_expires_at=clock_timestamp()-interval '1 second'
    where id='${oldRows[0].id}';`);
  const resumed = await rpc('old named call resumes historical claim', 'claim_upload_ingest', claimArgs(oldRows[0]));
  assert.equal(resumed.outcome,'resumed');
  assert.deepEqual(Object.keys(resumed).sort(),['claim_token','outcome','stage']);
  assert.notEqual(resumed.claim_token,oldRows[0].token);
  oldRows[0].token=resumed.claim_token;
  assert.deepEqual(await rpc('old checkpoint after migration', 'get_upload_extraction_checkpoint', identities(oldRows[0])), oldRows[0].checkpoint);
  assert.equal((await rpc('old record replay after migration', 'record_upload_extraction_snapshot', recordArgs(oldRows[0]))).outcome, 'idempotent_replay');
  assert.deepEqual((await rpc('old terminal replay after migration', 'claim_upload_ingest', claimArgs(oldRows[1]))).response, oldRows[1].response);

  const manifest = JSON.parse(readFileSync(`${workdir}/source-manifest.json`, 'utf8'));
  const fixture = readFileSync(`${workdir}/source-preservation.docx`);
  assert.equal(sha(fixture), manifest.archiveSha256); assert.equal(fixture.length, manifest.archiveByteLength);
  const row = { id: randomUUID(), requestSha: sha('new-source-contract'), filename: 'source.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    text: 'Format protected document', format: 'docx', contentSha: manifest.archiveSha256, byteLength: manifest.archiveByteLength };
  const claim = await rpc('new v2 claim after migration', 'claim_upload_ingest', {
    ...claimArgs(row), p_extraction_contract_version: 'upload-extraction.2',
  });
  assert.equal(claim.outcome, 'accepted'); assert.equal(claim.extraction_contract_version, 'upload-extraction.2'); row.token=claim.claim_token;
  await advance(row, 'prepared', 'storage_dispatched'); await advance(row, 'storage_dispatched', 'storage_completed');
  const candidate = { ...recordArgs(row), p_extraction_contract_version: 'upload-extraction.2', p_source_manifest: manifest };
  // Deliberately discard the acknowledgement after the real RPC commits. This
  // verifies recoverable readback, not a network-level dropped-connection test.
  await rpc('record source; discard application acknowledgement', 'record_upload_extraction_snapshot', candidate);
  const adopted = await rpc('adopt authoritative source checkpoint', 'get_upload_extraction_checkpoint', identities(row));
  assert.equal(adopted.text, row.text); assert.deepEqual(adopted.source_manifest, manifest);
  assert.equal(adopted.source_digest_version, 'upload-source-manifest-jsonb.1');
  assert.match(adopted.source_manifest_sha256, /^[0-9a-f]{64}$/);
  assert.equal((await rpc('same source record retry', 'record_upload_extraction_snapshot', candidate)).outcome, 'idempotent_replay');
  assert.deepEqual(await rpc('same checkpoint reload', 'get_upload_extraction_checkpoint', identities(row)), adopted);
  assert.equal(await rpc('other owner private checkpoint', 'get_upload_extraction_checkpoint', { ...identities(row), p_user_id: users[1].id }), null);
  const otherUploadId = randomUUID();
  assert.equal((await rpc('positive other-owner upload fixture', 'claim_upload_ingest', {
    ...claimArgs(row), p_upload_id:otherUploadId, p_user_id:users[1].id,
    p_storage_path:`${users[1].id}/${otherUploadId}/${row.filename}`,
    p_request_sha256:sha('other owner source fixture'),
  })).outcome,'accepted');
  for (const user of users) {
    const visible = await request('positive authenticated upload read', '/rest/v1/uploads?select=id,file_name', {
      method: 'GET', token: user.token,
    });
    assert.deepEqual(visible.map(item=>item.id).sort(),
      (user===owner ? [...oldRows.map(item=>item.id),row.id] : [otherUploadId]).sort());
    const denied = await request('private source columns denied', '/rest/v1/uploads?select=ingest_source_manifest,ingest_source_manifest_sha256', {
      method: 'GET', token: user.token, expected: 403,
    });
    assert.equal(denied.code, '42501');
  }
  const rpcDenied = await rpc('browser private checkpoint RPC denied', 'get_upload_extraction_checkpoint', identities(row), { token: owner.token, expected: 403 });
  assert.equal(rpcDenied.code, '42501');
  const anonDenied = await request('anonymous private source denied', '/rest/v1/uploads?select=ingest_source_manifest', {
    method:'GET', token:config.ANON_KEY, expected:401,
  });
  assert.equal(anonDenied.code, '42501');
  const independent = JSON.parse(sql('upload-source-independent-read', `select json_build_object(
    'manifest',ingest_source_manifest,'digest',ingest_source_manifest_sha256,
    'digest_matches',ingest_source_manifest_sha256=private.upload_source_manifest_digest(ingest_source_manifest),
    'text',ingest_extraction_text,'contract',ingest_extraction_contract_version)
    from public.uploads where id='${row.id}';`));
  assert.deepEqual(independent, { manifest, digest: adopted.source_manifest_sha256, digest_matches:true,
    text:row.text, contract:'upload-extraction.2' });
  await advance(row,'storage_completed','provider_dispatched');
  const completed = await complete(row);
  assert.deepEqual((await rpc('v2 terminal response replay', 'claim_upload_ingest', { ...claimArgs(row), p_extraction_contract_version:'upload-extraction.2' })).response,completed);
  save('upload-source-upgrade-acceptance.json', { passed:true, project, origin, checks,
    fixtureUserIds:users.map(user=>user.id), historicalUploadIds:oldRows.map(item=>item.id), sourceUploadId:row.id, otherUploadId,
    sourceManifestSha256:adopted.source_manifest_sha256,
    scope:'Real local Auth/PostgREST old named calls, pre-migration failure, exact forward migration preserving historical rows, source readback/replay, owner isolation and independent SQL. Original bytes inspected locally; Storage, extractor HTTP, real provider, browser editing and export not exercised.' });
}
