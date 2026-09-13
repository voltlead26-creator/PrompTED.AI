import { test, expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadUploadBrowserFixture, type UploadFixture } from './workspace-upload-fixtures';

const fixture = loadUploadBrowserFixture();
const accountPlanTestName = 'account plan comparison uses confirmed Free access for historical Business';
const generationLimitTestName = 'controlled generation-limit responses pause checklist preparation safely';

test('manual plans persist across devices with exact retry, recovery and conflict handling', async ({ page, context, browser }, info) => {
  const slot = info.project.name === 'desktop-chromium' ? 0 : 1;
  const checks: string[] = []; const errors: string[] = []; const external: string[] = [];
  let complete = false; let failure: string | null = null; let planUrl = ''; let planId = '';
  const observed: { snapshot: Record<string, unknown> | null; release: (() => void) | null; committedStatus: number | null } = { snapshot: null, release: null, committedStatus: null };
  const receipts: Promise<void>[] = [];
  const watch = (target: Page) => {
    target.on('pageerror', error => errors.push(error.message));
    target.on('response', response => {
      if (!response.url().endsWith('/rest/v1/rpc/save_own_manual_plan_v1') || response.status() !== 200) return;
      receipts.push(response.json().then(body => { if (body.snapshot) observed.snapshot = body.snapshot; }, error => { errors.push(String(error)); }));
    });
  };
  watch(page); context.on('page', watch);
  const restrict = async (surface: typeof context) => {
    await surface.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (![fixture.webOrigin, fixture.supabaseOrigin].includes(url.origin)) {
        external.push(url.origin + url.pathname); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await surface.routeWebSocket('**/*', socket => { external.push(new URL(socket.url()).origin); socket.close(); });
  };
  await restrict(context);
  const fresh = await browser.newContext({ baseURL: fixture.webOrigin, serviceWorkers: 'block', viewport: info.project.use.viewport });
  await restrict(fresh); fresh.on('page', watch);
  const saved = (target: Page) => expect(target.getByText('Saved to your account', { exact: true })).toBeVisible();
  let interruptedCommand: unknown = null; let retriedCommand: unknown = null;
  let recoveryProof: { originalUrl: string; originalId: string; accountVersionId: string } | null = null;

  try {
    await login(page, slot);
    await page.goto('/plans');
    await page.getByRole('link', { name: /Create manually/ }).click();
    const title = `  Synthetic manual ${info.project.name}  `;
    const wording = '  Call Renée\nKeep the agreed delivery date.  ';
    await page.getByRole('textbox', { name: 'Plan title', exact: true }).fill(title);
    await page.getByRole('textbox', { name: 'Action 1', exact: true }).fill(wording);
    await page.getByText('Details', { exact: true }).click();
    await page.getByLabel('Section / phase', { exact: true }).fill(' Before delivery ');
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('  Keep these notes\n日本語  ');
    await page.getByLabel('Due date', { exact: true }).fill('2026-09-15');
    await page.getByRole('checkbox', { name: 'Mark action 1 complete', exact: true }).check();
    await saved(page);
    planId = new URL(page.url()).searchParams.get('plan') ?? ''; expect(planId).toBeTruthy();
    planUrl = `${fixture.webOrigin}/plans?create=manual&plan=${encodeURIComponent(planId)}`;
    await page.getByRole('link', { name: 'Back to plans', exact: true }).click();
    await page.getByRole('region', { name: 'Plans saved to your account', exact: true }).getByRole('link').filter({ hasText: title.trim() }).click();
    await expect(page.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue(wording);
    await page.getByText('Details', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveValue(title);
    await expect(page.getByLabel('Section / phase', { exact: true })).toHaveValue(' Before delivery ');
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('  Keep these notes\n日本語  ');
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('2026-09-15');
    await expect(page.getByRole('checkbox', { name: 'Mark action 1 incomplete', exact: true })).toBeChecked();
    checks.push('all_fields_reopened');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue(wording);
    checks.push('reload');
    await page.getByRole('link', { name: 'Back to plans', exact: true }).click();
    await expect(page).toHaveURL(`${fixture.webOrigin}/plans`);
    await page.goBack();
    await expect(page.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue(wording);
    await page.goForward();
    await expect(page).toHaveURL(`${fixture.webOrigin}/plans`);
    await page.goto(planUrl);
    checks.push('back_forward_direct_link');
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByRole('textbox', { name: 'Action 2', exact: true }).fill('  Preserve this sibling  ');
    await page.getByRole('textbox', { name: 'Action 1', exact: true }).focus();
    await page.route('**/api/edit-section', async route => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
        'data: {"type":"delta","text":"Contact Renée to confirm the agreed delivery date."}\n\n' +
        'data: {"type":"changes","changes":[]}\n\ndata: [DONE]\n\n' });
    });
    await page.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(page.getByText('Contact Renée to confirm the agreed delivery date.', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue(wording);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('  Preserve this sibling  ');
    await saved(page); checks.push('review_apply_preserves_sibling');

    // Commit at real PostgREST, withhold its acknowledgement, then cancel. The
    // browser must retain the command and later typing and retry that identity.
    const held = new Promise<void>(resolve => { observed.release = resolve; });
    await page.route('**/rest/v1/rpc/save_own_manual_plan_v1', async route => {
      interruptedCommand = route.request().postDataJSON().p_command;
      const response = await route.fetch(); observed.committedStatus = response.status();
      if (response.status() !== 200) { await route.fulfill({ response }); return; }
      const body = await response.json(); expect(body.status).toBe('saved');
      observed.snapshot = body.snapshot; await held;
      await route.abort('failed');
    });
    await page.getByRole('textbox', { name: 'Plan title', exact: true }).fill(`${title} first save`);
    await expect.poll(() => observed.committedStatus).toBe(200);
    await page.getByRole('button', { name: 'Cancel save request', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry account save', exact: true })).toBeVisible();
    observed.release!(); observed.release = null;
    await page.unroute('**/rest/v1/rpc/save_own_manual_plan_v1');
    await page.getByRole('textbox', { name: 'Plan title', exact: true }).fill(`${title} newer typing`);
    await page.route('**/rest/v1/rpc/save_own_manual_plan_v1', async route => {
      if (retriedCommand === null) retriedCommand = route.request().postDataJSON().p_command;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Retry account save', exact: true }).click();
    await saved(page); expect(retriedCommand).toEqual(interruptedCommand);
    await expect(page.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveValue(`${title} newer typing`);
    checks.push('cancel_uncertain_save_exact_retry_preserves_typing');
    await page.unroute('**/rest/v1/rpc/save_own_manual_plan_v1');

    const other = await fresh.newPage(); await login(other, slot);
    expect(await other.evaluate(() => Object.keys(localStorage).filter(key => key.includes('manual-plan')))).toEqual([]);
    await other.goto(planUrl);
    await expect(other.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue('Contact Renée to confirm the agreed delivery date.');
    await expect(other.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('  Preserve this sibling  ');
    await expect(other.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveValue(`${title} newer typing`);
    checks.push('independent_browser_account_read');
    await page.getByRole('textbox', { name: 'Plan title', exact: true }).fill(`${title} final`); await saved(page);
    await other.getByRole('textbox', { name: 'Action 2', exact: true }).fill('Conflicting second-device draft');
    await expect(other.getByRole('button', { name: 'Review account version', exact: true })).toBeVisible();
    await expect(other.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('Conflicting second-device draft');
    const recoveryUrl = new URL(other.url());
    const recoveryId = recoveryUrl.searchParams.get('recovery');
    expect(recoveryUrl.origin).toBe(fixture.webOrigin); expect(recoveryUrl.pathname).toBe('/plans');
    expect(recoveryUrl.searchParams.get('plan')).toBe(planId);
    expect(recoveryId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await other.getByRole('button', { name: 'Review account version', exact: true }).click();
    await other.getByText(`Account version: ${title.trim()} final`, { exact: true }).click();
    await other.getByRole('button', { name: 'Use account version and keep device recovery copy', exact: true }).click();
    await expect(other.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('  Preserve this sibling  ');
    await expect(other.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveValue(`${title} final`);
    const accountVersionId = new URL(other.url()).searchParams.get('recovery');
    expect(accountVersionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(accountVersionId).not.toBe(recoveryId);
    assert.ok(recoveryId); assert.ok(accountVersionId);
    recoveryProof = { originalUrl: recoveryUrl.href, originalId: recoveryId, accountVersionId };
    // Reopen the exact abandoned record after leaving its editor. Reload must
    // retain the conflicting draft, independently of the accepted account copy.
    await other.goto('/plans'); await other.goto(recoveryUrl.href);
    await expect(other.getByRole('status').filter({ hasText: 'A previous save is unconfirmed.' })).toBeVisible();
    await expect(other.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('Conflicting second-device draft');
    await other.reload();
    await expect(other.getByRole('status').filter({ hasText: 'A previous save is unconfirmed.' })).toBeVisible();
    await expect(other.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('Conflicting second-device draft');
    await expect(other.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveValue(`${title} newer typing`);
    await page.goto(planUrl); await saved(page);
    await expect(page.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue('Contact Renée to confirm the agreed delivery date.');
    await expect(page.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('  Preserve this sibling  ');
    await expect(page.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveValue(`${title} final`);
    checks.push('stale_device_conflict_preserves_recovery');
    await Promise.all(receipts); assert.ok(observed.snapshot);
    const outcomeId = String(observed.snapshot.outcome_id);
    for (const path of [`/outcomes/${outcomeId}`, `/outcomes/${outcomeId}/checklist`]) {
      await other.goto(path); await expect(other.getByRole('textbox', { name: 'Action 1', exact: true })).toHaveValue('Contact Renée to confirm the agreed delivery date.');
    }
    await other.goto('/library');
    await other.getByRole('link', { name: `Open ${title.trim()} final`, exact: true }).click();
    await expect(other.getByRole('textbox', { name: 'Action 2', exact: true })).toHaveValue('  Preserve this sibling  ');
    checks.push('my_work_and_outcome_routes');
    await page.screenshot({ path: info.outputPath('manual-plan.png'), fullPage: true });
    await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
    await login(page, 1 - slot); await page.goto(planUrl);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('This plan is unavailable for this account.');
    await expect(page.getByRole('textbox', { name: 'Plan title', exact: true })).toHaveCount(0);
    checks.push('other_owner_unavailable');
    expect(errors).toEqual([]); expect(external).toEqual([]); complete = true;
  } catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
  finally {
    observed.release?.(); await fresh.close();
    writeFileSync(info.outputPath('manual-plan-browser-checks.json'), JSON.stringify({ project: info.project.name,
      ownerId: fixture.users[slot]!.id, complete, failure, planId, finalSnapshot: observed.snapshot, interruptedCommand, retriedCommand, recoveryProof, checks, errors, external,
      scope: 'Real local Auth/PostgREST and Next App Router; independent browser account persistence, cancelled acknowledgement, exact retry, stale-device conflict and controlled TED response. No hosted or live provider proof.' }, null, 2));
  }
});

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

type RoleBrowserItem = { id: string; label: string; description: string | null;
  status: 'pending' | 'done' | 'skipped'; sort_order: number; mutation_token: string };
type RoleBrowserRow = RoleBrowserItem & { user_id: string; saved_role_id: string };
type RoleBrowserCommand = { p_item_id: string; p_expected_mutation_token: string; p_status: 'pending' | 'done' };
type RoleBrowserMutation = { command: RoleBrowserCommand;
  receipt: { status: 'committed'; affected_rows: 1; item: RoleBrowserItem } };
const roleItemFields = ['id', 'label', 'description', 'status', 'sort_order', 'mutation_token'];
const roleRowFields = [...roleItemFields, 'user_id', 'saved_role_id'];
function roleBrowserRecord(value: unknown, fields: string[]): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
  return value as Record<string, unknown>;
}
function roleBrowserUuid(value: unknown): string {
  assert.ok(typeof value === 'string');
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  return value;
}
function roleBrowserItem(value: unknown): RoleBrowserItem {
  const row = roleBrowserRecord(value, roleItemFields);
  assert.ok(typeof row.label === 'string' && row.label.length <= 256);
  assert.ok(row.description === null || (typeof row.description === 'string' && row.description.length <= 2048));
  assert.ok(row.status === 'pending' || row.status === 'done' || row.status === 'skipped');
  assert.ok(typeof row.sort_order === 'number' && Number.isInteger(row.sort_order) && row.sort_order >= 0 && row.sort_order <= 5);
  return { id: roleBrowserUuid(row.id), label: row.label, description: row.description,
    status: row.status, sort_order: row.sort_order, mutation_token: roleBrowserUuid(row.mutation_token) };
}
function roleBrowserRows(value: unknown, ownerId: string, roleId: string): RoleBrowserRow[] {
  assert.ok(Array.isArray(value)); assert.equal(value.length, 6);
  const rows = value.map(value => {
    const row = roleBrowserRecord(value, roleRowFields);
    assert.equal(row.user_id, ownerId); assert.equal(row.saved_role_id, roleId);
    const item = roleBrowserItem(Object.fromEntries(roleItemFields.map(key => [key, row[key]])));
    return { ...item, user_id: ownerId, saved_role_id: roleId };
  });
  assert.equal(new Set(rows.map(row => row.id)).size, 6);
  assert.deepEqual(rows.map(row => row.sort_order), [0, 1, 2, 3, 4, 5]);
  return rows;
}
function roleBrowserMutation(commandValue: unknown, receiptValue: unknown): RoleBrowserMutation {
  const command = roleBrowserRecord(commandValue, ['p_item_id', 'p_expected_mutation_token', 'p_status']);
  assert.ok(command.p_status === 'pending' || command.p_status === 'done');
  const receipt = roleBrowserRecord(receiptValue, ['status', 'affected_rows', 'item']);
  assert.equal(receipt.status, 'committed'); assert.equal(receipt.affected_rows, 1);
  const item = roleBrowserItem(receipt.item);
  assert.equal(item.id, command.p_item_id); assert.equal(item.status, command.p_status);
  assert.notEqual(item.mutation_token, command.p_expected_mutation_token);
  return { command: { p_item_id: roleBrowserUuid(command.p_item_id),
    p_expected_mutation_token: roleBrowserUuid(command.p_expected_mutation_token), p_status: command.p_status },
    receipt: { status: 'committed', affected_rows: 1, item } };
}

test('role actions preserve newer saved state across late acknowledgements and reload', async ({ page, context, browser }, info) => {
  const slot = info.project.name === 'desktop-chromium' ? 0 : 1;
  const ownerId = fixture.users[slot]!.id; const otherOwnerId = fixture.users[1 - slot]!.id;
  const title = `Synthetic action role ${info.project.name}`;
  const employer = `${fixture.project}-${info.project.name}`;
  const situation = `Synthetic local action acceptance for ${info.project.name}.`;
  const checks: string[] = []; const errors: string[] = []; const external: string[] = [];
  const jobMatchRequests = { primary: 0, second: 0 };
  const saveRequests: Array<{ ownerId: string; roleId: string }> = [];
  let complete = false; let failure: string | null = null; let roleId = ''; let itemId = '';
  let initialRows: RoleBrowserRow[] = []; let refreshedRows: RoleBrowserRow[] = []; let finalRows: RoleBrowserRow[] = [];
  let otherRoleId = ''; let otherRows: RoleBrowserRow[] = []; let readCount = 0;
  const mutations: { held: RoleBrowserMutation | null; newer: RoleBrowserMutation | null; next: RoleBrowserMutation | null } = {
    held: null, newer: null, next: null,
  };
  const heldHandlers: Promise<void>[] = [];
  let releaseAcknowledgement: () => void = () => undefined;
  const acknowledgementGate = new Promise<void>(resolve => { releaseAcknowledgement = resolve; });
  const mutationPath = `${fixture.supabaseOrigin}/rest/v1/rpc/update_own_role_action_item`;
  const safeError = (error: unknown) => fixture.users.reduce((value, user) => value.replaceAll(user.password, '[local credential redacted]'),
    error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[local JWT redacted]');
  const watch = (target: Page) => target.on('pageerror', error => errors.push(safeError(error)));
  watch(page); context.on('page', watch);
  const restrict = async (surface: typeof context) => {
    await surface.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (![fixture.webOrigin, fixture.supabaseOrigin].includes(url.origin)) {
        external.push(url.origin + url.pathname); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await surface.routeWebSocket('**/*', socket => { external.push(new URL(socket.url()).origin); socket.close(); });
  };
  const fresh = await browser.newContext({ baseURL: fixture.webOrigin, serviceWorkers: 'block', viewport: info.project.use.viewport });
  fresh.on('page', watch);
  async function controlSearch(target: Page, surface: keyof typeof jobMatchRequests) {
    await target.route(`${fixture.webOrigin}/api/job-match`, async route => {
      assert.equal(route.request().method(), 'POST');
      const body: unknown = route.request().postDataJSON();
      assert.ok(body && typeof body === 'object' && !Array.isArray(body));
      const input = body as Record<string, unknown>;
      assert.equal(input.situation, situation); assert.equal(input.distance, undefined); roleBrowserUuid(input.generation_request_id);
      assert.ok(Object.keys(input).every(key => ['situation', 'experience', 'location', 'work_type', 'distance', 'role_focus', 'country_code', 'generation_request_id'].includes(key)));
      jobMatchRequests[surface] += 1; assert.ok(jobMatchRequests[surface] <= (surface === 'primary' ? 3 : 1));
      // Only discovery is controlled. This response never reaches the gateway or a provider.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        need_more_context: false, summary: 'Synthetic role used only for local action acceptance.',
        listings: [{ title, employer, location: 'Melbourne', fit_score: 90 }], role_ideas: [], live_search: false,
      }) });
    });
  }
  async function searchRole(target: Page) {
    await target.getByLabel('Distance', { exact: true }).fill('');
    await target.getByLabel('What should TED know before matching roles?', { exact: true }).fill(situation);
    await target.getByRole('button', { name: 'Find roles', exact: true }).click();
    await expect(target.getByRole('region', { name: 'Current openings', exact: true })).toContainText(title);
  }
  const checkbox = (target: Page) => target.getByRole('checkbox', { name: 'Review job requirements', exact: true });
  async function assertVisibleRows(target: Page, rows: RoleBrowserRow[]) {
    const plan = target.getByRole('heading', { name: 'Action plan', exact: true }).locator('..');
    await expect(plan.getByRole('checkbox')).toHaveCount(6);
    for (const row of rows) {
      const item = plan.getByRole('checkbox', { name: row.label, exact: true });
      if (row.status === 'done') await expect(item).toBeChecked();
      else await expect(item).not.toBeChecked();
    }
  }
  async function openPlan(target: Page, expectedOwnerId: string, expectedRoleId: string | null, saves: boolean) {
    const [response, saved] = await Promise.all([
      target.waitForResponse(response => response.request().method() === 'GET' &&
        new URL(response.url()).origin === fixture.supabaseOrigin && new URL(response.url()).pathname === '/rest/v1/role_action_items'),
      saves ? target.waitForResponse(response => response.request().method() === 'POST' &&
        response.url() === `${fixture.supabaseOrigin}/rest/v1/rpc/save_own_role_with_default_actions`) : Promise.resolve(null),
      target.getByRole('button', { name: 'Action plan', exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    const url = new URL(response.url());
    expect([...url.searchParams.keys()].sort()).toEqual(['order', 'saved_role_id', 'select', 'user_id']);
    expect(url.searchParams.get('select')?.split(',').sort()).toEqual([...roleRowFields].sort());
    expect(url.searchParams.get('user_id')).toBe(`eq.${expectedOwnerId}`);
    expect(url.searchParams.get('order')).toBe('sort_order.asc');
    const filter = url.searchParams.get('saved_role_id'); assert.ok(typeof filter === 'string' && filter.startsWith('eq.'));
    const actualRoleId = roleBrowserUuid(filter.slice(3));
    if (expectedRoleId !== null) expect(actualRoleId).toBe(expectedRoleId);
    if (saved) {
      expect(saved.status()).toBe(200); expect(await saved.json()).toBe(actualRoleId);
      expect(saved.request().postDataJSON()).toEqual({ p_role_title: title, p_company_name: employer,
        p_location: 'Melbourne', p_match_percentage: 90, p_job_url: null, p_source_label: null,
        p_contact_email: null, p_contact_source_status: 'needs_confirmation' });
      saveRequests.push({ ownerId: expectedOwnerId, roleId: actualRoleId });
    }
    const rows = roleBrowserRows(await response.json(), expectedOwnerId, actualRoleId); readCount += 1;
    await assertVisibleRows(target, rows);
    return { roleId: actualRoleId, rows };
  }
  async function toggle(target: Page, expectedToken: string, status: 'pending' | 'done') {
    const [response] = await Promise.all([
      target.waitForResponse(response => response.request().method() === 'POST' && response.url() === mutationPath),
      checkbox(target).click(),
    ]);
    expect(response.status()).toBe(200);
    const mutation = roleBrowserMutation(response.request().postDataJSON(), await response.json());
    expect(mutation.command).toEqual({ p_item_id: itemId, p_expected_mutation_token: expectedToken, p_status: status });
    if (status === 'done') await expect(checkbox(target)).toBeChecked();
    else await expect(checkbox(target)).not.toBeChecked();
    await expect(checkbox(target)).toBeEnabled();
    return mutation;
  }
  try {
    await restrict(context); await restrict(fresh);
    await controlSearch(page, 'primary'); await login(page, slot); await page.goto('/roles'); await searchRole(page);
    const initial = await openPlan(page, ownerId, null, true); roleId = initial.roleId; initialRows = initial.rows;
    expect(initialRows.every(row => row.status === 'pending')).toBe(true);
    const initialItem = initialRows.find(row => row.label === 'Review job requirements'); assert.ok(initialItem); itemId = initialItem.id;
    checks.push('owned_role_and_actions_opened');
    const other = await fresh.newPage(); await controlSearch(other, 'second'); await login(other, slot); await other.goto('/roles'); await searchRole(other);
    expect((await openPlan(other, ownerId, roleId, true)).rows).toEqual(initialRows);
    checks.push('same_owner_second_context_opened');
    await page.route(mutationPath, route => {
      const requestNumber = heldHandlers.length + 1;
      const task = (async () => {
        assert.equal(requestNumber, 1); assert.equal(route.request().method(), 'POST');
        const command: unknown = route.request().postDataJSON();
        expect(command).toEqual({ p_item_id: itemId, p_expected_mutation_token: initialItem.mutation_token, p_status: 'done' });
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
        try {
          expect(response.status()).toBe(200);
          mutations.held = roleBrowserMutation(command, await response.json());
          expect(mutations.held.command).toEqual({ p_item_id: itemId, p_expected_mutation_token: initialItem.mutation_token, p_status: 'done' });
          await acknowledgementGate;
          await route.fulfill({ response });
        } finally { await response.dispose(); }
      })();
      heldHandlers.push(task); return task;
    });
    await checkbox(page).click();
    await expect.poll(() => mutations.held !== null).toBe(true); assert.ok(mutations.held);
    await expect(checkbox(page)).toBeDisabled();
    checks.push('first_commit_acknowledgement_held');
    const committedRows = initialRows.map(row => row.id === itemId ? { ...row, ...mutations.held!.receipt.item } : row);
    expect((await openPlan(other, ownerId, roleId, false)).rows).toEqual(committedRows);
    mutations.newer = await toggle(other, mutations.held.receipt.item.mutation_token, 'pending');
    checks.push('second_context_newer_commit_observed');
    refreshedRows = (await openPlan(page, ownerId, roleId, false)).rows;
    expect(refreshedRows).toEqual(initialRows.map(row => row.id === itemId ? { ...row, ...mutations.newer!.receipt.item } : row));
    await expect(checkbox(page)).toBeDisabled();
    releaseAcknowledgement(); await Promise.all(heldHandlers); await page.unroute(mutationPath);
    await expect(checkbox(page)).toBeEnabled(); await assertVisibleRows(page, refreshedRows);
    checks.push('newer_read_preserved_after_stale_acknowledgement');
    mutations.next = await toggle(page, mutations.newer.receipt.item.mutation_token, 'done');
    checks.push('next_toggle_uses_newer_token');
    await page.reload(); await searchRole(page);
    finalRows = (await openPlan(page, ownerId, roleId, true)).rows;
    expect(finalRows).toEqual(initialRows.map(row => row.id === itemId ? { ...row, ...mutations.next!.receipt.item } : row));
    checks.push('reload_preserves_exact_role_and_actions');
    await page.screenshot({ path: info.outputPath('role-action.png'), fullPage: true });
    await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
    await login(page, 1 - slot); await page.goto('/roles'); await searchRole(page);
    const isolated = await openPlan(page, otherOwnerId, null, true); otherRoleId = isolated.roleId; otherRows = isolated.rows;
    expect(otherRoleId).not.toBe(roleId); expect(otherRows.every(row => row.status === 'pending')).toBe(true);
    expect(otherRows.every(row => !initialRows.some(original => original.id === row.id))).toBe(true);
    checks.push('other_owner_isolated');
    expect(jobMatchRequests).toEqual({ primary: 3, second: 1 }); expect(readCount).toBe(6);
    expect(saveRequests).toEqual([{ ownerId, roleId }, { ownerId, roleId }, { ownerId, roleId }, { ownerId: otherOwnerId, roleId: otherRoleId }]);
    expect(errors).toEqual([]); expect(external).toEqual([]); complete = true;
  } catch (error) { failure = safeError(error); throw error; }
  finally {
    releaseAcknowledgement();
    const cleanup = await Promise.allSettled([...heldHandlers, fresh.close()]);
    const cleanupFailure = cleanup.find(result => result.status === 'rejected');
    const cleanupIsPrimary = cleanupFailure?.status === 'rejected' && failure === null;
    if (cleanupIsPrimary && cleanupFailure?.status === 'rejected') { complete = false; failure = safeError(cleanupFailure.reason); }
    try {
      writeFileSync(info.outputPath('role-action-browser-checks.json'), JSON.stringify({ version: 'role-action-browser.1',
        project: info.project.name, ownerId, otherOwnerId, title, employer, complete, failure, roleId, itemId,
        initialRows, refreshedRows, finalRows, otherRoleId, otherRows, mutations, jobMatchRequests, saveRequests, readCount, checks, errors, external,
        scope: 'Real local Auth/PostgREST role actions and CAS with controlled job-match discovery; desktop/narrow reload, stale acknowledgement and owner isolation. No provider or hosted proof.' }, null, 2));
    } catch (error) { if (failure === null) throw error; console.error('Role action evidence could not be saved.'); }
    if (cleanupIsPrimary && cleanupFailure?.status === 'rejected') throw cleanupFailure.reason;
  }
});

test('real file chooser settles owned sources and reopens identical originals', async ({ page, context }, info) => {
  const errors: string[] = []; const external: string[] = [];
  const records: Array<{ name: string; uploadId: string; receipt: unknown; outcomeId: string | null;
    importReceipt?: unknown; editReceipt?: unknown; recoveryCopy?: unknown;
    failedSaveRequest?: unknown; recoveredSaveRequest?: unknown; stages: string[] }> = [];
  const profileStages: string[] = [];
  const profileReadFaultAttempts: number[] = [];
  let uploadRequests = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.origin === fixture.webOrigin && url.pathname === '/api/ingest-upload') uploadRequests += 1;
  });
  let complete = false; let failure: string | null = null;
  const persist = () => writeFileSync(info.outputPath('upload-browser-checks.json'), JSON.stringify({
    project: info.project.name, ownerId: fixture.users[info.project.name === 'desktop-chromium' ? 0 : 1]!.id,
    complete, failure, records, profileStages, profileReadFaultAttempts, errors, external,
    scope: 'New chooser uploads, retained text review, text section editing/save recovery and Profile details, real Auth/RPC/Storage and production entrypoints, provider calls prohibited; no hosted/live-model/resume-lifecycle/binary format-preserving editing/export proof.',
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
          const uploadsBeforeResume = uploadRequests;
          // A reload must recover review from the retained source, without a
          // second upload/provider request or a browser-only pending document.
          await page.goto(`/workspace?upload=${receipt.upload_id}`);
          await page.reload();
          await panel(page).getByRole('link', { name: 'Review text sections', exact: true }).click();
          await expect(page).toHaveURL(`${fixture.webOrigin}/workspace?upload=${receipt.upload_id}&review=text`);
          await page.reload();
          await expect(review).toBeVisible();
          expect(uploadRequests).toBe(uploadsBeforeResume);
          stage(record, 'retained_text_review_resumed_after_reload');
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
          await page.getByRole('dialog', { name: 'Quick tour', exact: true })
            .getByRole('button', { name: 'Skip tour', exact: true }).click({ timeout: 15000 });
          stage(record, 'first_visit_tour_dismissed');
          await page.reload();
          await expect(page.getByRole('article', { name: `Edit ${info.project.name}-${file.name.replace(/\.[^.]+$/, '')}`, exact: true })).toBeVisible();
          await expect(page.getByRole('textbox', { name: 'Edit Overview', exact: true })).toContainText('The owner checks this paragraph before saving.');
          await expect(page.getByRole('textbox', { name: 'Edit Overview', exact: true }).locator('p')).toHaveCount(2);
          const sectionSelect = page.getByRole('combobox', { name: 'Choose a section', exact: true });
          await expect(sectionSelect.locator('option').nth(1)).toHaveText('2. Next steps');
          await sectionSelect.selectOption({ index: 1 });
          await expect(page.getByRole('textbox', { name: 'Edit Next steps', exact: true })).toContainText('Reopen the saved document.');
          await expect(page.getByRole('textbox', { name: 'Edit Next steps', exact: true }).locator('p')).toHaveCount(2);
          stage(record, 'workspace_reloaded_and_both_sections_read');

          // First reject delivery before any DB commit. Recover the exact
          // browser wording after reload, then lose the committed acknowledgement.
          await sectionSelect.selectOption({ index: 0 });
          const overview = page.getByRole('textbox', { name: 'Edit Overview', exact: true });
          const edited = '<p>Updated This is synthetic wording for the upload acceptance test.</p><p>The owner checks this paragraph before saving.</p>';
          const savePath = `${fixture.supabaseOrigin}/rest/v1/rpc/save_own_legacy_workspace_v1`;
          let interruptedSaves = 0;
          await page.route(savePath, async route => {
            expect(route.request().method()).toBe('POST');
            const command = route.request().postDataJSON();
            expect(command.p_document_id).toBe(importReceipt.document_id);
            const changed = command.p_sections.filter((item: { content?: string }) => item.content !== undefined);
            expect(changed).toHaveLength(1); expect(changed[0].content).toBe(edited);
            interruptedSaves += 1;
            if (interruptedSaves === 1) {
              record.failedSaveRequest = command;
              stage(record, 'edit_delivery_failed_before_commit');
              await route.abort('failed');
              return;
            }
            expect(command).toEqual(record.failedSaveRequest);
            record.recoveredSaveRequest = command;
            stage(record, 'same_edit_request_restored_after_reload');
            const result = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
            expect(result.status()).toBe(200);
            const receipt = await result.json();
            expect(receipt.state).toBe('saved'); expect(receipt.idempotent_replay).toBe(false);
            expect(receipt.document_revision).toBe(command.p_expected_document_revision + 1);
            record.editReceipt = receipt; stage(record, 'edited_section_committed_ack_discarded');
            await route.abort('failed');
          }, { times: 2 });
          if (info.project.name === 'narrow-chromium') {
            await page.getByRole('button', { name: 'Open this section in the focused mobile editor', exact: true }).click({ timeout: 15000 });
            await expect(page.getByRole('button', { name: 'Close focused editor', exact: true })).toBeVisible();
            stage(record, 'focused_editor_opened');
          }
          await overview.click({ timeout: 15000 });
          // Select all then collapse left works on macOS and Linux; Meta+Home
          // on macOS does not reliably move to the start of this editable body.
          await overview.press('ControlOrMeta+a'); await overview.press('ArrowLeft');
          await page.keyboard.insertText('Updated ');
          await expect(overview.locator('p').first()).toHaveText('Updated This is synthetic wording for the upload acceptance test.');
          if (info.project.name === 'narrow-chromium') {
            await page.getByRole('button', { name: 'Close focused editor', exact: true }).click({ timeout: 15000 });
            stage(record, 'focused_editor_closed');
          }
          // Let the real debounced save run once; an explicit early save could
          // enqueue another save and hide the uncertain acknowledgement state.
          await page.getByRole('button', { name: /^Save problem:/ }).click({ timeout: 15000 });
          await expect(page.getByRole('button', { name: 'Try saving again', exact: true })).toBeVisible();
          await expect(page.getByText('PrompTED could not confirm that the latest changes are saved to your account. Keep this page open and try saving again.', { exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveCount(0);
          stage(record, 'save_uncertainty_visible');
          const recoveryCopy = await page.evaluate(({ ownerId, outcomeId }) => {
            const key = `prompted:cache:v3:${encodeURIComponent(`user:${ownerId}`)}:workspace:${encodeURIComponent(outcomeId)}`;
            const stored = sessionStorage.getItem(key);
            return stored === null ? null : JSON.parse(stored);
          }, { ownerId: fixture.users[slot]!.id, outcomeId: importReceipt.outcome_id });
          expect(recoveryCopy).toMatchObject({ version: 3, owner: `user:${fixture.users[slot]!.id}`, outcomeId: importReceipt.outcome_id,
            value: { documentId: importReceipt.document_id, sections: [
              expect.objectContaining({ content: edited, content_loaded: true }),
              expect.objectContaining({ content: '- Keep the original.\n\n- Reopen the saved document.', content_loaded: true }),
            ] } });
          record.recoveryCopy = recoveryCopy;
          stage(record, 'complete_browser_recovery_copy_read_during_uncertainty');

          await page.reload();
          const recoveryReview = page.getByRole('dialog', { name: 'Review wording kept in this browser', exact: true });
          await expect(recoveryReview).toBeVisible();
          expect(await recoveryReview.evaluate(element => element.matches(':modal'))).toBe(true);
          const bounds = await recoveryReview.boundingBox(); const viewport = page.viewportSize();
          assert.ok(bounds && viewport); expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
          await expect(recoveryReview.getByText('Updated This is synthetic wording for the upload acceptance test.', { exact: true })).toBeVisible();
          await expect(recoveryReview.getByRole('heading')).toBeFocused();
          await page.screenshot({ path: info.outputPath('browser-copy-recovery-review.png') });
          stage(record, 'browser_copy_review_visible_in_foreground_after_reload');
          // Escape cancels observation only. It neither restores nor discards.
          await page.keyboard.press('Escape');
          await expect(recoveryReview).toHaveCount(0);
          await expect(overview.locator('p').first()).toHaveText('This is synthetic wording for the upload acceptance test.');
          expect(interruptedSaves).toBe(1);
          await page.getByRole('button', { name: 'Review browser copy', exact: true }).click();
          await expect(recoveryReview).toBeVisible();
          await recoveryReview.getByRole('button', { name: 'Restore to editor', exact: true }).click();
          await expect(recoveryReview).toHaveCount(0);
          await expect(overview.locator('p').first()).toHaveText('Updated This is synthetic wording for the upload acceptance test.');
          await page.getByRole('button', { name: /^Save problem:/ }).click({ timeout: 15000 });
          await expect(page.getByText('PrompTED could not confirm that the latest changes are saved to your account. Keep this page open and try saving again.', { exact: true })).toBeVisible();
          expect(interruptedSaves).toBe(2); expect(record.editReceipt).toBeTruthy();
          stage(record, 'restored_wording_saved_with_acknowledgement_uncertainty');
          const replayedSave = page.waitForResponse(response => response.url() === savePath && response.request().method() === 'POST');
          await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
          const replayResponse = await replayedSave; expect(replayResponse.status()).toBe(200);
          expect(await replayResponse.json()).toEqual({ ...(record.editReceipt as object), idempotent_replay: true });
          await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
          stage(record, 'same_edit_receipt_recovered');
          await page.reload();
          await expect(overview.locator('p')).toHaveCount(2);
          await expect(overview.locator('p').first()).toHaveText('Updated This is synthetic wording for the upload acceptance test.');
          await expect(overview.locator('p').nth(1)).toHaveText('The owner checks this paragraph before saving.');
          await sectionSelect.selectOption({ index: 1 });
          const sibling = page.getByRole('textbox', { name: 'Edit Next steps', exact: true });
          await expect(sibling.locator('p')).toHaveText(['- Keep the original.', '- Reopen the saved document.']);
          stage(record, 'edited_paragraphs_reloaded_sibling_unchanged');
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

// Selected only by the runner's second browser phase, after all six original
// cases and their independent proofs finish on the original subscription state.
test(accountPlanTestName, async ({ page, context }, info) => {
  test.setTimeout(120_000);
  const slot = info.project.name === 'desktop-chromium' ? 0 : 1;
  const statuses = ['expired', 'cancelled'] as const;
  const periodEnds = ['2020-01-15T12:00:00+00:00', '2020-02-15T12:00:00+00:00'] as const;
  const checks: string[] = []; const errors: string[] = []; const external: string[] = [];
  const forbiddenDispatches: Array<{ method: string; path: string }> = [];
  const observations: Array<{ stage: string; ownerId: string; access: unknown;
    usage: { method: string; status: number; ownerId: string; eventType: string; monthStart: string; contentRange: string } }> = [];
  let complete = false; let failure: string | null = null;
  const safeError = (error: unknown) => fixture.users.reduce((value, user) => value.replaceAll(user.password, '[local credential redacted]'),
    error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[local JWT redacted]');
  const watch = (target: Page) => target.on('pageerror', error => errors.push(safeError(error)));
  watch(page); context.on('page', watch);
  const accessPath = `${fixture.supabaseOrigin}/rest/v1/rpc/get_effective_product_access_v1`;
  const readRpcPaths = ['/rest/v1/rpc/get_effective_product_access_v1', '/rest/v1/rpc/list_own_workspace_uploads_v1'];
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    if (![fixture.webOrigin, fixture.supabaseOrigin].includes(url.origin)) {
      external.push(url.origin + url.pathname); await route.abort('blockedbyclient'); return;
    }
    const dataMutation = url.origin === fixture.supabaseOrigin && url.pathname.startsWith('/rest/v1/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(method) && !(method === 'POST' && readRpcPaths.includes(url.pathname));
    if (dataMutation || url.pathname.startsWith('/functions/v1/') ||
      (url.origin === fixture.webOrigin && url.pathname.startsWith('/api/'))) {
      forbiddenDispatches.push({ method, path: url.origin + url.pathname });
      await route.abort('blockedbyclient'); return;
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { external.push(new URL(socket.url()).origin); socket.close(); });
  const subscription = page.getByRole('region', { name: 'Subscription plan', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Upgrade your plan', exact: true });
  const monthStartNow = () => {
    const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  };
  async function openAccount(stage: string, ownerSlot: number, navigate: () => Promise<unknown>) {
    const owner = fixture.users[ownerSlot]; assert.ok(owner);
    const firstMonthStart = monthStartNow();
    const accessResponse = page.waitForResponse(response => response.url() === accessPath && response.request().method() === 'POST');
    const usageResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === fixture.supabaseOrigin && url.pathname === '/rest/v1/usage_ledger' &&
        response.request().method() === 'HEAD' && url.searchParams.get('user_id') === `eq.${owner.id}`;
    });
    const [accessRead, usageRead] = await Promise.all([accessResponse, usageResponse, navigate()]);
    expect(accessRead.status()).toBe(200); expect(accessRead.request().postDataJSON()).toEqual({});
    const access: unknown = await accessRead.json();
    expect(access).toEqual({ contract_version: 'product-access.1', user_id: owner.id,
      subscription_plan: 'business', effective_plan: 'free', subscription_status: statuses[ownerSlot],
      current_period_end: periodEnds[ownerSlot], access_profile: 'subscription', monthly_document_cap: 3,
      ai_editing: false, business_features: false });
    expect(usageRead.status()).toBe(200);
    const usageUrl = new URL(usageRead.url());
    expect([...usageUrl.searchParams.keys()].sort()).toEqual(['created_at', 'event_type', 'select', 'user_id']);
    expect(usageUrl.searchParams.get('select')).toBe('id');
    expect(usageUrl.searchParams.get('event_type')).toBe('eq.document_created');
    const monthStart = usageUrl.searchParams.get('created_at')?.replace(/^gte\./, ''); assert.ok(monthStart);
    expect([firstMonthStart, monthStartNow()]).toContain(monthStart);
    const contentRange = usageRead.headers()['content-range']; assert.ok(typeof contentRange === 'string');
    expect(contentRange).toBe('*/0');
    await expect(page).toHaveURL(`${fixture.webOrigin}/settings/account`);
    await expect(page.getByRole('main').getByText(owner.email, { exact: true })).toBeVisible();
    await expect(subscription.getByRole('heading', { name: 'Business', exact: true })).toBeVisible();
    await expect(subscription.getByRole('list', { name: 'Free plan features', exact: true })).toContainText('3 documents per month');
    await expect(subscription.getByRole('list', { name: 'Business plan features', exact: true })).toHaveCount(0);
    await expect(subscription.getByLabel('Document usage this month', { exact: true })).toContainText('0 / 3');
    await expect(subscription.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    const periodEnd = periodEnds[ownerSlot]; assert.ok(periodEnd);
    const periodLabel = await page.evaluate(value => new Date(value).toLocaleDateString(undefined,
      { day: 'numeric', month: 'long', year: 'numeric' }), periodEnd);
    await expect(subscription.getByText(`Subscription period end: ${periodLabel}.`, { exact: true })).toBeVisible();
    await expect(subscription.getByRole('button', { name: 'Upgrade', exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    observations.push({ stage, ownerId: owner.id, access,
      usage: { method: 'HEAD', status: usageRead.status(), ownerId: owner.id, eventType: 'document_created', monthStart,
        contentRange } });
  }
  async function comparePlans() {
    await subscription.getByRole('button', { name: 'Upgrade', exact: true }).click();
    await expect(dialog).toBeVisible();
    for (const name of ['Pro', 'Premium', 'Business']) {
      await expect(dialog.getByRole('button', { name: `Select ${name} plan`, exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: /^Select .+ plan$/ })).toHaveCount(3);
    await expect(dialog.getByText(/reached.*limit|upgrade to keep going/i)).toHaveCount(0);
    await expect(dialog.getByText('Compare plans to find the features and monthly document allowance you need.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('note')).toContainText("Online checkout isn't available yet on the web.");
    await expect(dialog.getByRole('note')).toContainText('selecting one does not send an upgrade request or change your current plan.');
  }
  try {
    await login(page, slot);
    await openAccount('initial', slot, () => page.goto('/settings/account'));
    checks.push('real_owned_access_and_usage_observed');
    await comparePlans();
    await page.screenshot({ path: info.outputPath('account-plan-comparison.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0); checks.push('historical_business_compares_all_paid_plans');
    await openAccount('reload', slot, () => page.reload());
    checks.push('reload_preserves_effective_free_and_billing_history');
    await comparePlans(); await dialog.getByRole('button', { name: 'Select Business plan', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText:
      "Online checkout isn't available yet. No upgrade request was sent, and your plan is unchanged." })).toBeVisible();
    await expect(subscription.getByRole('heading', { name: 'Business', exact: true })).toBeVisible();
    await expect(subscription.getByRole('list', { name: 'Free plan features', exact: true })).toContainText('3 documents per month');
    checks.push('selection_reports_unavailable_without_upgrade');
    await openAccount('after_selection_reload', slot, () => page.reload());
    checks.push('selection_reload_preserves_saved_access');
    await comparePlans();
    await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
    await expect(dialog).toHaveCount(0);
    await login(page, 1 - slot);
    await openAccount('other_owner', 1 - slot, () => page.goto('/settings/account'));
    await expect(page.getByRole('main').getByText(fixture.users[slot]!.email, { exact: true })).toHaveCount(0);
    await comparePlans(); await dialog.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(dialog).toHaveCount(0); checks.push('real_owner_switch_retires_modal_and_uses_other_access');
    await page.goto('/sign-out'); await expect(page).toHaveURL(`${fixture.webOrigin}/home`);
    await login(page, slot);
    await openAccount('original_owner_return', slot, () => page.goto('/settings/account'));
    checks.push('returning_owner_reads_own_saved_access');
    await page.screenshot({ path: info.outputPath('account-plan-history-and-access.png'), fullPage: true });
    expect(errors).toEqual([]); expect(external).toEqual([]); expect(forbiddenDispatches).toEqual([]);
    checks.push('no_billing_mutation_or_provider_dispatch'); complete = true;
  } catch (error) { failure = safeError(error); throw error; }
  finally {
    try {
      writeFileSync(info.outputPath('account-plan-browser-checks.json'), JSON.stringify({ version: 'account-plan-browser.1',
        project: info.project.name, ownerId: fixture.users[slot]!.id, otherOwnerId: fixture.users[1 - slot]!.id,
        complete, failure, observations, checks, errors, external, forbiddenDispatches,
        scope: 'Real local Auth, effective-access RPC, usage read and Account UI with historical subscription fixtures; comparison, reload and real owner navigation. No purchase, webhook delivery, same-render principal race or hosted proof.' }, null, 2));
    } catch (error) { if (failure === null) throw error; console.error('Account plan evidence could not be saved.'); }
  }
});

// The third phase reuses an independently verified imported-document outcome.
// Only generation HTTP responses are controlled; Auth and saved reads stay real.
test(generationLimitTestName, async ({ page, context }, info) => {
  const slot = info.project.name === 'desktop-chromium' ? 0 : 1;
  const owner = fixture.users[slot]; assert.ok(owner);
  const ownerId = owner.id;
  const imported = fixture.files.filter(file => file.importText); assert.equal(imported.length, 1);
  const importedFile = imported[0]; assert.ok(importedFile);
  const title = `${info.project.name}-${importedFile.name.replace(/\.[^.]+$/, '')}`;
  const stages = ['lower_plan', 'artifact_null', 'legacy_null', 'business', 'business_reload',
    'non_billing', 'non_billing_retry'] as const;
  type Stage = typeof stages[number];
  const scope = 'Controlled generation HTTP responses in the real local checklist UI with real Auth and owned saved reads; reload, safe Retry and unchanged document wording. No actual quota admission, provider dispatch, WorkspaceScreen limit UI or hosted proof.';
  const checks: string[] = []; const errors: string[] = []; const external: string[] = [];
  const forbiddenDispatches: Array<{ method: string; path: string }> = [];
  const requests: Array<{ stage: Stage; path: string; status: number; requestId: string; bodySha256: string }> = [];
  const observations: Array<{ stage: Stage; ownerId: string; outcomeId: string;
    artifactAbsent: true; checklistCount: 0; heading: string | null; accountReview: boolean; retry: boolean }> = [];
  let activeStage: Stage | null = null; let outcomeId = ''; let complete = false; let failure: string | null = null;
  const safeError = (error: unknown) => fixture.users.reduce((value, user) => value.replaceAll(user.password, '[local credential redacted]'),
    error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[local JWT redacted]').slice(0, 2048);
  const readRpcPaths = ['/rest/v1/rpc/get_effective_product_access_v1', '/rest/v1/rpc/list_own_workspace_uploads_v1',
    '/rest/v1/rpc/get_own_manual_plan_v1', '/rest/v1/rpc/get_workspace_snapshot_v1',
    '/rest/v1/rpc/get_workspace_section_body_v1', '/rest/v1/rpc/get_latest_legacy_section_edit'];
  const watch = (target: Page) => target.on('pageerror', error => errors.push(safeError(error)));
  watch(page); context.on('page', watch);
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    if (![fixture.webOrigin, fixture.supabaseOrigin].includes(url.origin)) {
      external.push(url.origin + url.pathname); await route.abort('blockedbyclient'); return;
    }
    if (url.origin === fixture.webOrigin && ['/api/generate-artifact', '/api/generate-checklist'].includes(url.pathname) && activeStage) {
      try {
        assert.equal(method, 'POST'); assert.equal(url.search, ''); assert.ok(outcomeId);
        const stage = activeStage; const raw = request.postData(); assert.ok(raw && raw.length <= 128 * 1024);
        const body: unknown = request.postDataJSON(); assert.ok(body && typeof body === 'object' && !Array.isArray(body));
        const input = body as Record<string, unknown>; const requestId = input.generation_request_id;
        assert.equal(typeof requestId, 'string'); assert.match(requestId as string, /^gen-[0-9a-f]{64}$/);
        assert.equal(request.headers()['x-idempotency-key'], requestId);
        assert.equal(request.headers()['x-request-id'], requestId);
        assert.ok(typeof input.situation === 'string' && input.situation.length > 0);
        let status = 402; let responseBody: unknown = null;
        if (url.pathname === '/api/generate-artifact') {
          assert.equal(input.outcome_id, outcomeId); assert.equal(input.request_id, requestId);
          assert.ok(input.kind === 'checklist' || input.kind === 'action_plan');
          assert.ok(Object.keys(input).every(key => ['request_id', 'outcome_id', 'kind', 'template_id', 'situation',
            'conversation_context', 'upload_context', 'locale', 'timezone', 'generation_request_id'].includes(key)));
          if (stage === 'lower_plan') responseBody = { error: { code: 'PAYWALL', message: 'CONTROLLED_LIMIT_DIAGNOSTIC',
            paywall_trigger: true, current_plan: 'free', plan_required: 'pro' } };
          else if (stage === 'legacy_null') {
            status = 404; responseBody = { error: { code: 'TED_V2_DISABLED', message: 'CONTROLLED_LIMIT_DIAGNOSTIC' } };
          } else if (stage === 'business' || stage === 'business_reload') {
            responseBody = { error: { code: 'DOCUMENT_LIMIT_REACHED', message: 'CONTROLLED_LIMIT_DIAGNOSTIC',
              paywall_trigger: false, current_plan: 'business' } };
          } else if (stage === 'non_billing' || stage === 'non_billing_retry') {
            status = 502; responseBody = { error: { code: 'SYNTHETIC_NON_BILLING_FAILURE', message: 'CONTROLLED_LIMIT_DIAGNOSTIC' } };
          } else assert.equal(stage, 'artifact_null');
        } else {
          assert.equal(stage, 'legacy_null');
          assert.deepEqual(Object.keys(input).sort(), ['generation_request_id', 'situation']);
          assert.equal(requests.filter(row => row.stage === stage && row.path === '/api/generate-artifact' && row.status === 404).length, 1);
        }
        assert.equal(requests.filter(row => row.stage === stage && row.path === url.pathname).length, 0,
          'An unexpected automatic generation retry was attempted');
        requests.push({ stage, path: url.pathname, status, requestId: requestId as string,
          bodySha256: createHash('sha256').update(raw).digest('hex') });
        assert.ok(requests.length <= 8);
        // Never forward either controlled generation request to Next, Edge or a provider.
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(responseBody) });
      } catch (error) {
        errors.push(safeError(error)); await route.abort('blockedbyclient');
      }
      return;
    }
    const dataMutation = url.origin === fixture.supabaseOrigin && url.pathname.startsWith('/rest/v1/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(method) && !(method === 'POST' && readRpcPaths.includes(url.pathname));
    if (dataMutation || url.pathname.startsWith('/functions/v1/') ||
      (url.origin === fixture.webOrigin && url.pathname.startsWith('/api/'))) {
      forbiddenDispatches.push({ method, path: url.origin + url.pathname });
      await route.abort('blockedbyclient'); return;
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { external.push(new URL(socket.url()).origin); socket.close(); });
  const alert = page.getByRole('alert');
  async function observe(stage: Stage, navigate: () => Promise<unknown>) {
    activeStage = stage;
    const read = (path: string, method: string, key: string) => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === fixture.supabaseOrigin && url.pathname === path && response.request().method() === method &&
        url.searchParams.get(key) === `eq.${outcomeId}`;
    });
    const [outcomeRead, artifactRead, countRead] = await Promise.all([
      read('/rest/v1/outcomes', 'GET', 'id'), read('/rest/v1/ted_artifacts', 'GET', 'outcome_id'),
      read('/rest/v1/checklist_items', 'HEAD', 'outcome_id'), navigate(),
    ]);
    for (const response of [outcomeRead, artifactRead, countRead]) expect(response.status()).toBe(200);
    const outcomeBody: unknown = await outcomeRead.json();
    if (Array.isArray(outcomeBody)) expect(outcomeBody).toHaveLength(1);
    // maybeSingle adapts a one-row JSON array to an object in the browser SDK.
    const outcome: unknown = Array.isArray(outcomeBody) ? outcomeBody[0] : outcomeBody;
    assert.ok(outcome && typeof outcome === 'object' && !Array.isArray(outcome));
    expect((outcome as Record<string, unknown>).id).toBe(outcomeId);
    expect((outcome as Record<string, unknown>).user_id).toBe(ownerId);
    const artifact: unknown = await artifactRead.json();
    expect(artifact === null || (Array.isArray(artifact) && artifact.length === 0)).toBe(true);
    expect(countRead.headers()['content-range']).toBe('*/0');
    const retry = stage === 'non_billing' || stage === 'non_billing_retry';
    const accountReview = stage === 'lower_plan';
    const heading = retry ? null : stage === 'artifact_null' || stage === 'legacy_null'
      ? 'Document generation paused' : 'Monthly document limit reached';
    await expect(alert).toBeVisible();
    if (heading) await expect(alert.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    else await expect(alert.getByRole('heading')).toHaveCount(0);
    const reason = retry ? "TED couldn't load this plan safely. Your earlier information is still safe."
      : heading === 'Document generation paused'
        ? 'PrompTED could not confirm the document limit details. New generation is paused. You can still edit your existing wording.'
        : "You've reached your document limit for this month. New allowance becomes available next month.";
    await expect(alert.getByText(reason, { exact: true })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(retry ? 1 : 0);
    await expect(alert.getByRole('link', { name: 'Review plan and allowance', exact: true })).toHaveCount(accountReview ? 1 : 0);
    if (accountReview) await expect(alert.getByRole('link', { name: 'Review plan and allowance', exact: true })).toHaveAttribute('href', '/settings/account');
    await expect(alert).not.toContainText('CONTROLLED_LIMIT_DIAGNOSTIC');
    expect(requests.filter(row => row.stage === stage).map(row => ({ path: row.path, status: row.status }))).toEqual(
      stage === 'legacy_null' ? [{ path: '/api/generate-artifact', status: 404 }, { path: '/api/generate-checklist', status: 402 }]
        : [{ path: '/api/generate-artifact', status: retry ? 502 : 402 }]);
    observations.push({ stage, ownerId, outcomeId, artifactAbsent: true, checklistCount: 0,
      heading, accountReview, retry });
  }
  try {
    await login(page, slot); await page.goto('/library');
    const saved = page.getByRole('link', { name: `Open ${title}`, exact: true }); await expect(saved).toBeVisible();
    const href = await saved.getAttribute('href'); assert.ok(href); assert.match(href, /^\/outcomes\/[0-9a-f-]{36}$/);
    outcomeId = roleBrowserUuid(href.slice('/outcomes/'.length)); checks.push('real_owned_import_selected');
    const checklistPath = `${href}/checklist`;
    await observe('lower_plan', () => page.goto(checklistPath)); checks.push('confirmed_lower_plan_review_without_retry');
    await observe('artifact_null', () => page.reload()); checks.push('artifact_null_402_safe_hold');
    await page.screenshot({ path: info.outputPath('generation-limit-paused.png'), fullPage: true });
    await observe('legacy_null', () => page.reload()); checks.push('explicit_disabled_then_legacy_null_402_safe_hold');
    await observe('business', () => page.reload()); checks.push('business_limit_without_upgrade_or_retry');
    await observe('business_reload', () => page.reload());
    const business = requests.find(row => row.stage === 'business'); const reloaded = requests.find(row => row.stage === 'business_reload');
    assert.ok(business && reloaded); expect(reloaded.requestId).toBe(business.requestId); expect(reloaded.bodySha256).toBe(business.bodySha256);
    checks.push('reload_preserves_limit_and_exact_request');
    await observe('non_billing', () => page.reload());
    await observe('non_billing_retry', () => alert.getByRole('button', { name: 'Retry', exact: true }).click());
    const nonBilling = requests.find(row => row.stage === 'non_billing'); const retried = requests.find(row => row.stage === 'non_billing_retry');
    assert.ok(nonBilling && retried); expect(retried.requestId).toBe(nonBilling.requestId); expect(retried.bodySha256).toBe(nonBilling.bodySha256);
    checks.push('non_billing_retry_retains_exact_request'); activeStage = null;
    await page.goto(href);
    const tour = page.getByRole('dialog', { name: 'Quick tour', exact: true });
    // This fresh browser context has not dismissed the real first-visit tour.
    await expect(tour).toBeVisible(); await tour.getByRole('button', { name: 'Skip tour', exact: true }).click();
    await expect(page.getByRole('article', { name: `Edit ${title}`, exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Edit Overview', exact: true })).toContainText('Updated This is synthetic wording for the upload acceptance test.');
    await expect(page.getByRole('textbox', { name: 'Edit Overview', exact: true })).toContainText('The owner checks this paragraph before saving.');
    await page.getByRole('combobox', { name: 'Choose a section', exact: true }).selectOption({ index: 1 });
    await expect(page.getByRole('textbox', { name: 'Edit Next steps', exact: true })).toContainText('Reopen the saved document.');
    checks.push('saved_edited_and_sibling_wording_reopened');
    expect(observations.map(row => row.stage)).toEqual(stages);
    expect(requests.filter(row => row.path === '/api/generate-artifact')).toHaveLength(7);
    expect(requests.filter(row => row.path === '/api/generate-checklist')).toHaveLength(1);
    expect(errors).toEqual([]); expect(external).toEqual([]); expect(forbiddenDispatches).toEqual([]);
    checks.push('no_uncontrolled_generation_or_data_mutation'); complete = true;
  } catch (error) { failure = safeError(error); throw error; }
  finally {
    try {
      writeFileSync(info.outputPath('generation-limit-browser-checks.json'), JSON.stringify({ version: 'generation-limit-browser.1',
        project: info.project.name, ownerId: owner.id, outcomeId, title, complete, failure, observations, requests,
        checks, errors, external, forbiddenDispatches, scope }, null, 2));
    } catch (error) { if (failure === null) throw error; console.error('Generation limit evidence could not be saved.'); }
  }
});
