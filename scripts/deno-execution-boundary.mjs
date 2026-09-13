import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';

// Deno 2.9.5's error formatter can migrate a pnpm workspace starting at cwd,
// even with package discovery disabled. Keep both normal resolution and the
// error path outside that tree. This uses the existing cached dependency graph;
// it never installs dependencies or changes the repository's lockfiles.
export function createDenoExecutionBoundary(root, env) {
  root = realpathSync(root);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'deno.json'), 'utf8')), {
    nodeModulesDir: 'auto', compilerOptions: { strict: true },
  }, 'Review the Deno boundary when repository compiler configuration changes');
  const originals = new Map(['package.json', 'pnpm-lock.yaml', 'deno.lock']
    .map(name => [name, readFileSync(join(root, name))]));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'prompted-deno-')));
  const lock = join(cwd, 'deno.lock');
  try {
    const fromRoot = relative(root, cwd);
    assert.ok(isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('../'),
      'Deno working directory must be outside the repository');
    for (let directory = cwd; ; directory = dirname(directory)) {
      assert.ok(!existsSync(join(directory, 'pnpm-workspace.yaml')),
        'Deno working directory must have no pnpm workspace ancestor');
      if (dirname(directory) === directory) break;
    }
    copyFileSync(join(root, 'deno.lock'), lock);
  } catch (error) {
    rmSync(cwd, { recursive: true });
    throw error;
  }
  return {
    cwd,
    env: { ...env, DENO_NO_PACKAGE_JSON: '1', DENO_NO_UPDATE_CHECK: '1' },
    // strict:true is Deno's default. --no-config also prevents Deno from
    // rewriting existing pnpm workspace metadata inside a frozen lockfile.
    flags: Object.freeze(['--cached-only', '--frozen', '--no-config',
      '--node-modules-dir=none', `--lock=${lock}`, '--no-prompt']),
    close() {
      try {
        assert.deepEqual(readFileSync(lock), originals.get('deno.lock'), 'Deno changed the copied lockfile');
        for (const [name, bytes] of originals) {
          assert.deepEqual(readFileSync(join(root, name)), bytes, `Deno changed repository ${name}`);
        }
      } finally {
        rmSync(cwd, { recursive: true });
      }
    },
  };
}
