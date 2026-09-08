import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

type FixtureUser = { id: string; email: string; password: string };
export type WorkspaceBrowserFixture = {
  version: 'workspace-browser.1'; project: string; webOrigin: string; supabaseOrigin: string; outputDir: string;
  users: [FixtureUser, FixtureUser];
  rows: Array<{ id: string; ownerId: string; name: string; text: string; originalPath: string;
    sha256: string; byteLength: number; retained: boolean; imported: { document_id: string; outcome_id: string } | null }>;
};

// An ordinary bare `playwright test` must never fall back to an operator URL or
// production fixture. This private file is made only by the disposable runner.
export function loadWorkspaceFixture(): WorkspaceBrowserFixture {
  const path = process.env.PROMPTED_E2E_FIXTURE;
  assert.ok(path, 'Run the isolated workspace browser acceptance harness first');
  assert.equal(basename(path), 'workspace-browser-fixture.json');
  assert.ok(lstatSync(path).isFile());
  assert.ok(lstatSync(path).size > 0 && lstatSync(path).size <= 1024 * 1024, 'Browser fixture exceeds its bound');
  assert.equal(lstatSync(path).mode & 0o077, 0, 'Browser fixture credentials must be private');
  const value = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceBrowserFixture;
  const keys = (object: object, expected: string[]) => assert.deepEqual(Object.keys(object).sort(), expected.sort());
  const uuid = (id: string) => assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  keys(value, ['version', 'project', 'webOrigin', 'supabaseOrigin', 'outputDir', 'users', 'rows']);
  assert.equal(value.version, 'workspace-browser.1');
  assert.match(value.project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.equal(realpathSync(dirname(path)), dirname(path));
  assert.match(basename(dirname(path)), new RegExp(`^${value.project}-[A-Za-z0-9]{6}$`));
  assert.equal(readFileSync(join(dirname(path), 'run-owner.txt'), 'utf8'), value.project);
  assert.equal(value.webOrigin, 'http://127.0.0.1:58323');
  assert.equal(value.supabaseOrigin, 'http://127.0.0.1:58321');
  assert.equal(value.outputDir, resolve('docs/evidence/web-operational-readiness',
    `db-${value.project.slice('prompted-db-'.length)}`, 'browser'));
  // Playwright deletes outputDir after reading its config, before loading test
  // files. Its exact existing parent remains the authority across that gap.
  assert.equal(realpathSync(dirname(value.outputDir)), dirname(value.outputDir));
  const output = lstatSync(value.outputDir, { throwIfNoEntry: false });
  if (output) {
    assert.ok(output.isDirectory()); assert.equal(realpathSync(value.outputDir), value.outputDir);
  }
  const manifest = JSON.parse(readFileSync(join(dirname(value.outputDir), 'manifest.json'), 'utf8'));
  assert.equal(manifest.project, value.project); assert.equal(manifest.workdir, dirname(path));
  assert.equal(value.users.length, 2); assert.notEqual(value.users[0].id, value.users[1].id);
  assert.ok(value.rows.length >= 10 && value.rows.length <= 30);
  for (const user of value.users) {
    keys(user, ['id', 'email', 'password']); uuid(user.id); assert.ok(user.email.endsWith('@example.invalid'));
    assert.equal(typeof user.password, 'string'); assert.ok(user.password.length >= 30);
  }
  assert.equal(new Set(value.rows.map(row => row.id)).size, value.rows.length);
  for (const row of value.rows) {
    keys(row, ['id', 'ownerId', 'name', 'text', 'originalPath', 'sha256', 'byteLength', 'retained', 'imported']);
    uuid(row.id);
    assert.ok(value.users.some(user => user.id === row.ownerId));
    assert.equal(typeof row.name, 'string'); assert.ok(row.name.length > 0 && row.name.length <= 255);
    assert.ok(!/[\/\\\u0000-\u001f\u007f]/.test(row.name));
    assert.equal(typeof row.text, 'string'); assert.ok(row.text.length <= 40000);
    assert.equal(typeof row.retained, 'boolean');
    assert.equal(row.originalPath, join(dirname(path), 'browser-originals', row.id));
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(row.byteLength) && row.byteLength > 0 && row.byteLength <= 2 * 1024 * 1024);
    assert.ok(lstatSync(row.originalPath).isFile());
    assert.equal(realpathSync(row.originalPath), row.originalPath);
    assert.equal(lstatSync(row.originalPath).size, row.byteLength);
    assert.equal(createHash('sha256').update(readFileSync(row.originalPath)).digest('hex'), row.sha256);
    if (row.imported !== null) {
      keys(row.imported, ['document_id', 'outcome_id']); uuid(row.imported.document_id); uuid(row.imported.outcome_id);
    }
  }
  return value;
}
