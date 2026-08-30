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

function interviewPrepProfile() {
  const profile = DIPS.find((candidate) =>
    candidate.key === "interview-prep-questions"
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

Deno.test("interview preparation questions pass all twelve strict workflow review areas", () => {
  const { review } = interviewPrepProfile();
  assertEquals(review.status, "passed");
  assertEquals(review.criteria.length, STRICT_REVIEW_AREAS.length);
  for (const area of STRICT_REVIEW_AREAS) {
    assert(
      review.criteria.some((criterion) => criterion.startsWith(`${area}:`)),
      `Missing strict review area: ${area}`,
    );
  }
});

Deno.test("interview preparation contract validates and renderer consumes every section", () => {
  const { profile, contract } = interviewPrepProfile();
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

Deno.test("interview preparation declares the complete seven-section workflow", () => {
  const { contract } = interviewPrepProfile();
  assertEquals(contract.sections.map((section) => section.sectionKey), [
    "role_and_evidence_map",
    "opening_and_motivation_questions",
    "behavioural_questions",
    "role_specific_questions",
    "difficult_question_preparation",
    "questions_to_ask_interviewer",
    "final_preparation_checklist",
  ]);
});

Deno.test("missing role and evidence facts produce interactive preparation rather than blank sections", () => {
  const role = createDocumentPlaceholderToken("interview.role", "target role");
  const evidence = createDocumentPlaceholderToken(
    "interview.evidence",
    "a confirmed experience example",
  );
  const result = createDocumentPlaceholderToken(
    "interview.result",
    "the confirmed result",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "interview.role",
      profileKey: "interview-prep-questions",
      sectionKey: "role_and_evidence_map",
      informationKey: "target_role",
      label: "target role",
      question: "What role are you preparing to interview for?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
    {
      id: "interview.evidence",
      profileKey: "interview-prep-questions",
      sectionKey: "role_and_evidence_map",
      informationKey: "candidate_evidence",
      label: "a confirmed experience example",
      question:
        "Which real achievement, responsibility or situation should your interview answers draw from?",
      factType: "achievement",
      requiredForExport: false,
      sharedResolutionKey: "candidate.interview_evidence",
      neutralReplacementOptions: [],
    },
    {
      id: "interview.result",
      profileKey: "interview-prep-questions",
      sectionKey: "behavioural_questions",
      informationKey: "confirmed_result",
      label: "the confirmed result",
      question: "What happened as a result of your actions in that example?",
      factType: "achievement",
      requiredForExport: false,
      sharedResolutionKey: "candidate.primary_star_result",
      neutralReplacementOptions: [],
    },
  ];

  const content = {
    role_and_evidence_map:
      `Target role: ${role}\nEvidence to confirm: ${evidence}`,
    opening_and_motivation_questions:
      "Practise a concise introduction and explain your genuine motivation without inventing employer-specific reasons.",
    behavioural_questions:
      `Prepare likely behavioural questions and anchor the answer to confirmed actions. Result: ${result}`,
    role_specific_questions:
      "Prepare likely role-specific questions from the confirmed responsibilities and label them as preparation, not employer-confirmed questions.",
    difficult_question_preparation:
      "Identify difficult topics and prepare truthful, concise framing without manufacturing a weakness or past event.",
    questions_to_ask_interviewer:
      "Prepare useful questions about priorities, success measures, team context and next steps where those topics are appropriate.",
    final_preparation_checklist:
      "Review evidence, logistics, questions and concise answer structure before the interview.",
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

Deno.test("resolving candidate evidence preserves speculative-question labels and unrelated sections", () => {
  const evidence = createDocumentPlaceholderToken(
    "interview.evidence",
    "a confirmed experience example",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "interview.evidence",
      profileKey: "interview-prep-questions",
      sectionKey: "role_and_evidence_map",
      informationKey: "candidate_evidence",
      label: "a confirmed experience example",
      question:
        "Which real achievement, responsibility or situation should your interview answers draw from?",
      factType: "achievement",
      requiredForExport: false,
      sharedResolutionKey: "candidate.interview_evidence",
      neutralReplacementOptions: [],
    },
  ];
  const result = resolveDocumentPlaceholders(
    {
      role_and_evidence_map: `Evidence: ${evidence}`,
      role_specific_questions:
        "Likely preparation question: How would you approach the confirmed responsibilities of this role?",
    },
    placeholders,
    "interview.evidence",
    "Reduced picking errors by 31% through barcode verification",
  );
  assertStringIncludes(
    result.contentBySection.role_and_evidence_map,
    "Reduced picking errors by 31% through barcode verification",
  );
  assertEquals(
    result.contentBySection.role_specific_questions,
    "Likely preparation question: How would you approach the confirmed responsibilities of this role?",
  );
  assertEquals(result.unresolved, []);
});
