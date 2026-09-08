import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateWorkspaceReadUpgradePlan } from './workspace-upload-read-acceptance.mjs';
import { validateSourceImportUpgradePlan } from './upload-source-v3-upgrade-acceptance.mjs';

const manifest = JSON.parse(readFileSync(new URL('./db-20260907100737954-50e0967b/manifest.json', import.meta.url))).manifest;
test('workspace reads use all76 fresh-verified migrations and45 test files with the exact upgrade pair', () => {
  const plan = validateWorkspaceReadUpgradePlan(manifest, { ...manifest, 'AGENTS.md': 'a'.repeat(64) });
  assert.equal(plan.predecessor, '20260907112000'); assert.equal(plan.forward, '20260907124000');
  assert.equal(plan.versions.length, 76); assert.equal(Object.keys(manifest).length, 121);
  assert.throws(() => validateSourceImportUpgradePlan(manifest, manifest), /exactly its reviewed forward migration/);
});
for (const [name, mutate] of [
  ['changed predecessor', value => { value['supabase/migrations/20260907112000_upload_source_import_boundary.sql'] = 'a'.repeat(64); }],
  ['changed forward', value => { value['supabase/migrations/20260907124000_workspace_upload_reads.sql'] = 'a'.repeat(64); }],
  ['missing predecessor', value => { delete value['supabase/migrations/20260907112000_upload_source_import_boundary.sql']; }],
  ['missing forward', value => { delete value['supabase/migrations/20260907124000_workspace_upload_reads.sql']; }],
  ['missing regression', value => { delete value['supabase/tests/workspace_upload_reads.test.sql']; }],
  ['unreviewed later migration', value => { value['supabase/migrations/20260907130000_unreviewed.sql'] = 'a'.repeat(64); }],
  ['duplicate version', value => { value['supabase/migrations/20260907124000_duplicate.sql'] = 'a'.repeat(64); }],
  ['malformed version', value => { value['supabase/migrations/invalid.sql'] = 'a'.repeat(64); }],
  ['invalid digest', value => { value['supabase/tests/workspace_upload_reads.test.sql'] = 'invalid'; }],
]) test(`workspace upgrade rejects ${name} before service admission`, () => {
  const changed = structuredClone(manifest); mutate(changed);
  assert.throws(() => validateWorkspaceReadUpgradePlan(changed, changed));
});
test('workspace reads cannot omit or alter any current SQL input', () => {
  const changed = structuredClone(manifest); delete changed['supabase/tests/ollama_credit_fallback.test.sql'];
  assert.throws(() => validateWorkspaceReadUpgradePlan(changed, manifest), /all current SQL/);
  changed['supabase/tests/ollama_credit_fallback.test.sql'] = 'f'.repeat(64);
  assert.throws(() => validateWorkspaceReadUpgradePlan(changed, manifest), /all current SQL/);
});
