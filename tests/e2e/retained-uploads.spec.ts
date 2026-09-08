import { test, expect, type Page, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadWorkspaceFixture } from './workspace-fixtures';
import assert from 'node:assert/strict';

const fixture = loadWorkspaceFixture();
const selectedPath = (id: string) => `/workspace?upload=${id}`;
const panel = (page: Page) => page.getByRole('region', { name: 'Uploaded originals' });
async function login(page: Page, slot: number, next: string) {
  const user = fixture.users[slot];
  assert.ok(user, 'Required synthetic owner is missing');
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  const form = page.getByRole('form', { name: 'Sign in with email' });
  await form.getByLabel('Email', { exact: true }).fill(user.email);
  await form.getByLabel('Password', { exact: true }).fill(user.password);
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${fixture.webOrigin}${next}`);
  await expect(panel(page)).toBeVisible();
}
async function keyboardActivate(page: Page, locator: Locator) {
  await locator.focus(); await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}

test('owned originals reopen, download unchanged, and stay private across account changes', async ({ page, context }, testInfo) => {
  const errors: string[] = []; const warnings: string[] = []; const external: string[] = [];
  const observe = (opened: Page) => {
    opened.on('pageerror', error => errors.push(error.message));
    opened.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.type() === 'warning') warnings.push(message.text());
    });
  };
  context.on('page', observe); observe(page);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (![fixture.webOrigin, fixture.supabaseOrigin].includes(url.origin)) {
      external.push(`${url.origin}${url.pathname}`); await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await context.routeWebSocket('**/*', socket => {
    external.push(new URL(socket.url()).origin); socket.close();
  });
  const owned = fixture.rows.filter(row => row.ownerId === fixture.users[0].id && row.retained);
  const other = fixture.rows.find(row => row.ownerId === fixture.users[1].id)!;
  const first = owned.find(row => row.name === 'Protected.pdf')!;
  await login(page, 0, selectedPath(first.id));
  await expect(page).toHaveTitle(/PrompTED|TED/i);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('nextjs-portal')).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  // Wait for the independently loaded list before measuring layout; a loading
  // placeholder must not let the old files-first narrow layout pass.
  const more = panel(page).getByRole('button', { name: 'Load more files' });
  await expect(panel(page).locator('ul').getByRole('link')).toHaveCount(20);
  await expect(more).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: first.name, exact: true })).toBeInViewport({ ratio: 1 });
  await expect(panel(page).getByRole('button', { name: 'Download original', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('first-viewport.png') });
  await expect(panel(page).getByRole('link', { name: other.name, exact: true })).toHaveCount(0);
  await more.scrollIntoViewIfNeeded(); await keyboardActivate(page, more);
  await expect(more).toHaveCount(0);
  await expect(panel(page).getByRole('link', { name: 'Earlier file 1.txt', exact: true })).toBeVisible();
  const downloads: Array<{ uploadId: string; name: string; byteLength: number; sha256: string }> = [];
  async function downloadOriginal(row: typeof first) {
    const pending = page.waitForEvent('download');
    await keyboardActivate(page, panel(page).getByRole('button', { name: 'Download original', exact: true }));
    const download = await pending;
    expect(download.suggestedFilename()).toBe(row.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_'));
    expect(await download.failure()).toBeNull();
    const target = testInfo.outputPath(`${row.id}-${row.name}`);
    await download.saveAs(target);
    const actual = readFileSync(target); const original = readFileSync(row.originalPath);
    expect(actual.equals(original)).toBe(true); expect(actual.length).toBe(row.byteLength);
    const hash = createHash('sha256').update(actual).digest('hex'); expect(hash).toBe(row.sha256);
    downloads.push({ uploadId: row.id, name: row.name, byteLength: actual.length, sha256: hash });
  }
  for (const row of owned) {
    // Real list links remain the navigation control; load the next page when
    // the route refresh correctly restarts its owner list at the first page.
    const link = panel(page).getByRole('link', { name: row.name, exact: true });
    if (await link.count() === 0) await panel(page).getByRole('button', { name: 'Load more files' }).click();
    await link.click(); await expect(page).toHaveURL(`${fixture.webOrigin}${selectedPath(row.id)}`);
    await expect(panel(page).getByRole('heading', { name: row.name, exact: true })).toBeVisible();
    await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(row.text);
    await expect(panel(page).getByLabel('Extracted text preview')).toHaveAttribute('readonly', '');
    await expect(panel(page).getByRole('button', { name: /edit|approve|import/i })).toHaveCount(0);
    if (row.imported) await expect(panel(page).getByRole('link', { name: 'Open saved workspace' }))
      .toHaveAttribute('href', `/outcomes/${row.imported.outcome_id}`);
    await page.reload();
    await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(row.text);
    await downloadOriginal(row);
  }
  await page.goto(selectedPath(first.id));
  const reopened = await context.newPage(); await reopened.goto(selectedPath(first.id));
  await expect(panel(reopened).getByLabel('Extracted text preview')).toHaveValue(first.text);
  await reopened.close();
  const missing = fixture.rows.find(row => !row.retained)!;
  await page.goto(selectedPath(missing.id));
  await expect(panel(page).getByText('The original is not currently available. Refresh to check again.')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Download original' })).toHaveCount(0);
  await page.goto(selectedPath(first.id));
  await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(first.text);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('original-open.png') });
  await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
  await login(page, 1, selectedPath(other.id));
  await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(other.text);
  await downloadOriginal(other);
  await page.goto(selectedPath(first.id));
  await expect(panel(page).getByText('This file was not found in this account.')).toBeVisible();
  await expect(panel(page).getByText(first.name, { exact: true })).toHaveCount(0);
  await expect(panel(page).getByLabel('Extracted text preview')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Download original' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('changed-owner.png') });
  await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
  await page.goto(selectedPath(first.id));
  await expect(page.getByText(first.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download original' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in to upload', exact: true })).toBeVisible();
  writeFileSync(testInfo.outputPath('browser-checks.json'), JSON.stringify({
    project: testInfo.project.name, downloads, errors, warnings, external,
    scope: 'Real login, retained source reads, reload/new tab, byte-checked downloads and account change; no upload/edit/export proof.',
  }, null, 2));
  expect(external).toEqual([]); expect(errors).toEqual([]); expect(warnings).toEqual([]);
});
