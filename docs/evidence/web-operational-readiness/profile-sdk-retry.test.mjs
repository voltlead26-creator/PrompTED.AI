// Actual installed SDK, controlled HTTP only. No services, credentials or network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '../../../apps/web/node_modules/@supabase/supabase-js/dist/index.mjs';

const owner = '00000000-0000-4000-8000-000000000001';
function fixture(failureActive) {
  const attempts = [];
  const client = createClient('http://127.0.0.1:58324', 'synthetic-public-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input); assert.equal(url.pathname, '/rest/v1/profile_resume_versions');
      assert.equal(url.searchParams.get('user_id'), `eq.${owner}`); assert.equal(init.method, 'GET');
      attempts.push(Number(new Headers(init.headers).get('X-Retry-Count') ?? '0'));
      assert.ok(attempts.length <= 5, 'Unexpected unbounded read attempts');
      return failureActive(attempts.length)
        ? new Response(JSON.stringify({ message: 'Synthetic Profile unavailable' }), {
          status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0' },
        })
        : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  return { attempts, read: () => client.from('profile_resume_versions').select('id').eq('user_id', owner) };
}

test('a one-shot503 automatically recovers and cannot prove Profile failure UI', async () => {
  const probe = fixture(attempt => attempt === 1); const result = await probe.read();
  assert.equal(result.error, null); assert.equal(result.status, 200); assert.deepEqual(result.data, []);
  assert.deepEqual(probe.attempts, [0, 1]);
});

test('held503 exhausts bounded SDK retries; releasing it permits a new owner read', async () => {
  let held = true; const probe = fixture(() => held); const failed = await probe.read();
  assert.equal(failed.status, 503); assert.equal(failed.error.message, 'Synthetic Profile unavailable');
  assert.equal(failed.data, null); assert.deepEqual(probe.attempts, [0, 1, 2, 3]);
  held = false; const recovered = await probe.read();
  assert.equal(recovered.status, 200); assert.equal(recovered.error, null); assert.deepEqual(recovered.data, []);
  assert.deepEqual(probe.attempts, [0, 1, 2, 3, 0]);
});
