// Finite nested acceptance, called only by the attested disposable DB runner.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { Readable } from 'node:stream';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUploadProxyLifetime, readUploadProbeBody, uploadOrigins as origins, uploadProxyTarget } from './workspace-upload-transport.mjs';
import { uploadRunDisposition } from './upload-run-disposition.mjs';
import { resolveAcceptancePlaywright } from './acceptance-runtime.mjs';
import { createDenoExecutionBoundary } from '../../../scripts/deno-execution-boundary.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = text => `'${String(text).replaceAll("'", "''")}'`;
const accountPlanTestName = 'account plan comparison uses confirmed Free access for historical Business';
export async function exerciseNewWorkspaceUploads({ root, project, workdir, env, evidence, checkTarget, save, sql, sqlSessionCommand }) {
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
  let proxy; let passed = false; let primaryError = null; let denoBoundary;
  const privatePaths = [join(workdir, 'workspace-upload-provider.json'), join(workdir, 'workspace-upload-browser-fixture.json')];
  const redact = text => [config.ANON_KEY, config.SERVICE_ROLE_KEY, ...users.map(user => user.password)]
    .reduce((value, secret) => value.replaceAll(secret, '[local credential redacted]'), String(text))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[local JWT redacted]');
  async function request(path, { method = 'POST', body, token = config.SERVICE_ROLE_KEY, binary = false,
    expectedStatus = 200, representation = false } = {}) {
    checkTarget(); const url = new URL(path, origins.supabase); assert.equal(url.origin, origins.supabase);
    assert.ok(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/object/'));
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: config.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json',
        ...(representation ? { prefer: 'return=representation' } : {}) },
      signal, redirect: 'error', cache: 'no-store' });
    const bytes = await readUploadProbeBody(response.body, 2 * 1024 * 1024, signal);
    const httpCheck = { path: url.pathname, method, status: response.status };
    // Authentication error bodies can echo credentials not yet registered for redaction.
    if (!response.ok && !binary && !url.pathname.startsWith('/auth/v1/')) {
      let errorBody;
      try { errorBody = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { httpCheck.error = { body: 'invalid_json' }; }
      if (!httpCheck.error) {
        if (!errorBody || typeof errorBody !== 'object' || Array.isArray(errorBody)) {
          httpCheck.error = { body: 'invalid_shape' };
        } else {
          httpCheck.error = { body: 'json_object' };
          const code = typeof errorBody.code === 'string' ? redact(errorBody.code) : null;
          if (code !== null && /^[A-Za-z0-9_]{1,64}$/.test(code)) httpCheck.error.code = code;
          if (typeof errorBody.message === 'string') {
            httpCheck.error.message = redact(errorBody.message).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 512);
          }
        }
      }
    }
    httpChecks.push(httpCheck); save('upload-browser-http-checks.json', httpChecks);
    if (Array.isArray(expectedStatus)) assert.ok(expectedStatus.includes(response.status), `Local fixture request failed: ${url.pathname} (${response.status})`);
    else assert.equal(response.status, expectedStatus, `Local fixture request failed: ${url.pathname}`);
    if (binary) return Buffer.from(bytes);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error(`Invalid local fixture JSON: ${url.pathname}`); }
  }
  function kill(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  function start(label, executable, args, childEnv, cwd = root, timeout = 600000, kind = 'service', interactiveInput = false) {
    checkTarget();
    const child = spawn(executable, args, { cwd, env: childEnv, detached: true, stdio: [interactiveInput ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const record = { label, kind, child, output: '', failure: null, result: null,
      shutdownRequested: false, forcedTermination: false }; children.push(record);
    const stop = reason => {
      if (record.failure) return; record.failure = reason; kill(child, 'SIGTERM');
      record.forced = setTimeout(() => { record.forcedTermination = true; kill(child, 'SIGKILL'); }, 5000);
    };
    child.on('error', error => stop(error.code ?? 'spawn failed'));
    if (interactiveInput) child.stdin.on('error', error => stop(error.code ?? 'SQL input failed'));
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
    const roleSessions = [];
    for (const slot of ['a', 'b']) {
      const email = `${project}-upload-${slot}@example.invalid`; const password = randomBytes(30).toString('base64url');
      const created = await request('/auth/v1/admin/users', { body: { email, password, email_confirm: true } });
      assert.match(created.id, /^[0-9a-f-]{36}$/); users.push({ id: created.id, email, password });
      const session = await request('/auth/v1/token?grant_type=password', { token: config.ANON_KEY, body: { email, password } });
      assert.equal(session.user.id, created.id); assert.equal(session.user.is_anonymous, false);
      roleSessions.push(session.access_token);
      assert.ok(session.user.identities.length > 0);
      const initialProfile = JSON.parse(sql('browser-profile-before-' + slot,
        `select to_jsonb(p) from public.profiles p where id=${literal(created.id)}::uuid;`));
      assert.equal(initialProfile.id, created.id); profileBefore.set(created.id, profileProtected(initialProfile));
    }
    // Real authenticated PostgREST/unique-key/RLS/trigger exercise. An ignored
    // acknowledgement followed by the same event UUID must not insert again
    // or rewind latest_stage after a later event has been recorded.
    const roleId = await request('/rest/v1/rpc/save_own_role_with_default_actions', { token: roleSessions[0], body: {
      p_role_title: 'Synthetic retry acceptance', p_company_name: project, p_location: null,
      p_match_percentage: null, p_job_url: null, p_source_label: null, p_contact_email: null, p_contact_source_status: null,
    } });
    assert.match(roleId, /^[0-9a-f-]{36}$/);
    const event = { id: randomUUID(), user_id: users[0].id, saved_role_id: roleId,
      stage: 'applied', note: 'Synthetic original note', occurred_at: '2026-09-13' };
    const eventColumns = 'id,user_id,saved_role_id,stage,note,occurred_at';
    const inserted = await request(`/rest/v1/role_outcomes?select=${eventColumns}`, { token: roleSessions[0],
      body: event, expectedStatus: 201, representation: true });
    assert.deepEqual(inserted, [event]);
    const duplicate = await request('/rest/v1/role_outcomes', { token: roleSessions[0], body: event, expectedStatus: 409 });
    assert.equal(duplicate.code, '23505');
    const exactRead = `/rest/v1/role_outcomes?select=${eventColumns}&id=eq.${event.id}&user_id=eq.${users[0].id}&saved_role_id=eq.${roleId}`;
    assert.deepEqual(await request(exactRead, { token: roleSessions[0], method: 'GET' }), [event]);
    assert.deepEqual(await request(exactRead, { token: roleSessions[1], method: 'GET' }), []);
    const denied = await request('/rest/v1/role_outcomes', { token: roleSessions[1],
      body: { ...event, id: randomUUID() }, expectedStatus: 403 });
    assert.equal(denied.code, '42501');
    const laterEvent = { ...event, id: randomUUID(), stage: 'interview_1', note: 'Synthetic later event', occurred_at: '2026-09-14' };
    assert.deepEqual(await request(`/rest/v1/role_outcomes?select=${eventColumns}`, { token: roleSessions[0],
      body: laterEvent, expectedStatus: 201, representation: true }), [laterEvent]);
    assert.equal((await request('/rest/v1/role_outcomes', { token: roleSessions[0], body: event, expectedStatus: 409 })).code, '23505');
    assert.deepEqual(await request(`/rest/v1/saved_roles?select=id,user_id,latest_stage&id=eq.${roleId}`, {
      token: roleSessions[0], method: 'GET' }), [{ id: roleId, user_id: users[0].id, latest_stage: 'interview_1' }]);
    const storedEvents = await request(`/rest/v1/role_outcomes?select=${eventColumns}&saved_role_id=eq.${roleId}&order=occurred_at.asc`, {
      token: roleSessions[0], method: 'GET' });
    assert.deepEqual(storedEvents, [event, laterEvent]);
    save('role-outcome-retry-acceptance.json', { passed: true, ownerId: users[0].id, otherOwnerId: users[1].id,
      roleId, events: storedEvents, duplicateSqlState: '23505', foreignWriteSqlState: '42501',
      originalEventPreserved: true, laterStagePreserved: true, otherOwnerReadDenied: true,
      scope: 'Real disposable Auth/PostgREST, primary key, RLS and latest-stage trigger. No hosted or role browser proof.' });
    // Hold the exact existing owner lock until two real RPC transactions are
    // independently observed waiting for it. Merely launching Promise.all
    // would also pass if the database happened to process them sequentially.
    const overlapEvidence = [];
    async function overlap(label, commands, expectedStatus = 200) {
      const applicationName = `manual-barrier-${label}`;
      const command = sqlSessionCommand();
      const barrier = start(`manual-${label}-barrier`, command.executable, command.args, env, root, 20000, 'command', true);
      barrier.child.stdin.write(`begin; set local application_name=${literal(applicationName)};\nselect pg_advisory_xact_lock(hashtextextended(${literal(users[0].id)},91000));\n`);
      let pending;
      let waiting;
      async function observe(name, query, accept) {
        const deadline = Date.now() + 5000;
        let attempt = 0;
        while (Date.now() < deadline) {
          assert.equal(barrier.failure, null); assert.equal(barrier.result, null);
          const value = JSON.parse(sql(`manual-${label}-${name}-${attempt++}`, query));
          if (accept(value)) return value;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Manual ${label} did not establish ${name}`);
      }
      try {
        const holder = await observe('holder', `select coalesce(jsonb_agg(a.pid),'[]'::jsonb)
          from pg_stat_activity a where a.application_name=${literal(applicationName)}
          and a.state='idle in transaction' and exists(select 1 from pg_locks l
            where l.pid=a.pid and l.locktype='advisory' and l.granted);`, value => value.length === 1);
        assert.ok(Number.isSafeInteger(holder[0]) && holder[0] > 0);
        pending = Promise.allSettled(commands.map(p_command => request('/rest/v1/rpc/save_own_manual_plan_v1', {
          token: roleSessions[0], body: { p_command }, expectedStatus })));
        waiting = await observe('waiters', `select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,
          'wait_event',a.wait_event,'mode',w.mode) order by a.pid),'[]'::jsonb)
          from pg_locks w join pg_locks h on h.locktype=w.locktype and h.database=w.database
            and h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
          join pg_stat_activity a on a.pid=w.pid
          where h.pid=${holder[0]} and h.granted and not w.granted and w.locktype='advisory'
            and a.state='active' and a.wait_event='advisory'
            and a.query like '%save_own_manual_plan_v1%';`, value => value.length === 2);
        assert.equal(new Set(waiting.map(value => value.pid)).size, 2);
        overlapEvidence.push({ label, holderPid: holder[0], waiters: waiting, observedBeforeRelease: true });
        save('manual-plan-overlap-locks.json', overlapEvidence);
      } finally {
        if (!barrier.child.stdin.destroyed) barrier.child.stdin.end('commit;\n\\q\n');
        await barrier.closed;
        // Consume both outcomes even if proving the overlap failed.
        if (pending) await pending;
      }
      assert.equal(barrier.failure, null); assert.equal(barrier.result.code, 0);
      const results = await pending;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      return results.map(result => result.value);
    }
    const manualCommand = { contract_version: 'manual-plan-save.1', operation_id: randomUUID(),
      plan_id: `concurrency-${project}`, expected: null, title: 'Synthetic concurrency probe',
      items: [{ id: 'blank-1', section: '', text: '', notes: '', due_date: null, done: false }] };
    const creates = await overlap('create', [manualCommand, manualCommand]);
    assert.deepEqual(creates.map(value => value.status).sort(), ['replayed', 'saved']);
    assert.deepEqual(creates[0].snapshot, creates[1].snapshot); assert.deepEqual(creates[0].committed, creates[1].committed);
    const updatedCommands = [0, 1].map(index => ({ ...manualCommand, operation_id: randomUUID(),
      expected: creates[0].committed, title: `Synthetic competing update ${index}` }));
    // Direct PostgREST maps SQLSTATE class 40 to HTTP 500. The exact code
    // and message below distinguish the expected stale-write refusal.
    const updates = await overlap('update', updatedCommands, [200, 500]);
    const winner = updates.find(value => value.status === 'saved'); const refused = updates.find(value => value.code === '40001');
    assert.ok(winner); assert.ok(refused); assert.equal(refused.message, 'MANUAL_PLAN_VERSION_CONFLICT');
    assert.equal(winner.snapshot.revision, 2);
    const manualRead = await request('/rest/v1/rpc/get_own_manual_plan_v1', { token: roleSessions[0],
      body: { p_plan_id: manualCommand.plan_id, p_outcome_id: null } });
    assert.deepEqual(manualRead.plan, winner.snapshot);
    const manualCounts = JSON.parse(sql('manual-concurrent-identity-counts', `select jsonb_build_object(
      'receipts',(select count(*) from private.manual_plan_save_receipts where artifact_id=${literal(winner.snapshot.artifact_id)}::uuid),
      'versions',(select count(*) from public.ted_artifact_versions where artifact_id=${literal(winner.snapshot.artifact_id)}::uuid));`));
    assert.deepEqual(manualCounts, { receipts: 2, versions: 2 });
    save('manual-plan-concurrent-commands.json', { passed: true, ownerId: users[0].id, planId: manualCommand.plan_id,
      creationStatuses: creates.map(value => value.status), competingUpdateStatuses: updates.map(value => value.status ?? value.message),
      finalSnapshot: manualRead.plan, counts: manualCounts, overlapEvidence,
      scope: 'Concurrent real local authenticated PostgREST requests; one creation, exact duplicate replay and one winner for a shared expected revision.' });
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
    denoBoundary = createDenoExecutionBoundary(root, functionEnv);
    for (const entry of ['extract-upload', 'ingest-upload']) {
      await freePort(entry === 'ingest-upload' ? 58325 : 58326);
      const record = start(entry, 'deno', ['run', ...denoBoundary.flags, '--allow-env',
        `--allow-read=${root},${workdir}`, '--allow-net=127.0.0.1:58321,127.0.0.1:58325,127.0.0.1:58326', bootstrap, entry, privatePaths[0]], denoBoundary.env, denoBoundary.cwd);
      await ready(record, origins[entry === 'ingest-upload' ? 'ingest' : 'extract'] + `/functions/v1/${entry}`, entry === 'ingest-upload' ? 405 : 405);
    }
    proxy = createServer(async (req, res) => {
      const lifetime = createUploadProxyLifetime(req, res);
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
        const body = await readUploadProbeBody(Readable.toWeb(req), 9 * 1024 * 1024, lifetime.signal);
        const response = await fetch(target, { method: req.method, headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
          signal: lifetime.signal, redirect: 'error', cache: 'no-store' });
        const bytes = await readUploadProbeBody(response.body, 12 * 1024 * 1024, lifetime.signal);
        lifetime.signal.throwIfAborted();
        proxyChecks.push({ path: new URL(target).pathname, method: req.method, status: response.status });
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (!['connection', 'content-length', 'transfer-encoding', 'content-encoding', 'set-cookie'].includes(name)) res.setHeader(name, value);
        const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(bytes);
      } catch (error) {
        const failure = lifetime.failure(error);
        proxyChecks.push({ path: req.url?.split('?')[0], method: req.method, ...failure });
        if (!failure.cancelled && lifetime.canRespond()) {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end('{"error":"Local acceptance transport failed"}');
        }
      } finally { lifetime.dispose(); }
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
    await command('new-upload-playwright', process.execPath, [resolveAcceptancePlaywright(root), 'test', '--config', 'tests/e2e/upload.playwright.config.ts',
      '--grep-invert', accountPlanTestName],
      { ...env, PROMPTED_UPLOAD_E2E_FIXTURE: privatePaths[1], PLAYWRIGHT_BROWSERS_PATH: join(root, 'node_modules/.cache/playwright') });
    const reports = []; const manualReports = []; const roleReports = [];
    const visit = path => { for (const name of readdirSync(path)) {
      const child = join(path, name); const stat = lstatSync(child); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) visit(child);
      else if (name === 'upload-browser-checks.json') reports.push(JSON.parse(readFileSync(child, 'utf8')));
      else if (name === 'manual-plan-browser-checks.json') manualReports.push(JSON.parse(readFileSync(child, 'utf8')));
      else if (name === 'role-action-browser-checks.json') {
        assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024);
        roleReports.push(JSON.parse(readFileSync(child, 'utf8')));
      }
    } }; visit(outputDir); assert.equal(reports.length, 2);
    assert.equal(manualReports.length, 2);
    assert.deepEqual(manualReports.map(report => report.ownerId).sort(), users.map(user => user.id).sort());
    assert.deepEqual(manualReports.map(report => report.project).sort(), ['desktop-chromium', 'narrow-chromium']);
    const manualProofs = [];
    for (const report of manualReports) {
      assert.equal(report.complete, true); assert.equal(report.failure, null);
      assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
      assert.deepEqual(report.checks, ['all_fields_reopened', 'reload', 'back_forward_direct_link',
        'review_apply_preserves_sibling', 'cancel_uncertain_save_exact_retry_preserves_typing',
        'independent_browser_account_read', 'stale_device_conflict_preserves_recovery',
        'my_work_and_outcome_routes', 'other_owner_unavailable']);
      const slot = users.findIndex(user => user.id === report.ownerId); assert.ok(slot >= 0);
      assert.match(report.planId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
      const recoveryProof = report.recoveryProof;
      assert.match(recoveryProof.originalId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.match(recoveryProof.accountVersionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.notEqual(recoveryProof.originalId, recoveryProof.accountVersionId);
      const recoveryUrl = new URL(recoveryProof.originalUrl);
      assert.equal(recoveryUrl.origin, origins.web); assert.equal(recoveryUrl.pathname, '/plans');
      assert.equal(recoveryUrl.searchParams.get('plan'), report.planId);
      assert.equal(recoveryUrl.searchParams.get('recovery'), recoveryProof.originalId);
      const body = { p_plan_id: report.planId, p_outcome_id: null };
      const own = await request('/rest/v1/rpc/get_own_manual_plan_v1', { token: roleSessions[slot], body });
      const other = await request('/rest/v1/rpc/get_own_manual_plan_v1', { token: roleSessions[1 - slot], body });
      assert.equal(own.contract_version, 'manual-plan-read.1'); assert.equal(own.owner_id, report.ownerId);
      assert.deepEqual(own.plan, report.finalSnapshot); assert.equal(other.plan, null);
      assert.deepEqual(report.interruptedCommand, report.retriedCommand);
      const artifactId = own.plan.artifact_id; assert.match(artifactId, /^[0-9a-f-]{36}$/);
      const graph = JSON.parse(sql('manual-plan-independent-graph-' + slot, `select jsonb_build_object(
        'title',a.title,'kind',a.kind,'pipeline_version',a.pipeline_version,'ledger_binding_status',a.ledger_binding_status,
        'template_id',a.template_id,'ledger_version',a.ledger_version,'revision',a.current_revision,
        'items',(select jsonb_agg(jsonb_build_object('id',b.stable_key,'section',b.heading,'text',b.payload->>'text',
          'notes',b.payload->>'notes','due_date',to_char(b.due_date,'YYYY-MM-DD'),'done',b.completed_at is not null)
          order by b.order_index,b.id) from public.ted_artifact_blocks b where b.artifact_id=a.id),
        'projection_count',(select count(*) from public.checklist_items c where c.outcome_id=a.outcome_id),
        'document_count',(select count(*) from public.documents d where d.outcome_id=a.outcome_id),
        'receipt_count',(select count(*) from private.manual_plan_save_receipts r where r.artifact_id=a.id),
        'history_count',(select count(*) from public.ted_artifact_versions v where v.artifact_id=a.id))
        from public.ted_artifacts a where a.id=${literal(artifactId)}::uuid and a.user_id=${literal(report.ownerId)}::uuid;`));
      assert.equal(graph.title, own.plan.title); assert.deepEqual(graph.items, own.plan.items);
      assert.equal(graph.kind, 'action_plan'); assert.equal(graph.pipeline_version, 'manual-plan.1');
      assert.equal(graph.ledger_binding_status, 'legacy_unversioned'); assert.equal(graph.template_id, null); assert.equal(graph.ledger_version, null);
      assert.equal(graph.revision, own.plan.revision); assert.equal(graph.projection_count, own.plan.items.length);
      assert.equal(graph.document_count, 0); assert.equal(graph.receipt_count, graph.revision); assert.equal(graph.history_count, graph.revision);
      const replay = await request('/rest/v1/rpc/save_own_manual_plan_v1', { token: roleSessions[slot], body: { p_command: report.interruptedCommand } });
      assert.equal(replay.status, 'superseded'); assert.deepEqual(replay.snapshot, own.plan);
      manualProofs.push({ ownerId: report.ownerId, planId: report.planId, snapshot: own.plan, graph,
        otherOwnerAbsent: true, exactRetryIdentity: true, supersededReplayPreservedCurrent: true, recoveryProof });
    }
    save('manual-plan-account-browser-summary.json', { passed: true, reports: manualReports,
      scope: 'Real local account persistence and independent browser session, controlled TED response; no hosted/provider proof.' });
    save('manual-plan-independent-proofs.json', { passed: true, proofs: manualProofs,
      scope: 'Independent authenticated PostgREST and SQL graph/history/projection reads after browser completion; exact superseded retry without newer-content overwrite.' });
    assert.equal(roleReports.length, 2);
    const roleProjects = ['desktop-chromium', 'narrow-chromium'];
    const roleItemFields = ['id', 'label', 'description', 'status', 'sort_order', 'mutation_token'];
    const roleRowFields = [...roleItemFields, 'user_id', 'saved_role_id'];
    const roleScope = 'Real local Auth/PostgREST role actions and CAS with controlled job-match discovery; desktop/narrow reload, stale acknowledgement and owner isolation. No provider or hosted proof.';
    const roleKeys = (value, keys) => {
      assert.ok(value && typeof value === 'object' && !Array.isArray(value));
      assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
    };
    const roleUuid = value => {
      assert.equal(typeof value, 'string');
      assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    };
    const roleItem = value => {
      roleKeys(value, roleItemFields); roleUuid(value.id); roleUuid(value.mutation_token);
      assert.ok(typeof value.label === 'string' && value.label.length <= 256);
      assert.ok(value.description === null || (typeof value.description === 'string' && value.description.length <= 2048));
      assert.ok(['pending', 'done', 'skipped'].includes(value.status));
      assert.ok(Number.isInteger(value.sort_order) && value.sort_order >= 0 && value.sort_order <= 5);
    };
    const roleRows = (value, ownerId, roleId) => {
      assert.ok(Array.isArray(value)); assert.equal(value.length, 6);
      for (const row of value) {
        roleKeys(row, roleRowFields); assert.equal(row.user_id, ownerId); assert.equal(row.saved_role_id, roleId);
        roleItem(Object.fromEntries(roleItemFields.map(key => [key, row[key]])));
      }
      assert.equal(new Set(value.map(row => row.id)).size, 6);
      assert.deepEqual(value.map(row => row.sort_order), [0, 1, 2, 3, 4, 5]);
    };
    const roleProofs = []; const roleIdentities = new Set(); const actionIdentities = new Set();
    for (const report of roleReports) {
      roleKeys(report, ['version', 'project', 'ownerId', 'otherOwnerId', 'title', 'employer', 'complete', 'failure',
        'roleId', 'itemId', 'initialRows', 'refreshedRows', 'finalRows', 'otherRoleId', 'otherRows', 'mutations',
        'jobMatchRequests', 'saveRequests', 'readCount', 'checks', 'errors', 'external', 'scope']);
      const slot = roleProjects.indexOf(report.project); assert.ok(slot >= 0);
      assert.equal(report.version, 'role-action-browser.1'); assert.equal(report.scope, roleScope);
      assert.equal(report.ownerId, users[slot].id); assert.equal(report.otherOwnerId, users[1 - slot].id);
      assert.equal(report.title, `Synthetic action role ${report.project}`);
      assert.equal(report.employer, `${project}-${report.project}`);
      assert.equal(report.complete, true); assert.equal(report.failure, null);
      assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
      assert.deepEqual(report.checks, ['owned_role_and_actions_opened', 'same_owner_second_context_opened',
        'first_commit_acknowledgement_held', 'second_context_newer_commit_observed',
        'newer_read_preserved_after_stale_acknowledgement', 'next_toggle_uses_newer_token',
        'reload_preserves_exact_role_and_actions', 'other_owner_isolated']);
      roleKeys(report.jobMatchRequests, ['primary', 'second']);
      assert.deepEqual(report.jobMatchRequests, { primary: 3, second: 1 }); assert.equal(report.readCount, 6);
      for (const id of [report.roleId, report.itemId, report.otherRoleId]) roleUuid(id);
      assert.notEqual(report.roleId, report.otherRoleId);
      for (const id of [report.roleId, report.otherRoleId]) {
        assert.ok(!roleIdentities.has(id)); roleIdentities.add(id);
      }
      roleRows(report.initialRows, report.ownerId, report.roleId);
      roleRows(report.refreshedRows, report.ownerId, report.roleId);
      roleRows(report.finalRows, report.ownerId, report.roleId);
      roleRows(report.otherRows, report.otherOwnerId, report.otherRoleId);
      assert.ok(report.initialRows.every(row => row.status === 'pending'));
      assert.ok(report.otherRows.every(row => row.status === 'pending'));
      for (const row of [...report.initialRows, ...report.otherRows]) {
        assert.ok(!actionIdentities.has(row.id)); actionIdentities.add(row.id);
      }
      const initial = report.initialRows.find(row => row.id === report.itemId); assert.ok(initial);
      assert.equal(initial.label, 'Review job requirements'); assert.equal(initial.sort_order, 0);
      roleKeys(report.mutations, ['held', 'newer', 'next']);
      let expectedToken = initial.mutation_token; const tokens = [expectedToken];
      for (const [name, status] of [['held', 'done'], ['newer', 'pending'], ['next', 'done']]) {
        const mutation = report.mutations[name]; roleKeys(mutation, ['command', 'receipt']);
        roleKeys(mutation.command, ['p_item_id', 'p_expected_mutation_token', 'p_status']);
        assert.deepEqual(mutation.command, { p_item_id: report.itemId, p_expected_mutation_token: expectedToken, p_status: status });
        roleKeys(mutation.receipt, ['status', 'affected_rows', 'item']);
        assert.equal(mutation.receipt.status, 'committed'); assert.equal(mutation.receipt.affected_rows, 1);
        roleItem(mutation.receipt.item);
        assert.deepEqual(mutation.receipt.item, { id: initial.id, label: initial.label, description: initial.description,
          status, sort_order: initial.sort_order, mutation_token: mutation.receipt.item.mutation_token });
        expectedToken = mutation.receipt.item.mutation_token; tokens.push(expectedToken);
      }
      assert.equal(new Set(tokens).size, 4, 'Each real status mutation must rotate the exact item token');
      const withItem = item => report.initialRows.map(row => row.id === report.itemId ? { ...row, ...item } : row);
      assert.deepEqual(report.refreshedRows, withItem(report.mutations.newer.receipt.item));
      assert.deepEqual(report.finalRows, withItem(report.mutations.next.receipt.item));
      const wording = rows => rows.map(row => ({ label: row.label, description: row.description,
        status: row.status, sort_order: row.sort_order }));
      assert.deepEqual(wording(report.otherRows), wording(report.initialRows));
      assert.ok(Array.isArray(report.saveRequests)); assert.equal(report.saveRequests.length, 4);
      for (const saved of report.saveRequests) roleKeys(saved, ['ownerId', 'roleId']);
      assert.deepEqual(report.saveRequests, [
        { ownerId: report.ownerId, roleId: report.roleId }, { ownerId: report.ownerId, roleId: report.roleId },
        { ownerId: report.ownerId, roleId: report.roleId }, { ownerId: report.otherOwnerId, roleId: report.otherRoleId },
      ]);
      const ownPath = `/rest/v1/role_action_items?select=${roleRowFields.join(',')}&saved_role_id=eq.${report.roleId}&order=sort_order.asc`;
      const isolatedPath = `/rest/v1/role_action_items?select=${roleRowFields.join(',')}&saved_role_id=eq.${report.otherRoleId}&order=sort_order.asc`;
      const ownRows = await request(ownPath, { method: 'GET', token: roleSessions[slot] });
      assert.deepEqual(ownRows, report.finalRows);
      assert.deepEqual(await request(ownPath, { method: 'GET', token: roleSessions[1 - slot] }), []);
      assert.deepEqual(await request(isolatedPath, { method: 'GET', token: roleSessions[1 - slot] }), report.otherRows);
      assert.deepEqual(await request(isolatedPath, { method: 'GET', token: roleSessions[slot] }), []);
      // The RPC raises P0002; PostgREST maps P0* to HTTP 500.
      // The exact error body and unchanged owned rows are still required below.
      const denied = await request('/rest/v1/rpc/update_own_role_action_item', { token: roleSessions[1 - slot], expectedStatus: 500,
        body: { p_item_id: report.itemId, p_expected_mutation_token: expectedToken, p_status: 'pending' } });
      roleKeys(denied, ['code', 'details', 'hint', 'message']);
      assert.equal(denied.code, 'P0002'); assert.equal(denied.message, 'ROLE_ACTION_ITEM_UNAVAILABLE');
      assert.deepEqual(await request(ownPath, { method: 'GET', token: roleSessions[slot] }), ownRows,
        'A foreign-owner command must leave every status and mutation token unchanged');
      const graphs = [];
      for (const [label, ownerId, roleId, expectedRows] of [
        ['own', report.ownerId, report.roleId, report.finalRows],
        ['isolated', report.otherOwnerId, report.otherRoleId, report.otherRows],
      ]) {
        const graph = JSON.parse(sql(`role-action-independent-${slot}-${label}`, `select jsonb_build_object(
          'role',(select jsonb_build_object('id',r.id,'user_id',r.user_id,'role_title',r.role_title,'company_name',r.company_name)
            from public.saved_roles r where r.id=${literal(roleId)}::uuid),
          'identity_count',(select count(*) from public.saved_roles r where r.user_id=${literal(ownerId)}::uuid
            and r.role_title=${literal(report.title)} and r.company_name=${literal(report.employer)}),
          'items',(select jsonb_agg(jsonb_build_object('id',i.id,'user_id',i.user_id,'saved_role_id',i.saved_role_id,
            'label',i.label,'description',i.description,'status',i.status,'sort_order',i.sort_order,'mutation_token',i.mutation_token)
            order by i.sort_order,i.id) from public.role_action_items i where i.saved_role_id=${literal(roleId)}::uuid),
          'action_keys',(select jsonb_agg(i.action_key order by i.sort_order,i.id) from public.role_action_items i
            where i.saved_role_id=${literal(roleId)}::uuid));`));
        assert.deepEqual(graph.role, { id: roleId, user_id: ownerId, role_title: report.title, company_name: report.employer });
        assert.equal(graph.identity_count, 1); assert.deepEqual(graph.items, expectedRows);
        assert.deepEqual(graph.action_keys, ['default:0', 'default:1', 'default:2', 'default:3', 'default:4', 'default:5']);
        graphs.push(graph);
      }
      roleProofs.push({ project: report.project, ownerId: report.ownerId, otherOwnerId: report.otherOwnerId,
        roleId: report.roleId, itemId: report.itemId, finalRows: ownRows, graphs, mutationTokens: tokens,
        siblingRowsUnchanged: true, singleRoleIdentity: true, otherOwnerReadDenied: true,
        foreignMutationSqlState: denied.code, foreignMutationChangedNoRows: true });
    }
    assert.deepEqual(roleReports.map(report => report.project).sort(), roleProjects);
    assert.equal(roleIdentities.size, 4); assert.equal(actionIdentities.size, 24);
    assert.ok(!proxyChecks.some(row => row.path === '/functions/v1/job-match'), 'Controlled discovery must never dispatch job-match');
    save('role-action-browser-summary.json', { passed: true, reports: roleReports, scope: roleScope });
    save('role-action-independent-proofs.json', { passed: true, proofs: roleProofs,
      scope: 'Independent authenticated PostgREST and SQL after real browser CAS/reload; exact final and sibling state, unique saved roles, and foreign-owner read/mutation denial. No provider or hosted proof.' });
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
          'source_completion_valid',private.completed_upload_source_preparation_is_valid(u),
          'usage',coalesce((select jsonb_agg(to_jsonb(l)) from public.usage_ledger l where l.user_id=u.user_id and l.logical_request_id=u.id::text),'[]'::jsonb),
          'attempt_count',(select count(*) from private.legacy_model_attempt_admissions a where a.user_id=u.user_id and a.logical_request_id=u.id::text),
          'result_count',(select count(*) from private.legacy_model_call_results r where r.user_id=u.user_id and r.logical_request_id=u.id::text))
          from public.uploads u where u.id=${literal(record.uploadId)}::uuid and u.user_id=${literal(user.id)}::uuid;`;
        const proof = JSON.parse(sql('new-upload-independent-proof-' + proofs.length, query)); const u = proof.upload;
        for (const key of ['receipt_matches', 'text_matches', 'text_digest_valid', 'source_digest_valid', 'source_completion_valid']) assert.equal(proof[key], true, key);
        assert.equal(u.ingest_status, 'completed'); assert.equal(u.ingest_stage, 'terminal'); assert.equal(u.ingest_http_status, 200);
        assert.ok(u.completed_at); assert.equal(u.error_code, null); assert.equal(u.status, file.importText ? 'committed' : 'ready');
        assert.equal(u.ingest_extraction_contract_version, 'upload-extraction.3'); assert.equal(u.ingest_extraction_policy_version, 'upload-resource-policy.2');
        assert.equal(u.ingest_extraction_format, file.format); assert.equal(u.ingest_extraction_truncated, false);
        assert.equal(u.ingest_content_sha256, file.sha256); assert.equal(u.file_size_bytes, file.byteLength);
        assert.equal(u.file_name, record.name); assert.equal(u.outcome_id, record.outcomeId);
        if (!file.importText) assert.equal(u.document_id, null);
        assert.equal(proof.attempt_count, 0); assert.equal(proof.result_count, 0); assert.deepEqual(proof.usage, []);
        const actual = await request('/storage/v1/object/original-documents/' + u.storage_path.split('/').map(encodeURIComponent).join('/'),
          { method: 'GET', token: session.access_token, binary: true });
        assert.ok(actual.equals(readFileSync(file.path))); assert.equal(sha(actual), file.sha256);
        if (file.importText) {
          const document = JSON.parse(sql('new-upload-document-proof-' + proofs.length, `select jsonb_build_object(
            'title',d.title,'status',d.status,'revision',d.current_revision,'approved_revision',d.approved_revision,'owner',d.user_id,'outcome',d.outcome_id,'outcome_status',o.status,
            'outcome_owner',o.user_id,'sections',(select jsonb_agg(jsonb_build_object('name',s.name,'content',s.content,
              'order',s.order_index,'status',s.status,'owner',s.user_id,'id',s.id,'revision',s.revision,
              'approved_revision',s.approved_revision) order by s.order_index) from public.sections s where s.document_id=d.id))
            from public.documents d join public.outcomes o on o.id=d.outcome_id where d.id=${literal(u.document_id)}::uuid;`));
          assert.equal(document.title, record.name.replace(/\.[^.]+$/, '')); assert.equal(document.status, 'draft');
          assert.equal(document.owner, user.id); assert.equal(document.outcome_owner, user.id);
          assert.equal(document.outcome, record.outcomeId); assert.equal(document.outcome_status, 'in_progress');
          assert.deepEqual(document.sections.map(section => section.order), [0, 1]);
          assert.deepEqual(document.sections.map(({ name, content, status, owner }) => ({ name, content, status, owner })), [
            { name: 'Overview', content: '<p>Updated This is synthetic wording for the upload acceptance test.</p><p>The owner checks this paragraph before saving.</p>', status: 'edited', owner: user.id },
            { name: 'Next steps', content: '- Keep the original.\n\n- Reopen the saved document.', status: 'draft', owner: user.id },
          ]);
          for (const stage of ['retained_text_review_resumed_after_reload', 'first_visit_tour_dismissed', 'edited_section_committed_ack_discarded',
            'edit_delivery_failed_before_commit', 'browser_copy_review_visible_in_foreground_after_reload',
            'same_edit_request_restored_after_reload', 'restored_wording_saved_with_acknowledgement_uncertainty',
            'save_uncertainty_visible', 'complete_browser_recovery_copy_read_during_uncertainty', 'same_edit_receipt_recovered', 'edited_paragraphs_reloaded_sibling_unchanged']) {
            assert.ok(record.stages.includes(stage), `Missing text edit stage: ${stage}`);
          }
          if (report.project === 'narrow-chromium') for (const stage of ['focused_editor_opened', 'focused_editor_closed']) {
            assert.ok(record.stages.includes(stage), `Missing mobile editor stage: ${stage}`);
          }
          const receipt = record.editReceipt; assert.ok(receipt); assert.equal(receipt.idempotent_replay, false);
          assert.ok(record.failedSaveRequest); assert.deepEqual(record.recoveredSaveRequest, record.failedSaveRequest);
          assert.equal(record.failedSaveRequest.p_document_id, u.document_id);
          assert.equal(record.failedSaveRequest.p_idempotency_key, receipt.idempotency_key);
          assert.equal(record.failedSaveRequest.p_expected_document_revision, receipt.accepted_document_revision);
          const recovery = record.recoveryCopy; assert.ok(recovery);
          assert.equal(recovery.version, 3); assert.equal(recovery.owner, `user:${user.id}`);
          assert.equal(recovery.outcomeId, u.outcome_id); assert.equal(recovery.value.documentId, u.document_id);
          assert.deepEqual(recovery.value.sections.map(section => ({ id: section.id, content: section.content, owner: section.user_id, loaded: section.content_loaded })),
            document.sections.map(section => ({ id: section.id, content: section.content, owner: section.owner, loaded: true })),
            'Browser recovery copy must contain the same exact owned wording as the independently read saved sections');
          assert.equal(receipt.document_id, u.document_id); assert.equal(receipt.outcome_id, u.outcome_id);
          assert.equal(document.revision, receipt.document_revision); assert.equal(document.approved_revision, null);
          assert.equal(receipt.document_revision, receipt.accepted_document_revision + 1);
          for (const [index, section] of document.sections.entries()) {
            const saved = receipt.sections[index]; assert.equal(saved.section_id, section.id);
            assert.equal(saved.revision, section.revision); assert.equal(saved.status, section.status);
            assert.equal(saved.content_sha256, sha(section.content)); assert.equal(section.approved_revision, null);
          }
          const receipts = JSON.parse(sql('new-upload-edit-receipt-proof-' + proofs.length,
            `select coalesce(jsonb_agg(r.result),'[]'::jsonb) from private.legacy_workspace_save_receipts r
              where r.user_id=${literal(user.id)}::uuid and r.document_id=${literal(u.document_id)}::uuid;`));
          assert.deepEqual(receipts, [receipt], 'One immutable save receipt must survive the lost acknowledgement and replay');
        }
        proofs.push({ uploadId: u.id, ownerId: u.user_id, name: u.file_name, byteLength: actual.length, sha256: sha(actual),
          status: u.status, outcomeId: u.outcome_id, documentId: u.document_id, classificationStatus: 'not_requested' });
      }
    }
    for (const user of users) {
      const manualOutcomeIds = manualProofs.filter(proof => proof.ownerId === user.id).map(proof => proof.snapshot.outcome_id);
      if (user.id === users[0].id) manualOutcomeIds.push(manualRead.plan.outcome_id);
      manualOutcomeIds.sort();
      const documentOutcomeIds = [...new Set(reports.filter(report => report.ownerId === user.id)
        .flatMap(report => report.records.map(record => record.outcomeId).filter(Boolean)))].sort();
      assert.equal(documentOutcomeIds.length, 1);
      assert.equal(new Set([...manualOutcomeIds, ...documentOutcomeIds]).size, manualOutcomeIds.length + documentOutcomeIds.length);
      const totals = JSON.parse(sql('new-upload-owner-totals-' + user.id, `select jsonb_build_object(
        'usage',(select count(*) from public.usage_ledger where user_id=${literal(user.id)}::uuid),
        'attempts',(select count(*) from private.legacy_model_attempt_admissions where user_id=${literal(user.id)}::uuid),
        'results',(select count(*) from private.legacy_model_call_results where user_id=${literal(user.id)}::uuid),
        'leases',(select count(*) from private.openai_capacity_leases where user_id=${literal(user.id)}::uuid),
        'egress',(select count(*) from private.user_external_egress_dispatches where user_key=private.account_deletion_user_key(${literal(user.id)}::uuid)),
        'documents',(select count(*) from public.documents where user_id=${literal(user.id)}::uuid),
        'outcomes',(select count(*) from public.outcomes where user_id=${literal(user.id)}::uuid),
        'manual_outcome_ids',(select jsonb_agg(a.outcome_id order by a.outcome_id) from public.ted_artifacts a
          where a.user_id=${literal(user.id)}::uuid and a.pipeline_version='manual-plan.1'),
        'document_outcome_ids',(select jsonb_agg(d.outcome_id order by d.outcome_id) from public.documents d
          where d.user_id=${literal(user.id)}::uuid));`));
      assert.deepEqual(totals, { usage: 0, attempts: 0, results: 0, leases: 0, egress: 0, documents: 1,
        outcomes: 1 + manualOutcomeIds.length, manual_outcome_ids: manualOutcomeIds, document_outcome_ids: documentOutcomeIds });
    }
    const dispatches = children.find(child => child.label === 'ingest-upload').output.split('\n').filter(line => line.startsWith('{"event":"synthetic-responses"')).map(line => JSON.parse(line));
    assert.deepEqual(dispatches, [], 'Source preparation must not dispatch provider work');
    assert.ok(proxyChecks.every(row => !row.failed), 'Unexpected local proxy failure');
    save('new-upload-independent-proofs.json', { passed: true, proofs, dispatches });
    save('profile-browser-independent-proofs.json', { passed: true, proofs: profileProofs,
      scope: 'Real local Profile access/details save/reload/new tab and initial-read recovery. Empty resume slots; no browser resume replacement/restore/download proof.' });

    // The six existing cases and all their independent proofs finish before any
    // billing fixture is installed. These are schema-valid historical rows,
    // not simulated RevenueCat deliveries or proof of a completed purchase.
    const originalBrowserReports = new Map();
    const originalReportNames = ['playwright-results.json', 'upload-browser-checks.json',
      'manual-plan-browser-checks.json', 'role-action-browser-checks.json'];
    const retainOriginalReports = directory => { for (const name of readdirSync(directory)) {
      const path = join(directory, name); const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) retainOriginalReports(path);
      else if (originalReportNames.includes(name)) {
        assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 8 * 1024 * 1024);
        originalBrowserReports.set(path, sha(readFileSync(path)));
      }
    } }; retainOriginalReports(outputDir); assert.equal(originalBrowserReports.size, 7);
    const ownerLiterals = users.map(user => literal(user.id) + '::uuid').join(',');
    const accountState = label => JSON.parse(sql(label, `select jsonb_build_object(
      'subscriptions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.user_id),'[]'::jsonb)
        from public.subscriptions s where s.user_id in (${ownerLiterals})),
      'usage',(select count(*) from public.usage_ledger where user_id in (${ownerLiterals})),
      'attempts',(select count(*) from private.legacy_model_attempt_admissions where user_id in (${ownerLiterals})),
      'results',(select count(*) from private.legacy_model_call_results where user_id in (${ownerLiterals})),
      'leases',(select count(*) from private.openai_capacity_leases where user_id in (${ownerLiterals})),
      'egress',(select count(*) from private.user_external_egress_dispatches where user_key in
        (${users.map(user => `private.account_deletion_user_key(${literal(user.id)}::uuid)`).join(',')})),
      'billing_receipts',(select count(*) from public.revenuecat_webhook_events
        where subject_user_id in (${ownerLiterals}) or related_user_ids && array[${ownerLiterals}]),
      'documents',(select count(*) from public.documents where user_id in (${ownerLiterals})),
      'outcomes',(select count(*) from public.outcomes where user_id in (${ownerLiterals})),
      'uploads',(select count(*) from public.uploads where user_id in (${ownerLiterals})));`));
    const accountBefore = accountState('account-plan-before-historical-fixtures');
    assert.deepEqual(accountBefore.subscriptions, []);
    for (const key of ['usage', 'attempts', 'results', 'leases', 'egress', 'billing_receipts']) assert.equal(accountBefore[key], 0, key);
    const accountStatuses = ['expired', 'cancelled'];
    const accountPeriodEnds = ['2020-01-15T12:00:00+00:00', '2020-02-15T12:00:00+00:00'];
    const accountExpectedAccess = users.map((user, slot) => ({ contract_version: 'product-access.1', user_id: user.id,
      subscription_plan: 'business', effective_plan: 'free', subscription_status: accountStatuses[slot],
      current_period_end: accountPeriodEnds[slot], access_profile: 'subscription', monthly_document_cap: 3,
      ai_editing: false, business_features: false }));
    const accountSeededRows = [];
    for (const [slot, user] of users.entries()) {
      const seed = { id: randomUUID(), user_id: user.id, business_id: null, plan: 'business', status: accountStatuses[slot],
        revenuecat_customer_id: null, entitlements: {}, period_start: null, period_end: accountPeriodEnds[slot],
        revenuecat_event_timestamp_ms: null, revenuecat_event_id: null, will_renew: false, billing_issue: false,
        pending_product_id: null };
      // Direct subscription writes are intentionally unavailable to service_role.
      // Historical fixtures use only the attested disposable SQL setup authority;
      // application billing still goes through the canonical atomic webhook RPC.
      const rows = JSON.parse(sql(`account-plan-historical-fixture-${slot}`, `with inserted as (
        insert into public.subscriptions (id,user_id,business_id,plan,status,revenuecat_customer_id,entitlements,
          period_start,period_end,revenuecat_event_timestamp_ms,revenuecat_event_id,will_renew,billing_issue,pending_product_id)
        select id,user_id,business_id,plan,status,revenuecat_customer_id,entitlements,
          period_start,period_end,revenuecat_event_timestamp_ms,revenuecat_event_id,will_renew,billing_issue,pending_product_id
        from jsonb_populate_record(null::public.subscriptions,${literal(JSON.stringify(seed))}::jsonb)
        returning *) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) from inserted;`));
      assert.ok(Array.isArray(rows)); assert.equal(rows.length, 1);
      const row = rows[0]; assert.ok(row && typeof row === 'object' && !Array.isArray(row));
      assert.equal(typeof row.updated_at, 'string'); assert.ok(Number.isFinite(Date.parse(row.updated_at)));
      assert.deepEqual(row, { ...seed, updated_at: row.updated_at }); accountSeededRows.push(row);
      const session = await request('/auth/v1/token?grant_type=password', { token: config.ANON_KEY,
        body: { email: user.email, password: user.password } });
      assert.equal(session.user.id, user.id); assert.equal(session.user.is_anonymous, false);
      assert.deepEqual(await request(`/rest/v1/subscriptions?select=*&user_id=eq.${user.id}`, {
        token: session.access_token, method: 'GET' }), [row]);
      assert.deepEqual(await request('/rest/v1/rpc/get_effective_product_access_v1', {
        token: session.access_token, body: {} }), accountExpectedAccess[slot]);
    }
    const accountSeededState = accountState('account-plan-seeded-state');
    assert.deepEqual(accountSeededState.subscriptions,
      [...accountSeededRows].sort((left, right) => left.user_id < right.user_id ? -1 : 1));
    assert.deepEqual({ ...accountSeededState, subscriptions: [] }, accountBefore);
    save('account-plan-historical-fixtures.json', { owners: users.map(user => user.id), rows: accountSeededRows,
      expectedAccess: accountExpectedAccess, priorProofsCompleted: true,
      scope: 'Synthetic historical Business subscription rows installed only after six original workflows and independent proofs; no RevenueCat event or purchase fixture.' });
    const accountOutput = join(outputDir, 'account-plan-phase');
    const accountProxyStart = proxyChecks.length;
    await command('account-plan-playwright', process.execPath, [resolveAcceptancePlaywright(root), 'test',
      '--config', 'tests/e2e/upload.playwright.config.ts', '--grep', accountPlanTestName,
      '--output', accountOutput, '--reporter', 'line'],
      { ...env, PROMPTED_UPLOAD_E2E_FIXTURE: privatePaths[1], PLAYWRIGHT_BROWSERS_PATH: join(root, 'node_modules/.cache/playwright') });
    for (const [path, digest] of originalBrowserReports) assert.equal(sha(readFileSync(path)), digest, 'Earlier browser evidence changed');
    const accountReports = [];
    const visitAccounts = directory => { for (const name of readdirSync(directory)) {
      const path = join(directory, name); const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) visitAccounts(path);
      else if (name === 'account-plan-browser-checks.json') {
        assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024);
        accountReports.push(JSON.parse(readFileSync(path, 'utf8')));
      }
    } }; visitAccounts(accountOutput);
    assert.equal(accountReports.length, 2);
    assert.deepEqual(accountReports.map(report => report.project).sort(), ['desktop-chromium', 'narrow-chromium']);
    const accountScope = 'Real local Auth, effective-access RPC, usage read and Account UI with historical subscription fixtures; comparison, reload and real owner navigation. No purchase, webhook delivery, same-render principal race or hosted proof.';
    const accountKeys = (value, keys) => {
      assert.ok(value && typeof value === 'object' && !Array.isArray(value));
      assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
    };
    for (const report of accountReports) {
      accountKeys(report, ['version', 'project', 'ownerId', 'otherOwnerId', 'complete', 'failure', 'observations',
        'checks', 'errors', 'external', 'forbiddenDispatches', 'scope']);
      const slot = report.project === 'desktop-chromium' ? 0 : 1;
      assert.equal(report.version, 'account-plan-browser.1'); assert.equal(report.scope, accountScope);
      assert.equal(report.ownerId, users[slot].id); assert.equal(report.otherOwnerId, users[1 - slot].id);
      assert.equal(report.complete, true); assert.equal(report.failure, null);
      for (const key of ['errors', 'external', 'forbiddenDispatches']) assert.deepEqual(report[key], []);
      assert.deepEqual(report.checks, ['real_owned_access_and_usage_observed', 'historical_business_compares_all_paid_plans',
        'reload_preserves_effective_free_and_billing_history', 'selection_reports_unavailable_without_upgrade',
        'selection_reload_preserves_saved_access', 'real_owner_switch_retires_modal_and_uses_other_access',
        'returning_owner_reads_own_saved_access', 'no_billing_mutation_or_provider_dispatch']);
      assert.ok(Array.isArray(report.observations)); assert.equal(report.observations.length, 5);
      const stages = ['initial', 'reload', 'after_selection_reload', 'other_owner', 'original_owner_return'];
      for (const [index, observation] of report.observations.entries()) {
        accountKeys(observation, ['stage', 'ownerId', 'access', 'usage']);
        const observedSlot = index === 3 ? 1 - slot : slot;
        assert.equal(observation.stage, stages[index]); assert.equal(observation.ownerId, users[observedSlot].id);
        assert.deepEqual(observation.access, accountExpectedAccess[observedSlot]);
        const usage = observation.usage;
        accountKeys(usage, ['method', 'status', 'ownerId', 'eventType', 'monthStart', 'contentRange']);
        assert.equal(usage.method, 'HEAD'); assert.equal(usage.status, 200); assert.equal(usage.ownerId, observation.ownerId);
        assert.equal(usage.eventType, 'document_created'); assert.equal(usage.contentRange, '*/0');
        assert.equal(typeof usage.monthStart, 'string'); assert.match(usage.monthStart, /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
        assert.equal(new Date(usage.monthStart).toISOString(), usage.monthStart);
      }
    }
    const accountProxy = proxyChecks.slice(accountProxyStart);
    for (const row of accountProxy) {
      assert.equal(row.failed, undefined, 'Unexpected local proxy failure');
      assert.ok(!row.path.startsWith('/functions/v1/'), 'Account comparison dispatched a function');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(row.method) && !row.path.startsWith('/auth/v1/')) {
        assert.equal(row.method, 'POST');
        assert.ok(['/rest/v1/rpc/get_effective_product_access_v1', '/rest/v1/rpc/list_own_workspace_uploads_v1'].includes(row.path),
          'Account comparison dispatched a data mutation');
      }
    }
    assert.equal(accountProxy.filter(row => row.path === '/rest/v1/rpc/get_effective_product_access_v1' && row.status === 200).length, 10);
    const accountProofs = [];
    for (const [slot, user] of users.entries()) {
      const session = await request('/auth/v1/token?grant_type=password', { token: config.ANON_KEY,
        body: { email: user.email, password: user.password } });
      assert.equal(session.user.id, user.id); assert.equal(session.user.is_anonymous, false);
      const own = await request('/rest/v1/rpc/get_effective_product_access_v1', { token: session.access_token, body: {} });
      assert.deepEqual(own, accountExpectedAccess[slot]);
      const rows = await request(`/rest/v1/subscriptions?select=*&user_id=eq.${user.id}`, { token: session.access_token, method: 'GET' });
      assert.deepEqual(rows, [accountSeededRows[slot]]);
      assert.deepEqual(await request(`/rest/v1/subscriptions?select=*&user_id=eq.${users[1 - slot].id}`, {
        token: session.access_token, method: 'GET' }), []);
      const denied = await request('/rest/v1/rpc/get_effective_product_access_v1', { token: session.access_token,
        body: { p_user_id: users[1 - slot].id }, expectedStatus: 403 });
      accountKeys(denied, ['code', 'details', 'hint', 'message']);
      assert.equal(denied.code, '42501'); assert.equal(denied.message, 'PRODUCT_ACCESS_FORBIDDEN');
      accountProofs.push({ ownerId: user.id, access: own, subscription: rows[0],
        foreignSubscriptionAbsent: true, foreignAccessSqlState: denied.code, seededRowUnchanged: true });
    }
    const accountAfter = accountState('account-plan-independent-state-after-browser');
    assert.deepEqual(accountAfter, accountSeededState, 'Account comparison changed stored subscription or workflow state');
    const finalDispatches = children.find(child => child.label === 'ingest-upload').output.split('\n')
      .filter(line => line.startsWith('{"event":"synthetic-responses"')).map(line => JSON.parse(line));
    assert.deepEqual(finalDispatches, [], 'Account comparison must not dispatch provider work');
    assert.ok(proxyChecks.every(row => !row.failed), 'Unexpected local proxy failure');
    save('account-plan-browser-summary.json', { passed: true, reports: accountReports, proxyChecks: accountProxy, scope: accountScope });
    save('account-plan-independent-proofs.json', { passed: true, proofs: accountProofs, seededState: accountSeededState,
      finalState: accountAfter, earlierBrowserReports: [...originalBrowserReports].map(([path, sha256]) => ({ path, sha256 })),
      scope: 'Independent authenticated effective-access and full subscription reads plus SQL after actual Account UI; exact seeded rows and prior workflow counts unchanged, foreign-owner reads denied. No purchase or webhook delivery proof.' });
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
    await clean('Deno boundary', () => denoBoundary?.close());
    await clean('front door', async () => {
      if (proxy?.listening) { proxy.closeAllConnections(); await new Promise((resolve, reject) => proxy.close(error => error ? reject(error) : resolve())); }
    });
    for (const path of privatePaths) await clean('private fixture removal', () => rmSync(path, { force: true }));
    const sanitize = directory => { for (const name of readdirSync(directory)) {
      const path = join(directory, name); const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) sanitize(path);
      else if (['playwright-results.json', 'error-context.md', 'upload-browser-checks.json', 'manual-plan-browser-checks.json',
        'role-action-browser-checks.json', 'account-plan-browser-checks.json'].includes(name)) writeFileSync(path, redact(readFileSync(path, 'utf8')));
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
