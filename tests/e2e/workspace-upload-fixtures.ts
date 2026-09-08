import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export type UploadFixture = { name: string; mime: string; text: string; format: 'pdf' | 'docx' | 'rtf' | 'text';
  path: string; byteLength: number; sha256: string; importText: boolean };
export type UploadBrowserFixture = { version: 'workspace-upload-browser.1'; project: string; webOrigin: string;
  supabaseOrigin: string; outputDir: string; users: Array<{ id: string; email: string; password: string }>;
  files: UploadFixture[] };

export function loadUploadBrowserFixture(): UploadBrowserFixture {
  const path = process.env.PROMPTED_UPLOAD_E2E_FIXTURE;
  assert.ok(path, 'Run the isolated new-upload browser acceptance first');
  assert.equal(basename(path), 'workspace-upload-browser-fixture.json');
  assert.ok(lstatSync(path).isFile()); assert.equal(realpathSync(path), path);
  assert.ok(lstatSync(path).size > 0 && lstatSync(path).size <= 1024 * 1024);
  assert.equal(lstatSync(path).mode & 0o077, 0);
  const value = JSON.parse(readFileSync(path, 'utf8')) as UploadBrowserFixture;
  const keys = (x: object, names: string[]) => assert.deepEqual(Object.keys(x).sort(), names.sort());
  keys(value, ['version', 'project', 'webOrigin', 'supabaseOrigin', 'outputDir', 'users', 'files']);
  assert.equal(value.version, 'workspace-upload-browser.1');
  assert.match(value.project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.match(basename(dirname(path)), new RegExp(`^${value.project}-[A-Za-z0-9]{6}$`));
  assert.equal(readFileSync(join(dirname(path), 'run-owner.txt'), 'utf8'), value.project);
  assert.equal(value.webOrigin, 'http://127.0.0.1:58323');
  assert.equal(value.supabaseOrigin, 'http://127.0.0.1:58324');
  assert.equal(value.outputDir, resolve('docs/evidence/web-operational-readiness', `db-${value.project.slice(12)}`, 'upload-browser'));
  assert.equal(realpathSync(dirname(value.outputDir)), dirname(value.outputDir));
  const output = lstatSync(value.outputDir, { throwIfNoEntry: false });
  if (output) { assert.ok(output.isDirectory()); assert.equal(realpathSync(value.outputDir), value.outputDir); }
  const manifest = JSON.parse(readFileSync(join(dirname(value.outputDir), 'manifest.json'), 'utf8'));
  assert.equal(manifest.project, value.project); assert.equal(manifest.workdir, dirname(path));
  assert.equal(value.users.length, 2); assert.notEqual(value.users[0]?.id, value.users[1]?.id);
  for (const user of value.users) {
    keys(user, ['id', 'email', 'password']); assert.match(user.id, /^[0-9a-f-]{36}$/);
    assert.ok(user.email.endsWith('@example.invalid')); assert.ok(user.password.length >= 30);
  }
  assert.ok(value.files.length >= 5 && value.files.length <= 12);
  assert.equal(new Set(value.files.map(file => file.name)).size, value.files.length);
  for (const file of value.files) {
    keys(file, ['name', 'mime', 'text', 'format', 'path', 'byteLength', 'sha256', 'importText']);
    assert.match(file.name, /^[A-Za-z0-9 _.-]{1,100}$/); assert.equal(typeof file.mime, 'string');
    assert.ok(['pdf', 'docx', 'rtf', 'text'].includes(file.format));
    assert.equal(typeof file.text, 'string'); assert.ok(file.text.length > 0 && file.text.length <= 20000);
    assert.equal(typeof file.importText, 'boolean'); if (file.importText) assert.equal(file.format, 'text');
    assert.equal(file.path, join(dirname(path), 'upload-inputs', file.name));
    assert.equal(realpathSync(file.path), file.path); assert.ok(lstatSync(file.path).isFile());
    assert.ok(Number.isInteger(file.byteLength) && file.byteLength > 0 && file.byteLength <= 2 * 1024 * 1024);
    assert.equal(lstatSync(file.path).size, file.byteLength); assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'), file.sha256);
  }
  return value;
}
