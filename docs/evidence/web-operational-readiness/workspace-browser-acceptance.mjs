// Nested finite browser exercise. Called only while the parent-owned disposable
// Supabase stack is attested. Owns exactly one Next child; never reuses a server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { resolveAcceptancePlaywright } from './acceptance-runtime.mjs';

const webOrigin = 'http://127.0.0.1:58323';
export async function exerciseWorkspaceBrowser({ root, project, workdir, env, evidence, checkTarget, save, anonKey, users, rows }) {
  checkTarget();
  assert.equal(root, '/Users/kaichurchw/PrompTED.AI');
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  const browserEnv = { ...env, NEXT_PUBLIC_APP_ENV: 'local',
    NEXT_PUBLIC_API_BASE_URL: '/api',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:58321', NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SENTRY_DSN: '', NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_REVENUECAT_WEB_KEY: '',
    NEXT_TELEMETRY_DISABLED: '1' };
  const redact = value => users.reduce((text, user) => text.replaceAll(user.password, '[synthetic password redacted]'), String(value)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[local JWT redacted]')
    .replaceAll(anonKey, '[local anon key redacted]'));
  function killGroup(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  async function command(label, executable, args, childEnv = browserEnv, timeout = 600_000) {
    checkTarget();
    const child = spawn(executable, args, { cwd: root, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let failed; let forced;
    const stop = reason => {
      if (failed) return; failed = reason; killGroup(child, 'SIGTERM');
      forced = setTimeout(() => killGroup(child, 'SIGKILL'), 5000);
    };
    child.on('error', error => stop(error.code ?? 'spawn failed'));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      if (output.length + chunk.length > 32 * 1024 * 1024) { stop('output bound exceeded'); return; }
      output += chunk.toString();
    });
    const timer = setTimeout(() => stop('deadline exceeded'), timeout);
    const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    clearTimeout(timer); clearTimeout(forced);
    // This child is its own new process-group leader. Fence any surviving
    // pnpm/Next/Playwright/Chromium descendants even if the leader has exited.
    killGroup(child, 'SIGKILL');
    save(`${label}.log`, redact(output));
    assert.equal(failed, undefined, `${label}: ${failed}`);
    assert.equal(result.code, 0, `${label} failed (${result.signal ?? result.code})`);
  }
  const freePort = () => new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen({ port: 58323, host: '0.0.0.0', exclusive: true }, () => server.close(resolve));
  });
  await freePort();
  await command('workspace-browser-local-build', 'pnpm', ['--filter', '@prompted/web', 'build']);
  const buildId = readFileSync(join(root, 'apps/web/.next/BUILD_ID'), 'utf8').trim();
  assert.match(buildId, /^[A-Za-z0-9_-]+$/);
  checkTarget(); await freePort();
  const outputDir = join(evidence, 'browser'); mkdirSync(outputDir);
  const fixturePath = join(workdir, 'workspace-browser-fixture.json');
  const originalDir = join(workdir, 'browser-originals'); mkdirSync(originalDir);
  const fixture = { version: 'workspace-browser.1', project, webOrigin,
    supabaseOrigin: 'http://127.0.0.1:58321', outputDir, users,
    rows: rows.map(({ bytes, ...row }) => {
      const originalPath = join(originalDir, row.id); writeFileSync(originalPath, bytes, { mode: 0o600 });
      return { ...row, originalPath, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }) };
  writeFileSync(fixturePath, `${JSON.stringify(fixture)}\n`, { mode: 0o600, flag: 'wx' });
  const server = spawn(process.execPath, [join(root, 'apps/web/node_modules/next/dist/bin/next'),
    'start', '--hostname', '127.0.0.1', '--port', '58323'], {
    cwd: join(root, 'apps/web'), env: browserEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverError; let serverLog = ''; let overflow = false;
  server.on('error', error => { serverError = error; });
  const closed = new Promise(resolve => server.once('close', (code, signal) => resolve({ code, signal })));
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => {
    if (serverLog.length + chunk.length > 1024 * 1024) { overflow = true; killGroup(server, 'SIGTERM'); return; }
    serverLog += chunk.toString();
  });
  let passed = false;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      assert.equal(serverError, undefined); assert.equal(server.exitCode, null); assert.equal(server.signalCode, null);
      try {
        const response = await fetch(`${webOrigin}/_next/static/${buildId}/_buildManifest.js`, {
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(1000),
        });
        const body = await response.text();
        if (response.status === 200 && body.includes('__BUILD_MANIFEST')) { ready = true; break; }
      } catch (error) {
        // Only bounded startup connection/timeout failures can wait. Build and
        // child-exit failures remain explicit; no existing service is reused.
        if (!(error instanceof TypeError) && error?.name !== 'TimeoutError') throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Owned Next server did not become ready');
    assert.equal(serverError, undefined); assert.equal(server.exitCode, null); assert.equal(server.signalCode, null);
    await command('workspace-browser-tests', process.execPath, [resolveAcceptancePlaywright(root), 'test', '--config', 'playwright.config.ts'], {
      ...env, PROMPTED_E2E_FIXTURE: fixturePath, PLAYWRIGHT_BROWSERS_PATH: join(root, 'node_modules/.cache/playwright'),
    });
    assert.ok(!overflow); assert.equal(serverError, undefined); assert.equal(server.exitCode, null);
    checkTarget(); passed = true;
  } finally {
    killGroup(server, 'SIGTERM');
    const timer = setTimeout(() => killGroup(server, 'SIGKILL'), 10000);
    const stopped = await closed; clearTimeout(timer);
    killGroup(server, 'SIGKILL');
    save('workspace-browser-server.log', redact(serverLog));
    rmSync(fixturePath);
    // No traces or network recordings are enabled. Sanitize Playwright's own
    // text diagnostics too, including an input-fill failure before sign-in.
    const sanitizeDiagnostics = directory => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name); const stat = lstatSync(path);
        assert.ok(!stat.isSymbolicLink(), 'Unexpected symlink in browser evidence');
        if (stat.isDirectory()) sanitizeDiagnostics(path);
        else if (['playwright-results.json', 'browser-checks.json', '.last-run.json', 'error-context.md'].includes(name))
          writeFileSync(path, redact(readFileSync(path, 'utf8')));
      }
    };
    // Playwright may have cleared this exact child before a discovery failure
    // or timeout. Its absence is no diagnostic output, not a cleanup failure.
    const diagnostics = lstatSync(outputDir, { throwIfNoEntry: false });
    if (diagnostics) {
      assert.ok(diagnostics.isDirectory(), 'Unexpected browser diagnostic path');
      sanitizeDiagnostics(outputDir);
    }
    assert.ok(stopped.code === 0 || stopped.signal === 'SIGTERM', 'Owned Next server required forced termination or failed');
    save('workspace-browser-runtime.json', { passed, project, webOrigin, buildId, stopped, logOverflow: overflow,
      browser: 'Chromium', viewports: ['1440x1000', '390x844'], fixtureCredentialsRemoved: true,
      scope: 'Retained original browse/reopen/download/account change; no upload/extraction/edit/export or hosted execution.' });
  }
}
