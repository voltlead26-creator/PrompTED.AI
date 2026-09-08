// Test-only transport policy. Never imported by production entry points.
import assert from 'node:assert/strict';

export const uploadOrigins = Object.freeze({ web: 'http://127.0.0.1:58323',
  supabase: 'http://127.0.0.1:58321', front: 'http://127.0.0.1:58324',
  ingest: 'http://127.0.0.1:58325', extract: 'http://127.0.0.1:58326' });
export function uploadProxyTarget(rawPath, method) {
  assert.ok(typeof rawPath === 'string' && rawPath.startsWith('/') && !rawPath.startsWith('//'));
  assert.ok(!/[\\\u0000-\u0020\u007f]/.test(rawPath));
  assert.ok(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(method));
  const url = new URL(rawPath, uploadOrigins.front);
  assert.equal(url.origin, uploadOrigins.front);
  assert.equal(url.pathname + url.search, rawPath, 'Proxy must not normalize request paths');
  if (url.pathname === '/functions/v1/ingest-upload') {
    assert.ok(['POST', 'OPTIONS'].includes(method));
    return uploadOrigins.ingest + rawPath;
  }
  assert.ok(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/') ||
    url.pathname.startsWith('/storage/v1/object/'), 'Unexpected local browser destination');
  return uploadOrigins.supabase + rawPath;
}

export async function readUploadProbeBody(stream, maximumBytes, signal) {
  assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= 16 * 1024 * 1024);
  signal.throwIfAborted();
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(); const chunks = []; let length = 0;
  let cancellationRequested = false;
  const abort = () => {
    if (cancellationRequested) return; cancellationRequested = true;
    // Underlying stream cleanup is untrusted and may never settle. Initiate it
    // once, release our lock, and preserve the original transfer failure.
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (let reads = 0; ; reads++) {
      signal.throwIfAborted(); assert.ok(reads < 10000, 'Transfer read bound exceeded');
      const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      length += next.value.byteLength; assert.ok(length <= maximumBytes, 'Transfer byte bound exceeded');
      chunks.push(next.value);
    }
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    signal.removeEventListener('abort', abort); abort(); reader.releaseLock();
  }
}

export function syntheticUploadResponse(body, clientRequestId, fixtures, dispatchIndex) {
  assert.match(clientRequestId, /^[A-Za-z0-9._:-]{8,200}$/);
  assert.ok(Number.isInteger(dispatchIndex) && dispatchIndex >= 1 && dispatchIndex <= 30);
  assert.deepEqual(Object.keys(body).sort(), ['model', 'instructions', 'input', 'max_output_tokens', 'reasoning', 'store', 'text'].sort());
  assert.equal(body.model, 'synthetic-upload-fast'); assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 1600); assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.equal(typeof body.instructions, 'string'); assert.ok(body.instructions.includes('text extracted from a document'));
  assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.name, 'prompted_ingest_classification');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, ['document_type', 'purpose', 'sections']);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(body.input.length, 1); assert.deepEqual(Object.keys(body.input[0]).sort(), ['content', 'role']);
  assert.equal(body.input[0].role, 'user');
  const fixture = fixtures.find(value => value.text.slice(0, 12000) === body.input[0].content);
  assert.ok(fixture, 'Classifier received unexpected source wording');
  const wording = { document_type: 'Synthetic source document', purpose: 'These synthetic notes are used to check the upload workflow.',
    sections: [{ title: 'Source wording', items: [fixture.text.slice(0, 200)] }] };
  return { id: `resp_synthetic_upload_${dispatchIndex}`, status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(wording) }] }],
    usage: { input_tokens: 17, output_tokens: 9 } };
}
