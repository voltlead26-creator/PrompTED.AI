import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadWorkspaceFixture, type WorkspaceBrowserFixture } from './workspace-fixtures.ts';

function fixtureCase(exercise: (value: WorkspaceBrowserFixture, path: string, save: () => void) => void) {
  const project = `prompted-db-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
  const workdir = realpathSync(mkdtempSync(join(tmpdir(), `${project}-`)));
  const evidence = resolve('docs/evidence/web-operational-readiness', `db-${project.slice('prompted-db-'.length)}`);
  mkdirSync(evidence); const outputDir = join(evidence, 'browser'); mkdirSync(outputDir);
  const originalDir = join(workdir, 'browser-originals'); mkdirSync(originalDir);
  const path = join(workdir, 'workspace-browser-fixture.json');
  const previous = process.env.PROMPTED_E2E_FIXTURE;
  const ownerA = randomUUID(); const ownerB = randomUUID();
  const value: WorkspaceBrowserFixture = { version: 'workspace-browser.1', project,
    webOrigin: 'http://127.0.0.1:58323', supabaseOrigin: 'http://127.0.0.1:58321', outputDir,
    users: [{ id: ownerA, email: 'a@example.invalid', password: 'synthetic-a-'.repeat(3) },
      { id: ownerB, email: 'b@example.invalid', password: 'synthetic-b-'.repeat(3) }],
    rows: Array.from({ length: 10 }, (_, index) => {
      const id = randomUUID(); const originalPath = join(originalDir, id); const bytes = Buffer.from(`Synthetic ${index}`);
      writeFileSync(originalPath, bytes, { mode: 0o600 });
      return { id, ownerId: index === 9 ? ownerB : ownerA, name: `Original ${index}.txt`, text: bytes.toString(),
        originalPath, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), retained: true, imported: null };
    }) };
  const save = () => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  try {
    writeFileSync(join(workdir, 'run-owner.txt'), project);
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify({ project, workdir }));
    save(); process.env.PROMPTED_E2E_FIXTURE = path; exercise(value, path, save);
  } finally {
    if (previous === undefined) delete process.env.PROMPTED_E2E_FIXTURE;
    else process.env.PROMPTED_E2E_FIXTURE = previous;
    rmSync(workdir, { recursive: true }); rmSync(evidence, { recursive: true });
  }
}
test('fixture admission accepts exact private run paths and independently checked bytes', () => fixtureCase(value => {
  assert.deepEqual(loadWorkspaceFixture(), value);
}));
test('fixture admission survives Playwright clearing its exact output directory between config and test loading', () => fixtureCase(value => {
  assert.deepEqual(loadWorkspaceFixture(), value);
  rmSync(value.outputDir, { recursive: true });
  assert.deepEqual(loadWorkspaceFixture(), value);
}));
for (const [name, mutate] of [
  ['hosted URL', (value: WorkspaceBrowserFixture) => { value.supabaseOrigin = 'https://example.supabase.co'; }],
  ['foreign output directory', (value: WorkspaceBrowserFixture) => { value.outputDir = '/tmp'; }],
  ['foreign original file', (value: WorkspaceBrowserFixture) => { value.rows[0]!.originalPath = '/etc/hosts'; }],
  ['traversal filename', (value: WorkspaceBrowserFixture) => { value.rows[0]!.name = '../../file.txt'; }],
  ['unowned row', (value: WorkspaceBrowserFixture) => { value.rows[0]!.ownerId = randomUUID(); }],
  ['changed bytes digest', (value: WorkspaceBrowserFixture) => { value.rows[0]!.sha256 = '0'.repeat(64); }],
  ['changed byte length', (value: WorkspaceBrowserFixture) => { value.rows[0]!.byteLength++; }],
  ['unknown row field', (value: WorkspaceBrowserFixture) => { Object.assign(value.rows[0]!, { url: 'https://example.com' }); }],
] as const) test(`fixture admission rejects ${name} before browser/filesystem use`, () => fixtureCase((value, _path, save) => {
  mutate(value); save(); assert.throws(() => loadWorkspaceFixture());
}));
test('fixture admission rejects world-readable credentials', () => fixtureCase((_value, path) => {
  chmodSync(path, 0o644); assert.throws(() => loadWorkspaceFixture(), /must be private/);
}));
test('fixture admission rejects oversized data before parsing', () => fixtureCase((_value, path) => {
  writeFileSync(path, ' '.repeat(1024 * 1024 + 1)); assert.throws(() => loadWorkspaceFixture(), /exceeds its bound/);
}));
test('fixture admission rejects a symlinked original', () => fixtureCase((value, path) => {
  rmSync(value.rows[0]!.originalPath); symlinkSync(path, value.rows[0]!.originalPath);
  assert.throws(() => loadWorkspaceFixture());
}));
test('fixture admission rejects an existing symlinked output directory after Playwright cleanup', () => fixtureCase(value => {
  rmSync(value.outputDir, { recursive: true }); symlinkSync(tmpdir(), value.outputDir);
  assert.throws(() => loadWorkspaceFixture());
}));
test('fixture admission rejects an existing output file after Playwright cleanup', () => fixtureCase(value => {
  rmSync(value.outputDir, { recursive: true }); writeFileSync(value.outputDir, 'not a directory');
  assert.throws(() => loadWorkspaceFixture());
}));
