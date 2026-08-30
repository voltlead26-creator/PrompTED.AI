import { assert, assertEquals } from "jsr:@std/assert";
import { DIPS } from "./document-intelligence-profiles.ts";
import { validateDocumentInformationContract } from "./document-placeholder-policy.ts";

// This gate deliberately assesses each resolved profile independently. Category-level
// or shared-map success is not accepted as evidence that an individual DIP meets Resume depth.
const PROFILES = [
  "workplace-policy",
  "sop",
  "offer-letter",
  "terms-of-employment",
  "induction-manual",
  "onboarding-checklist",
] as const;

const REVIEW_AREAS = [
  "contract completeness",
  "intake and context reuse",
  "generation resilience",
  "factual safety",
  "placeholder integrity",
  "resolution behaviour",
  "proofread behaviour",
  "workspace persistence",
  "issue navigation",
  "export behaviour",
  "accessibility and recovery",
  "regression and release evidence",
] as const;

for (const key of PROFILES) {
  Deno.test(`${key} independently matches the Resume contract and 12-point review benchmark`, () => {
    const profile = DIPS.find((candidate) => candidate.key === key);
    assert(profile, `Missing profile ${key}`);
    assert(
      profile.informationContract,
      `${key} lacks its per-profile information contract`,
    );
    assert(
      profile.internalReview,
      `${key} lacks its per-profile internal review`,
    );
    assertEquals(profile.informationContract.status, "complete");
    assertEquals(
      validateDocumentInformationContract(key, profile.informationContract),
      [],
    );
    assertEquals(profile.internalReview.status, "passed");
    assertEquals(profile.internalReview.criteria.length, 12);

    for (const area of REVIEW_AREAS) {
      assert(
        profile.internalReview.criteria.some((criterion) =>
          criterion.startsWith(`${area}:`)
        ),
        `${key} failed review area: ${area}`,
      );
    }

    for (const section of profile.informationContract.sections) {
      assert(
        section.sectionKey.trim().length > 0,
        `${key} has unnamed section`,
      );
      assert(
        section.requiredInformation.length > 0,
        `${key}:${section.sectionKey} has no defined required-information decisions`,
      );
      for (const item of section.requiredInformation) {
        assert(item.key.trim().length > 0);
        assert(item.label.trim().length > 0);
        assert(item.factType.trim().length > 0);
        assert(item.placeholderLabel.trim().length > 0);
        assert(item.question.trim().length > 0);
        assert(typeof item.requiredForExport === "boolean");
        assert(
          item.sharedResolutionKey?.trim().length,
          `${key}:${item.key} lacks shared-resolution decision`,
        );
        assert(Array.isArray(item.neutralReplacementOptions));
        assert("neutralReplacementOptions" in item);
      }

      const allFactsMissingOutput = section.requiredInformation
        .map((item) => `[${item.placeholderLabel}]`)
        .join(" ")
        .trim();
      assert(
        allFactsMissingOutput.length > 0,
        `${key}:${section.sectionKey} can become blank when all facts are missing`,
      );
    }
  });
}
