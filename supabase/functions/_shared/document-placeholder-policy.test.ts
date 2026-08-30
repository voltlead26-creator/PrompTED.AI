import { assertEquals } from "jsr:@std/assert";
import {
  applyApprovedNeutralReplacement,
  countUnresolvedPlaceholders,
  createDocumentPlaceholderToken,
  deriveClarificationQuestions,
  deriveOptionalInformation,
  deriveRequiredInformationLabels,
  findContradictoryPlaceholderRules,
  validateDocumentInformationContract,
  type DocumentInformationContract,
  type UnresolvedDocumentPlaceholder,
} from "./document-placeholder-policy.ts";

const COMPLETE_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-02",
  sections: [
    {
      sectionKey: "opening",
      requiredInformation: [
        {
          key: "recipient_name",
          label: "Recipient name",
          factType: "person_name",
          placeholderLabel: "recipient name",
          question: "Who should this document be addressed to?",
          automaticFallback: "Hiring Manager",
          requiredForExport: false,
          sharedResolutionKey: "recipient.name",
          neutralReplacementOptions: [
            {
              id: "hiring-manager",
              label: "Hiring Manager",
              value: "Hiring Manager",
              suitability: "Use when the document is a job application and the recipient name is unknown.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
            {
              id: "recruitment-team",
              label: "Recruitment Team",
              value: "Recruitment Team",
              suitability: "Use when the application is addressed to a recruitment function rather than one person.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
        {
          key: "role_title",
          label: "Role title",
          factType: "role_title",
          placeholderLabel: "role title",
          question: "What role is this document for?",
          requiredForExport: true,
          sharedResolutionKey: "application.role_title",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["Referral source", "Opening hook"],
    },
    {
      sectionKey: "closing",
      requiredInformation: [
        {
          key: "sender_name",
          label: "Sender name",
          factType: "person_name",
          placeholderLabel: "your name",
          question: "What name should appear in the sign-off?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.full_name",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["Opening hook", "Preferred contact method"],
    },
  ],
};

Deno.test("validates a complete nine-item multi-placeholder document contract", () => {
  assertEquals(validateDocumentInformationContract("cover-letter", COMPLETE_CONTRACT), []);
});

Deno.test("allows multiple placeholders in one section", () => {
  assertEquals(COMPLETE_CONTRACT.sections[0].requiredInformation.length, 2);
});

Deno.test("derives legacy profile summaries from the canonical contract", () => {
  assertEquals(deriveRequiredInformationLabels(COMPLETE_CONTRACT), [
    "Recipient name",
    "Role title",
    "Sender name",
  ]);
  assertEquals(deriveClarificationQuestions(COMPLETE_CONTRACT), [
    "Who should this document be addressed to?",
    "What role is this document for?",
    "What name should appear in the sign-off?",
  ]);
  assertEquals(deriveOptionalInformation(COMPLETE_CONTRACT), [
    "Referral source",
    "Opening hook",
    "Preferred contact method",
  ]);
});

Deno.test("rejects incomplete required-information and neutral replacement definitions", () => {
  const invalid: DocumentInformationContract = {
    status: "complete",
    sections: [
      {
        sectionKey: "body",
        optionalInformation: [],
        requiredInformation: [
          {
            key: "amount",
            label: "",
            factType: "amount",
            placeholderLabel: "",
            question: "",
            automaticFallback: "",
            requiredForExport: true,
            sharedResolutionKey: "",
            neutralReplacementOptions: [
              {
                id: "",
                label: "",
                value: "",
                suitability: "",
                clearsExportWarning: false,
                regenerateSurroundingWording: false,
              },
            ],
          },
        ],
      },
    ],
  };

  assertEquals(validateDocumentInformationContract("invoice", invalid), [
    "invoice: auditedAt is required when status is complete",
    "invoice:body:amount: label is required",
    "invoice:body:amount: placeholderLabel is required",
    "invoice:body:amount: question is required",
    "invoice:body:amount: automaticFallback must be omitted or non-empty",
    "invoice:body:amount: sharedResolutionKey must be omitted or non-empty",
    "invoice:body:amount:neutralReplacementOptions: option id is required",
    "invoice:body:amount:neutralReplacementOptions:: label is required",
    "invoice:body:amount:neutralReplacementOptions:: value is required",
    "invoice:body:amount:neutralReplacementOptions:: suitability is required",
  ]);
});

Deno.test("applies only an approved neutral replacement", () => {
  const recipient: UnresolvedDocumentPlaceholder = {
    id: "cover-letter.opening.recipient-name",
    profileKey: "cover-letter",
    sectionKey: "opening",
    informationKey: "recipient_name",
    label: "recipient name",
    question: "Who should this document be addressed to?",
    factType: "person_name",
    requiredForExport: false,
    sharedResolutionKey: "recipient.name",
    neutralReplacementOptions:
      COMPLETE_CONTRACT.sections[0].requiredInformation[0].neutralReplacementOptions,
  };
  const content = {
    opening: `Dear ${createDocumentPlaceholderToken(recipient.id, recipient.label)},`,
  };

  const result = applyApprovedNeutralReplacement(
    content,
    [recipient],
    recipient.id,
    "recruitment-team",
  );

  assertEquals(result.contentBySection.opening, "Dear Recruitment Team,");
  assertEquals(result.unresolved, []);
  assertEquals(result.appliedOption.id, "recruitment-team");
});

Deno.test("counts automatic and user-selected neutral replacement availability separately", () => {
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "recipient",
      profileKey: "cover-letter",
      sectionKey: "opening",
      informationKey: "recipient_name",
      label: "recipient name",
      question: "Who should this document be addressed to?",
      factType: "person_name",
      automaticFallback: "Hiring Manager",
      requiredForExport: false,
      neutralReplacementOptions:
        COMPLETE_CONTRACT.sections[0].requiredInformation[0].neutralReplacementOptions,
    },
    {
      id: "role",
      profileKey: "cover-letter",
      sectionKey: "opening",
      informationKey: "role_title",
      label: "role title",
      question: "What role is this document for?",
      factType: "role_title",
      requiredForExport: true,
      neutralReplacementOptions: [],
    },
  ];

  assertEquals(countUnresolvedPlaceholders(placeholders), {
    total: 2,
    requiredForExport: 1,
    automaticFallbackAvailable: 1,
    neutralReplacementAvailable: 1,
    bySection: { opening: 2 },
  });
});

Deno.test("detects legacy rules that contradict interactive placeholders", () => {
  assertEquals(
    findContradictoryPlaceholderRules([
      "No placeholders, drafting notes or unsupported skills.",
      "If a vital fact is unavailable, ask for it instead of drafting.",
      "Never invent factual claims.",
      "Generate complete wording around declared placeholders.",
    ]),
    [
      "No placeholders, drafting notes or unsupported skills.",
      "If a vital fact is unavailable, ask for it instead of drafting.",
    ],
  );
});
