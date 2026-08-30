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

const PROFILE_KEY = "business-email";
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

Deno.test("business-email reaches Resume-standard information-contract completeness", () => {
  const profile = DIPS.find((candidate) => candidate.key === PROFILE_KEY);
  assert(profile, "Missing Business Email profile");
  assert(
    profile.informationContract,
    "Missing Business Email information contract",
  );
  assert(profile.internalReview, "Missing Business Email internal review");
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
      `business-email missing strict review area: ${area}`,
    );
  }
});

Deno.test("business-email renders every section and never blanks output when all facts are missing", () => {
  const profile = DIPS.find((candidate) => candidate.key === PROFILE_KEY);
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
          `${PROFILE_KEY}.${section.sectionKey}.${index}`,
          item.placeholderLabel,
        )
      ).join(" ")
      : "Complete conventional wording";
    assert(
      simulatedSection.trim().length > 0,
      `${PROFILE_KEY}:${section.sectionKey} became blank`,
    );
    for (const item of section.requiredInformation) {
      assert(
        item.question.trim().length > 0,
        `${PROFILE_KEY}:${section.sectionKey}:${item.key} lacks clarification question`,
      );
      assert(Array.isArray(item.neutralReplacementOptions));
    }
  }
});

Deno.test("business-email contract preserves a usable call to action without inventing optional facts", () => {
  const profile = DIPS.find((candidate) => candidate.key === PROFILE_KEY);
  assert(profile?.informationContract);
  const action = profile.informationContract.sections.find((section) =>
    section.sectionKey === "call_to_action"
  );
  assert(action);
  const requestedAction = action.requiredInformation.find((item) =>
    item.key === "requested_action"
  );
  const deadline = action.requiredInformation.find((item) =>
    item.key === "deadline"
  );
  const nextStep = action.requiredInformation.find((item) =>
    item.key === "next_step"
  );
  assert(requestedAction?.requiredForExport);
  assertEquals(requestedAction.neutralReplacementOptions.length, 0);
  assert(
    deadline && !deadline.requiredForExport &&
      deadline.neutralReplacementOptions.length > 0,
  );
  assert(
    nextStep && !nextStep.requiredForExport &&
      nextStep.neutralReplacementOptions.length > 0,
  );
});
