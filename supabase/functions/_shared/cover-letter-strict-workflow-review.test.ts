import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  auditProfilePlaceholderRules,
  DIPS,
  renderProfile,
} from "./document-intelligence-profiles.ts";
import {
  applyApprovedNeutralReplacement,
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

function coverLetterProfile() {
  const profile = DIPS.find((candidate) => candidate.key === "cover-letter");
  assert(profile);
  assert(profile.informationContract);
  assert(profile.internalReview);
  return {
    profile,
    contract: profile.informationContract,
    review: profile.internalReview,
  };
}

Deno.test("cover letter passes all twelve strict workflow review areas", () => {
  const { review } = coverLetterProfile();
  assertEquals(review.status, "passed");
  assertEquals(review.criteria.length, STRICT_REVIEW_AREAS.length);
  for (const area of STRICT_REVIEW_AREAS) {
    assert(
      review.criteria.some((criterion) => criterion.startsWith(`${area}:`)),
      `Missing strict review area: ${area}`,
    );
  }
});

Deno.test("cover letter contract validates and is consumed by the renderer", () => {
  const { profile, contract } = coverLetterProfile();
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

Deno.test("cover letter declares all expected workflow sections", () => {
  const { contract } = coverLetterProfile();
  assertEquals(
    contract.sections.map((section) => section.sectionKey),
    [
      "sender_and_date",
      "recipient_and_salutation",
      "opening",
      "evidence_of_fit",
      "employer_motivation",
      "closing_and_signature",
    ],
  );
});

Deno.test("unknown recipient uses only a declared neutral salutation", () => {
  const token = createDocumentPlaceholderToken(
    "cover.recipient.1",
    "recipient name",
  );
  const placeholder: UnresolvedDocumentPlaceholder = {
    id: "cover.recipient.1",
    profileKey: "cover-letter",
    sectionKey: "recipient_and_salutation",
    informationKey: "recipient_name",
    label: "recipient name",
    question: "Who should the cover letter be addressed to?",
    factType: "person_name",
    requiredForExport: false,
    sharedResolutionKey: "application.recipient_name",
    neutralReplacementOptions: [
      {
        id: "hiring-manager",
        label: "Hiring Manager",
        value: "Hiring Manager",
        suitability:
          "Use for a standard employment application when the recipient name is unknown.",
        clearsExportWarning: true,
        regenerateSurroundingWording: true,
      },
    ],
  };
  const result = applyApprovedNeutralReplacement(
    { recipient_and_salutation: `Dear ${token},` },
    [placeholder],
    placeholder.id,
    "hiring-manager",
  );
  assertEquals(
    result.contentBySection.recipient_and_salutation,
    "Dear Hiring Manager,",
  );
  assertEquals(result.unresolved, []);
});

Deno.test("candidate name shared resolution updates header and signature only", () => {
  const header = createDocumentPlaceholderToken(
    "cover.name.header",
    "your full name",
  );
  const signature = createDocumentPlaceholderToken(
    "cover.name.signature",
    "your sign-off name",
  );
  const employer = createDocumentPlaceholderToken(
    "cover.employer",
    "employer name",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "cover.name.header",
      profileKey: "cover-letter",
      sectionKey: "sender_and_date",
      informationKey: "candidate_name",
      label: "your full name",
      question: "What full name should appear on the cover letter?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "cover.name.signature",
      profileKey: "cover-letter",
      sectionKey: "closing_and_signature",
      informationKey: "signoff_name",
      label: "your sign-off name",
      question: "What name should appear beneath the closing?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "cover.employer",
      profileKey: "cover-letter",
      sectionKey: "recipient_and_salutation",
      informationKey: "employer_name",
      label: "employer name",
      question: "Which employer or organisation is this application for?",
      factType: "company_name",
      requiredForExport: true,
      sharedResolutionKey: "application.employer",
      neutralReplacementOptions: [],
    },
  ];
  const result = resolveDocumentPlaceholders(
    {
      sender_and_date: header,
      recipient_and_salutation: employer,
      closing_and_signature: `Kind regards,\n${signature}`,
    },
    placeholders,
    "cover.name.header",
    "Alex Morgan",
  );
  assertEquals(result.contentBySection.sender_and_date, "Alex Morgan");
  assertEquals(
    result.contentBySection.closing_and_signature,
    "Kind regards,\nAlex Morgan",
  );
  assertEquals(result.contentBySection.recipient_and_salutation, employer);
  assertEquals(result.unresolved.map((item) => item.id), ["cover.employer"]);
});

Deno.test("cover letter export distinguishes recipient fallback from vital evidence gaps", () => {
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "cover.recipient",
      profileKey: "cover-letter",
      sectionKey: "recipient_and_salutation",
      informationKey: "recipient_name",
      label: "recipient name",
      question: "Who should the cover letter be addressed to?",
      factType: "person_name",
      requiredForExport: false,
      neutralReplacementOptions: [
        {
          id: "hiring-manager",
          label: "Hiring Manager",
          value: "Hiring Manager",
          suitability: "Use when the recipient name is unknown.",
          clearsExportWarning: true,
          regenerateSurroundingWording: true,
        },
      ],
    },
    {
      id: "cover.evidence",
      profileKey: "cover-letter",
      sectionKey: "evidence_of_fit",
      informationKey: "candidate_evidence",
      label: "a confirmed example from your experience",
      question: "What confirmed example shows that you meet this requirement?",
      factType: "achievement",
      requiredForExport: true,
      neutralReplacementOptions: [],
    },
  ];
  assertEquals(countUnresolvedPlaceholders(placeholders), {
    total: 2,
    requiredForExport: 1,
    automaticFallbackAvailable: 0,
    neutralReplacementAvailable: 1,
    bySection: { recipient_and_salutation: 1, evidence_of_fit: 1 },
  });
  assertEquals(
    determinePlaceholderExportDecision(placeholders).status,
    "acknowledgement_required",
  );
});
