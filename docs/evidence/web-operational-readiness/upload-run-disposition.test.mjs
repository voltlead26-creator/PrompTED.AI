import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadRunDisposition } from './upload-run-disposition.mjs';
const command = { label: 'playwright', kind: 'command', result: { code: 0, signal: null }, failure: null, shutdownRequested: false, forcedTermination: false };
const service = { label: 'ingest', kind: 'service', result: { code: null, signal: 'SIGTERM' }, failure: null, shutdownRequested: true, forcedTermination: false };
test('a completed failing browser command is not a cleanup failure', () => {
  const result = uploadRunDisposition({ checksPassed: false, primaryFailure: 'Markdown workspace unavailable',
    children: [{ ...command, result: { code: 1, signal: null } }, service] });
  assert.equal(result.passed, false); assert.equal(result.executionPassed, false); assert.equal(result.cleanupPassed, true);
  assert.equal(result.primaryFailure, 'Markdown workspace unavailable');
});
test('cleanup failure never replaces the earlier workflow failure', () => {
  const result = uploadRunDisposition({ checksPassed: false, primaryFailure: 'Original browser assertion',
    children: [{ ...service, forcedTermination: true, result: { code: null, signal: 'SIGKILL' } }], cleanupFailures: ['evidence write failed'] });
  assert.equal(result.passed, false); assert.equal(result.cleanupPassed, false); assert.equal(result.primaryFailure, 'Original browser assertion');
  assert.equal(result.cleanupFailures.length, 2);
});
test('unsolicited service shutdown cannot pass as intended cleanup', () => {
  const result = uploadRunDisposition({ checksPassed: true, primaryFailure: null, children: [{ ...service, shutdownRequested: false }] });
  assert.equal(result.passed, false); assert.equal(result.executionPassed, false); assert.equal(result.cleanupPassed, true);
});
test('success requires checked work and successful cleanup', () => {
  assert.equal(uploadRunDisposition({ checksPassed: true, primaryFailure: null, children: [command, service] }).passed, true);
  assert.equal(uploadRunDisposition({ checksPassed: true, primaryFailure: null, children: [command, service], cleanupFailures: ['private fixture remains'] }).passed, false);
});
