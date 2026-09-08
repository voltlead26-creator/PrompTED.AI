// Execution failure and resource cleanup are separate acceptance facts.
import assert from 'node:assert/strict';
export function uploadRunDisposition({ checksPassed, primaryFailure, children, cleanupFailures = [] }) {
  const executionFailures = []; const cleanup = [...cleanupFailures];
  for (const child of children) {
    assert.ok(['command', 'service'].includes(child.kind));
    if (child.failure) executionFailures.push(`${child.label}: ${child.failure}`);
    if (child.kind === 'command' && child.result?.code !== 0) executionFailures.push(`${child.label}: command failed`);
    if (child.kind === 'service' && (!child.shutdownRequested ||
      !(child.result?.code === 0 || child.result?.signal === 'SIGTERM'))) executionFailures.push(`${child.label}: service failed`);
    if (!child.result || child.forcedTermination) cleanup.push(`${child.label}: incomplete or forced cleanup`);
  }
  return { checksPassed, executionPassed: primaryFailure === null && executionFailures.length === 0,
    cleanupPassed: cleanup.length === 0,
    passed: checksPassed && primaryFailure === null && executionFailures.length === 0 && cleanup.length === 0,
    primaryFailure: primaryFailure ?? executionFailures[0] ?? cleanup[0] ?? null,
    executionFailures, cleanupFailures: cleanup };
}
