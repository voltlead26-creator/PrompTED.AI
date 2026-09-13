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
  "supabase/migrations/20260914005000_business_checkout_reservations.sql": "ddebce26117bf13ef95f63ba481b0cdd1b3b6f904b659be52c7ffb70b8bf3173",
  "supabase/tests/business_checkout_reservations.test.sql": "641abce338a76fa0d9296549f803876d303cca8fb5d8e9c37501acb353e22420",
  "supabase/migrations/20260913094000_manual_plan_persistence.sql": "c430f0e1a5525ed87f2af43b75624042e3835a2430ab5182d90a24d8553508ea",
  "supabase/tests/manual_plan_persistence.test.sql": "01eb097c720ff7239a9a1adaf73800aebf7228c84c8dba19a2113cc3364a2e77",
  "supabase/migrations/20260912070100_business_fifty_document_allowance.sql": "0b89f4f520778b750fcc3b27b949766441ef4cd16e832574717219ab0b190242",
  "supabase/migrations/20260911174506_business_matches_premium_allowance.sql": "80ca9922ebcc2a187b5cf9e9b0996cf34271be070952607006be5c713bf678e7",
  "supabase/tests/business_premium_allowance.test.sql": "98310ba760c9f3ee1e78d69d53e34e6ed2a7e6c5c0ab25767970eeab16aa11bf",
  "supabase/migrations/20260911165152_reconcile_artifact_outcome_read_privileges.sql": "9e3a2c67049e45ada0a8f8020fb0eaf9144df5969993d9c61971a8667d2ce75b",
  "supabase/tests/artifact_outcome_read_privileges.test.sql": "720665f34c89883edd837120de7df05cdd085794eb20f39a6d519d8ad3e3647d",
  "supabase/tests/owner_rpc_execute_privileges.test.sql": "f5be5201c1d709d4b37ac96930339f8ec640489c345597c6733c6dde6449ae1c",
  "supabase/migrations/20260911162022_reconcile_owner_rpc_execute_privileges.sql": "19f2c039552d462e701c6619a3225af6bbef83d3f8535bb7092cb09382b6bb4c",
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
