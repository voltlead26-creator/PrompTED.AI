// Finite nested acceptance, called only by the attested disposable DB runner.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { Readable } from 'node:stream';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUploadProbeBody, uploadOrigins as origins, uploadProxyTarget } from './workspace-upload-transport.mjs';
import { uploadRunDisposition } from './upload-run-disposition.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = text => `'${String(text).replaceAll("'", "''")}'`;
export async function exerciseNewWorkspaceUploads({ root, project, workdir, env, evidence, checkTarget, save, sql }) {
  checkTarget(); assert.equal(root, realpathSync(fileURLToPath(new URL('../../../', import.meta.url))));
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/); assert.ok(workdir.includes(`${project}-`));
  const status = spawnSync('supabase', ['--workdir', workdir, '--agent', 'no', 'status', '-o', 'json'], {
    cwd: workdir, env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(status.status, 0, 'Disposable status failed');
  let config;
  try { config = JSON.parse(status.stdout); } catch { throw new Error('Invalid disposable status JSON'); }
  assert.equal(config.API_URL, origins.supabase);
  for (const key of ['ANON_KEY', 'SERVICE_ROLE_KEY']) assert.ok(typeof config[key] === 'string' && config[key].length > 20);
  const users = []; const children = []; const httpChecks = []; const proxyChecks = [];
  const profileBefore = new Map();
  const profileFields = ['display_name', 'full_name', 'preferred_name', 'phone', 'date_of_birth',
    'address_line_1', 'address_line_2', 'suburb', 'state', 'postcode', 'country'];
  const profileProtected = value => Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![...profileFields, 'updated_at'].includes(key)));
  let proxy; let passed = false; let primaryError = null;
  const privatePaths = [join(workdir, 'workspace-upload-provider.json'), join(workdir, 'workspace-upload-browser-fixture.json')];
  const redact = text => [config.ANON_KEY, config.SERVICE_ROLE_KEY, ...users.map(user => user.password)]
    .reduce((value, secret) => value.replaceAll(secret, '[local credential redacted]'), String(text))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[local JWT redacted]');
  async function request(path, { method = 'POST', body, token = config.SERVICE_ROLE_KEY, binary = false } = {}) {
    checkTarget(); const url = new URL(path, origins.supabase); assert.equal(url.origin, origins.supabase);
    assert.ok(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/object/'));
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal, redirect: 'error', cache: 'no-store' });
    const bytes = await readUploadProbeBody(response.body, 2 * 1024 * 1024, signal);
    httpChecks.push({ path: url.pathname, method, status: response.status }); save('upload-browser-http-checks.json', httpChecks);
    assert.equal(response.status, 200, `Local fixture request failed: ${url.pathname}`);
    if (binary) return Buffer.from(bytes);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error(`Invalid local fixture JSON: ${url.pathname}`); }
  }
  function kill(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  function start(label, executable, args, childEnv, cwd = root, timeout = 600000, kind = 'service') {
    checkTarget();
    const child = spawn(executable, args, { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = { label, kind, child, output: '', failure: null, result: null,
      shutdownRequested: false, forcedTermination: false }; children.push(record);
    const stop = reason => {
      if (record.failure) return; record.failure = reason; kill(child, 'SIGTERM');
      record.forced = setTimeout(() => { record.forcedTermination = true; kill(child, 'SIGKILL'); }, 5000);
    };
    child.on('error', error => stop(error.code ?? 'spawn failed'));
    record.closed = new Promise(resolve => child.once('close', (code, signal) => {
      record.result = { code, signal }; clearTimeout(record.deadline); clearTimeout(record.forced); resolve(record.result);
    }));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      if (record.output.length + chunk.length > 8 * 1024 * 1024) { stop('Child output exceeded bound'); return; }
      record.output += chunk.toString();
    });
    record.deadline = setTimeout(() => stop('Child deadline exceeded'), timeout); return record;
  }
  async function command(label, executable, args, childEnv, cwd) {
    const record = start(label, executable, args, childEnv, cwd, 600000, 'command');
    const result = await record.closed; kill(record.child, 'SIGKILL');
    save(`${label}.log`, redact(record.output)); assert.equal(record.failure, null, label); assert.equal(result.code, 0, label);
  }
  const freePort = port => new Promise((resolve, reject) => {
    const server = createPortProbe(); server.once('error', reject);
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => server.close(resolve));
  });
  async function ready(record, url, expected) {
    const listenerAcknowledged = () => record.label === 'new-upload-next'
      ? record.output.includes('Ready in ')
      : record.output.includes(JSON.stringify({ event: 'owned-upload-listener', project,
        entry: record.label, port: record.label === 'ingest-upload' ? 58325 : 58326 }));
    for (let n = 0; n < 60; n++) {
      assert.equal(record.failure, null); assert.equal(record.result, null, `${record.label} exited before readiness`);
      try {
        if (!listenerAcknowledged()) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
        const signal = AbortSignal.timeout(1000);
        const response = await fetch(url, { signal, redirect: 'error', cache: 'no-store' });
        await readUploadProbeBody(response.body, 128 * 1024, signal);
        assert.equal(record.failure, null); assert.equal(record.result, null, `${record.label} exited during readiness`);
        if (response.status === expected) return;
      } catch (error) { if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`${record.label} failed readiness`);
  }
  const outputDir = join(evidence, 'upload-browser'); mkdirSync(outputDir);
  try {
    assert.equal(Number(sql('new-upload-empty-inventory', 'select count(*) from public.uploads;')), 0);
    for (const slot of ['a', 'b']) {
      const email = `${project}-upload-${slot}@example.invalid`; const password = randomBytes(30).toString('base64url');
      const created = await request('/auth/v1/admin/users', { body: { email, password, email_confirm: true } });
      assert.match(created.id, /^[0-9a-f-]{36}$/); users.push({ id: created.id, email, password });
      const session = await request('/auth/v1/token?grant_type=password', { token: config.ANON_KEY, body: { email, password } });
      assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
      assert.ok(session.user.identities.length > 0);
      const initialProfile = JSON.parse(sql('browser-profile-before-' + slot,
        `select to_jsonb(p) from public.profiles p where id=${literal(created.id)}::uuid;`));
      assert.equal(initialProfile.id, created.id); profileBefore.set(created.id, profileProtected(initialProfile));
    }
    assert.equal(Number(sql('new-upload-capacity-absent', "select count(*) from private.openai_capacity_route_configs where environment='test' and semantic_route='fast';")), 0);
    const capacity = { p_environment: 'test', p_semantic_route: 'fast', p_enabled: true, p_global_active_limit: 2,
      p_per_user_active_limit: 1, p_global_request_limit_per_minute: 60, p_global_token_limit_per_minute: 2000000,
      p_lease_seconds: 180, p_retry_after_seconds: 5, p_expected_revision: 0,
      p_changed_by: 'workspace-upload-local-acceptance',
      p_change_reason: 'Synthetic intercepted Responses transport in attested disposable database' };
    const capacityResult = await request('/rest/v1/rpc/configure_openai_capacity_route', { body: capacity });
    assert.equal(capacityResult.contract_version, 'openai-capacity-config.v1'); assert.equal(capacityResult.config_revision, 1);
    for (const name of ['environment', 'semantic_route', 'enabled', 'global_active_limit', 'per_user_active_limit',
      'global_request_limit_per_minute', 'global_token_limit_per_minute', 'lease_seconds', 'retry_after_seconds']) assert.equal(capacityResult[name], capacity[`p_${name}`]);
    save('upload-browser-capacity.json', capacityResult);
    const capacityRow = JSON.parse(sql('new-upload-capacity-independent-read', "select to_jsonb(c) from private.openai_capacity_route_configs c where environment='test' and semantic_route='fast';"));
    for (const name of ['environment', 'semantic_route', 'enabled', 'global_active_limit', 'per_user_active_limit',
      'global_request_limit_per_minute', 'global_token_limit_per_minute', 'lease_seconds', 'retry_after_seconds']) assert.equal(capacityRow[name], capacity[`p_${name}`]);
    assert.equal(capacityRow.config_revision, 1);
    assert.equal(Number(sql('new-upload-capacity-revision', "select count(*) from private.openai_capacity_route_config_revisions where environment='test' and semantic_route='fast' and config_revision=1;")), 1);
    const text = 'TextEdit notes\nRenée — 日本語 😀\nKeep this wording.';
    const md = '# Overview\nThis is synthetic wording for the upload acceptance test.\n\nThe owner checks this paragraph before saving.\n\n# Next steps\n- Keep the original.\n- Reopen the saved document.';
    const utf16 = Buffer.from(text + '\n', 'utf16le');
    const definitions = [
      { name: 'Protected.pdf', mime: 'application/pdf', format: 'pdf', bytes: readFileSync(join(workdir, 'position-left.pdf')), text: 'Format protected document' },
      { name: 'Protected.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', format: 'docx', bytes: readFileSync(join(workdir, 'source-preservation.docx')), text: 'Format protected document' },
      { name: 'TextEdit.rtf', mime: 'application/rtf', format: 'rtf', bytes: readFileSync(join(workdir, 'rtf-appkit-original.rtf')), text: 'Source-preservation fixture\nRenée — 日本語 😀\nKeep each paragraph and these exact words.' },
      { name: 'TextEdit LE.txt', mime: 'text/plain', format: 'text', bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]), text },
      { name: 'TextEdit BE.txt', mime: 'text/plain', format: 'text', bytes: Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16).swap16()]), text },
      { name: 'Plain.txt', mime: 'text/plain', format: 'text', bytes: Buffer.from(text + '\n'), text },
      { name: 'Notes.md', mime: 'text/markdown', format: 'text', bytes: Buffer.from(md + '\n'), text: md, importText: true },
      { name: 'Records.csv', mime: 'text/csv', format: 'text', bytes: Buffer.from('name,value\nsynthetic,10\n'), text: 'name,value\nsynthetic,10' },
    ];
    assert.equal(sha(definitions[1].bytes), 'a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799');
    assert.equal(sha(definitions[2].bytes), 'c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84');
    mkdirSync(join(workdir, 'upload-inputs'));
    const files = definitions.map(({ bytes, ...file }) => {
      const path = join(workdir, 'upload-inputs', file.name); writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
      return { ...file, importText: file.importText ?? false, path, sha256: sha(bytes), byteLength: bytes.length };
    });
    writeFileSync(privatePaths[0], JSON.stringify(files.map(({ text }) => ({ text }))), { mode: 0o600, flag: 'wx' });
    writeFileSync(privatePaths[1], JSON.stringify({ version: 'workspace-upload-browser.1', project,
      webOrigin: origins.web, supabaseOrigin: origins.front, outputDir, users, files }), { mode: 0o600, flag: 'wx' });
    const functionEnv = { ...env, SUPABASE_URL: origins.supabase, SUPABASE_ANON_KEY: config.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY, PROMPTED_DEPLOYMENT_ENV: 'test',
      OPENAI_API_KEY: 'synthetic-upload-transport-only', OPENAI_FAST_MODEL: 'synthetic-upload-fast',
      OPENAI_ROUTING_VERSION: 'routing.upload-local-acceptance.1', OLLAMA_CREDIT_FALLBACK_ENABLED: 'false',
      PROMPTED_LEGACY_UPLOAD_ID_ADAPTER: 'disabled', ALLOWED_ORIGINS: origins.web };
    const bootstrap = join(root, 'docs/evidence/web-operational-readiness/workspace-upload-deno.ts');
    for (const entry of ['extract-upload', 'ingest-upload']) {
      await freePort(entry === 'ingest-upload' ? 58325 : 58326);
      const record = start(entry, 'deno', ['run', '--cached-only', '--frozen', '--allow-env',
        `--allow-read=${root},${workdir}`, '--allow-net=127.0.0.1:58321,127.0.0.1:58325,127.0.0.1:58326', bootstrap, entry, privatePaths[0]], functionEnv);
      await ready(record, origins[entry === 'ingest-upload' ? 'ingest' : 'extract'] + `/functions/v1/${entry}`, entry === 'ingest-upload' ? 405 : 405);
    }
    proxy = createServer(async (req, res) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90000);
      req.on('aborted', () => controller.abort()); res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      try {
        for (const child of children.filter(child => ['extract-upload', 'ingest-upload', 'new-upload-next'].includes(child.label))) {
          assert.equal(child.failure, null); assert.equal(child.result, null, 'Owned service stopped during browser exercise');
        }
        assert.ok(proxyChecks.length < 3000, 'Local proxy request bound exceeded');
        const target = uploadProxyTarget(req.url, req.method);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && !['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(name)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const body = await readUploadProbeBody(Readable.toWeb(req), 9 * 1024 * 1024, controller.signal);
        const response = await fetch(target, { method: req.method, headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
          signal: controller.signal, redirect: 'error', cache: 'no-store' });
        const bytes = await readUploadProbeBody(response.body, 12 * 1024 * 1024, controller.signal);
        proxyChecks.push({ path: new URL(target).pathname, method: req.method, status: response.status });
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (!['connection', 'content-length', 'transfer-encoding', 'content-encoding', 'set-cookie'].includes(name)) res.setHeader(name, value);
        const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(bytes);
      } catch (error) {
        proxyChecks.push({ path: req.url?.split('?')[0], method: req.method, failed: error.name });
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end('{"error":"Local acceptance transport failed"}');
      } finally { clearTimeout(timer); }
    });
    proxy.requestTimeout = 90000; proxy.headersTimeout = 10000;
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(58324, '127.0.0.1', resolve); });
    const webEnv = { ...env, NEXT_PUBLIC_APP_ENV: 'local', NEXT_PUBLIC_API_BASE_URL: '/api',
      NEXT_PUBLIC_SUPABASE_URL: origins.front, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.ANON_KEY,
      NEXT_PUBLIC_SENTRY_DSN: '', NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_REVENUECAT_WEB_KEY: '', NEXT_TELEMETRY_DISABLED: '1' };
    await command('new-upload-local-build', 'pnpm', ['--filter', '@prompted/web', 'build'], webEnv);
    const buildId = readFileSync(join(root, 'apps/web/.next/BUILD_ID'), 'utf8').trim(); assert.match(buildId, /^[A-Za-z0-9_-]+$/);
    await freePort(58323);
    const web = start('new-upload-next', process.execPath, [join(root, 'apps/web/node_modules/next/dist/bin/next'),
      'start', '--hostname', '127.0.0.1', '--port', '58323'], webEnv, join(root, 'apps/web'));
    await ready(web, `${origins.web}/_next/static/${buildId}/_buildManifest.js`, 200);
    await command('new-upload-playwright', 'pnpm', ['exec', 'playwright', 'test', '--config', 'tests/e2e/upload.playwright.config.ts'],
      { ...env, PROMPTED_UPLOAD_E2E_FIXTURE: privatePaths[1], PLAYWRIGHT_BROWSERS_PATH: join(root, 'node_modules/.cache/playwright') });
    const reports = [];
    const visit = path => { for (const name of readdirSync(path)) {
      const child = join(path, name); const stat = lstatSync(child); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) visit(child); else if (name === 'upload-browser-checks.json') reports.push(JSON.parse(readFileSync(child, 'utf8')));
    } }; visit(outputDir); assert.equal(reports.length, 2);
    assert.deepEqual(reports.map(report => report.ownerId).sort(), users.map(user => user.id).sort());
    assert.deepEqual(reports.map(report => report.project).sort(), ['desktop-chromium', 'narrow-chromium']);
    assert.equal(new Set(reports.flatMap(report => report.records.map(record => record.uploadId))).size, files.length * 2);
    const count = files.length * 2;
    assert.equal(Number(sql('new-upload-final-count', 'select count(*) from public.uploads;')), count);
    const proofs = []; const profileProofs = [];
    for (const report of reports) {
      const user = users.find(user => user.id === report.ownerId); assert.ok(user); assert.equal(report.records.length, files.length); assert.equal(report.complete, true);
      const session = await request('/auth/v1/token?grant_type=password', { token: config.ANON_KEY, body: { email: user.email, password: user.password } });
      assert.equal(session.user.id, user.id);
      assert.deepEqual(report.profileStages, ['initial_read_failure_visible', 'real_profile_read_recovered',
        'primary_button_press_feedback', 'detail_save_acknowledged', 'saved_details_reloaded', 'independent_tab_reopened', 'changed_owner_isolated', 'anonymous_access_denied']);
      assert.deepEqual(report.profileReadFaultAttempts, [0, 1, 2, 3]);
      const slot = users.indexOf(user); const letter = slot === 0 ? 'A' : 'B';
      const expectedDetails = { display_name: `Local owner ${letter}`, full_name: `Synthetic Profile ${letter}`,
        preferred_name: `Local owner ${letter}`, phone: slot === 0 ? '0420000001' : '0420000002', date_of_birth: null,
        address_line_1: `${slot + 1} Synthetic Street`, address_line_2: null,
        suburb: 'Test suburb', state: 'VIC', postcode: '3000', country: 'Australia' };
      const persistedProfile = JSON.parse(sql('browser-profile-after-' + slot,
        `select to_jsonb(p) from public.profiles p where id=${literal(user.id)}::uuid;`));
      assert.deepEqual(profileProtected(persistedProfile), profileBefore.get(user.id), 'Protected Profile fields changed');
      assert.deepEqual(Object.fromEntries(profileFields.map(key => [key, persistedProfile[key]])), expectedDetails);
      const ownDetails = await request(`/rest/v1/profiles?${new URLSearchParams({ select: profileFields.join(','), id: `eq.${user.id}` })}`,
        { method: 'GET', token: session.access_token });
      assert.deepEqual(ownDetails, [expectedDetails]);
      const otherDetails = await request(`/rest/v1/profiles?${new URLSearchParams({ select: profileFields.join(','), id: `eq.${users[1 - slot].id}` })}`,
        { method: 'GET', token: session.access_token });
      assert.deepEqual(otherDetails, [], 'Cross-owner Profile read returned rows');
      assert.equal(Number(sql('browser-profile-resumes-absent-' + slot,
        `select count(*) from public.profile_resume_versions where user_id=${literal(user.id)}::uuid;`)), 0);
      profileProofs.push({ ownerId: user.id, project: report.project, details: expectedDetails,
        protectedFieldsUnchanged: true, ownerRead: true, otherOwnerDenied: true, resumes: 0 });
      for (const record of report.records) {
        const file = files.find(file => record.name === `${report.project}-${file.name}`); assert.ok(file);
        const query = `select jsonb_build_object('upload',jsonb_build_object('id',u.id,'user_id',u.user_id,'file_name',u.file_name,'file_size_bytes',u.file_size_bytes,
          'storage_path',u.storage_path,'status',u.status,'ingest_status',u.ingest_status,'ingest_stage',u.ingest_stage,
          'ingest_http_status',u.ingest_http_status,'completed_at',u.completed_at,'error_code',u.error_code,
          'document_id',u.document_id,'outcome_id',u.outcome_id,'ingest_extraction_contract_version',u.ingest_extraction_contract_version,
          'ingest_extraction_policy_version',u.ingest_extraction_policy_version,'ingest_extraction_format',u.ingest_extraction_format,
          'ingest_extraction_truncated',u.ingest_extraction_truncated,'ingest_content_sha256',u.ingest_content_sha256),
          'receipt_matches',u.ingest_response=${literal(JSON.stringify(record.receipt))}::jsonb,
          'text_matches',u.ingest_extraction_text=${literal(file.text)} and u.extracted_text=u.ingest_extraction_text,
          'text_digest_valid',u.ingest_extraction_text_sha256=encode(extensions.digest(convert_to(u.ingest_extraction_text,'UTF8'),'sha256'),'hex'),
          'source_digest_valid',case when u.ingest_source_manifest is null then u.ingest_source_manifest_sha256 is null else
            u.ingest_source_manifest_sha256=private.upload_source_manifest_digest(u.ingest_source_manifest) end,
          'accounting_valid',(select coalesce(bool_and(
            l.event_type='model_call' and l.model_call_status='succeeded' and l.provider_status='completed' and l.provider='openai'
            and l.provider_error_code is null and l.provider_attempt_number=1 and a.attempt_number=1
            and a.checkpoint_scope='ingest-upload' and a.logical_stage_key='ingest-upload.classify'
            and a.origin_reservation_id is null and a.dispatched_at is not null and a.dispatch_token is not null
            and a.reconciliation_required_at is null and a.reconciliation_code is null
            and r.origin_reservation_id is null and r.response_sha256=encode(extensions.digest(convert_to(r.response_envelope::text,'UTF8'),'sha256'),'hex')
            and exists(select 1 from private.user_external_egress_dispatches e where e.user_key=private.account_deletion_user_key(u.user_id)
              and e.egress_kind='openai' and e.egress_route='responses' and e.state='completed' and e.completed_at is not null
              and e.resource_sha256=encode(extensions.digest(convert_to(a.id::text,'UTF8'),'sha256'),'hex'))),false)
            from public.usage_ledger l join private.legacy_model_attempt_admissions a on a.id::text=l.provider_attempt_id and a.user_id=l.user_id
              and a.logical_request_id=l.logical_request_id and a.checkpoint_scope=l.checkpoint_scope
              and a.logical_stage_key=l.logical_stage_key and a.request_sha256=l.provider_request_sha256
            join private.legacy_model_call_results r on r.user_id=l.user_id and r.usage_ledger_id=l.id
              and r.logical_request_id=l.logical_request_id and r.checkpoint_scope=l.checkpoint_scope
              and r.logical_stage_key=l.logical_stage_key and r.request_sha256=l.provider_request_sha256
            where l.user_id=u.user_id and l.logical_request_id=u.id::text),
          'usage',coalesce((select jsonb_agg(to_jsonb(l)) from public.usage_ledger l where l.user_id=u.user_id and l.logical_request_id=u.id::text),'[]'::jsonb),
          'attempt_count',(select count(*) from private.legacy_model_attempt_admissions a where a.user_id=u.user_id and a.logical_request_id=u.id::text),
          'result_count',(select count(*) from private.legacy_model_call_results r where r.user_id=u.user_id and r.logical_request_id=u.id::text))
          from public.uploads u where u.id=${literal(record.uploadId)}::uuid and u.user_id=${literal(user.id)}::uuid;`;
        const proof = JSON.parse(sql('new-upload-independent-proof-' + proofs.length, query)); const u = proof.upload;
        for (const key of ['receipt_matches', 'text_matches', 'text_digest_valid', 'source_digest_valid', 'accounting_valid']) assert.equal(proof[key], true, key);
        assert.equal(u.ingest_status, 'completed'); assert.equal(u.ingest_stage, 'terminal'); assert.equal(u.ingest_http_status, 200);
        assert.ok(u.completed_at); assert.equal(u.error_code, null); assert.equal(u.status, file.importText ? 'committed' : 'ready');
        assert.equal(u.ingest_extraction_contract_version, 'upload-extraction.3'); assert.equal(u.ingest_extraction_policy_version, 'upload-resource-policy.2');
        assert.equal(u.ingest_extraction_format, file.format); assert.equal(u.ingest_extraction_truncated, false);
        assert.equal(u.ingest_content_sha256, file.sha256); assert.equal(u.file_size_bytes, file.byteLength);
        assert.equal(u.file_name, record.name); assert.equal(u.outcome_id, record.outcomeId);
        if (!file.importText) assert.equal(u.document_id, null);
        assert.equal(proof.attempt_count, 1); assert.equal(proof.result_count, 1); assert.equal(proof.usage.length, 1);
        const usage = proof.usage[0]; assert.equal(usage.event_type, 'model_call'); assert.equal(usage.model_call_status, 'succeeded');
        assert.equal(usage.provider_status, 'completed'); assert.equal(usage.provider, 'openai'); assert.equal(usage.model, 'synthetic-upload-fast');
        assert.equal(usage.routing_version, 'routing.upload-local-acceptance.1'); assert.equal(usage.provider_attempt_number, 1);
        assert.equal(usage.provider_error_code, null); assert.equal(usage.input_tokens, 17); assert.equal(usage.output_tokens, 9);
        assert.equal(usage.checkpoint_scope, 'ingest-upload'); assert.equal(usage.logical_stage_key, 'ingest-upload.classify');
        const actual = await request('/storage/v1/object/original-documents/' + u.storage_path.split('/').map(encodeURIComponent).join('/'),
          { method: 'GET', token: session.access_token, binary: true });
        assert.ok(actual.equals(readFileSync(file.path))); assert.equal(sha(actual), file.sha256);
        if (file.importText) {
          const document = JSON.parse(sql('new-upload-document-proof-' + proofs.length, `select jsonb_build_object(
            'title',d.title,'status',d.status,'owner',d.user_id,'outcome',d.outcome_id,'outcome_status',o.status,
            'outcome_owner',o.user_id,'sections',(select jsonb_agg(jsonb_build_object('name',s.name,'content',s.content,
              'order',s.order_index,'status',s.status,'owner',s.user_id) order by s.order_index) from public.sections s where s.document_id=d.id))
            from public.documents d join public.outcomes o on o.id=d.outcome_id where d.id=${literal(u.document_id)}::uuid;`));
          assert.equal(document.title, record.name.replace(/\.[^.]+$/, '')); assert.equal(document.status, 'draft');
          assert.equal(document.owner, user.id); assert.equal(document.outcome_owner, user.id);
          assert.equal(document.outcome, record.outcomeId); assert.equal(document.outcome_status, 'in_progress');
          assert.deepEqual(document.sections.map(section => section.order), [0, 1]);
          assert.deepEqual(document.sections.map(({ name, content, status, owner }) => ({ name, content, status, owner })), [
            { name: 'Overview', content: 'This is synthetic wording for the upload acceptance test.\n\nThe owner checks this paragraph before saving.', status: 'draft', owner: user.id },
            { name: 'Next steps', content: '- Keep the original.\n\n- Reopen the saved document.', status: 'draft', owner: user.id },
          ]);
        }
        proofs.push({ uploadId: u.id, ownerId: u.user_id, name: u.file_name, byteLength: actual.length, sha256: sha(actual),
          status: u.status, outcomeId: u.outcome_id, documentId: u.document_id, providerResponseId: usage.provider_response_id });
      }
    }
    for (const user of users) {
      const totals = JSON.parse(sql('new-upload-owner-totals-' + user.id, `select jsonb_build_object(
        'usage',(select count(*) from public.usage_ledger where user_id=${literal(user.id)}::uuid),
        'attempts',(select count(*) from private.legacy_model_attempt_admissions where user_id=${literal(user.id)}::uuid),
        'results',(select count(*) from private.legacy_model_call_results where user_id=${literal(user.id)}::uuid),
        'leases',(select count(*) from private.openai_capacity_leases where user_id=${literal(user.id)}::uuid),
        'leases_valid',(select coalesce(bool_and(environment='test' and semantic_route='fast' and config_revision=1
          and dispatched_at is not null and released_at is not null and terminal_outcome='completed'),false)
          from private.openai_capacity_leases where user_id=${literal(user.id)}::uuid),
        'egress',(select count(*) from private.user_external_egress_dispatches where user_key=private.account_deletion_user_key(${literal(user.id)}::uuid)),
        'documents',(select count(*) from public.documents where user_id=${literal(user.id)}::uuid),
        'outcomes',(select count(*) from public.outcomes where user_id=${literal(user.id)}::uuid));`));
      assert.deepEqual(totals, { usage: files.length, attempts: files.length, results: files.length, leases: files.length,
        leases_valid: true, egress: files.length, documents: 1, outcomes: 1 });
    }
    const dispatches = children.find(child => child.label === 'ingest-upload').output.split('\n').filter(line => line.startsWith('{"event":"synthetic-responses"')).map(line => JSON.parse(line));
    assert.equal(dispatches.length, count); assert.equal(new Set(dispatches.map(row => row.clientRequestId)).size, count);
    assert.ok(proxyChecks.every(row => !row.failed), 'Unexpected local proxy failure');
    save('new-upload-independent-proofs.json', { passed: true, proofs, dispatches });
    save('profile-browser-independent-proofs.json', { passed: true, proofs: profileProofs,
      scope: 'Real local Profile access/details save/reload/new tab and initial-read recovery. Empty resume slots; no browser resume replacement/restore/download proof.' });
    checkTarget(); passed = true;
  } catch (error) {
    primaryError = error;
    try {
      save('new-upload-workflow-failure.txt', redact(error.stack ?? String(error)));
      // Preserve bounded independent state for these exact synthetic owners
      // before teardown. This observes only; it never retries a failed write.
      if (users.length > 0) sql('new-upload-failure-diagnostics', `select coalesce(jsonb_agg(jsonb_build_object(
        'id',u.id,'owner_id',u.user_id,'filename',u.file_name,'status',u.status,'ingest_status',u.ingest_status,
        'stage',u.ingest_stage,'http_status',u.ingest_http_status,'content_sha256',u.ingest_content_sha256,
        'text_sha256',u.ingest_extraction_text_sha256,'document_id',u.document_id,'outcome_id',u.outcome_id,
        'sections',(select jsonb_agg(jsonb_build_object('id',s.id,'owner_id',s.user_id,'name',s.name,
          'order_index',s.order_index,'content',s.content,'revision',s.revision) order by s.order_index)
          from public.sections s where s.document_id=u.document_id and s.user_id=u.user_id),
        'usage_count',(select count(*) from public.usage_ledger l where l.user_id=u.user_id and l.logical_request_id=u.id::text)
      )),'[]'::jsonb) from (select * from public.uploads where user_id in (${users.map(user => literal(user.id) + '::uuid').join(',')})
        order by user_id,file_name,id limit 17) u;`);
    } catch (diagnosticError) {
      // The original workflow failure remains primary if diagnostics fail too.
      try { save('new-upload-diagnostic-failure.txt', redact(diagnosticError.message ?? String(diagnosticError))); } catch { /* Cleanup still runs below. */ }
    }
  } finally {
    const cleanupFailures = [];
    const clean = async (label, operation) => {
      try { await operation(); } catch (error) { cleanupFailures.push(`${label}: ${redact(error.message ?? String(error))}`); }
    };
    for (const record of [...children].reverse()) {
      await clean(record.label, async () => {
        if (!record.result) {
          record.shutdownRequested = true; kill(record.child, 'SIGTERM');
          const force = setTimeout(() => { record.forcedTermination = true; kill(record.child, 'SIGKILL'); }, 10000);
          await record.closed; clearTimeout(force);
        }
        kill(record.child, 'SIGKILL');
      });
      await clean(`${record.label} evidence`, () => save(`${record.label}.log`, redact(record.output)));
    }
    await clean('front door', async () => {
      if (proxy?.listening) { proxy.closeAllConnections(); await new Promise((resolve, reject) => proxy.close(error => error ? reject(error) : resolve())); }
    });
    for (const path of privatePaths) await clean('private fixture removal', () => rmSync(path, { force: true }));
    const sanitize = directory => { for (const name of readdirSync(directory)) {
      const path = join(directory, name); const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) sanitize(path);
      else if (['playwright-results.json', 'error-context.md', 'upload-browser-checks.json'].includes(name)) writeFileSync(path, redact(readFileSync(path, 'utf8')));
    } }; await clean('browser diagnostic redaction', () => { if (lstatSync(outputDir, { throwIfNoEntry: false })) sanitize(outputDir); });
    const childResults = children.map(({ label, kind, result, failure, shutdownRequested, forcedTermination }) =>
      ({ label, kind, result, failure, shutdownRequested, forcedTermination }));
    const disposition = uploadRunDisposition({ checksPassed: passed,
      primaryFailure: primaryError ? redact(primaryError.message ?? String(primaryError)) : null,
      children: childResults, cleanupFailures });
    await clean('runtime evidence', () => save('new-upload-runtime.json', { ...disposition, project, proxyChecks,
      privateFixturesRemoved: privatePaths.every(path => !lstatSync(path, { throwIfNoEntry: false })), children: childResults,
      scope: 'Local production entrypoints, controlled Responses transport; no hosted/model quality/edit/export acceptance.' }));
    if (primaryError) throw primaryError;
    assert.ok(disposition.passed && cleanupFailures.length === 0, disposition.primaryFailure ?? cleanupFailures[0] ?? 'Upload acceptance incomplete');
  }
}
