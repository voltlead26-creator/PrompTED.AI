import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadProxyTarget, readUploadProbeBody, syntheticUploadResponse } from './workspace-upload-transport.mjs';

test('closed local front door preserves function path, encoded names and query', () => {
  assert.equal(uploadProxyTarget('/functions/v1/ingest-upload', 'POST'), 'http://127.0.0.1:58325/functions/v1/ingest-upload');
  assert.equal(uploadProxyTarget('/storage/v1/object/original-documents/a/b/A%20file.pdf', 'GET'),
    'http://127.0.0.1:58321/storage/v1/object/original-documents/a/b/A%20file.pdf');
  assert.equal(uploadProxyTarget('/auth/v1/token?grant_type=password', 'POST'), 'http://127.0.0.1:58321/auth/v1/token?grant_type=password');
});
for (const path of ['https://example.com', '//example.com/x', '/functions/v1/extract-upload', '/functions/v1/recommend',
  '/rest/v1/../auth/v1/user', '/rest/v1/\\example.com', '/rest/v1/a b', '/admin', '/storage/v1/bucket']) {
  test(`front door rejects ${JSON.stringify(path)}`, () => assert.throws(() => uploadProxyTarget(path, 'POST')));
}
test('body transfer bounds, abort and cleanup are enforced', async () => {
  let cancelled = false;
  const tooLarge = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
  await assert.rejects(readUploadProbeBody(tooLarge, 4, AbortSignal.timeout(1000)), /byte bound/); assert.equal(cancelled, true);
  const controller = new AbortController();
  const pending = readUploadProbeBody(new ReadableStream({ cancel() { cancelled = true; } }), 4, controller.signal);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(await readUploadProbeBody(new Response('abc').body, 3, AbortSignal.timeout(1000)), new TextEncoder().encode('abc'));
});
test('stalled stream cancellation cannot strand a transfer failure', async () => {
  let cancellations = 0;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5)); },
    cancel() { cancellations++; return new Promise(() => {}); } });
  const pending = readUploadProbeBody(stream, 4, AbortSignal.timeout(1000)).then(() => 'resolved', () => 'rejected');
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('stranded'), 50))]);
  assert.equal(result, 'rejected'); assert.equal(cancellations, 1); assert.equal(stream.locked, false);
});
test('an absent body cannot turn an already cancelled operation into success', async () => {
  await assert.rejects(readUploadProbeBody(null, 4, AbortSignal.abort()), { name: 'AbortError' });
});
const body = () => ({ model: 'synthetic-upload-fast', store: false, instructions: 'text extracted from a document',
  input: [{ role: 'user', content: 'Synthetic wording' }], max_output_tokens: 1600, reasoning: { effort: 'low' },
  text: { format: { type: 'json_schema', name: 'prompted_ingest_classification', strict: true,
    schema: { required: ['document_type', 'purpose', 'sections'], additionalProperties: false } } } });
test('controlled response requires exact synthetic request and source', () => {
  const reply = syntheticUploadResponse(body(), 'request-123', [{ text: 'Synthetic wording' }], 1);
  assert.equal(reply.status, 'completed'); assert.equal(reply.id, 'resp_synthetic_upload_1');
  assert.deepEqual(reply.usage, { input_tokens: 17, output_tokens: 9 });
  for (const change of [{ store: true }, { model: 'real-model' }, { max_output_tokens: 2000 }, { tools: [] },
    { input: [{ role: 'user', content: 'Unexpected private source' }] }]) {
    assert.throws(() => syntheticUploadResponse({ ...body(), ...change }, 'request-123', [{ text: 'Synthetic wording' }], 1));
  }
});
