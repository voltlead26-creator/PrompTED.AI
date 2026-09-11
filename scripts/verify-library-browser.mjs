import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
assert.equal(process.cwd(), root);
assert.equal(process.version, 'v22.23.2');
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'node_modules/.cache/playwright');
const { chromium, firefox, webkit, expect } = await import('@playwright/test');
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const viteRequire = createRequire(webRequire.resolve('vitest/package.json'));
const { build } = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const evidence = join(root, process.env.CI ? 'docs/evidence/frontend-library-20260911/browser' : '.local/verification/frontend-library-20260911/browser');
mkdirSync(evidence, { recursive: true });
const paths = ['apps/web/src/components/atoms/Icon.tsx', 'apps/web/src/hooks/useLibrary.ts', 'apps/web/src/components/organisms/LibraryList.tsx',
  'apps/web/src/components/organisms/LibraryList.module.css', 'apps/web/src/lib/api/outcomes.ts'];
const hashes = () => Object.fromEntries(paths.map(p => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
const inputs = hashes();
const reports = [], skipped = [], requests = [];
const owner = '33333333-3333-4333-8333-333333333333';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
let rows, failRead = false, failSave = false, delayRead = false, browser, server, passed = false;
const reset = () => {
  rows = Array.from({ length: 12 }, (_, i) => ({ id: id(i + 1), user_id: owner, situation_text: `Document ${i + 1}`,
    status: 'draft', is_saved: i === 1, updated_at: '2026-09-11T00:00:00Z',
    documents: i === 0 ? [1, 2].map(n => ({ id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`,
      user_id: owner, outcome_id: id(1), title: n === 1 ? 'Office onboarding plan' : 'LongDocumentName'.repeat(15),
      status: 'draft', is_template: true })) : [] }));
  failRead = false; failSave = false; delayRead = false;
};
try {
  const bundle = join(evidence, 'bundle');
  const fixture = join(root, 'apps/web/src/test/browser');
  await build({ configFile: false, root: fixture, publicDir: false, logLevel: 'error',
    resolve: { alias: [
      { find: /^@\/(?:components\/providers|lib\/supabase\/owner-client)$/, replacement: join(fixture, 'library-fixture-api.ts') },
      { find: '@', replacement: join(root, 'apps/web/src') },
      ...['react', 'react/jsx-runtime', 'react-dom/client'].map(name => ({ find: new RegExp(`^${name.replaceAll('/', '\\/')}$`), replacement: webRequire.resolve(name) })),
    ] }, esbuild: { jsx: 'automatic' },
    build: { outDir: bundle, emptyOutDir: false, rollupOptions: { input: join(fixture, 'library-harness.html') } },
  });
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (url.pathname === '/rest/v1/outcomes' && req.method === 'GET') {
        requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
        assert.equal(url.searchParams.get('order'), 'updated_at.desc,id.desc');
        assert.equal(url.searchParams.get('limit'), '10');
        assert.doesNotMatch(url.searchParams.get('select'), /recommendation_payload|content|version_history/);
        if (failRead) { json(400, { message: 'Synthetic read failure' }); return; }
        let data = rows;
        if (url.searchParams.get('is_saved') === 'eq.true') data = data.filter(row => row.is_saved);
        if (url.searchParams.has('documents.is_template')) {
          assert.match(url.searchParams.get('select'), /documents:documents!inner/);
          data = data.filter(row => row.documents.some(doc => doc.is_template));
        }
        const offset = Number(url.searchParams.get('offset') || 0);
        const snapshot = structuredClone(data.slice(offset, offset + 10));
        if (delayRead) { delayRead = false; await new Promise(resolve => setTimeout(resolve, 250)); }
        json(200, snapshot); return;
      }
      if (url.pathname === '/rest/v1/rpc/update_own_outcome' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        requests.push({ path: url.pathname, payload });
        const row = rows.find(item => item.id === payload.p_outcome_id);
        assert.ok(row); assert.equal(typeof payload.p_patch.is_saved, 'boolean');
        if (failSave) { json(400, { message: 'Synthetic save failure' }); return; }
        row.is_saved = payload.p_patch.is_saved;
        json(200, null); return;
      }
      const p = resolve(bundle, `.${decodeURIComponent(url.pathname)}`);
      if (relative(bundle, p).startsWith('..')) throw new Error('Outside fixture');
      const bytes = readFileSync(p);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
    } catch (error) { json(500, { message: 'Fixture request rejected' }); reports.push({ serverError: error.message }); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (!existsSync(engine.executablePath())) { skipped.push({ name, reason: 'Browser engine is not installed' }); continue; }
    browser = await engine.launch({ headless: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      reset();
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], external = [];
      page.setDefaultTimeout(5000);
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); await route.abort(); }
        else await route.continue();
      });
      try {
        await page.goto(`${origin}/library-harness.html`);
        await expect(page.getByRole('article')).toHaveCount(10);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Horizontal overflow');
        await page.screenshot({ path: join(evidence, `${name}-${viewport.width}.png`), fullPage: true });
        await page.addScriptTag({ path: webRequire.resolve('axe-core/axe.min.js') });
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
        assert.deepEqual(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
        failRead = true;
        await page.getByRole('button', { name: 'Load more', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('try again');
        await expect(page.getByRole('article')).toHaveCount(10);
        failRead = false;
        await page.getByRole('button', { name: 'Refresh library' }).click();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.getByRole('button', { name: 'Load more', exact: true }).click();
        await expect(page.getByRole('article')).toHaveCount(12);
        const recents = page.getByRole('tab', { name: 'Recents', exact: true });
        const saved = page.getByRole('tab', { name: 'Saved', exact: true });
        await recents.focus(); await recents.press('ArrowRight');
        await expect(saved).toBeFocused(); await expect(page.getByRole('article')).toHaveCount(1);
        await page.getByRole('button', { name: 'Remove from saved' }).click();
        await expect(page.getByText('No saved documents yet.', { exact: false })).toBeVisible();
        await page.reload(); await expect(page.getByRole('article')).toHaveCount(10);
        await saved.click(); await expect(page.getByText('No saved documents yet.', { exact: false })).toBeVisible();
        await saved.press('End'); await expect(page.getByRole('article')).toHaveCount(1);
        await expect(page.getByRole('heading', { name: 'Office onboarding plan' })).toBeVisible();
        failSave = true;
        await page.getByRole('button', { name: 'Save to library' }).click();
        await expect(page.getByRole('alert')).toContainText('Refresh');
        await expect(page.getByRole('button', { name: 'Save to library' })).toBeDisabled();
        failSave = false;
        await page.getByRole('button', { name: 'Refresh library' }).click();
        await expect(page.getByRole('button', { name: 'Save to library' })).toBeEnabled();
        delayRead = true; await recents.click(); await saved.click();
        await expect(page.getByText('No saved documents yet.', { exact: false })).toBeVisible();
        await page.waitForTimeout(300);
        await expect(page.getByRole('article')).toHaveCount(0);
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
        reports.push({ name, viewport, passed: true, axeViolations: 0, reload: true, retry: true, staleTab: true, pagination: true, bookmarkAcknowledgement: true });
      } catch (error) {
        await page.screenshot({ path: join(evidence, `failure-${name}-${viewport.width}.png`), fullPage: true });
        reports.push({ name, viewport, passed: false, error: error.message, errors, external }); throw error;
      } finally { await context.close(); }
    }
    await browser.close(); browser = null;
  }
  assert.ok(reports.some(report => report.passed), 'No browser ran');
  if (process.env.CI) assert.deepEqual(skipped, [], 'CI requires all three browser engines');
  assert.ok(!reports.some(report => report.serverError), 'Fixture server rejected a request');
  assert.deepEqual(hashes(), inputs, 'Verification modified source'); passed = true;
} finally {
  await browser?.close();
  if (server) await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ passed, inputs, reports, skipped, requests,
    scope: 'Real LibraryList/useLibrary/updateOutcome and Supabase SDK against synthetic HTTP fixtures. Auth/RLS and hosted persistence are not proven.' }, null, 2));
  console.log(JSON.stringify({ passed, evidence, skipped }));
  if (!passed) process.exitCode = 1;
}
