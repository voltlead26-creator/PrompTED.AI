import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Explicit upload-slice acceptance only. The ordinary DB gate still runs every
// current SQL file. This pins the actual RED inputs plus the reviewed clock fix;
// it is not acceptance of subsequently added provider migrations or tests.
const baselineSha = "f9a6d4aa2e00fd1e9d787dd55d40f4aa0ade89b736139322c2f80194afd90c81";
const clockFile = "supabase/migrations/20260906160000_upload_source_checkpoint_v2.sql";
const clockFixSha = "858cc1251294935cefc0eb0e2ae7c0fcb05bbbc5182978e47f303cfc128bcd97";
const isSqlInput = file => file.startsWith("supabase/migrations/") || file.startsWith("supabase/tests/");

export function selectUploadSourceSqlScope(baselineBytes, currentSource) {
  assert.equal(createHash("sha256").update(baselineBytes).digest("hex"), baselineSha,
    "Upload RED evidence manifest changed");
  const baseline = JSON.parse(baselineBytes);
  const selected = { ...baseline.manifest, [clockFile]: clockFixSha };
  const migrations = Object.keys(selected).filter(file => file.startsWith("supabase/migrations/"));
  const tests = Object.keys(selected).filter(file => file.startsWith("supabase/tests/"));
  assert.equal(migrations.length, 70);
  assert.equal(tests.length, 37);
  assert.equal(Object.keys(selected).length, migrations.length + tests.length);
  const versions = migrations.map(file => {
    assert.match(file, /^supabase\/migrations\/\d{14}_[^/]+\.sql$/);
    return file.split("/").at(-1).slice(0, 14);
  }).sort();
  assert.equal(new Set(versions).size, versions.length);
  assert.deepEqual(versions.filter(version => version > "20260906010846"), ["20260906160000"],
    "Upload source acceptance permits exactly one forward migration");
  for (const [file, digest] of Object.entries(selected)) {
    assert.match(file, /^supabase\/(?:migrations|tests)\/[^/]+\.sql$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(currentSource[file], digest, `Upload acceptance input changed or missing: ${file}`);
  }
  const excluded = Object.fromEntries(Object.entries(currentSource)
    .filter(([file]) => isSqlInput(file) && !Object.hasOwn(selected, file)));
  return { baselineSha, selected, excluded };
}
