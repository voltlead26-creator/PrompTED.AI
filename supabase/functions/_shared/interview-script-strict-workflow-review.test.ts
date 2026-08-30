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

function interviewScriptProfile() {
  const profile = DIPS.find((candidate) =>
    candidate.key === "interview-script"
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

Deno.test("interview script passes all twelve strict workflow review areas", () => {
  const { review } = interviewScriptProfile();
  assertEquals(review.status, "passed");
  assertEquals(review.criteria.length, STRICT_REVIEW_AREAS.length);
  for (const area of STRICT_REVIEW_AREAS) {
    assert(
      review.criteria.some((criterion) => criterion.startsWith(`${area}:`)),
      `Missing strict review area: ${area}`,
    );
  }
});

Deno.test("interview script contract validates and renderer consumes every section", () => {
  const { profile, contract } = interviewScriptProfile();
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

Deno.test("interview script declares all eight rehearsal sections", () => {
  const { contract } = interviewScriptProfile();
  assertEquals(contract.sections.map((section) => section.sectionKey), [
    "opening_introduction",
    "why_this_role",
    "strength_and_capability_answers",
    "star_evidence_stories",
    "role_specific_answers",
    "difficult_question_answers",
    "candidate_questions",
    "closing",
  ]);
});

Deno.test("missing interview facts remain interactive while every script section stays non-blank", () => {
  const role = createDocumentPlaceholderToken("script.role", "target role");
  const motivation = createDocumentPlaceholderToken(
    "script.motivation",
    "your genuine reason for wanting the role",
  );
  const strength = createDocumentPlaceholderToken(
    "script.strength",
    "a confirmed strength",
  );
  const situation = createDocumentPlaceholderToken(
    "script.situation",
    "a real situation from your experience",
  );
  const actions = createDocumentPlaceholderToken(
    "script.actions",
    "the actions you personally took",
  );
  const result = createDocumentPlaceholderToken(
    "script.result",
    "the confirmed result",
  );

  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "script.role",
      profileKey: "interview-script",
      sectionKey: "opening_introduction",
      informationKey: "target_role",
      label: "target role",
      question: "What role is this interview script for?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
    {
      id: "script.motivation",
      profileKey: "interview-script",
      sectionKey: "why_this_role",
      informationKey: "role_motivation",
      label: "your genuine reason for wanting the role",
      question: "What genuinely attracts you to this role or type of work?",
      factType: "other",
      requiredForExport: false,
      sharedResolutionKey: "candidate.role_motivation",
      neutralReplacementOptions: [],
    },
    {
      id: "script.strength",
      profileKey: "interview-script",
      sectionKey: "strength_and_capability_answers",
      informationKey: "confirmed_strength",
      label: "a confirmed strength",
      question: "Which genuine strength should this answer emphasise?",
      factType: "skill",
      requiredForExport: false,
      sharedResolutionKey: "candidate.interview_strength",
      neutralReplacementOptions: [],
    },
    {
      id: "script.situation",
      profileKey: "interview-script",
      sectionKey: "star_evidence_stories",
      informationKey: "real_situation",
      label: "a real situation from your experience",
      question: "What real situation should anchor this STAR answer?",
      factType: "event",
      requiredForExport: false,
      sharedResolutionKey: "candidate.primary_star_example",
      neutralReplacementOptions: [],
    },
    {
      id: "script.actions",
      profileKey: "interview-script",
      sectionKey: "star_evidence_stories",
      informationKey: "candidate_actions",
      label: "the actions you personally took",
      question: "What did you personally do in that situation?",
      factType: "responsibility",
      requiredForExport: false,
      sharedResolutionKey: "candidate.primary_star_actions",
      neutralReplacementOptions: [],
    },
    {
      id: "script.result",
      profileKey: "interview-script",
      sectionKey: "star_evidence_stories",
      informationKey: "confirmed_result",
      label: "the confirmed result",
      question:
        "What result or outcome can you truthfully support from that example?",
      factType: "achievement",
      requiredForExport: false,
      sharedResolutionKey: "candidate.primary_star_result",
      neutralReplacementOptions: [],
    },
  ];

  const content = {
    opening_introduction:
      `Introduce your confirmed background, then connect it naturally to ${role}.`,
    why_this_role:
      `Keep the answer genuine and role-focused. Motivation to confirm: ${motivation}.`,
    strength_and_capability_answers:
      `Name ${strength}, then support it with a real example rather than a generic claim.`,
    star_evidence_stories:
      `Situation: ${situation}\nActions: ${actions}\nResult: ${result}`,
    role_specific_answers:
      "Practise likely role-specific questions from confirmed responsibilities without pretending the employer supplied them.",
    difficult_question_answers:
      "Prepare truthful framing for difficult topics and leave unknown personal facts as clarification needs rather than invented answers.",
    candidate_questions:
      "Prepare concise questions about priorities, success measures, team context and next steps where appropriate.",
    closing:
      "Close with concise confirmed interest and appreciation without inventing a promised next step.",
  };

  for (const section of Object.values(content)) {
    assert(section.trim().length > 0);
  }
  assertEquals(countUnresolvedPlaceholders(placeholders).total, 6);
  assertEquals(
    determinePlaceholderExportDecision(placeholders).status,
    "acknowledgement_required",
  );
});

Deno.test("resolving a shared target role preserves unrelated scripted answers", () => {
  const role = createDocumentPlaceholderToken("script.role", "target role");
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "script.role",
      profileKey: "interview-script",
      sectionKey: "opening_introduction",
      informationKey: "target_role",
      label: "target role",
      question: "What role is this interview script for?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
  ];
  const result = resolveDocumentPlaceholders(
    {
      opening_introduction: `I'm preparing for ${role}.`,
      candidate_questions:
        "What would success in the first six months look like?",
    },
    placeholders,
    "script.role",
    "Business Centre Manager",
  );
  assertStringIncludes(
    result.contentBySection.opening_introduction,
    "Business Centre Manager",
  );
  assertEquals(
    result.contentBySection.candidate_questions,
    "What would success in the first six months look like?",
  );
  assertEquals(result.unresolved, []);
});
