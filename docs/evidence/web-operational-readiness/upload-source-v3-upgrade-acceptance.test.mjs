import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assertStorageRejection, validateV3UpgradePlan, validateRtfAliasUpgradePlan, validateUploadFallbackUpgradePlan, validateSourceImportUpgradePlan } from './upload-source-v3-upgrade-acceptance.mjs';

const manifest = JSON.parse(readFileSync(new URL('./db-20260907011342822-ed25ab1c/manifest.json', import.meta.url))).manifest;
const aliasManifest = { ...manifest,
  'supabase/migrations/20260907094500_upload_rtf_mime_alias.sql': 'a'.repeat(64),
  'supabase/tests/upload_rtf_mime_alias.test.sql': 'b'.repeat(64),
};
test('alias plan uses its exact successor pair without weakening the original v3 gate', () => {
  const plan = validateRtfAliasUpgradePlan(aliasManifest, aliasManifest);
  assert.equal(plan.predecessor, '20260907081500');
  assert.equal(plan.forward, '20260907094500');
  assert.equal(plan.versions.length, 73);
  assert.throws(() => validateV3UpgradePlan(aliasManifest, aliasManifest), /exactly its reviewed forward migration/);
});
for (const [name, mutate] of [
  ['changed predecessor', value => { value['supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql'] = 'a'.repeat(64); }],
  ['missing predecessor', value => { delete value['supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql']; }],
  ['missing forward', value => { delete value['supabase/migrations/20260907094500_upload_rtf_mime_alias.sql']; }],
  ['missing alias regression', value => { delete value['supabase/tests/upload_rtf_mime_alias.test.sql']; }],
  ['extra pending migration', value => { value['supabase/migrations/20260907100000_unreviewed.sql'] = 'a'.repeat(64); }],
  ['duplicate version', value => { value['supabase/migrations/20260907094500_duplicate.sql'] = 'a'.repeat(64); }],
  ['malformed digest', value => { value['supabase/tests/upload_rtf_mime_alias.test.sql'] = 'invalid'; }],
]) {
  test(`alias rejects ${name} before service admission`, () => {
    const changed = structuredClone(aliasManifest); mutate(changed);
    assert.throws(() => validateRtfAliasUpgradePlan(changed, changed));
  });
}
test('alias never omits or changes current SQL inputs', () => {
  const changed = structuredClone(aliasManifest);
  delete changed['supabase/tests/ollama_credit_fallback.test.sql'];
  assert.throws(() => validateRtfAliasUpgradePlan(changed, aliasManifest));
  changed['supabase/tests/ollama_credit_fallback.test.sql'] = 'f'.repeat(64);
  assert.throws(() => validateRtfAliasUpgradePlan(changed, aliasManifest));
});
for (const flag of ['--upload-source-acceptance', '--upload-source-v3-acceptance', '--profile-read-acceptance']) {
  test(`alias rejects simultaneous ${flag} before service creation`, () => {
    const result = spawnSync(process.execPath, [new URL('./run-isolated-db-baseline.mjs', import.meta.url).pathname,
      '--upload-rtf-alias-acceptance', flag], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /RTF alias upgrade mode is exclusive/);
  });
}
test('v3 plan accepts every SQL input from the successful fresh database run', () => {
  const plan = validateV3UpgradePlan(manifest, { ...manifest, 'AGENTS.md': 'a'.repeat(64) });
  assert.equal(Object.keys(manifest).length, 113);
  assert.equal(plan.versions.length, 72);
  assert.equal(plan.predecessor, '20260907053000');
  assert.equal(plan.forward, '20260907081500');
});
for (const [name, mutate] of [
  ['missing predecessor', value => { delete value['supabase/migrations/20260907053000_ollama_credit_fallback.sql']; }],
  ['missing forward', value => { delete value['supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql']; }],
  ['extra pending migration', value => { value['supabase/migrations/20260907090000_unreviewed.sql'] = 'a'.repeat(64); }],
  ['duplicate version', value => { value['supabase/migrations/20260907081500_duplicate.sql'] = 'a'.repeat(64); }],
  ['malformed version', value => { value['supabase/migrations/not_a_version.sql'] = 'a'.repeat(64); }],
  ['malformed digest', value => { value['supabase/tests/upload_source_checkpoint_v3.test.sql'] = 'invalid'; }],
]) {
  test(`v3 rejects ${name} before service admission`, () => {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => validateV3UpgradePlan(changed, changed));
  });
}
test('v3 does not omit later or unrelated current SQL using the old filtered slice', () => {
  const filtered = structuredClone(manifest);
  delete filtered['supabase/tests/ollama_credit_fallback.test.sql'];
  assert.throws(() => validateV3UpgradePlan(filtered, manifest));
});
test('v3 rejects a changed input between capture and copying', () => {
  const changed = structuredClone(manifest);
  changed['supabase/tests/upload_source_checkpoint_v3.test.sql'] = 'f'.repeat(64);
  assert.throws(() => validateV3UpgradePlan(changed, manifest));
});
test('mutually exclusive upgrade modes reject before temporary state or services', () => {
  const result = spawnSync(process.execPath, [new URL('./run-isolated-db-baseline.mjs', import.meta.url).pathname,
    '--upload-source-acceptance', '--upload-source-v3-acceptance'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /V2 and v3 upgrade modes are mutually exclusive/);
});
for (const [status, body, kind] of [
  [404, { code: 'NoSuchKey' }, 'denied'], [400, { error: 'not_found', statusCode: '404' }, 'denied'],
  [403, { code: 'AccessDenied' }, 'denied'], [409, { code: 'ResourceAlreadyExists' }, 'duplicate'],
  [400, { error: 'Duplicate', statusCode: '409' }, 'duplicate'],
]) {
  test(`documented ${kind} envelope ${status}/${body.code ?? body.error} is accepted`, () => {
    assert.equal(assertStorageRejection(status, body, kind), body.code ?? body.error);
  });
}
for (const [label, status, body, kind = 'denied'] of [
  ['successful response', 200, { code: 'NoSuchKey' }],
  ['service failure', 500, { code: 'NoSuchKey' }],
  ['timeout', 504, { code: 'AccessDenied' }],
  ['invalid JWT', 401, { code: 'InvalidJWT' }],
  ['arbitrary client error', 400, { code: 'InvalidRequest' }],
  ['null body', 404, null],
  ['empty body', 404, {}],
  ['permission error as duplicate', 403, { code: 'AccessDenied' }, 'duplicate'],
  ['unknown rejection type', 404, { code: 'NoSuchKey' }, 'unknown'],
]) {
  test(`${label} cannot become Storage isolation or duplicate proof`, () => {
    assert.throws(() => assertStorageRejection(status, body, kind));
  });
}

const fallbackManifest = { ...aliasManifest,
  'supabase/migrations/20260907094500_upload_rtf_mime_alias.sql': '143fa67061b164c87529550b2aa9db5e2e83395854fd97d69fd1c604de520804',
  'supabase/migrations/20260907102000_upload_fallback_settlement.sql': '8fd4a9d24e3ee6c8c78c18119fc55843d97733da08079f36eda8bab01455147e',
  'supabase/tests/upload_fallback_settlement.test.sql': 'c'.repeat(64),
};
test('fallback uses the reviewed94500-to-102000 pair without changing either earlier upgrade gate', () => {
  const plan = validateUploadFallbackUpgradePlan(fallbackManifest, fallbackManifest);
  assert.equal(plan.predecessor, '20260907094500'); assert.equal(plan.forward, '20260907102000');
  assert.equal(plan.versions.length, 74);
  assert.throws(() => validateV3UpgradePlan(fallbackManifest, fallbackManifest), /exactly its reviewed forward migration/);
  assert.throws(() => validateRtfAliasUpgradePlan(fallbackManifest, fallbackManifest), /exactly its reviewed forward migration/);
});
for (const [name, mutate] of [
  ['changed v3 foundation', value => { value['supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql'] = 'd'.repeat(64); }],
  ['changed predecessor', value => { value['supabase/migrations/20260907094500_upload_rtf_mime_alias.sql'] = 'd'.repeat(64); }],
  ['missing predecessor', value => { delete value['supabase/migrations/20260907094500_upload_rtf_mime_alias.sql']; }],
  ['changed forward', value => { value['supabase/migrations/20260907102000_upload_fallback_settlement.sql'] = 'd'.repeat(64); }],
  ['missing forward', value => { delete value['supabase/migrations/20260907102000_upload_fallback_settlement.sql']; }],
  ['missing regression', value => { delete value['supabase/tests/upload_fallback_settlement.test.sql']; }],
  ['extra pending migration', value => { value['supabase/migrations/20260907103000_unreviewed.sql'] = 'a'.repeat(64); }],
  ['duplicate version', value => { value['supabase/migrations/20260907102000_duplicate.sql'] = 'a'.repeat(64); }],
  ['malformed digest', value => { value['supabase/tests/upload_fallback_settlement.test.sql'] = 'invalid'; }],
]) {
  test(`fallback rejects ${name} before service admission`, () => {
    const changed = structuredClone(fallbackManifest); mutate(changed);
    assert.throws(() => validateUploadFallbackUpgradePlan(changed, changed));
  });
}
test('fallback refuses omitted or changed current SQL', () => {
  const changed = structuredClone(fallbackManifest);
  delete changed['supabase/tests/upload_rtf_mime_alias.test.sql'];
  assert.throws(() => validateUploadFallbackUpgradePlan(changed, fallbackManifest));
  changed['supabase/tests/upload_rtf_mime_alias.test.sql'] = 'f'.repeat(64);
  assert.throws(() => validateUploadFallbackUpgradePlan(changed, fallbackManifest));
});
for (const flag of ['--upload-source-acceptance', '--upload-source-v3-acceptance', '--upload-rtf-alias-acceptance', '--profile-read-acceptance']) {
  test(`fallback rejects simultaneous ${flag} before service creation`, () => {
    const result = spawnSync(process.execPath, [new URL('./run-isolated-db-baseline.mjs', import.meta.url).pathname,
      '--upload-fallback-acceptance', flag], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /Fallback upgrade mode is exclusive/);
  });
}

const importManifest = { ...fallbackManifest,
  'supabase/migrations/20260907112000_upload_source_import_boundary.sql': '16fe5041cf52351221a1318ab1bdbbc7006196683f72ed650fd253245569294a',
  'supabase/tests/upload_source_import_boundary.test.sql': 'd'.repeat(64),
};
test('source import pins102000-to-112000 and preserves every earlier upgrade guard', () => {
  const plan = validateSourceImportUpgradePlan(importManifest, importManifest);
  assert.equal(plan.predecessor, '20260907102000'); assert.equal(plan.forward, '20260907112000');
  assert.equal(plan.versions.length, 75);
  for (const prior of [validateV3UpgradePlan, validateRtfAliasUpgradePlan, validateUploadFallbackUpgradePlan]) {
    assert.throws(() => prior(importManifest, importManifest), /exactly its reviewed forward migration/);
  }
});
for (const [name, mutate] of [
  ['changed predecessor', value => { value['supabase/migrations/20260907102000_upload_fallback_settlement.sql'] = 'd'.repeat(64); }],
  ['missing predecessor', value => { delete value['supabase/migrations/20260907102000_upload_fallback_settlement.sql']; }],
  ['changed forward', value => { value['supabase/migrations/20260907112000_upload_source_import_boundary.sql'] = 'd'.repeat(64); }],
  ['missing forward', value => { delete value['supabase/migrations/20260907112000_upload_source_import_boundary.sql']; }],
  ['missing regression', value => { delete value['supabase/tests/upload_source_import_boundary.test.sql']; }],
  ['extra pending migration', value => { value['supabase/migrations/20260907113000_unreviewed.sql'] = 'a'.repeat(64); }],
  ['duplicate version', value => { value['supabase/migrations/20260907112000_duplicate.sql'] = 'a'.repeat(64); }],
  ['malformed digest', value => { value['supabase/tests/upload_source_import_boundary.test.sql'] = 'invalid'; }],
]) {
  test(`source import rejects ${name} before service admission`, () => {
    const changed = structuredClone(importManifest); mutate(changed);
    assert.throws(() => validateSourceImportUpgradePlan(changed, changed));
  });
}
test('source import refuses omitted or changed current SQL', () => {
  const changed = structuredClone(importManifest);
  delete changed['supabase/tests/upload_rtf_mime_alias.test.sql'];
  assert.throws(() => validateSourceImportUpgradePlan(changed, importManifest));
  changed['supabase/tests/upload_rtf_mime_alias.test.sql'] = 'f'.repeat(64);
  assert.throws(() => validateSourceImportUpgradePlan(changed, importManifest));
});
for (const flag of ['--upload-source-acceptance', '--upload-source-v3-acceptance', '--upload-rtf-alias-acceptance', '--upload-fallback-acceptance', '--profile-read-acceptance']) {
  test(`source import rejects simultaneous ${flag} before service creation`, () => {
    const result = spawnSync(process.execPath, [new URL('./run-isolated-db-baseline.mjs', import.meta.url).pathname,
      '--upload-source-import-acceptance', flag], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /Source import upgrade mode is exclusive/);
  });
}
