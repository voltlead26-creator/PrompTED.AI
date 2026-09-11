import assert from "node:assert/strict";

// Reviewed additive SQL inputs, 12 September 2026. The original 79/81 and
// observed hosted 68-version baseline files retain their exact bytes and hashes.
// Fresh execution: db-20260911151421959-c1a48e17 (54 files / 2,752 assertions).
// 86-migration execution: db-20260911153057822-4785f3a3 (workspace) and
// db-20260911153331378-7dd5642b (recorded hosted history). Both preserve originals.
// 87-migration repair execution: db-20260911155810914-c71ff4bd (workspace)
// and db-20260911160044438-88b41118 (recorded hosted); 54 files / 2,761 assertions.
// These pins identify the reviewed input; every later run must execute again.
export const reviewedReleaseSqlExtension = Object.freeze({
  "supabase/migrations/20260911155000_legacy_section_repair_budget.sql": "2c461e68e2dd68d2c1aebe44bba10ac880fa89b450ff7503914fe0ecade1f06b",
  "supabase/migrations/20260911153000_access_read_volatility_and_docx_scope.sql": "64a597b22a01363739ff8c3d71040139154a4e879f981d565f3092b22bcb0a87",
  "supabase/migrations/20260910060401_dormant_docx_source_binding.sql": "ab8a483af52c9bd246f36db75661d202dc3b73ead31dbd53e218382ff581bbd2",
  "supabase/migrations/20260911130803_effective_owner_product_access.sql": "9eeed10ba483ce6625dc445c7c96b54ec063a867cc936d64f04b4930e1b30d5d",
  "supabase/migrations/20260911143000_legacy_generation_failure_budget.sql": "5e25ca05ccabb1dd4be7a1d85f7c95fb905512961d8ce3b762135836a8a382d1",
  "supabase/migrations/20260911151000_captured_generation_failure_budget.sql": "11e33e0f3670aaa8d8bd79c5aa49a232cad362aa00022e96034784c42b99df58",
  "supabase/tests/docx_source_binding.test.sql": "1a6e8305efa1b4721fb7de3dd9adee302012c1ba8023a0cf19df44e26d536e98",
  "supabase/tests/effective_product_access.test.sql": "a295267f990bd50d371cce81ec920588c3c16f85883af51356eec3f14ab9dde9",
  "supabase/tests/generation_failure_budget.test.sql": "81d2d40ce61da4516992e5a7589e8a3e034ae6908fec6ddea83460e328958bfb",
  "supabase/tests/captured_generation_failure_budget.test.sql": "241235af5f9f36e43b5ddfc686000f0adb0dbb308a527983af92f7d8ad8a2912"
});

export function selectReviewedReleaseSql(historicalManifest, actualManifest) {
  if (Object.keys(actualManifest).length === Object.keys(historicalManifest).length) {
    assert.deepEqual(actualManifest,historicalManifest,"Upgrade requires the exact reviewed SQL manifest");
    return { manifest:historicalManifest, additionalHeldSql:{} };
  }
  for (const file of Object.keys(reviewedReleaseSqlExtension)) {
    assert.ok(!Object.hasOwn(historicalManifest,file),"Release extension cannot replace historical SQL");
  }
  const manifest={...historicalManifest,...reviewedReleaseSqlExtension};
  assert.deepEqual(actualManifest,manifest,"Upgrade requires the exact reviewed SQL manifest");
  return { manifest, additionalHeldSql:reviewedReleaseSqlExtension };
}
