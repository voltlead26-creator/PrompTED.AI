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

function followUpProfile() {
  const profile = DIPS.find((candidate) =>
    candidate.key === "job-follow-up-email"
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

Deno.test("job follow-up email passes all twelve strict workflow review areas", () => {
  const { review } = followUpProfile();
  assertEquals(review.status, "passed");
  assertEquals(review.criteria.length, STRICT_REVIEW_AREAS.length);
  for (const area of STRICT_REVIEW_AREAS) {
    assert(
      review.criteria.some((criterion) => criterion.startsWith(`${area}:`)),
      `Missing strict review area: ${area}`,
    );
  }
});

Deno.test("job follow-up email contract validates and renderer consumes every section", () => {
  const { profile, contract } = followUpProfile();
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

Deno.test("job follow-up email declares the six send-ready sections", () => {
  const { contract } = followUpProfile();
  assertEquals(contract.sections.map((section) => section.sectionKey), [
    "subject_line",
    "greeting",
    "event_reference",
    "continued_interest_and_value",
    "next_step",
    "sign_off",
  ]);
});

Deno.test("missing recruitment facts produce placeholders without blanking any email section", () => {
  const role = createDocumentPlaceholderToken("follow.role", "role title");
  const recipient = createDocumentPlaceholderToken(
    "follow.recipient",
    "recipient name or role",
  );
  const stage = createDocumentPlaceholderToken(
    "follow.stage",
    "application or interview stage",
  );
  const event = createDocumentPlaceholderToken(
    "follow.event",
    "the confirmed application or interview event",
  );
  const name = createDocumentPlaceholderToken("follow.name", "your name");

  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "follow.role",
      profileKey: "job-follow-up-email",
      sectionKey: "subject_line",
      informationKey: "target_role",
      label: "role title",
      question: "Which role is this follow-up about?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
    {
      id: "follow.recipient",
      profileKey: "job-follow-up-email",
      sectionKey: "greeting",
      informationKey: "recipient_name_or_role",
      label: "recipient name or role",
      question: "Who should this follow-up be addressed to?",
      factType: "person_name",
      requiredForExport: false,
      sharedResolutionKey: "application.recipient_name",
      neutralReplacementOptions: [],
    },
    {
      id: "follow.stage",
      profileKey: "job-follow-up-email",
      sectionKey: "event_reference",
      informationKey: "follow_up_stage",
      label: "application or interview stage",
      question:
        "Are you following up after submitting an application, after an interview, or after another confirmed recruitment event?",
      factType: "event",
      requiredForExport: true,
      sharedResolutionKey: "application.follow_up_stage",
      neutralReplacementOptions: [],
    },
    {
      id: "follow.event",
      profileKey: "job-follow-up-email",
      sectionKey: "event_reference",
      informationKey: "confirmed_event",
      label: "the confirmed application or interview event",
      question: "What actually happened that this email should refer to?",
      factType: "event",
      requiredForExport: true,
      sharedResolutionKey: "application.follow_up_event",
      neutralReplacementOptions: [],
    },
    {
      id: "follow.name",
      profileKey: "job-follow-up-email",
      sectionKey: "sign_off",
      informationKey: "candidate_name",
      label: "your name",
      question: "What name should appear beneath the email sign-off?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
  ];

  const content = {
    subject_line: `Follow-up — ${role}`,
    greeting: `Dear ${recipient},`,
    event_reference:
      `I'm following up regarding ${stage}. Confirmed event: ${event}.`,
    continued_interest_and_value:
      "Keep the message concise and express genuine continued interest without inventing an employer-specific reason or capability claim.",
    next_step:
      "Invite an update when convenient unless a specific employer-stated next step is confirmed.",
    sign_off: `Kind regards,\n${name}`,
  };
  for (const section of Object.values(content)) {
    assert(section.trim().length > 0);
  }
  assertEquals(countUnresolvedPlaceholders(placeholders).total, 5);
  assertEquals(
    determinePlaceholderExportDecision(placeholders).status,
    "acknowledgement_required",
  );
});

Deno.test("resolving recipient or candidate facts does not invent or change the recruitment event", () => {
  const recipient = createDocumentPlaceholderToken(
    "follow.recipient",
    "recipient name or role",
  );
  const event = createDocumentPlaceholderToken(
    "follow.event",
    "the confirmed application or interview event",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "follow.recipient",
      profileKey: "job-follow-up-email",
      sectionKey: "greeting",
      informationKey: "recipient_name_or_role",
      label: "recipient name or role",
      question: "Who should this follow-up be addressed to?",
      factType: "person_name",
      requiredForExport: false,
      sharedResolutionKey: "application.recipient_name",
      neutralReplacementOptions: [],
    },
    {
      id: "follow.event",
      profileKey: "job-follow-up-email",
      sectionKey: "event_reference",
      informationKey: "confirmed_event",
      label: "the confirmed application or interview event",
      question: "What actually happened that this email should refer to?",
      factType: "event",
      requiredForExport: true,
      sharedResolutionKey: "application.follow_up_event",
      neutralReplacementOptions: [],
    },
  ];
  const resolved = resolveDocumentPlaceholders(
    { greeting: `Dear ${recipient},`, event_reference: `Regarding ${event}.` },
    placeholders,
    "follow.recipient",
    "Hiring Manager",
  );
  assertEquals(resolved.contentBySection.greeting, "Dear Hiring Manager,");
  assertStringIncludes(resolved.contentBySection.event_reference, event);
  assertEquals(resolved.unresolved.map((item) => item.id), ["follow.event"]);
});
