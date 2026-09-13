import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createUploadProxyLifetime, uploadProxyTarget, readUploadProbeBody, syntheticUploadResponse } from './workspace-upload-transport.mjs';

function proxyPair() {
  return {
    req: Object.assign(new EventEmitter(), { aborted: false }),
    res: Object.assign(new EventEmitter(), { destroyed: false, closed: false, writableEnded: false, writableFinished: false }),
  };
}
function testLifetime(t, timeoutMs = 100) {
  const pair = proxyPair();
  const lifetime = createUploadProxyLifetime(pair.req, pair.res, timeoutMs);
  t.after(() => lifetime.dispose());
  return { ...pair, lifetime };
}

for (const source of ['request_aborted', 'response_closed']) {
  test(`only the originating ${source} reason proves client cancellation`, t => {
    const { req, res, lifetime } = testLifetime(t);
    assert.equal(lifetime.canRespond(), true);
    if (source === 'request_aborted') { req.aborted = true; req.emit('aborted'); }
    else { res.closed = true; res.emit('close'); }
    const reason = lifetime.signal.reason;
    assert.equal(reason.name, 'AbortError');
    assert.deepEqual(lifetime.failure(reason), {
      cancelled: true, abortCause: 'client_disconnect', abortSource: source, abortMatched: true,
    });
    assert.equal(lifetime.canRespond(), false);
    for (const unrelated of [new DOMException(reason.message, 'AbortError'), new TypeError('fetch failed'),
      Object.assign(new Error('network reset'), { name: 'AbortError' })]) {
      assert.deepEqual(lifetime.failure(unrelated), {
        failed: unrelated.name, abortCause: 'client_disconnect', abortSource: source, abortMatched: false,
      });
    }
  });
}
test('an unproven AbortError and unknown thrown values stay fatal', t => {
  const { lifetime } = testLifetime(t);
  assert.deepEqual(lifetime.failure(new DOMException('Aborted without observed origin', 'AbortError')), {
    failed: 'AbortError', abortCause: null, abortSource: null, abortMatched: false,
  });
  for (const value of [undefined, null, 42, 'failure', {}, { name: '' }, { name: ' ' }]) {
    assert.deepEqual(lifetime.failure(value), {
      failed: 'TransportError', abortCause: null, abortSource: null, abortMatched: false,
    });
  }
});
test('deadline remains fatal when a client disconnect follows it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { req, res, lifetime } = testLifetime(t);
  t.mock.timers.tick(100);
  const reason = lifetime.signal.reason;
  assert.equal(reason.name, 'TimeoutError'); assert.equal(lifetime.canRespond(), true);
  req.aborted = true; req.emit('aborted'); res.closed = true; res.emit('close');
  assert.equal(lifetime.signal.reason, reason); assert.equal(lifetime.canRespond(), false);
  assert.deepEqual(lifetime.failure(reason), {
    failed: 'TimeoutError', abortCause: 'deadline', abortSource: 'timer', abortMatched: true,
  });
});
test('client cancellation retains its first reason after close and the deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { req, res, lifetime } = testLifetime(t);
  req.emit('aborted'); const reason = lifetime.signal.reason;
  res.emit('close'); t.mock.timers.tick(100);
  assert.equal(lifetime.signal.reason, reason);
  assert.deepEqual(lifetime.failure(reason), {
    cancelled: true, abortCause: 'client_disconnect', abortSource: 'request_aborted', abortMatched: true,
  });
});
test('a completed response close is not cancellation', t => {
  const { res, lifetime } = testLifetime(t);
  res.writableEnded = true; res.writableFinished = true; res.emit('close');
  assert.equal(lifetime.signal.aborted, false); assert.equal(lifetime.canRespond(), false);
  assert.equal(lifetime.failure(new DOMException('Unrelated failure', 'AbortError')).failed, 'AbortError');
});
test('already aborted or closed inputs preserve the completed-response distinction', () => {
  for (const source of ['request_aborted', 'response_closed', 'completed']) {
    const { req, res } = proxyPair();
    if (source === 'request_aborted') req.aborted = true;
    else { res.destroyed = true; res.writableFinished = source === 'completed'; }
    const lifetime = createUploadProxyLifetime(req, res);
    try {
      assert.equal(lifetime.canRespond(), false);
      assert.equal(lifetime.signal.aborted, source !== 'completed');
      if (source !== 'completed') assert.equal(lifetime.failure(lifetime.signal.reason).abortSource, source);
    } finally { lifetime.dispose(); }
  }
});
test('disposal removes only owned listeners and clears the timer on every exit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const exit of ['success', 'cancelled', 'deadline']) {
    const { req, res } = proxyPair(); const other = () => {};
    req.on('aborted', other); res.on('close', other);
    const lifetime = createUploadProxyLifetime(req, res, 100);
    assert.equal(req.listenerCount('aborted'), 2); assert.equal(res.listenerCount('close'), 2);
    if (exit === 'cancelled') req.emit('aborted');
    if (exit === 'deadline') t.mock.timers.tick(100);
    const wasAborted = lifetime.signal.aborted; const reason = lifetime.signal.reason;
    lifetime.dispose(); lifetime.dispose();
    assert.deepEqual(req.listeners('aborted'), [other]); assert.deepEqual(res.listeners('close'), [other]);
    req.emit('aborted'); res.emit('close'); t.mock.timers.tick(100);
    assert.equal(lifetime.signal.aborted, wasAborted); assert.equal(lifetime.signal.reason, reason);
  }
});
test('proxy lifetime rejects unbounded or malformed deadlines', () => {
  const { req, res } = proxyPair();
  for (const timeout of [0, -1, 90001, 1.5, NaN, Infinity, '100']) {
    assert.throws(() => createUploadProxyLifetime(req, res, timeout));
  }
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
});

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
test('a pending real stream preserves the exact client cancellation reason and releases its lock', async t => {
  const { req, lifetime } = testLifetime(t);
  const cancellations = [];
  const stream = new ReadableStream({ cancel(reason) { cancellations.push(reason); return new Promise(() => {}); } });
  const pending = readUploadProbeBody(stream, 4, lifetime.signal);
  req.emit('aborted');
  await assert.rejects(pending, error => {
    assert.equal(error, lifetime.signal.reason); assert.equal(lifetime.failure(error).cancelled, true); return true;
  });
  assert.deepEqual(cancellations, [lifetime.signal.reason]); assert.equal(stream.locked, false);
});
test('a pending real stream reports a deadline as failure rather than cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { lifetime } = testLifetime(t);
  const stream = new ReadableStream(); const pending = readUploadProbeBody(stream, 4, lifetime.signal);
  t.mock.timers.tick(100);
  await assert.rejects(pending, error => {
    assert.equal(error, lifetime.signal.reason);
    assert.deepEqual(lifetime.failure(error), {
      failed: 'TimeoutError', abortCause: 'deadline', abortSource: 'timer', abortMatched: true,
    });
    return true;
  });
  assert.equal(stream.locked, false);
});
for (const [label, chunk, message] of [
  ['oversized', new Uint8Array(5), /byte bound/],
  ['malformed', { byteLength: 3, length: 3, 0: 65 }, /chunk must be bytes/],
]) {
  test(`${label} body remains fatal when stream cleanup also observes a client disconnect`, async t => {
    const { req, lifetime } = testLifetime(t);
    const stream = new ReadableStream({ start(c) { c.enqueue(chunk); }, cancel() { req.emit('aborted'); } });
    await assert.rejects(readUploadProbeBody(stream, 4, lifetime.signal), error => {
      assert.match(error.message, message); assert.notEqual(error, lifetime.signal.reason);
      assert.deepEqual(lifetime.failure(error), {
        failed: 'AssertionError', abortCause: 'client_disconnect', abortSource: 'request_aborted', abortMatched: false,
      });
      return true;
    });
    assert.equal(stream.locked, false);
  });
}

function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function loopbackServer(t, handler) {
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  const ready = once(server, 'listening'); server.listen(0, '127.0.0.1'); await ready;
  return `http://127.0.0.1:${server.address().port}`;
}
for (const phase of ['upstream headers', 'upstream response body']) {
  test(`real browser fetch cancellation propagates its proxy reason while waiting for ${phase}`, { timeout: 10000 }, async t => {
    const upstreamSeen = deferred(); const upstreamClosed = deferred(); const readingBody = deferred(); const proxyResult = deferred();
    const requestBody = '{"plan_id":"b5ae74db-24de-49c4-8a88-e5bda33b6912"}';
    const upstream = await loopbackServer(t, (_req, res) => {
      res.once('close', () => upstreamClosed.resolve({ completed: res.writableFinished }));
      if (phase === 'upstream response body') { res.writeHead(200); res.write('partial response'); }
      upstreamSeen.resolve();
    });
    const proxy = await loopbackServer(t, async (req, res) => {
      const lifetime = createUploadProxyLifetime(req, res, 5000); let result; let consumedRequest;
      try {
        // The acceptance proxy drains the browser request before dispatching
        // upstream. Leaving IncomingMessage unread changes its abort lifecycle.
        const body = await readUploadProbeBody(Readable.toWeb(req), 9 * 1024 * 1024, lifetime.signal);
        consumedRequest = { bytes: Array.from(body), complete: req.complete, ended: req.readableEnded };
        const response = await fetch(upstream, { method: req.method, body, signal: lifetime.signal });
        const pendingBody = readUploadProbeBody(response.body, 1024, lifetime.signal);
        readingBody.resolve(); await pendingBody;
        result = { unexpectedSuccess: true }; res.end();
      } catch (error) {
        const failure = lifetime.failure(error); const canRespond = lifetime.canRespond(); let wroteFailure = false;
        if (!failure.cancelled && canRespond) { wroteFailure = true; res.writeHead(502); res.end(); }
        result = { error, reason: lifetime.signal.reason, failure, canRespond, wroteFailure,
          responseDestroyed: res.destroyed, consumedRequest };
      } finally { lifetime.dispose(); proxyResult.resolve(result); }
    });
    const client = new AbortController(); t.after(() => client.abort());
    const downstreamReason = new Error('The browser left the page');
    const clientResult = fetch(proxy, { method: 'POST', body: requestBody, signal: client.signal })
      .then(() => ({ unexpectedSuccess: true }), error => ({ error }));
    await (phase === 'upstream headers' ? upstreamSeen.promise : readingBody.promise);
    client.abort(downstreamReason);
    assert.equal((await clientResult).error, downstreamReason);
    const result = await proxyResult.promise;
    assert.equal(result.unexpectedSuccess, undefined); assert.equal(result.error, result.reason);
    assert.deepEqual(result.consumedRequest, {
      bytes: Array.from(new TextEncoder().encode(requestBody)), complete: true, ended: true,
    });
    assert.deepEqual(result.failure, {
      cancelled: true, abortCause: 'client_disconnect', abortSource: 'response_closed', abortMatched: true,
    });
    assert.equal(result.canRespond, false); assert.equal(result.wroteFailure, false); assert.equal(result.responseDestroyed, true);
    assert.deepEqual(await upstreamClosed.promise, { completed: false });
  });
}
test('real fetch timeout remains fatal with the exact owned deadline reason', { timeout: 3000 }, async t => {
  const upstream = await loopbackServer(t, () => {});
  const { lifetime } = testLifetime(t, 40);
  await assert.rejects(fetch(upstream, { signal: lifetime.signal }), error => {
    assert.equal(error, lifetime.signal.reason);
    assert.deepEqual(lifetime.failure(error), {
      failed: 'TimeoutError', abortCause: 'deadline', abortSource: 'timer', abortMatched: true,
    });
    assert.equal(lifetime.canRespond(), true); return true;
  });
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
