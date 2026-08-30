import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  auditProfilePlaceholderRules,
  DIPS,
  renderProfile,
} from "./document-intelligence-profiles.ts";
import {
  createDocumentPlaceholderToken,
  validateDocumentInformationContract,
} from "./document-placeholder-policy.ts";

const PROFILE_KEYS = [
  "pay-rise-request",
  "promotion-case",
  "personal-statement",
  "education-cover-letter",
  "reference-request",
] as const;

const STRICT_REVIEW_AREAS = [
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

for (const profileKey of PROFILE_KEYS) {
  Deno.test(`${profileKey} reaches Resume-standard information-contract completeness`, () => {
    const profile = DIPS.find((candidate) => candidate.key === profileKey);
    assert(profile, `Missing profile ${profileKey}`);
    assert(
      profile.informationContract,
      `Missing information contract for ${profileKey}`,
    );
    assert(profile.internalReview, `Missing internal review for ${profileKey}`);
    assertEquals(profile.informationContract.status, "complete");
    assertEquals(
      validateDocumentInformationContract(
        profile.key,
        profile.informationContract,
      ),
      [],
    );
    assertEquals(auditProfilePlaceholderRules(profile), []);
    assertEquals(profile.internalReview.status, "passed");
    assertEquals(
      profile.internalReview.criteria.length,
      STRICT_REVIEW_AREAS.length,
    );
    for (const area of STRICT_REVIEW_AREAS) {
      assert(
        profile.internalReview.criteria.some((criterion) =>
          criterion.startsWith(`${area}:`)
        ),
        `${profileKey} missing strict review area: ${area}`,
      );
    }
  });

  Deno.test(`${profileKey} renders every section and never needs blank output when all facts are missing`, () => {
    const profile = DIPS.find((candidate) => candidate.key === profileKey);
    assert(profile?.informationContract);
    const rendered = renderProfile(profile, "document");
    assertStringIncludes(rendered, "UNIVERSAL PLACEHOLDER RULES");
    assertStringIncludes(
      rendered,
      "TEMPLATE INFORMATION CONTRACT — status complete",
    );

    for (const section of profile.informationContract.sections) {
      assertStringIncludes(rendered, section.sectionKey);
      const simulatedSection = section.requiredInformation.length
        ? section.requiredInformation.map((item, index) =>
          createDocumentPlaceholderToken(
            `${profileKey}.${section.sectionKey}.${index}`,
            item.placeholderLabel,
          )
        ).join(" ")
        : "Complete conventional wording";
      assert(
        simulatedSection.trim().length > 0,
        `${profileKey}:${section.sectionKey} became blank`,
      );
      for (const item of section.requiredInformation) {
        assert(
          item.question.trim().length > 0,
          `${profileKey}:${section.sectionKey}:${item.key} lacks clarification question`,
        );
        assert(Array.isArray(item.neutralReplacementOptions));
      }
    }
  });
}
