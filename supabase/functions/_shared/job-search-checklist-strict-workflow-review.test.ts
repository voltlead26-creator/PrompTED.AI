import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  auditProfilePlaceholderRules,
  DIPS,
  renderProfile,
} from "./document-intelligence-profiles.ts";
import {
  countUnresolvedPlaceholders,
  createDocumentPlaceholderToken,
  determinePlaceholderExportDecision,
  resolveDocumentPlaceholders,
  type UnresolvedDocumentPlaceholder,
  validateDocumentInformationContract,
} from "./document-placeholder-policy.ts";

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

function checklistProfile() {
  const profile = DIPS.find((candidate) =>
    candidate.key === "job-search-checklist"
  );
  assert(profile);
  assert(profile.informationContract);
  assert(profile.internalReview);
  return {
    profile,
    contract: profile.informationContract,
    review: profile.internalReview,
  };
}

Deno.test("job-search checklist passes all twelve strict workflow review areas", () => {
  const { review } = checklistProfile();
  assertEquals(review.status, "passed");
  assertEquals(review.criteria.length, STRICT_REVIEW_AREAS.length);
  for (const area of STRICT_REVIEW_AREAS) {
    assert(
      review.criteria.some((criterion) => criterion.startsWith(`${area}:`)),
      `Missing strict review area: ${area}`,
    );
  }
});

Deno.test("job-search checklist contract validates and renderer consumes every section", () => {
  const { profile, contract } = checklistProfile();
  assertEquals(validateDocumentInformationContract(profile.key, contract), []);
  assertEquals(auditProfilePlaceholderRules(profile), []);
  const rendered = renderProfile(profile, "document");
  assertStringIncludes(rendered, "UNIVERSAL PLACEHOLDER RULES");
  assertStringIncludes(
    rendered,
    "TEMPLATE INFORMATION CONTRACT — status complete",
  );
  for (const section of contract.sections) {
    assertStringIncludes(rendered, section.sectionKey);
  }
});

Deno.test("job-search checklist covers every executable action group", () => {
  const { contract } = checklistProfile();
  assertEquals(contract.sections.map((section) => section.sectionKey), [
    "objective_and_cadence",
    "setup_and_evidence_preparation",
    "role_discovery",
    "role_screening",
    "tailoring_and_submission",
    "tracking_and_follow_up",
    "interview_preparation",
    "weekly_review",
  ]);
});

Deno.test("missing targeting facts remain interactive and never require blank checklist sections", () => {
  const target = createDocumentPlaceholderToken(
    "search.target",
    "target role or direction",
  );
  const location = createDocumentPlaceholderToken(
    "search.location",
    "preferred location or work mode",
  );
  const time = createDocumentPlaceholderToken(
    "search.time",
    "time available each week",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "search.target",
      profileKey: "job-search-checklist",
      sectionKey: "objective_and_cadence",
      informationKey: "target_role_or_direction",
      label: "target role or direction",
      question:
        "What role, field or type of work should this job-search plan target?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
    {
      id: "search.location",
      profileKey: "job-search-checklist",
      sectionKey: "objective_and_cadence",
      informationKey: "location_or_work_mode",
      label: "preferred location or work mode",
      question:
        "Which locations or work modes should the search include, such as on-site, hybrid or remote?",
      factType: "location",
      requiredForExport: false,
      sharedResolutionKey: "application.search_location",
      neutralReplacementOptions: [],
    },
    {
      id: "search.time",
      profileKey: "job-search-checklist",
      sectionKey: "objective_and_cadence",
      informationKey: "weekly_time_available",
      label: "time available each week",
      question:
        "How much time can you realistically spend on the job search each week?",
      factType: "other",
      requiredForExport: false,
      sharedResolutionKey: "application.weekly_search_time",
      neutralReplacementOptions: [],
    },
  ];
  const content = {
    objective_and_cadence:
      `Target: ${target}\nLocation/work mode: ${location}\nCadence: ${time}`,
    setup_and_evidence_preparation:
      "Review the application materials you already have and identify evidence gaps.",
    role_discovery:
      "Search suitable channels and save roles that match the confirmed target and constraints.",
    role_screening:
      "Screen each role against requirements and confirmed non-negotiables before tailoring.",
    tailoring_and_submission:
      "Tailor truthful evidence to each selected role and record the submission when it actually occurs.",
    tracking_and_follow_up:
      "Track real applications and follow employer-stated timing or a reasonable professional follow-up cadence.",
    interview_preparation:
      "If invited to interview, prepare evidence against the confirmed role requirements.",
    weekly_review:
      "Review what produced useful opportunities and adjust the next week's actions.",
  };
  for (const section of Object.values(content)) {
    assert(section.trim().length > 0);
  }
  assertEquals(countUnresolvedPlaceholders(placeholders).total, 3);
  assertEquals(
    determinePlaceholderExportDecision(placeholders).status,
    "acknowledgement_required",
  );
});

Deno.test("resolving the target role preserves all unrelated checklist wording", () => {
  const target = createDocumentPlaceholderToken(
    "search.target",
    "target role or direction",
  );
  const time = createDocumentPlaceholderToken(
    "search.time",
    "time available each week",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "search.target",
      profileKey: "job-search-checklist",
      sectionKey: "objective_and_cadence",
      informationKey: "target_role_or_direction",
      label: "target role or direction",
      question:
        "What role, field or type of work should this job-search plan target?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
    {
      id: "search.time",
      profileKey: "job-search-checklist",
      sectionKey: "objective_and_cadence",
      informationKey: "weekly_time_available",
      label: "time available each week",
      question:
        "How much time can you realistically spend on the job search each week?",
      factType: "other",
      requiredForExport: false,
      sharedResolutionKey: "application.weekly_search_time",
      neutralReplacementOptions: [],
    },
  ];
  const result = resolveDocumentPlaceholders(
    {
      objective_and_cadence: `Target: ${target}\nTime: ${time}`,
      role_discovery: "Keep this action wording unchanged.",
    },
    placeholders,
    "search.target",
    "Business Centre Manager",
  );
  assertStringIncludes(
    result.contentBySection.objective_and_cadence,
    "Business Centre Manager",
  );
  assertStringIncludes(result.contentBySection.objective_and_cadence, time);
  assertEquals(
    result.contentBySection.role_discovery,
    "Keep this action wording unchanged.",
  );
  assertEquals(result.unresolved.map((item) => item.id), ["search.time"]);
});
