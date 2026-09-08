// Real Chromium acceptance of the shared React review and its actual CSS.
// This is presentation evidence, separate from caller, provider and DB tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
assert.equal(process.cwd(), root);
assert.equal(process.version, 'v22.23.2');
assert.deepEqual(process.argv.slice(2), []);
// Match the installed browser cache used by the existing isolated app suite.
// Set this before loading Playwright, whose registry captures the path at import.
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'node_modules/.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const vitestRequire = createRequire(webRequire.resolve('vitest/package.json'));
const { build } = await import(pathToFileURL(vitestRequire.resolve('vite')).href);
const evidence = join(root, 'docs/evidence/web-operational-readiness', `tedit-browser-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`);
mkdirSync(evidence, { mode: 0o700 });
const inputs = ['apps/web/src/components/organisms/TedChangeReview.tsx',
  'apps/web/src/components/organisms/TedChangeReview.module.css',
  'apps/web/src/design-system/tokens.css',
  'apps/web/src/test/browser/tedit-dialog-harness.html', 'apps/web/src/test/browser/tedit-dialog-harness.tsx', 'scripts/verify-tedit-dialog.mjs'];
const hashes = () => Object.fromEntries(inputs.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const before = hashes();
const reports = [];
let browser;
let server;
let passed = false;
let failure = null;
try {
  const bundle = join(evidence, 'bundle');
  await build({ configFile: false, root: join(root, 'apps/web/src/test/browser'), publicDir: false, logLevel: 'error',
    resolve: { alias: ['react', 'react/jsx-runtime', 'react-dom/client'].map(name => ({ find: new RegExp(`^${name.replaceAll('/', '\\/')}$`), replacement: webRequire.resolve(name) })) },
    esbuild: { jsx: 'automatic' },
    build: { outDir: bundle, emptyOutDir: false, rollupOptions: { input: join(root, 'apps/web/src/test/browser/tedit-dialog-harness.html') } } });
  server = createServer((req, res) => {
    try {
      const path = resolve(bundle, `.${decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)}`);
      if (relative(bundle, path).startsWith('..')) throw new Error('Outside fixture');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      const bytes = readFileSync(path);
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const errors = []; const external = [];
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); await route.abort(); }
      else await route.continue();
    });
    try {
      await page.goto(`${origin}/tedit-dialog-harness.html`);
      await expect(page.getByRole('button', { name: 'tEdit', exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 700));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
      const initialScroll = await page.evaluate(() => window.scrollY);
      await page.getByRole('button', { name: 'tEdit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Check the change before applying it' });
      await expect(dialog).toBeVisible();
      assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
      await expect(dialog.getByRole('heading')).toBeFocused();
      assert.equal(await page.evaluate(() => window.scrollY), initialScroll);
      const bounds = await dialog.boundingBox(); assert.ok(bounds);
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
      for (const name of ['Apply', 'Try again', 'Discard']) {
        const box = await dialog.getByRole('button', { name, exact: true }).boundingBox(); assert.ok(box);
        assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `${name} is outside viewport`);
      }
      await page.getByRole('button', { name: 'Background action' }).evaluate(element => element.focus());
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Background stole modal focus');
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, `${key} escaped modal`);
      }
      // Focus the actual overflow container, then use keyboard input to reach
      // the final paragraph. No scripted scrollTop or screenshot-only assertion.
      const content = dialog.getByRole('region', { name: 'TED suggested changes' });
      assert.equal(await content.evaluate(element => element.scrollHeight > element.clientHeight + 100), true, 'Fixture did not exercise overflow');
      await content.focus();
      await expect(content).toBeFocused();
      await page.keyboard.press('End');
      await expect.poll(() => content.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true);
      await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled();
      await page.keyboard.press('Tab');
      await expect(content).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(content).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await page.evaluate(() => {
        if (!window.releaseTeditBrowserAction) throw new Error('No held synthetic action');
        window.releaseTeditBrowserAction();
      });
      await expect(dialog.getByRole('alert')).toContainText('Change could not be saved');
      await expect(dialog).toContainText('Suggested paragraph 50');
      await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await page.screenshot({ path: join(evidence, `dialog-${viewport.width}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('toolbar')).toBeFocused();
      await expect(page.getByTestId('counts')).toHaveText(JSON.stringify({ applied: 1, retries: 1, discards: 1 }));
      await page.getByLabel('Simulate discard failure').check();
      await page.getByRole('button', { name: 'tEdit', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('counts')).toHaveText(JSON.stringify({ applied: 1, retries: 1, discards: 2 }));
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      reports.push({ viewport, passed: true, bounds, initialScroll, nativeModal: true, keyboardContainment: true,
        keyboardReachedLastParagraph: true, pendingActionKeyboardContained: true, failedApplyRetained: true,
        retryVisible: true, discardRestoredFocus: true, failedDiscardRetained: true });
    } catch (error) {
      reports.push({ viewport, passed: false, errors, external });
      await page.screenshot({ path: join(evidence, `failure-${viewport.width}.png`) }).catch(() => undefined);
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(hashes(), before, 'Browser check changed source');
  passed = true;
} catch (error) { failure = error instanceof Error ? error.message : 'Browser acceptance failed'; throw error; }
finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    server ? new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())) : undefined,
  ]);
  const cleanupFailures = cleanup.filter(result => result.status === 'rejected').map(() => 'Local browser/server cleanup failed');
  if (cleanupFailures.length) passed = false;
  try { assert.deepEqual(hashes(), before); } catch { passed = false; failure ??= 'Source changed during browser acceptance'; }
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ passed, failure, reports, inputs: before,
    cleanupFailures,
    scope: 'Actual shared component and CSS in Chromium with synthetic local actions; not app persistence, live provider, CI or production proof.' }, null, 2));
  console.log(JSON.stringify({ passed, evidence }));
  if (!passed) process.exitCode = 1;
}
