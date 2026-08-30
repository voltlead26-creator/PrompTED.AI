import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  auditProfilePlaceholderRules,
  DIPS,
  renderProfile,
} from "./document-intelligence-profiles.ts";
import {
  applyApprovedNeutralReplacement,
  applyDeclaredAutomaticFallback,
  countUnresolvedPlaceholders,
  createDocumentPlaceholderToken,
  determinePlaceholderExportDecision,
  parseDocumentPlaceholderTokens,
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

function resumeProfile() {
  const resume = DIPS.find((profile) => profile.key === "resume");
  assert(resume);
  return resume;
}

Deno.test("resume passes all twelve strict workflow review areas", () => {
  const resume = resumeProfile();
  const review = resume.internalReview;
  assert(review);
  assertEquals(review.status, "passed");
  assertEquals(review.criteria.length, STRICT_REVIEW_AREAS.length);
  for (const area of STRICT_REVIEW_AREAS) {
    assert(
      review.criteria.some((criterion) => criterion.startsWith(`${area}:`)),
      `Missing strict review area: ${area}`,
    );
  }
});

Deno.test("resume contract remains complete, contradiction-free and renderer-consumed", () => {
  const resume = resumeProfile();
  const contract = resume.informationContract;
  assert(contract);
  assertEquals(validateDocumentInformationContract(resume.key, contract), []);
  assertEquals(auditProfilePlaceholderRules(resume), []);
  const rendered = renderProfile(resume, "document");
  assertStringIncludes(rendered, "UNIVERSAL PLACEHOLDER RULES");
  assertStringIncludes(
    rendered,
    "TEMPLATE INFORMATION CONTRACT — status complete",
  );
  for (const section of contract.sections) {
    assertStringIncludes(rendered, section.sectionKey);
  }
});

Deno.test("resume supports multiple independent unresolved facts and section counts", () => {
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "resume.contact.full_name.1",
      profileKey: "resume",
      sectionKey: "contact_details",
      informationKey: "full_name",
      label: "your full name",
      question: "What full name should appear at the top of your resume?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "resume.contact.email.1",
      profileKey: "resume",
      sectionKey: "contact_details",
      informationKey: "email_address",
      label: "your email address",
      question: "What email address should employers use to contact you?",
      factType: "contact_detail",
      requiredForExport: true,
      sharedResolutionKey: "candidate.email",
      neutralReplacementOptions: [],
    },
    {
      id: "resume.summary.target_role.1",
      profileKey: "resume",
      sectionKey: "summary",
      informationKey: "target_role",
      label: "target role or field",
      question: "What role or type of work are you targeting?",
      factType: "role_title",
      requiredForExport: true,
      sharedResolutionKey: "application.target_role",
      neutralReplacementOptions: [],
    },
  ];
  assertEquals(countUnresolvedPlaceholders(placeholders), {
    total: 3,
    requiredForExport: 3,
    automaticFallbackAvailable: 0,
    neutralReplacementAvailable: 0,
    bySection: { contact_details: 2, summary: 1 },
  });
  assertEquals(
    determinePlaceholderExportDecision(placeholders).status,
    "acknowledgement_required",
  );
});

Deno.test("resume shared resolution updates matching semantic occurrences only", () => {
  const fullNameA = createDocumentPlaceholderToken(
    "resume.name.header",
    "your full name",
  );
  const fullNameB = createDocumentPlaceholderToken(
    "resume.name.footer",
    "your full name",
  );
  const email = createDocumentPlaceholderToken(
    "resume.email",
    "your email address",
  );
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "resume.name.header",
      profileKey: "resume",
      sectionKey: "contact_details",
      informationKey: "full_name",
      label: "your full name",
      question: "What full name should appear at the top of your resume?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "resume.name.footer",
      profileKey: "resume",
      sectionKey: "referees",
      informationKey: "full_name",
      label: "your full name",
      question: "What full name should appear in the declaration?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "resume.email",
      profileKey: "resume",
      sectionKey: "contact_details",
      informationKey: "email_address",
      label: "your email address",
      question: "What email address should employers use to contact you?",
      factType: "contact_detail",
      requiredForExport: true,
      sharedResolutionKey: "candidate.email",
      neutralReplacementOptions: [],
    },
  ];
  const result = resolveDocumentPlaceholders(
    {
      contact_details: `${fullNameA} | ${email}`,
      referees: `Prepared for ${fullNameB}`,
    },
    placeholders,
    "resume.name.header",
    "Alex Morgan",
  );
  assertEquals(
    result.contentBySection.contact_details,
    `Alex Morgan | ${email}`,
  );
  assertEquals(result.contentBySection.referees, "Prepared for Alex Morgan");
  assertEquals(result.unresolved.map((item) => item.id), ["resume.email"]);
});

Deno.test("resume automatic and user-selected neutral fallbacks remain distinct", () => {
  const token = createDocumentPlaceholderToken(
    "resume.referees",
    "referee details",
  );
  const placeholder: UnresolvedDocumentPlaceholder = {
    id: "resume.referees",
    profileKey: "resume",
    sectionKey: "referees",
    informationKey: "referee_details",
    label: "referee details",
    question:
      "Would you like to list a referee or use an availability statement?",
    factType: "reference",
    automaticFallback: "References available on request",
    requiredForExport: false,
    sharedResolutionKey: "candidate.referees",
    neutralReplacementOptions: [
      {
        id: "references-on-request",
        label: "References available on request",
        value: "References available on request",
        suitability:
          "Suitable when the user does not want to publish referee details.",
        clearsExportWarning: true,
        regenerateSurroundingWording: false,
      },
    ],
  };
  const automatic = applyDeclaredAutomaticFallback(
    { referees: token },
    [placeholder],
    placeholder.id,
  );
  assertEquals(
    automatic.contentBySection.referees,
    "References available on request",
  );

  const neutral = applyApprovedNeutralReplacement(
    { referees: token },
    [placeholder],
    placeholder.id,
    "references-on-request",
  );
  assertEquals(
    neutral.contentBySection.referees,
    "References available on request",
  );
});

Deno.test("resume malformed tokens remain visible instead of being silently removed", () => {
  const content = "Name: {{TED_PLACEHOLDER:bad id:your name}}";
  assertEquals(parseDocumentPlaceholderTokens(content), []);
  assertStringIncludes(content, "{{TED_PLACEHOLDER:bad id:your name}}");
});
