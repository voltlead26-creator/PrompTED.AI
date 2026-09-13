import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createDenoExecutionBoundary } from './deno-execution-boundary.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'prompted-deno-test-'));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(join(root, 'deno.json'), JSON.stringify({ nodeModulesDir: 'auto', compilerOptions: { strict: true } }));
  writeFileSync(join(root, 'package.json'), '{"private":true}\n');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(root, 'deno.lock'), '{"version":"5","workspace":{"packageJson":{"dependencies":[]}}}\n');
  return root;
}

test('isolates normal resolution and pnpm error migration without changing the locked graph', t => {
  const root = fixture(t);
  const boundary = createDenoExecutionBoundary(root, { PATH: '/test', DENO_NO_PACKAGE_JSON: '0' });
  assert.equal(boundary.env.DENO_NO_PACKAGE_JSON, '1');
  assert.equal(boundary.env.PATH, '/test');
  assert.ok(!boundary.cwd.startsWith(root + '/'));
  for (let directory = boundary.cwd; ; directory = dirname(directory)) {
    assert.ok(!existsSync(join(directory, 'pnpm-workspace.yaml')));
    if (directory === dirname(directory)) break;
  }
  for (const flag of ['--cached-only', '--frozen', '--no-config', '--node-modules-dir=none', '--no-prompt']) {
    assert.ok(boundary.flags.includes(flag));
  }
  assert.deepEqual(readFileSync(join(boundary.cwd, 'deno.lock')), readFileSync(join(root, 'deno.lock')));
  boundary.close();
  assert.ok(!existsSync(boundary.cwd));
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), '{"private":true}\n');
});

test('fails closed when the compiler contract changes instead of bypassing new options', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'deno.json'), '{"compilerOptions":{"strict":false}}');
  assert.throws(() => createDenoExecutionBoundary(root, {}), /compiler configuration changes/);
});

test('reports copied lock mutation and still removes only its owned scratch directory', t => {
  const boundary = createDenoExecutionBoundary(fixture(t), {});
  writeFileSync(join(boundary.cwd, 'deno.lock'), '{}');
  assert.throws(() => boundary.close(), /changed the copied lockfile/);
  assert.ok(!existsSync(boundary.cwd));
});

test('reports repository mutation without silently restoring or overwriting it', t => {
  const root = fixture(t);
  const boundary = createDenoExecutionBoundary(root, {});
  writeFileSync(join(root, 'package.json'), '{"workspaces":["apps/*"]}');
  assert.throws(() => boundary.close(), /changed repository package.json/);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), '{"workspaces":["apps/*"]}');
  assert.ok(!existsSync(boundary.cwd));
});
