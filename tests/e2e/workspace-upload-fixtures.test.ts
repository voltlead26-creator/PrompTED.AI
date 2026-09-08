import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadUploadBrowserFixture, type UploadBrowserFixture } from './workspace-upload-fixtures.ts';

function fixtureCase(exercise: (value: UploadBrowserFixture, path: string, save: () => void) => void) {
  const project = `prompted-db-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
  const workdir = realpathSync(mkdtempSync(join(tmpdir(), `${project}-`)));
  const evidence = resolve('docs/evidence/web-operational-readiness', `db-${project.slice(12)}`);
  mkdirSync(evidence); const outputDir = join(evidence, 'upload-browser'); mkdirSync(outputDir);
  mkdirSync(join(workdir, 'upload-inputs')); const path = join(workdir, 'workspace-upload-browser-fixture.json');
  const previous = process.env.PROMPTED_UPLOAD_E2E_FIXTURE;
  const value: UploadBrowserFixture = { version: 'workspace-upload-browser.1', project,
    webOrigin: 'http://127.0.0.1:58323', supabaseOrigin: 'http://127.0.0.1:58324', outputDir,
    users: ['a', 'b'].map(slot => ({ id: randomUUID(), email: `${slot}@example.invalid`, password: `synthetic-${slot}-`.repeat(3) })),
    files: Array.from({ length: 5 }, (_, i) => {
      const name = `Source ${i}.txt`; const filePath = join(workdir, 'upload-inputs', name); const bytes = Buffer.from(`Synthetic ${i}`);
      writeFileSync(filePath, bytes);
      return { name, mime: 'text/plain', text: bytes.toString(), format: 'text', path: filePath,
        byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), importText: false };
    }) };
  const save = () => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  try {
    writeFileSync(join(workdir, 'run-owner.txt'), project);
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify({ project, workdir }));
    save(); process.env.PROMPTED_UPLOAD_E2E_FIXTURE = path; exercise(value, path, save);
  } finally {
    if (previous === undefined) delete process.env.PROMPTED_UPLOAD_E2E_FIXTURE; else process.env.PROMPTED_UPLOAD_E2E_FIXTURE = previous;
    rmSync(workdir, { recursive: true }); rmSync(evidence, { recursive: true });
  }
}
test('new-upload fixture accepts private run paths and survives Playwright output cleanup', () => fixtureCase(value => {
  assert.deepEqual(loadUploadBrowserFixture(), value); rmSync(value.outputDir, { recursive: true });
  assert.deepEqual(loadUploadBrowserFixture(), value);
}));
for (const [name, mutate] of [
  ['hosted URL', (v: UploadBrowserFixture) => { v.supabaseOrigin = 'https://example.supabase.co'; }],
  ['foreign output', (v: UploadBrowserFixture) => { v.outputDir = '/tmp'; }],
  ['foreign input', (v: UploadBrowserFixture) => { v.files[0]!.path = '/etc/hosts'; }],
  ['filename traversal', (v: UploadBrowserFixture) => { v.files[0]!.name = '../Source.txt'; }],
  ['digest mismatch', (v: UploadBrowserFixture) => { v.files[0]!.sha256 = '0'.repeat(64); }],
  ['size mismatch', (v: UploadBrowserFixture) => { v.files[0]!.byteLength++; }],
  ['duplicate owner', (v: UploadBrowserFixture) => { v.users[1] = v.users[0]!; }],
  ['extra field', (v: UploadBrowserFixture) => { Object.assign(v, { serviceKey: 'must-not-enter-browser' }); }],
] as const) test(`new-upload fixture rejects ${name}`, () => fixtureCase((value, _path, save) => {
  mutate(value); save(); assert.throws(() => loadUploadBrowserFixture());
}));
test('new-upload fixture rejects non-private credentials', () => fixtureCase((_value, path) => {
  chmodSync(path, 0o644); assert.throws(() => loadUploadBrowserFixture());
}));
test('new-upload fixture rejects linked input', () => fixtureCase((value, path) => {
  rmSync(value.files[0]!.path); symlinkSync(path, value.files[0]!.path); assert.throws(() => loadUploadBrowserFixture());
}));
test('new-upload fixture rejects linked output', () => fixtureCase(value => {
  rmSync(value.outputDir, { recursive: true }); symlinkSync(tmpdir(), value.outputDir); assert.throws(() => loadUploadBrowserFixture());
}));
