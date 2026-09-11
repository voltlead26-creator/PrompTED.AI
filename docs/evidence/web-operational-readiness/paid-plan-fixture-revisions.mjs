import assert from "node:assert/strict";

// Reviewed 11-12 September 2026: real subscription fixture inserts and an
// independent operation identity for the retry-exhaustion scenario. Existing
// scenario assertions are preserved; cumulative-budget coverage is separate.
// Historical JSON baselines and every migration hash remain immutable. This
// explicit test-input revision does not relabel previous execution evidence.
export const paidPlanFixtureRevisions = Object.freeze({
  "supabase/tests/legacy_document_audit_binding.test.sql": Object.freeze({
    before: "878ffb2325dd55e738f621d507200f4daa6861f6ad3e5d5a26d765e8f8361a15",
    after: "e3e95490dc72a0798c4696633b95a36ce63a76da29f2ed71b6ac4d54c7a65b54",
  }),
  "supabase/tests/legacy_generation_policy_binding.test.sql": Object.freeze({
    before: "35d2a634bb9c7534eaa9f73287bb4fe3fde1a9306f2e3eaea6ea4e151a9e1fb2",
    after: "03a2692dedae219c27e3ce5dc0ebd98ad7c3ee4201d5a43e420fa516eec483ea",
  }),
  "supabase/tests/legacy_model_accounting_and_replay.test.sql": Object.freeze({
    before: "420b5402cd138e5b7e877a1b8f27e00947465ac64d60666ade69043c0b0b1959",
    after: "d3f012961fe1928c0eccad0e6a27609caefa4ddc268767d96ca65b2f78b84e52",
  }),
});

export function withPaidPlanFixtures(historicalManifest) {
  const revised = { ...historicalManifest };
  for (const [file, revision] of Object.entries(paidPlanFixtureRevisions)) {
    if (!Object.hasOwn(revised, file)) continue;
    assert.equal(revised[file], revision.before, `Unexpected historical fixture: ${file}`);
    revised[file] = revision.after;
  }
  return revised;
}
