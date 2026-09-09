import { test, expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadUploadBrowserFixture, type UploadFixture } from './workspace-upload-fixtures';

const fixture = loadUploadBrowserFixture();
const master = (page: Page) => page.getByRole('region', { name: 'Master Workspace', exact: true });
const panel = (page: Page) => page.getByRole('region', { name: 'Uploaded originals', exact: true });
const profileValues = (slot: number) => ({
  'Full name': `Synthetic Profile ${slot === 0 ? 'A' : 'B'}`,
  'Preferred name': `Local owner ${slot === 0 ? 'A' : 'B'}`,
  'Contact number': slot === 0 ? '0420000001' : '0420000002',
  'Address line 1': `${slot + 1} Synthetic Street`,
  'Suburb / locality': 'Test suburb', 'State / territory': 'VIC', 'Postcode': '3000', 'Country': 'Australia',
});
async function login(page: Page, slot: number) {
  const user = fixture.users[slot]; assert.ok(user);
  await page.goto('/sign-in?next=%2Fworkspace');
  const form = page.getByRole('form', { name: 'Sign in with email' });
  await form.getByLabel('Email', { exact: true }).fill(user.email);
  await form.getByLabel('Password', { exact: true }).fill(user.password);
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${fixture.webOrigin}/workspace`);
  await expect(master(page)).toBeVisible();
}

test('real file chooser settles owned sources and reopens identical originals', async ({ page, context }, info) => {
  const errors: string[] = []; const external: string[] = [];
  const records: Array<{ name: string; uploadId: string; receipt: unknown; outcomeId: string | null;
    importReceipt?: unknown; stages: string[] }> = [];
  const profileStages: string[] = [];
  const profileReadFaultAttempts: number[] = [];
  let complete = false; let failure: string | null = null;
  const persist = () => writeFileSync(info.outputPath('upload-browser-checks.json'), JSON.stringify({
    project: info.project.name, ownerId: fixture.users[info.project.name === 'desktop-chromium' ? 0 : 1]!.id,
    complete, failure, records, profileStages, profileReadFaultAttempts, errors, external,
    scope: 'New chooser uploads and Profile access/detail save/reload, real Auth/RPC/Storage and production entrypoints, provider calls prohibited; no hosted/live-model/resume-lifecycle/format-preserving editing/export proof.',
  }, null, 2));
  const stage = (record: typeof records[number], name: string) => { record.stages.push(name); persist(); };
  page.on('pageerror', e => errors.push(e.message));
  context.on('page', other => other.on('pageerror', e => errors.push(e.message)));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (![fixture.webOrigin, fixture.supabaseOrigin].includes(url.origin)) {
      external.push(url.origin + url.pathname); await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { external.push(new URL(socket.url()).origin); socket.close(); });
  const slot = info.project.name === 'desktop-chromium' ? 0 : 1;
  try {
    await login(page, slot);
    const manifest = await page.request.get(`${fixture.webOrigin}/manifest.webmanifest`);
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).name).toBe('PrompTED');
    async function choose(file: UploadFixture, lostAck = false) {
      await page.goto('/workspace');
      const button = master(page).getByRole('button', { name: 'Drop a document here, or click to browse', exact: true });
      await expect(button).toHaveAttribute('aria-busy', 'false');
      // The fault discards exactly one *completed* Next response. Its real server
      // request and DB settlement have already run; subsequent retry is untouched.
      if (lostAck) await page.route('**/api/ingest-upload', async route => {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 60000 }); expect(response.status()).toBe(200);
        await route.abort('failed'); await page.unroute('**/api/ingest-upload');
      }, { times: 1 });
      const pendingResponse = page.waitForResponse(response => response.url().endsWith('/api/ingest-upload') && response.status() === 200);
      const pendingChooser = page.waitForEvent('filechooser'); await button.click();
      const chooser = await pendingChooser;
      await chooser.setFiles({ name: `${info.project.name}-${file.name}`, mimeType: file.mime, buffer: readFileSync(file.path) });
      const response = await pendingResponse; const receipt = await response.json();
      expect(receipt.contract_version).toBe('upload-source-preparation.1');
      expect(receipt.classification_status).toBe('not_requested'); expect(receipt.original_retained).toBe(true);
      expect(receipt.extraction_format).toBe(file.format); expect(receipt.resource_policy_version).toBe('upload-resource-policy.2');
      expect(receipt.extracted_text).toBe(file.text); expect(receipt.truncated).toBe(false);
      expect(receipt.extraction_text_sha256).toBe(createHash('sha256').update(file.text).digest('hex'));
      expect(receipt).not.toHaveProperty('confirm_payload'); expect(receipt).not.toHaveProperty('credit_fallback');
      expect(receipt).not.toHaveProperty('source_manifest');
      expect(receipt.upload_id).toMatch(/^[0-9a-f-]{36}$/);
      const existing = records.find(record => record.name === `${info.project.name}-${file.name}`);
      if (existing) { expect(receipt).toEqual(existing.receipt); stage(existing, 'upload_replayed'); }
      else {
        records.push({ name: `${info.project.name}-${file.name}`, uploadId: receipt.upload_id, receipt, outcomeId: null, stages: [] });
        stage(records.at(-1)!, 'ingest_completed');
      }
      if (file.format === 'text') await expect(master(page).getByRole('region', { name: 'Review imported document', exact: true })).toBeVisible();
      else await expect(button).toHaveAttribute('aria-busy', 'false');
      return receipt;
    }
    async function original(file: UploadFixture, uploadId: string) {
      await page.goto(`/workspace?upload=${uploadId}`);
      await expect(panel(page).getByRole('heading', { name: `${info.project.name}-${file.name}`, exact: true })).toBeVisible();
      await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(file.text);
      await expect(panel(page).getByLabel('Extracted text preview')).toHaveAttribute('readonly', '');
      await page.reload(); await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(file.text);
      const downloadEvent = page.waitForEvent('download');
      await panel(page).getByRole('button', { name: 'Download original', exact: true }).click();
      const download = await downloadEvent; expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toBe(`${info.project.name}-${file.name}`);
      const target = info.outputPath(`${uploadId}-${file.name}`); await download.saveAs(target);
      expect(readFileSync(target).equals(readFileSync(file.path))).toBe(true);
    }
    for (const file of fixture.files) {
      const receipt = await choose(file, file.name === 'Protected.pdf');
      const record = records.find(record => record.uploadId === receipt.upload_id)!;
      let outcomeId: string | null = null;
      if (file.format !== 'text') {
        const link = master(page).getByRole('link', { name: 'Open uploaded original', exact: true });
        await expect(link).toHaveAttribute('href', `/workspace?upload=${receipt.upload_id}`);
        await expect(master(page).getByRole('region', { name: 'Review imported document' })).toHaveCount(0);
        await link.click(); await expect(page).toHaveURL(`${fixture.webOrigin}/workspace?upload=${receipt.upload_id}`);
        await expect(panel(page).getByLabel('Extracted text preview')).toHaveValue(file.text);
        stage(record, 'original_opened');
      } else {
        const review = master(page).getByRole('region', { name: 'Review imported document', exact: true });
        await expect(review).toBeVisible();
        await expect(review.getByRole('textbox', { name: 'Content', exact: true })).not.toBeEmpty();
        if (file.importText) {
          await expect(review.getByRole('textbox', { name: 'Section 1 name', exact: true })).toHaveValue('Overview');
          await expect(review.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue('This is synthetic wording for the upload acceptance test.\n\nThe owner checks this paragraph before saving.');
          const pendingCommit = page.waitForResponse(response => {
            const url = new URL(response.url());
            return response.request().method() === 'POST' && url.origin === fixture.supabaseOrigin &&
              url.pathname === '/rest/v1/rpc/commit_document_import';
          });
          await review.getByRole('button', { name: 'Create workspace', exact: true }).click();
          const committed = await pendingCommit; expect(committed.status()).toBe(200);
          const importReceipt = await committed.json();
          expect(importReceipt.status).toBe('committed'); expect(importReceipt.idempotent_replay).toBe(false);
          expect(importReceipt.document_id).toMatch(/^[0-9a-f-]{36}$/); expect(importReceipt.outcome_id).toMatch(/^[0-9a-f-]{36}$/);
          record.importReceipt = importReceipt; record.outcomeId = importReceipt.outcome_id;
          stage(record, 'import_receipt_received');
          await expect(page).toHaveURL(`${fixture.webOrigin}/outcomes/${importReceipt.outcome_id}`); outcomeId = importReceipt.outcome_id;
          record.outcomeId = outcomeId; stage(record, 'import_destination_opened');
          await page.reload();
          await expect(page.getByRole('article', { name: `Edit ${info.project.name}-${file.name.replace(/\.[^.]+$/, '')}`, exact: true })).toBeVisible();
          await expect(page.getByRole('textbox', { name: 'Edit Overview', exact: true })).toContainText('The owner checks this paragraph before saving.');
          const sectionSelect = page.getByRole('combobox', { name: 'Choose a section', exact: true });
          await expect(sectionSelect.locator('option').nth(1)).toHaveText('2. Next steps');
          await sectionSelect.selectOption({ index: 1 });
          await expect(page.getByRole('textbox', { name: 'Edit Next steps', exact: true })).toContainText('Reopen the saved document.');
          stage(record, 'workspace_reloaded_and_both_sections_read');
        }
      }
      await original(file, receipt.upload_id); stage(record, 'original_reloaded_and_download_verified');
      const replay = await choose(file); expect(replay).toEqual(receipt);
      if (file.importText) {
        const review = master(page).getByRole('region', { name: 'Review imported document', exact: true });
        await review.getByRole('button', { name: 'Create workspace', exact: true }).click();
        await expect(master(page).getByText('This original file is already in your workspace.', { exact: false })).toBeVisible();
        await review.getByRole('button', { name: 'Open saved workspace', exact: true }).click();
        await expect(page).toHaveURL(`${fixture.webOrigin}/outcomes/${outcomeId}`); stage(record, 'import_replayed');
      }
    }
    const first = records[0]; assert.ok(first);
    await page.goto(`/workspace?upload=${first.uploadId}`); await expect(panel(page).getByRole('button', { name: 'Download original' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('uploaded-original.png') });

    // Profile opening/saving goes straight to real owner-scoped PostgREST;
    // no resume promotion, extra uploads or model calls are part of this slice.
    const profileRegion = page.getByRole('region', { name: 'Profile', exact: true });
    const profileFaultPattern = `${fixture.supabaseOrigin}/rest/v1/profile_resume_versions?*`;
    await page.route(profileFaultPattern, async route => {
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).searchParams.get('user_id')).toBe(`eq.${fixture.users[slot]!.id}`);
      const attempt = Number(route.request().headers()['x-retry-count'] ?? '0');
      expect(attempt).toBe(profileReadFaultAttempts.length); expect(attempt).toBeLessThan(4);
      profileReadFaultAttempts.push(attempt); persist();
      // The SDK retries idempotent503 reads three times. Hold the actual fault
      // through that bounded policy; the server's zero delay keeps this test fast.
      await route.fulfill({ status: 503, contentType: 'application/json', headers: {
        'retry-after': '0', 'cache-control': 'private, no-store',
        'access-control-allow-origin': fixture.webOrigin, 'access-control-expose-headers': 'Retry-After',
      }, body: JSON.stringify({ message: 'Synthetic initial Profile read failure' }) });
    });
    await page.getByRole('link', { name: 'Your profile', exact: true }).click();
    await expect(page).toHaveURL(`${fixture.webOrigin}/settings/profile`);
    await expect(profileRegion.getByRole('alert')).toContainText("TED couldn't load your saved resume resources.");
    expect(profileReadFaultAttempts).toEqual([0, 1, 2, 3]);
    await expect(page.getByRole('form', { name: 'Edit Profile details' })).toHaveCount(0);
    profileStages.push('initial_read_failure_visible'); persist();
    await page.unroute(profileFaultPattern);
    await profileRegion.getByRole('button', { name: 'Try again', exact: true }).click();
    const profileForm = page.getByRole('form', { name: 'Edit Profile details', exact: true });
    await expect(profileForm).toBeVisible();
    await expect(profileForm.getByLabel('Email', { exact: true })).toHaveValue(fixture.users[slot]!.email);
    await expect(profileForm.getByLabel('Email', { exact: true })).toBeDisabled();
    await expect(page.getByText('No Current resume saved', { exact: true })).toBeVisible();
    profileStages.push('real_profile_read_recovered'); persist();
    for (const [label, value] of Object.entries(profileValues(slot))) await profileForm.getByLabel(label, { exact: true }).fill(value);
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    const saveButton = profileForm.getByRole('button', { name: 'Save Profile', exact: true });
    await saveButton.hover();
    await page.mouse.down();
    try {
      await expect.poll(() => saveButton.evaluate(element =>
        new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeCloseTo(0.97, 2);
    } finally {
      // Release away from the button so this press check cannot save the form.
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
    profileStages.push('primary_button_press_feedback'); persist();
    const savedProfile = page.waitForResponse(response => response.request().method() === 'POST' &&
      response.url() === `${fixture.supabaseOrigin}/rest/v1/rpc/update_own_profile_details`);
    await profileForm.getByRole('button', { name: 'Save Profile', exact: true }).click();
    expect((await savedProfile).status()).toBe(204);
    await expect(page.getByText('Profile up to date', { exact: true })).toBeVisible();
    profileStages.push('detail_save_acknowledged'); persist();
    await page.reload();
    for (const [label, value] of Object.entries(profileValues(slot))) await expect(profileForm.getByLabel(label, { exact: true })).toHaveValue(value);
    profileStages.push('saved_details_reloaded'); persist();
    const secondTab = await context.newPage();
    try {
      await secondTab.goto('/settings/profile');
      for (const [label, value] of Object.entries(profileValues(slot))) await expect(secondTab.getByLabel(label, { exact: true })).toHaveValue(value);
      await expect(secondTab.getByLabel('Email', { exact: true })).toHaveValue(fixture.users[slot]!.email);
      await expect(secondTab.getByText('No Current resume saved', { exact: true })).toBeVisible();
      profileStages.push('independent_tab_reopened'); persist();
    } finally { await secondTab.close(); }
    await page.screenshot({ path: info.outputPath('profile-saved.png'), fullPage: true });
    await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
    await login(page, 1 - slot); await page.goto(`/workspace?upload=${first.uploadId}`);
    await expect(panel(page).getByText('This file was not found in this account.')).toBeVisible();
    await expect(panel(page).getByLabel('Extracted text preview')).toHaveCount(0);
    const otherProfileResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.origin === fixture.supabaseOrigin &&
        url.pathname === '/rest/v1/profiles' && url.searchParams.get('id') === `eq.${fixture.users[1 - slot]!.id}` &&
        (url.searchParams.get('select') ?? '').includes('preferred_name');
    });
    await page.getByRole('link', { name: 'Your profile', exact: true }).click();
    const otherProfileRead = await otherProfileResponse; expect(otherProfileRead.status()).toBe(200);
    const otherProfile = await otherProfileRead.json();
    expect(otherProfile).not.toBeNull(); expect(Array.isArray(otherProfile)).toBe(false);
    expect(Object.keys(otherProfile).sort()).toEqual(['display_name', 'full_name', 'preferred_name', 'phone',
      'date_of_birth', 'address_line_1', 'address_line_2', 'suburb', 'state', 'postcode', 'country'].sort());
    for (const value of Object.values(otherProfile)) expect(value === null || typeof value === 'string').toBe(true);
    const otherValues = {
      'Full name': otherProfile.full_name ?? '', 'Preferred name': otherProfile.preferred_name || otherProfile.display_name || '',
      'Contact number': otherProfile.phone ?? '', 'Address line 1': otherProfile.address_line_1 ?? '',
    };
    await expect(profileForm.getByLabel('Email', { exact: true })).toHaveValue(fixture.users[1 - slot]!.email);
    for (const label of ['Full name', 'Preferred name', 'Contact number', 'Address line 1'] as const) {
      await expect(profileForm.getByLabel(label, { exact: true })).not.toHaveValue(profileValues(slot)[label]);
      expect(typeof otherValues[label]).toBe('string');
      await expect(profileForm.getByLabel(label, { exact: true })).toHaveValue(otherValues[label]);
    }
    await expect(page.getByText('No Current resume saved', { exact: true })).toBeVisible();
    profileStages.push('changed_owner_isolated'); persist();
    await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
    await page.goto('/settings/profile'); await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.getByRole('form', { name: 'Edit Profile details', exact: true })).toHaveCount(0);
    profileStages.push('anonymous_access_denied'); persist();
    expect(errors).toEqual([]); expect(external).toEqual([]);
    complete = true;
  } catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
  finally {
    try { persist(); }
    catch (error) {
      if (failure === null) throw error;
      // Keep the original assertion as the failure; this separate diagnostic
      // contains no receipt, authentication data or document wording.
      console.error('Partial upload evidence could not be saved:', error instanceof Error ? error.name : 'UnknownError');
    }
  }
});
