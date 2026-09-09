// Test-only bootstrap: production handlers and DB/provider accounting are real.
// Network is restricted by both this adapter and Deno's exact --allow-net list.
import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { uploadOrigins } from './workspace-upload-transport.mjs';

const [entry, fixturePath] = Deno.args;
assert.ok(entry === 'ingest-upload' || entry === 'extract-upload');
assert.ok(fixturePath?.endsWith('/workspace-upload-provider.json'));
assert.equal(Deno.env.get('SUPABASE_URL'), uploadOrigins.supabase);
assert.equal(Deno.env.get('PROMPTED_DEPLOYMENT_ENV'), 'test');
assert.equal(Deno.env.get('OLLAMA_CREDIT_FALLBACK_ENABLED'), 'false');
assert.equal(Deno.realPathSync(fixturePath), fixturePath);
const project = Deno.readTextFileSync(join(dirname(fixturePath), 'run-owner.txt'));
assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
assert.match(basename(dirname(fixturePath)), new RegExp(`^${project}-[A-Za-z0-9]{6}$`));
const fixtureFile = Deno.lstatSync(fixturePath);
assert.ok(fixtureFile.isFile && !fixtureFile.isSymlink && fixtureFile.size <= 1024 * 1024);
assert.equal((fixtureFile.mode ?? 0) & 0o077, 0);
const fixtures = JSON.parse(Deno.readTextFileSync(fixturePath));
assert.ok(Array.isArray(fixtures) && fixtures.length >= 5 && fixtures.length <= 20);
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init); const url = new URL(request.url);
  if (url.href === 'https://api.openai.com/v1/responses' && entry === 'ingest-upload') {
    throw new Error('SOURCE_PREPARATION_UNEXPECTED_PROVIDER_DISPATCH');
  }
  assert.equal(url.origin, uploadOrigins.supabase, 'Unexpected function network origin');
  if (url.pathname === '/functions/v1/extract-upload' && entry === 'ingest-upload') {
    assert.equal(request.method, 'POST');
    return await realFetch(new Request(uploadOrigins.extract + url.pathname, request), { redirect: 'error' });
  }
  assert.ok(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/') ||
    url.pathname.startsWith('/storage/v1/object/'), 'Unexpected function network path');
  return await realFetch(request, { redirect: 'error' });
};
const serve = Deno.serve.bind(Deno);
// Both production entrypoints use precisely the single handler overload.
Deno.serve = ((handler: Deno.ServeHandler) => {
  assert.equal(typeof handler, 'function');
  const port = entry === 'ingest-upload' ? 58325 : 58326;
  return serve({ hostname: '127.0.0.1', port, onListen(address) {
    assert.equal(address.hostname, '127.0.0.1'); assert.equal(address.port, port);
    console.log(JSON.stringify({ event: 'owned-upload-listener', project, entry, port }));
  } }, handler);
}) as typeof Deno.serve;
await import(`../../../supabase/functions/${entry}/index.ts`);
