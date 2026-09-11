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
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'node_modules/.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const viteRequire = createRequire(webRequire.resolve('vitest/package.json'));
const { build } = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const evidence = join(root, 'docs/evidence/workspace-guidance-20260911/browser');
mkdirSync(evidence, { recursive: true });
const sourcePaths = ['SectionEditor.tsx', 'SectionEditor.module.css', 'ExplainWithTED.tsx', 'EditWithTED.tsx', 'EditWithTED.module.css']
  .map(name => `apps/web/src/components/organisms/${name}`);
const hashes = () => Object.fromEntries(sourcePaths.map(p => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
const before = hashes();
const reports = [];
let browser, server;
let passed = false;
try {
  const bundle = join(evidence, 'bundle');
  const fixture = join(root, 'apps/web/src/test/browser');
  await build({ configFile: false, root: fixture, publicDir: false, logLevel: 'error',
    resolve: { alias: [
      { find: /^@\/hooks\/use(?:Edit|Explain)WithTED$/, replacement: join(fixture, 'workspace-guidance-actions.ts') },
      { find: '@', replacement: join(root, 'apps/web/src') },
      ...['react', 'react/jsx-runtime', 'react-dom/client'].map(name => ({ find: new RegExp(`^${name.replaceAll('/', '\\/')}$`), replacement: webRequire.resolve(name) })),
    ] },
    esbuild: { jsx: 'automatic' },
    build: { outDir: bundle, emptyOutDir: false, rollupOptions: { input: join(fixture, 'workspace-guidance-harness.html') } },
  });
  server = createServer((req, res) => {
    try {
      const p = resolve(bundle, `.${decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)}`);
      if (relative(bundle, p).startsWith('..')) throw new Error('Outside fixture');
      const bytes = readFileSync(p);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
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
      await page.goto(`${origin}/workspace-guidance-harness.html`);
      const original = await page.getByTestId('document-content').textContent();
      const explain = page.getByRole('button', { name: 'Explain this', exact: true });
      await expect(explain).toBeVisible();
      await explain.click();
      const quick = page.getByRole('button', { name: 'Plain English', exact: true });
      await quick.focus();
      const scroll = await page.evaluate(() => window.scrollY);
      await quick.press('Enter');
      const article = page.getByRole('article', { name: 'The response deadline' });
      await expect(article).toBeVisible();
      await expect(article.getByRole('list')).toHaveCount(3);
      await expect(article.getByRole('heading', { name: 'Next step', exact: true })).toHaveCount(1);
      assert.equal(await page.evaluate(() => window.scrollY), scroll, 'Explanation moved the document viewport');
      assert.equal(await page.getByTestId('document-content').textContent(), original);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Horizontal overflow');
      await page.screenshot({ path: join(evidence, `explanation-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Close explanation' }).click();
      await page.getByRole('button', { name: 'tEdit', exact: true }).click();
      await page.getByRole('button', { name: 'Change tone', exact: true }).click();
      assert.equal(await page.evaluate(() => window.guidanceTest.edits.length), 0);
      await expect(page.getByRole('group', { name: 'Choose a tone' })).toBeVisible();
      await page.screenshot({ path: join(evidence, `tone-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Professional', exact: true }).click();
      const review = page.getByRole('dialog', { name: 'Check the change before applying it' });
      await expect(review).toBeVisible();
      assert.equal(await review.evaluate(element => element.matches(':modal')), true);
      assert.equal(await page.getByTestId('document-content').textContent(), original, 'Suggestion changed the document without Apply');
      await review.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(review).toHaveCount(0);
      assert.equal(await page.getByTestId('document-content').textContent(), original);

      await explain.click();
      await page.evaluate(() => { window.guidanceTest.hold = true; });
      await page.getByRole('button', { name: 'Plain English', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Plain English', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.evaluate(() => { window.guidanceTest.release(); window.guidanceTest.hold = false; });
      await expect(page.getByRole('article')).toHaveCount(0);
      await page.evaluate(() => { window.guidanceTest.fail = true; });
      await page.getByRole('button', { name: 'Plain English', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('try again');
      await page.evaluate(() => { window.guidanceTest.fail = false; });
      await page.getByRole('button', { name: 'Try explanation again' }).click();
      await expect(article).toBeVisible();
      await page.getByRole('button', { name: 'Close explanation' }).click();
      await page.getByRole('button', { name: 'Switch section' }).click();
      await explain.click();
      await expect(page.getByRole('article')).toHaveCount(0);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      reports.push({ viewport, passed: true, explanationDidNotMovePage: true, structuredAnswer: true, toneClarifiedBeforeDispatch: true,
        suggestionRequiredReview: true, originalUnchanged: true, cancelledReplyIgnored: true, retrySucceeded: true, sectionHistoryReset: true });
    } catch (error) {
      await page.screenshot({ path: join(evidence, `failure-${viewport.width}.png`) });
      reports.push({ viewport, passed: false, message: error.message, errors, external });
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(hashes(), before, 'Browser verification changed source');
  passed = true;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    server ? new Promise((yes, no) => server.close(error => error ? no(error) : yes())) : undefined,
  ]);
  const cleanupFailed = cleanup.some(result => result.status === 'rejected');
  if (cleanupFailed) passed = false;
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ passed, reports, inputs: before, cleanupFailed,
    scope: 'Real SectionEditor, assistance and review components/CSS with controlled provider hooks. No hosted persistence or model-quality claim.' }, null, 2));
  console.log(JSON.stringify({ passed, evidence }));
  if (!passed) process.exitCode = 1;
}
