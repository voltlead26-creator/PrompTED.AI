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
  "workplace-policy",
  "sop",
  "offer-letter",
  "terms-of-employment",
  "induction-manual",
  "onboarding-checklist",
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
  Deno.test(`${profileKey} matches the Resume benchmark`, () => {
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
        `${profileKey} missing review area ${area}`,
      );
    }

    for (const section of profile.informationContract.sections) {
      assert(section.sectionKey.trim().length > 0);
      for (const item of section.requiredInformation) {
        // Resume-standard nine decisions for every required fact:
        // key, label, factType, placeholderLabel, question, automatic-fallback
        // decision, export requirement, shared-resolution key, neutral replacements.
        assert(item.key.trim().length > 0);
        assert(item.label.trim().length > 0);
        assert(item.factType.trim().length > 0);
        assert(item.placeholderLabel.trim().length > 0);
        assert(item.question.trim().length > 0);
        assert(
          item.automaticFallback === undefined ||
            item.automaticFallback.trim().length > 0,
          `${profileKey}:${section.sectionKey}:${item.key} has an invalid automatic-fallback decision`,
        );
        assert(typeof item.requiredForExport === "boolean");
        assert(
          item.sharedResolutionKey?.trim().length,
          `${profileKey}:${section.sectionKey}:${item.key} lacks a shared-resolution decision`,
        );
        assert(Array.isArray(item.neutralReplacementOptions));
      }
    }
  });

  Deno.test(`${profileKey} never needs blank output when every fact is unresolved`, () => {
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
      }
    }
  });
}
