import {
  createDocumentPlaceholderToken,
  type DocumentInformationContract,
  findContradictoryPlaceholderRules,
  UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES,
  validateDocumentInformationContract,
} from "./document-placeholder-policy.ts";

// =====================================================
// PrompTED — Document Intelligence Profiles (DIP)
// Part of the Document Intelligence Engine (DIE). Each profile tells
// TED, for a specific document type: what it MUST know, what would
// lift quality, the best clarifying questions, which uploads help,
// what it can INFER (so it does not ask), what to risk-check, and the
// ideal output structure. Principle: ask the minimum questions for
// the maximum quality output.
// =====================================================

export interface DocumentIntelligenceProfile {
  key: string;
  label: string;
  /** Keywords that route a request to this profile. */
  matches: string[];
  /** Domain fallback when no keyword matches. */
  domains: string[];
  requiredInformation: string[];
  highValueInformation: string[];
  clarificationQuestions: string[];
  recommendedUploads: string[];
  inferableInformation: string[];
  riskChecks: string[];
  outputStructure: string[];
  quality?: DocumentQualityContract;
  benchmarks?: DocumentBenchmark[];
  proofFixtures?: DocumentProofFixture[];
  exampleFinalWording?: DocumentFinalWordingExample;
  informationContract?: DocumentInformationContract;
  internalReview?: {
    status: "pending" | "passed";
    reviewedAt?: string;
    criteria: readonly string[];
    notes: readonly string[];
  };
}

export interface DocumentFinalWordingExample {
  source: "enhanced-dip-information-contract";
  purpose: string;
  sections: DocumentFinalWordingExampleSection[];
}

export interface DocumentFinalWordingExampleSection {
  key: string;
  label: string;
  content: string;
}

export interface DocumentProofFixture {
  id: string;
  mode: "sufficient-context" | "missing-vital" | "invention-pressure";
  conversation: string;
  expectedFacts: Array<{ value: string; section: string }>;
  requiredMissingFacts: string[];
  forbiddenClaims: string[];
}

export interface DocumentQualityContract {
  requiredStructure: string[];
  lengthAndDepth: string[];
  evidenceRequirements: string[];
  toneAndWording: string[];
  intentRelevance: string[];
  prohibitedInventions: string[];
  submitReadyChecks: string[];
}

export interface DocumentBenchmark {
  authority: string;
  title: string;
  url: string;
  appliesTo: string[];
  /** Observable qualities extracted from the source, never copied wording. */
  acceptanceSignals?: string[];
}

const JOB_FACTUAL_PROHIBITIONS = [
  "Never invent or inflate achievements, qualifications, dates, metrics, employers, job titles, responsibilities, systems, awards, credentials, salary, availability, motivations, relationships, application events, interview events, or employer facts.",
];

const MACQUARIE_RESUME_BENCHMARK: DocumentBenchmark = {
  authority: "Macquarie University Career and Employment Service",
  title: "Resumes & Cover Letters",
  url:
    "https://students.mq.edu.au/__data/assets/pdf_file/0011/1209809/Resume-and-Cover-Letter.pdf",
  appliesTo: [
    "resume structure",
    "cover-letter structure",
    "professional depth",
    "Australian application conventions",
  ],
  acceptanceSignals: [
    "Readable contact details, targeted summary, reverse-chronological evidence and specific skills examples",
    "Concise achievement and responsibility bullets rather than large paragraphs",
    "Cover-letter evidence is connected to the target role rather than repeating the resume",
  ],
};

const APSC_APPLICATION_BENCHMARK: DocumentBenchmark = {
  authority: "Australian Public Service Commission",
  title: "Cracking the Code",
  url: "https://www.apsc.gov.au/working-aps/joining-aps/cracking-code",
  appliesTo: [
    "selection criteria",
    "STAR evidence",
    "interview preparation",
    "specific results",
  ],
  acceptanceSignals: [
    "The requested application form and word or page limit are followed",
    "Claims use honest, specific examples that relate to the role",
    "Selection evidence makes the situation, task, action and result understandable",
  ],
};

const LINKEDIN_PROFILE_BENCHMARK: DocumentBenchmark = {
  authority: "LinkedIn Help",
  title: "Create a good LinkedIn profile",
  url:
    "https://www.linkedin.com/help/linkedin/answer/a554351/how-do-i-create-a-good-linkedin-profile-?lang=en",
  appliesTo: [
    "headline",
    "About section",
    "experience",
    "skills",
    "profile completeness",
  ],
  acceptanceSignals: [
    "Headline, About, experience and skills tell one consistent professional story",
    "Experience and credentials remain accurate and complete",
    "Wording is concise, searchable and natural rather than a pasted resume",
  ],
};

const VCU_FOLLOW_UP_BENCHMARK: DocumentBenchmark = {
  authority: "Virginia Commonwealth University Career Services",
  title: "Thank-you notes and emails",
  url:
    "https://careers.vcu.edu/applying-and-interviewing/interviewing/thank-you-notes-and-emails/",
  appliesTo: [
    "follow-up timing",
    "email structure",
    "professional tone",
    "specificity",
  ],
  acceptanceSignals: [
    "Message is concise, personal and in business-correspondence form",
    "Opening expresses appreciation and identifies the opportunity",
    "Body reconnects confirmed fit to the discussion and closing gives a professional next step",
  ],
};

const UNM_OUTREACH_BENCHMARK: DocumentBenchmark = {
  authority: "University of New Mexico Office of Career Services",
  title: "Follow-up, thank-you and networking letters",
  url: "https://career.unm.edu/career-tools/follow-up--thank-you-letters.html",
  appliesTo: [
    "recruiter outreach",
    "networking purpose",
    "follow-up structure",
    "professional correspondence",
  ],
  acceptanceSignals: [
    "Message has a specific contact purpose and a small clear request",
    "Tone remains professional when no vacancy is known",
    "Outreach never implies an unconfirmed relationship or opportunity",
  ],
};

const RESUME_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-03",
  sections: [
    {
      sectionKey: "contact_details",
      requiredInformation: [
        {
          key: "full_name",
          label: "Full name",
          factType: "person_name",
          placeholderLabel: "your full name",
          question: "What full name should appear at the top of your resume?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.full_name",
          neutralReplacementOptions: [],
        },
        {
          key: "phone_number",
          label: "Phone number",
          factType: "contact_detail",
          placeholderLabel: "your phone number",
          question: "What phone number should employers use to contact you?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.phone",
          neutralReplacementOptions: [],
        },
        {
          key: "email_address",
          label: "Email address",
          factType: "contact_detail",
          placeholderLabel: "your email address",
          question: "What email address should employers use to contact you?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.email",
          neutralReplacementOptions: [],
        },
        {
          key: "city_or_region",
          label: "City or region",
          factType: "location",
          placeholderLabel: "your city or region",
          question:
            "Which city, suburb or region should appear on your resume?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.location",
          neutralReplacementOptions: [
            {
              id: "location-available-on-request",
              label: "Location available on request",
              value: "Location available on request",
              suitability:
                "Use only when the user does not want to publish a location.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
      ],
      optionalInformation: [
        "LinkedIn URL",
        "portfolio URL",
        "professional website",
      ],
    },
    {
      sectionKey: "summary",
      requiredInformation: [
        {
          key: "target_role",
          label: "Target role or field",
          factType: "role_title",
          placeholderLabel: "target role or field",
          question: "What role or type of work are you targeting?",
          requiredForExport: true,
          sharedResolutionKey: "application.target_role",
          neutralReplacementOptions: [
            {
              id: "broad-professional-direction",
              label: "Broad professional direction",
              value: "a suitable professional opportunity",
              suitability:
                "Use only for a general resume that is not tailored to a specific role.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "experience_level",
          label: "Experience level",
          factType: "other",
          placeholderLabel: "your experience level",
          question: "How would you describe your current experience level?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.experience_level",
          neutralReplacementOptions: [
            {
              id: "experienced-professional",
              label: "Experienced professional",
              value: "experienced professional",
              suitability:
                "Use only where the supplied employment history supports professional experience.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "core_strengths",
          label: "Core strengths",
          factType: "skill",
          placeholderLabel: "your core strengths",
          question:
            "Which two or three strengths should the summary emphasise?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.core_strengths",
          neutralReplacementOptions: [],
        },
        {
          key: "value_statement",
          label: "Value statement",
          factType: "achievement",
          placeholderLabel: "the value you bring",
          question:
            "What contribution or outcome do you most want employers to associate with you?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.value_statement",
          neutralReplacementOptions: [
            {
              id: "reliable-contribution",
              label: "Reliable contribution",
              value: "reliable, practical contribution",
              suitability:
                "Use when no quantified or specialised value claim is available.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "industry keywords",
        "measurable achievement",
        "leadership style",
        "specialist niche",
        "tone",
        "certifications",
        "cross-functional impact",
      ],
    },
    {
      sectionKey: "experience",
      requiredInformation: [
        {
          key: "role_title",
          label: "Role title",
          factType: "role_title",
          placeholderLabel: "your role title",
          question: "What was your title for this position?",
          requiredForExport: true,
          sharedResolutionKey: "employment.role_title",
          neutralReplacementOptions: [],
        },
        {
          key: "organisation_name",
          label: "Organisation name",
          factType: "company_name",
          placeholderLabel: "the organisation name",
          question: "Which organisation did you work for?",
          requiredForExport: true,
          sharedResolutionKey: "employment.organisation",
          neutralReplacementOptions: [
            {
              id: "confidential-organisation",
              label: "Confidential organisation",
              value: "Confidential organisation",
              suitability:
                "Use only when the employer must remain confidential.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
        {
          key: "employment_dates",
          label: "Employment dates",
          factType: "date_range",
          placeholderLabel: "employment dates",
          question: "When did you start and finish this role?",
          requiredForExport: true,
          sharedResolutionKey: "employment.date_range",
          neutralReplacementOptions: [
            {
              id: "dates-available-on-request",
              label: "Dates available on request",
              value: "Dates available on request",
              suitability:
                "Use only when the user knowingly chooses not to publish employment dates.",
              clearsExportWarning: false,
              regenerateSurroundingWording: false,
            },
          ],
        },
        {
          key: "core_responsibilities",
          label: "Core responsibilities",
          factType: "responsibility",
          placeholderLabel: "your core responsibilities",
          question: "What were your main responsibilities in this role?",
          requiredForExport: false,
          sharedResolutionKey: "employment.responsibilities",
          neutralReplacementOptions: [],
        },
        {
          key: "achievement_or_contribution",
          label: "Achievement or contribution",
          factType: "achievement",
          placeholderLabel: "a confirmed achievement or contribution",
          question:
            "What achievement, improvement or contribution from this role should be included?",
          requiredForExport: false,
          sharedResolutionKey: "employment.achievement",
          neutralReplacementOptions: [
            {
              id: "responsibility-focused-entry",
              label: "Use responsibilities only",
              value:
                "Responsibilities and contributions are described without an unsupported achievement claim.",
              suitability:
                "Use when the user cannot provide a defensible achievement.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "metrics",
        "team or budget size",
        "tools and systems",
        "promotions",
        "awards",
        "process improvements",
        "problem-solving examples",
        "project evidence",
      ],
    },
    {
      sectionKey: "education",
      requiredInformation: [
        {
          key: "qualification_name",
          label: "Qualification name",
          factType: "credential",
          placeholderLabel: "qualification name",
          question:
            "What qualification, course or credential should be listed?",
          requiredForExport: true,
          sharedResolutionKey: "education.qualification",
          neutralReplacementOptions: [],
        },
        {
          key: "institution_name",
          label: "Institution name",
          factType: "institution",
          placeholderLabel: "institution name",
          question: "Which institution issued or delivered this qualification?",
          requiredForExport: true,
          sharedResolutionKey: "education.institution",
          neutralReplacementOptions: [],
        },
        {
          key: "completion_status",
          label: "Completion status",
          factType: "date",
          placeholderLabel: "completion status or year",
          question:
            "Was this completed, is it in progress, or what year was it completed?",
          requiredForExport: false,
          sharedResolutionKey: "education.completion_status",
          neutralReplacementOptions: [
            {
              id: "completion-date-not-listed",
              label: "Do not list a completion date",
              value: "Completion date not listed",
              suitability:
                "Use when the qualification is confirmed but the user chooses not to publish a year.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "subjects",
        "honours",
        "short courses",
        "memberships",
        "projects or thesis",
        "scholarships",
        "continuing professional development",
      ],
    },
    {
      sectionKey: "skills",
      requiredInformation: [
        {
          key: "role_relevant_skills",
          label: "Role-relevant skills",
          factType: "skill",
          placeholderLabel: "role-relevant skills",
          question:
            "Which confirmed skills are most relevant to the roles you are targeting?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.role_skills",
          neutralReplacementOptions: [],
        },
        {
          key: "technical_and_transferable_mix",
          label: "Technical and transferable skill mix",
          factType: "skill",
          placeholderLabel: "technical and transferable skills",
          question:
            "Which technical and transferable skills should be included?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.skill_mix",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "skill categories",
        "tools",
        "certifications",
        "proficiency level",
        "projects",
        "languages",
        "training",
      ],
    },
    {
      sectionKey: "referees",
      requiredInformation: [
        {
          key: "referee_details",
          label: "Referee details or availability statement",
          factType: "reference",
          placeholderLabel: "referee details",
          question:
            "Would you like to list a referee or use an availability statement?",
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
        },
      ],
      optionalInformation: [
        "referee title",
        "relationship",
        "duration known",
        "company or department",
        "phone",
        "email",
        "permission to contact",
      ],
    },
  ],
};

const RESUME_INTERNAL_REVIEW = {
  status: "passed" as const,
  reviewedAt: "2026-08-03",
  criteria: [
    "contract completeness: every required fact explicitly defines all nine template intelligence items",
    "intake and context reuse: existing profile, conversation, uploaded resume, prior output and target-role facts are reused before clarification",
    "generation resilience: all six resume sections retain complete final wording when every required fact is unknown",
    "factual safety: identity, contact, employment, education, achievement and skill claims remain traceable and unsupported facts remain blocking",
    "placeholder integrity: each missing fact has a unique occurrence id, exact section and information keys, contextual label, exact question and export metadata",
    "resolution behaviour: exact answers, automatic fallbacks, approved neutral replacements and shared-resolution keys update only intended occurrences",
    "proofread behaviour: unresolved declared placeholder labels are excluded while surrounding wording remains reviewable",
    "workspace persistence: resolved wording and unresolved metadata remain compatible with versioned section edits and outcome persistence",
    "issue navigation: section and document unresolved counts support deterministic navigation without collapsing independent facts",
    "export behaviour: unresolved counts, safe neutral replacements and required acknowledgement states remain distinguishable",
    "accessibility and recovery: placeholder controls have meaningful labels and malformed or metadata-missing tokens remain visible and unresolved",
    "regression and release evidence: contradiction scan, contract validation, formatting, focused tests and repository CI must pass without weakening other templates",
  ],
  notes: [
    "Resume was re-reviewed under the full 12-area workflow protocol after passing the earlier narrow gate.",
    "An empty neutral replacement list is intentional where no fact-safe substitute exists.",
    "Runtime UI behaviours are contract-verified here and remain subject to shared renderer, workspace, proofread and export integration tests in the blanket implementation.",
    "Resume may remain passed only while all strict review assertions and repository CI remain green.",
  ],
};

const COVER_LETTER_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-04",
  sections: [
    {
      sectionKey: "sender_and_date",
      requiredInformation: [
        {
          key: "candidate_name",
          label: "Candidate name",
          factType: "person_name",
          placeholderLabel: "your full name",
          question: "What full name should appear on the cover letter?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.full_name",
          neutralReplacementOptions: [],
        },
        {
          key: "candidate_contact",
          label: "Candidate contact details",
          factType: "contact_detail",
          placeholderLabel: "your contact details",
          question:
            "Which phone number and email address should appear on the cover letter?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.contact_details",
          neutralReplacementOptions: [],
        },
        {
          key: "letter_date",
          label: "Letter date",
          factType: "date",
          placeholderLabel: "letter date",
          question: "What date should appear on the cover letter?",
          automaticFallback: "the current date",
          requiredForExport: false,
          sharedResolutionKey: "application.letter_date",
          neutralReplacementOptions: [
            {
              id: "omit-letter-date",
              label: "Do not display a date",
              value: "Date not displayed",
              suitability:
                "Use only when the delivery channel does not require a dated letter block.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: ["postal address", "LinkedIn URL", "portfolio URL"],
    },
    {
      sectionKey: "recipient_and_salutation",
      requiredInformation: [
        {
          key: "recipient_name",
          label: "Recipient name",
          factType: "person_name",
          placeholderLabel: "recipient name",
          question: "Who should the cover letter be addressed to?",
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
            {
              id: "recruitment-team",
              label: "Recruitment Team",
              value: "Recruitment Team",
              suitability:
                "Use when the application is managed by a recruitment or talent-acquisition team.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
            {
              id: "to-whom-it-may-concern",
              label: "To whom it may concern",
              value: "To whom it may concern",
              suitability:
                "Use only for broadly circulated formal correspondence where no role-specific recipient is available.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "employer_name",
          label: "Employer name",
          factType: "company_name",
          placeholderLabel: "employer name",
          question: "Which employer or organisation is this application for?",
          requiredForExport: true,
          sharedResolutionKey: "application.employer",
          neutralReplacementOptions: [
            {
              id: "prospective-employer",
              label: "Prospective employer",
              value: "prospective employer",
              suitability:
                "Use only for a general expression-of-interest letter not tied to a named organisation.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "employer_address",
          label: "Employer address",
          factType: "address",
          placeholderLabel: "employer address",
          question:
            "Should an employer address be included, and if so what is it?",
          requiredForExport: false,
          sharedResolutionKey: "application.employer_address",
          neutralReplacementOptions: [
            {
              id: "omit-employer-address",
              label: "Do not include an employer address",
              value: "Employer address not displayed",
              suitability:
                "Use for email or portal applications where a postal address block is unnecessary.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "recipient title",
        "department",
        "postal address",
        "application reference number",
      ],
    },
    {
      sectionKey: "opening",
      requiredInformation: [
        {
          key: "target_role",
          label: "Target role",
          factType: "role_title",
          placeholderLabel: "target role",
          question: "What exact role are you applying for?",
          requiredForExport: true,
          sharedResolutionKey: "application.target_role",
          neutralReplacementOptions: [
            {
              id: "suitable-opportunity",
              label: "Suitable opportunity",
              value: "a suitable opportunity",
              suitability:
                "Use only for a genuine general expression of interest.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "application_source",
          label: "Application source",
          factType: "reference",
          placeholderLabel: "where the opportunity was advertised or discussed",
          question: "Where did you find or hear about this opportunity?",
          requiredForExport: false,
          sharedResolutionKey: "application.source",
          neutralReplacementOptions: [
            {
              id: "omit-application-source",
              label: "Do not mention the source",
              value: "Application source not stated",
              suitability:
                "Use when the source is unknown or adds no value to the opening.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "opening_hook",
          label: "Opening value hook",
          factType: "achievement",
          placeholderLabel: "your strongest relevant value point",
          question:
            "What is the strongest confirmed reason this employer should keep reading?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.cover_letter_hook",
          neutralReplacementOptions: [
            {
              id: "evidence-led-interest",
              label: "Use an evidence-led introduction",
              value: "relevant experience and a practical contribution",
              suitability:
                "Use when the supplied resume supports relevant experience but no single headline achievement is confirmed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "job reference number",
        "referral",
        "availability",
        "location preference",
      ],
    },
    {
      sectionKey: "evidence_of_fit",
      requiredInformation: [
        {
          key: "role_requirement",
          label: "Role requirement",
          factType: "responsibility",
          placeholderLabel: "a key role requirement",
          question:
            "Which requirement from the job advertisement should this paragraph address?",
          requiredForExport: true,
          sharedResolutionKey: "application.role_requirement",
          neutralReplacementOptions: [],
        },
        {
          key: "candidate_evidence",
          label: "Candidate evidence",
          factType: "achievement",
          placeholderLabel: "a confirmed example from your experience",
          question:
            "What confirmed example shows that you meet this requirement?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.requirement_evidence",
          neutralReplacementOptions: [],
        },
        {
          key: "evidence_result",
          label: "Result or contribution",
          factType: "achievement",
          placeholderLabel: "the confirmed result or contribution",
          question: "What result or contribution came from that example?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.evidence_result",
          neutralReplacementOptions: [
            {
              id: "describe-action-without-result",
              label: "Use the confirmed action without a result claim",
              value:
                "the confirmed action and responsibility without an unsupported outcome",
              suitability:
                "Use when the action is confirmed but no defensible result is available.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "second evidence example",
        "metrics",
        "tools",
        "team size",
        "stakeholders",
        "transferable skills",
      ],
    },
    {
      sectionKey: "employer_motivation",
      requiredInformation: [
        {
          key: "employer_specific_reason",
          label: "Employer-specific reason",
          factType: "other",
          placeholderLabel: "a confirmed reason for this employer",
          question:
            "What specifically attracts you to this employer, based on the job advertisement or another reliable source?",
          requiredForExport: false,
          sharedResolutionKey: "application.employer_motivation",
          neutralReplacementOptions: [
            {
              id: "role-focused-motivation",
              label: "Focus on the role rather than the organisation",
              value:
                "the responsibilities and contribution offered by the role",
              suitability:
                "Use when no reliable employer-specific reason has been supplied.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "mission",
        "values",
        "projects",
        "products",
        "culture",
        "location",
        "growth opportunity",
      ],
    },
    {
      sectionKey: "closing_and_signature",
      requiredInformation: [
        {
          key: "call_to_action",
          label: "Closing call to action",
          factType: "other",
          placeholderLabel: "preferred next step",
          question:
            "What next step should the closing invite, such as an interview or further discussion?",
          automaticFallback:
            "the opportunity to discuss the application further",
          requiredForExport: false,
          sharedResolutionKey: "application.call_to_action",
          neutralReplacementOptions: [
            {
              id: "further-discussion",
              label: "Further discussion",
              value: "the opportunity to discuss the application further",
              suitability: "Suitable for most employment applications.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "signoff_name",
          label: "Sign-off name",
          factType: "person_name",
          placeholderLabel: "your sign-off name",
          question: "What name should appear beneath the closing?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.full_name",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "availability",
        "preferred contact method",
        "attachments statement",
        "digital signature",
      ],
    },
  ],
};

const COVER_LETTER_INTERNAL_REVIEW = {
  status: "passed" as const,
  reviewedAt: "2026-08-04",
  criteria: [
    "contract completeness: all six cover-letter sections and every required fact define the complete nine-item contract",
    "intake and context reuse: resume, job advertisement, prior outputs, user profile and employer sources are reused before asking questions",
    "generation resilience: a finished letter structure remains available when recipient, employer, role or evidence facts are unresolved",
    "factual safety: recipient identity, employer facts, role requirements, achievements and motivation are never fabricated",
    "placeholder integrity: each unknown appears at its exact grammatical location with consistent metadata and export treatment",
    "resolution behaviour: direct answers, shared candidate details, approved salutations and omission choices update only intended wording",
    "proofread behaviour: declared tokens are ignored while tone, structure, repetition, evidence mapping and surrounding grammar remain reviewed",
    "workspace persistence: section edits, resolved values and unresolved metadata can persist without overwriting unrelated user wording",
    "issue navigation: recipient, opening, evidence, motivation and closing issues remain independently countable and navigable",
    "export behaviour: unknown recipient may use an approved salutation, but employer, role and unsupported evidence remain explicitly governed",
    "accessibility and recovery: controls expose exact questions and meaningful labels; malformed tokens remain visible and unresolved",
    "regression and release evidence: sole-registry architecture, contract validation, contradiction scan, focused tests, formatting and CI remain required",
  ],
  notes: [
    "Neutral recipient wording is permitted only through declared options; a person's name is never guessed.",
    "Employer-specific motivation falls back to role-focused wording rather than invented praise.",
    "Evidence paragraphs require both a supplied role requirement and confirmed candidate evidence before export without acknowledgement.",
  ],
};

const JOB_SEARCH_CHECKLIST_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-08",
  sections: [
    {
      sectionKey: "objective_and_cadence",
      requiredInformation: [
        {
          key: "target_role_or_direction",
          label: "Target role or direction",
          factType: "role_title",
          placeholderLabel: "target role or direction",
          question:
            "What role, field or type of work should this job-search plan target?",
          requiredForExport: true,
          sharedResolutionKey: "application.target_role",
          neutralReplacementOptions: [
            {
              id: "broad-job-search",
              label: "Broad job search",
              value:
                "suitable roles matching your confirmed experience and preferences",
              suitability:
                "Use only when the user intentionally wants a broad search rather than a named role.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "location_or_work_mode",
          label: "Location or work-mode preference",
          factType: "location",
          placeholderLabel: "preferred location or work mode",
          question:
            "Which locations or work modes should the search include, such as on-site, hybrid or remote?",
          requiredForExport: false,
          sharedResolutionKey: "application.search_location",
          neutralReplacementOptions: [
            {
              id: "location-flexible",
              label: "Flexible location",
              value: "locations and work modes you are willing to consider",
              suitability:
                "Use when the user has no fixed geographic or work-mode requirement.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "weekly_time_available",
          label: "Weekly time available",
          factType: "other",
          placeholderLabel: "time available each week",
          question:
            "How much time can you realistically spend on the job search each week?",
          requiredForExport: false,
          sharedResolutionKey: "application.weekly_search_time",
          neutralReplacementOptions: [
            {
              id: "sustainable-weekly-cadence",
              label: "Use a sustainable weekly cadence",
              value: "a sustainable amount of time each week",
              suitability:
                "Use when no exact weekly time budget has been supplied.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "preferred industries",
        "seniority",
        "salary expectations",
        "availability",
        "commute constraints",
      ],
    },
    {
      sectionKey: "setup_and_evidence_preparation",
      requiredInformation: [],
      optionalInformation: [
        "current resume",
        "LinkedIn profile",
        "portfolio",
        "references",
        "certifications",
        "existing application tracker",
      ],
    },
    {
      sectionKey: "role_discovery",
      requiredInformation: [],
      optionalInformation: [
        "preferred job boards",
        "recruiters",
        "network contacts",
        "target employers",
        "industry groups",
      ],
    },
    {
      sectionKey: "role_screening",
      requiredInformation: [],
      optionalInformation: [
        "must-have requirements",
        "deal-breakers",
        "salary floor",
        "travel limits",
        "visa or work-right constraints",
      ],
    },
    {
      sectionKey: "tailoring_and_submission",
      requiredInformation: [],
      optionalInformation: [
        "application target",
        "preferred application volume",
        "cover-letter requirement",
        "selection criteria",
        "submission channels",
      ],
    },
    {
      sectionKey: "tracking_and_follow_up",
      requiredInformation: [],
      optionalInformation: [
        "follow-up preference",
        "tracking tool",
        "employer-stated timelines",
        "contact details",
        "application dates",
      ],
    },
    {
      sectionKey: "interview_preparation",
      requiredInformation: [],
      optionalInformation: [
        "confirmed interviews",
        "interview format",
        "job advertisement",
        "candidate evidence",
        "questions to practise",
      ],
    },
    {
      sectionKey: "weekly_review",
      requiredInformation: [],
      optionalInformation: [
        "review day",
        "response rate",
        "application outcomes",
        "channel performance",
        "changes to constraints or target direction",
      ],
    },
  ],
};

const JOB_SEARCH_CHECKLIST_INTERNAL_REVIEW = {
  status: "passed" as const,
  reviewedAt: "2026-08-08",
  criteria: [
    "contract completeness: every checklist section is represented and each required fact defines the complete nine-item contract",
    "intake and context reuse: prior resume, profile, role preferences, uploaded job ads and existing tracker data are reused before clarification",
    "generation resilience: every action group remains fully generated when target role, location or weekly time are unresolved, using declared placeholders rather than blank sections",
    "factual safety: applications, employers, deadlines, contacts, interview events and progress are never invented or marked complete without evidence",
    "placeholder integrity: unresolved target, location and time facts remain independently selectable with exact contextual questions and shared keys",
    "resolution behaviour: answering a placeholder updates only intentionally linked occurrences and never rewrites unrelated checklist actions",
    "proofread behaviour: placeholder labels are excluded from editorial findings while action clarity, sequencing and surrounding grammar remain reviewable",
    "workspace persistence: checklist edits, completion state and placeholder resolutions can persist independently without erasing user-authored changes",
    "issue navigation: unresolved facts remain countable and navigable by their owning checklist section",
    "export behaviour: unresolved export-critical target direction requires acknowledgement while optional location and cadence gaps may use declared neutral replacements",
    "accessibility and recovery: each placeholder exposes a meaningful label and clarification question; failed persistence leaves it unresolved rather than blanking content",
    "regression and release evidence: contract validation, contradiction scan, all-missing generation, multi-placeholder resolution, formatting and repository CI must remain green",
  ],
  notes: [
    "The checklist may recommend ordinary search stages and sequencing without claiming those actions have already occurred.",
    "No numeric application quota is invented; a quota is included only when supplied or explicitly chosen by the user.",
    "Missing target, location or cadence information changes specificity, never whether a checklist section exists.",
  ],
};

const INTERVIEW_PREP_QUESTIONS_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-08",
    sections: [
      {
        sectionKey: "role_and_evidence_map",
        requiredInformation: [
          {
            key: "target_role",
            label: "Target role",
            factType: "role_title",
            placeholderLabel: "target role",
            question: "What role are you preparing to interview for?",
            requiredForExport: true,
            sharedResolutionKey: "application.target_role",
            neutralReplacementOptions: [
              {
                id: "role-type-preparation",
                label: "Prepare for the role type",
                value: "the type of role you are targeting",
                suitability:
                  "Use only for general interview preparation not tied to a named vacancy.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
          {
            key: "key_role_requirements",
            label: "Key role requirements",
            factType: "responsibility",
            placeholderLabel: "key role requirements",
            question:
              "Which requirements or capabilities from the role should the preparation focus on?",
            requiredForExport: false,
            sharedResolutionKey: "application.role_requirements",
            neutralReplacementOptions: [
              {
                id: "general-role-capabilities",
                label: "Use general role capabilities",
                value:
                  "the confirmed responsibilities and capabilities associated with the target role",
                suitability:
                  "Use when no job advertisement has been supplied but the target role is known.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
          {
            key: "candidate_evidence",
            label: "Confirmed candidate evidence",
            factType: "achievement",
            placeholderLabel: "a confirmed experience example",
            question:
              "Which real achievement, responsibility or situation should your interview answers draw from?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.interview_evidence",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "job advertisement",
          "submitted resume",
          "cover letter",
          "selection criteria",
          "seniority",
          "industry",
        ],
      },
      {
        sectionKey: "opening_and_motivation_questions",
        requiredInformation: [
          {
            key: "role_motivation",
            label: "Role motivation",
            factType: "other",
            placeholderLabel: "your reason for wanting this role",
            question:
              "What genuinely interests you about this role or type of work?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.role_motivation",
            neutralReplacementOptions: [
              {
                id: "capability-and-growth-focus",
                label: "Focus on contribution and growth",
                value:
                  "the opportunity to apply confirmed strengths while continuing to grow in the role",
                suitability:
                  "Use only as neutral interview framing when no employer-specific motivation is known.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "employer-specific motivation",
          "career direction",
          "reason for leaving current role",
          "availability",
        ],
      },
      {
        sectionKey: "behavioural_questions",
        requiredInformation: [
          {
            key: "primary_star_example",
            label: "Primary STAR example",
            factType: "event",
            placeholderLabel: "a real situation to use as evidence",
            question:
              "What real situation should be used for your strongest behavioural answer?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.primary_star_example",
            neutralReplacementOptions: [],
          },
          {
            key: "confirmed_result",
            label: "Confirmed result",
            factType: "achievement",
            placeholderLabel: "the confirmed result",
            question:
              "What happened as a result of your actions in that example?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.primary_star_result",
            neutralReplacementOptions: [
              {
                id: "no-result-claim",
                label: "Describe the action without a result claim",
                value:
                  "the confirmed actions and responsibilities without adding an unsupported outcome",
                suitability:
                  "Use when the situation and actions are known but no defensible result is available.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "stakeholders",
          "constraints",
          "metrics",
          "tools",
          "lessons learned",
          "competencies demonstrated",
        ],
      },
      {
        sectionKey: "role_specific_questions",
        requiredInformation: [],
        optionalInformation: [
          "technical requirements",
          "systems",
          "leadership scope",
          "customer context",
          "regulatory context",
          "commercial responsibilities",
        ],
      },
      {
        sectionKey: "difficult_question_preparation",
        requiredInformation: [],
        optionalInformation: [
          "career gaps",
          "career change",
          "weakness question",
          "salary question",
          "conflict example",
          "reason for leaving",
          "known concern",
        ],
      },
      {
        sectionKey: "questions_to_ask_interviewer",
        requiredInformation: [],
        optionalInformation: [
          "employer name",
          "team structure",
          "role priorities",
          "interview stage",
          "known projects",
          "stated challenges",
        ],
      },
      {
        sectionKey: "final_preparation_checklist",
        requiredInformation: [],
        optionalInformation: [
          "interview date",
          "interview format",
          "location or video platform",
          "panel members",
          "documents to bring",
          "accessibility needs",
        ],
      },
    ],
  };

const INTERVIEW_PREP_QUESTIONS_INTERNAL_REVIEW = {
  status: "passed" as const,
  reviewedAt: "2026-08-08",
  criteria: [
    "contract completeness: all seven interview-preparation sections are covered and each required fact defines the complete nine-item contract",
    "intake and context reuse: the job advertisement, resume, submitted applications, prior evidence and saved role context are reused before clarification",
    "generation resilience: question sets, rehearsal prompts and preparation actions remain fully generated when role, requirements, motivation or evidence are unresolved",
    "factual safety: speculative questions are labelled as likely preparation and no employer question, candidate achievement, motivation, weakness or interview event is fabricated",
    "placeholder integrity: unknown substantive answer facts appear as declared interactive placeholders with exact contextual questions rather than empty answer areas",
    "resolution behaviour: shared role and candidate-evidence answers update only semantically linked preparation content and preserve unrelated questions",
    "proofread behaviour: declared placeholder labels are excluded while question clarity, answer structure and surrounding spoken wording remain reviewable",
    "workspace persistence: user-edited answer outlines, rehearsal notes and placeholder resolutions persist without replacing unrelated preparation content",
    "issue navigation: unresolved role, evidence, motivation and STAR-result facts remain independently countable and navigable",
    "export behaviour: unresolved target role requires acknowledgement while safe neutral framing may resolve non-critical motivation or result gaps",
    "accessibility and recovery: each unresolved fact exposes a meaningful label and clarification question; failed resolution remains visible without blanking its section",
    "regression and release evidence: contract validation, contradiction scanning, all-missing generation, shared resolution, formatting and full repository CI remain mandatory",
  ],
  notes: [
    "PrompTED may generate likely interview questions from the confirmed role context but must never claim an employer will ask them.",
    "Answer outlines remain useful with unresolved evidence placeholders instead of inventing a candidate story.",
    "A missing employer name or interview format changes specificity, never whether the preparation document is generated.",
  ],
};

const INTERVIEW_SCRIPT_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-08",
  sections: [
    {
      sectionKey: "opening_introduction",
      requiredInformation: [
        {
          key: "candidate_identity",
          label: "Candidate professional identity",
          factType: "other",
          placeholderLabel: "your current professional background",
          question:
            "How should you truthfully introduce your current professional background?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.professional_identity",
          neutralReplacementOptions: [
            {
              id: "experience-led-introduction",
              label: "Use confirmed experience",
              value:
                "your confirmed experience and the strengths most relevant to the role",
              suitability:
                "Use when the supplied resume contains enough confirmed experience to introduce the candidate without a separate identity statement.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "target_role",
          label: "Target role",
          factType: "role_title",
          placeholderLabel: "target role",
          question: "What role is this interview script for?",
          requiredForExport: true,
          sharedResolutionKey: "application.target_role",
          neutralReplacementOptions: [
            {
              id: "role-type-script",
              label: "Use the target role type",
              value: "the type of role you are targeting",
              suitability:
                "Use only for general interview practice not tied to a named vacancy.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "current employer",
        "years of experience",
        "industry",
        "career direction",
        "pronunciation preferences",
      ],
    },
    {
      sectionKey: "why_this_role",
      requiredInformation: [
        {
          key: "role_motivation",
          label: "Role motivation",
          factType: "other",
          placeholderLabel: "your genuine reason for wanting the role",
          question: "What genuinely attracts you to this role or type of work?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.role_motivation",
          neutralReplacementOptions: [
            {
              id: "contribution-and-growth",
              label: "Contribution and growth",
              value:
                "the opportunity to apply your confirmed strengths, contribute meaningfully and continue developing",
              suitability:
                "Use as neutral role-focused framing when no employer-specific motivation has been confirmed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "employer_motivation",
          label: "Employer-specific motivation",
          factType: "other",
          placeholderLabel: "a confirmed reason for this employer",
          question:
            "Is there a specific, confirmed reason you want to work for this employer?",
          requiredForExport: false,
          sharedResolutionKey: "application.employer_motivation",
          neutralReplacementOptions: [
            {
              id: "omit-employer-specific-praise",
              label: "Keep the answer role-focused",
              value:
                "focus on the role and contribution rather than making an unsupported employer-specific claim",
              suitability:
                "Use when no reliable employer-specific motivation has been supplied.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "job advertisement",
        "organisation mission",
        "team context",
        "career goals",
        "location preference",
      ],
    },
    {
      sectionKey: "strength_and_capability_answers",
      requiredInformation: [
        {
          key: "confirmed_strength",
          label: "Confirmed strength",
          factType: "skill",
          placeholderLabel: "a confirmed strength",
          question: "Which genuine strength should this answer emphasise?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.interview_strength",
          neutralReplacementOptions: [],
        },
        {
          key: "strength_evidence",
          label: "Strength evidence",
          factType: "achievement",
          placeholderLabel: "evidence that demonstrates the strength",
          question: "What real example demonstrates that strength?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.interview_strength_evidence",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "role requirement",
        "stakeholders",
        "tools",
        "metrics",
        "feedback",
        "transferable capability",
      ],
    },
    {
      sectionKey: "star_evidence_stories",
      requiredInformation: [
        {
          key: "real_situation",
          label: "Real situation",
          factType: "event",
          placeholderLabel: "a real situation from your experience",
          question: "What real situation should anchor this STAR answer?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.primary_star_example",
          neutralReplacementOptions: [],
        },
        {
          key: "candidate_actions",
          label: "Candidate actions",
          factType: "responsibility",
          placeholderLabel: "the actions you personally took",
          question: "What did you personally do in that situation?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.primary_star_actions",
          neutralReplacementOptions: [],
        },
        {
          key: "confirmed_result",
          label: "Confirmed result",
          factType: "achievement",
          placeholderLabel: "the confirmed result",
          question:
            "What result or outcome can you truthfully support from that example?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.primary_star_result",
          neutralReplacementOptions: [
            {
              id: "action-without-result",
              label: "Use the actions without a result claim",
              value:
                "the confirmed actions and responsibilities without adding an unsupported result",
              suitability:
                "Use when the situation and actions are known but no defensible outcome is available.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "task or responsibility",
        "constraints",
        "stakeholders",
        "metrics",
        "lessons learned",
        "competency demonstrated",
      ],
    },
    {
      sectionKey: "role_specific_answers",
      requiredInformation: [
        {
          key: "role_requirement",
          label: "Role requirement",
          factType: "responsibility",
          placeholderLabel: "a key role requirement",
          question:
            "Which confirmed requirement should this role-specific answer address?",
          requiredForExport: false,
          sharedResolutionKey: "application.role_requirements",
          neutralReplacementOptions: [
            {
              id: "known-role-responsibilities",
              label: "Use known role responsibilities",
              value:
                "the confirmed responsibilities associated with the target role",
              suitability:
                "Use when no advertisement is supplied but reliable role responsibilities are already available.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "technical requirements",
        "systems",
        "leadership scope",
        "customer context",
        "regulatory responsibilities",
        "commercial targets",
      ],
    },
    {
      sectionKey: "difficult_question_answers",
      requiredInformation: [],
      optionalInformation: [
        "reason for leaving",
        "career gap",
        "career change",
        "genuine weakness",
        "conflict example",
        "salary expectations",
        "availability",
        "known concern",
      ],
    },
    {
      sectionKey: "candidate_questions",
      requiredInformation: [],
      optionalInformation: [
        "employer name",
        "team structure",
        "role priorities",
        "success measures",
        "current projects",
        "interview stage",
        "known challenges",
      ],
    },
    {
      sectionKey: "closing",
      requiredInformation: [],
      optionalInformation: [
        "confirmed interest",
        "availability",
        "next-step information",
        "preferred contact method",
      ],
    },
  ],
};

const INTERVIEW_SCRIPT_INTERNAL_REVIEW = {
  status: "passed" as const,
  reviewedAt: "2026-08-08",
  criteria: [
    "contract completeness: all eight interview-script sections are represented and each required fact defines the complete nine-item contract",
    "intake and context reuse: resume, job advertisement, prior application outputs, saved candidate evidence and interview-preparation material are reused before clarification",
    "generation resilience: every script section remains usable when role, motivation, strengths, STAR facts or requirements are unresolved, using interactive placeholders rather than blank answers",
    "factual safety: candidate history, strengths, motivations, weaknesses, reasons for leaving, conflicts, results and employer facts are never fabricated",
    "placeholder integrity: unresolved substantive answer facts appear exactly where spoken wording depends on them and expose their contextual clarification questions",
    "resolution behaviour: shared role, motivation and evidence answers update only intentionally linked script occurrences while preserving user-edited wording elsewhere",
    "proofread behaviour: placeholder labels are excluded while spoken clarity, pacing, repetition and surrounding grammar remain reviewable",
    "workspace persistence: edited scripts, rehearsal wording and placeholder resolutions persist without replacing unrelated user-authored answers",
    "issue navigation: unresolved role, motivation, strength and STAR facts remain independently countable and navigable by section",
    "export behaviour: unresolved target role requires acknowledgement while declared neutral framing may safely resolve non-critical motivation or result gaps",
    "accessibility and recovery: each placeholder has a meaningful label and exact question; failed resolution remains visible and never converts the answer to blank content",
    "regression and release evidence: contract validation, contradiction scan, all-missing script generation, shared resolution, formatting and full repository CI remain mandatory",
  ],
  notes: [
    "Interview questions and scripted responses are preparation aids; the app must not claim to know exactly what an employer will ask.",
    "Unknown weaknesses, reasons for leaving, conflicts and motivations remain clarification needs rather than invented personal narratives.",
    "Prompts may stay flexible and conversational, but every section must contain usable rehearsal material even while factual placeholders remain unresolved.",
  ],
};

const JOB_FOLLOW_UP_EMAIL_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-08",
  sections: [
    {
      sectionKey: "subject_line",
      requiredInformation: [
        {
          key: "target_role",
          label: "Target role",
          factType: "role_title",
          placeholderLabel: "role title",
          question: "Which role is this follow-up about?",
          requiredForExport: true,
          sharedResolutionKey: "application.target_role",
          neutralReplacementOptions: [
            {
              id: "application-follow-up-subject",
              label: "General application follow-up",
              value: "Application follow-up",
              suitability:
                "Use only where the user intentionally does not want the role title in the subject and the application context remains unambiguous.",
              clearsExportWarning: false,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "employer name",
        "application reference number",
        "interview stage",
        "candidate name",
      ],
    },
    {
      sectionKey: "greeting",
      requiredInformation: [
        {
          key: "recipient_name_or_role",
          label: "Recipient name or role",
          factType: "person_name",
          placeholderLabel: "recipient name or role",
          question: "Who should this follow-up be addressed to?",
          requiredForExport: false,
          sharedResolutionKey: "application.recipient_name",
          neutralReplacementOptions: [
            {
              id: "hiring-manager",
              label: "Hiring Manager",
              value: "Hiring Manager",
              suitability:
                "Use for a standard employment application when no recipient name is known.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
            {
              id: "recruitment-team",
              label: "Recruitment Team",
              value: "Recruitment Team",
              suitability:
                "Use when a recruitment or talent team is the known functional recipient but no individual is named.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "recipient title",
        "department",
        "preferred salutation",
      ],
    },
    {
      sectionKey: "event_reference",
      requiredInformation: [
        {
          key: "follow_up_stage",
          label: "Follow-up stage",
          factType: "event",
          placeholderLabel: "application or interview stage",
          question:
            "Are you following up after submitting an application, after an interview, or after another confirmed recruitment event?",
          requiredForExport: true,
          sharedResolutionKey: "application.follow_up_stage",
          neutralReplacementOptions: [],
        },
        {
          key: "confirmed_event",
          label: "Confirmed application or interview event",
          factType: "event",
          placeholderLabel: "the confirmed application or interview event",
          question: "What actually happened that this email should refer to?",
          requiredForExport: true,
          sharedResolutionKey: "application.follow_up_event",
          neutralReplacementOptions: [],
        },
        {
          key: "event_date",
          label: "Event date",
          factType: "date",
          placeholderLabel: "event date",
          question:
            "When did that application, interview or recruitment event occur?",
          requiredForExport: false,
          sharedResolutionKey: "application.follow_up_event_date",
          neutralReplacementOptions: [
            {
              id: "omit-event-date",
              label: "Do not mention the date",
              value:
                "refer to the confirmed event without stating an exact date",
              suitability:
                "Use when the event itself is confirmed but its exact date is unnecessary or unavailable.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "specific interviewer",
        "discussion topic",
        "application confirmation",
        "employer-stated timeline",
      ],
    },
    {
      sectionKey: "continued_interest_and_value",
      requiredInformation: [
        {
          key: "continued_interest",
          label: "Continued interest",
          factType: "other",
          placeholderLabel: "your genuine continued interest",
          question:
            "What genuine reason should the email give for your continued interest in the role?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.continued_interest",
          neutralReplacementOptions: [
            {
              id: "concise-continued-interest",
              label: "State continued interest simply",
              value: "continued interest in the opportunity",
              suitability:
                "Use when the user wants a concise follow-up without adding an unsupported employer-specific reason.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "role_relevant_value",
          label: "Role-relevant value reminder",
          factType: "achievement",
          placeholderLabel: "a confirmed role-relevant strength or example",
          question:
            "Which confirmed strength or example should the follow-up briefly reinforce?",
          requiredForExport: false,
          sharedResolutionKey: "candidate.follow_up_value",
          neutralReplacementOptions: [
            {
              id: "omit-value-reminder",
              label: "Keep the email focused on the follow-up",
              value:
                "omit an additional capability claim and keep the message concise",
              suitability:
                "Use when no specific evidence reminder is needed or supported.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "specific interview discussion point",
        "submitted evidence",
        "new relevant update",
        "availability",
      ],
    },
    {
      sectionKey: "next_step",
      requiredInformation: [
        {
          key: "known_next_step_or_request",
          label: "Known next step or follow-up request",
          factType: "other",
          placeholderLabel: "the appropriate next step",
          question:
            "Was a next step or response timeline actually stated, or should the email simply invite an update when convenient?",
          automaticFallback:
            "invite an update when convenient without implying a promised response date",
          requiredForExport: false,
          sharedResolutionKey: "application.follow_up_next_step",
          neutralReplacementOptions: [
            {
              id: "polite-status-update",
              label: "Invite a status update",
              value: "I would appreciate any update when convenient.",
              suitability:
                "Suitable when no employer-promised date or next step has been confirmed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "promised decision date",
        "availability for another discussion",
        "requested documents",
        "preferred contact method",
      ],
    },
    {
      sectionKey: "sign_off",
      requiredInformation: [
        {
          key: "candidate_name",
          label: "Candidate name",
          factType: "person_name",
          placeholderLabel: "your name",
          question: "What name should appear beneath the email sign-off?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.full_name",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "phone number",
        "email address",
        "LinkedIn URL",
        "preferred closing",
      ],
    },
  ],
};

const JOB_FOLLOW_UP_EMAIL_INTERNAL_REVIEW = {
  status: "passed" as const,
  reviewedAt: "2026-08-08",
  criteria: [
    "contract completeness: all six email sections are represented and every required fact defines the complete nine-item contract",
    "intake and context reuse: application confirmations, interview notes, prior correspondence, submitted documents and saved candidate details are reused before clarification",
    "generation resilience: subject, greeting, event reference, interest, next step and sign-off remain fully drafted when optional details are unresolved, with interactive placeholders where facts are required",
    "factual safety: no application, interview, recipient, discussion point, timeline, employer promise or candidate evidence is invented",
    "placeholder integrity: unknown recipient, role, recruitment event and candidate details appear at their exact grammatical locations with contextual clarification questions",
    "resolution behaviour: shared candidate, role and recipient facts update only linked email occurrences while preserving user-edited wording",
    "proofread behaviour: placeholder labels are excluded while tone, concision, repetition, grammar and surrounding email wording remain reviewable",
    "workspace persistence: edited email wording and resolved facts persist without recreating or erasing unrelated correspondence content",
    "issue navigation: unresolved role, recipient, event and sign-off facts remain independently countable and navigable",
    "export behaviour: an unconfirmed recruitment event cannot be silently bypassed, while an unknown recipient can use an approved neutral salutation",
    "accessibility and recovery: each placeholder exposes a clear label and exact question; failed resolution remains unresolved without blanking the email section",
    "regression and release evidence: contract validation, contradiction scanning, all-missing generation, neutral recipient handling, shared resolution, formatting and full repository CI remain mandatory",
  ],
  notes: [
    "The email must never imply that an application was submitted or an interview occurred unless that event is confirmed.",
    "Unknown recipient names are handled by declared neutral salutations rather than guessed identities.",
    "No promised response date or employer next step is manufactured; neutral status wording is used when necessary.",
  ],
};

const PAY_RISE_REQUEST_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "conversation_context",
      "requiredInformation": [
        {
          "key": "employee_role",
          "label": "Current role",
          "factType": "role_title",
          "placeholderLabel": "your current role",
          "question": "What is your current role or position title?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "employment.current_role",
        },
        {
          "key": "manager_or_recipient",
          "label": "Manager or recipient",
          "factType": "person_name",
          "placeholderLabel": "manager or decision-maker",
          "question": "Who will receive or hear this pay-rise request?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "manager",
              "label": "Manager",
              "value": "Manager",
              "suitability":
                "Use when the person's name is unknown but their managerial role is known.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "employment.manager",
        },
      ],
      "optionalInformation": [
        "employment start date",
        "last salary review",
        "organisation",
        "meeting format",
      ],
    },
    {
      "sectionKey": "case_for_review",
      "requiredInformation": [
        {
          "key": "confirmed_contributions",
          "label": "Confirmed contributions",
          "factType": "achievement",
          "placeholderLabel": "confirmed contributions or achievements",
          "question":
            "Which confirmed contributions, expanded responsibilities or achievements support the request?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "payrise.evidence",
        },
        {
          "key": "expanded_scope",
          "label": "Expanded role scope",
          "factType": "responsibility",
          "placeholderLabel": "confirmed expanded responsibilities",
          "question":
            "Which responsibilities have increased or changed since your pay was last set?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "omit-expanded-scope",
              "label": "Do not claim expanded scope",
              "value":
                "focus on confirmed contributions without claiming expanded responsibilities",
              "suitability":
                "Use where no defensible scope increase is available.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "payrise.scope",
        },
      ],
      "optionalInformation": [
        "metrics",
        "customer feedback",
        "projects",
        "team size",
        "revenue or savings evidence",
      ],
    },
    {
      "sectionKey": "compensation_request",
      "requiredInformation": [
        {
          "key": "current_compensation",
          "label": "Current compensation",
          "factType": "amount",
          "placeholderLabel": "your current compensation",
          "question":
            "What is your current salary or compensation basis, if you want it referenced?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "omit-current-pay",
              "label": "Do not state current pay",
              "value":
                "discuss compensation without stating the current amount",
              "suitability":
                "Use when the current amount is unnecessary or the user prefers not to include it.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "payrise.current_compensation",
        },
        {
          "key": "requested_outcome",
          "label": "Requested compensation outcome",
          "factType": "amount",
          "placeholderLabel": "the pay outcome you want to request",
          "question":
            "What salary, increase, range or review outcome do you want to request?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "payrise.requested_outcome",
        },
        {
          "key": "market_evidence",
          "label": "Market evidence",
          "factType": "reference",
          "placeholderLabel": "verified market evidence",
          "question":
            "Do you have a reliable salary benchmark or market source you want referenced?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "omit-market-claim",
              "label": "Do not make a market claim",
              "value":
                "make the case from confirmed role scope and contribution rather than an unsupported market comparison",
              "suitability": "Use when no reliable benchmark is supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "payrise.market_evidence",
        },
      ],
      "optionalInformation": [
        "benefits",
        "bonus",
        "title adjustment",
        "salary survey date",
        "source URL",
      ],
    },
    {
      "sectionKey": "conversation_script",
      "requiredInformation": [
        {
          "key": "opening_request",
          "label": "Opening request",
          "factType": "other",
          "placeholderLabel": "your preferred opening request",
          "question":
            "How directly do you want to open the salary-review conversation?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "professional-review",
              "label": "Professional review request",
              "value":
                "I'd like to discuss a review of my compensation based on my current responsibilities and contribution.",
              "suitability": "Suitable as a neutral professional opening.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "payrise.opening",
          "automaticFallback": "a professional request to review compensation",
        },
        {
          "key": "response_to_pushback",
          "label": "Response to possible pushback",
          "factType": "other",
          "placeholderLabel":
            "your preferred response if the request cannot be agreed immediately",
          "question":
            "If the request cannot be agreed immediately, what outcome would you want to ask for next?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "review-path",
              "label": "Ask for review criteria",
              "value":
                "ask what measurable criteria and review date would support reconsideration",
              "suitability":
                "Use when the user has not supplied an alternative outcome.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "payrise.pushback",
        },
      ],
      "optionalInformation": [
        "preferred tone",
        "meeting date",
        "fallback benefits",
        "review interval",
      ],
    },
    {
      "sectionKey": "close_and_next_step",
      "requiredInformation": [
        {
          "key": "next_step",
          "label": "Next step",
          "factType": "event",
          "placeholderLabel": "the agreed or requested next step",
          "question":
            "What next step should the script request, such as a decision, follow-up meeting or review date?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "follow-up",
              "label": "Request a follow-up",
              "value": "agree a clear follow-up point after the discussion",
              "suitability":
                "Use when no specific decision date has been supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "payrise.next_step",
        },
      ],
      "optionalInformation": [
        "thank-you wording",
        "written follow-up",
        "decision timeframe",
      ],
    },
  ],
};

const PAY_RISE_REQUEST_INTERNAL_REVIEW = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Pay-rise Request & Conversation Script section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Pay-rise Request & Conversation Script asks for clarification",
    "generation resilience: complete usable Pay-rise Request & Conversation Script wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events and source claims in the Pay-rise Request & Conversation Script are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Pay-rise Request & Conversation Script placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Pay-rise Request & Conversation Script prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Pay-rise Request & Conversation Script sections",
    "issue navigation: unresolved Pay-rise Request & Conversation Script facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Pay-rise Request & Conversation Script",
    "accessibility and recovery: each Pay-rise Request & Conversation Script placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Pay-rise Request & Conversation Script passes",
  ],
  "notes": [
    "Salary amounts and market comparisons are never guessed.",
    "A missing requested amount stays interactive rather than becoming a fabricated figure.",
  ],
} as const;

const PROMOTION_CASE_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "target_promotion",
      "requiredInformation": [
        {
          "key": "current_role",
          "label": "Current role",
          "factType": "role_title",
          "placeholderLabel": "your current role",
          "question": "What is your current role?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "employment.current_role",
        },
        {
          "key": "target_role",
          "label": "Target promotion",
          "factType": "role_title",
          "placeholderLabel": "the role or level you are seeking",
          "question": "What role, level or promotion are you seeking?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "promotion.target_role",
        },
      ],
      "optionalInformation": [
        "manager",
        "team",
        "organisation",
        "promotion process",
      ],
    },
    {
      "sectionKey": "readiness_evidence",
      "requiredInformation": [
        {
          "key": "confirmed_achievements",
          "label": "Confirmed achievements",
          "factType": "achievement",
          "placeholderLabel": "confirmed achievements demonstrating readiness",
          "question":
            "Which confirmed achievements best demonstrate readiness for the promotion?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "promotion.achievements",
        },
        {
          "key": "higher_level_responsibilities",
          "label": "Higher-level responsibilities",
          "factType": "responsibility",
          "placeholderLabel":
            "higher-level responsibilities you already perform",
          "question":
            "Which responsibilities at the higher level are you already performing, if any?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "omit-higher-level-claim",
              "label": "Do not claim higher-level duties",
              "value":
                "build the case from confirmed achievements and capabilities without claiming duties not supplied",
              "suitability":
                "Use when no higher-level responsibilities are confirmed.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "promotion.higher_level_scope",
        },
      ],
      "optionalInformation": [
        "metrics",
        "leadership examples",
        "stakeholder feedback",
        "projects",
        "awards",
      ],
    },
    {
      "sectionKey": "capability_match",
      "requiredInformation": [
        {
          "key": "promotion_requirements",
          "label": "Promotion requirements",
          "factType": "responsibility",
          "placeholderLabel": "the confirmed requirements for the target role",
          "question":
            "What confirmed requirements or expectations apply to the target role?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "promotion.requirements",
        },
        {
          "key": "capability_evidence",
          "label": "Capability evidence",
          "factType": "skill",
          "placeholderLabel": "confirmed evidence matching those requirements",
          "question":
            "What confirmed experience or skills show you meet those requirements?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "promotion.capability_evidence",
        },
      ],
      "optionalInformation": [
        "development feedback",
        "qualifications",
        "cross-functional work",
      ],
    },
    {
      "sectionKey": "development_and_gaps",
      "requiredInformation": [
        {
          "key": "known_gap_or_development",
          "label": "Known development area",
          "factType": "skill",
          "placeholderLabel": "a genuine development area or remaining gap",
          "question":
            "Is there a genuine development area or remaining gap you want to acknowledge?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "no-unconfirmed-gap",
              "label": "Do not invent a weakness",
              "value":
                "do not introduce a development gap unless one is confirmed",
              "suitability":
                "Use when the user has not identified a genuine gap.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "promotion.development_gap",
        },
      ],
      "optionalInformation": [
        "training plan",
        "mentor",
        "timeframe",
      ],
    },
    {
      "sectionKey": "request_and_next_step",
      "requiredInformation": [
        {
          "key": "promotion_request",
          "label": "Promotion request",
          "factType": "other",
          "placeholderLabel": "the promotion outcome you want to request",
          "question":
            "What outcome do you want to request: promotion now, formal consideration, or a documented pathway?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "promotion.request",
        },
        {
          "key": "next_step",
          "label": "Next step",
          "factType": "event",
          "placeholderLabel": "the next review or decision step",
          "question": "What next step should the case request?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "discussion",
              "label": "Request a discussion",
              "value":
                "request a discussion about readiness, timing and next steps",
              "suitability": "Suitable where no formal process step is known.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "promotion.next_step",
        },
      ],
      "optionalInformation": [
        "decision date",
        "review cycle",
        "support requested",
      ],
    },
  ],
};

const PROMOTION_CASE_INTERNAL_REVIEW = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Promotion Case section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Promotion Case asks for clarification",
    "generation resilience: complete usable Promotion Case wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events and source claims in the Promotion Case are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Promotion Case placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Promotion Case prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Promotion Case sections",
    "issue navigation: unresolved Promotion Case facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Promotion Case",
    "accessibility and recovery: each Promotion Case placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Promotion Case passes",
  ],
  "notes": [
    "Readiness claims require confirmed achievements or responsibilities.",
    "Unknown weaknesses are never invented for artificial balance.",
  ],
} as const;

const PERSONAL_STATEMENT_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "purpose_and_target",
      "requiredInformation": [
        {
          "key": "course_or_program",
          "label": "Course or program",
          "factType": "other",
          "placeholderLabel": "the course or program",
          "question":
            "Which course, program or institution is this personal statement for?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "education.target_program",
        },
        {
          "key": "application_goal",
          "label": "Application goal",
          "factType": "other",
          "placeholderLabel": "your application goal",
          "question": "What outcome should this personal statement support?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "admission",
              "label": "Admission",
              "value": "admission to the selected program",
              "suitability": "Use for a standard admission personal statement.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "education.application_goal",
        },
      ],
      "optionalInformation": [
        "institution",
        "word limit",
        "prompt",
        "selection criteria",
      ],
    },
    {
      "sectionKey": "motivation",
      "requiredInformation": [
        {
          "key": "genuine_motivation",
          "label": "Genuine motivation",
          "factType": "other",
          "placeholderLabel": "your genuine motivation",
          "question":
            "What genuinely motivates you to pursue this course or field?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "education.motivation",
        },
      ],
      "optionalInformation": [
        "origin story",
        "specific subject interests",
        "career motivation",
      ],
    },
    {
      "sectionKey": "preparation_and_evidence",
      "requiredInformation": [
        {
          "key": "relevant_background",
          "label": "Relevant background",
          "factType": "achievement",
          "placeholderLabel": "confirmed study, work or life evidence",
          "question":
            "Which confirmed experiences have prepared you for this program?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "education.preparation_evidence",
        },
        {
          "key": "confirmed_achievement",
          "label": "Confirmed achievement",
          "factType": "achievement",
          "placeholderLabel": "a confirmed achievement or example",
          "question":
            "What achievement or example best demonstrates your preparation or potential?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "evidence-without-award",
              "label": "Use preparation evidence without an achievement claim",
              "value":
                "describe confirmed preparation and experience without inventing a standout achievement",
              "suitability": "Use when no distinct achievement is supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "education.achievement",
        },
      ],
      "optionalInformation": [
        "grades",
        "projects",
        "employment",
        "volunteering",
        "awards",
      ],
    },
    {
      "sectionKey": "program_fit",
      "requiredInformation": [
        {
          "key": "specific_fit_reason",
          "label": "Specific program fit",
          "factType": "reference",
          "placeholderLabel": "a confirmed reason this program fits your goals",
          "question":
            "What specifically about this program or institution fits your goals, based on reliable information?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "field-focused-fit",
              "label": "Focus on the field",
              "value":
                "focus on the confirmed subject area and learning goals without inventing institution-specific praise",
              "suitability":
                "Use when reliable institution-specific information is unavailable.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "education.program_fit",
        },
      ],
      "optionalInformation": [
        "subjects",
        "faculty",
        "facilities",
        "placement opportunities",
      ],
    },
    {
      "sectionKey": "future_direction",
      "requiredInformation": [
        {
          "key": "future_goal",
          "label": "Future direction",
          "factType": "other",
          "placeholderLabel": "your future study or career direction",
          "question":
            "What do you hope to do after or because of this program?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "education.future_goal",
        },
      ],
      "optionalInformation": [
        "long-term contribution",
        "industry",
        "community impact",
      ],
    },
  ],
};

const PERSONAL_STATEMENT_INTERNAL_REVIEW = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Personal Statement section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Personal Statement asks for clarification",
    "generation resilience: complete usable Personal Statement wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events and source claims in the Personal Statement are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Personal Statement placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Personal Statement prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Personal Statement sections",
    "issue navigation: unresolved Personal Statement facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Personal Statement",
    "accessibility and recovery: each Personal Statement placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Personal Statement passes",
  ],
  "notes": [
    "Motivation remains the applicant's own and is never fabricated.",
    "Institution-specific praise requires a reliable supplied or cited basis.",
  ],
} as const;

const EDUCATION_COVER_LETTER_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    "status": "complete",
    "auditedAt": "2026-08-09",
    "sections": [
      {
        "sectionKey": "recipient_and_application",
        "requiredInformation": [
          {
            "key": "program_or_opportunity",
            "label": "Program or opportunity",
            "factType": "other",
            "placeholderLabel": "the program or education opportunity",
            "question":
              "What course, program, scholarship or education opportunity are you applying for?",
            "requiredForExport": true,
            "neutralReplacementOptions": [],
            "sharedResolutionKey": "education.target_program",
          },
          {
            "key": "institution",
            "label": "Institution",
            "factType": "institution",
            "placeholderLabel": "institution name",
            "question": "Which institution is this application for?",
            "requiredForExport": true,
            "neutralReplacementOptions": [],
            "sharedResolutionKey": "education.institution",
          },
          {
            "key": "recipient",
            "label": "Recipient",
            "factType": "person_name",
            "placeholderLabel": "recipient name or admissions team",
            "question": "Who should the application letter be addressed to?",
            "requiredForExport": false,
            "neutralReplacementOptions": [
              {
                "id": "admissions-team",
                "label": "Admissions Team",
                "value": "Admissions Team",
                "suitability": "Use when no individual recipient is known.",
                "clearsExportWarning": true,
                "regenerateSurroundingWording": true,
              },
            ],
            "sharedResolutionKey": "education.recipient",
          },
        ],
        "optionalInformation": [
          "department",
          "application reference",
          "address",
        ],
      },
      {
        "sectionKey": "opening",
        "requiredInformation": [
          {
            "key": "application_intent",
            "label": "Application intent",
            "factType": "other",
            "placeholderLabel": "your application intent",
            "question":
              "What should the opening say you are applying for or seeking?",
            "requiredForExport": false,
            "neutralReplacementOptions": [
              {
                "id": "standard-application",
                "label": "Standard application",
                "value": "apply for the specified education opportunity",
                "suitability": "Suitable for a standard application opening.",
                "clearsExportWarning": true,
                "regenerateSurroundingWording": true,
              },
            ],
            "sharedResolutionKey": "education.application_intent",
          },
        ],
        "optionalInformation": [
          "application source",
          "deadline",
        ],
      },
      {
        "sectionKey": "fit_and_evidence",
        "requiredInformation": [
          {
            "key": "selection_requirement",
            "label": "Selection requirement",
            "factType": "responsibility",
            "placeholderLabel": "a confirmed selection requirement",
            "question":
              "Which requirement or criterion should the letter address?",
            "requiredForExport": true,
            "neutralReplacementOptions": [],
            "sharedResolutionKey": "education.selection_requirement",
          },
          {
            "key": "applicant_evidence",
            "label": "Applicant evidence",
            "factType": "achievement",
            "placeholderLabel":
              "confirmed evidence that addresses the requirement",
            "question":
              "What confirmed study, work or life example shows you meet that requirement?",
            "requiredForExport": true,
            "neutralReplacementOptions": [],
            "sharedResolutionKey": "education.applicant_evidence",
          },
        ],
        "optionalInformation": [
          "grades",
          "projects",
          "skills",
          "awards",
          "volunteering",
        ],
      },
      {
        "sectionKey": "motivation_and_fit",
        "requiredInformation": [
          {
            "key": "motivation",
            "label": "Motivation",
            "factType": "other",
            "placeholderLabel": "your genuine motivation",
            "question": "Why do you genuinely want this opportunity?",
            "requiredForExport": true,
            "neutralReplacementOptions": [],
            "sharedResolutionKey": "education.motivation",
          },
          {
            "key": "institution_specific_fit",
            "label": "Institution-specific fit",
            "factType": "reference",
            "placeholderLabel": "a verified reason this institution fits",
            "question":
              "What verified feature of the institution or program is relevant to your goals?",
            "requiredForExport": false,
            "neutralReplacementOptions": [
              {
                "id": "opportunity-focused",
                "label": "Focus on the opportunity",
                "value":
                  "focus on the confirmed learning opportunity rather than unsupported institution-specific praise",
                "suitability":
                  "Use when no verified institution detail is available.",
                "clearsExportWarning": true,
                "regenerateSurroundingWording": true,
              },
            ],
            "sharedResolutionKey": "education.institution_fit",
          },
        ],
        "optionalInformation": [
          "subjects",
          "placement",
          "research",
          "faculty",
        ],
      },
      {
        "sectionKey": "closing",
        "requiredInformation": [
          {
            "key": "applicant_name",
            "label": "Applicant name",
            "factType": "person_name",
            "placeholderLabel": "your full name",
            "question": "What name should appear beneath the closing?",
            "requiredForExport": true,
            "neutralReplacementOptions": [],
            "sharedResolutionKey": "candidate.full_name",
          },
          {
            "key": "next_step",
            "label": "Next step",
            "factType": "other",
            "placeholderLabel": "the appropriate next step",
            "question": "What next step should the closing invite?",
            "requiredForExport": false,
            "neutralReplacementOptions": [
              {
                "id": "consideration",
                "label": "Consideration",
                "value":
                  "thank the reader for considering the application and welcome further discussion",
                "suitability": "Suitable for most education applications.",
                "clearsExportWarning": true,
                "regenerateSurroundingWording": true,
              },
            ],
            "sharedResolutionKey": "education.next_step",
          },
        ],
        "optionalInformation": [
          "contact details",
          "attachments",
          "availability",
        ],
      },
    ],
  };

const EDUCATION_COVER_LETTER_INTERNAL_REVIEW = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Application Letter — Education section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Application Letter — Education asks for clarification",
    "generation resilience: complete usable Application Letter — Education wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events and source claims in the Application Letter — Education are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Application Letter — Education placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Application Letter — Education prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Application Letter — Education sections",
    "issue navigation: unresolved Application Letter — Education facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Application Letter — Education",
    "accessibility and recovery: each Application Letter — Education placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Application Letter — Education passes",
  ],
  "notes": [
    "Selection evidence remains grounded in confirmed applicant history.",
    "Unknown recipients use a declared neutral admissions salutation.",
  ],
} as const;

const REFERENCE_REQUEST_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "recipient_and_relationship",
      "requiredInformation": [
        {
          "key": "recipient",
          "label": "Potential referee",
          "factType": "person_name",
          "placeholderLabel": "referee name",
          "question": "Who are you asking to provide the reference?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "reference.recipient",
        },
        {
          "key": "relationship_context",
          "label": "Relationship context",
          "factType": "reference",
          "placeholderLabel": "how you know the referee",
          "question":
            "What is your genuine professional or academic relationship with this person?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "reference.relationship",
        },
      ],
      "optionalInformation": [
        "recipient title",
        "organisation",
        "how long known",
      ],
    },
    {
      "sectionKey": "request_purpose",
      "requiredInformation": [
        {
          "key": "reference_purpose",
          "label": "Reference purpose",
          "factType": "other",
          "placeholderLabel": "what the reference is for",
          "question":
            "What role, course, scholarship or other purpose is the reference for?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "reference.purpose",
        },
        {
          "key": "deadline",
          "label": "Deadline",
          "factType": "date",
          "placeholderLabel": "reference deadline",
          "question": "When is the reference needed?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "no-deadline",
              "label": "No deadline stated",
              "value":
                "ask for the reference when convenient without inventing a deadline",
              "suitability": "Use when no deadline exists or is known.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "reference.deadline",
        },
      ],
      "optionalInformation": [
        "submission method",
        "reference format",
        "selection criteria",
      ],
    },
    {
      "sectionKey": "helpful_context",
      "requiredInformation": [
        {
          "key": "relevant_context",
          "label": "Relevant context for referee",
          "factType": "achievement",
          "placeholderLabel":
            "confirmed context the referee can genuinely speak to",
          "question":
            "What confirmed work, study or achievements could this referee genuinely comment on?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "relationship-only",
              "label": "Keep the request general",
              "value":
                "invite the referee to comment only on what they genuinely know from the relationship",
              "suitability":
                "Use when no specific evidence should be suggested.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "reference.context",
        },
      ],
      "optionalInformation": [
        "resume",
        "job description",
        "transcript",
        "achievement list",
      ],
    },
    {
      "sectionKey": "request_and_opt_out",
      "requiredInformation": [
        {
          "key": "request_wording",
          "label": "Reference request",
          "factType": "other",
          "placeholderLabel": "the reference request",
          "question":
            "Do you want to ask for a written reference, a referee contact, or both?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "reference.request_type",
        },
        {
          "key": "opt_out",
          "label": "Respectful opt-out",
          "factType": "other",
          "placeholderLabel": "a respectful opt-out",
          "question":
            "Should the message explicitly make it easy for the person to decline?",
          "requiredForExport": false,
          "neutralReplacementOptions": [
            {
              "id": "easy-opt-out",
              "label": "Easy opt-out",
              "value":
                "make clear that it is completely fine if they are not comfortable or available to provide the reference",
              "suitability": "Suitable for most reference requests.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "sharedResolutionKey": "reference.opt_out",
          "automaticFallback": "a respectful option to decline",
        },
      ],
      "optionalInformation": [
        "thanks",
        "contact details",
        "follow-up preference",
      ],
    },
    {
      "sectionKey": "signoff",
      "requiredInformation": [
        {
          "key": "requester_name",
          "label": "Requester name",
          "factType": "person_name",
          "placeholderLabel": "your full name",
          "question": "What name should appear at the end of the request?",
          "requiredForExport": true,
          "neutralReplacementOptions": [],
          "sharedResolutionKey": "candidate.full_name",
        },
      ],
      "optionalInformation": [
        "phone",
        "email",
        "LinkedIn",
      ],
    },
  ],
};

const REFERENCE_REQUEST_INTERNAL_REVIEW = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Reference Request section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Reference Request asks for clarification",
    "generation resilience: complete usable Reference Request wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events and source claims in the Reference Request are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Reference Request placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Reference Request prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Reference Request sections",
    "issue navigation: unresolved Reference Request facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Reference Request",
    "accessibility and recovery: each Reference Request placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Reference Request passes",
  ],
  "notes": [
    "The request never implies a relationship, deadline or willingness that was not supplied.",
    "The referee is given a respectful opt-out by default unless the user chooses otherwise.",
  ],
} as const;

const BUSINESS_EMAIL_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-09",
  sections: [
    {
      sectionKey: "subject_and_greeting",
      requiredInformation: [
        {
          key: "email_purpose",
          label: "Email purpose",
          factType: "other",
          placeholderLabel: "the purpose of this email",
          question: "What does this business email need to achieve?",
          requiredForExport: true,
          sharedResolutionKey: "business_email.purpose",
          neutralReplacementOptions: [],
        },
        {
          key: "recipient",
          label: "Recipient",
          factType: "person_name",
          placeholderLabel: "recipient or team",
          question: "Who is this email going to?",
          requiredForExport: false,
          sharedResolutionKey: "business_email.recipient",
          neutralReplacementOptions: [
            {
              id: "neutral-recipient",
              label: "Neutral professional greeting",
              value: "Hello,",
              suitability: "Use when no recipient name or team is known.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
          automaticFallback: "a neutral professional greeting",
        },
        {
          key: "message_context",
          label: "Message context",
          factType: "reference",
          placeholderLabel: "the confirmed context for this message",
          question:
            "What confirmed situation, prior contact or business matter should the email refer to?",
          requiredForExport: true,
          sharedResolutionKey: "business_email.context",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "recipient title",
        "organisation",
        "reference number",
        "prior-contact date",
        "confidentiality requirement",
      ],
    },
    {
      sectionKey: "message",
      requiredInformation: [
        {
          key: "main_point",
          label: "Main point",
          factType: "other",
          placeholderLabel: "the main point you need to communicate",
          question: "What is the main point the recipient needs to understand?",
          requiredForExport: true,
          sharedResolutionKey: "business_email.main_point",
          neutralReplacementOptions: [],
        },
        {
          key: "supporting_facts",
          label: "Supporting facts",
          factType: "reference",
          placeholderLabel: "confirmed supporting facts",
          question:
            "Which confirmed facts, dates, amounts or details does the recipient need in order to act?",
          requiredForExport: false,
          sharedResolutionKey: "business_email.supporting_facts",
          neutralReplacementOptions: [
            {
              id: "no-extra-facts",
              label: "No additional supporting facts",
              value:
                "keep the message to the confirmed main point without adding unsupported detail",
              suitability:
                "Use when the request is self-contained and no additional facts are needed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "reason_or_impact",
          label: "Reason or impact",
          factType: "other",
          placeholderLabel: "the confirmed reason or impact",
          question:
            "Why does this matter to the recipient, if that needs to be explained?",
          requiredForExport: false,
          sharedResolutionKey: "business_email.reason",
          neutralReplacementOptions: [
            {
              id: "omit-reason",
              label: "Keep it direct",
              value:
                "state the confirmed message and request directly without inventing a justification",
              suitability:
                "Use when the purpose is already clear or no defensible reason has been supplied.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "attachments",
        "links",
        "decision framing",
        "benefit",
        "ownership",
        "relevant metrics",
      ],
    },
    {
      sectionKey: "call_to_action",
      requiredInformation: [
        {
          key: "requested_action",
          label: "Requested action",
          factType: "other",
          placeholderLabel: "the action or response you need",
          question:
            "What exactly do you want the recipient to do or reply with?",
          requiredForExport: true,
          sharedResolutionKey: "business_email.requested_action",
          neutralReplacementOptions: [],
        },
        {
          key: "deadline",
          label: "Deadline",
          factType: "date",
          placeholderLabel: "the response or action deadline",
          question:
            "Is there a real deadline for the requested action or response?",
          requiredForExport: false,
          sharedResolutionKey: "business_email.deadline",
          neutralReplacementOptions: [
            {
              id: "no-deadline",
              label: "No deadline",
              value:
                "request the action without inventing urgency or a due date",
              suitability: "Use when there is no confirmed deadline.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "next_step",
          label: "Next step",
          factType: "event",
          placeholderLabel: "the appropriate next step",
          question: "What should happen after the recipient responds or acts?",
          requiredForExport: false,
          sharedResolutionKey: "business_email.next_step",
          neutralReplacementOptions: [
            {
              id: "simple-close",
              label: "Simple professional close",
              value:
                "thank the recipient and close without inventing a follow-up commitment",
              suitability: "Use when no further step is known or required.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "preferred contact method",
        "meeting or call",
        "documents required",
        "thanks",
        "sender contact details",
      ],
    },
  ],
};

const BUSINESS_EMAIL_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-09",
  criteria: [
    "contract completeness: every Business Email section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Business Email asks for clarification",
    "generation resilience: complete usable Business Email wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events and source claims in the Business Email are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Business Email placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Business Email prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Business Email sections",
    "issue navigation: unresolved Business Email facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Business Email",
    "accessibility and recovery: each Business Email placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Business Email passes",
  ],
  notes: [
    "Unknown recipients use a declared neutral greeting rather than a fabricated name or relationship.",
    "Deadlines, prior commitments, amounts and supporting facts are never created merely to make the email sound more persuasive.",
    "The call to action remains explicit even when optional context, deadline or follow-up details are unavailable.",
  ],
} as const;

const ACADEMIC_APPEAL_LETTER_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "decision",
        requiredInformation: [
          {
            key: "decision",
            label: "Decision being appealed",
            factType: "event",
            placeholderLabel: "academic decision being appealed",
            question: "What exact academic decision are you appealing?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.decision",
            neutralReplacementOptions: [],
          },
          {
            key: "decision_date",
            label: "Decision date",
            factType: "date",
            placeholderLabel: "date of the decision",
            question: "When was that decision made or communicated to you?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.decision_date",
            neutralReplacementOptions: [],
          },
          {
            key: "course_or_program",
            label: "Course or program",
            factType: "other",
            placeholderLabel: "course or program",
            question:
              "Which course, unit or program does the decision relate to?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.course_program",
            neutralReplacementOptions: [],
          },
          {
            key: "student_identity",
            label: "Student identity",
            factType: "person_name",
            placeholderLabel: "student name",
            question: "What full name should appear on the appeal?",
            requiredForExport: true,
            sharedResolutionKey: "student.full_name",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "student number",
          "policy reference",
          "appeal deadline",
          "assessment component",
          "institution",
          "decision notice reference",
        ],
      },
      {
        sectionKey: "grounds",
        requiredInformation: [
          {
            key: "appeal_reason",
            label: "Grounds for appeal",
            factType: "other",
            placeholderLabel: "grounds for appeal",
            question: "What specific ground are you relying on for the appeal?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.grounds",
            neutralReplacementOptions: [],
          },
          {
            key: "evidence_basis",
            label: "Evidence basis",
            factType: "reference",
            placeholderLabel: "evidence supporting the appeal",
            question: "What evidence supports that ground?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.evidence",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "policy clause",
          "supporting-document list",
          "procedural issue",
          "grading-rubric reference",
          "second opinion",
          "appeal-guideline reference",
        ],
      },
      {
        sectionKey: "explanation",
        requiredInformation: [
          {
            key: "circumstances",
            label: "Circumstances",
            factType: "event",
            placeholderLabel: "circumstances affecting the outcome",
            question: "What happened that is relevant to the appeal?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.circumstances",
            neutralReplacementOptions: [],
          },
          {
            key: "timeframe",
            label: "Circumstance timeframe",
            factType: "date_range",
            placeholderLabel: "timeframe of the circumstances",
            question: "When did those circumstances occur?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.circumstance_timeframe",
            neutralReplacementOptions: [],
          },
          {
            key: "academic_impact",
            label: "Academic impact",
            factType: "other",
            placeholderLabel: "impact on academic performance",
            question:
              "How did those circumstances specifically affect your academic work or performance?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.academic_impact",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "actions taken",
          "communication attempts",
          "medical or support evidence",
          "responsibility taken",
          "chronology",
          "quantified impact",
          "supporting correspondence",
        ],
      },
      {
        sectionKey: "outcome",
        requiredInformation: [
          {
            key: "requested_remedy",
            label: "Requested remedy",
            factType: "other",
            placeholderLabel: "specific remedy requested",
            question:
              "What exact outcome are you asking the institution to provide?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.requested_remedy",
            neutralReplacementOptions: [],
          },
          {
            key: "decision_reference",
            label: "Decision reference",
            factType: "reference",
            placeholderLabel: "decision the remedy relates to",
            question:
              "Which part of the original decision should this requested remedy change or address?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.decision",
            neutralReplacementOptions: [],
          },
          {
            key: "specific_remedy_type",
            label: "Specific remedy type",
            factType: "other",
            placeholderLabel: "type of remedy requested",
            question:
              "Are you requesting a re-mark, re-enrolment, waiver, reconsideration or another specific remedy?",
            requiredForExport: true,
            sharedResolutionKey: "academic_appeal.requested_remedy",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "alternative remedy",
          "willingness to meet",
          "grounds-to-remedy link",
          "contact details",
          "student ID",
          "professional closing",
        ],
      },
    ],
  };

const ACADEMIC_APPEAL_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Academic Appeal Letter section captures the exact decision, date, course, grounds, evidence, factual explanation and specific remedy requested",
    "intake and context reuse: decision notices, correspondence, medical or support documents, institutional policies and previously confirmed student details are reused before clarification",
    "generation resilience: complete Academic Appeal Letter wording remains available around unresolved facts through explicit placeholders rather than assumptions about unfairness or procedural error",
    "factual safety: decisions, dates, circumstances, policy clauses, academic impacts and evidence are never fabricated",
    "placeholder integrity: every unresolved Academic Appeal Letter fact receives a specific contextual label, exact user question and export requirement",
    "resolution behaviour: shared decision, evidence and remedy facts update linked Academic Appeal Letter occurrences while unrelated explanation remains intact",
    "proofread behaviour: Academic Appeal Letter placeholders are excluded from editorial findings while surrounding factual prose remains reviewable for clarity and non-adversarial tone",
    "workspace persistence: resolved Academic Appeal Letter facts and user edits persist across sections without later answers overwriting unrelated content",
    "issue navigation: unresolved Academic Appeal Letter decision, grounds, evidence, explanation and remedy facts remain independently selectable",
    "export behaviour: all core appeal facts remain required because generic replacements could materially misstate the student's case",
    "accessibility and recovery: every Academic Appeal Letter placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Academic Appeal Letter validation, evidence grounding, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "An appeal must identify a genuine ground and evidence rather than merely characterising an outcome as unfair.",
    "Policy clauses may be referenced only when supplied or reliably sourced from the institution's actual policy.",
    "TED must not choose the requested remedy for the student; the specific outcome sought remains an explicit required fact.",
  ],
} as const;

const ACADEMIC_REFERENCE_REQUEST_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "request",
        requiredInformation: [
          {
            key: "academic_reference_request",
            label: "Reference request",
            factType: "event",
            placeholderLabel: "academic reference being requested",
            question:
              "What academic reference or recommendation are you asking this person to provide?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.request",
            neutralReplacementOptions: [],
          },
          {
            key: "opportunity",
            label: "Opportunity",
            factType: "other",
            placeholderLabel: "opportunity you are applying for",
            question:
              "What program, scholarship, course or other opportunity are you applying for?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.opportunity",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "deadline",
          "submission method",
          "respectful opt-out",
          "recipient title",
          "intended reference audience",
          "suggested word count",
          "acknowledgement request",
        ],
      },
      {
        sectionKey: "context",
        requiredInformation: [
          {
            key: "course_or_unit",
            label: "Course or unit",
            factType: "other",
            placeholderLabel: "course or unit you completed with the referee",
            question:
              "Which course, unit or academic activity connects you with this referee?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.relationship_course",
            neutralReplacementOptions: [],
          },
          {
            key: "timeframe",
            label: "Relationship timeframe",
            factType: "date_range",
            placeholderLabel: "timeframe of your academic relationship",
            question:
              "Over what period did this person teach, supervise or otherwise work with you?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.relationship_timeframe",
            neutralReplacementOptions: [],
          },
          {
            key: "work_completed",
            label: "Work completed with referee",
            factType: "achievement",
            placeholderLabel: "work the referee observed",
            question:
              "What work, project, assessment or contribution did this person directly observe?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.observed_work",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "grade",
          "project title",
          "class contribution",
          "supervisor relationship",
          "assessment scores",
          "awards",
          "leadership",
          "referee feedback",
        ],
      },
      {
        sectionKey: "application",
        requiredInformation: [
          {
            key: "program_focus",
            label: "Program or scholarship focus",
            factType: "reference",
            placeholderLabel: "opportunity focus",
            question:
              "What is the program or scholarship specifically looking for?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.opportunity_focus",
            neutralReplacementOptions: [],
          },
          {
            key: "desired_qualities",
            label: "Qualities to emphasise",
            factType: "skill",
            placeholderLabel: "qualities the referee should emphasise",
            question:
              "Which genuine qualities, capabilities or experiences would be most helpful for the referee to emphasise?",
            requiredForExport: true,
            sharedResolutionKey: "academic_reference.desired_qualities",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "selection criteria",
          "statement-of-purpose summary",
          "tailored talking points",
          "program mission",
          "research experience",
          "community involvement",
          "work experience",
        ],
      },
      {
        sectionKey: "close",
        requiredInformation: [
          {
            key: "supporting_materials_offer",
            label: "Supporting materials offer",
            factType: "reference",
            placeholderLabel: "offer to provide supporting materials",
            question:
              "What materials are you able to offer the referee, such as your resume, transcript or application information?",
            requiredForExport: false,
            sharedResolutionKey: "academic_reference.supporting_materials",
            neutralReplacementOptions: [
              {
                id: "general-materials-offer",
                label: "Offer materials if useful",
                value:
                  "I would be happy to provide any additional information that would be helpful.",
                suitability:
                  "Use when the sender wants to offer support without claiming a specific document is attached or available.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
          {
            key: "thanks",
            label: "Thanks",
            factType: "other",
            placeholderLabel: "thanks to the referee",
            question:
              "Would you like to include a brief thank-you for their time and consideration?",
            automaticFallback: "Thank you for considering my request.",
            requiredForExport: false,
            sharedResolutionKey: "academic_reference.thanks",
            neutralReplacementOptions: [
              {
                id: "simple-thanks",
                label: "Simple thanks",
                value: "Thank you for considering my request.",
                suitability:
                  "Use when a concise professional acknowledgement is appropriate.",
                clearsExportWarning: true,
                regenerateSurroundingWording: false,
              },
            ],
          },
        ],
        optionalInformation: [
          "attachment list",
          "reminder date",
          "contact details",
          "preferred reference format",
          "meeting availability",
          "mentorship acknowledgement",
          "full-name sign-off",
        ],
      },
    ],
  };

const ACADEMIC_REFERENCE_REQUEST_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Academic Reference Request section captures the opportunity, the genuine referee relationship, observed academic work, relevant qualities and supporting-material offer",
    "intake and context reuse: resume data, transcript information, application materials and confirmed academic history are reused before clarification",
    "generation resilience: complete Academic Reference Request wording remains available when specific supporting materials are not supplied through a declared general offer",
    "factual safety: grades, projects, awards, referee observations and relationship history are never fabricated",
    "placeholder integrity: every unresolved Academic Reference Request fact has a contextual label, exact clarification question and appropriate export policy",
    "resolution behaviour: shared opportunity, relationship and supporting-material facts update linked Academic Reference Request occurrences without changing unrelated wording",
    "proofread behaviour: Academic Reference Request placeholders remain outside editorial findings while surrounding prose remains reviewable for clarity and respectful tone",
    "workspace persistence: resolved Academic Reference Request facts and user edits persist independently across sections",
    "issue navigation: unresolved Academic Reference Request opportunity, relationship, observed work and emphasis facts remain independently countable",
    "export behaviour: the opportunity and real relationship context remain required while supporting-material and thanks wording can safely default",
    "accessibility and recovery: every Academic Reference Request placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Academic Reference Request validation, relationship-grounding, fallback behaviour and export tests must remain green",
  ],
  notes: [
    "TED must never imply that the referee observed academic work they did not actually see.",
    "Grades, awards and feedback are optional enhancements and may only be included when supplied.",
    "The supporting-material fallback intentionally avoids claiming a resume or transcript is attached when that has not been established.",
  ],
} as const;

const BOARD_REPORT_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "overview",
      requiredInformation: [
        {
          key: "reporting_period",
          label: "Reporting period",
          factType: "date_range",
          placeholderLabel: "board reporting period",
          question: "What reporting period does this board report cover?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.reporting_period",
          neutralReplacementOptions: [],
        },
        {
          key: "report_topic",
          label: "Report topic",
          factType: "other",
          placeholderLabel: "board report topic",
          question:
            "What business area, initiative or issue is this board report about?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.topic",
          neutralReplacementOptions: [],
        },
        {
          key: "key_update",
          label: "Key update",
          factType: "achievement",
          placeholderLabel: "headline board update",
          question:
            "What is the most important confirmed update the board needs to know from this period?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.key_update",
          neutralReplacementOptions: [],
        },
        {
          key: "decision_needed",
          label: "Decision needed",
          factType: "other",
          placeholderLabel: "board decision needed",
          question:
            "Does the board need to approve, note or decide anything as a result of this report?",
          requiredForExport: false,
          sharedResolutionKey: "board_report.decision_needed",
          neutralReplacementOptions: [
            {
              id: "no-decision-required",
              label: "No decision required",
              value:
                "No board decision is required for this item; it is provided for noting.",
              suitability:
                "Use only when the report is genuinely for information or noting and no approval is being sought.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "strategic context",
        "exception reporting",
        "headline KPI snapshot",
        "stakeholder impact",
        "future outlook",
        "decision urgency",
        "cross-functional alignment",
      ],
    },
    {
      sectionKey: "performance",
      requiredInformation: [
        {
          key: "key_metrics",
          label: "Key metrics",
          factType: "amount",
          placeholderLabel: "key performance metrics",
          question:
            "Which confirmed metrics should the board see for this period?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.metrics",
          neutralReplacementOptions: [],
        },
        {
          key: "comparison_to_baseline",
          label: "Comparison to target or baseline",
          factType: "other",
          placeholderLabel: "performance against target or baseline",
          question:
            "How did those metrics compare with the agreed target, budget, prior period or other baseline?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.performance_comparison",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "trend analysis",
        "segment breakdown",
        "management response",
        "peer benchmark",
        "variance causes",
        "forecast",
        "customer impact",
        "data reliability notes",
      ],
    },
    {
      sectionKey: "risks",
      requiredInformation: [
        {
          key: "current_risks_and_issues",
          label: "Current risks and issues",
          factType: "other",
          placeholderLabel: "current risks or issues",
          question:
            "What material risks or current issues does the board need to know about?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.risks_issues",
          neutralReplacementOptions: [],
        },
        {
          key: "mitigations",
          label: "Mitigations",
          factType: "responsibility",
          placeholderLabel: "risk mitigations",
          question:
            "What controls or mitigation actions are already in place for those risks or issues?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.mitigations",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "risk rating",
        "risk appetite alignment",
        "owner",
        "due date",
        "emerging risks",
        "contingency triggers",
        "historical risk trend",
        "regulatory implications",
      ],
    },
    {
      sectionKey: "decisions",
      requiredInformation: [
        {
          key: "approval_or_noting_request",
          label: "Board approval or noting request",
          factType: "other",
          placeholderLabel: "specific board request",
          question: "What exactly is the board being asked to approve or note?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.board_request",
          neutralReplacementOptions: [],
        },
        {
          key: "motion_or_decision",
          label: "Decision wording",
          factType: "other",
          placeholderLabel: "specific decision or motion",
          question:
            "How should the decision or motion be framed so the board can act on it clearly?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.decision_wording",
          neutralReplacementOptions: [],
        },
        {
          key: "recommendation_and_rationale",
          label: "Recommendation and rationale",
          factType: "other",
          placeholderLabel: "recommendation and rationale",
          question: "What is management recommending, and why?",
          requiredForExport: true,
          sharedResolutionKey: "board_report.recommendation",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "resolution wording",
        "implications",
        "alternatives considered",
        "stakeholder consultation",
        "legal or compliance review",
        "implementation timeline",
        "success criteria",
      ],
    },
  ],
};

const BOARD_REPORT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Board Report section captures the reporting period, headline update, performance evidence, material risks and the exact approval or noting request",
    "intake and context reuse: financials, KPI dashboards, prior board papers, management updates and confirmed business context are reused before the Board Report asks for clarification",
    "generation resilience: complete Board Report wording remains available when an item is genuinely for noting through the declared no-decision replacement while unresolved substantive facts remain explicit placeholders",
    "factual safety: performance figures, risks, mitigations, recommendations and proposed decisions are never invented or presented without supporting source material",
    "placeholder integrity: every unresolved Board Report fact has a contextual label, exact plain-language question, section-specific information key and explicit export behaviour",
    "resolution behaviour: reporting period, performance, risk and decision facts resolve linked Board Report occurrences without overwriting unrelated board commentary",
    "proofread behaviour: declared Board Report placeholders are excluded from editorial findings while surrounding executive prose remains reviewable for clarity, concision and unsupported certainty",
    "workspace persistence: board edits, resolved values and unresolved Board Report facts persist independently across executive, performance, risk and decision sections",
    "issue navigation: unresolved Board Report facts remain individually countable so a missing decision, metric or mitigation can be resolved without reopening the whole report",
    "export behaviour: core performance, risk and decision facts require acknowledgement while a genuinely informational item can safely state that no board decision is required",
    "accessibility and recovery: every Board Report placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Board Report validation, numerical grounding, shared-resolution behaviour, decision-state handling and export acknowledgement tests must remain green",
  ],
  notes: [
    "Board performance figures must come from supplied data or confirmed source material and must never be reconstructed from incomplete context.",
    "The no-decision replacement is valid only where the item is genuinely being provided for noting.",
    "Recommendation wording must remain distinguishable from an approved board decision until the board has actually made that decision.",
  ],
} as const;

const BUDGET_WORKBOOK_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "income",
      requiredInformation: [
        {
          key: "income_sources",
          label: "Income sources",
          factType: "other",
          placeholderLabel: "income sources",
          question: "What sources of income should be included in the budget?",
          requiredForExport: true,
          sharedResolutionKey: "budget.income_sources",
          neutralReplacementOptions: [],
        },
        {
          key: "income_amount_and_frequency",
          label: "Income amounts and frequency",
          factType: "amount",
          placeholderLabel: "income amounts and frequency",
          question:
            "How much comes from each income source, and is each amount weekly, fortnightly or monthly?",
          requiredForExport: true,
          sharedResolutionKey: "budget.income_amounts",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "irregular income",
        "expected income changes",
        "partner or household income",
        "tax withholding",
        "side-income forecasts",
        "seasonal income patterns",
        "salary packaging",
        "superannuation contributions",
      ],
    },
    {
      sectionKey: "expenses",
      requiredInformation: [
        {
          key: "regular_expense_categories",
          label: "Regular expense categories",
          factType: "other",
          placeholderLabel: "regular expense categories",
          question:
            "What regular expense categories should the budget include, such as housing, utilities, groceries and transport?",
          requiredForExport: true,
          sharedResolutionKey: "budget.expense_categories",
          neutralReplacementOptions: [],
        },
        {
          key: "monthly_expense_amounts",
          label: "Monthly expense amounts",
          factType: "amount",
          placeholderLabel: "monthly expense amounts",
          question:
            "About how much do you spend per month in each regular expense category?",
          requiredForExport: true,
          sharedResolutionKey: "budget.expense_amounts",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "discretionary spending",
        "annual expenses averaged monthly",
        "areas targeted for reduction",
        "seasonal utility costs",
        "subscriptions",
        "childcare or education costs",
        "insurance premiums",
        "transport-cost assumptions",
      ],
    },
    {
      sectionKey: "savings",
      requiredInformation: [
        {
          key: "current_savings_or_goal",
          label: "Savings position or goal",
          factType: "amount",
          placeholderLabel: "current savings or savings goal",
          question:
            "What is your current savings amount or the savings goal you want this budget to work toward?",
          requiredForExport: true,
          sharedResolutionKey: "budget.savings_goal",
          neutralReplacementOptions: [],
        },
        {
          key: "regular_savings_amount",
          label: "Regular savings contribution",
          factType: "amount",
          placeholderLabel: "regular savings amount",
          question:
            "How much are you currently setting aside, or planning to set aside, on a regular basis?",
          requiredForExport: true,
          sharedResolutionKey: "budget.regular_savings",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "savings goal type",
        "target date",
        "separate savings buckets",
        "automatic-transfer schedule",
        "account interest rate",
        "emergency-fund target",
        "progress tracking",
        "goal review cadence",
      ],
    },
    {
      sectionKey: "debt",
      requiredInformation: [
        {
          key: "debt_balances_and_repayments",
          label: "Debt balances and repayments",
          factType: "amount",
          placeholderLabel: "debt balances and minimum repayments",
          question:
            "What debts do you have, and what are the current balance and minimum repayment for each one?",
          requiredForExport: false,
          sharedResolutionKey: "budget.debts",
          neutralReplacementOptions: [
            {
              id: "no-debt-included",
              label: "No debt included",
              value: "No debt commitments are included in this budget.",
              suitability:
                "Use only when the user confirms that no debts need to be included in the budget.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "interest rate for each debt",
        "repayment strategy",
        "target payoff dates",
        "refinancing considerations",
        "repayment buffer",
        "penalty-fee risks",
        "debt-to-income ratio",
        "repayment milestones",
      ],
    },
  ],
};

const BUDGET_WORKBOOK_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Budget Workbook section captures the source and cadence of income, recurring expenses, savings position and contributions, and any debt balances with minimum repayments",
    "intake and context reuse: uploaded statements, bills, loan records and previously supplied household figures can resolve Budget Workbook facts before additional questions are asked",
    "generation resilience: the Budget Workbook retains a complete income-expense-savings-debt structure while unresolved amounts remain visible as specific interactive placeholders",
    "factual safety: no income, spending, savings, debt balance or repayment figure is estimated and presented as the user's real financial information without a supplied source",
    "placeholder integrity: every unresolved Budget Workbook amount or category has its own contextual label, exact clarification question, export state and reusable resolution key",
    "resolution behaviour: recurring financial facts can resolve their linked Budget Workbook occurrences without modifying unrelated categories, notes or calculations",
    "proofread behaviour: Budget Workbook placeholder labels are excluded from editorial findings while explanatory text and category descriptions remain reviewable",
    "workspace persistence: entered financial figures, category edits and unresolved Budget Workbook facts persist independently so later answers do not reset other budget data",
    "issue navigation: missing Budget Workbook income, expense, savings and debt facts remain separately countable and selectable rather than collapsing into a single financial-data warning",
    "export behaviour: unresolved core income, expense and savings figures require acknowledgement while a confirmed no-debt state can safely replace the debt placeholder",
    "accessibility and recovery: each Budget Workbook placeholder states clearly what financial fact is missing and asks for it in plain language while malformed tokens remain visible",
    "regression and release evidence: Budget Workbook validation, amount handling, placeholder resolution, reconciliation behaviour and export-state regression tests must pass before release",
  ],
  notes: [
    "The no-debt replacement is valid only after explicit confirmation; an unanswered debt question must never be interpreted as having no debt.",
    "Amounts and frequencies are kept together where their meaning depends on one another so a weekly figure cannot silently become a monthly figure.",
    "The contract governs factual completeness and does not convert the workbook into personal financial advice.",
  ],
} as const;

const BUSINESS_PLAN_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "concept",
      requiredInformation: [
        {
          key: "product_or_service",
          label: "Product or service",
          factType: "other",
          placeholderLabel: "product or service",
          question: "What does the business actually sell or provide?",
          requiredForExport: true,
          sharedResolutionKey: "business.product_service",
          neutralReplacementOptions: [],
        },
        {
          key: "target_customer",
          label: "Target customer",
          factType: "other",
          placeholderLabel: "target customer",
          question: "Who is the primary customer for the business?",
          requiredForExport: true,
          sharedResolutionKey: "business.target_customer",
          neutralReplacementOptions: [],
        },
        {
          key: "problem_solved",
          label: "Problem solved",
          factType: "other",
          placeholderLabel: "customer problem solved",
          question:
            "What real customer problem does the product or service solve?",
          requiredForExport: true,
          sharedResolutionKey: "business.problem_solved",
          neutralReplacementOptions: [],
        },
        {
          key: "differentiator",
          label: "Differentiator",
          factType: "other",
          placeholderLabel: "business differentiator",
          question:
            "What genuinely differentiates this business from the alternatives customers already have?",
          requiredForExport: true,
          sharedResolutionKey: "business.differentiator",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "mission",
        "positioning",
        "founder insight",
        "brand story",
        "value proposition",
        "stakeholder benefits",
      ],
    },
    {
      sectionKey: "market",
      requiredInformation: [
        {
          key: "target_market",
          label: "Target market",
          factType: "other",
          placeholderLabel: "target market",
          question:
            "What market or customer segment is the business targeting?",
          requiredForExport: true,
          sharedResolutionKey: "business.target_market",
          neutralReplacementOptions: [],
        },
        {
          key: "demand_driver",
          label: "Demand driver",
          factType: "other",
          placeholderLabel: "evidence or driver of demand",
          question:
            "What is driving genuine demand for this product or service?",
          requiredForExport: true,
          sharedResolutionKey: "business.demand_driver",
          neutralReplacementOptions: [],
        },
        {
          key: "competitor_context",
          label: "Competitor context",
          factType: "other",
          placeholderLabel: "competitive context",
          question:
            "What alternatives or competitors do customers currently have?",
          requiredForExport: true,
          sharedResolutionKey: "business.competitor_context",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "market size",
        "segments",
        "customer personas",
        "market trends",
        "validation evidence",
        "regulatory environment",
        "partnership opportunities",
      ],
    },
    {
      sectionKey: "operating_model",
      requiredInformation: [
        {
          key: "delivery_channel",
          label: "Delivery channel",
          factType: "other",
          placeholderLabel: "delivery channel",
          question:
            "How will the product or service reach and be delivered to customers?",
          requiredForExport: true,
          sharedResolutionKey: "business.delivery_channel",
          neutralReplacementOptions: [],
        },
        {
          key: "resources",
          label: "Required resources",
          factType: "other",
          placeholderLabel: "resources required",
          question: "What key resources are required to operate the business?",
          requiredForExport: true,
          sharedResolutionKey: "business.resources",
          neutralReplacementOptions: [],
        },
        {
          key: "team",
          label: "Team",
          factType: "other",
          placeholderLabel: "team or required roles",
          question:
            "Who is involved in running the business, or what roles need to be filled?",
          requiredForExport: true,
          sharedResolutionKey: "business.team",
          neutralReplacementOptions: [],
        },
        {
          key: "core_operations",
          label: "Core operations",
          factType: "responsibility",
          placeholderLabel: "core operating activities",
          question:
            "What are the core activities the business must perform consistently to operate?",
          requiredForExport: true,
          sharedResolutionKey: "business.core_operations",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "systems",
        "suppliers",
        "process map",
        "staffing plan",
        "risk controls",
        "technology stack",
        "operational KPIs",
        "quality assurance",
      ],
    },
    {
      sectionKey: "financials",
      requiredInformation: [
        {
          key: "revenue_streams",
          label: "Revenue streams",
          factType: "amount",
          placeholderLabel: "revenue streams",
          question: "How will the business make money?",
          requiredForExport: true,
          sharedResolutionKey: "business.revenue_model",
          neutralReplacementOptions: [],
        },
        {
          key: "costs",
          label: "Main costs",
          factType: "amount",
          placeholderLabel: "main business costs",
          question:
            "What are the main costs of running and delivering the business?",
          requiredForExport: true,
          sharedResolutionKey: "business.cost_structure",
          neutralReplacementOptions: [],
        },
        {
          key: "break_even_logic",
          label: "Break-even logic",
          factType: "other",
          placeholderLabel: "break-even condition",
          question:
            "Under what realistic sales or operating conditions would the business break even?",
          requiredForExport: true,
          sharedResolutionKey: "business.break_even",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "financial forecasts",
        "margins",
        "funding requirements",
        "financial assumptions",
        "sensitivity scenarios",
        "capital expenditure",
        "cash flow",
      ],
    },
    {
      sectionKey: "milestones",
      requiredInformation: [
        {
          key: "key_milestones",
          label: "Key milestones",
          factType: "event",
          placeholderLabel: "key business milestones",
          question:
            "What are the most important milestones the business needs to achieve next?",
          requiredForExport: true,
          sharedResolutionKey: "business.milestones",
          neutralReplacementOptions: [],
        },
        {
          key: "timeframe",
          label: "Milestone timeframe",
          factType: "date_range",
          placeholderLabel: "milestone timeframe",
          question: "By when should each major milestone be achieved?",
          requiredForExport: true,
          sharedResolutionKey: "business.milestone_timeframe",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "milestone owners",
        "success metrics",
        "dependencies",
        "resource allocation",
        "risk mitigation",
        "contingency triggers",
        "reporting cadence",
      ],
    },
  ],
};

const BUSINESS_PLAN_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Business Plan section captures the business concept, customer problem, market evidence, operating model, financial logic and timed milestones",
    "intake and context reuse: existing business documents, market research, financial forecasts and confirmed founder information are reused before clarification",
    "generation resilience: the Business Plan remains fully structured when unresolved facts are represented by declared placeholders rather than speculative business assumptions",
    "factual safety: market demand, competitors, revenue, costs, forecasts and milestones are never fabricated or presented as validated when they are not",
    "placeholder integrity: every unresolved Business Plan fact receives a specific label, exact question and export rule tied to its actual section",
    "resolution behaviour: shared product, market, operating and financial facts resolve linked Business Plan occurrences without modifying unrelated assumptions",
    "proofread behaviour: Business Plan placeholders are excluded from editorial findings while surrounding strategy and explanatory wording remains reviewable",
    "workspace persistence: resolved Business Plan facts and edited assumptions persist section by section without regeneration of unrelated content",
    "issue navigation: unresolved Business Plan facts remain independently countable across concept, market, operations, financial outlook and milestones",
    "export behaviour: core customer, market, operating and financial facts require acknowledgement because generic substitutes could materially misrepresent the business",
    "accessibility and recovery: every Business Plan placeholder exposes a meaningful label and conversational question and malformed tokens remain visible",
    "regression and release evidence: Business Plan validation, numerical-grounding, shared-resolution and export tests must pass without weakening other templates",
  ],
  notes: [
    "Forecasts, market size and financial figures must remain clearly sourced or identified as assumptions rather than fabricated facts.",
    "The differentiator is required because generic competitive-advantage language cannot safely substitute for the business's real position.",
    "Break-even wording must be tied to supplied figures or explicit assumptions rather than an unsupported forecast.",
  ],
} as const;

const CAREER_CHANGE_PLAN_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "direction",
      requiredInformation: [
        {
          key: "current_role_or_field",
          label: "Current role or field",
          factType: "role_title",
          placeholderLabel: "current role or field",
          question: "What role or field are you moving from?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.current_role",
          neutralReplacementOptions: [],
        },
        {
          key: "target_role_or_field",
          label: "Target role or field",
          factType: "role_title",
          placeholderLabel: "target role or field",
          question: "What role or field do you want to move into?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.target_role",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "motivation for change",
        "preferred sector",
        "salary constraints",
        "work-mode preference",
        "transition deadline",
        "geographic preference",
        "risk tolerance",
        "long-term goals",
      ],
    },
    {
      sectionKey: "strengths",
      requiredInformation: [
        {
          key: "relevant_existing_skills",
          label: "Relevant existing skills",
          factType: "skill",
          placeholderLabel: "transferable existing skills",
          question:
            "Which skills from your current experience are genuinely relevant to the target field?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.transferable_skills",
          neutralReplacementOptions: [],
        },
        {
          key: "target_requirement_mapping",
          label: "Target requirement mapping",
          factType: "skill",
          placeholderLabel: "how your skills map to the target field",
          question:
            "What requirements of the target field does each transferable skill help you meet?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.skill_mapping",
          neutralReplacementOptions: [],
        },
        {
          key: "skill_evidence",
          label: "Evidence of transferable skills",
          factType: "achievement",
          placeholderLabel: "evidence supporting transferable skills",
          question:
            "What real examples from past roles or projects prove those transferable skills?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.skill_evidence",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "portfolio evidence",
        "mapped competencies",
        "quantified achievements",
        "client feedback",
        "proficiency ratings",
        "industry terminology",
        "target job-description keywords",
      ],
    },
    {
      sectionKey: "gaps",
      requiredInformation: [
        {
          key: "missing_skills_or_experience",
          label: "Skills or experience gaps",
          factType: "skill",
          placeholderLabel: "skills or experience gaps",
          question:
            "What skills, qualifications or experience are you still missing for the target field?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.gaps",
          neutralReplacementOptions: [],
        },
        {
          key: "gap_closing_actions",
          label: "Gap-closing actions",
          factType: "responsibility",
          placeholderLabel: "actions to close the gaps",
          question:
            "What specific actions will you take to close each of those gaps?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.gap_actions",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "named courses",
        "projects",
        "mentors",
        "certifications",
        "priority ranking",
        "shadowing opportunities",
        "conferences",
        "peer-review feedback",
      ],
    },
    {
      sectionKey: "timeline",
      requiredInformation: [
        {
          key: "timeframe",
          label: "Transition timeframe",
          factType: "date_range",
          placeholderLabel: "career transition timeframe",
          question:
            "What timeframe are you working toward for this career change?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.timeframe",
          neutralReplacementOptions: [],
        },
        {
          key: "milestones",
          label: "Transition milestones",
          factType: "event",
          placeholderLabel: "career change milestones",
          question:
            "What milestones should mark progress toward the career change?",
          requiredForExport: true,
          sharedResolutionKey: "career_change.milestones",
          neutralReplacementOptions: [],
        },
        {
          key: "review_cadence",
          label: "Review cadence",
          factType: "date_range",
          placeholderLabel: "progress review cadence",
          question: "How often should you review progress and adjust the plan?",
          automaticFallback:
            "review progress monthly and adjust the plan when evidence shows the current approach is not working",
          requiredForExport: false,
          sharedResolutionKey: "career_change.review_cadence",
          neutralReplacementOptions: [
            {
              id: "monthly-review",
              label: "Monthly review",
              value:
                "review progress monthly and adjust the plan when evidence shows the current approach is not working",
              suitability:
                "Use when the user has not chosen a review cadence and a practical recurring check-in is needed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "weekly actions",
        "networking targets",
        "risk plan",
        "success indicators",
        "accountability partner",
        "contingency buffers",
        "adjustment triggers",
        "quarterly summaries",
      ],
    },
  ],
};

const CAREER_CHANGE_PLAN_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Career Change Plan section captures the current and target direction, transferable evidence, genuine gaps, gap-closing actions, milestones and review cadence",
    "intake and context reuse: current resume data, target job advertisements, confirmed skills and prior career discussion are reused before the Career Change Plan asks for clarification",
    "generation resilience: the Career Change Plan remains actionable when unresolved facts are represented by specific placeholders and can still use a declared monthly review cadence when no preference is supplied",
    "factual safety: transferable skills, evidence, gaps, qualifications and readiness for the target field are never invented or overstated",
    "placeholder integrity: every unresolved Career Change Plan fact has a contextual label, direct question, export rule and shared-resolution key where the real-world fact recurs",
    "resolution behaviour: current role, target role, skills, gaps and timing can update linked Career Change Plan occurrences without altering unrelated milestones or user wording",
    "proofread behaviour: Career Change Plan placeholders remain outside editorial findings while surrounding actions and sequencing remain reviewable for specificity and feasibility",
    "workspace persistence: resolved facts, action-plan edits and Career Change Plan milestones persist independently across sections",
    "issue navigation: unresolved Career Change Plan direction, skill evidence, gaps and timeline facts remain individually countable and selectable",
    "export behaviour: target direction, transferable evidence and gap actions require acknowledgement when unresolved while the declared review cadence can safely resolve without a personal factual claim",
    "accessibility and recovery: each Career Change Plan placeholder identifies exactly what is missing and asks for it in plain language while malformed tokens remain visible",
    "regression and release evidence: Career Change Plan validation, evidence-grounding, automatic-fallback handling, placeholder resolution and export tests must remain green",
  ],
  notes: [
    "A transferable skill must be supported by real evidence rather than assumed from the candidate's current job title.",
    "The plan must identify actual gaps instead of presenting the candidate as already qualified for a target field when that has not been established.",
    "A monthly progress review is a safe planning default because it describes plan mechanics rather than inventing a personal fact.",
  ],
} as const;

const CASH_FLOW_FORECAST_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "basis",
      requiredInformation: [
        {
          key: "opening_cash",
          label: "Opening cash",
          factType: "amount",
          placeholderLabel: "opening cash balance",
          question:
            "What confirmed opening cash balance should the forecast start from?",
          requiredForExport: true,
          sharedResolutionKey: "cash_flow.opening_cash",
          neutralReplacementOptions: [],
        },
        {
          key: "horizon_and_granularity",
          label: "Horizon and granularity",
          factType: "date_range",
          placeholderLabel: "forecast horizon and granularity",
          question:
            "What period should the forecast cover, and should it be shown weekly, monthly or on another cadence?",
          requiredForExport: true,
          sharedResolutionKey: "cash_flow.horizon",
          neutralReplacementOptions: [],
        },
        {
          key: "currency",
          label: "Currency",
          factType: "other",
          placeholderLabel: "forecast currency",
          question: "What currency should the cash flow forecast use?",
          requiredForExport: true,
          sharedResolutionKey: "cash_flow.currency",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "scenario assumptions",
      ],
    },
    {
      sectionKey: "movements",
      requiredInformation: [
        {
          key: "inflows_and_timing",
          label: "Inflows and timing",
          factType: "amount",
          placeholderLabel: "expected cash inflows and timing",
          question:
            "What cash inflows are expected, how much is each one, and when is each expected to arrive?",
          requiredForExport: true,
          sharedResolutionKey: "cash_flow.inflows",
          neutralReplacementOptions: [],
        },
        {
          key: "outflows_and_timing",
          label: "Outflows and timing",
          factType: "amount",
          placeholderLabel: "expected cash outflows and timing",
          question:
            "What cash outflows are expected, how much is each one, and when is each expected to be paid?",
          requiredForExport: true,
          sharedResolutionKey: "cash_flow.outflows",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "tax timing",
        "financing timing",
      ],
    },
    {
      sectionKey: "position",
      requiredInformation: [
        {
          key: "closing_cash_formula",
          label: "Closing cash formula",
          factType: "other",
          placeholderLabel: "closing cash calculation",
          question:
            "What calculation should be used to reconcile each period's closing cash from opening cash and net movements?",
          automaticFallback:
            "closing cash = opening cash + confirmed inflows - confirmed outflows",
          requiredForExport: false,
          sharedResolutionKey: "cash_flow.closing_formula",
          neutralReplacementOptions: [
            {
              id: "standard-closing-balance",
              label: "Standard closing balance",
              value:
                "closing cash = opening cash + confirmed inflows - confirmed outflows",
              suitability:
                "Use when no alternative cash-reconciliation method applies and the forecast follows the standard deterministic closing-balance structure.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "scenario comparison",
        "low-cash warnings",
      ],
    },
  ],
};

const CASH_FLOW_FORECAST_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Cash Flow Forecast section captures opening cash, forecast horizon, currency, timed inflows, timed outflows and a deterministic closing-balance calculation",
    "intake and context reuse: bank statements, accounting exports, forecasts and previously confirmed payment schedules are reused before clarification",
    "generation resilience: complete Cash Flow Forecast structure remains available with a safe deterministic closing-balance formula while unresolved personal or business cash movements remain explicit placeholders",
    "factual safety: opening cash, inflows, outflows, dates and low-cash periods are never invented",
    "placeholder integrity: every unresolved Cash Flow Forecast fact has a contextual label, exact question and deliberate fallback or export policy",
    "resolution behaviour: shared opening cash, inflow, outflow and timing facts update linked Cash Flow Forecast occurrences without altering unrelated scenario assumptions",
    "proofread behaviour: Cash Flow Forecast placeholders remain outside editorial findings while surrounding analytical wording remains reviewable for clarity and assumption transparency",
    "workspace persistence: resolved Cash Flow Forecast figures, timing and scenario edits persist independently across sections",
    "issue navigation: unresolved Cash Flow Forecast opening balance, inflows, outflows and timing facts remain independently countable and selectable",
    "export behaviour: all actual cash figures and timing inputs remain required while the standard deterministic closing-balance formula can safely resolve automatically",
    "accessibility and recovery: every Cash Flow Forecast placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Cash Flow Forecast validation, arithmetic reconciliation, low-cash warning logic, fallback behaviour and export tests must remain green",
  ],
  notes: [
    "Closing cash must always reconcile mathematically from the confirmed opening balance and stated inflows and outflows.",
    "Assumptions and confirmed cash movements must remain visibly distinguishable.",
    "The standard closing-balance formula is a safe automatic fallback because it defines calculation mechanics rather than inventing a financial fact.",
  ],
} as const;

const COURSE_COMPARISON_MATRIX_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "options",
        requiredInformation: [
          {
            key: "courses_or_programs",
            label: "Courses or programs",
            factType: "other",
            placeholderLabel: "courses or programs being compared",
            question: "Which courses or programs do you want to compare?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.options",
            neutralReplacementOptions: [],
          },
          {
            key: "named_options_with_providers",
            label: "Named options and providers",
            factType: "institution",
            placeholderLabel: "named courses and providers",
            question:
              "What are the names of at least two real courses or programs, and which institution or provider offers each one?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.named_options",
            neutralReplacementOptions: [],
          },
          {
            key: "key_option_facts",
            label: "Key facts per option",
            factType: "other",
            placeholderLabel: "duration, cost, mode and entry requirements",
            question:
              "What confirmed facts do you have for each option about duration, cost, delivery mode and entry requirements?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.option_facts",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "institution names",
          "locations",
          "intake dates",
          "accreditation",
          "scholarships",
          "industry partnerships",
          "alumni network",
          "campus facilities",
        ],
      },
      {
        sectionKey: "criteria",
        requiredInformation: [
          {
            key: "decision_criteria",
            label: "Decision criteria",
            factType: "other",
            placeholderLabel: "criteria that matter for the decision",
            question:
              "What factors genuinely matter to you when choosing between these options?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.criteria",
            neutralReplacementOptions: [],
          },
          {
            key: "criteria_priority",
            label: "Criteria priority",
            factType: "other",
            placeholderLabel: "importance of each criterion",
            question:
              "How should those criteria be ranked or weighted by importance?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.criteria_priority",
            neutralReplacementOptions: [],
          },
          {
            key: "minimum_criteria_coverage",
            label: "Cost, outcome and practicality coverage",
            factType: "other",
            placeholderLabel:
              "criteria covering cost, outcome and practicality",
            question:
              "Which criteria cover cost, likely outcomes and practical fit so the comparison isn't based on only one dimension?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.criteria_coverage",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "must-have constraints",
          "career outcomes",
          "entry requirements",
          "budget scenarios",
          "salary projections",
          "employer demand",
          "geographic flexibility",
          "learning support",
        ],
      },
      {
        sectionKey: "notes",
        requiredInformation: [
          {
            key: "strengths_and_weaknesses",
            label: "Relative strengths and weaknesses",
            factType: "other",
            placeholderLabel: "real strengths and weaknesses of each option",
            question:
              "What are the genuine strengths and weaknesses of each option based on the available evidence?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.strengths_weaknesses",
            neutralReplacementOptions: [],
          },
          {
            key: "front_runner_or_tradeoff",
            label: "Front-runner or blocking trade-off",
            factType: "other",
            placeholderLabel: "front-runner or key trade-off",
            question:
              "Is there a clear front-runner, or what trade-off is preventing a decision?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.front_runner_tradeoff",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "evidence links",
          "student reviews",
          "rankings",
          "placement data",
          "risk notes",
          "graduation rates",
          "attrition data",
          "industry recognition",
        ],
      },
      {
        sectionKey: "recommendation",
        requiredInformation: [
          {
            key: "preferred_option",
            label: "Preferred option",
            factType: "other",
            placeholderLabel: "preferred course or program",
            question:
              "Which option is preferred based on the criteria that matter most?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.preferred_option",
            neutralReplacementOptions: [],
          },
          {
            key: "recommendation_reason",
            label: "Reason for recommendation",
            factType: "other",
            placeholderLabel: "reason for the preferred option",
            question:
              "Why is that option the strongest choice when measured against your priorities?",
            requiredForExport: true,
            sharedResolutionKey: "course_comparison.recommendation_reason",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "trade-offs",
          "backup option",
          "next steps",
          "application deadline",
          "cost-benefit summary",
          "enrolment timeline",
          "risk mitigation",
        ],
      },
    ],
  };

const COURSE_COMPARISON_MATRIX_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Course Comparison Matrix section captures at least two real options, verified option facts, decision criteria, trade-offs and an evidence-based recommendation",
    "intake and context reuse: course brochures, provider data, user constraints and previously gathered comparison information are reused before clarification",
    "generation resilience: complete Course Comparison Matrix structure remains available while unknown course facts stay explicit rather than being guessed",
    "factual safety: costs, durations, entry requirements, accreditation, rankings and outcomes are never invented",
    "placeholder integrity: every unresolved Course Comparison Matrix fact has a contextual label, exact question and explicit export requirement",
    "resolution behaviour: shared option, criterion and recommendation facts update linked Course Comparison Matrix occurrences without altering unrelated comparison notes",
    "proofread behaviour: Course Comparison Matrix placeholders remain outside editorial findings while surrounding analysis remains reviewable for fairness and clarity",
    "workspace persistence: resolved course facts, criteria and recommendation edits persist independently across sections",
    "issue navigation: unresolved Course Comparison Matrix options, criteria, evidence and recommendation facts remain independently selectable",
    "export behaviour: real option facts, criteria and recommendation reasoning remain required because generic replacements could distort a consequential education decision",
    "accessibility and recovery: every Course Comparison Matrix placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Course Comparison Matrix validation, option-fact grounding, weighting consistency and export tests must remain green",
  ],
  notes: [
    "Comparison facts such as cost, duration and entry requirements must come from supplied or verified course information.",
    "TED must not make every option appear equally strong when the evidence shows meaningful differences.",
    "The recommendation should follow the user's stated priorities rather than imposing TED's own preferences.",
  ],
} as const;

const EBITDA_ANALYSIS_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "source_result",
      requiredInformation: [
        {
          key: "entity_period_currency_basis",
          label: "Entity, period, currency and basis",
          factType: "other",
          placeholderLabel: "entity, period, currency and accounting basis",
          question:
            "Which entity is this analysis for, what period does it cover, what currency is used, and what accounting basis applies?",
          requiredForExport: true,
          sharedResolutionKey: "ebitda.source_context",
          neutralReplacementOptions: [],
        },
        {
          key: "source_operating_result",
          label: "Source operating result",
          factType: "amount",
          placeholderLabel: "source operating result",
          question:
            "What confirmed operating result are we starting from, and where does that figure come from?",
          requiredForExport: true,
          sharedResolutionKey: "ebitda.source_operating_result",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "period comparison",
      ],
    },
    {
      sectionKey: "reconciliation",
      requiredInformation: [
        {
          key: "source_lines_and_formula",
          label: "Source lines and formula",
          factType: "amount",
          placeholderLabel:
            "interest, tax, depreciation and amortisation source lines",
          question:
            "What confirmed interest, tax, depreciation and amortisation figures should be added back, and what formula should the reconciliation use?",
          requiredForExport: true,
          sharedResolutionKey: "ebitda.reconciliation_inputs",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "waterfall visual",
        "margin trend",
      ],
    },
    {
      sectionKey: "adjustments",
      requiredInformation: [
        {
          key: "adjustment_evidence_and_rationale",
          label: "Adjustment evidence and rationale",
          factType: "reference",
          placeholderLabel:
            "evidence and rationale for each normalising adjustment",
          question:
            "What normalising adjustments are being proposed, and what evidence and rationale support each one?",
          requiredForExport: true,
          sharedResolutionKey: "ebitda.adjustments",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "reported-versus-adjusted comparison",
      ],
    },
    {
      sectionKey: "limitations",
      requiredInformation: [
        {
          key: "definition_and_limitations",
          label: "Definition and limitations",
          factType: "other",
          placeholderLabel: "EBITDA definition and analysis limitations",
          question:
            "What EBITDA definition is being used, and what limitations or assumptions should be stated when interpreting the result?",
          requiredForExport: true,
          sharedResolutionKey: "ebitda.definition_limitations",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "review questions",
      ],
    },
  ],
};

const EBITDA_ANALYSIS_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every EBITDA Analysis section captures the source operating result, entity and reporting context, reconciliation inputs, normalising adjustments, evidence, definition and limitations",
    "intake and context reuse: financial statements, accounting exports, prior-period results and previously confirmed entity information are reused before clarification",
    "generation resilience: complete EBITDA Analysis structure remains available while unsupported financial inputs or adjustments remain explicit placeholders rather than being estimated",
    "factual safety: operating results, interest, tax, depreciation, amortisation and normalising adjustments are never fabricated",
    "placeholder integrity: every unresolved EBITDA Analysis fact has a contextual label, exact clarification question and explicit export requirement",
    "resolution behaviour: shared source figures, reconciliation inputs and adjustment facts update linked EBITDA Analysis occurrences without changing unrelated interpretation",
    "proofread behaviour: EBITDA Analysis placeholders remain outside editorial findings while surrounding analytical prose remains reviewable for clarity and definition consistency",
    "workspace persistence: resolved EBITDA Analysis figures, adjustments and explanatory edits persist independently across sections",
    "issue navigation: unresolved EBITDA Analysis source, reconciliation, adjustment and limitation facts remain independently countable and selectable",
    "export behaviour: all source figures, adjustments and definitional facts remain required because generic substitutes could materially distort the earnings analysis",
    "accessibility and recovery: every EBITDA Analysis placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: EBITDA Analysis validation, arithmetic reconciliation, reported-versus-adjusted consistency and export tests must remain green",
  ],
  notes: [
    "Every proposed normalising adjustment must have stated evidence and rationale; TED must not classify an expense as non-recurring on its own.",
    "The EBITDA definition used must be explicit because different analyses may include or exclude different adjustments.",
    "Reported and adjusted figures must remain distinguishable so the analysis never presents an adjusted result as the original accounting result.",
  ],
} as const;

const EXECUTIVE_SUMMARY_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "purpose",
      requiredInformation: [
        {
          key: "topic",
          label: "Topic",
          factType: "other",
          placeholderLabel: "topic being summarised",
          question:
            "What report, proposal, issue or decision is this executive summary about?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.topic",
          neutralReplacementOptions: [],
        },
        {
          key: "audience",
          label: "Audience",
          factType: "other",
          placeholderLabel: "intended audience",
          question: "Who is the executive summary for?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.audience",
          neutralReplacementOptions: [],
        },
        {
          key: "reason_for_summary",
          label: "Reason for summary",
          factType: "other",
          placeholderLabel: "purpose of the summary",
          question:
            "What does the audience need to understand, decide or do after reading it?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.purpose",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "decision context",
        "strategic link",
        "scope boundary",
        "key performance indicators",
        "stakeholder priorities",
      ],
    },
    {
      sectionKey: "situation",
      requiredInformation: [
        {
          key: "present_state",
          label: "Present state",
          factType: "other",
          placeholderLabel: "current situation",
          question:
            "What is the current situation the audience needs to understand?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.current_state",
          neutralReplacementOptions: [],
        },
        {
          key: "key_issues",
          label: "Key issues",
          factType: "other",
          placeholderLabel: "key issues",
          question:
            "What are the most important issues, constraints or concerns right now?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.key_issues",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "supporting data",
        "trend direction",
        "root causes",
        "stakeholder impact",
        "benchmarks",
        "risk exposure",
        "financial variance",
      ],
    },
    {
      sectionKey: "recommendation",
      requiredInformation: [
        {
          key: "recommended_option",
          label: "Recommended option",
          factType: "other",
          placeholderLabel: "recommended option",
          question: "What option or course of action are you recommending?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.recommendation",
          neutralReplacementOptions: [],
        },
        {
          key: "rationale",
          label: "Recommendation rationale",
          factType: "other",
          placeholderLabel: "reason for the recommendation",
          question: "Why is this the recommended option?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.rationale",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "alternatives considered",
        "quantified benefit",
        "risk reduction",
        "implementation confidence",
        "cost-benefit analysis",
        "strategic alignment",
        "success measures",
      ],
    },
    {
      sectionKey: "decision",
      requiredInformation: [
        {
          key: "specific_approval",
          label: "Specific approval",
          factType: "other",
          placeholderLabel: "approval required",
          question:
            "What specific approval is being requested from the audience?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.approval",
          neutralReplacementOptions: [],
        },
        {
          key: "decision",
          label: "Decision required",
          factType: "other",
          placeholderLabel: "decision required",
          question: "What decision needs to be made?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.decision",
          neutralReplacementOptions: [],
        },
        {
          key: "action_requested",
          label: "Action requested",
          factType: "responsibility",
          placeholderLabel: "action requested",
          question:
            "What should happen once the decision or approval is given?",
          requiredForExport: true,
          sharedResolutionKey: "executive_summary.action",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "decision deadline",
        "budget implication",
        "owner",
        "next-step sequence",
        "escalation path",
        "implementation milestones",
      ],
    },
  ],
};

const EXECUTIVE_SUMMARY_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Executive Summary section captures its purpose, audience, present situation, key issues, recommendation, rationale and concrete decision required",
    "intake and context reuse: the underlying report, plan, proposal and previously established decision context are reused before clarification",
    "generation resilience: complete Executive Summary structure remains available when individual facts are represented by explicit placeholders",
    "factual safety: current-state claims, issues, recommendations, benefits and decision requirements are never invented beyond the source material",
    "placeholder integrity: every unresolved Executive Summary fact has a contextual label, exact question, export rule and stable information key",
    "resolution behaviour: shared recommendation and decision facts update linked Executive Summary occurrences without replacing unrelated source-derived wording",
    "proofread behaviour: unresolved placeholders are excluded from editorial findings while surrounding Executive Summary prose remains reviewable for brevity and clarity",
    "workspace persistence: approved Executive Summary edits and resolved values persist independently across all four sections",
    "issue navigation: unresolved Executive Summary purpose, situation, recommendation and decision facts remain independently selectable",
    "export behaviour: every core Executive Summary fact remains required because omitting or neutralising the actual decision context would make the document misleading",
    "accessibility and recovery: every Executive Summary placeholder exposes a meaningful label and exact conversational question and malformed tokens remain visible",
    "regression and release evidence: Executive Summary contract validation, source-grounding, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "The recommendation may be written persuasively but must remain grounded in a recommendation actually supplied or supported by source material.",
    "Current issues must not be softened away merely to create more positive executive wording.",
    "Decision and approval requirements are intentionally explicit so the summary ends with a concrete outcome rather than vague next steps.",
  ],
} as const;

const EXTENSION_REQUEST_LETTER_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "request",
        requiredInformation: [
          {
            key: "assignment",
            label: "Assignment",
            factType: "other",
            placeholderLabel: "assignment name",
            question:
              "Which assignment or assessment are you requesting an extension for?",
            requiredForExport: true,
            sharedResolutionKey: "extension.assignment",
            neutralReplacementOptions: [],
          },
          {
            key: "course",
            label: "Course",
            factType: "other",
            placeholderLabel: "course or unit",
            question: "Which course or unit is the assignment for?",
            requiredForExport: true,
            sharedResolutionKey: "extension.course",
            neutralReplacementOptions: [],
          },
          {
            key: "current_due_date",
            label: "Current due date",
            factType: "date",
            placeholderLabel: "current due date",
            question: "What is the assignment's current due date?",
            requiredForExport: true,
            sharedResolutionKey: "extension.original_due_date",
            neutralReplacementOptions: [],
          },
          {
            key: "extension_ask",
            label: "Extension request",
            factType: "event",
            placeholderLabel: "extension being requested",
            question:
              "What extension are you asking the institution or lecturer to approve?",
            requiredForExport: true,
            sharedResolutionKey: "extension.request",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "student ID",
          "lecturer name",
          "tutorial group",
          "previous communication",
          "student email",
          "prior extension history",
          "clear subject line",
        ],
      },
      {
        sectionKey: "reason",
        requiredInformation: [
          {
            key: "circumstance",
            label: "Circumstance affecting completion",
            factType: "event",
            placeholderLabel: "circumstance affecting completion",
            question:
              "What genuine circumstance has affected your ability to complete the work by the current deadline?",
            requiredForExport: true,
            sharedResolutionKey: "extension.circumstance",
            neutralReplacementOptions: [],
          },
          {
            key: "circumstance_timing_and_impact",
            label: "Timing and impact",
            factType: "other",
            placeholderLabel:
              "when the circumstance occurred and how it affected your work",
            question:
              "When did the circumstance occur, and how did it affect your ability to complete the assignment?",
            requiredForExport: true,
            sharedResolutionKey: "extension.circumstance_impact",
            neutralReplacementOptions: [],
          },
          {
            key: "supporting_evidence",
            label: "Supporting evidence",
            factType: "reference",
            placeholderLabel: "supporting evidence",
            question:
              "Do you have any evidence that genuinely supports the circumstances, such as a medical certificate or employer letter?",
            requiredForExport: false,
            sharedResolutionKey: "extension.supporting_evidence",
            neutralReplacementOptions: [
              {
                id: "no-evidence-mentioned",
                label: "Do not mention evidence",
                value:
                  "state the circumstances factually without claiming that supporting documentation is available",
                suitability:
                  "Use when the request can be made without evidence or no supporting document is currently available.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "dates affected",
          "work already completed",
          "preventative measures",
          "study-schedule impact",
          "mitigation efforts",
          "supporting-document details",
          "policy relevance",
        ],
      },
      {
        sectionKey: "proposed_date",
        requiredInformation: [
          {
            key: "new_requested_date",
            label: "New requested submission date",
            factType: "date",
            placeholderLabel: "requested new submission date",
            question: "What specific new submission date are you requesting?",
            requiredForExport: true,
            sharedResolutionKey: "extension.new_due_date",
            neutralReplacementOptions: [],
          },
          {
            key: "original_due_date",
            label: "Original due date",
            factType: "date",
            placeholderLabel: "original submission date",
            question:
              "What is the original due date the extension would replace?",
            requiredForExport: true,
            sharedResolutionKey: "extension.original_due_date",
            neutralReplacementOptions: [],
          },
          {
            key: "new_date_justification",
            label: "Reason the new date is realistic",
            factType: "other",
            placeholderLabel: "reason the requested date is realistic",
            question:
              "Why is the new date realistic based on the work you still have left to complete?",
            requiredForExport: true,
            sharedResolutionKey: "extension.new_date_justification",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "remaining-task list",
          "completion plan",
          "submission-preparation plan",
          "buffer for unexpected delays",
          "resource availability",
          "contingency plan",
          "standard extension window",
        ],
      },
      {
        sectionKey: "close",
        requiredInformation: [
          {
            key: "thanks",
            label: "Thanks",
            factType: "other",
            placeholderLabel: "brief thanks",
            question:
              "Would you like the request to close with a brief thank-you for considering the extension?",
            automaticFallback: "Thank you for considering my request.",
            requiredForExport: false,
            sharedResolutionKey: "extension.thanks",
            neutralReplacementOptions: [
              {
                id: "simple-thanks",
                label: "Simple thanks",
                value: "Thank you for considering my request.",
                suitability:
                  "Use when a concise professional acknowledgement is appropriate.",
                clearsExportWarning: true,
                regenerateSurroundingWording: false,
              },
            ],
          },
          {
            key: "attachment_mention",
            label: "Evidence or attachment mention",
            factType: "reference",
            placeholderLabel: "evidence attachment mention",
            question:
              "Should the close mention any supporting evidence or attachments you're actually providing?",
            requiredForExport: false,
            sharedResolutionKey: "extension.supporting_evidence",
            neutralReplacementOptions: [
              {
                id: "omit-attachment-reference",
                label: "Do not mention attachments",
                value:
                  "close the request without claiming any evidence or attachment has been provided",
                suitability:
                  "Use when no supporting document is being attached or referenced.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "apology for inconvenience",
          "willingness to discuss alternatives",
          "contact details",
          "offer to provide updates",
          "formal sign-off",
          "meeting availability",
        ],
      },
    ],
  };

const EXTENSION_REQUEST_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Extension Request Letter section captures the assignment, course, original due date, genuine circumstance, requested new date and supporting evidence state",
    "intake and context reuse: course details, assessment instructions, prior correspondence and supplied evidence are reused before the Extension Request Letter asks for clarification",
    "generation resilience: complete Extension Request Letter wording remains available when evidence is unavailable through declared omission wording rather than fabricated documentation",
    "factual safety: medical circumstances, employer impacts, dates, evidence and progress already made are never invented",
    "placeholder integrity: every unresolved Extension Request Letter fact has a contextual label, exact question and deliberate export or replacement policy",
    "resolution behaviour: shared original date, circumstance and evidence facts update linked Extension Request Letter occurrences without altering unrelated user wording",
    "proofread behaviour: Extension Request Letter placeholder labels remain outside editorial findings while surrounding factual prose remains reviewable for brevity and professionalism",
    "workspace persistence: resolved Extension Request Letter facts and edited explanations persist independently across sections",
    "issue navigation: unresolved Extension Request Letter assignment, circumstance, evidence and requested-date facts remain independently selectable",
    "export behaviour: assignment, original due date, circumstance and proposed date remain required while evidence and closing language can safely be omitted or neutralised",
    "accessibility and recovery: every Extension Request Letter placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Extension Request Letter validation, date consistency, evidence handling, shared-resolution and export tests must remain green",
  ],
  notes: [
    "TED must never imply that medical, employment or other supporting evidence exists unless the user actually has it.",
    "The requested new date remains load-bearing because asking merely for 'more time' does not create a usable extension request.",
    "The explanation should remain factual and proportionate rather than adding unsupported detail to make the circumstances appear more serious.",
  ],
} as const;

const FINANCIAL_REVIEW_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "summary",
      requiredInformation: [
        {
          key: "financial_performance",
          label: "Financial performance",
          factType: "amount",
          placeholderLabel: "financial performance for the period",
          question:
            "What confirmed financial result best summarises performance for this review period?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.period_performance",
          neutralReplacementOptions: [],
        },
        {
          key: "comparison_to_expectations",
          label: "Comparison to expectations",
          factType: "other",
          placeholderLabel: "performance against budget or expectations",
          question:
            "How did the result compare with the budget, forecast, target or previous period?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.performance_comparison",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "main result driver",
        "KPI highlights",
        "industry benchmark",
        "forward outlook",
        "risk factors",
        "strategic implications",
        "next-period recommendation",
      ],
    },
    {
      sectionKey: "revenue",
      requiredInformation: [
        {
          key: "total_revenue",
          label: "Total revenue",
          factType: "amount",
          placeholderLabel: "total revenue",
          question:
            "What was the confirmed total revenue for the review period?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.total_revenue",
          neutralReplacementOptions: [],
        },
        {
          key: "main_revenue_contributors",
          label: "Main revenue contributors",
          factType: "amount",
          placeholderLabel: "main revenue contributors",
          question:
            "Which revenue streams or contributors made up the result according to the source financial data?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.revenue_contributors",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "budget comparison",
        "prior-period comparison",
        "revenue growth rate",
        "customer concentration",
        "emerging revenue streams",
        "pricing impact",
        "one-off revenue",
        "seasonality",
      ],
    },
    {
      sectionKey: "expenses",
      requiredInformation: [
        {
          key: "total_expenses",
          label: "Total expenses",
          factType: "amount",
          placeholderLabel: "total expenses",
          question: "What were the confirmed total expenses for the period?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.total_expenses",
          neutralReplacementOptions: [],
        },
        {
          key: "major_cost_areas",
          label: "Major cost areas",
          factType: "amount",
          placeholderLabel: "major cost areas",
          question:
            "Which expense categories were the main cost drivers in the source data?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.major_costs",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "COGS versus operating expenses",
        "variance by cost category",
        "gross margin",
        "net margin",
        "cost-saving initiatives",
        "expense trends",
        "non-recurring expenses",
        "supplier price changes",
      ],
    },
    {
      sectionKey: "cashflow",
      requiredInformation: [
        {
          key: "cash_position",
          label: "Cash position",
          factType: "amount",
          placeholderLabel: "current cash position",
          question:
            "What does the available financial information show about the current cash position?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.cash_position",
          neutralReplacementOptions: [],
        },
        {
          key: "next_period_pressures",
          label: "Upcoming financial pressures",
          factType: "other",
          placeholderLabel: "upcoming cash pressures",
          question:
            "What confirmed cash-flow pressures or obligations are coming up in the next period?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.cash_pressures",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "opportunities",
        "cash runway",
        "next-quarter forecast",
        "inflow sources",
        "working capital changes",
        "debt service",
        "liquidity ratios",
        "funding gap or surplus",
      ],
    },
    {
      sectionKey: "actions",
      requiredInformation: [
        {
          key: "recommended_actions",
          label: "Recommended actions",
          factType: "responsibility",
          placeholderLabel: "specific recommended financial actions",
          question:
            "What specific actions should be taken before the next review based on the figures or trends identified?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.actions",
          neutralReplacementOptions: [],
        },
        {
          key: "action_owner_and_timeframe",
          label: "Action owner and timeframe",
          factType: "responsibility",
          placeholderLabel: "owner and timeframe for each action",
          question: "Who owns each action, and by when should it be completed?",
          requiredForExport: true,
          sharedResolutionKey: "financial_review.action_owners_timeframes",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "priority order",
        "completion dates",
        "success criteria",
        "resource requirements",
        "dependencies",
        "action risks",
        "monitoring cadence",
        "escalation path",
        "linked KPI",
      ],
    },
  ],
};

const FINANCIAL_REVIEW_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Financial Review section captures actual period performance, revenue, expenses, cash position and owner-specific actions tied to the source figures",
    "intake and context reuse: P&L statements, expenditure reports, payroll data, sales reports, forecasts, BAS records and prior reviews are reused before clarification",
    "generation resilience: complete Financial Review wording remains available while missing figures are represented explicitly rather than estimated or silently omitted",
    "factual safety: all financial figures, margins, trends, cash positions and financial drivers are grounded in supplied data and never invented",
    "placeholder integrity: every unresolved Financial Review figure or analytical fact receives a contextual label, exact question and export requirement",
    "resolution behaviour: shared revenue, expense, cash and action facts update linked Financial Review occurrences without altering unrelated calculations or commentary",
    "proofread behaviour: Financial Review placeholder labels are excluded from editorial findings while surrounding analytical prose remains reviewable",
    "workspace persistence: resolved figures, analysis and Financial Review action edits persist independently across sections",
    "issue navigation: unresolved Financial Review amounts, comparisons and actions remain individually countable and selectable",
    "export behaviour: all core financial figures and actions remain required because neutral replacements could materially misstate financial performance",
    "accessibility and recovery: every Financial Review placeholder clearly states the missing financial fact and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Financial Review validation, source reconciliation, calculation consistency, placeholder resolution and export tests must remain green",
  ],
  notes: [
    "Revenue, expenses and cash figures must be copied or derived only from reliable supplied financial records.",
    "Margins and other calculated metrics may be derived from confirmed source figures but the underlying assumptions must remain visible.",
    "Recommended actions must connect to actual figures or trends rather than generic financial-management advice.",
  ],
} as const;

const FORECASTED_EARNINGS_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "basis",
      requiredInformation: [
        {
          key: "forecast_horizon_and_granularity",
          label: "Forecast horizon and granularity",
          factType: "date_range",
          placeholderLabel: "forecast horizon and granularity",
          question:
            "What period should the forecast cover, and should it be shown monthly, quarterly or on another cadence?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.horizon",
          neutralReplacementOptions: [],
        },
        {
          key: "currency_and_baseline",
          label: "Currency and baseline period",
          factType: "other",
          placeholderLabel: "currency and historical baseline",
          question:
            "What currency should be used, and which confirmed historical period should the forecast use as its baseline?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.baseline",
          neutralReplacementOptions: [],
        },
        {
          key: "revenue_and_cost_assumptions",
          label: "Revenue and cost assumptions",
          factType: "other",
          placeholderLabel: "forecast revenue and cost assumptions",
          question:
            "What confirmed assumptions should drive future revenue and costs?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.assumptions",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "seasonality",
        "pricing changes",
        "headcount changes",
        "scenario preference",
      ],
    },
    {
      sectionKey: "forecast",
      requiredInformation: [
        {
          key: "revenue_streams",
          label: "Revenue streams",
          factType: "amount",
          placeholderLabel: "forecast revenue streams",
          question:
            "Which revenue streams should be projected, and what confirmed baseline or assumption applies to each one?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.revenue_streams",
          neutralReplacementOptions: [],
        },
        {
          key: "cost_categories",
          label: "Cost categories",
          factType: "amount",
          placeholderLabel: "forecast cost categories",
          question:
            "Which cost categories should be projected, and what confirmed baseline or assumption applies to each?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.cost_categories",
          neutralReplacementOptions: [],
        },
        {
          key: "calculation_basis",
          label: "Calculation basis",
          factType: "other",
          placeholderLabel: "forecast calculation basis",
          question:
            "What calculation method should be used to turn the baseline and assumptions into period-by-period projections?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.calculation_basis",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "actual-versus-forecast comparison",
        "monthly trend visual",
      ],
    },
    {
      sectionKey: "earnings",
      requiredInformation: [
        {
          key: "earnings_calculations",
          label: "Earnings calculations",
          factType: "amount",
          placeholderLabel: "forecast earnings calculations",
          question:
            "Which earnings measures should be calculated from the forecast, such as gross profit, EBITDA or net earnings?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.earnings_measures",
          neutralReplacementOptions: [],
        },
        {
          key: "base_scenario",
          label: "Base scenario",
          factType: "other",
          placeholderLabel: "base forecast scenario",
          question: "What assumptions define the base-case scenario?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.base_scenario",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "upside scenario",
        "downside scenario",
        "sensitivity table",
      ],
    },
    {
      sectionKey: "risks",
      requiredInformation: [
        {
          key: "material_assumptions_and_limitations",
          label: "Material assumptions and limitations",
          factType: "other",
          placeholderLabel: "material forecast assumptions and limitations",
          question:
            "What material assumptions, unknowns or source limitations could meaningfully affect this forecast?",
          requiredForExport: true,
          sharedResolutionKey: "earnings_forecast.limitations",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "mitigation actions",
      ],
    },
  ],
};

const FORECASTED_EARNINGS_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Forecasted Earnings section captures the horizon, baseline, currency, revenue and cost assumptions, calculation basis, earnings measures, scenario definition and limitations",
    "intake and context reuse: historical financial statements, accounting exports and previously confirmed business assumptions are reused before clarification",
    "generation resilience: complete Forecasted Earnings structure remains available while missing assumptions remain explicit placeholders rather than silently generated estimates",
    "factual safety: every projected figure traces to a confirmed historical baseline or a clearly stated user-supplied assumption and is never invented",
    "placeholder integrity: every unresolved Forecasted Earnings assumption or calculation input has a contextual label, exact question and explicit export requirement",
    "resolution behaviour: shared baseline, assumption, revenue, cost and scenario facts update linked Forecasted Earnings occurrences without overwriting unrelated calculations",
    "proofread behaviour: Forecasted Earnings placeholders remain outside editorial findings while surrounding analytical prose remains reviewable for clarity and assumption transparency",
    "workspace persistence: resolved Forecasted Earnings assumptions, figures and scenario edits persist independently across sections",
    "issue navigation: unresolved Forecasted Earnings baseline, assumptions, streams, earnings measures and limitations remain independently countable",
    "export behaviour: all core forecast assumptions and calculation inputs remain required because neutral replacements could create unsupported financial projections",
    "accessibility and recovery: every Forecasted Earnings placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Forecasted Earnings validation, arithmetic reconciliation, scenario consistency, source tracing and export tests must remain green",
  ],
  notes: [
    "Confirmed historical data and forecast assumptions must remain visibly distinct throughout the document.",
    "Upside and downside cases are optional, but the base scenario itself must always be explicitly defined.",
    "TED may calculate projections from supplied inputs but must never create a revenue-growth, cost-growth or pricing assumption solely to complete the forecast.",
  ],
} as const;

const GRANT_FUNDING_PROPOSAL_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "summary",
        requiredInformation: [
          {
            key: "funding_amount_requested",
            label: "Funding amount requested",
            factType: "amount",
            placeholderLabel: "funding amount requested",
            question: "How much funding are you requesting?",
            requiredForExport: true,
            sharedResolutionKey: "funding.amount_requested",
            neutralReplacementOptions: [],
          },
          {
            key: "project_being_funded",
            label: "Project being funded",
            factType: "other",
            placeholderLabel: "project being funded",
            question:
              "What specific project or initiative will the funding support?",
            requiredForExport: true,
            sharedResolutionKey: "funding.project",
            neutralReplacementOptions: [],
          },
          {
            key: "beneficiary_or_community",
            label: "Beneficiary or community",
            factType: "other",
            placeholderLabel: "beneficiary or community served",
            question: "Who specifically will benefit from the funded project?",
            requiredForExport: true,
            sharedResolutionKey: "funding.beneficiary",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "funder priorities",
          "project hook",
          "grant-objective alignment",
          "problem statistic",
          "beneficiary quote",
          "prior successful projects",
          "policy alignment",
          "project tagline",
        ],
      },
      {
        sectionKey: "need",
        requiredInformation: [
          {
            key: "real_need",
            label: "Need being addressed",
            factType: "other",
            placeholderLabel: "real need being addressed",
            question:
              "What genuine need or problem is the project responding to?",
            requiredForExport: true,
            sharedResolutionKey: "funding.need",
            neutralReplacementOptions: [],
          },
          {
            key: "affected_group",
            label: "Who is affected",
            factType: "other",
            placeholderLabel: "people affected by the need",
            question: "Who is affected by this need or problem?",
            requiredForExport: true,
            sharedResolutionKey: "funding.affected_group",
            neutralReplacementOptions: [],
          },
          {
            key: "impact_on_affected_group",
            label: "Impact on affected group",
            factType: "other",
            placeholderLabel: "impact of the need",
            question:
              "How is this need actually affecting those people or communities?",
            requiredForExport: true,
            sharedResolutionKey: "funding.need_impact",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "supporting data",
          "illustrative story",
          "status quo if unfunded",
          "geographic distribution",
          "cost of inaction",
          "research evidence",
          "stakeholder endorsements",
          "socio-economic impact",
        ],
      },
      {
        sectionKey: "activities",
        requiredInformation: [
          {
            key: "funded_activities",
            label: "Funded activities",
            factType: "responsibility",
            placeholderLabel: "activities the funding will support",
            question:
              "What specific activities will the funding pay for or enable?",
            requiredForExport: true,
            sharedResolutionKey: "funding.activities",
            neutralReplacementOptions: [],
          },
          {
            key: "delivery_timeframe",
            label: "Delivery timeframe",
            factType: "date_range",
            placeholderLabel: "project delivery timeframe",
            question: "Over what timeframe will those activities be delivered?",
            requiredForExport: true,
            sharedResolutionKey: "funding.delivery_timeframe",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "milestones",
          "activity owners",
          "partners",
          "work breakdown",
          "risk mitigations",
          "resource allocation",
          "completion criteria",
          "community consultation",
          "monitoring process",
          "required approvals",
        ],
      },
      {
        sectionKey: "outcomes",
        requiredInformation: [
          {
            key: "measurable_outcomes",
            label: "Measurable outcomes",
            factType: "achievement",
            placeholderLabel: "measurable project outcomes",
            question:
              "What concrete outcomes is the project expected to achieve?",
            requiredForExport: true,
            sharedResolutionKey: "funding.outcomes",
            neutralReplacementOptions: [],
          },
          {
            key: "measurement_method",
            label: "Outcome measurement",
            factType: "other",
            placeholderLabel: "how outcomes will be measured",
            question: "How will each outcome be measured or verified?",
            requiredForExport: true,
            sharedResolutionKey: "funding.outcome_measurement",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "baseline figures",
          "funder success criteria",
          "long-term impact",
          "SMART measures",
          "attribution method",
          "data-collection frequency",
          "independent evaluation",
          "benchmarks",
          "stakeholder satisfaction",
        ],
      },
      {
        sectionKey: "budget",
        requiredInformation: [
          {
            key: "total_budget_requested",
            label: "Total budget requested",
            factType: "amount",
            placeholderLabel: "total project budget requested",
            question: "What total amount should the project budget show?",
            requiredForExport: true,
            sharedResolutionKey: "funding.amount_requested",
            neutralReplacementOptions: [],
          },
          {
            key: "itemised_use_of_funds",
            label: "Itemised use of funds",
            factType: "amount",
            placeholderLabel: "itemised use of funding",
            question:
              "How will the requested funding be allocated across the project?",
            requiredForExport: true,
            sharedResolutionKey: "funding.use_of_funds",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "sustainability plan",
          "co-funding",
          "in-kind contributions",
          "contingency",
          "value-for-money analysis",
          "line-item justification",
          "inflation assumptions",
          "cash-flow forecast",
          "personnel versus overhead split",
          "audit requirements",
        ],
      },
    ],
  };

const GRANT_FUNDING_PROPOSAL_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Grant / Funding Proposal section captures the funding ask, project, beneficiary, evidenced need, funded activities, measurable outcomes and itemised budget",
    "intake and context reuse: financial statements, forecasts, business plans, grant criteria, beneficiary evidence and prior project material are reused before clarification",
    "generation resilience: complete Grant / Funding Proposal wording remains available around unresolved facts through declared placeholders rather than invented impact or financial claims",
    "factual safety: funding amounts, beneficiary needs, demand evidence, project activities, outcome projections and budget figures are never fabricated",
    "placeholder integrity: every unresolved Grant / Funding Proposal fact has a contextual label, exact plain-language question, section-specific information key and export policy",
    "resolution behaviour: shared funding amount, project, need, activity, outcome and use-of-funds facts update linked Grant / Funding Proposal occurrences without altering unrelated evidence",
    "proofread behaviour: Grant / Funding Proposal placeholder labels remain outside editorial findings while surrounding persuasive prose remains reviewable for unsupported claims and clarity",
    "workspace persistence: grant-specific edits, resolved facts and unresolved Grant / Funding Proposal placeholders persist independently across sections",
    "issue navigation: unresolved Grant / Funding Proposal facts remain individually selectable across summary, need, activities, outcomes and budget",
    "export behaviour: the funding ask, need, activities, measurable outcomes and itemised budget remain required because generic replacements would create a misleading funding application",
    "accessibility and recovery: every Grant / Funding Proposal placeholder exposes a meaningful user-facing label and exact clarification question while malformed tokens remain visible",
    "regression and release evidence: Grant / Funding Proposal validation, evidence grounding, budget consistency, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "Funder alignment may shape framing but TED must never claim alignment with a grant criterion that has not been supplied or verified.",
    "Projected outcomes must be framed as expected outcomes rather than achievements already realised.",
    "The funding amount and itemised use of funds remain separate even when they share a total because the allocation must reconcile to the requested amount.",
  ],
} as const;

const INVESTMENT_CAPITAL_GAINS_REPORT_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "coverage",
        requiredInformation: [
          {
            key: "owner_or_entity",
            label: "Owner or entity",
            factType: "person_name",
            placeholderLabel: "investment owner or entity",
            question: "Whose investments does this report cover?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.owner_entity",
            neutralReplacementOptions: [],
          },
          {
            key: "jurisdiction_and_tax_year",
            label: "Jurisdiction and tax year",
            factType: "other",
            placeholderLabel: "tax jurisdiction and tax year",
            question:
              "Which tax jurisdiction and tax year does the report relate to?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.jurisdiction_tax_year",
            neutralReplacementOptions: [],
          },
          {
            key: "source_files_and_missing_records",
            label: "Source files and missing records",
            factType: "reference",
            placeholderLabel: "source records and any missing evidence",
            question:
              "Which brokerage, platform or transaction records are available, and what records are still missing?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.source_coverage",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "parcel method",
          "currency treatment",
        ],
      },
      {
        sectionKey: "transactions",
        requiredInformation: [
          {
            key: "asset_and_parcel_identifiers",
            label: "Asset and parcel identifiers",
            factType: "identifier",
            placeholderLabel: "asset and parcel identifiers",
            question:
              "What asset or parcel identifier should be used for each holding or disposal?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.asset_parcels",
            neutralReplacementOptions: [],
          },
          {
            key: "acquisition_and_disposal_dates",
            label: "Acquisition and disposal dates",
            factType: "date",
            placeholderLabel: "acquisition and disposal dates",
            question:
              "What are the confirmed acquisition and disposal dates for each asset or parcel?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.transaction_dates",
            neutralReplacementOptions: [],
          },
          {
            key: "proceeds_and_transaction_costs",
            label: "Proceeds and transaction costs",
            factType: "amount",
            placeholderLabel: "sale proceeds and transaction costs",
            question:
              "What were the confirmed disposal proceeds and transaction costs for each asset or parcel?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.proceeds_costs",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "holding-period analysis",
        ],
      },
      {
        sectionKey: "calculations",
        requiredInformation: [
          {
            key: "documented_cost_base",
            label: "Documented cost base",
            factType: "amount",
            placeholderLabel: "documented cost base",
            question:
              "What documented cost base applies to each asset or parcel?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.cost_base",
            neutralReplacementOptions: [],
          },
          {
            key: "formula_and_result",
            label: "Formula and result",
            factType: "amount",
            placeholderLabel: "gain or loss calculation",
            question:
              "What calculation should be applied to each disposal, and what gain or loss results from the confirmed figures?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.calculation_results",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "asset visuals",
          "monthly visuals",
        ],
      },
      {
        sectionKey: "summary",
        requiredInformation: [
          {
            key: "assumptions_and_limitations",
            label: "Assumptions and limitations",
            factType: "other",
            placeholderLabel: "assumptions and limitations",
            question:
              "What assumptions, missing records or limitations could affect the reliability of this capital gains report?",
            requiredForExport: true,
            sharedResolutionKey: "capital_gains.limitations",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "questions for tax adviser",
        ],
      },
    ],
  };

const INVESTMENT_CAPITAL_GAINS_REPORT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Investment Capital Gains Report section captures owner, jurisdiction, tax year, source records, asset identifiers, acquisition and disposal dates, proceeds, costs, cost base, calculations and limitations",
    "intake and context reuse: brokerage statements, platform exports, purchase confirmations and sale confirmations are reused before clarification",
    "generation resilience: complete Investment Capital Gains Report structure remains available while missing transaction records remain explicit placeholders and limitations rather than estimated financial facts",
    "factual safety: acquisition dates, disposal dates, proceeds, transaction costs, cost bases and gain or loss figures are never invented",
    "placeholder integrity: every unresolved Investment Capital Gains Report fact has a contextual label, exact question and explicit export requirement",
    "resolution behaviour: shared asset, date, proceeds, cost-base and calculation facts update linked Investment Capital Gains Report occurrences without modifying unrelated holdings",
    "proofread behaviour: Investment Capital Gains Report placeholders remain outside editorial findings while surrounding calculation notes remain reviewable for clarity and traceability",
    "workspace persistence: resolved Investment Capital Gains Report records, calculations and limitations persist independently across sections",
    "issue navigation: unresolved Investment Capital Gains Report owner, source, transaction, cost-base and calculation facts remain independently selectable",
    "export behaviour: all transaction and calculation facts remain required because neutral replacements could create materially incorrect tax reporting",
    "accessibility and recovery: every Investment Capital Gains Report placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Investment Capital Gains Report validation, cost-base traceability, arithmetic reconciliation and professional-review warning tests must remain green",
  ],
  notes: [
    "Every gain or loss must trace back to a documented cost base and confirmed disposal proceeds.",
    "Missing records must remain disclosed rather than being silently estimated or excluded from the report.",
    "The final report must retain a clear professional tax-review warning before it is relied on for lodgement or tax decisions.",
  ],
} as const;

const INVOICE_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "identity",
      requiredInformation: [
        {
          key: "supplier",
          label: "Supplier",
          factType: "company_name",
          placeholderLabel: "invoice supplier",
          question: "Who is issuing the invoice?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.supplier",
          neutralReplacementOptions: [],
        },
        {
          key: "customer",
          label: "Customer",
          factType: "company_name",
          placeholderLabel: "invoice customer",
          question: "Who is being invoiced?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.customer",
          neutralReplacementOptions: [],
        },
        {
          key: "invoice_number",
          label: "Invoice number",
          factType: "identifier",
          placeholderLabel: "invoice number",
          question: "What invoice number should appear on the document?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.number",
          neutralReplacementOptions: [],
        },
        {
          key: "issue_date",
          label: "Issue date",
          factType: "date",
          placeholderLabel: "invoice issue date",
          question: "What date is the invoice being issued?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.issue_date",
          neutralReplacementOptions: [],
        },
        {
          key: "due_date",
          label: "Due date",
          factType: "date",
          placeholderLabel: "invoice due date",
          question: "When is payment due?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.due_date",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "purchase order reference",
      ],
    },
    {
      sectionKey: "items",
      requiredInformation: [
        {
          key: "item_description",
          label: "Item description",
          factType: "responsibility",
          placeholderLabel: "invoiced item or service description",
          question: "What goods or services are being invoiced?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.items",
          neutralReplacementOptions: [],
        },
        {
          key: "quantity_and_unit_price",
          label: "Quantity and unit price",
          factType: "amount",
          placeholderLabel: "quantity and unit price",
          question:
            "What quantity and unit price applies to each invoiced item?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.item_pricing",
          neutralReplacementOptions: [],
        },
        {
          key: "currency_and_tax_treatment",
          label: "Currency and tax treatment",
          factType: "other",
          placeholderLabel: "invoice currency and tax treatment",
          question:
            "What currency is the invoice in, and how should tax be applied?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.currency_tax",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "service period",
      ],
    },
    {
      sectionKey: "payment",
      requiredInformation: [
        {
          key: "subtotal_tax_total",
          label: "Subtotal, tax and total",
          factType: "amount",
          placeholderLabel: "reconciled invoice totals",
          question:
            "What subtotal, tax amount and final total result from the confirmed line items?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.totals",
          neutralReplacementOptions: [],
        },
        {
          key: "payment_method",
          label: "Payment method",
          factType: "other",
          placeholderLabel: "payment method",
          question: "How should the customer pay this invoice?",
          requiredForExport: true,
          sharedResolutionKey: "invoice.payment_method",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "payment reference",
      ],
    },
  ],
};

const INVOICE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Invoice section captures supplier, customer, invoice number, issue and due dates, itemised goods or services, pricing, currency, tax, totals and payment method",
    "intake and context reuse: quotes, purchase orders, contracts, confirmed party records and prior billing information are reused before clarification",
    "generation resilience: complete Invoice structure remains available while unresolved billing facts remain explicit placeholders rather than invented values",
    "factual safety: invoice numbers, dates, quantities, prices, tax amounts, totals and payment details are never fabricated",
    "placeholder integrity: every unresolved Invoice fact has a contextual label, exact question and explicit export requirement",
    "resolution behaviour: shared supplier, customer, item, pricing and payment facts update linked Invoice occurrences without modifying unrelated line items",
    "proofread behaviour: Invoice placeholders remain outside editorial findings while surrounding labels and payment wording remain reviewable for clarity",
    "workspace persistence: resolved Invoice details and line-item edits persist independently across sections",
    "issue navigation: unresolved Invoice party, identifier, date, line-item, tax and payment facts remain independently selectable",
    "export behaviour: all core billing and payment facts remain required because neutral replacements could create an invalid or misleading invoice",
    "accessibility and recovery: every Invoice placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Invoice validation, line-item arithmetic, tax reconciliation and identifier/date consistency tests must remain green",
  ],
  notes: [
    "Subtotal, tax and final total must reconcile deterministically from the confirmed line items.",
    "Invoice number, issue date and due date must remain distinct and internally consistent.",
    "Tax treatment must reflect the supplied jurisdiction or business configuration rather than a guessed default.",
  ],
} as const;

const LINKEDIN_PROFILE_REWRITE_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "headline",
        requiredInformation: [
          {
            key: "current_or_target_role",
            label: "Current or target role",
            factType: "role_title",
            placeholderLabel: "current or target role",
            question:
              "What role do you currently hold, or what role do you want your LinkedIn profile to position you for?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.target_role",
            neutralReplacementOptions: [],
          },
          {
            key: "main_specialty",
            label: "Main specialty",
            factType: "skill",
            placeholderLabel: "main professional specialty",
            question:
              "What professional specialty or area of expertise should be most prominent in your headline?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.main_specialty",
            neutralReplacementOptions: [],
          },
          {
            key: "professional_value_area",
            label: "Professional value area",
            factType: "other",
            placeholderLabel: "professional value you offer",
            question:
              "What kind of value or outcome do you want people to associate with your work?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.professional_value",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "search keywords",
          "target audience",
          "measurable outcome",
          "industry niche",
          "seniority level",
          "geographic focus",
          "recruiter-friendly terminology",
        ],
      },
      {
        sectionKey: "about",
        requiredInformation: [
          {
            key: "professional_identity",
            label: "Professional identity",
            factType: "role_title",
            placeholderLabel: "professional identity",
            question:
              "How would you describe your professional identity in your own words?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.professional_identity",
            neutralReplacementOptions: [],
          },
          {
            key: "experience_area",
            label: "Experience area",
            factType: "other",
            placeholderLabel: "main experience area",
            question:
              "What field, industry or type of work best describes your experience?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.experience_area",
            neutralReplacementOptions: [],
          },
          {
            key: "core_work_focus",
            label: "Core work focus",
            factType: "responsibility",
            placeholderLabel: "core work focus",
            question:
              "What kind of work do you spend most of your time doing or want to be known for?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.core_work_focus",
            neutralReplacementOptions: [],
          },
          {
            key: "key_strengths",
            label: "Key strengths",
            factType: "skill",
            placeholderLabel: "key professional strengths",
            question:
              "Which confirmed strengths should your LinkedIn summary emphasise?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.key_strengths",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "career story",
          "professional values",
          "notable proof points",
          "specific achievement anecdotes",
          "certifications",
          "quantified results",
          "professional passions",
          "call to connect",
        ],
      },
      {
        sectionKey: "featured",
        requiredInformation: [
          {
            key: "recent_achievements",
            label: "Recent achievements",
            factType: "achievement",
            placeholderLabel: "recent achievements",
            question:
              "What recent achievements should be featured as evidence of your capability?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.recent_achievements",
            neutralReplacementOptions: [],
          },
          {
            key: "projects",
            label: "Projects",
            factType: "achievement",
            placeholderLabel: "relevant projects",
            question:
              "What projects best demonstrate the kind of work you want to be known for?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.featured_projects",
            neutralReplacementOptions: [
              {
                id: "omit-project-focus",
                label: "Focus on achievements",
                value:
                  "focus this section on confirmed achievements and credentials without referring to specific projects",
                suitability:
                  "Use when the user has strong evidence of capability but no particular project needs to be highlighted.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
          {
            key: "credibility_credentials",
            label: "Credibility credentials",
            factType: "credential",
            placeholderLabel: "relevant credentials",
            question:
              "What credentials, qualifications or other credibility signals should be included?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.credentials",
            neutralReplacementOptions: [
              {
                id: "omit-credentials",
                label: "No credentials highlighted",
                value:
                  "present the confirmed experience and achievements without adding a credential claim",
                suitability:
                  "Use when credentials are not central to the user's positioning or none need to be featured.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "portfolio links",
          "media",
          "metrics",
          "named tools",
          "high-signal outcomes",
          "testimonials",
          "awards",
          "before-and-after results",
        ],
      },
      {
        sectionKey: "direction",
        requiredInformation: [
          {
            key: "career_direction",
            label: "Career direction",
            factType: "other",
            placeholderLabel: "career direction or opportunity sought",
            question:
              "What kind of role, work or career direction are you currently open to?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.career_direction",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "location preference",
          "work mode",
          "sectors of interest",
          "desired seniority",
          "contract preference",
          "company size preference",
          "remote-work preference",
          "professional-development goals",
        ],
      },
    ],
  };

const LINKEDIN_PROFILE_REWRITE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every LinkedIn Profile Rewrite section captures the candidate's positioning, specialty, value, experience, strengths, credibility evidence and intended career direction",
    "intake and context reuse: resume content, an existing LinkedIn profile, conversation history and confirmed career information are reused before the LinkedIn Profile Rewrite asks for clarification",
    "generation resilience: complete LinkedIn Profile Rewrite wording remains available around unresolved facts through declared placeholders and safe omission strategies for non-essential projects or credentials",
    "factual safety: roles, achievements, projects, credentials, metrics and career claims in the LinkedIn Profile Rewrite are never invented or exaggerated for stronger positioning",
    "placeholder integrity: each unresolved LinkedIn Profile Rewrite fact is represented by its own contextual label, conversational question, resolution metadata and section-specific information key",
    "resolution behaviour: shared identity, career and achievement facts update linked LinkedIn Profile Rewrite occurrences without replacing unrelated user-approved wording",
    "proofread behaviour: unresolved LinkedIn Profile Rewrite labels are excluded from editorial findings while surrounding profile prose remains reviewable for clarity, authenticity and keyword quality",
    "workspace persistence: user edits, resolved facts and unresolved LinkedIn Profile Rewrite metadata persist independently across headline, summary, experience and direction sections",
    "issue navigation: missing LinkedIn Profile Rewrite facts remain independently selectable so the user can resolve a career direction without reopening unrelated achievements or strengths",
    "export behaviour: core positioning and career-direction facts require acknowledgement when unresolved while optional project and credential gaps can be safely written around",
    "accessibility and recovery: each LinkedIn Profile Rewrite placeholder exposes a meaningful description and exact plain-language question and malformed tokens remain visible",
    "regression and release evidence: LinkedIn Profile Rewrite contract validation, factual-grounding checks, shared-resolution behaviour, placeholder handling and repository CI must pass before release",
  ],
  notes: [
    "Recruiter-friendly wording may improve presentation but must never introduce an unsupported job title, metric, credential or achievement.",
    "Projects and credentials may be omitted when they are not needed; TED should regenerate the surrounding prose rather than leave an awkward gap.",
    "Career direction is intentionally load-bearing because the rewrite cannot be properly positioned without knowing what the profile is meant to support.",
  ],
} as const;

const LITERATURE_REVIEW_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "scope",
      requiredInformation: [
        {
          key: "topic",
          label: "Review topic",
          factType: "other",
          placeholderLabel: "literature review topic",
          question: "What topic is this literature review examining?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.topic",
          neutralReplacementOptions: [],
        },
        {
          key: "boundaries",
          label: "Review boundaries",
          factType: "other",
          placeholderLabel: "review boundaries",
          question:
            "What boundaries define the review — such as timeframe, population, geography, discipline or publication type?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.boundaries",
          neutralReplacementOptions: [],
        },
        {
          key: "themes_reviewed",
          label: "Themes reviewed",
          factType: "other",
          placeholderLabel: "themes included in the review",
          question:
            "Which themes or areas of the topic are included in the review?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.scope_themes",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "inclusion criteria",
        "exclusion criteria",
        "date range",
        "databases",
        "search terms",
        "search-strategy reporting",
        "language limits",
        "publication-type limits",
      ],
    },
    {
      sectionKey: "themes",
      requiredInformation: [
        {
          key: "main_themes",
          label: "Main themes",
          factType: "reference",
          placeholderLabel: "main themes in the literature",
          question:
            "What main themes or schools of thought actually appear in the sources?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.main_themes",
          neutralReplacementOptions: [],
        },
        {
          key: "representative_sources",
          label: "Representative sources",
          factType: "reference",
          placeholderLabel: "authors or studies supporting each theme",
          question: "Which real authors or studies represent each theme?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.representative_sources",
          neutralReplacementOptions: [],
        },
        {
          key: "theme_relevance",
          label: "Theme relevance",
          factType: "other",
          placeholderLabel: "how the themes relate to the review question",
          question:
            "How does each theme relate to the review's research question or purpose?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.theme_relevance",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "synthesis across sources",
        "chronological development",
        "methodological differences",
        "interdisciplinary perspectives",
        "seminal works",
        "regional differences",
        "theoretical frameworks",
      ],
    },
    {
      sectionKey: "tension",
      requiredInformation: [
        {
          key: "disagreement_or_uncertainty",
          label: "Disagreement or uncertainty",
          factType: "reference",
          placeholderLabel: "area of disagreement in the literature",
          question:
            "Where do the sources genuinely disagree or remain uncertain?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.debate",
          neutralReplacementOptions: [],
        },
        {
          key: "competing_positions",
          label: "Competing positions",
          factType: "reference",
          placeholderLabel: "competing positions and sources",
          question:
            "What are the competing positions, and which authors or studies support each one?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.competing_positions",
          neutralReplacementOptions: [],
        },
        {
          key: "debate_significance",
          label: "Why the debate matters",
          factType: "other",
          placeholderLabel: "importance of the disagreement",
          question:
            "Why does this disagreement matter for the field or the review question?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.debate_significance",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "methodological contrasts",
        "evidence quality",
        "unresolved questions",
        "citation impact",
        "methodological bias",
        "underlying assumptions",
        "future research directions",
      ],
    },
    {
      sectionKey: "gap",
      requiredInformation: [
        {
          key: "identified_gap",
          label: "Identified gap",
          factType: "reference",
          placeholderLabel: "gap identified in the literature",
          question:
            "What genuine gap remains after considering the sources reviewed?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.gap",
          neutralReplacementOptions: [],
        },
        {
          key: "current_work_response",
          label: "Response to the gap",
          factType: "other",
          placeholderLabel: "how the current work responds to the gap",
          question:
            "How does the current research or project respond to that gap?",
          requiredForExport: true,
          sharedResolutionKey: "literature_review.current_work_response",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "specific research question",
        "theoretical contribution",
        "practical relevance",
        "policy contribution",
        "originality justification",
        "stakeholder benefits",
        "limitations",
        "measurable outcomes",
      ],
    },
  ],
};

const LITERATURE_REVIEW_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Literature Review section captures the review scope, real source-backed themes, genuine scholarly disagreements and a defensible gap",
    "intake and context reuse: supplied articles, reading lists, notes and confirmed research questions are reused before clarification",
    "generation resilience: complete Literature Review structure remains available while unsupported source claims remain visible placeholders rather than invented scholarship",
    "factual safety: authors, studies, quotations, arguments, findings and research gaps are never fabricated",
    "placeholder integrity: every unresolved Literature Review fact has a contextual label, exact question and export requirement",
    "resolution behaviour: review scope, source themes, debates and gap facts update linked Literature Review occurrences without changing unrelated synthesis",
    "proofread behaviour: Literature Review placeholders are excluded from editorial findings while surrounding academic synthesis remains reviewable",
    "workspace persistence: resolved Literature Review facts and source-grounded analysis persist independently across sections",
    "issue navigation: unresolved Literature Review scope, theme, evidence, debate and gap facts remain independently countable and answerable",
    "export behaviour: themes, representative sources, debates and identified gaps remain required because generic academic language cannot safely substitute for actual literature",
    "accessibility and recovery: every Literature Review placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Literature Review validation, source-attribution, factual-grounding and export acknowledgement tests must remain green",
  ],
  notes: [
    "TED must never invent authors, studies or scholarly positions when source material is incomplete.",
    "A gap is valid only when it follows from the literature actually reviewed rather than from a generic research-gap template.",
    "Opposing scholarly positions must be represented fairly without manufacturing false balance where the evidence does not support it.",
  ],
} as const;

const MARKETING_BRIEF_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "objective",
      requiredInformation: [
        {
          key: "campaign_goal",
          label: "Campaign goal",
          factType: "achievement",
          placeholderLabel: "campaign goal",
          question: "What specific outcome does this campaign need to achieve?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.campaign_goal",
          neutralReplacementOptions: [],
        },
        {
          key: "product_or_service",
          label: "Product or service",
          factType: "other",
          placeholderLabel: "product or service being marketed",
          question:
            "What product, service, offer or initiative is the campaign promoting?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.product_service",
          neutralReplacementOptions: [],
        },
        {
          key: "deadline_or_timeframe",
          label: "Deadline or timeframe",
          factType: "date_range",
          placeholderLabel: "campaign deadline or timeframe",
          question: "By when does the campaign need to achieve its objective?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.timeframe",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "funnel stage",
        "business metric",
        "audience behaviour change",
        "priority ranking",
        "competitive context",
        "stakeholder alignment",
        "campaign milestones",
      ],
    },
    {
      sectionKey: "audience",
      requiredInformation: [
        {
          key: "target_audience",
          label: "Target audience",
          factType: "other",
          placeholderLabel: "target audience",
          question: "Who exactly is this campaign trying to reach?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.target_audience",
          neutralReplacementOptions: [],
        },
        {
          key: "audience_need_or_problem",
          label: "Audience need or problem",
          factType: "other",
          placeholderLabel: "audience need or problem",
          question:
            "What real need, problem or motivation does this audience have that the campaign should address?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.audience_need",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "persona detail",
        "objections",
        "customer insights",
        "segmentation",
        "psychographic drivers",
        "purchase journey stage",
        "cultural context",
        "media habits",
      ],
    },
    {
      sectionKey: "message",
      requiredInformation: [
        {
          key: "core_message",
          label: "Core message",
          factType: "other",
          placeholderLabel: "core campaign message",
          question:
            "What is the single most important message the audience should take away?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.core_message",
          neutralReplacementOptions: [],
        },
        {
          key: "supporting_proof",
          label: "Supporting proof",
          factType: "reference",
          placeholderLabel: "proof supporting the message",
          question: "What real evidence or proof points support that message?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.supporting_proof",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "tone of voice",
        "offer",
        "emotional hook",
        "competitive differentiation",
        "brand story",
        "proof sources",
        "call-to-action hierarchy",
        "localisation notes",
      ],
    },
    {
      sectionKey: "deliverables",
      requiredInformation: [
        {
          key: "required_assets",
          label: "Required assets",
          factType: "responsibility",
          placeholderLabel: "required campaign assets",
          question: "What assets need to be produced for this campaign?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.required_assets",
          neutralReplacementOptions: [],
        },
        {
          key: "distribution_channels",
          label: "Distribution channels",
          factType: "other",
          placeholderLabel: "campaign distribution channels",
          question: "Which channels will those assets run across?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.channels",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "asset specifications",
        "deadlines",
        "owners",
        "media budget",
        "approval workflow",
        "version control",
        "platform optimisation",
        "production timeline",
        "quality assurance",
        "legal requirements",
      ],
    },
    {
      sectionKey: "success",
      requiredInformation: [
        {
          key: "success_metrics",
          label: "Success metrics",
          factType: "other",
          placeholderLabel: "campaign success metrics",
          question:
            "Which metrics will be used to judge whether the campaign worked?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.success_metrics",
          neutralReplacementOptions: [],
        },
        {
          key: "numeric_targets",
          label: "Numeric targets",
          factType: "amount",
          placeholderLabel: "numeric target for each primary metric",
          question:
            "What numeric target should be used for each primary success metric?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.metric_targets",
          neutralReplacementOptions: [],
        },
        {
          key: "measurement_timeframe",
          label: "Measurement timeframe",
          factType: "date_range",
          placeholderLabel: "timeframe for judging success",
          question: "Over what timeframe should those results be measured?",
          requiredForExport: true,
          sharedResolutionKey: "marketing.measurement_timeframe",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "baseline",
        "attribution method",
        "reporting cadence",
        "confidence ranges",
        "cost per acquisition",
        "channel contribution",
        "post-campaign learnings",
      ],
    },
  ],
};

const MARKETING_BRIEF_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Marketing Brief section captures a time-bound goal, target audience, real need, core message, supporting proof, required assets, channels and measurable targets",
    "intake and context reuse: brand guidelines, prior campaign materials, customer information and confirmed product facts are reused before clarification",
    "generation resilience: complete Marketing Brief wording remains available while unresolved campaign facts remain explicit placeholders rather than generic marketing assumptions",
    "factual safety: product claims, customer needs, proof points, targets and channel facts are never fabricated",
    "placeholder integrity: every unresolved Marketing Brief fact has a specific contextual label, exact conversational question and explicit export state",
    "resolution behaviour: shared objective, audience, message, asset and measurement facts update linked Marketing Brief occurrences without changing unrelated creative direction",
    "proofread behaviour: declared Marketing Brief placeholder labels are excluded from editorial findings while surrounding campaign prose remains reviewable for clarity and unsupported claims",
    "workspace persistence: resolved Marketing Brief facts and edited messaging persist independently across all sections",
    "issue navigation: unresolved Marketing Brief facts remain separately countable across objective, audience, message, channels and success measures",
    "export behaviour: campaign objective, audience, message, deliverables and measurable targets remain required because generic replacements would make the brief operationally unreliable",
    "accessibility and recovery: every Marketing Brief placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Marketing Brief validation, claim grounding, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "Supporting proof must come from genuine evidence rather than being invented to strengthen the marketing message.",
    "A campaign goal is not considered measurable merely because it sounds specific; actual trackable metrics and numeric targets are kept separate.",
    "Channels and deliverables must reflect the real campaign plan rather than TED assuming a default social or digital mix.",
  ],
} as const;

const MEETING_MINUTES_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "attendees",
      requiredInformation: [
        {
          key: "meeting_name",
          label: "Meeting name",
          factType: "event",
          placeholderLabel: "meeting name",
          question: "What was the meeting called or what was it about?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.name",
          neutralReplacementOptions: [],
        },
        {
          key: "meeting_date",
          label: "Meeting date",
          factType: "date",
          placeholderLabel: "meeting date",
          question: "When did the meeting take place?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.date",
          neutralReplacementOptions: [],
        },
        {
          key: "attendees",
          label: "Attendees",
          factType: "person_name",
          placeholderLabel: "meeting attendees",
          question: "Who attended the meeting?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.attendees",
          neutralReplacementOptions: [],
        },
        {
          key: "chair",
          label: "Meeting chair",
          factType: "person_name",
          placeholderLabel: "meeting chair",
          question: "Who chaired or led the meeting?",
          requiredForExport: false,
          sharedResolutionKey: "meeting.chair",
          neutralReplacementOptions: [
            {
              id: "chair-not-recorded",
              label: "Chair not recorded",
              value: "The meeting chair was not recorded.",
              suitability:
                "Use when the minutes do not need to identify a chair and the source material does not establish one.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "minute_taker",
          label: "Minute taker",
          factType: "person_name",
          placeholderLabel: "minute taker",
          question: "Who prepared or recorded the minutes?",
          requiredForExport: false,
          sharedResolutionKey: "meeting.minute_taker",
          neutralReplacementOptions: [
            {
              id: "minute-taker-not-recorded",
              label: "Minute taker not recorded",
              value: "The minute taker was not recorded.",
              suitability:
                "Use when authorship of the minutes is not required and no minute taker is identified in the source.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "apologies",
        "meeting location or link",
        "meeting purpose",
        "document version",
        "attendee roles",
        "remote-participation notes",
        "confidentiality level",
        "time zone",
      ],
    },
    {
      sectionKey: "discussion",
      requiredInformation: [
        {
          key: "topics_discussed",
          label: "Topics discussed",
          factType: "event",
          placeholderLabel: "topics discussed",
          question:
            "What were the main topics actually discussed during the meeting?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.topics_discussed",
          neutralReplacementOptions: [],
        },
        {
          key: "next_date_or_step",
          label: "Next date or step",
          factType: "event",
          placeholderLabel: "next meeting date or next step",
          question: "Was a next meeting date or other follow-up step agreed?",
          requiredForExport: false,
          sharedResolutionKey: "meeting.next_step",
          neutralReplacementOptions: [
            {
              id: "follow-up-not-confirmed",
              label: "Follow-up not confirmed",
              value:
                "No follow-up date or next step was confirmed in the available record.",
              suitability:
                "Use when the supplied meeting record does not establish a confirmed follow-up.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "time allocation",
        "presenters",
        "links to papers",
        "agenda references",
        "key takeaways",
        "evidence citations",
        "risk notes",
        "decision-impact context",
      ],
    },
    {
      sectionKey: "decisions",
      requiredInformation: [
        {
          key: "decisions_made",
          label: "Decisions made",
          factType: "event",
          placeholderLabel: "decisions made",
          question: "What decisions were actually made during the meeting?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.decisions",
          neutralReplacementOptions: [],
        },
        {
          key: "decision_context",
          label: "Decision context",
          factType: "other",
          placeholderLabel: "context for the decisions",
          question:
            "What context is needed to understand why each recorded decision was made?",
          requiredForExport: false,
          sharedResolutionKey: "meeting.decision_context",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "decision owner",
        "rationale",
        "vote or consensus status",
        "dependencies",
        "implementation timeline",
        "success criteria",
        "stakeholder impact",
        "budget implications",
        "communication plan",
      ],
    },
    {
      sectionKey: "actions",
      requiredInformation: [
        {
          key: "owner",
          label: "Action owner",
          factType: "person_name",
          placeholderLabel: "action owner",
          question: "Who owns each action item?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.action_owners",
          neutralReplacementOptions: [],
        },
        {
          key: "task",
          label: "Action task",
          factType: "responsibility",
          placeholderLabel: "action item",
          question: "What exactly needs to be done for each action item?",
          requiredForExport: true,
          sharedResolutionKey: "meeting.action_tasks",
          neutralReplacementOptions: [],
        },
        {
          key: "due_date",
          label: "Action due date",
          factType: "date",
          placeholderLabel: "action due date",
          question: "When is each action item due?",
          requiredForExport: false,
          sharedResolutionKey: "meeting.action_due_dates",
          neutralReplacementOptions: [
            {
              id: "due-date-to-confirm",
              label: "Due date to confirm",
              value: "Due date to be confirmed.",
              suitability:
                "Use when an action is confirmed but no completion date was agreed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
      ],
      optionalInformation: [
        "priority",
        "status",
        "blockers",
        "follow-up channel",
        "estimated effort",
        "resource allocation",
        "milestone alignment",
        "progress-reporting frequency",
        "completion verification",
      ],
    },
  ],
};

const MEETING_MINUTES_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Meeting Minutes / Briefing section captures the meeting identity, attendance record, discussion, decisions and owner-specific action items required by the shipped template",
    "intake and context reuse: transcripts, meeting notes, calendar details, uploaded papers and prior conversation facts can populate Meeting Minutes / Briefing requirements before clarification",
    "generation resilience: Meeting Minutes / Briefing wording remains structurally complete even when individual names, follow-up dates or action details remain represented by declared placeholders",
    "factual safety: attendance, discussion points, decisions, owners and deadlines are derived only from supplied records and are never reconstructed as though they definitely occurred",
    "placeholder integrity: each missing Meeting Minutes / Briefing fact retains its own section-scoped key, meaningful label, exact question and explicit replacement policy",
    "resolution behaviour: shared meeting facts can update their linked Meeting Minutes / Briefing occurrences while decisions and action items remain independent where their facts differ",
    "proofread behaviour: unresolved Meeting Minutes / Briefing tokens are excluded from prose criticism while the surrounding record remains reviewable for clarity and neutral factual phrasing",
    "workspace persistence: corrections to attendees, discussion, decisions and actions persist without regenerating unrelated Meeting Minutes / Briefing sections",
    "issue navigation: unresolved Meeting Minutes / Briefing facts remain individually selectable so a missing chair cannot be conflated with an unknown action owner or deadline",
    "export behaviour: core meeting record and action facts require acknowledgement where necessary while explicitly unrecorded chair, minute-taker and follow-up details have safe declared alternatives",
    "accessibility and recovery: every Meeting Minutes / Briefing placeholder presents a human-readable label and conversational clarification question and unresolved tokens remain visible after malformed input",
    "regression and release evidence: Meeting Minutes / Briefing validation, transcript-grounding behaviour, shared-resolution tests, placeholder counts and export-state tests must remain green",
  ],
  notes: [
    "A missing source record is never converted into an invented attendee, decision, action owner or deadline.",
    "The neutral 'not recorded' options are appropriate only when the source genuinely does not identify that administrative detail.",
    "Action owner, task and due date remain distinct so partial knowledge of an action does not falsely resolve the rest.",
  ],
} as const;

const NETWORKING_OUTREACH_MESSAGE_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "intro",
        requiredInformation: [
          {
            key: "sender_identity",
            label: "Sender identity",
            factType: "person_name",
            placeholderLabel: "your name or professional identity",
            question: "How should you introduce yourself to this person?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.professional_identity",
            neutralReplacementOptions: [],
          },
          {
            key: "reason_for_contacting_recipient",
            label: "Reason for contacting recipient",
            factType: "other",
            placeholderLabel: "reason for contacting this person",
            question: "Why are you reaching out to this specific person?",
            requiredForExport: true,
            sharedResolutionKey: "networking.contact_reason",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "shared connection",
          "specific reference to their work",
          "concise credibility signal",
          "recipient name",
          "sender role",
          "relevant industry context",
        ],
      },
      {
        sectionKey: "reason",
        requiredInformation: [
          {
            key: "advice_topic",
            label: "Advice topic",
            factType: "other",
            placeholderLabel: "topic or career area",
            question:
              "What topic, career area or decision are you hoping to get their perspective on?",
            requiredForExport: true,
            sharedResolutionKey: "networking.advice_topic",
            neutralReplacementOptions: [],
          },
          {
            key: "recipient_relevance",
            label: "Why this person",
            factType: "reference",
            placeholderLabel: "why this person's perspective is relevant",
            question:
              "What about their role, background or work makes them particularly relevant to what you're exploring?",
            requiredForExport: true,
            sharedResolutionKey: "networking.recipient_relevance",
            neutralReplacementOptions: [],
          },
          {
            key: "current_situation",
            label: "Current situation",
            factType: "other",
            placeholderLabel: "your current situation",
            question:
              "What's your current situation in one or two sentences so they understand the context?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.current_situation",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "current goal",
          "specific challenge",
          "decision timeframe",
          "targeted question",
          "relevant project of the recipient",
        ],
      },
      {
        sectionKey: "ask",
        requiredInformation: [
          {
            key: "conversation_or_advice_request",
            label: "Request",
            factType: "event",
            placeholderLabel: "request for a conversation or advice",
            question: "What are you specifically asking them to do?",
            requiredForExport: true,
            sharedResolutionKey: "networking.ask",
            neutralReplacementOptions: [],
          },
          {
            key: "low_effort_ask",
            label: "Low-effort ask",
            factType: "other",
            placeholderLabel: "small specific ask",
            question:
              "What's the smallest practical version of the ask — for example a short call, one question or an introduction?",
            requiredForExport: true,
            sharedResolutionKey: "networking.ask_scope",
            neutralReplacementOptions: [],
          },
          {
            key: "schedule_flexibility",
            label: "Schedule flexibility",
            factType: "other",
            placeholderLabel: "schedule flexibility",
            question: "How flexible are you around their availability?",
            automaticFallback: "at a time that suits your schedule",
            requiredForExport: false,
            sharedResolutionKey: "networking.schedule_flexibility",
            neutralReplacementOptions: [
              {
                id: "recipient-schedule",
                label: "Work around their schedule",
                value: "at a time that suits your schedule",
                suitability:
                  "Use when the sender has no specific availability constraint and wants to keep the request flexible.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "time estimate",
          "preferred communication method",
          "email-response alternative",
          "brief agenda",
          "calendar link",
        ],
      },
      {
        sectionKey: "close",
        requiredInformation: [
          {
            key: "thanks",
            label: "Thanks",
            factType: "other",
            placeholderLabel: "brief thanks",
            question:
              "Would you like to include a simple thank-you for their time or consideration?",
            automaticFallback: "Thank you for considering my request.",
            requiredForExport: false,
            sharedResolutionKey: "networking.thanks",
            neutralReplacementOptions: [
              {
                id: "simple-thanks",
                label: "Simple thanks",
                value: "Thank you for considering my request.",
                suitability: "Use when no personalised thank-you is needed.",
                clearsExportWarning: true,
                regenerateSurroundingWording: false,
              },
            ],
          },
          {
            key: "respectful_opt_out",
            label: "Respectful opt-out",
            factType: "other",
            placeholderLabel: "respectful option to decline",
            question:
              "Do you want to make it explicit that there's no pressure if they're unavailable?",
            automaticFallback:
              "I completely understand if your schedule does not allow.",
            requiredForExport: false,
            sharedResolutionKey: "networking.opt_out",
            neutralReplacementOptions: [
              {
                id: "no-pressure",
                label: "No-pressure close",
                value:
                  "I completely understand if your schedule does not allow.",
                suitability:
                  "Use when a respectful low-pressure close is appropriate.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "LinkedIn profile",
          "portfolio link",
          "personal contact details",
          "professional signature",
          "stay-connected invitation",
        ],
      },
    ],
  };

const NETWORKING_OUTREACH_MESSAGE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Networking Outreach Message section captures sender context, genuine recipient relevance, the advice topic, a specific low-effort request and a respectful close",
    "intake and context reuse: candidate profile facts, recipient information, supplied LinkedIn material and prior career context are reused before the Networking Outreach Message asks for clarification",
    "generation resilience: complete Networking Outreach Message wording remains available when optional scheduling or closing preferences are unresolved through declared neutral wording",
    "factual safety: shared connections, recipient work, professional relationships and sender achievements are never invented to manufacture personalisation",
    "placeholder integrity: every unresolved Networking Outreach Message fact has a specific contextual label, exact conversational question and explicit replacement policy",
    "resolution behaviour: shared sender, recipient and outreach-goal facts update linked Networking Outreach Message occurrences without altering unrelated wording",
    "proofread behaviour: declared Networking Outreach Message placeholders are excluded from editorial findings while surrounding prose remains reviewable for brevity and professionalism",
    "workspace persistence: personalised wording and resolved Networking Outreach Message facts persist without later answers overwriting unrelated sections",
    "issue navigation: unresolved Networking Outreach Message facts remain independently selectable across introduction, context, ask and close",
    "export behaviour: recipient-specific purpose and the actual ask require acknowledgement while flexibility, thanks and opt-out language have safe declared defaults",
    "accessibility and recovery: every Networking Outreach Message placeholder exposes a meaningful label and direct question while malformed tokens remain visible",
    "regression and release evidence: Networking Outreach Message validation, factual-personalisation checks, fallback behaviour and export-state tests must remain green",
  ],
  notes: [
    "TED must never fabricate familiarity, a mutual connection or knowledge of the recipient's work.",
    "The ask remains load-bearing because generic networking wording without a real purpose would not be ready to send.",
    "Schedule flexibility and a respectful opt-out can safely default because they describe communication style rather than personal facts.",
  ],
} as const;

const PERFORMANCE_REVIEW_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "summary",
      requiredInformation: [
        {
          key: "employee",
          label: "Employee",
          factType: "person_name",
          placeholderLabel: "employee name",
          question: "Who is this performance review for?",
          requiredForExport: true,
          sharedResolutionKey: "employee.full_name",
          neutralReplacementOptions: [],
        },
        {
          key: "role",
          label: "Employee role",
          factType: "role_title",
          placeholderLabel: "employee role",
          question:
            "What role did the employee hold during this review period?",
          requiredForExport: true,
          sharedResolutionKey: "employee.role_title",
          neutralReplacementOptions: [],
        },
        {
          key: "period",
          label: "Review period",
          factType: "date_range",
          placeholderLabel: "review period",
          question: "What period does this performance review cover?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.period",
          neutralReplacementOptions: [],
        },
        {
          key: "core_responsibilities",
          label: "Core responsibilities",
          factType: "responsibility",
          placeholderLabel: "core responsibilities",
          question:
            "What were the employee's main responsibilities during this period?",
          requiredForExport: true,
          sharedResolutionKey: "employee.core_responsibilities",
          neutralReplacementOptions: [],
        },
        {
          key: "key_achievements",
          label: "Key achievements",
          factType: "achievement",
          placeholderLabel: "key achievements",
          question:
            "What confirmed achievements should be highlighted from this review period?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.key_achievements",
          neutralReplacementOptions: [],
        },
        {
          key: "achievement_impact",
          label: "Achievement impact",
          factType: "achievement",
          placeholderLabel: "impact of the achievements",
          question:
            "What impact did those achievements have on the team, customers or business?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.achievement_impact",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "level expectations",
        "changes in role scope",
        "team context",
        "performance metrics",
        "stakeholder feedback",
        "behavioural examples",
        "links to existing goals",
        "organisational values alignment",
      ],
    },
    {
      sectionKey: "strengths",
      requiredInformation: [
        {
          key: "demonstrated_strengths",
          label: "Demonstrated strengths",
          factType: "skill",
          placeholderLabel: "demonstrated strengths",
          question:
            "What strengths did the employee consistently demonstrate during this period?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.demonstrated_strengths",
          neutralReplacementOptions: [],
        },
        {
          key: "strength_examples",
          label: "Strength examples",
          factType: "achievement",
          placeholderLabel: "specific examples supporting the strengths",
          question:
            "What are at least two specific examples from the review period that demonstrate those strengths?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.strength_examples",
          neutralReplacementOptions: [],
        },
        {
          key: "strength_impact",
          label: "Strength impact",
          factType: "achievement",
          placeholderLabel: "impact of the strengths",
          question:
            "How did those strengths positively affect the team or business?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.strength_impact",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "competency mapping",
        "peer or customer comments",
        "cross-functional impact",
        "quantified results",
        "strategic-objective linkage",
        "stakeholder quotations",
        "future application of each strength",
      ],
    },
    {
      sectionKey: "development",
      requiredInformation: [
        {
          key: "areas_for_improvement",
          label: "Areas for improvement",
          factType: "skill",
          placeholderLabel: "areas for development",
          question: "What areas would most benefit from further development?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.development_areas",
          neutralReplacementOptions: [],
        },
        {
          key: "development_support",
          label: "Development support",
          factType: "other",
          placeholderLabel: "development support",
          question:
            "What support should be provided to help the employee improve in these areas?",
          requiredForExport: false,
          sharedResolutionKey: "performance_review.development_support",
          neutralReplacementOptions: [
            {
              id: "support-to-agree",
              label: "Support to be agreed",
              value:
                "Appropriate development support will be agreed with the employee as part of the follow-up process.",
              suitability:
                "Use when a development need is known but the specific support arrangement has not yet been decided.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "training plan",
        "coaching actions",
        "learning resources",
        "behavioural examples",
        "development milestones",
        "mentorship options",
        "feedback cadence",
        "links to performance measures",
      ],
    },
    {
      sectionKey: "goals",
      requiredInformation: [
        {
          key: "future_goals",
          label: "Future goals",
          factType: "achievement",
          placeholderLabel: "goals for the next period",
          question:
            "What should the employee achieve during the next review period?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.next_period_goals",
          neutralReplacementOptions: [],
        },
        {
          key: "goal_measurement",
          label: "Goal measurement",
          factType: "other",
          placeholderLabel: "how progress will be measured",
          question:
            "How will progress or success against these goals be measured?",
          requiredForExport: true,
          sharedResolutionKey: "performance_review.goal_measurement",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "SMART goal framing",
        "career alignment",
        "stretch targets",
        "review dates",
        "team OKR alignment",
        "leading indicators",
        "resource requirements",
        "check-in cadence",
      ],
    },
  ],
};

const PERFORMANCE_REVIEW_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Performance Review section captures its real vital facts, including employee context, evidenced strengths, development needs, support, future goals and measurement",
    "intake and context reuse: employee profile details, role information, manager notes, prior reviews, KPI reports and conversation facts can resolve Performance Review requirements before clarification",
    "generation resilience: every Performance Review section can still be drafted as complete prose when facts are unresolved because each missing fact receives its own declared placeholder",
    "factual safety: employee identity, responsibilities, achievements, impacts, strengths and performance claims are never inferred or embellished beyond supplied evidence",
    "placeholder integrity: each unresolved Performance Review fact has a specific contextual label, plain-language question, export rule and independent section-scoped information key",
    "resolution behaviour: shared employee and review facts can resolve linked Performance Review occurrences without changing unrelated assessment wording",
    "proofread behaviour: Performance Review placeholder labels remain outside editorial findings while surrounding evaluative prose can still be checked for clarity, balance and professionalism",
    "workspace persistence: resolved facts, manager edits and unresolved Performance Review placeholders can persist section by section without replacing independently edited content",
    "issue navigation: unresolved Performance Review facts remain independently countable and selectable across summary, strengths, development and future-goal sections",
    "export behaviour: load-bearing employee, evidence and goal facts require acknowledgement when unresolved while the declared development-support replacement can safely clear its own warning",
    "accessibility and recovery: every Performance Review placeholder exposes a meaningful label and exact question, and malformed or unresolved tokens remain visible rather than disappearing",
    "regression and release evidence: Performance Review contract validation, contradiction checks, placeholder resolution, export behaviour and shared pipeline tests must pass before the contract remains release-ready",
  ],
  notes: [
    "Performance praise and criticism must be grounded in real examples rather than generic managerial language presented as fact.",
    "Development support may be described as still to be agreed, but the actual development need itself is never invented or neutralised.",
    "Key achievements and their impact remain separate facts so an achievement cannot acquire an unsupported business outcome during generation.",
  ],
} as const;

const PERSONAL_BRAND_STATEMENT_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "identity",
        requiredInformation: [
          {
            key: "profession",
            label: "Profession",
            factType: "role_title",
            placeholderLabel: "profession",
            question: "What profession or field best describes you?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.profession",
            neutralReplacementOptions: [],
          },
          {
            key: "role",
            label: "Role",
            factType: "role_title",
            placeholderLabel: "professional role",
            question:
              "What role do you currently hold or want to be associated with?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.target_role",
            neutralReplacementOptions: [],
          },
          {
            key: "specialty",
            label: "Specialty",
            factType: "skill",
            placeholderLabel: "professional specialty",
            question:
              "What specialty or area of expertise makes your positioning more specific?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.main_specialty",
            neutralReplacementOptions: [],
          },
          {
            key: "target_positioning",
            label: "Target positioning",
            factType: "other",
            placeholderLabel: "target professional positioning",
            question:
              "How do you want people to understand or remember your professional positioning?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.target_positioning",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "niche",
          "target audience",
          "seniority",
          "memorable wording",
          "signature skill",
          "geographic relevance",
          "personal brand voice",
        ],
      },
      {
        sectionKey: "value",
        requiredInformation: [
          {
            key: "audience_served",
            label: "Audience served",
            factType: "other",
            placeholderLabel: "people or organisations you help",
            question: "Who do you help through your work?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.audience_served",
            neutralReplacementOptions: [],
          },
          {
            key: "outcome_delivered",
            label: "Outcome delivered",
            factType: "achievement",
            placeholderLabel: "outcome you help deliver",
            question:
              "What outcome do you help those people or organisations achieve?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.value_outcome",
            neutralReplacementOptions: [],
          },
          {
            key: "core_approach",
            label: "Core approach",
            factType: "skill",
            placeholderLabel: "core professional approach",
            question:
              "What approach, method or capability describes how you create that value?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.value_approach",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "differentiator",
          "measurable value",
          "industry language",
          "customer pain point",
          "solution framework",
          "market positioning",
          "strategic angle",
        ],
      },
      {
        sectionKey: "proof",
        requiredInformation: [
          {
            key: "credibility_signal",
            label: "Credibility signal",
            factType: "achievement",
            placeholderLabel: "achievement or credibility signal",
            question:
              "What real achievement, result or credential best supports this positioning?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.brand_proof",
            neutralReplacementOptions: [],
          },
          {
            key: "concrete_result_or_credential",
            label: "Concrete proof",
            factType: "achievement",
            placeholderLabel: "concrete result or credential",
            question:
              "What concrete result, credential or recognisable achievement can you point to?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.brand_proof",
            neutralReplacementOptions: [],
          },
          {
            key: "audience_relevance",
            label: "Relevance of proof",
            factType: "other",
            placeholderLabel: "why the proof matters",
            question:
              "Why does that proof matter to the audience you want to reach?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.brand_proof_relevance",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "metrics",
          "named projects",
          "awards",
          "testimonials",
          "recognisable organisations",
          "media coverage",
          "certifications",
          "benchmark comparisons",
        ],
      },
      {
        sectionKey: "direction",
        requiredInformation: [
          {
            key: "future_focus",
            label: "Future focus",
            factType: "other",
            placeholderLabel: "future focus or opportunity",
            question:
              "What type of work, opportunity or future direction are you aiming toward?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.career_direction",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "mission",
          "values",
          "preferred environment",
          "call to action",
          "long-term career vision",
          "target sector",
          "leadership aspirations",
          "collaboration preferences",
        ],
      },
    ],
  };

const PERSONAL_BRAND_STATEMENT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Personal Brand Statement section captures professional identity, audience, value, approach, concrete proof and intended future direction",
    "intake and context reuse: current resume, LinkedIn profile, confirmed achievements and prior career information are reused before the Personal Brand Statement asks for clarification",
    "generation resilience: Personal Brand Statement wording remains structurally complete around unresolved facts through targeted placeholders without filling gaps with generic branding claims",
    "factual safety: professions, roles, outcomes, achievements, credentials and differentiators in the Personal Brand Statement are never invented or exaggerated",
    "placeholder integrity: each unresolved Personal Brand Statement fact retains its own contextual label, exact plain-language question, shared-resolution metadata and export policy",
    "resolution behaviour: identity, proof and career-direction facts can resolve linked Personal Brand Statement occurrences while unrelated wording remains intact",
    "proofread behaviour: Personal Brand Statement placeholders are excluded from editorial findings while surrounding copy remains reviewable for memorability, specificity and authenticity",
    "workspace persistence: user-approved positioning language, proof and resolved Personal Brand Statement facts persist without later answers resetting unrelated sections",
    "issue navigation: unresolved Personal Brand Statement identity, value, proof and direction facts remain individually countable and selectable",
    "export behaviour: all core positioning and proof facts require acknowledgement because generic substitutes would undermine the factual basis of the Personal Brand Statement",
    "accessibility and recovery: every Personal Brand Statement placeholder uses a meaningful label and conversational question and malformed tokens remain visible for correction",
    "regression and release evidence: Personal Brand Statement validation, factual-proof grounding, shared-resolution, placeholder handling and repository regression checks must pass",
  ],
  notes: [
    "The proof section must contain a real credibility signal rather than a polished but unsupported competence claim.",
    "Memorable wording may be generated creatively around supplied facts, but TED must not create a new achievement or differentiator.",
    "Future direction remains required because the statement's positioning depends on what the user wants the brand to lead toward.",
  ],
} as const;

const PITCH_DECK_OUTLINE_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "problem",
      requiredInformation: [
        {
          key: "target_customer",
          label: "Target customer",
          factType: "other",
          placeholderLabel: "target customer",
          question: "Who is the customer experiencing this problem?",
          requiredForExport: true,
          sharedResolutionKey: "business.target_customer",
          neutralReplacementOptions: [],
        },
        {
          key: "problem",
          label: "Customer problem",
          factType: "other",
          placeholderLabel: "customer problem",
          question: "What specific problem does that customer experience?",
          requiredForExport: true,
          sharedResolutionKey: "business.problem_solved",
          neutralReplacementOptions: [],
        },
        {
          key: "consequence",
          label: "Problem consequence",
          factType: "other",
          placeholderLabel: "cost or consequence of the problem",
          question: "What cost, friction or risk does that problem create?",
          requiredForExport: true,
          sharedResolutionKey: "business.problem_consequence",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "market evidence",
        "scale of pain",
        "current workaround",
        "customer persona",
        "quantified loss",
        "real customer anecdote",
      ],
    },
    {
      sectionKey: "solution",
      requiredInformation: [
        {
          key: "product_or_service",
          label: "Product or service",
          factType: "other",
          placeholderLabel: "product or service",
          question:
            "What product or service are you offering to solve the problem?",
          requiredForExport: true,
          sharedResolutionKey: "business.product_service",
          neutralReplacementOptions: [],
        },
        {
          key: "core_benefit",
          label: "Core benefit",
          factType: "achievement",
          placeholderLabel: "core customer benefit",
          question:
            "What core benefit does the customer receive from the solution?",
          requiredForExport: true,
          sharedResolutionKey: "business.core_benefit",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "demo flow",
        "unique mechanism",
        "screenshots",
        "competitive difference",
        "before-and-after scenario",
        "confirmed customer success example",
        "intellectual property",
      ],
    },
    {
      sectionKey: "market",
      requiredInformation: [
        {
          key: "market_segment",
          label: "Market segment",
          factType: "other",
          placeholderLabel: "market segment",
          question: "Which market segment are you targeting?",
          requiredForExport: true,
          sharedResolutionKey: "business.target_market",
          neutralReplacementOptions: [],
        },
        {
          key: "proof_of_demand",
          label: "Proof of demand or progress",
          factType: "achievement",
          placeholderLabel: "traction or proof of demand",
          question:
            "What real evidence of demand, traction or progress do you have so far?",
          requiredForExport: true,
          sharedResolutionKey: "business.traction",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "TAM, SAM and SOM",
        "revenue",
        "users",
        "pilots",
        "growth rate",
        "customer quotes",
        "strategic partnerships",
      ],
    },
    {
      sectionKey: "model",
      requiredInformation: [
        {
          key: "revenue_model",
          label: "Revenue model",
          factType: "other",
          placeholderLabel: "revenue model",
          question: "How does the business make money?",
          requiredForExport: true,
          sharedResolutionKey: "business.revenue_model",
          neutralReplacementOptions: [],
        },
        {
          key: "pricing_logic",
          label: "Pricing logic",
          factType: "amount",
          placeholderLabel: "pricing model",
          question:
            "How is the product or service priced, and what is that pricing based on?",
          requiredForExport: true,
          sharedResolutionKey: "business.pricing",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "unit economics",
        "sales channel",
        "retention",
        "margin",
        "expansion strategy",
        "customer lifetime value",
        "cost to serve",
      ],
    },
    {
      sectionKey: "ask",
      requiredInformation: [
        {
          key: "funding_or_support_amount",
          label: "Funding or support amount",
          factType: "amount",
          placeholderLabel: "funding or support sought",
          question: "How much funding or other support are you seeking?",
          requiredForExport: true,
          sharedResolutionKey: "funding.ask_amount",
          neutralReplacementOptions: [],
        },
        {
          key: "use_of_funds",
          label: "Use of funds",
          factType: "responsibility",
          placeholderLabel: "use of funds",
          question:
            "What specifically will the funding or support be used for?",
          requiredForExport: true,
          sharedResolutionKey: "funding.use_of_funds",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "milestones unlocked",
        "runway",
        "investor fit",
        "next funding round",
        "governance cadence",
        "return thesis",
        "exit scenario",
      ],
    },
  ],
};

const PITCH_DECK_OUTLINE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Pitch Deck Outline section captures the customer problem, solution, market evidence, traction, business model, pricing and explicit funding ask",
    "intake and context reuse: existing pitch materials, financial models, customer evidence and confirmed business facts are reused before clarification",
    "generation resilience: the Pitch Deck Outline remains structurally complete around unresolved facts through explicit placeholders rather than invented investor-ready claims",
    "factual safety: market size, traction, revenue, customer evidence, pricing and funding requirements are never fabricated",
    "placeholder integrity: each unresolved Pitch Deck Outline fact has a contextual label, exact question, export requirement and shared-resolution key where appropriate",
    "resolution behaviour: shared customer, product, market, revenue and funding facts resolve linked Pitch Deck Outline occurrences without altering unrelated narrative",
    "proofread behaviour: placeholder labels are excluded from editorial findings while surrounding pitch language remains reviewable for clarity and unsupported hype",
    "workspace persistence: Pitch Deck Outline edits and resolved business facts persist section by section without resetting unrelated slides",
    "issue navigation: unresolved Pitch Deck Outline facts remain independently countable across problem, solution, traction, model and ask",
    "export behaviour: all central investment claims remain required because generic replacements would risk presenting unsupported commercial information",
    "accessibility and recovery: every Pitch Deck Outline placeholder exposes a clear label and plain-language question and malformed tokens remain visible",
    "regression and release evidence: Pitch Deck Outline contract validation, traction grounding, numerical consistency and export tests must remain green",
  ],
  notes: [
    "Traction must represent real progress already achieved rather than future ambitions presented as evidence.",
    "Market-size figures receive no fallback because TED must never manufacture TAM, SAM or SOM.",
    "The funding amount and use of funds are intentionally separate so knowing one cannot falsely resolve the other.",
  ],
} as const;

const PROFESSIONAL_REFERENCE_LETTER_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "relationship",
        requiredInformation: [
          {
            key: "referee_identity",
            label: "Referee identity",
            factType: "person_name",
            placeholderLabel: "referee name",
            question:
              "What name should appear as the person providing the reference?",
            requiredForExport: true,
            sharedResolutionKey: "reference.referee_name",
            neutralReplacementOptions: [],
          },
          {
            key: "candidate_identity",
            label: "Candidate identity",
            factType: "person_name",
            placeholderLabel: "candidate name",
            question: "Who is the reference for?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.full_name",
            neutralReplacementOptions: [],
          },
          {
            key: "relationship",
            label: "Relationship",
            factType: "reference",
            placeholderLabel: "relationship to the candidate",
            question:
              "What is your genuine professional, academic or other relationship with the candidate?",
            requiredForExport: true,
            sharedResolutionKey: "reference.relationship",
            neutralReplacementOptions: [],
          },
          {
            key: "timeframe",
            label: "Relationship timeframe",
            factType: "date_range",
            placeholderLabel: "timeframe you have known the candidate",
            question:
              "Over what period have you known or worked with the candidate?",
            requiredForExport: true,
            sharedResolutionKey: "reference.relationship_timeframe",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "referee organisation",
          "referee title",
          "reporting line",
          "shared projects",
          "industry context",
          "mentoring relationship",
          "professional credentials",
        ],
      },
      {
        sectionKey: "performance",
        requiredInformation: [
          {
            key: "candidate_strengths",
            label: "Candidate strengths",
            factType: "skill",
            placeholderLabel: "candidate strengths",
            question:
              "What genuine strengths have you personally observed in the candidate?",
            requiredForExport: true,
            sharedResolutionKey: "reference.candidate_strengths",
            neutralReplacementOptions: [],
          },
          {
            key: "work_quality",
            label: "Quality of work",
            factType: "achievement",
            placeholderLabel: "quality of the candidate's work",
            question:
              "How would you describe the quality of the candidate's work based on what you directly observed?",
            requiredForExport: true,
            sharedResolutionKey: "reference.work_quality",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "reliability",
          "professional conduct",
          "technical skill",
          "leadership",
          "adaptability",
          "problem-solving",
          "teamwork",
          "stakeholder feedback",
        ],
      },
      {
        sectionKey: "evidence",
        requiredInformation: [
          {
            key: "specific_examples",
            label: "Specific examples",
            factType: "achievement",
            placeholderLabel: "specific examples of the candidate's work",
            question:
              "What are at least two specific examples of the candidate's work or conduct that you personally observed?",
            requiredForExport: true,
            sharedResolutionKey: "reference.evidence_examples",
            neutralReplacementOptions: [],
          },
          {
            key: "example_impact",
            label: "Example outcomes",
            factType: "achievement",
            placeholderLabel: "outcome or impact of each example",
            question:
              "What outcome or impact resulted from each of those examples?",
            requiredForExport: true,
            sharedResolutionKey: "reference.evidence_impacts",
            neutralReplacementOptions: [],
          },
          {
            key: "direct_observation",
            label: "Direct observation",
            factType: "reference",
            placeholderLabel: "how you observed the examples",
            question:
              "How did you personally observe or verify those examples?",
            requiredForExport: true,
            sharedResolutionKey: "reference.observation_context",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "measurable outcomes",
          "stakeholder impact",
          "challenge overcome",
          "responsibility level",
          "project timeframe",
          "resources managed",
          "before-and-after metrics",
          "awards or recognition",
        ],
      },
      {
        sectionKey: "recommendation",
        requiredInformation: [
          {
            key: "clear_endorsement",
            label: "Recommendation",
            factType: "other",
            placeholderLabel: "level of endorsement",
            question:
              "What level of recommendation can you genuinely give the candidate?",
            requiredForExport: true,
            sharedResolutionKey: "reference.endorsement",
            neutralReplacementOptions: [],
          },
          {
            key: "suitable_role_context",
            label: "Suitable role or context",
            factType: "role_title",
            placeholderLabel: "role or context the candidate would suit",
            question:
              "What kind of role, level or environment do you believe the candidate is genuinely suited to?",
            requiredForExport: true,
            sharedResolutionKey: "reference.suitable_context",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "referee contact details",
          "future potential",
          "seniority level",
          "willingness to discuss further",
          "cultural fit",
          "leadership readiness",
          "target-employer alignment",
        ],
      },
    ],
  };

const PROFESSIONAL_REFERENCE_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Professional Reference Letter section captures the referee-candidate relationship, observed performance, multiple specific examples, direct observation and an explicit recommendation",
    "intake and context reuse: supplied role information, candidate background, prior examples and referee context are reused before the Professional Reference Letter asks for missing facts",
    "generation resilience: the Professional Reference Letter retains complete formal structure around unresolved facts through specific placeholders rather than replacing missing evidence with generic praise",
    "factual safety: the Professional Reference Letter never invents the relationship, strengths, examples, outcomes, observations or endorsement of the referee",
    "placeholder integrity: every unresolved Professional Reference Letter fact is represented by its own contextual label, conversational question and appropriate export requirement",
    "resolution behaviour: shared candidate, relationship and evidence facts update linked Professional Reference Letter wording without modifying unrelated observations or endorsements",
    "proofread behaviour: Professional Reference Letter placeholder labels remain outside editorial findings while surrounding first-person referee wording remains reviewable for clarity and credibility",
    "workspace persistence: referee edits, evidence and resolved Professional Reference Letter facts persist without later resolutions overwriting unrelated sections",
    "issue navigation: unresolved Professional Reference Letter facts remain independently countable so missing evidence, relationship details or recommendation scope can be resolved separately",
    "export behaviour: identity, relationship, observed evidence and recommendation facts remain required because generic substitutes would falsely attribute statements to the referee",
    "accessibility and recovery: each Professional Reference Letter placeholder exposes a meaningful user-facing label and exact plain-language clarification question while malformed tokens remain visible",
    "regression and release evidence: Professional Reference Letter validation, first-person attribution, evidence grounding, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "The reference must be written from the referee's actual perspective and may not claim observations they did not make.",
    "At least two real examples are intentionally required because unsupported praise would undermine the purpose of the reference.",
    "No neutral endorsement option is supplied because TED cannot choose the strength of a recommendation on the referee's behalf.",
  ],
} as const;

const PROFIT_AND_LOSS_STATEMENT_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "revenue",
        requiredInformation: [
          {
            key: "total_revenue",
            label: "Total revenue",
            factType: "amount",
            placeholderLabel: "total revenue or sales",
            question:
              "What was the confirmed total revenue or sales for the reporting period?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.total_revenue",
            neutralReplacementOptions: [],
          },
          {
            key: "revenue_stream_breakdown",
            label: "Revenue stream breakdown",
            factType: "amount",
            placeholderLabel: "major revenue streams",
            question:
              "If there is more than one revenue stream, what confirmed amount belongs to each major stream?",
            requiredForExport: false,
            sharedResolutionKey: "pnl.revenue_streams",
            neutralReplacementOptions: [
              {
                id: "single-revenue-line",
                label: "Single revenue line",
                value:
                  "present the confirmed total revenue as a single revenue line without inventing a breakdown",
                suitability:
                  "Use when the source records contain only one revenue stream or do not provide a defensible breakdown.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
        ],
        optionalInformation: [
          "prior-period comparison",
          "budget comparison",
          "seasonality",
          "one-off versus recurring revenue",
          "growth rate",
          "customer concentration",
          "market drivers",
          "currency impact",
        ],
      },
      {
        sectionKey: "cogs_gross_profit",
        requiredInformation: [
          {
            key: "cost_of_goods_sold",
            label: "Cost of goods sold",
            factType: "amount",
            placeholderLabel: "cost of goods sold",
            question:
              "What direct costs are recorded as cost of goods sold for the period?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.cogs",
            neutralReplacementOptions: [],
          },
          {
            key: "gross_profit",
            label: "Gross profit",
            factType: "amount",
            placeholderLabel: "gross profit",
            question:
              "What gross profit results from total revenue minus cost of goods sold?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.gross_profit",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "gross margin percentage",
          "cost-per-unit trend",
          "supplier cost changes",
          "gross-profit variance",
          "inventory write-downs",
          "prior-year margin comparison",
          "one-off direct costs",
        ],
      },
      {
        sectionKey: "operating_expenses",
        requiredInformation: [
          {
            key: "expense_categories",
            label: "Operating expense categories",
            factType: "other",
            placeholderLabel: "operating expense categories",
            question:
              "Which operating expense categories should be included, such as wages, rent, marketing or administration?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.expense_categories",
            neutralReplacementOptions: [],
          },
          {
            key: "expense_amounts",
            label: "Amount per expense category",
            factType: "amount",
            placeholderLabel: "amount for each operating expense category",
            question:
              "What confirmed amount belongs to each operating expense category?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.expense_amounts",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "budget variance",
          "one-off versus recurring costs",
          "cost-reduction opportunities",
          "expense-to-revenue ratio",
          "staffing impacts",
          "marketing effectiveness",
          "year-over-year variance",
          "regulatory costs",
        ],
      },
      {
        sectionKey: "net_profit",
        requiredInformation: [
          {
            key: "net_profit_or_loss",
            label: "Net profit or loss",
            factType: "amount",
            placeholderLabel: "net profit or loss",
            question:
              "What net profit or loss results from gross profit minus operating expenses?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.net_profit",
            neutralReplacementOptions: [],
          },
          {
            key: "reporting_period",
            label: "Reporting period",
            factType: "date_range",
            placeholderLabel: "P&L reporting period",
            question:
              "What reporting period does this profit and loss statement cover?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.reporting_period",
            neutralReplacementOptions: [],
          },
          {
            key: "tax_basis",
            label: "Before or after tax basis",
            factType: "other",
            placeholderLabel: "whether profit is before or after tax",
            question: "Is the stated profit or loss before tax or after tax?",
            requiredForExport: true,
            sharedResolutionKey: "pnl.tax_basis",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "net margin percentage",
          "prior-period comparison",
          "result driver",
          "profit per employee",
          "tax provision impact",
          "sensitivity analysis",
          "industry benchmark",
          "one-off gains or losses",
          "forward outlook",
        ],
      },
    ],
  };

const PROFIT_AND_LOSS_STATEMENT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Profit & Loss Statement section captures revenue, direct costs, gross profit, operating expenses, net profit, reporting period and tax basis",
    "intake and context reuse: prior P&L statements, sales reports, expense reports and bookkeeping exports are reused before clarification",
    "generation resilience: complete Profit & Loss Statement structure remains available when a detailed revenue breakdown is unavailable by safely retaining a single confirmed revenue line",
    "factual safety: every financial figure comes from uploaded data, deterministic calculation or explicit user input and is never invented",
    "placeholder integrity: every unresolved Profit & Loss Statement amount or accounting fact has a contextual label, exact question and explicit export policy",
    "resolution behaviour: shared revenue, COGS, gross-profit, expense and net-profit facts update linked Profit & Loss Statement occurrences without altering unrelated figures",
    "proofread behaviour: Profit & Loss Statement placeholders remain outside editorial findings while surrounding labels and explanatory prose remain reviewable",
    "workspace persistence: resolved Profit & Loss Statement figures and edits persist independently across all sections",
    "issue navigation: unresolved Profit & Loss Statement revenue, cost, expense, tax and reporting-period facts remain independently countable",
    "export behaviour: all load-bearing financial totals remain required while a source-supported single revenue line can safely replace an unavailable breakdown",
    "accessibility and recovery: every Profit & Loss Statement placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Profit & Loss Statement validation, arithmetic reconciliation, shared-resolution and export tests must remain green",
  ],
  notes: [
    "Revenue minus cost of goods sold must reconcile exactly to gross profit.",
    "Gross profit minus operating expenses must reconcile exactly to the stated net profit or loss.",
    "The revenue-breakdown replacement may only collapse to a single confirmed total; it must never invent categories or allocations.",
  ],
} as const;

const PROPOSAL_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "summary",
      requiredInformation: [
        {
          key: "client",
          label: "Client",
          factType: "company_name",
          placeholderLabel: "client",
          question: "Who is this proposal being prepared for?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.client",
          neutralReplacementOptions: [],
        },
        {
          key: "provider",
          label: "Provider",
          factType: "company_name",
          placeholderLabel: "provider",
          question: "Who is making the proposal?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.provider",
          neutralReplacementOptions: [],
        },
        {
          key: "problem",
          label: "Client problem",
          factType: "other",
          placeholderLabel: "client problem",
          question:
            "What specific problem or opportunity is the client trying to address?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.problem",
          neutralReplacementOptions: [],
        },
        {
          key: "proposed_solution",
          label: "Proposed solution",
          factType: "responsibility",
          placeholderLabel: "proposed solution",
          question: "What solution are you proposing?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.solution",
          neutralReplacementOptions: [],
        },
        {
          key: "headline_outcome",
          label: "Headline outcome",
          factType: "achievement",
          placeholderLabel: "intended headline outcome",
          question:
            "What main outcome is the proposed solution intended to achieve for the client?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.headline_outcome",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "commercial value",
        "differentiator",
        "urgency",
        "success measure",
        "strategic-objective alignment",
        "risk-mitigation summary",
        "supported testimonial",
      ],
    },
    {
      sectionKey: "understanding",
      requiredInformation: [
        {
          key: "clear_client_problem",
          label: "Client need",
          factType: "other",
          placeholderLabel: "client need",
          question:
            "How would you describe the client's problem in concrete terms?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.problem",
          neutralReplacementOptions: [],
        },
        {
          key: "business_impact",
          label: "Business impact",
          factType: "other",
          placeholderLabel: "business impact of the problem",
          question:
            "What real impact is this problem having on the client's business, people or customers?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.problem_impact",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "supporting evidence",
        "quantified pain",
        "affected stakeholders",
        "risks of inaction",
        "industry benchmarks",
        "root causes",
        "future-state vision",
        "relevant case-study evidence",
      ],
    },
    {
      sectionKey: "solution",
      requiredInformation: [
        {
          key: "deliverables",
          label: "Deliverables",
          factType: "responsibility",
          placeholderLabel: "proposal deliverables",
          question: "What specific deliverables will the client receive?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.deliverables",
          neutralReplacementOptions: [],
        },
        {
          key: "approach",
          label: "Delivery approach",
          factType: "responsibility",
          placeholderLabel: "delivery approach",
          question: "How will you deliver the proposed solution?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.approach",
          neutralReplacementOptions: [],
        },
        {
          key: "challenge_alignment",
          label: "Solution-to-need alignment",
          factType: "other",
          placeholderLabel: "how the solution addresses the challenge",
          question:
            "How does this approach directly address the client's stated challenge?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.solution_alignment",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "delivery phases",
        "methodology",
        "assumptions",
        "exclusions",
        "evidence of capability",
        "resource allocation",
        "change-management approach",
        "quality checkpoints",
        "scalability considerations",
      ],
    },
    {
      sectionKey: "pricing",
      requiredInformation: [
        {
          key: "start_date_or_timeframe",
          label: "Start date or timeframe",
          factType: "date_range",
          placeholderLabel: "start date or delivery timeframe",
          question:
            "When can the work start and what delivery timeframe should the proposal state?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.timeframe",
          neutralReplacementOptions: [],
        },
        {
          key: "price_or_range",
          label: "Price or range",
          factType: "amount",
          placeholderLabel: "proposal price",
          question:
            "What price, investment amount or approved price range should the proposal show?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.price",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "payment terms",
        "package options",
        "dependencies",
        "milestones",
        "proposal validity period",
        "currency",
        "cost-benefit evidence",
        "supported discount rationale",
      ],
    },
    {
      sectionKey: "next",
      requiredInformation: [
        {
          key: "approval_or_action",
          label: "Required next action",
          factType: "responsibility",
          placeholderLabel: "action required to proceed",
          question: "What should the client do next if they want to proceed?",
          requiredForExport: true,
          sharedResolutionKey: "proposal.next_action",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "decision makers",
        "decision timeframe",
        "kickoff agenda",
        "signature process",
        "contact details",
        "onboarding steps",
        "feedback process",
        "next meeting",
      ],
    },
  ],
};

const PROPOSAL_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Proposal section captures client and provider identity, the evidenced need, proposed outcome, deliverables, approach, pricing, timeframe and concrete next action",
    "intake and context reuse: client briefs, RFPs, case studies, prior correspondence, pricing data and existing business profile facts can populate Proposal requirements before clarification",
    "generation resilience: persuasive Proposal wording remains available around unresolved facts because missing commercial and client-specific information is represented explicitly rather than replaced with invented claims",
    "factual safety: client problems, business impacts, capability claims, deliverables, prices, dates and expected outcomes are never invented or strengthened beyond available evidence",
    "placeholder integrity: every unresolved Proposal fact has a distinct contextual placeholder, natural clarification question, export requirement and reusable resolution key where appropriate",
    "resolution behaviour: shared client problem, solution, timeframe and price facts can update linked Proposal wording without replacing independently written supporting context",
    "proofread behaviour: Proposal placeholders are ignored as editorial defects while surrounding persuasive prose remains reviewable for clarity, specificity and unsupported overstatement",
    "workspace persistence: edited Proposal positioning, pricing language and resolved facts persist section by section without later resolutions overwriting unrelated user-approved wording",
    "issue navigation: unresolved Proposal facts remain individually selectable across summary, need, solution, pricing and next-step sections rather than appearing as one generic incompleteness state",
    "export behaviour: unresolved client need, solution, deliverables, pricing, timing and next-action facts require acknowledgement because exporting invented commercial specifics would be misleading",
    "accessibility and recovery: each Proposal placeholder exposes a clear user-facing label and exact conversational question and remains visible if token metadata cannot be resolved",
    "regression and release evidence: Proposal contract validation, claim-grounding checks, shared resolution, placeholder navigation, export warnings and repository regression tests must remain green",
  ],
  notes: [
    "Capability claims and projected outcomes must remain distinguishable from evidence of results already achieved.",
    "Price and timeframe receive no automatic fallback because generic commercial terms could materially misrepresent the offer.",
    "The client problem appears in more than one section through a shared resolution key so the user should only need to establish the underlying fact once.",
  ],
} as const;

const PURCHASE_ORDER_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "order",
      requiredInformation: [
        {
          key: "buyer",
          label: "Buyer",
          factType: "company_name",
          placeholderLabel: "purchase order buyer",
          question: "Who is issuing the purchase order?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.buyer",
          neutralReplacementOptions: [],
        },
        {
          key: "supplier",
          label: "Supplier",
          factType: "company_name",
          placeholderLabel: "purchase order supplier",
          question: "Which supplier is receiving the purchase order?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.supplier",
          neutralReplacementOptions: [],
        },
        {
          key: "po_number",
          label: "PO number",
          factType: "identifier",
          placeholderLabel: "purchase order number",
          question: "What purchase order number should appear on the document?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.number",
          neutralReplacementOptions: [],
        },
        {
          key: "delivery_details",
          label: "Delivery details",
          factType: "other",
          placeholderLabel: "delivery details",
          question:
            "Where and when should the ordered goods or services be delivered?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.delivery",
          neutralReplacementOptions: [],
        },
        {
          key: "approval",
          label: "Approval",
          factType: "other",
          placeholderLabel: "purchase order approval status",
          question:
            "What is the current approval status of this purchase order?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.approval",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "budget code",
      ],
    },
    {
      sectionKey: "items",
      requiredInformation: [
        {
          key: "items_quantities_prices",
          label: "Items, quantities and agreed prices",
          factType: "amount",
          placeholderLabel: "ordered items, quantities and agreed prices",
          question:
            "What items are being ordered, in what quantities, and at what agreed prices?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.items",
          neutralReplacementOptions: [],
        },
        {
          key: "tax_treatment",
          label: "Tax treatment",
          factType: "other",
          placeholderLabel: "purchase order tax treatment",
          question: "How should tax be treated on this purchase order?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.tax_treatment",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "reconciled total",
      ],
    },
    {
      sectionKey: "terms",
      requiredInformation: [
        {
          key: "terms_and_order_status",
          label: "Terms and order status",
          factType: "other",
          placeholderLabel: "purchase order terms and status",
          question:
            "What terms apply, and is the order currently draft, approved, sent or in another confirmed status?",
          requiredForExport: true,
          sharedResolutionKey: "purchase_order.terms_status",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "revision history",
      ],
    },
  ],
};

const PURCHASE_ORDER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Purchase Order section captures buyer, supplier, PO number, delivery details, approval, items, quantities, agreed prices, tax treatment and explicit order status",
    "intake and context reuse: supplier quotes, approved requests, budget records and confirmed party information are reused before clarification",
    "generation resilience: complete Purchase Order structure remains available while unresolved commercial or approval facts remain explicit placeholders rather than being implied",
    "factual safety: supplier prices, quantities, approval states, delivery details and totals are never invented",
    "placeholder integrity: every unresolved Purchase Order fact has a contextual label, exact question and explicit export requirement",
    "resolution behaviour: shared buyer, supplier, pricing, tax and status facts update linked Purchase Order occurrences without changing unrelated items",
    "proofread behaviour: Purchase Order placeholders remain outside editorial findings while surrounding order wording remains reviewable for clarity and non-implication of acceptance",
    "workspace persistence: resolved Purchase Order terms, items and approval edits persist independently across sections",
    "issue navigation: unresolved Purchase Order party, identifier, delivery, approval, price and status facts remain independently selectable",
    "export behaviour: all core order facts remain required because generic substitutes could imply an order or approval that does not exist",
    "accessibility and recovery: every Purchase Order placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Purchase Order validation, quote-price consistency, line-total reconciliation and status-state tests must remain green",
  ],
  notes: [
    "Agreed prices should trace to the supplier quote or another confirmed source rather than being generated from typical market pricing.",
    "Draft, approved and sent states must remain explicit and must never be inferred from the mere existence of the document.",
    "The purchase order must not imply supplier acceptance unless acceptance has actually occurred.",
  ],
} as const;

const QUARTERLY_BUSINESS_REVIEW_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "summary",
        requiredInformation: [
          {
            key: "quarter",
            label: "Quarter",
            factType: "date_range",
            placeholderLabel: "quarter under review",
            question: "Which quarter or review period does this QBR cover?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.review_period",
            neutralReplacementOptions: [],
          },
          {
            key: "major_achievements",
            label: "Major achievements",
            factType: "achievement",
            placeholderLabel: "major achievements",
            question:
              "What confirmed achievements should be highlighted from this quarter?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.major_achievements",
            neutralReplacementOptions: [],
          },
          {
            key: "progress",
            label: "Progress",
            factType: "achievement",
            placeholderLabel: "progress made this quarter",
            question:
              "What meaningful progress was made against the quarter's priorities or plans?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.progress",
            neutralReplacementOptions: [],
          },
          {
            key: "challenge",
            label: "Key challenge",
            factType: "other",
            placeholderLabel: "key challenge",
            question:
              "What was the most important challenge or shortfall this quarter?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.challenge",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "strategic context",
          "customer impact",
          "key win quotation",
          "major-deliverable timeline",
          "stakeholder sentiment",
          "risk mitigation",
          "cost savings",
          "regulatory changes",
        ],
      },
      {
        sectionKey: "metrics",
        requiredInformation: [
          {
            key: "key_results",
            label: "Key results",
            factType: "amount",
            placeholderLabel: "key quarterly results",
            question:
              "Which confirmed KPI, sales, financial or operational results should be included?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.key_results",
            neutralReplacementOptions: [],
          },
          {
            key: "performance_interpretation",
            label: "Performance interpretation",
            factType: "other",
            placeholderLabel: "interpretation of the results",
            question:
              "What do those results genuinely show about where performance was strongest and where it fell short?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.performance_interpretation",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "targets",
          "variance analysis",
          "leading indicators",
          "business-unit breakdown",
          "peer comparison",
          "outlier explanation",
          "data quality assumptions",
          "sensitivity scenarios",
        ],
      },
      {
        sectionKey: "insights",
        requiredInformation: [
          {
            key: "lessons_or_patterns",
            label: "Lessons or patterns",
            factType: "other",
            placeholderLabel: "quarterly lessons or patterns",
            question:
              "What important lesson or pattern emerged from the quarter?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.lessons",
            neutralReplacementOptions: [],
          },
          {
            key: "win_and_miss_drivers",
            label: "Drivers of biggest win and miss",
            factType: "other",
            placeholderLabel: "drivers of the biggest win and miss",
            question:
              "What drove the quarter's biggest success and biggest miss?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.win_miss_drivers",
            neutralReplacementOptions: [],
          },
          {
            key: "change_for_next_quarter",
            label: "What changes next quarter",
            factType: "responsibility",
            placeholderLabel: "what will change next quarter",
            question:
              "What should be done differently next quarter because of these lessons?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.next_quarter_changes",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "root causes",
          "customer feedback",
          "decision implications",
          "competitive changes",
          "innovation opportunities",
          "cross-functional learnings",
          "leadership lessons",
          "future risk forecast",
        ],
      },
      {
        sectionKey: "priorities",
        requiredInformation: [
          {
            key: "priorities",
            label: "Next-quarter priorities",
            factType: "responsibility",
            placeholderLabel: "next-quarter priorities",
            question: "What are the specific priorities for the next quarter?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.next_priorities",
            neutralReplacementOptions: [],
          },
          {
            key: "owners",
            label: "Priority owners",
            factType: "person_name",
            placeholderLabel: "owner for each priority",
            question: "Who owns each next-quarter priority?",
            requiredForExport: true,
            sharedResolutionKey: "qbr.priority_owners",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "targets",
          "risks",
          "resource needs",
          "milestone dates",
          "linked KPIs",
          "dependencies",
          "communication plan",
          "contingency triggers",
          "success criteria",
        ],
      },
    ],
  };

const QUARTERLY_BUSINESS_REVIEW_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Quarterly Business Review section captures the quarter, achievements, progress, challenge, metrics, lessons and owner-specific next priorities",
    "intake and context reuse: KPI reports, sales data, staff metrics, prior QBRs and confirmed business context are reused before clarification",
    "generation resilience: Quarterly Business Review wording remains complete around unresolved facts through specific placeholders rather than generic statements that performance was good or bad",
    "factual safety: achievements, KPI figures, performance explanations and causes of wins or misses are never fabricated",
    "placeholder integrity: every unresolved Quarterly Business Review fact has a distinct contextual label, exact question and appropriate export requirement",
    "resolution behaviour: shared quarterly metrics, lessons and priorities update linked occurrences while unrelated user-approved analysis remains intact",
    "proofread behaviour: unresolved Quarterly Business Review labels are excluded while surrounding management prose remains reviewable for balance, specificity and unsupported certainty",
    "workspace persistence: resolved Quarterly Business Review values and edited insights persist independently across all sections",
    "issue navigation: unresolved Quarterly Business Review facts remain individually countable across summary, metrics, insights and priorities",
    "export behaviour: the review period, performance evidence, lessons, priorities and owners remain required because neutral wording cannot safely substitute for the actual quarter's performance",
    "accessibility and recovery: every Quarterly Business Review placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Quarterly Business Review validation, numerical grounding, shared-resolution and export-state tests must remain green",
  ],
  notes: [
    "A balanced QBR must include confirmed challenges as well as achievements rather than polishing away poor performance.",
    "Performance interpretation must be grounded in the underlying figures rather than generated from generic management language.",
    "Next-quarter priorities require real owners so TED does not output an action plan with unassigned accountability.",
  ],
} as const;

const QUOTE_ESTIMATE_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "parties",
      requiredInformation: [
        {
          key: "supplier_identity",
          label: "Supplier",
          factType: "company_name",
          placeholderLabel: "supplier identity",
          question: "Who is issuing the quote or estimate?",
          requiredForExport: true,
          sharedResolutionKey: "quote.supplier",
          neutralReplacementOptions: [],
        },
        {
          key: "customer_identity",
          label: "Customer",
          factType: "company_name",
          placeholderLabel: "customer identity",
          question: "Who is the quote or estimate being prepared for?",
          requiredForExport: true,
          sharedResolutionKey: "quote.customer",
          neutralReplacementOptions: [],
        },
        {
          key: "quote_number",
          label: "Quote number",
          factType: "identifier",
          placeholderLabel: "quote number",
          question:
            "What quote or estimate number should appear on the document?",
          requiredForExport: true,
          sharedResolutionKey: "quote.number",
          neutralReplacementOptions: [],
        },
        {
          key: "quote_date",
          label: "Quote date",
          factType: "date",
          placeholderLabel: "quote date",
          question: "What date should the quote or estimate be issued?",
          requiredForExport: true,
          sharedResolutionKey: "quote.date",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "supplier contact details",
        "customer contact details",
      ],
    },
    {
      sectionKey: "pricing",
      requiredInformation: [
        {
          key: "scope",
          label: "Scope",
          factType: "responsibility",
          placeholderLabel: "quoted scope",
          question:
            "What work, goods or services does this quote actually cover?",
          requiredForExport: true,
          sharedResolutionKey: "quote.scope",
          neutralReplacementOptions: [],
        },
        {
          key: "quantity_and_rate",
          label: "Quantity and rate",
          factType: "amount",
          placeholderLabel: "quantity and rate for each quoted item",
          question:
            "What quantity and rate or unit price applies to each quoted item?",
          requiredForExport: true,
          sharedResolutionKey: "quote.item_pricing",
          neutralReplacementOptions: [],
        },
        {
          key: "currency_and_tax_treatment",
          label: "Currency and tax treatment",
          factType: "other",
          placeholderLabel: "currency and tax treatment",
          question:
            "What currency is the quote in, and how should tax be treated?",
          requiredForExport: true,
          sharedResolutionKey: "quote.currency_tax",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "delivery timing",
      ],
    },
    {
      sectionKey: "terms",
      requiredInformation: [
        {
          key: "validity_period",
          label: "Validity period",
          factType: "date_range",
          placeholderLabel: "quote validity period",
          question: "How long is this quote or estimate valid for?",
          requiredForExport: true,
          sharedResolutionKey: "quote.validity",
          neutralReplacementOptions: [],
        },
        {
          key: "payment_terms",
          label: "Payment terms",
          factType: "other",
          placeholderLabel: "payment terms",
          question:
            "What payment terms apply if the customer accepts the quote?",
          requiredForExport: true,
          sharedResolutionKey: "quote.payment_terms",
          neutralReplacementOptions: [],
        },
        {
          key: "acceptance_method",
          label: "Acceptance method",
          factType: "other",
          placeholderLabel: "quote acceptance method",
          question: "How should the customer formally accept the quote?",
          requiredForExport: true,
          sharedResolutionKey: "quote.acceptance_method",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "variation process",
      ],
    },
  ],
};

const QUOTE_ESTIMATE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Quote / Estimate section captures supplier, customer, identifiers, scope, itemised pricing, currency, tax, validity, payment terms and acceptance method",
    "intake and context reuse: specifications, customer requests, prior pricing, rate cards and confirmed party details are reused before clarification",
    "generation resilience: complete Quote / Estimate wording remains available while unresolved commercial terms remain explicit placeholders rather than assumed defaults",
    "factual safety: quantities, rates, totals, tax treatment, validity periods and payment terms are never invented",
    "placeholder integrity: every unresolved Quote / Estimate fact has a contextual label, exact question and explicit export requirement",
    "resolution behaviour: shared supplier, customer, pricing, tax and terms facts update linked Quote / Estimate occurrences without modifying unrelated line items",
    "proofread behaviour: Quote / Estimate placeholders remain outside editorial findings while surrounding commercial wording remains reviewable for clarity and consistency",
    "workspace persistence: resolved Quote / Estimate terms and pricing edits persist independently across sections",
    "issue navigation: unresolved Quote / Estimate party, pricing, tax, validity and acceptance facts remain independently countable and selectable",
    "export behaviour: all commercial and identifying facts remain required because generic substitutes could materially alter the offer",
    "accessibility and recovery: every Quote / Estimate placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Quote / Estimate validation, item-total reconciliation, tax consistency and export-state tests must remain green",
  ],
  notes: [
    "Quoted totals must reconcile from the itemised quantities and rates rather than being independently invented.",
    "Tax treatment must remain consistent across every line and total.",
    "Validity and payment terms must be explicit because TED cannot safely assume standard commercial terms on behalf of the supplier.",
  ],
} as const;

const RECRUITER_INTRODUCTION_EMAIL_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "subject",
        requiredInformation: [
          {
            key: "role_type",
            label: "Role type",
            factType: "role_title",
            placeholderLabel: "target role type",
            question: "What type of role should the subject line identify?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.target_role",
            neutralReplacementOptions: [],
          },
          {
            key: "opportunity_interest",
            label: "Opportunity interest",
            factType: "other",
            placeholderLabel: "type of opportunity sought",
            question:
              "Are you interested in a specific vacancy or introducing yourself for suitable future opportunities?",
            requiredForExport: true,
            sharedResolutionKey: "recruiter.opportunity_interest",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "location",
          "seniority",
          "contract or permanent preference",
          "niche skill",
          "company name",
          "referral source",
        ],
      },
      {
        sectionKey: "summary",
        requiredInformation: [
          {
            key: "candidate_role",
            label: "Candidate role",
            factType: "role_title",
            placeholderLabel: "your current professional role",
            question:
              "What is your current or most relevant professional role?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.current_role",
            neutralReplacementOptions: [],
          },
          {
            key: "experience_area",
            label: "Experience area",
            factType: "other",
            placeholderLabel: "your experience area",
            question:
              "What field or type of work best describes your relevant experience?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.experience_area",
            neutralReplacementOptions: [],
          },
          {
            key: "target_opportunity",
            label: "Target opportunity",
            factType: "role_title",
            placeholderLabel: "target opportunity",
            question:
              "What role, field or opportunity are you hoping the recruiter can help you explore?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.target_role",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "years of experience",
          "industry",
          "availability",
          "work rights",
          "certifications",
          "geographic mobility",
          "professional affiliations",
        ],
      },
      {
        sectionKey: "fit",
        requiredInformation: [
          {
            key: "relevant_achievements",
            label: "Relevant achievements",
            factType: "achievement",
            placeholderLabel: "relevant achievements",
            question:
              "Which confirmed achievements best show your fit for the kind of role you're targeting?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.relevant_achievements",
            neutralReplacementOptions: [],
          },
          {
            key: "relevant_skills",
            label: "Relevant skills",
            factType: "skill",
            placeholderLabel: "relevant skills",
            question:
              "Which confirmed skills are most relevant to the opportunities you're seeking?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.role_skills",
            neutralReplacementOptions: [],
          },
          {
            key: "preferred_responsibilities",
            label: "Preferred responsibilities",
            factType: "responsibility",
            placeholderLabel: "responsibilities you want",
            question:
              "What kind of responsibilities do you want in your next role?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.preferred_responsibilities",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "metrics",
          "tools",
          "certifications",
          "salary range",
          "target sectors",
          "leadership scope",
          "cross-functional examples",
        ],
      },
      {
        sectionKey: "close",
        requiredInformation: [
          {
            key: "resume_mention",
            label: "Resume mention",
            factType: "reference",
            placeholderLabel: "resume attachment",
            question: "Will you be attaching or linking your resume?",
            requiredForExport: false,
            sharedResolutionKey: "candidate.resume_available",
            neutralReplacementOptions: [
              {
                id: "no-resume-reference",
                label: "Don't mention an attachment",
                value: "close the email without claiming a resume is attached",
                suitability: "Use when no resume will accompany the email.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
          {
            key: "invitation_to_discuss",
            label: "Invitation to discuss fit",
            factType: "event",
            placeholderLabel: "specific next-step request",
            question:
              "What specific next step would you like to ask the recruiter for?",
            requiredForExport: true,
            sharedResolutionKey: "recruiter.next_step",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "portfolio link",
          "availability windows",
          "phone number",
          "LinkedIn profile",
          "professional signature",
          "follow-up timeframe",
          "mutual connection",
        ],
      },
    ],
  };

const RECRUITER_INTRODUCTION_EMAIL_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Recruiter Introduction Email section captures target role, opportunity interest, candidate background, evidence of fit, preferred responsibilities and a concrete next step",
    "intake and context reuse: resume content, LinkedIn information, vacancy details and confirmed career history are reused before clarification",
    "generation resilience: complete Recruiter Introduction Email wording remains available even when no resume attachment is supplied through a declared neutral omission path",
    "factual safety: vacancies, referrals, recruiter relationships, candidate achievements, experience and skills are never invented",
    "placeholder integrity: each unresolved Recruiter Introduction Email fact receives a contextual label, exact user question and explicit export policy",
    "resolution behaviour: shared candidate role, target role and evidence facts resolve linked occurrences while recruiter-specific requests remain isolated",
    "proofread behaviour: placeholder labels are excluded while surrounding Recruiter Introduction Email prose remains reviewable for concision and professional tone",
    "workspace persistence: candidate edits and resolved Recruiter Introduction Email values persist without resetting unrelated sections",
    "issue navigation: missing Recruiter Introduction Email facts remain independently countable across subject, profile, fit and close",
    "export behaviour: role targeting, evidence and next-step facts remain required while an absent resume can be written around safely",
    "accessibility and recovery: each Recruiter Introduction Email placeholder has a meaningful label and plain-language question and remains visible if malformed",
    "regression and release evidence: Recruiter Introduction Email validation, resume-grounding, neutral omission and shared-resolution tests must remain green",
  ],
  notes: [
    "A specific vacancy, referral or recruiter relationship must never be implied unless supplied.",
    "Candidate claims must remain consistent with the resume and other confirmed profile information.",
    "The resume reference is safely optional because TED can regenerate the close without claiming an attachment exists.",
  ],
} as const;

const RESEARCH_PROPOSAL_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "title_question",
      requiredInformation: [
        {
          key: "working_title",
          label: "Working title",
          factType: "other",
          placeholderLabel: "research working title",
          question: "What working title best describes the proposed research?",
          requiredForExport: true,
          sharedResolutionKey: "research.working_title",
          neutralReplacementOptions: [],
        },
        {
          key: "research_question",
          label: "Research question",
          factType: "other",
          placeholderLabel: "central research question",
          question:
            "What specific central question will the research try to answer?",
          requiredForExport: true,
          sharedResolutionKey: "research.central_question",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "sub-questions",
        "hypothesis",
        "scope limits",
        "keywords",
        "study boundaries",
        "title refinement",
      ],
    },
    {
      sectionKey: "background",
      requiredInformation: [
        {
          key: "topic_context",
          label: "Topic context",
          factType: "reference",
          placeholderLabel: "research topic context",
          question:
            "What established context does the reader need to understand this research topic?",
          requiredForExport: true,
          sharedResolutionKey: "research.topic_context",
          neutralReplacementOptions: [],
        },
        {
          key: "problem",
          label: "Research problem",
          factType: "other",
          placeholderLabel: "research problem",
          question:
            "What specific problem or unresolved issue is the research responding to?",
          requiredForExport: true,
          sharedResolutionKey: "research.problem",
          neutralReplacementOptions: [],
        },
        {
          key: "research_gap",
          label: "Research gap",
          factType: "reference",
          placeholderLabel: "gap in existing research",
          question:
            "What gap in the existing literature or evidence does the proposal identify?",
          requiredForExport: true,
          sharedResolutionKey: "research.gap",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "key literature",
        "policy relevance",
        "social relevance",
        "historical background",
        "theoretical foundations",
        "stakeholder perspectives",
        "comparative cases",
      ],
    },
    {
      sectionKey: "methodology",
      requiredInformation: [
        {
          key: "method",
          label: "Research method",
          factType: "other",
          placeholderLabel: "research method",
          question: "What research method will you use?",
          requiredForExport: true,
          sharedResolutionKey: "research.method",
          neutralReplacementOptions: [],
        },
        {
          key: "data_source_or_participants",
          label: "Data source or participants",
          factType: "other",
          placeholderLabel: "data source or participant group",
          question:
            "What data, source material or participant group will the research use?",
          requiredForExport: true,
          sharedResolutionKey: "research.data_participants",
          neutralReplacementOptions: [],
        },
        {
          key: "analysis_approach",
          label: "Analysis approach",
          factType: "other",
          placeholderLabel: "analysis approach",
          question:
            "How will the collected data or source material be analysed?",
          requiredForExport: true,
          sharedResolutionKey: "research.analysis_approach",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "ethics",
        "sampling",
        "limitations",
        "timeline",
        "feasibility",
        "data-quality checks",
        "instrument validation",
        "pilot study",
        "analysis software",
        "alternative methods",
      ],
    },
    {
      sectionKey: "contribution",
      requiredInformation: [
        {
          key: "research_value",
          label: "Expected research value",
          factType: "achievement",
          placeholderLabel: "expected academic or practical value",
          question:
            "What academic or practical value is the research expected to contribute?",
          requiredForExport: true,
          sharedResolutionKey: "research.expected_value",
          neutralReplacementOptions: [],
        },
        {
          key: "knowledge_gap_addressed",
          label: "Knowledge gap addressed",
          factType: "other",
          placeholderLabel: "knowledge gap the research addresses",
          question:
            "Which specific gap in existing knowledge would the findings help address?",
          requiredForExport: true,
          sharedResolutionKey: "research.gap",
          neutralReplacementOptions: [],
        },
        {
          key: "beneficiaries",
          label: "Beneficiaries",
          factType: "other",
          placeholderLabel: "who benefits from the findings",
          question: "Who could benefit from the findings, and how?",
          requiredForExport: true,
          sharedResolutionKey: "research.beneficiaries",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "dissemination plan",
        "institution priorities",
        "impact assessment",
        "knowledge translation",
        "practical applications",
        "theoretical contribution",
        "policy implications",
        "future research",
      ],
    },
  ],
};

const RESEARCH_PROPOSAL_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Research Proposal section captures a focused research question, evidence-based rationale, methodology, data source, analysis approach and expected contribution",
    "intake and context reuse: reading lists, source literature, prior research notes and confirmed academic context are reused before clarification",
    "generation resilience: complete Research Proposal structure remains available while unsupported gaps, methods or source claims remain explicit placeholders",
    "factual safety: literature findings, research gaps, cited evidence, data sources and expected contributions are never fabricated",
    "placeholder integrity: every unresolved Research Proposal fact has a contextual label, exact question and export requirement",
    "resolution behaviour: research question, gap, method and contribution facts update linked Research Proposal occurrences without rewriting unrelated scholarly analysis",
    "proofread behaviour: Research Proposal placeholders are excluded from editorial findings while surrounding academic prose remains reviewable for precision and coherence",
    "workspace persistence: resolved Research Proposal facts and edited academic wording persist independently across all sections",
    "issue navigation: unresolved Research Proposal question, gap, method, evidence and contribution facts remain independently countable",
    "export behaviour: the research question, evidence-based gap, methodology and contribution remain required because generic substitutes could materially misrepresent the proposed research",
    "accessibility and recovery: every Research Proposal placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Research Proposal validation, literature grounding, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "A research gap must be supported by actual literature rather than generated merely because a proposal conventionally needs one.",
    "Methodology must be concrete enough for feasibility to be evaluated and cannot be chosen silently on the applicant's behalf.",
    "Expected contribution must remain framed as anticipated value rather than a result already demonstrated.",
  ],
} as const;

const RESIGNATION_LETTER_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "notice",
      requiredInformation: [
        {
          key: "resignation_statement",
          label: "Resignation statement",
          factType: "other",
          placeholderLabel: "resignation statement",
          question:
            "Are you resigning from your current employment and ready for the letter to state that clearly?",
          automaticFallback:
            "a clear, professional statement that the employee is resigning from their position",
          requiredForExport: false,
          sharedResolutionKey: "resignation.intent",
          neutralReplacementOptions: [],
        },
        {
          key: "role",
          label: "Role",
          factType: "role_title",
          placeholderLabel: "your role",
          question: "What role are you resigning from?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.current_role",
          neutralReplacementOptions: [],
        },
        {
          key: "company",
          label: "Employer",
          factType: "company_name",
          placeholderLabel: "employer name",
          question: "Which employer are you resigning from?",
          requiredForExport: true,
          sharedResolutionKey: "employment.current_employer",
          neutralReplacementOptions: [],
        },
        {
          key: "final_working_day",
          label: "Final working day",
          factType: "date",
          placeholderLabel: "final working day",
          question: "What is your proposed final working day?",
          requiredForExport: true,
          sharedResolutionKey: "resignation.final_working_day",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "notice period",
        "contract reference",
        "letter date",
        "resignation-policy reference",
        "follow-up contact method",
        "post-employment confidentiality obligations",
      ],
    },
    {
      sectionKey: "appreciation",
      requiredInformation: [
        {
          key: "thanks_or_acknowledgement",
          label: "Appreciation",
          factType: "other",
          placeholderLabel: "brief acknowledgement",
          question:
            "Is there anything genuine you'd like to thank the employer or team for?",
          requiredForExport: false,
          sharedResolutionKey: "resignation.appreciation",
          neutralReplacementOptions: [
            {
              id: "simple-thanks",
              label: "Simple thanks",
              value:
                "Thank you for the opportunities and experience I have gained during my time with the organisation.",
              suitability:
                "Use when the user wants a courteous acknowledgement without naming a specific experience or relationship.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "specific opportunity",
        "manager support",
        "professional growth",
        "memorable project",
        "team acknowledgement",
        "mentoring",
        "forward-looking goodwill",
      ],
    },
    {
      sectionKey: "handover",
      requiredInformation: [
        {
          key: "handover_offer",
          label: "Handover offer",
          factType: "responsibility",
          placeholderLabel: "handover offer",
          question:
            "What level of handover support are you willing to provide during your notice period?",
          requiredForExport: false,
          sharedResolutionKey: "resignation.handover_offer",
          neutralReplacementOptions: [
            {
              id: "standard-handover",
              label: "Standard handover",
              value:
                "I will support an orderly handover of my responsibilities during my remaining time.",
              suitability:
                "Use when the user wants to offer reasonable transition support without committing to specific tasks that have not been identified.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "handover_responsibilities",
          label: "Responsibilities requiring handover",
          factType: "responsibility",
          placeholderLabel: "responsibilities or projects to hand over",
          question:
            "Which key responsibilities or projects need to be handed over before you leave?",
          requiredForExport: false,
          sharedResolutionKey: "resignation.handover_items",
          neutralReplacementOptions: [
            {
              id: "no-specific-items",
              label: "No specific items listed",
              value:
                "refer generally to an orderly handover without naming unconfirmed projects or responsibilities",
              suitability:
                "Use when the user wants to offer transition support but does not need to list individual handover items in the letter.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "training_or_documentation",
          label: "Training or documentation support",
          factType: "responsibility",
          placeholderLabel: "training or documentation support",
          question:
            "Are you willing to prepare documentation or help train someone during the notice period?",
          requiredForExport: false,
          sharedResolutionKey: "resignation.transition_support",
          neutralReplacementOptions: [
            {
              id: "general-transition-support",
              label: "General transition support",
              value:
                "offer reasonable assistance with the transition without promising specific training or documentation",
              suitability:
                "Use when the user is willing to assist but has not committed to a particular handover method.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "named tasks",
        "handover timeline",
        "documentation plan",
        "knowledge-transfer meetings",
        "pending approvals",
        "successor support",
        "key transition dates",
      ],
    },
    {
      sectionKey: "close",
      requiredInformation: [
        {
          key: "professional_closing",
          label: "Professional closing",
          factType: "other",
          placeholderLabel: "professional closing",
          question: "How would you like the letter to close?",
          automaticFallback: "Kind regards",
          requiredForExport: false,
          sharedResolutionKey: "resignation.closing",
          neutralReplacementOptions: [
            {
              id: "kind-regards",
              label: "Kind regards",
              value: "Kind regards",
              suitability:
                "Use when the user has no specific sign-off preference and a neutral professional closing is appropriate.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
        {
          key: "goodwill",
          label: "Goodwill statement",
          factType: "other",
          placeholderLabel: "goodwill statement",
          question:
            "Would you like to include a brief positive wish for the organisation or team?",
          requiredForExport: false,
          sharedResolutionKey: "resignation.goodwill",
          neutralReplacementOptions: [
            {
              id: "simple-goodwill",
              label: "Simple goodwill",
              value: "I wish the team and organisation continued success.",
              suitability:
                "Use when a courteous future-facing close is appropriate and no more personal wording is needed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "personal contact details",
        "stay-in-touch invitation",
        "personal email",
        "printed name",
        "signature",
      ],
    },
  ],
};

const RESIGNATION_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Resignation Letter section captures the resignation, role, employer, final working day, appropriate appreciation, handover support and professional close",
    "intake and context reuse: employment details, uploaded contract terms and previously supplied notice information are reused before the Resignation Letter asks for clarification",
    "generation resilience: the Resignation Letter remains complete when optional appreciation, transition detail or closing preferences are unresolved through declared neutral wording and safe defaults",
    "factual safety: role, employer, final working day, notice-related details and specific handover commitments in the Resignation Letter are never invented",
    "placeholder integrity: each unresolved Resignation Letter fact has a contextual label, direct conversational question, explicit replacement policy and appropriate shared-resolution behaviour",
    "resolution behaviour: employment identity and resignation facts update linked Resignation Letter occurrences without altering unrelated appreciation or handover wording",
    "proofread behaviour: unresolved Resignation Letter placeholders remain outside editorial findings while surrounding prose remains reviewable for professionalism, clarity and unnecessary grievance language",
    "workspace persistence: Resignation Letter edits, resolved employment facts and chosen neutral replacements persist without later resolutions overwriting unrelated sections",
    "issue navigation: unresolved Resignation Letter role, employer, final-day and transition facts remain independently selectable and answerable",
    "export behaviour: role, employer and final working day remain required for export while appreciation, handover detail and closing preferences have safe declared alternatives",
    "accessibility and recovery: every Resignation Letter placeholder exposes a meaningful label and exact question and malformed placeholder tokens remain visible",
    "regression and release evidence: Resignation Letter validation, fallback behaviour, notice-date handling, placeholder resolution and export-state tests must remain green",
  ],
  notes: [
    "The final working day receives no fallback because TED must never calculate or assume a contractual notice period without reliable source information.",
    "Transition support defaults are deliberately limited to reasonable assistance and never promise a specific task, training session or document the user has not agreed to provide.",
    "Appreciation and goodwill can use neutral professional wording because those statements do not invent a factual employment event.",
  ],
} as const;

const RISK_ASSESSMENT_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "context",
      requiredInformation: [
        {
          key: "activity_project_process",
          label: "Activity, project or process",
          factType: "other",
          placeholderLabel: "activity, project or process being assessed",
          question:
            "What specific activity, project or process is this risk assessment about?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.subject",
          neutralReplacementOptions: [],
        },
        {
          key: "team_or_location",
          label: "Team or location",
          factType: "location",
          placeholderLabel: "team or location",
          question:
            "Which team, workplace or location does the assessment apply to?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.team_location",
          neutralReplacementOptions: [],
        },
        {
          key: "period",
          label: "Assessment period",
          factType: "date_range",
          placeholderLabel: "assessment period",
          question: "What period does this assessment cover?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.period",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "scope exclusions",
        "assumptions",
        "assessment owner",
        "regulatory framework",
        "linked KPIs",
        "stakeholders",
        "supplier dependencies",
      ],
    },
    {
      sectionKey: "risks",
      requiredInformation: [
        {
          key: "risks",
          label: "Identified risks",
          factType: "other",
          placeholderLabel: "identified risks",
          question:
            "What specific risks have actually been identified for this activity or context?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.identified_risks",
          neutralReplacementOptions: [],
        },
        {
          key: "potential_impacts",
          label: "Potential impacts",
          factType: "other",
          placeholderLabel: "potential impact of each risk",
          question:
            "What could each identified risk affect — for example people, cost, time, compliance or quality?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.potential_impacts",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "causes",
        "affected stakeholders",
        "risk categories",
        "known incidents",
        "regulatory penalties",
        "mitigation cost",
        "trend evidence",
        "scenario analysis",
      ],
    },
    {
      sectionKey: "rating",
      requiredInformation: [
        {
          key: "likelihood",
          label: "Likelihood",
          factType: "other",
          placeholderLabel: "risk likelihood",
          question:
            "What likelihood rating applies to each risk based on the available evidence?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.likelihood",
          neutralReplacementOptions: [],
        },
        {
          key: "consequence",
          label: "Consequence",
          factType: "other",
          placeholderLabel: "risk consequence",
          question: "What consequence rating applies to each risk?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.consequence",
          neutralReplacementOptions: [],
        },
        {
          key: "overall_rating",
          label: "Overall risk rating",
          factType: "other",
          placeholderLabel: "overall risk rating",
          question:
            "What overall rating results from the chosen likelihood and consequence method?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.overall_rating",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "rating matrix",
        "residual risk",
        "risk appetite",
        "confidence level",
        "risk tolerance",
        "scoring method",
        "uncertainty range",
        "historical comparison",
      ],
    },
    {
      sectionKey: "controls",
      requiredInformation: [
        {
          key: "current_controls",
          label: "Current controls",
          factType: "responsibility",
          placeholderLabel: "current risk controls",
          question: "What controls are already in place for each risk?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.current_controls",
          neutralReplacementOptions: [],
        },
        {
          key: "required_actions",
          label: "Required actions",
          factType: "responsibility",
          placeholderLabel: "additional risk actions",
          question:
            "What additional actions are required to reduce or manage the remaining risk?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.required_actions",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "control owner",
        "due date",
        "effectiveness rating",
        "implementation evidence",
        "testing results",
        "control frequency",
        "training requirements",
        "escalation pathway",
      ],
    },
    {
      sectionKey: "review",
      requiredInformation: [
        {
          key: "review_date_or_trigger",
          label: "Review date or trigger",
          factType: "event",
          placeholderLabel: "review date or trigger",
          question:
            "When should this risk assessment be reviewed again, or what event should trigger a review sooner?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.review_trigger",
          neutralReplacementOptions: [],
        },
        {
          key: "review_owner",
          label: "Review owner",
          factType: "person_name",
          placeholderLabel: "person responsible for review",
          question:
            "Who is responsible for reviewing and updating this assessment?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.review_owner",
          neutralReplacementOptions: [],
        },
        {
          key: "early_review_events",
          label: "Early-review events",
          factType: "event",
          placeholderLabel: "events requiring early review",
          question:
            "Which events should trigger an early review, such as an incident, process change or new equipment?",
          requiredForExport: true,
          sharedResolutionKey: "risk_assessment.early_review_events",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "monitoring cadence",
        "version history",
        "approval record",
        "review method",
        "stakeholder sign-off",
        "document retention",
        "audit trail",
        "future improvements",
      ],
    },
  ],
};

const RISK_ASSESSMENT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Risk Assessment section captures the activity context, identified risks, impacts, ratings, current controls, required actions and future review responsibility",
    "intake and context reuse: incident reports, audits, insurance records, operating procedures and compliance material are reused before clarification",
    "generation resilience: complete Risk Assessment structure remains available while unresolved factual risks, ratings and controls remain visible as declared placeholders rather than guessed values",
    "factual safety: incidents, hazards, likelihood ratings, consequences and control effectiveness are never invented",
    "placeholder integrity: every unresolved Risk Assessment fact has an independent label, exact question and export rule tied to the actual assessment section",
    "resolution behaviour: risk context, ratings, controls and review data update only their linked Risk Assessment occurrences without collapsing independent risks",
    "proofread behaviour: declared Risk Assessment placeholder labels remain outside editorial findings while surrounding safety prose remains reviewable for clarity and internal consistency",
    "workspace persistence: edited risks, ratings, controls and review information persist without unrelated sections being regenerated",
    "issue navigation: unresolved Risk Assessment facts remain independently countable and selectable by assessment area",
    "export behaviour: context, identified risks, ratings, controls and review obligations remain required because generic safety assumptions could create a misleading assessment",
    "accessibility and recovery: every Risk Assessment placeholder exposes a meaningful label and conversational question and malformed tokens remain visible",
    "regression and release evidence: Risk Assessment validation, rating consistency, placeholder resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "Likelihood and consequence ratings must reflect the user's actual assessment method and evidence rather than defaulting every unknown risk to a generic rating.",
    "Known incidents may inform the assessment only when supported by source material; TED must never invent incident history.",
    "This contract supports document completeness but does not replace professional WHS, safety or specialist risk advice where required.",
  ],
} as const;

const SCHOLARSHIP_APPLICATION_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "profile",
        requiredInformation: [
          {
            key: "applicant_identity",
            label: "Applicant identity",
            factType: "person_name",
            placeholderLabel: "applicant name",
            question:
              "What full name should appear on the scholarship application?",
            requiredForExport: true,
            sharedResolutionKey: "candidate.full_name",
            neutralReplacementOptions: [],
          },
          {
            key: "scholarship_name",
            label: "Scholarship name",
            factType: "other",
            placeholderLabel: "scholarship name",
            question: "Which scholarship or bursary are you applying for?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.name",
            neutralReplacementOptions: [],
          },
          {
            key: "study_field",
            label: "Study field",
            factType: "other",
            placeholderLabel: "field of study",
            question:
              "What field or course are you studying or planning to study?",
            requiredForExport: true,
            sharedResolutionKey: "education.study_field",
            neutralReplacementOptions: [],
          },
          {
            key: "institution",
            label: "Institution",
            factType: "institution",
            placeholderLabel: "education institution",
            question:
              "Which university, school, TAFE or other institution is this study connected to?",
            requiredForExport: true,
            sharedResolutionKey: "education.institution",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "current year level",
          "background",
          "community",
          "eligibility category",
          "career objective",
          "relevant coursework",
          "professional references",
          "scholarship mission alignment",
        ],
      },
      {
        sectionKey: "case",
        requiredInformation: [
          {
            key: "need_or_merit_basis",
            label: "Need or merit basis",
            factType: "other",
            placeholderLabel: "basis for scholarship support",
            question:
              "Is your case mainly based on financial need, merit, or another eligibility basis — and what specifically supports that?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.need_or_merit_basis",
            neutralReplacementOptions: [],
          },
          {
            key: "supporting_circumstances",
            label: "Supporting circumstances",
            factType: "other",
            placeholderLabel: "circumstances supporting your application",
            question:
              "What specific circumstances support your case for receiving the scholarship?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.supporting_circumstances",
            neutralReplacementOptions: [],
          },
          {
            key: "scholarship_enablement",
            label: "What the scholarship enables",
            factType: "achievement",
            placeholderLabel: "what the scholarship would enable",
            question:
              "What would receiving this scholarship concretely allow you to do that would otherwise be difficult or impossible?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.enablement",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "specific costs",
          "barriers",
          "academic results",
          "leadership",
          "personal context",
          "timeline for funded activities",
          "scholarship-values alignment",
        ],
      },
      {
        sectionKey: "evidence",
        requiredInformation: [
          {
            key: "achievements",
            label: "Relevant achievements",
            factType: "achievement",
            placeholderLabel: "relevant achievements",
            question:
              "Which genuine achievements best support your scholarship application?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.achievements",
            neutralReplacementOptions: [],
          },
          {
            key: "achievement_context",
            label: "Achievement context",
            factType: "achievement",
            placeholderLabel: "context for your achievements",
            question:
              "What context shows the scale, competitiveness or significance of at least two of those achievements?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.achievement_context",
            neutralReplacementOptions: [],
          },
          {
            key: "achievement_alignment",
            label: "Alignment with scholarship purpose",
            factType: "other",
            placeholderLabel:
              "how your achievements align with the scholarship",
            question:
              "How do those achievements connect to what this scholarship is intended to support?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.achievement_alignment",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "metrics",
          "awards",
          "community service",
          "adversity overcome",
          "referee support",
          "peer comparison",
          "sustained commitment",
          "publications",
        ],
      },
      {
        sectionKey: "impact",
        requiredInformation: [
          {
            key: "scholarship_help",
            label: "How the scholarship will help",
            factType: "other",
            placeholderLabel: "how the scholarship will help",
            question: "How would receiving the scholarship directly help you?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.direct_impact",
            neutralReplacementOptions: [],
          },
          {
            key: "enabled_outcome",
            label: "Enabled outcome",
            factType: "achievement",
            placeholderLabel: "outcome enabled by the scholarship",
            question:
              "What specific outcome would the scholarship help you achieve?",
            requiredForExport: true,
            sharedResolutionKey: "scholarship.enabled_outcome",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "community benefit",
          "long-term goals",
          "accountability commitments",
          "milestones",
          "knowledge sharing",
          "mentoring",
          "social impact",
          "stakeholder engagement",
        ],
      },
    ],
  };

const SCHOLARSHIP_APPLICATION_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Scholarship Application section captures the applicant, scholarship, study context, genuine basis for support, evidence of merit and the concrete impact funding would enable",
    "intake and context reuse: academic results, awards, resume information, scholarship criteria and previously confirmed education facts are reused before clarification",
    "generation resilience: complete Scholarship Application wording remains available around unresolved facts through declared placeholders rather than invented hardship, merit or eligibility claims",
    "factual safety: eligibility, financial circumstances, academic results, awards, achievements and intended impact are never fabricated or exaggerated",
    "placeholder integrity: every unresolved Scholarship Application fact is represented by a specific label, exact user question, export rule and shared-resolution key where appropriate",
    "resolution behaviour: applicant, scholarship, education and achievement facts update linked Scholarship Application occurrences without overwriting unrelated personal wording",
    "proofread behaviour: Scholarship Application placeholder labels are excluded from editorial findings while surrounding first-person persuasive prose remains reviewable",
    "workspace persistence: resolved Scholarship Application facts and edited personal wording persist independently across profile, need, evidence and impact sections",
    "issue navigation: unresolved Scholarship Application identity, eligibility, evidence and impact facts remain independently selectable and answerable",
    "export behaviour: scholarship identity, eligibility basis, supporting evidence and intended impact remain required because neutral substitutes could misrepresent the applicant's circumstances",
    "accessibility and recovery: every Scholarship Application placeholder exposes a meaningful label and direct clarification question and malformed tokens remain visible",
    "regression and release evidence: Scholarship Application validation, first-person factual grounding, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "Financial hardship, merit and eligibility claims must come from the applicant's actual circumstances and scholarship criteria.",
    "Achievements must remain tied to real evidence and cannot be embellished merely to make the application more competitive.",
    "Future impact should be written as an intended or enabled outcome, not as a result that has already occurred.",
  ],
} as const;

const SCOPE_OF_WORK_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "overview",
      requiredInformation: [
        {
          key: "project_outcome",
          label: "Project outcome",
          factType: "achievement",
          placeholderLabel: "project outcome",
          question:
            "What specific outcome is this scope of work meant to deliver?",
          requiredForExport: true,
          sharedResolutionKey: "scope.project_outcome",
          neutralReplacementOptions: [],
        },
        {
          key: "client_or_team",
          label: "Client or team",
          factType: "company_name",
          placeholderLabel: "client or team",
          question: "Who is the work being delivered for?",
          requiredForExport: true,
          sharedResolutionKey: "scope.client",
          neutralReplacementOptions: [],
        },
        {
          key: "timeframe",
          label: "Project timeframe",
          factType: "date_range",
          placeholderLabel: "project timeframe",
          question: "What timeframe applies to this work?",
          requiredForExport: true,
          sharedResolutionKey: "scope.timeframe",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "background",
        "business objective",
        "sponsor",
        "success definition",
        "stakeholders",
        "communication cadence",
      ],
    },
    {
      sectionKey: "in_scope",
      requiredInformation: [
        {
          key: "included_deliverables_or_services",
          label: "Included work",
          factType: "responsibility",
          placeholderLabel: "included deliverables or services",
          question:
            "What work, services or deliverables are explicitly included?",
          requiredForExport: true,
          sharedResolutionKey: "scope.in_scope_work",
          neutralReplacementOptions: [],
        },
        {
          key: "verifiable_deliverables",
          label: "Verifiable deliverables",
          factType: "responsibility",
          placeholderLabel: "verifiable deliverable descriptions",
          question:
            "How should each deliverable be described so everyone can tell when it has actually been completed?",
          requiredForExport: true,
          sharedResolutionKey: "scope.deliverable_definition",
          neutralReplacementOptions: [],
        },
        {
          key: "quantities_formats_frequencies",
          label: "Quantities, formats or frequencies",
          factType: "other",
          placeholderLabel: "quantity, format or frequency",
          question:
            "Are there required quantities, formats or service frequencies that need to be stated?",
          requiredForExport: false,
          sharedResolutionKey: "scope.delivery_parameters",
          neutralReplacementOptions: [
            {
              id: "not-applicable",
              label: "Not applicable",
              value:
                "describe the confirmed deliverables without adding quantities, formats or frequencies that do not apply",
              suitability:
                "Use when the deliverable does not require a meaningful quantity, format or recurring frequency.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "phase breakdown",
        "acceptance standards",
        "dependencies",
        "task sequencing",
        "service levels",
        "tools",
        "roles and responsibilities",
        "milestone dates",
      ],
    },
    {
      sectionKey: "out_of_scope",
      requiredInformation: [
        {
          key: "clear_exclusions",
          label: "Clear exclusions",
          factType: "responsibility",
          placeholderLabel: "explicit exclusions",
          question: "What work is explicitly excluded from this scope?",
          requiredForExport: true,
          sharedResolutionKey: "scope.exclusions",
          neutralReplacementOptions: [],
        },
        {
          key: "misunderstanding_exclusions",
          label: "Likely misunderstanding areas",
          factType: "other",
          placeholderLabel: "likely scope misunderstandings",
          question:
            "What commonly expected items should be called out as excluded so the client does not assume they're included?",
          requiredForExport: true,
          sharedResolutionKey: "scope.exclusion_risks",
          neutralReplacementOptions: [],
        },
        {
          key: "variation_process",
          label: "Variation process",
          factType: "responsibility",
          placeholderLabel: "process for extra work",
          question:
            "What should happen if the client requests work outside this scope?",
          requiredForExport: true,
          sharedResolutionKey: "scope.variation_process",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "common extras",
        "change-request pathway",
        "pricing trigger",
        "client sign-off",
        "cost implications",
        "scope-change communication",
      ],
    },
    {
      sectionKey: "acceptance",
      requiredInformation: [
        {
          key: "deliverables",
          label: "Deliverables",
          factType: "responsibility",
          placeholderLabel: "deliverables requiring acceptance",
          question: "Which deliverables need formal review or acceptance?",
          requiredForExport: true,
          sharedResolutionKey: "scope.deliverables",
          neutralReplacementOptions: [],
        },
        {
          key: "approval_criteria",
          label: "Approval criteria",
          factType: "other",
          placeholderLabel: "acceptance criteria",
          question:
            "What criteria will determine whether each deliverable is accepted?",
          requiredForExport: true,
          sharedResolutionKey: "scope.acceptance_criteria",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "reviewer names",
        "revision limits",
        "sign-off process",
        "quality standards",
        "acceptance checklist",
        "approval hierarchy",
        "version control",
        "post-acceptance support",
      ],
    },
    {
      sectionKey: "assumptions",
      requiredInformation: [
        {
          key: "critical_assumptions",
          label: "Critical assumptions or dependencies",
          factType: "other",
          placeholderLabel: "critical project assumptions",
          question:
            "What assumptions or dependencies must remain true for this scope to work as written?",
          requiredForExport: true,
          sharedResolutionKey: "scope.assumptions",
          neutralReplacementOptions: [],
        },
        {
          key: "client_inputs",
          label: "Client inputs",
          factType: "responsibility",
          placeholderLabel: "what the client must provide",
          question:
            "What must the client provide, approve or make available, and by when?",
          requiredForExport: true,
          sharedResolutionKey: "scope.client_dependencies",
          neutralReplacementOptions: [],
        },
        {
          key: "external_dependencies",
          label: "External dependencies",
          factType: "other",
          placeholderLabel: "external dependencies affecting time or cost",
          question:
            "Are there external dependencies that could change the timeline or cost?",
          requiredForExport: false,
          sharedResolutionKey: "scope.external_dependencies",
          neutralReplacementOptions: [
            {
              id: "none-confirmed",
              label: "No external dependencies identified",
              value:
                "No additional external dependencies have been identified beyond those already stated.",
              suitability:
                "Use only when the user confirms there are no additional external dependencies to record.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "risk notes",
        "access requirements",
        "timeline constraints",
        "assumption validation",
        "vendor dependencies",
        "contingency triggers",
        "resource availability",
      ],
    },
  ],
};

const SCOPE_OF_WORK_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Scope of Work section captures the project outcome, included work, exclusions, variation process, acceptance requirements and critical dependencies",
    "intake and context reuse: briefs, proposals, contracts and confirmed project details are reused before the Scope of Work asks for clarification",
    "generation resilience: complete Scope of Work wording remains available when genuinely optional delivery parameters or external dependencies are unresolved through declared replacement paths",
    "factual safety: deliverables, quantities, exclusions, dates, acceptance requirements and client responsibilities are never invented",
    "placeholder integrity: every unresolved Scope of Work fact has a contextual label, exact question and deliberate export or replacement policy",
    "resolution behaviour: shared project, deliverable, exclusion and dependency facts update linked Scope of Work occurrences while preserving unrelated negotiated wording",
    "proofread behaviour: Scope of Work placeholders remain outside editorial findings while surrounding contractual prose remains reviewable for ambiguity and consistency",
    "workspace persistence: negotiated Scope of Work edits and resolved facts persist without later answers overwriting independently agreed sections",
    "issue navigation: unresolved Scope of Work facts remain individually countable across overview, inclusions, exclusions, acceptance and assumptions",
    "export behaviour: project boundaries and acceptance terms remain required while genuinely inapplicable delivery parameters and confirmed absent dependencies can be resolved safely",
    "accessibility and recovery: every Scope of Work placeholder uses a meaningful label and direct question and malformed tokens remain visible",
    "regression and release evidence: Scope of Work validation, boundary consistency, shared-resolution, replacement and export tests must remain green",
  ],
  notes: [
    "In-scope and out-of-scope work are both load-bearing; TED must never infer one from the other.",
    "The external-dependency neutral option is valid only after confirmation that no additional dependency exists.",
    "Variation handling must describe the user's actual agreed process rather than inventing a standard contractual change mechanism.",
  ],
} as const;

const SELECTION_CRITERIA_RESPONSE_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "heading",
        requiredInformation: [
          {
            key: "exact_criterion",
            label: "Selection criterion",
            factType: "other",
            placeholderLabel: "selection criterion",
            question:
              "What exact criterion or requirement are you responding to?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_criterion",
            neutralReplacementOptions: [],
          },
          {
            key: "employer_wording",
            label: "Employer wording",
            factType: "reference",
            placeholderLabel: "employer's wording of the criterion",
            question:
              "How did the employer word this criterion in the job ad or position description?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_criterion",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "criterion number",
          "reference code",
          "keywords from the job ad",
          "plain-language interpretation",
          "mandatory-requirement indicator",
        ],
      },
      {
        sectionKey: "claim",
        requiredInformation: [
          {
            key: "direct_claim",
            label: "Direct capability claim",
            factType: "skill",
            placeholderLabel: "supported capability claim",
            question:
              "What can you truthfully say that shows you meet this criterion?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_claim",
            neutralReplacementOptions: [],
          },
          {
            key: "claim_reason",
            label: "Reason for claim",
            factType: "achievement",
            placeholderLabel: "why you meet the criterion",
            question: "What experience or evidence supports that claim?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_claim_support",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "seniority level",
          "frequency of using the capability",
          "scope of responsibility",
          "role alignment",
          "quantified impact",
          "relevant standards",
          "employer terminology",
        ],
      },
      {
        sectionKey: "evidence",
        requiredInformation: [
          {
            key: "example_context",
            label: "Example context",
            factType: "event",
            placeholderLabel: "real example and context",
            question:
              "What real situation can you use as evidence for this criterion, and what was happening at the time?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_example_context",
            neutralReplacementOptions: [],
          },
          {
            key: "candidate_action",
            label: "Candidate action",
            factType: "responsibility",
            placeholderLabel: "actions you personally took",
            question: "What did you personally do in that situation?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_example_actions",
            neutralReplacementOptions: [],
          },
          {
            key: "capability_demonstrated",
            label: "Capability demonstrated",
            factType: "skill",
            placeholderLabel: "capability demonstrated by the example",
            question:
              "What capability or judgement does this example genuinely demonstrate?",
            requiredForExport: true,
            sharedResolutionKey:
              "selection_criteria.current_example_capability",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "measurable results",
          "constraints",
          "stakeholders",
          "policy or compliance context",
          "timeline",
          "tools or technologies",
          "resources",
          "STAR structure",
        ],
      },
      {
        sectionKey: "relevance",
        requiredInformation: [
          {
            key: "result_achieved",
            label: "Result achieved",
            factType: "achievement",
            placeholderLabel: "result achieved",
            question: "What result actually came from your actions?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_example_result",
            neutralReplacementOptions: [],
          },
          {
            key: "target_role_relevance",
            label: "Relevance to target role",
            factType: "other",
            placeholderLabel: "relevance to the target role",
            question:
              "How does this example show that you can meet the needs of the role you're applying for?",
            requiredForExport: true,
            sharedResolutionKey: "selection_criteria.current_role_relevance",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "organisation values",
          "transferable lesson",
          "repeatability",
          "role responsibilities",
          "strategic goals",
          "measurable business outcome",
          "employer mission language",
          "interview discussion point",
        ],
      },
    ],
  };

const SELECTION_CRITERIA_RESPONSE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Selection Criteria Response section captures the employer's criterion, a supported capability claim, a concrete evidence example, the applicant's personal actions, the result and relevance to the target role",
    "intake and context reuse: the job description, criterion list, resume, prior STAR examples and confirmed career history can resolve Selection Criteria Response facts before clarification",
    "generation resilience: each Selection Criteria Response remains fully structured around criterion, claim, evidence and relevance even when individual facts are represented by unresolved placeholders",
    "factual safety: employer wording, applicant capabilities, personal actions, results and measurable outcomes are never invented or attributed to the applicant without supporting information",
    "placeholder integrity: every unresolved Selection Criteria Response fact has a criterion-specific label, plain-language question, export rule and independent information key",
    "resolution behaviour: facts shared within one criterion can update their linked Selection Criteria Response wording while separate criteria and separate examples remain independent",
    "proofread behaviour: Selection Criteria Response placeholders are excluded from editorial findings while surrounding first-person evidence remains reviewable for clarity, directness and relevance",
    "workspace persistence: applicant edits, criterion wording and resolved evidence persist without regenerating unrelated Selection Criteria Response sections or other criteria",
    "issue navigation: unresolved Selection Criteria Response facts remain independently selectable so a missing result, action or role link can be fixed without reopening the entire response",
    "export behaviour: criterion wording, supported claim, personal action, result and role relevance remain required-for-export because neutral wording cannot safely manufacture evidence of meeting a selection criterion",
    "accessibility and recovery: every Selection Criteria Response placeholder clearly identifies the evidence gap and supplies an exact conversational question while malformed tokens remain visible",
    "regression and release evidence: Selection Criteria Response validation, criterion-to-evidence mapping, first-person factual safety, placeholder resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "The employer's criterion must remain traceable to the supplied job material rather than being rewritten into a materially different requirement.",
    "Team achievements must not be converted into personal applicant achievements unless the user's own contribution is established.",
    "No neutral replacement is offered for missing STAR evidence because a generic example would falsely imply experience the applicant may not have.",
  ],
} as const;

const SERVICE_AGREEMENT_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "parties",
      requiredInformation: [
        {
          key: "provider",
          label: "Service provider",
          factType: "company_name",
          placeholderLabel: "service provider",
          question: "Who is providing the services?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.provider",
          neutralReplacementOptions: [],
        },
        {
          key: "client",
          label: "Client",
          factType: "company_name",
          placeholderLabel: "client",
          question: "Who is receiving the services?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.client",
          neutralReplacementOptions: [],
        },
        {
          key: "service_purpose",
          label: "Service purpose",
          factType: "other",
          placeholderLabel: "purpose of the services",
          question: "What is the overall purpose of this service arrangement?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.purpose",
          neutralReplacementOptions: [],
        },
        {
          key: "start_date",
          label: "Start date",
          factType: "date",
          placeholderLabel: "service start date",
          question: "When should the service arrangement start?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.start_date",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "legal names",
        "addresses",
        "ABN or company numbers",
        "background recitals",
        "authorised signatories",
        "party contact people",
        "governing law",
        "related agreements",
        "communication preferences",
      ],
    },
    {
      sectionKey: "scope",
      requiredInformation: [
        {
          key: "services_to_be_provided",
          label: "Services to be provided",
          factType: "responsibility",
          placeholderLabel: "services to be provided",
          question:
            "What services is the provider actually agreeing to perform?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.services",
          neutralReplacementOptions: [],
        },
        {
          key: "concrete_deliverables",
          label: "Concrete deliverables",
          factType: "responsibility",
          placeholderLabel: "specific deliverables or activities",
          question:
            "What specific deliverables or activities should be listed in the scope?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.deliverables",
          neutralReplacementOptions: [],
        },
        {
          key: "service_standards",
          label: "Service standards",
          factType: "other",
          placeholderLabel: "service standards and timing expectations",
          question:
            "What service standards, frequency or turnaround expectations have been agreed?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.service_standards",
          neutralReplacementOptions: [],
        },
        {
          key: "service_exclusions",
          label: "Service exclusions",
          factType: "responsibility",
          placeholderLabel: "services explicitly excluded",
          question: "What is explicitly outside the scope of the service?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.exclusions",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "milestone dates",
        "change-control process",
        "performance measures",
        "quality-assurance procedures",
        "service escalation path",
        "assumptions",
        "risk allocation",
        "acceptance criteria",
      ],
    },
    {
      sectionKey: "payment",
      requiredInformation: [
        {
          key: "fee_amount_or_rate",
          label: "Fee amount or rate",
          factType: "amount",
          placeholderLabel: "service fee or rate",
          question: "What fee, rate or pricing arrangement has been agreed?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.fee",
          neutralReplacementOptions: [],
        },
        {
          key: "payment_timing",
          label: "Payment timing",
          factType: "other",
          placeholderLabel: "payment timing",
          question:
            "When is payment due and how often will the client be invoiced?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.payment_timing",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "late fees",
        "reimbursable expenses",
        "tax treatment",
        "invoice requirements",
        "deposit terms",
        "payment method",
        "currency",
        "overdue interest",
        "invoice dispute process",
      ],
    },
    {
      sectionKey: "terms",
      requiredInformation: [
        {
          key: "provider",
          label: "Provider obligations",
          factType: "responsibility",
          placeholderLabel: "provider obligations",
          question:
            "What ongoing obligations must the provider meet under the agreement?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.provider_obligations",
          neutralReplacementOptions: [],
        },
        {
          key: "client_obligations",
          label: "Client obligations",
          factType: "responsibility",
          placeholderLabel: "client obligations",
          question:
            "What must the client provide, do or approve for the services to be delivered?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.client_obligations",
          neutralReplacementOptions: [],
        },
        {
          key: "termination_rights",
          label: "Termination rights",
          factType: "other",
          placeholderLabel: "termination rights",
          question: "In what circumstances can either party end the agreement?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.termination_rights",
          neutralReplacementOptions: [],
        },
        {
          key: "notice_period",
          label: "Notice period",
          factType: "date_range",
          placeholderLabel: "termination notice period",
          question: "How much notice must be given to terminate the agreement?",
          requiredForExport: true,
          sharedResolutionKey: "service_agreement.notice_period",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "access requirements",
        "dependencies",
        "approval obligations",
        "confidentiality",
        "compliance duties",
        "effects of termination",
        "outstanding fees",
        "handover obligations",
        "dispute process",
        "force majeure terms",
      ],
    },
  ],
};

const SERVICE_AGREEMENT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Service Agreement section captures the parties, purpose, commencement, concrete scope and exclusions, fees, payment timing, obligations and termination mechanics required by the template",
    "intake and context reuse: quotes, proposals, standard terms, organisation records and previously confirmed party details can resolve Service Agreement facts before new questions are shown",
    "generation resilience: Service Agreement clauses can still be drafted around clearly marked unresolved facts without silently assigning commercial terms the parties never supplied",
    "factual safety: party identities, deliverables, service standards, fees, dates, obligations, exclusions and termination rights are never fabricated from generic contract conventions",
    "placeholder integrity: every unresolved Service Agreement commercial fact has an exact location, contextual label, plain-language clarification question and deliberate export policy",
    "resolution behaviour: shared Service Agreement facts such as party identity, services and payment terms can resolve linked occurrences while genuinely distinct obligations remain separate",
    "proofread behaviour: declared Service Agreement placeholders are excluded from editorial findings while surrounding contractual wording remains reviewable for consistency and ambiguity",
    "workspace persistence: negotiated edits and resolved Service Agreement terms remain section-specific and persist without a later resolution overwriting unrelated negotiated language",
    "issue navigation: unresolved Service Agreement terms are independently countable and answerable so missing fees, exclusions, notice periods and obligations cannot collapse into a generic contract warning",
    "export behaviour: unresolved load-bearing commercial terms require acknowledgement because neutral boilerplate must never substitute for an agreement the parties have not actually made",
    "accessibility and recovery: each Service Agreement placeholder exposes an understandable label and direct question and malformed placeholder content remains visible for correction",
    "regression and release evidence: Service Agreement validation, shared-resolution behaviour, contradiction scans, placeholder navigation and export acknowledgement tests must pass alongside repository CI",
  ],
  notes: [
    "No generic legal boilerplate is used as an automatic fallback for a commercial term that could materially vary between parties.",
    "Scope inclusions and exclusions are separately required because omitting exclusions can materially misrepresent what the provider agreed to deliver.",
    "High-value or consequential agreements should still be reviewed by an appropriately qualified legal professional; this contract governs information completeness, not legal advice.",
  ],
} as const;

const STAR_ACHIEVEMENT_BANK_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "situation",
        requiredInformation: [
          {
            key: "context",
            label: "Situation context",
            factType: "event",
            placeholderLabel: "situation context",
            question: "What was happening when this example took place?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.context",
            neutralReplacementOptions: [],
          },
          {
            key: "problem",
            label: "Problem or challenge",
            factType: "other",
            placeholderLabel: "problem or challenge",
            question:
              "What problem, challenge or opportunity were you dealing with?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.problem",
            neutralReplacementOptions: [],
          },
          {
            key: "timeframe",
            label: "Timeframe",
            factType: "date_range",
            placeholderLabel: "approximate timeframe",
            question: "Roughly when did this situation happen?",
            requiredForExport: false,
            sharedResolutionKey: "star.current_example.timeframe",
            neutralReplacementOptions: [
              {
                id: "timeframe-not-specified",
                label: "Leave timeframe general",
                value:
                  "describe the situation without claiming a specific date or period",
                suitability:
                  "Use when the event is genuine but the user cannot confidently provide an exact timeframe.",
                clearsExportWarning: true,
                regenerateSurroundingWording: true,
              },
            ],
          },
          {
            key: "why_it_mattered",
            label: "Why it mattered",
            factType: "other",
            placeholderLabel: "why the situation mattered",
            question:
              "Why did this situation matter to the team, organisation, customer or outcome?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.stakes",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "scale",
          "stakes",
          "stakeholders",
          "constraints",
          "baseline condition",
          "geographic scope",
          "regulatory context",
          "starting metrics",
        ],
      },
      {
        sectionKey: "task",
        requiredInformation: [
          {
            key: "candidate_responsibility",
            label: "Candidate responsibility",
            factType: "responsibility",
            placeholderLabel: "your personal responsibility",
            question:
              "What were you personally responsible for in this situation?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.responsibility",
            neutralReplacementOptions: [],
          },
          {
            key: "expected_outcome",
            label: "Expected outcome",
            factType: "achievement",
            placeholderLabel: "expected outcome",
            question: "What outcome were you expected to achieve?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.expected_outcome",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "decision authority",
          "competing priorities",
          "deadlines",
          "success criteria",
          "resources",
          "stakeholder expectations",
          "dependencies",
          "organisational-goal alignment",
        ],
      },
      {
        sectionKey: "action",
        requiredInformation: [
          {
            key: "personal_actions",
            label: "Personal actions",
            factType: "responsibility",
            placeholderLabel: "actions you personally took",
            question: "What did you personally do, step by step?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.actions",
            neutralReplacementOptions: [],
          },
          {
            key: "first_person_ownership",
            label: "Personal ownership",
            factType: "other",
            placeholderLabel: "your individual contribution",
            question:
              "Which parts of the work were specifically yours rather than the team's?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.individual_contribution",
            neutralReplacementOptions: [],
          },
          {
            key: "skills_and_judgement",
            label: "Skills and judgement demonstrated",
            factType: "skill",
            placeholderLabel: "skills or judgement demonstrated",
            question: "What skills or judgement did your actions demonstrate?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.skills",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "tools used",
          "collaboration",
          "trade-offs",
          "communication approach",
          "leadership behaviours",
          "decision rationale",
          "iteration",
          "data or analytics",
          "adaptation to change",
        ],
      },
      {
        sectionKey: "result",
        requiredInformation: [
          {
            key: "outcome",
            label: "Confirmed outcome",
            factType: "achievement",
            placeholderLabel: "confirmed result",
            question: "What actually happened as a result of your actions?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.result",
            neutralReplacementOptions: [],
          },
          {
            key: "competency_demonstrated",
            label: "Competency demonstrated",
            factType: "skill",
            placeholderLabel: "competency demonstrated",
            question: "What competency does this result genuinely demonstrate?",
            requiredForExport: true,
            sharedResolutionKey: "star.current_example.competency",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "quantified impact",
          "recognition",
          "lessons learned",
          "repeatability",
          "target-role relevance",
          "customer feedback",
          "cost savings",
          "time improvement",
          "long-term impact",
        ],
      },
    ],
  };

const STAR_ACHIEVEMENT_BANK_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every STAR Achievement Bank section captures situation context, personal responsibility, individual action, confirmed result and demonstrated competency",
    "intake and context reuse: resume history, performance reviews, KPI reports, project notes and previously confirmed achievements are reused before the STAR Achievement Bank requests clarification",
    "generation resilience: STAR Achievement Bank examples maintain complete STAR structure even when a non-essential timeframe remains general or another required fact is represented by a declared placeholder",
    "factual safety: contexts, individual contributions, actions, metrics and outcomes in the STAR Achievement Bank are never invented or reassigned from a team to the candidate",
    "placeholder integrity: each unresolved STAR Achievement Bank fact has a distinct label, exact conversational question, section-specific information key and deliberate export policy",
    "resolution behaviour: facts belonging to the same STAR Achievement Bank example can resolve linked occurrences while separate examples remain isolated from one another",
    "proofread behaviour: unresolved STAR Achievement Bank placeholder labels are excluded from editorial findings while first-person evidence remains reviewable for specificity and clarity",
    "workspace persistence: individual STAR Achievement Bank examples and section edits persist without later resolutions changing unrelated evidence or examples",
    "issue navigation: unresolved STAR Achievement Bank context, task, action and result facts remain independently countable and answerable",
    "export behaviour: personal responsibility, actions and results remain required for export while an uncertain date can be safely generalised without creating a false timeframe",
    "accessibility and recovery: every STAR Achievement Bank placeholder describes the missing fact plainly and provides the exact clarification question while malformed tokens stay visible",
    "regression and release evidence: STAR Achievement Bank contract validation, first-person ownership checks, placeholder resolution and factual-grounding tests must remain green",
  ],
  notes: [
    "Team outcomes must never be represented as individual achievements unless the candidate's own contribution is established.",
    "The timeframe can be generalised because an exact date is not essential to the validity of an otherwise confirmed example.",
    "Result wording must distinguish a confirmed outcome from an aspiration, forecast or incomplete project.",
  ],
} as const;

const STATEMENT_OF_PURPOSE_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "focus",
      requiredInformation: [
        {
          key: "intended_field",
          label: "Intended field",
          factType: "other",
          placeholderLabel: "intended field of study",
          question: "What field are you applying to study?",
          requiredForExport: true,
          sharedResolutionKey: "education.intended_field",
          neutralReplacementOptions: [],
        },
        {
          key: "topic_of_interest",
          label: "Topic of interest",
          factType: "other",
          placeholderLabel: "specific topic of interest",
          question:
            "What specific topic, problem or question within that field interests you most?",
          requiredForExport: true,
          sharedResolutionKey: "education.topic_of_interest",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "research question",
        "specialisation",
        "intellectual motivation",
        "research gap",
        "theoretical framework",
        "interdisciplinary angle",
        "societal relevance",
      ],
    },
    {
      sectionKey: "preparation",
      requiredInformation: [
        {
          key: "relevant_background",
          label: "Relevant background",
          factType: "credential",
          placeholderLabel: "relevant academic or professional background",
          question:
            "What academic or professional background has prepared you for this program?",
          requiredForExport: true,
          sharedResolutionKey: "education.relevant_background",
          neutralReplacementOptions: [],
        },
        {
          key: "preparation_examples",
          label: "Preparation examples",
          factType: "achievement",
          placeholderLabel: "courses, projects or roles that prepared you",
          question:
            "Which specific courses, projects, roles or experiences best demonstrate that preparation?",
          requiredForExport: true,
          sharedResolutionKey: "education.preparation_examples",
          neutralReplacementOptions: [],
        },
        {
          key: "learning_from_experience",
          label: "Relevant learning",
          factType: "skill",
          placeholderLabel: "what those experiences taught you",
          question:
            "What did each of those experiences teach you that is directly relevant to this program?",
          requiredForExport: true,
          sharedResolutionKey: "education.preparation_learning",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "methods",
        "publications",
        "grades",
        "internships",
        "technical skills",
        "project management",
        "collaboration",
        "leadership",
        "data analysis",
      ],
    },
    {
      sectionKey: "fit",
      requiredInformation: [
        {
          key: "program_fit_reason",
          label: "Program fit reason",
          factType: "reference",
          placeholderLabel: "reason this specific program fits",
          question:
            "Why is this specific program a strong fit for what you want to study or achieve?",
          requiredForExport: true,
          sharedResolutionKey: "education.program_fit",
          neutralReplacementOptions: [],
        },
        {
          key: "named_program_features",
          label: "Named program features",
          factType: "reference",
          placeholderLabel: "specific program features",
          question:
            "Which real features of the program — such as units, faculty, labs, facilities or structure — are relevant to you?",
          requiredForExport: true,
          sharedResolutionKey: "education.program_features",
          neutralReplacementOptions: [],
        },
        {
          key: "fit_over_alternatives",
          label: "Why these features matter",
          factType: "other",
          placeholderLabel: "why those program features suit you",
          question:
            "Why do those specific features suit your goals better than generic alternatives?",
          requiredForExport: true,
          sharedResolutionKey: "education.program_feature_relevance",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "faculty names",
        "labs",
        "courses",
        "institutional strengths",
        "alumni network",
        "campus resources",
        "faculty research",
      ],
    },
    {
      sectionKey: "direction",
      requiredInformation: [
        {
          key: "future_goal",
          label: "Future goal",
          factType: "role_title",
          placeholderLabel: "career or research goal",
          question:
            "What career or research goal do you want to pursue after completing the program?",
          requiredForExport: true,
          sharedResolutionKey: "candidate.future_goal",
          neutralReplacementOptions: [],
        },
        {
          key: "program_to_goal_link",
          label: "Program-to-goal link",
          factType: "other",
          placeholderLabel: "how the program leads to your goal",
          question:
            "How will completing this program help you move toward that goal step by step?",
          requiredForExport: true,
          sharedResolutionKey: "education.program_goal_link",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "contribution to field",
        "community impact",
        "long-term plan",
        "career milestones",
        "research dissemination",
        "professional certification",
        "policy influence",
        "entrepreneurial plans",
      ],
    },
  ],
};

const STATEMENT_OF_PURPOSE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Statement of Purpose section captures academic focus, real preparation, specific program fit and a credible future direction",
    "intake and context reuse: transcripts, resumes, program information, prior academic work and confirmed career facts are reused before clarification",
    "generation resilience: complete Statement of Purpose prose remains available around unresolved facts through placeholders rather than invented academic motivation or program-specific claims",
    "factual safety: courses, grades, publications, faculty, labs, program features and career history are never invented",
    "placeholder integrity: every unresolved Statement of Purpose fact has a specific contextual label, direct question and explicit export requirement",
    "resolution behaviour: academic focus, background, program features and future-goal facts update linked Statement of Purpose occurrences without changing unrelated narrative",
    "proofread behaviour: Statement of Purpose placeholders are excluded from editorial findings while surrounding first-person prose remains reviewable for authenticity and coherence",
    "workspace persistence: resolved Statement of Purpose facts and user-edited narrative persist across sections without regeneration of unrelated content",
    "issue navigation: unresolved Statement of Purpose focus, preparation, fit and future-direction facts remain independently countable and selectable",
    "export behaviour: all core academic, program-fit and future-direction facts remain required because generic substitutes would create an untrustworthy application",
    "accessibility and recovery: every Statement of Purpose placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Statement of Purpose validation, program-source grounding, first-person factual safety and export tests must remain green",
  ],
  notes: [
    "Program-fit claims must name real features from supplied or verified program information rather than generic praise.",
    "Preparation must reflect the applicant's actual academic and professional history.",
    "Future goals may be aspirational but must still come from the applicant rather than being invented to create a stronger narrative.",
  ],
} as const;

const STUDENT_SUPPORT_PLAN_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "context",
      requiredInformation: [
        {
          key: "student",
          label: "Student",
          factType: "person_name",
          placeholderLabel: "student name",
          question: "Which student is this support plan for?",
          requiredForExport: true,
          sharedResolutionKey: "student.full_name",
          neutralReplacementOptions: [],
        },
        {
          key: "course_or_year_level",
          label: "Course or year level",
          factType: "other",
          placeholderLabel: "course or year level",
          question:
            "What course, class or year level is the student currently in?",
          requiredForExport: true,
          sharedResolutionKey: "student.course_year",
          neutralReplacementOptions: [],
        },
        {
          key: "support_area",
          label: "Support area",
          factType: "other",
          placeholderLabel: "area where support is needed",
          question: "What area does the student currently need support with?",
          requiredForExport: true,
          sharedResolutionKey: "student.support_area",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "diagnosis or learning profile where appropriate",
        "attendance pattern",
        "consent status",
        "specific challenges",
        "environmental factors",
        "cultural considerations",
        "previous interventions",
        "support network",
      ],
    },
    {
      sectionKey: "strengths",
      requiredInformation: [
        {
          key: "student_strengths",
          label: "Student strengths",
          factType: "skill",
          placeholderLabel: "student strengths",
          question:
            "What genuine strengths does the student already demonstrate?",
          requiredForExport: true,
          sharedResolutionKey: "student.strengths",
          neutralReplacementOptions: [],
        },
        {
          key: "strength_specificity",
          label: "Specific evidence of strengths",
          factType: "achievement",
          placeholderLabel: "specific examples of student strengths",
          question:
            "What specific examples show those strengths clearly enough to build support strategies around them?",
          requiredForExport: true,
          sharedResolutionKey: "student.strength_evidence",
          neutralReplacementOptions: [],
        },
        {
          key: "existing_supports",
          label: "Existing supports",
          factType: "responsibility",
          placeholderLabel: "supports already in place",
          question:
            "What people, services, adjustments or strategies are already supporting the student?",
          requiredForExport: true,
          sharedResolutionKey: "student.existing_supports",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "interests",
        "preferred learning modes",
        "successful strategies",
        "motivators",
        "social connections",
        "coping mechanisms",
        "past achievements",
        "peer support",
      ],
    },
    {
      sectionKey: "needs",
      requiredInformation: [
        {
          key: "priority_needs",
          label: "Priority support needs",
          factType: "other",
          placeholderLabel: "priority support needs",
          question:
            "What are the student's highest-priority barriers or support needs?",
          requiredForExport: true,
          sharedResolutionKey: "student.priority_needs",
          neutralReplacementOptions: [],
        },
        {
          key: "learning_or_participation_impact",
          label: "Impact on learning or participation",
          factType: "other",
          placeholderLabel: "impact of each support need",
          question:
            "How does each identified need affect the student's learning or participation?",
          requiredForExport: true,
          sharedResolutionKey: "student.need_impacts",
          neutralReplacementOptions: [],
        },
        {
          key: "priority_order",
          label: "Priority order",
          factType: "other",
          placeholderLabel: "priority order of support needs",
          question:
            "If there are several needs, which should be addressed first?",
          requiredForExport: true,
          sharedResolutionKey: "student.need_priority_order",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "triggers",
        "risk indicators",
        "accessibility details",
        "urgency",
        "warning signs",
        "wellbeing impact",
        "support preferences",
        "time sensitivity",
      ],
    },
    {
      sectionKey: "actions",
      requiredInformation: [
        {
          key: "support_actions",
          label: "Support actions",
          factType: "responsibility",
          placeholderLabel: "specific support actions",
          question:
            "What specific actions should be put in place to support the student?",
          requiredForExport: true,
          sharedResolutionKey: "student.support_actions",
          neutralReplacementOptions: [],
        },
        {
          key: "owner",
          label: "Action owner",
          factType: "person_name",
          placeholderLabel: "owner of each support action",
          question: "Who is responsible for each support action?",
          requiredForExport: true,
          sharedResolutionKey: "student.support_action_owners",
          neutralReplacementOptions: [],
        },
        {
          key: "review_date",
          label: "Review date",
          factType: "date",
          placeholderLabel: "support-plan review date",
          question:
            "When should the student's progress and support plan be reviewed?",
          requiredForExport: true,
          sharedResolutionKey: "student.support_review_date",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "action frequency",
        "measurable goals",
        "escalation path",
        "family or carer involvement",
        "documentation location",
        "progress indicators",
        "adjustments",
        "communication plan",
        "contingency planning",
      ],
    },
  ],
};

const STUDENT_SUPPORT_PLAN_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Student Support Plan section captures student context, genuine strengths, existing supports, priority needs, impacts, actions, owners and a review date",
    "intake and context reuse: existing support documentation, diagnostics supplied with consent, attendance information and prior education context are reused before clarification",
    "generation resilience: complete Student Support Plan wording remains available while unresolved student-specific facts remain visible placeholders rather than generic deficit labels",
    "factual safety: diagnoses, learning difficulties, family circumstances, supports and behavioural observations are never invented",
    "placeholder integrity: every unresolved Student Support Plan fact has a meaningful contextual label, exact question and appropriate export requirement",
    "resolution behaviour: shared student, need, support and review facts update linked Student Support Plan occurrences without overwriting unrelated wording",
    "proofread behaviour: Student Support Plan placeholders remain outside editorial findings while surrounding strengths-based prose remains reviewable",
    "workspace persistence: resolved Student Support Plan facts, support strategies and edits persist independently across sections",
    "issue navigation: unresolved Student Support Plan context, strengths, needs, actions, owners and dates remain independently countable and selectable",
    "export behaviour: core student, need, action and review facts remain required because a generic substitute could result in an inappropriate or unusable support plan",
    "accessibility and recovery: every Student Support Plan placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Student Support Plan validation, sensitive-data handling, shared-resolution and export acknowledgement tests must remain green",
  ],
  notes: [
    "Sensitive diagnoses or personal circumstances must be included only where appropriate and supported by consent or supplied source material.",
    "The plan is deliberately strengths-based and must not become a deficit-only description of the student.",
    "Every support action requires a real owner and review date so the plan produces accountable next steps rather than generic recommendations.",
  ],
} as const;

const STUDY_PLAN_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "goal",
      requiredInformation: [
        {
          key: "subject_or_skill",
          label: "Subject or skill",
          factType: "skill",
          placeholderLabel: "subject or skill being studied",
          question: "What subject, exam or skill are you studying for?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.subject_skill",
          neutralReplacementOptions: [],
        },
        {
          key: "deadline",
          label: "Deadline",
          factType: "date",
          placeholderLabel: "study deadline",
          question: "By what date do you need to reach the required level?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.deadline",
          neutralReplacementOptions: [],
        },
        {
          key: "success_measure",
          label: "Success measure",
          factType: "achievement",
          placeholderLabel: "study success measure",
          question:
            "How will you know you've succeeded — for example a score, exam result, completed skill level or other measurable outcome?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.success_measure",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "motivation",
        "exam requirements",
        "target score",
        "priority topics",
        "career relevance",
        "personal significance",
        "intermediate milestones",
      ],
    },
    {
      sectionKey: "level",
      requiredInformation: [
        {
          key: "strengths",
          label: "Current strengths",
          factType: "skill",
          placeholderLabel: "current strengths",
          question:
            "What parts of the subject or skill are you already reasonably strong in?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.strengths",
          neutralReplacementOptions: [],
        },
        {
          key: "gaps",
          label: "Priority gaps",
          factType: "skill",
          placeholderLabel: "priority learning gaps",
          question:
            "Which areas are currently weakest or need the most attention?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.gaps",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "diagnostic results",
        "confidence rating",
        "past performance",
        "self-assessment",
        "peer feedback",
        "learning preferences",
        "environmental factors",
      ],
    },
    {
      sectionKey: "schedule",
      requiredInformation: [
        {
          key: "study_hours",
          label: "Weekly study hours",
          factType: "amount",
          placeholderLabel: "weekly study hours",
          question:
            "How many hours per week can you realistically commit to studying?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.weekly_hours",
          neutralReplacementOptions: [],
        },
        {
          key: "practice_tasks",
          label: "Practice tasks",
          factType: "responsibility",
          placeholderLabel: "study practice tasks",
          question:
            "What kinds of practice tasks should the plan include each week?",
          requiredForExport: false,
          sharedResolutionKey: "study_plan.practice_tasks",
          automaticFallback:
            "use active recall, worked practice and progressively harder application tasks appropriate to the subject",
          neutralReplacementOptions: [
            {
              id: "standard-active-practice",
              label: "Use active practice",
              value:
                "use active recall, worked practice and progressively harder application tasks appropriate to the subject",
              suitability:
                "Use when no subject-specific practice method has been supplied and a general evidence-based practice structure is appropriate.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "review_method",
          label: "Review method",
          factType: "other",
          placeholderLabel: "study review method",
          question:
            "How should you review and reinforce what you've studied each week?",
          automaticFallback:
            "use spaced review and regular self-testing to identify what needs another pass",
          requiredForExport: false,
          sharedResolutionKey: "study_plan.review_method",
          neutralReplacementOptions: [
            {
              id: "spaced-review",
              label: "Spaced review",
              value:
                "use spaced review and regular self-testing to identify what needs another pass",
              suitability:
                "Use when the user has no preferred review method and a general non-personal study technique is appropriate.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
      ],
      optionalInformation: [
        "calendar blocks",
        "resource list",
        "practice-test cadence",
        "task prioritisation",
        "breaks",
        "flexibility plan",
        "adaptive pacing",
      ],
    },
    {
      sectionKey: "accountability",
      requiredInformation: [
        {
          key: "review_interval",
          label: "Review interval",
          factType: "date_range",
          placeholderLabel: "progress review interval",
          question: "How often should the plan formally check your progress?",
          automaticFallback: "review progress once each week",
          requiredForExport: false,
          sharedResolutionKey: "study_plan.review_interval",
          neutralReplacementOptions: [
            {
              id: "weekly-review",
              label: "Weekly review",
              value: "review progress once each week",
              suitability:
                "Use when the user has not chosen a review cadence and a regular weekly checkpoint fits the study-plan structure.",
              clearsExportWarning: true,
              regenerateSurroundingWording: true,
            },
          ],
        },
        {
          key: "progress_measure",
          label: "Progress measure",
          factType: "achievement",
          placeholderLabel: "measure used to track progress",
          question:
            "What result or measure should you use to judge whether the plan is working?",
          requiredForExport: true,
          sharedResolutionKey: "study_plan.progress_measure",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "mentor or tutor check-ins",
        "reward system",
        "adjustment rules",
        "risk plan",
        "progress dashboard",
        "reflection prompts",
        "support network",
        "contingency actions",
      ],
    },
  ],
};

const STUDY_PLAN_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Study Plan section captures the learning goal, deadline, measurable success definition, current strengths and gaps, available time and progress-check method",
    "intake and context reuse: prior results, diagnostics, practice scores, timetable constraints and conversation facts are reused before the Study Plan asks for clarification",
    "generation resilience: complete Study Plan wording remains available through safe generic study-method defaults while personal goals, time and ability gaps remain explicit placeholders",
    "factual safety: current ability, scores, weaknesses, available hours and deadlines are never invented",
    "placeholder integrity: every unresolved Study Plan fact has a contextual label, exact question and deliberate fallback or export policy",
    "resolution behaviour: shared goals, time commitments and progress measures update linked Study Plan occurrences without altering unrelated schedule wording",
    "proofread behaviour: Study Plan placeholders are excluded from editorial findings while surrounding plan instructions remain reviewable for clarity and practicality",
    "workspace persistence: Study Plan edits, resolved values and schedule adjustments persist independently across sections",
    "issue navigation: unresolved Study Plan goals, gaps, available hours and progress measures remain independently countable and selectable",
    "export behaviour: personal learning goals, deadlines, current capability and progress measures remain required while generic evidence-based practice and review methods can safely resolve",
    "accessibility and recovery: every Study Plan placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: Study Plan validation, fallback handling, schedule consistency and export-state tests must remain green",
  ],
  notes: [
    "Weekly available hours are treated as a real user constraint and must never be guessed.",
    "Spaced review and active practice are safe process defaults because they describe general study methods rather than personal facts.",
    "The plan must include a measurable checkpoint so TED can later suggest adjustments based on actual progress.",
  ],
} as const;

const EXPENSE_CLAIM_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "claim",
      requiredInformation: [
        {
          key: "claimant",
          label: "Claimant",
          factType: "person_name",
          placeholderLabel: "claimant's name",
          question: "Who is submitting this expense claim?",
          requiredForExport: true,
          sharedResolutionKey: "expense_claim.claimant",
          neutralReplacementOptions: [],
        },
        {
          key: "organisation_or_project",
          label: "Organisation or project",
          factType: "company_name",
          placeholderLabel: "organisation or project",
          question:
            "Which organisation, client or project should this claim be charged to?",
          requiredForExport: true,
          sharedResolutionKey: "expense_claim.organisation_or_project",
          neutralReplacementOptions: [],
        },
        {
          key: "claim_period",
          label: "Claim period",
          factType: "date_range",
          placeholderLabel: "claim period",
          question: "What date range does this claim cover?",
          requiredForExport: true,
          sharedResolutionKey: "expense_claim.claim_period",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["policy reference"],
    },
    {
      sectionKey: "expenses",
      requiredInformation: [
        {
          key: "itemised_expenses",
          label: "Each expense and business purpose",
          factType: "other",
          placeholderLabel: "itemised expenses and their business purpose",
          question:
            "What expenses are you claiming, and what was the business purpose of each?",
          requiredForExport: true,
          sharedResolutionKey: "expense_claim.itemised_expenses",
          neutralReplacementOptions: [],
        },
        {
          key: "amount_and_currency",
          label: "Amount and currency",
          factType: "amount",
          placeholderLabel: "amount and currency for each expense",
          question: "What is the amount and currency for each expense?",
          requiredForExport: true,
          sharedResolutionKey: "expense_claim.amount_and_currency",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["receipt references", "duplicate check"],
    },
    {
      sectionKey: "approval",
      requiredInformation: [
        {
          key: "total",
          label: "Total",
          factType: "amount",
          placeholderLabel: "claim total",
          question: "What is the total amount being claimed?",
          requiredForExport: true,
          sharedResolutionKey: "expense_claim.total",
          neutralReplacementOptions: [],
        },
        {
          key: "submission_status",
          label: "Submission status",
          factType: "other",
          placeholderLabel: "submission status",
          question: "Is this claim ready to submit, or still in draft?",
          requiredForExport: false,
          automaticFallback: "Draft — not yet submitted",
          sharedResolutionKey: "expense_claim.submission_status",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["approver and decision"],
    },
  ],
};

const EXPENSE_CLAIM_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Expense Claim section captures the claimant, organisation, period, itemised expenses, amounts, totals and submission status the form genuinely needs",
    "intake and context reuse: uploaded receipts, prior claims and organisation profile details are reused before asking the claimant to retype them",
    "generation resilience: the claim form remains fully structured with unresolved amounts and details shown as declared placeholders rather than blank rows",
    "factual safety: expense amounts, dates and business purposes are never invented or estimated on the claimant's behalf",
    "placeholder integrity: every unresolved expense fact carries its own label, question and export rule tied to the actual claim or expenses section",
    "resolution behaviour: claimant, organisation and period answers update only their linked occurrences without merging separate expense line items",
    "proofread behaviour: declared placeholder labels stay outside grammar and style findings while surrounding claim wording remains reviewable",
    "workspace persistence: edited expense lines and totals persist without regenerating unrelated claim sections",
    "issue navigation: unresolved claim facts remain independently countable and selectable by section",
    "export behaviour: claimant identity, itemised expenses and totals remain required for export because an unverifiable reimbursement claim should not be submitted",
    "accessibility and recovery: every claim placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible rather than vanishing",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Expense Claim ships",
  ],
  notes: [
    "Submission status defaults to draft rather than inventing an approval decision that has not happened.",
    "No neutral replacements are offered for amounts or claimant identity — a reimbursement claim with a substituted figure would be inaccurate, not merely incomplete.",
  ],
} as const;

const PROJECT_PLAN_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "foundation",
      requiredInformation: [
        {
          key: "objective",
          label: "Objective",
          factType: "other",
          placeholderLabel: "project objective",
          question: "What is this project trying to achieve?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.objective",
          neutralReplacementOptions: [],
        },
        {
          key: "sponsor_or_owner",
          label: "Sponsor or owner",
          factType: "person_name",
          placeholderLabel: "project sponsor or owner",
          question:
            "Who is the project sponsor or owner accountable for this project?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.sponsor_or_owner",
          neutralReplacementOptions: [],
        },
        {
          key: "scope",
          label: "Scope",
          factType: "other",
          placeholderLabel: "project scope",
          question:
            "What is in scope for this project, and what is explicitly out of scope?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.scope",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["success measures"],
    },
    {
      sectionKey: "delivery",
      requiredInformation: [
        {
          key: "deliverables",
          label: "Deliverables",
          factType: "other",
          placeholderLabel: "project deliverables",
          question: "What are the key deliverables this project will produce?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.deliverables",
          neutralReplacementOptions: [],
        },
        {
          key: "milestones",
          label: "Milestones",
          factType: "date",
          placeholderLabel: "project milestones and dates",
          question: "What are the key milestones and their target dates?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.milestones",
          neutralReplacementOptions: [],
        },
        {
          key: "owners",
          label: "Owners",
          factType: "person_name",
          placeholderLabel: "owners for each deliverable",
          question: "Who owns each deliverable or milestone?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.owners",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["dependencies", "resources"],
    },
    {
      sectionKey: "controls",
      requiredInformation: [
        {
          key: "material_risks",
          label: "Material risks",
          factType: "other",
          placeholderLabel: "material project risks",
          question: "What are the material risks to this project's success?",
          requiredForExport: true,
          sharedResolutionKey: "project_plan.material_risks",
          neutralReplacementOptions: [],
        },
        {
          key: "review_method",
          label: "Review method",
          factType: "other",
          placeholderLabel: "how progress will be reviewed",
          question:
            "How and how often will progress against this plan be reviewed?",
          requiredForExport: false,
          automaticFallback: "Reviewed at each milestone",
          sharedResolutionKey: "project_plan.review_method",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["communication plan"],
    },
  ],
};

const PROJECT_PLAN_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Project Plan section covers objective, sponsor, scope, deliverables, milestones, owners, risks and review method the plan genuinely needs",
    "intake and context reuse: prior project charters, kick-off notes and uploaded plans are reused before asking the sponsor to restate confirmed scope",
    "generation resilience: the full plan structure stays available while unresolved objectives, milestones or owners remain visible as declared placeholders",
    "factual safety: deliverable dates, owners and risk statements are never invented to make the plan appear more complete than it is",
    "placeholder integrity: every unresolved plan fact carries its own label, question and export rule tied to the actual foundation, delivery or controls section",
    "resolution behaviour: sponsor, scope and owner answers update only their linked occurrences without collapsing distinct deliverables into one",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding plan prose remains reviewable",
    "workspace persistence: edited milestones, owners and risks persist without regenerating unrelated plan sections",
    "issue navigation: unresolved plan facts remain independently countable and selectable by section",
    "export behaviour: objective, scope, deliverables and material risks remain required because a plan without them cannot direct real work",
    "accessibility and recovery: every plan placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Project Plan ships",
  ],
  notes: [
    "Review method falls back to a milestone-based cadence automatically rather than blocking export over a scheduling preference.",
    "No neutral replacements are offered for objective, scope or owners — a plan with a substituted objective would misdirect the project team.",
  ],
} as const;

const PROJECT_STATUS_REPORT_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "status",
        requiredInformation: [
          {
            key: "reporting_period",
            label: "Reporting period",
            factType: "date_range",
            placeholderLabel: "reporting period",
            question: "What reporting period does this status update cover?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.reporting_period",
            neutralReplacementOptions: [],
          },
          {
            key: "baseline_plan",
            label: "Baseline plan",
            factType: "other",
            placeholderLabel: "baseline plan reference",
            question:
              "What is the baseline plan or schedule this status is measured against?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.baseline_plan",
            neutralReplacementOptions: [],
          },
          {
            key: "confirmed_status",
            label: "Confirmed status",
            factType: "other",
            placeholderLabel: "overall project status",
            question:
              "What is the confirmed overall status — on track, at risk, or delayed?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.confirmed_status",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["RAG criteria"],
      },
      {
        sectionKey: "progress",
        requiredInformation: [
          {
            key: "completed_work",
            label: "Confirmed completed work",
            factType: "other",
            placeholderLabel: "work completed this period",
            question:
              "What confirmed work was completed during this reporting period?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.completed_work",
            neutralReplacementOptions: [],
          },
          {
            key: "upcoming_work",
            label: "Upcoming work",
            factType: "other",
            placeholderLabel: "work planned next",
            question: "What work is planned for the next reporting period?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.upcoming_work",
            neutralReplacementOptions: [],
          },
          {
            key: "milestone_status",
            label: "Milestone status",
            factType: "other",
            placeholderLabel: "milestone status",
            question: "What is the current status of each key milestone?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.milestone_status",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["budget status"],
      },
      {
        sectionKey: "attention",
        requiredInformation: [
          {
            key: "risks_and_issues",
            label: "Material risks and issues",
            factType: "other",
            placeholderLabel: "material risks and issues",
            question: "What material risks or issues need attention right now?",
            requiredForExport: true,
            sharedResolutionKey: "project_status_report.risks_and_issues",
            neutralReplacementOptions: [
              {
                id: "no-material-risks",
                label: "No material risks or issues this period",
                value: "No material risks or issues to report this period.",
                suitability:
                  "Use only when confirmed that nothing needs escalation this period.",
                clearsExportWarning: true,
                regenerateSurroundingWording: false,
              },
            ],
          },
        ],
        optionalInformation: ["decision and support requests"],
      },
    ],
  };

const PROJECT_STATUS_REPORT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Project Status Report section covers reporting period, baseline, confirmed status, completed and upcoming work, milestones, risks and issues the report genuinely needs",
    "intake and context reuse: prior status reports, project plans and tracking tools are reused before asking the reporter to restate confirmed progress",
    "generation resilience: the full status structure stays available while unresolved status, progress or risk facts remain visible as declared placeholders",
    "factual safety: completion status, milestone dates and risk ratings are never invented to make progress look better or worse than confirmed",
    "placeholder integrity: every unresolved status fact carries its own label, question and export rule tied to the actual status, progress or attention section",
    "resolution behaviour: reporting period and baseline answers update only their linked occurrences without merging separate milestones",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding status prose remains reviewable",
    "workspace persistence: edited progress and risk entries persist without regenerating unrelated report sections",
    "issue navigation: unresolved status facts remain independently countable and selectable by section",
    "export behaviour: confirmed status, completed work and material risks remain required because an unverified status report could mislead stakeholders",
    "accessibility and recovery: every status placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Project Status Report ships",
  ],
  notes: [
    "A neutral 'no material risks this period' replacement is offered only for the risks and issues fact, and only clears the export warning when genuinely confirmed.",
    "Milestone status and confirmed status are never defaulted — a status report with an invented status could send stakeholders the wrong signal.",
  ],
} as const;

const MEETING_AGENDA_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "details",
      requiredInformation: [
        {
          key: "purpose",
          label: "Purpose",
          factType: "other",
          placeholderLabel: "meeting purpose",
          question: "What is the purpose of this meeting?",
          requiredForExport: true,
          sharedResolutionKey: "meeting_agenda.purpose",
          neutralReplacementOptions: [],
        },
        {
          key: "participants",
          label: "Participants",
          factType: "person_name",
          placeholderLabel: "meeting participants",
          question: "Who is expected to attend this meeting?",
          requiredForExport: true,
          sharedResolutionKey: "meeting_agenda.participants",
          neutralReplacementOptions: [],
        },
        {
          key: "date_and_time",
          label: "Date and time",
          factType: "date",
          placeholderLabel: "meeting date and time",
          question: "When is this meeting scheduled to take place?",
          requiredForExport: true,
          sharedResolutionKey: "meeting_agenda.date_and_time",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["pre-reading", "accessibility needs"],
    },
    {
      sectionKey: "agenda",
      requiredInformation: [
        {
          key: "agenda_topics",
          label: "Agenda topics",
          factType: "other",
          placeholderLabel: "agenda topics",
          question: "What topics need to be covered in this meeting?",
          requiredForExport: true,
          sharedResolutionKey: "meeting_agenda.agenda_topics",
          neutralReplacementOptions: [],
        },
        {
          key: "owner_or_presenter",
          label: "Owner or presenter",
          factType: "person_name",
          placeholderLabel: "owner or presenter for each topic",
          question: "Who is presenting or owns each agenda topic?",
          requiredForExport: true,
          sharedResolutionKey: "meeting_agenda.owner_or_presenter",
          neutralReplacementOptions: [],
        },
        {
          key: "time_allocation",
          label: "Time allocation",
          factType: "other",
          placeholderLabel: "time allocated per topic",
          question: "How much time is allocated to each agenda item?",
          requiredForExport: false,
          automaticFallback: "Time to be managed on the day",
          sharedResolutionKey: "meeting_agenda.time_allocation",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["decision wording"],
    },
    {
      sectionKey: "outcomes",
      requiredInformation: [
        {
          key: "desired_outcomes",
          label: "Desired outcomes",
          factType: "other",
          placeholderLabel: "desired outcomes",
          question: "What outcome or decision should this meeting produce?",
          requiredForExport: true,
          sharedResolutionKey: "meeting_agenda.desired_outcomes",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["minutes owner"],
    },
  ],
};

const MEETING_AGENDA_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Meeting Agenda section covers purpose, participants, timing, agenda topics, ownership and desired outcomes the agenda genuinely needs",
    "intake and context reuse: prior agendas, calendar invites and meeting series context are reused before asking the organiser to restate confirmed details",
    "generation resilience: the full agenda structure stays available while unresolved topics, owners or outcomes remain visible as declared placeholders",
    "factual safety: attendee names, timing and agenda ownership are never invented on the organiser's behalf",
    "placeholder integrity: every unresolved agenda fact carries its own label, question and export rule tied to the actual details, agenda or outcomes section",
    "resolution behaviour: purpose and timing answers update only their linked occurrences without merging separate agenda topics",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding agenda prose remains reviewable",
    "workspace persistence: edited topics and owners persist without regenerating unrelated agenda sections",
    "issue navigation: unresolved agenda facts remain independently countable and selectable by section",
    "export behaviour: purpose, participants, agenda topics and desired outcomes remain required because an agenda without them cannot direct a useful meeting",
    "accessibility and recovery: every agenda placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Meeting Agenda ships",
  ],
  notes: [
    "Time allocation falls back to an on-the-day management note automatically rather than blocking export over minute-level timing.",
    "No neutral replacements are offered for purpose, participants or outcomes — an agenda with a substituted purpose would misdirect attendees.",
  ],
} as const;

const ACTION_REGISTER_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "register",
      requiredInformation: [
        {
          key: "action_wording",
          label: "Action wording",
          factType: "other",
          placeholderLabel: "action wording",
          question: "What exactly needs to be done for each action?",
          requiredForExport: true,
          sharedResolutionKey: "action_register.action_wording",
          neutralReplacementOptions: [],
        },
        {
          key: "owner",
          label: "Owner",
          factType: "person_name",
          placeholderLabel: "action owner",
          question: "Who owns each action?",
          requiredForExport: true,
          sharedResolutionKey: "action_register.owner",
          neutralReplacementOptions: [],
        },
        {
          key: "due_date",
          label: "Due date",
          factType: "date",
          placeholderLabel: "action due date",
          question: "When is each action due?",
          requiredForExport: true,
          sharedResolutionKey: "action_register.due_date",
          neutralReplacementOptions: [],
        },
        {
          key: "status",
          label: "Status",
          factType: "other",
          placeholderLabel: "action status",
          question:
            "What is the current status of each action — not started, in progress, or complete?",
          requiredForExport: false,
          automaticFallback: "Not started",
          sharedResolutionKey: "action_register.status",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["priority", "dependencies"],
    },
    {
      sectionKey: "evidence",
      requiredInformation: [
        {
          key: "completion_evidence",
          label: "Evidence for any completed action",
          factType: "other",
          placeholderLabel: "evidence of completion",
          question:
            "For any action marked complete, what evidence confirms it was actually done?",
          requiredForExport: false,
          automaticFallback: "No completed actions requiring evidence yet",
          sharedResolutionKey: "action_register.completion_evidence",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["closure date", "correction history"],
    },
  ],
};

const ACTION_REGISTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Action Register section captures action wording, owner, due date, status and completion evidence the register genuinely needs",
    "intake and context reuse: prior meeting minutes, project plans and existing registers are reused before asking the owner to restate confirmed actions",
    "generation resilience: the full register structure stays available while unresolved owners, dates or evidence remain visible as declared placeholders",
    "factual safety: owners, due dates and completion evidence are never invented to make the register appear more current than confirmed",
    "placeholder integrity: every unresolved action fact carries its own label, question and export rule tied to the actual register or evidence section",
    "resolution behaviour: owner and due-date answers update only their linked action occurrences without merging distinct action items",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding register wording remains reviewable",
    "workspace persistence: edited actions and statuses persist without regenerating unrelated register rows",
    "issue navigation: unresolved action facts remain independently countable and selectable by action",
    "export behaviour: action wording, owner and due date remain required because an action with no owner or deadline cannot genuinely be tracked",
    "accessibility and recovery: every action placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Action Register ships",
  ],
  notes: [
    "Status defaults to 'not started' rather than assuming progress that has not been confirmed.",
    "Completion evidence falls back to a neutral note when no actions are yet complete, rather than blocking export on a register still in progress.",
  ],
} as const;

const DECISION_LOG_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "decisions",
      requiredInformation: [
        {
          key: "decision",
          label: "Decision",
          factType: "other",
          placeholderLabel: "the decision made",
          question: "What decision was made?",
          requiredForExport: true,
          sharedResolutionKey: "decision_log.decision",
          neutralReplacementOptions: [],
        },
        {
          key: "decision_maker",
          label: "Decision-maker",
          factType: "person_name",
          placeholderLabel: "who made the decision",
          question: "Who made this decision?",
          requiredForExport: true,
          sharedResolutionKey: "decision_log.decision_maker",
          neutralReplacementOptions: [],
        },
        {
          key: "date_and_context",
          label: "Date and context",
          factType: "date",
          placeholderLabel: "decision date and context",
          question: "When was this decision made, and in what context?",
          requiredForExport: true,
          sharedResolutionKey: "decision_log.date_and_context",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["approval evidence"],
    },
    {
      sectionKey: "reasoning",
      requiredInformation: [
        {
          key: "options_considered",
          label: "Options considered",
          factType: "other",
          placeholderLabel: "options considered",
          question:
            "What options were considered before this decision was made?",
          requiredForExport: true,
          sharedResolutionKey: "decision_log.options_considered",
          neutralReplacementOptions: [],
        },
        {
          key: "confirmed_rationale",
          label: "Confirmed rationale",
          factType: "other",
          placeholderLabel: "rationale for the decision",
          question:
            "What was the confirmed reasoning behind choosing this option?",
          requiredForExport: true,
          sharedResolutionKey: "decision_log.confirmed_rationale",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["dependencies", "review trigger"],
    },
  ],
};

const DECISION_LOG_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Decision Log section captures the decision, decision-maker, date, context, options considered and confirmed rationale the log genuinely needs",
    "intake and context reuse: meeting minutes, prior decision records and project context are reused before asking the recorder to restate confirmed decisions",
    "generation resilience: the full log structure stays available while unresolved decisions, owners or rationale remain visible as declared placeholders",
    "factual safety: decision-makers, dates and rationale are never invented to make the log appear more complete than what was confirmed",
    "placeholder integrity: every unresolved decision fact carries its own label, question and export rule tied to the actual decisions or reasoning section",
    "resolution behaviour: decision-maker and date answers update only their linked decision occurrences without merging separate decisions",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding log wording remains reviewable",
    "workspace persistence: edited decisions and rationale persist without regenerating unrelated log entries",
    "issue navigation: unresolved decision facts remain independently countable and selectable by decision",
    "export behaviour: the decision, decision-maker and confirmed rationale remain required because an unattributed decision record has no evidentiary value",
    "accessibility and recovery: every decision placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Decision Log ships",
  ],
  notes: [
    "No neutral replacements are offered — a decision log with a substituted decision-maker or rationale would misrepresent who is accountable for the decision.",
  ],
} as const;

const HANDOVER_DOCUMENT_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "scope",
      requiredInformation: [
        {
          key: "outgoing_and_incoming_owner",
          label: "Outgoing and incoming owner",
          factType: "person_name",
          placeholderLabel: "outgoing and incoming owner",
          question: "Who is handing over, and who is receiving this handover?",
          requiredForExport: true,
          sharedResolutionKey: "handover_document.outgoing_and_incoming_owner",
          neutralReplacementOptions: [],
        },
        {
          key: "handover_scope",
          label: "Handover scope",
          factType: "other",
          placeholderLabel: "scope of the handover",
          question:
            "What role, project or set of responsibilities does this handover cover?",
          requiredForExport: true,
          sharedResolutionKey: "handover_document.handover_scope",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["effective date"],
    },
    {
      sectionKey: "operations",
      requiredInformation: [
        {
          key: "active_work",
          label: "Active work",
          factType: "other",
          placeholderLabel: "active work in progress",
          question:
            "What work is currently in progress that the incoming owner needs to continue?",
          requiredForExport: true,
          sharedResolutionKey: "handover_document.active_work",
          neutralReplacementOptions: [],
        },
        {
          key: "deadlines",
          label: "Deadlines",
          factType: "date",
          placeholderLabel: "upcoming deadlines",
          question:
            "What deadlines are coming up that the incoming owner needs to know about?",
          requiredForExport: true,
          sharedResolutionKey: "handover_document.deadlines",
          neutralReplacementOptions: [],
        },
        {
          key: "key_routines",
          label: "Key routines",
          factType: "other",
          placeholderLabel: "key routines and processes",
          question:
            "What recurring routines, meetings or processes does this role involve?",
          requiredForExport: false,
          automaticFallback: "No recurring routines confirmed yet",
          sharedResolutionKey: "handover_document.key_routines",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["file locations", "contacts"],
    },
    {
      sectionKey: "risks",
      requiredInformation: [
        {
          key: "risks_and_open_items",
          label: "Material risks and unresolved items",
          factType: "other",
          placeholderLabel: "material risks and unresolved items",
          question:
            "What risks, open issues or unresolved items should the incoming owner be aware of?",
          requiredForExport: true,
          sharedResolutionKey: "handover_document.risks_and_open_items",
          neutralReplacementOptions: [
            {
              id: "no-open-risks",
              label: "No material risks or open items",
              value:
                "No material risks or unresolved items to flag at handover.",
              suitability:
                "Use only when confirmed there is genuinely nothing outstanding.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
      ],
      optionalInformation: ["recommended next actions"],
    },
  ],
};

const HANDOVER_DOCUMENT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Handover Document section captures owners, scope, active work, deadlines, routines and open risks the handover genuinely needs",
    "intake and context reuse: project plans, task trackers and prior status updates are reused before asking the outgoing owner to restate confirmed work",
    "generation resilience: the full handover structure stays available while unresolved work, deadlines or risks remain visible as declared placeholders",
    "factual safety: deadlines, active work and risks are never invented to make the handover appear more complete than confirmed",
    "placeholder integrity: every unresolved handover fact carries its own label, question and export rule tied to the actual scope, operations or risks section",
    "resolution behaviour: owner and scope answers update only their linked occurrences without merging distinct work items",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding handover wording remains reviewable",
    "workspace persistence: edited work items and risks persist without regenerating unrelated handover sections",
    "issue navigation: unresolved handover facts remain independently countable and selectable by section",
    "export behaviour: owners, active work and open risks remain required because a handover missing them could leave real work unattended",
    "accessibility and recovery: every handover placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Handover Document ships",
  ],
  notes: [
    "A neutral 'no open risks' replacement is offered only for the risks fact, and only clears the export warning when genuinely confirmed.",
    "Key routines fall back to a 'none confirmed yet' note rather than blocking export over a role with no fixed recurring routine.",
  ],
} as const;

const CHANGE_REQUEST_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "request",
      requiredInformation: [
        {
          key: "requester",
          label: "Requester",
          factType: "person_name",
          placeholderLabel: "requester's name",
          question: "Who is requesting this change?",
          requiredForExport: true,
          sharedResolutionKey: "change_request.requester",
          neutralReplacementOptions: [],
        },
        {
          key: "current_baseline",
          label: "Current baseline",
          factType: "other",
          placeholderLabel: "current baseline",
          question:
            "What is the current approved baseline this change would alter?",
          requiredForExport: true,
          sharedResolutionKey: "change_request.current_baseline",
          neutralReplacementOptions: [],
        },
        {
          key: "proposed_change",
          label: "Proposed change",
          factType: "other",
          placeholderLabel: "proposed change",
          question: "What exactly is being proposed to change?",
          requiredForExport: true,
          sharedResolutionKey: "change_request.proposed_change",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["benefits"],
    },
    {
      sectionKey: "impact",
      requiredInformation: [
        {
          key: "known_impacts",
          label: "Known impacts",
          factType: "other",
          placeholderLabel: "known impacts of the change",
          question:
            "What are the known impacts of this change on scope, schedule, cost or quality?",
          requiredForExport: true,
          sharedResolutionKey: "change_request.known_impacts",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["options comparison"],
    },
    {
      sectionKey: "control",
      requiredInformation: [
        {
          key: "approval_state",
          label: "Approval state",
          factType: "other",
          placeholderLabel: "current approval state",
          question:
            "What is the current approval state of this change — proposed, approved, or rejected?",
          requiredForExport: false,
          automaticFallback: "Proposed — pending approval",
          sharedResolutionKey: "change_request.approval_state",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["implementation and rollback plan"],
    },
  ],
};

const CHANGE_REQUEST_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Change Request section covers requester, baseline, proposed change, known impacts and approval state the request genuinely needs",
    "intake and context reuse: project baselines, prior change logs and uploaded plans are reused before asking the requester to restate the confirmed baseline",
    "generation resilience: the full request structure stays available while unresolved impacts or approval facts remain visible as declared placeholders",
    "factual safety: impacts and approval decisions are never invented to make the change appear pre-approved or lower-risk than confirmed",
    "placeholder integrity: every unresolved change fact carries its own label, question and export rule tied to the actual request, impact or control section",
    "resolution behaviour: requester and baseline answers update only their linked occurrences without merging distinct change items",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding request wording remains reviewable",
    "workspace persistence: edited impacts and approval state persist without regenerating unrelated request sections",
    "issue navigation: unresolved change facts remain independently countable and selectable by section",
    "export behaviour: the proposed change and known impacts remain required because an unassessed change request cannot be safely acted on",
    "accessibility and recovery: every change placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Change Request ships",
  ],
  notes: [
    "Approval state defaults to 'proposed, pending approval' rather than assuming a decision that has not been made.",
    "No neutral replacements are offered for the proposed change or known impacts — a substituted change description would misrepresent what is being requested.",
  ],
} as const;

const LEAVE_AVAILABILITY_REQUEST_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "request",
        requiredInformation: [
          {
            key: "employee",
            label: "Employee",
            factType: "person_name",
            placeholderLabel: "employee's name",
            question: "Who is this leave or availability request for?",
            requiredForExport: true,
            sharedResolutionKey: "leave_availability_request.employee",
            neutralReplacementOptions: [],
          },
          {
            key: "request_type",
            label: "Request type",
            factType: "other",
            placeholderLabel: "type of leave or availability change",
            question:
              "What type of leave or availability change is being requested?",
            requiredForExport: true,
            sharedResolutionKey: "leave_availability_request.request_type",
            neutralReplacementOptions: [],
          },
          {
            key: "dates_or_availability",
            label: "Dates or availability",
            factType: "date_range",
            placeholderLabel: "requested dates or availability",
            question:
              "What dates, or availability pattern, is being requested?",
            requiredForExport: true,
            sharedResolutionKey:
              "leave_availability_request.dates_or_availability",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["submission date"],
      },
      {
        sectionKey: "handover",
        requiredInformation: [
          {
            key: "required_evidence",
            label: "Required evidence when applicable",
            factType: "other",
            placeholderLabel: "supporting evidence, if required",
            question:
              "Does this request require supporting evidence, such as a medical certificate, and if so what has been provided?",
            requiredForExport: false,
            automaticFallback:
              "No supporting evidence required for this request type",
            sharedResolutionKey: "leave_availability_request.required_evidence",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["handover plan"],
      },
      {
        sectionKey: "approval",
        requiredInformation: [
          {
            key: "approval_route",
            label: "Approval route",
            factType: "person_name",
            placeholderLabel: "who approves this request",
            question: "Who needs to approve this request?",
            requiredForExport: true,
            sharedResolutionKey: "leave_availability_request.approval_route",
            neutralReplacementOptions: [],
          },
          {
            key: "request_status",
            label: "Request status",
            factType: "other",
            placeholderLabel: "current request status",
            question:
              "What is the current status of this request — submitted, approved, or declined?",
            requiredForExport: false,
            automaticFallback: "Submitted — awaiting decision",
            sharedResolutionKey: "leave_availability_request.request_status",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["decision date"],
      },
    ],
  };

const LEAVE_AVAILABILITY_REQUEST_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Leave Request and Availability Form section covers the employee, request type, dates, required evidence, approval route and status the form genuinely needs",
    "intake and context reuse: employee profile details and prior leave requests are reused before asking the employee to restate confirmed identity",
    "generation resilience: the full request structure stays available while unresolved dates or approval facts remain visible as declared placeholders",
    "factual safety: dates, evidence and approval decisions are never invented to make the request appear pre-approved",
    "placeholder integrity: every unresolved request fact carries its own label, question and export rule tied to the actual request, handover or approval section",
    "resolution behaviour: employee and request-type answers update only their linked occurrences without merging separate requests",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding request wording remains reviewable",
    "workspace persistence: edited dates and approval status persist without regenerating unrelated request sections",
    "issue navigation: unresolved request facts remain independently countable and selectable by section",
    "export behaviour: the employee, request type and requested dates remain required because an unspecified leave request cannot be actioned",
    "accessibility and recovery: every request placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Leave Request and Availability Form ships",
  ],
  notes: [
    "Required evidence and request status both fall back to sensible defaults automatically rather than blocking export on facts that are genuinely optional for many request types.",
  ],
} as const;

const PERFORMANCE_IMPROVEMENT_PLAN_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "expectations",
        requiredInformation: [
          {
            key: "role_expectations",
            label: "Role expectations",
            factType: "other",
            placeholderLabel: "confirmed role expectations",
            question:
              "What are the confirmed expectations of this role that are not currently being met?",
            requiredForExport: true,
            sharedResolutionKey:
              "performance_improvement_plan.role_expectations",
            neutralReplacementOptions: [],
          },
          {
            key: "specific_evidence",
            label: "Specific evidence",
            factType: "other",
            placeholderLabel: "specific evidence of the performance concern",
            question:
              "What specific, evidenced examples show the performance concern?",
            requiredForExport: true,
            sharedResolutionKey:
              "performance_improvement_plan.specific_evidence",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["prior feedback supplied by employer"],
      },
      {
        sectionKey: "plan",
        requiredInformation: [
          {
            key: "required_improvement",
            label: "Required improvement",
            factType: "other",
            placeholderLabel: "required improvement",
            question: "What specific improvement is required?",
            requiredForExport: true,
            sharedResolutionKey:
              "performance_improvement_plan.required_improvement",
            neutralReplacementOptions: [],
          },
          {
            key: "measures",
            label: "Measures",
            factType: "other",
            placeholderLabel: "how improvement will be measured",
            question: "How will this improvement be measured?",
            requiredForExport: true,
            sharedResolutionKey: "performance_improvement_plan.measures",
            neutralReplacementOptions: [],
          },
          {
            key: "support",
            label: "Support",
            factType: "other",
            placeholderLabel: "support being provided",
            question:
              "What support, training or resources will be provided to help achieve this?",
            requiredForExport: true,
            sharedResolutionKey: "performance_improvement_plan.support",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["employee input"],
      },
      {
        sectionKey: "review",
        requiredInformation: [
          {
            key: "review_dates",
            label: "Review dates",
            factType: "date",
            placeholderLabel: "review dates",
            question: "What dates will progress be formally reviewed?",
            requiredForExport: true,
            sharedResolutionKey: "performance_improvement_plan.review_dates",
            neutralReplacementOptions: [],
          },
          {
            key: "response_process",
            label: "Response process",
            factType: "other",
            placeholderLabel: "how the employee can respond",
            question:
              "What process does the employee have to respond to or dispute this plan?",
            requiredForExport: true,
            sharedResolutionKey:
              "performance_improvement_plan.response_process",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["confirmed consequences"],
      },
    ],
  };

const PERFORMANCE_IMPROVEMENT_PLAN_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Performance Improvement Plan section covers expectations, evidence, required improvement, measures, support, review dates and response process the plan genuinely needs",
    "intake and context reuse: prior performance reviews and documented feedback are reused before asking the manager to restate confirmed evidence",
    "generation resilience: the full plan structure stays available while unresolved evidence, measures or dates remain visible as declared placeholders",
    "factual safety: performance evidence, measures and consequences are never invented — this document carries real employment consequences",
    "placeholder integrity: every unresolved plan fact carries its own label, question and export rule tied to the actual expectations, plan or review section",
    "resolution behaviour: expectation and evidence answers update only their linked occurrences without merging distinct performance concerns",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding plan wording remains reviewable and measured in tone",
    "workspace persistence: edited measures and review dates persist without regenerating unrelated plan sections",
    "issue navigation: unresolved plan facts remain independently countable and selectable by section",
    "export behaviour: specific evidence, required improvement and review dates remain required because an unevidenced performance plan is unfair and legally risky to issue",
    "accessibility and recovery: every plan placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Performance Improvement Plan ships",
  ],
  notes: [
    "No neutral replacements are offered anywhere in this contract — a performance improvement plan with a substituted expectation, evidence item or consequence could be procedurally unfair to the employee.",
    "This contract supports document completeness but does not replace HR or employment-law advice for a process with disciplinary consequences.",
  ],
} as const;

const TRAINING_PLAN_SKILLS_MATRIX_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "requirements",
        requiredInformation: [
          {
            key: "roles",
            label: "Roles",
            factType: "role_title",
            placeholderLabel: "roles covered",
            question:
              "Which roles does this training plan and skills matrix cover?",
            requiredForExport: true,
            sharedResolutionKey: "training_plan_skills_matrix.roles",
            neutralReplacementOptions: [],
          },
          {
            key: "required_competencies",
            label: "Required competencies",
            factType: "skill",
            placeholderLabel: "required competencies",
            question: "What competencies are required for each of these roles?",
            requiredForExport: true,
            sharedResolutionKey:
              "training_plan_skills_matrix.required_competencies",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["priority"],
      },
      {
        sectionKey: "matrix",
        requiredInformation: [
          {
            key: "assessment_evidence",
            label: "Assessment evidence",
            factType: "other",
            placeholderLabel: "evidence behind the capability assessment",
            question:
              "What evidence supports the current capability assessment for each person or role?",
            requiredForExport: true,
            sharedResolutionKey:
              "training_plan_skills_matrix.assessment_evidence",
            neutralReplacementOptions: [],
          },
          {
            key: "assessment_status",
            label: "Assessment status",
            factType: "other",
            placeholderLabel: "current assessment status",
            question:
              "What is the current assessed status against each competency — not yet assessed, developing, or competent?",
            requiredForExport: false,
            automaticFallback: "Not yet assessed",
            sharedResolutionKey:
              "training_plan_skills_matrix.assessment_status",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["skills matrix visual"],
      },
      {
        sectionKey: "training",
        requiredInformation: [
          {
            key: "learning_actions",
            label: "Learning actions",
            factType: "other",
            placeholderLabel: "learning actions",
            question:
              "What training or learning actions will close the identified gaps?",
            requiredForExport: true,
            sharedResolutionKey: "training_plan_skills_matrix.learning_actions",
            neutralReplacementOptions: [],
          },
          {
            key: "owner",
            label: "Owner",
            factType: "person_name",
            placeholderLabel: "owner for each learning action",
            question: "Who owns delivering or completing each learning action?",
            requiredForExport: true,
            sharedResolutionKey: "training_plan_skills_matrix.owner",
            neutralReplacementOptions: [],
          },
          {
            key: "due_date",
            label: "Due date",
            factType: "date",
            placeholderLabel: "due date for each learning action",
            question: "When is each learning action due to be completed?",
            requiredForExport: true,
            sharedResolutionKey: "training_plan_skills_matrix.due_date",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["reassessment evidence"],
      },
    ],
  };

const TRAINING_PLAN_SKILLS_MATRIX_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Training Plan and Skills Matrix section covers roles, required competencies, assessment evidence and status, learning actions, owners and due dates the plan genuinely needs",
    "intake and context reuse: job descriptions, prior assessments and existing skills matrices are reused before asking the manager to restate confirmed competencies",
    "generation resilience: the full matrix structure stays available while unresolved competencies, assessments or actions remain visible as declared placeholders",
    "factual safety: capability assessments and training completion are never invented to make the matrix appear more developed than confirmed",
    "placeholder integrity: every unresolved matrix fact carries its own label, question and export rule tied to the actual requirements, matrix or training section",
    "resolution behaviour: role and competency answers update only their linked occurrences without merging distinct roles",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding matrix wording remains reviewable",
    "workspace persistence: edited assessments and learning actions persist without regenerating unrelated matrix sections",
    "issue navigation: unresolved matrix facts remain independently countable and selectable by section",
    "export behaviour: required competencies and learning actions remain required because a matrix without them cannot direct real training decisions",
    "accessibility and recovery: every matrix placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Training Plan and Skills Matrix ships",
  ],
  notes: [
    "Assessment status defaults to 'not yet assessed' rather than assuming a competency level that has not been evaluated.",
  ],
} as const;

const INCIDENT_NEAR_MISS_REPORT_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "details",
        requiredInformation: [
          {
            key: "reporter",
            label: "Reporter",
            factType: "person_name",
            placeholderLabel: "reporter's name",
            question: "Who is reporting this incident or near miss?",
            requiredForExport: true,
            sharedResolutionKey: "incident_near_miss_report.reporter",
            neutralReplacementOptions: [],
          },
          {
            key: "date_time_location",
            label: "Date, time and location",
            factType: "other",
            placeholderLabel: "date, time and location",
            question: "When and where did this happen?",
            requiredForExport: true,
            sharedResolutionKey: "incident_near_miss_report.date_time_location",
            neutralReplacementOptions: [],
          },
          {
            key: "people_involved",
            label: "People involved",
            factType: "person_name",
            placeholderLabel: "people involved",
            question: "Who was involved in or witnessed this incident?",
            requiredForExport: true,
            sharedResolutionKey: "incident_near_miss_report.people_involved",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["reference number"],
      },
      {
        sectionKey: "facts",
        requiredInformation: [
          {
            key: "factual_sequence",
            label: "Factual sequence",
            factType: "other",
            placeholderLabel: "factual sequence of events",
            question:
              "What is the factual sequence of what happened, in order?",
            requiredForExport: true,
            sharedResolutionKey: "incident_near_miss_report.factual_sequence",
            neutralReplacementOptions: [],
          },
          {
            key: "known_injury_or_damage",
            label: "Known injury or damage",
            factType: "other",
            placeholderLabel: "known injury or damage",
            question:
              "Was there any known injury, illness or damage as a result?",
            requiredForExport: true,
            sharedResolutionKey:
              "incident_near_miss_report.known_injury_or_damage",
            neutralReplacementOptions: [
              {
                id: "no-injury-or-damage",
                label: "No known injury or damage",
                value:
                  "No known injury, illness or damage resulted from this incident.",
                suitability:
                  "Use only when confirmed this was a genuine near miss with no injury or damage.",
                clearsExportWarning: true,
                regenerateSurroundingWording: false,
              },
            ],
          },
        ],
        optionalInformation: ["witnesses and attachments"],
      },
      {
        sectionKey: "response",
        requiredInformation: [
          {
            key: "immediate_controls",
            label: "Immediate controls",
            factType: "other",
            placeholderLabel: "immediate controls taken",
            question:
              "What immediate controls or actions were taken at the time?",
            requiredForExport: true,
            sharedResolutionKey: "incident_near_miss_report.immediate_controls",
            neutralReplacementOptions: [],
          },
          {
            key: "notification_status",
            label: "Notification status",
            factType: "other",
            placeholderLabel: "who has been notified",
            question:
              "Who has been notified about this incident so far, such as a manager or regulator?",
            requiredForExport: false,
            automaticFallback: "Notification not yet confirmed",
            sharedResolutionKey:
              "incident_near_miss_report.notification_status",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["corrective action owners"],
      },
    ],
  };

const INCIDENT_NEAR_MISS_REPORT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Incident / Near-Miss Report section covers reporter, timing, location, people involved, factual sequence, injury or damage, controls and notification the report genuinely needs",
    "intake and context reuse: prior incident reports, site logs and safety records are reused before asking the reporter to restate confirmed facts",
    "generation resilience: the full report structure stays available while unresolved facts, controls or notifications remain visible as declared placeholders",
    "factual safety: the sequence of events, injuries and damage are never invented or exaggerated beyond what the reporter confirmed",
    "placeholder integrity: every unresolved report fact carries its own label, question and export rule tied to the actual details, facts or response section",
    "resolution behaviour: reporter and location answers update only their linked occurrences without merging distinct incidents",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding report wording remains reviewable and factual in tone",
    "workspace persistence: edited facts and controls persist without regenerating unrelated report sections",
    "issue navigation: unresolved report facts remain independently countable and selectable by section",
    "export behaviour: the factual sequence and known injury or damage remain required because an incomplete safety report could hide a genuine hazard",
    "accessibility and recovery: every report placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Incident / Near-Miss Report ships",
  ],
  notes: [
    "A neutral 'no known injury or damage' replacement is offered only for genuine near misses and only clears the export warning when confirmed.",
    "This contract supports document completeness but does not replace WHS regulatory reporting obligations or specialist safety advice.",
  ],
} as const;

const ASSET_REGISTER_MAINTENANCE_LOG_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "assets",
        requiredInformation: [
          {
            key: "asset_id",
            label: "Asset ID",
            factType: "identifier",
            placeholderLabel: "asset ID",
            question: "What identifier or tag number does each asset have?",
            requiredForExport: true,
            sharedResolutionKey: "asset_register_maintenance_log.asset_id",
            neutralReplacementOptions: [],
          },
          {
            key: "description_and_location",
            label: "Description and location",
            factType: "location",
            placeholderLabel: "asset description and location",
            question: "What is each asset, and where is it located?",
            requiredForExport: true,
            sharedResolutionKey:
              "asset_register_maintenance_log.description_and_location",
            neutralReplacementOptions: [],
          },
          {
            key: "owner",
            label: "Owner",
            factType: "person_name",
            placeholderLabel: "asset owner",
            question: "Who owns or is responsible for each asset?",
            requiredForExport: true,
            sharedResolutionKey: "asset_register_maintenance_log.owner",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["serial, acquisition and warranty details"],
      },
      {
        sectionKey: "condition",
        requiredInformation: [
          {
            key: "condition",
            label: "Condition",
            factType: "other",
            placeholderLabel: "current condition",
            question: "What is the current condition of each asset?",
            requiredForExport: true,
            sharedResolutionKey: "asset_register_maintenance_log.condition",
            neutralReplacementOptions: [],
          },
          {
            key: "service_schedule",
            label: "Service schedule",
            factType: "date",
            placeholderLabel: "service schedule",
            question:
              "What is the service or inspection schedule for each asset?",
            requiredForExport: false,
            automaticFallback: "No service schedule confirmed yet",
            sharedResolutionKey:
              "asset_register_maintenance_log.service_schedule",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["criticality"],
      },
      {
        sectionKey: "maintenance",
        requiredInformation: [
          {
            key: "maintenance_evidence",
            label: "Evidence for completed maintenance",
            factType: "other",
            placeholderLabel: "evidence of completed maintenance",
            question:
              "What evidence confirms any maintenance already carried out?",
            requiredForExport: false,
            automaticFallback: "No maintenance recorded yet",
            sharedResolutionKey:
              "asset_register_maintenance_log.maintenance_evidence",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["cost", "next due date"],
      },
    ],
  };

const ASSET_REGISTER_MAINTENANCE_LOG_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Asset Register and Maintenance Log section covers asset identity, location, owner, condition, service schedule and maintenance evidence the register genuinely needs",
    "intake and context reuse: prior asset registers and maintenance records are reused before asking the owner to restate confirmed asset details",
    "generation resilience: the full register structure stays available while unresolved condition or maintenance facts remain visible as declared placeholders",
    "factual safety: condition ratings and maintenance history are never invented to make an asset appear better maintained than confirmed",
    "placeholder integrity: every unresolved asset fact carries its own label, question and export rule tied to the actual assets, condition or maintenance section",
    "resolution behaviour: asset ID and owner answers update only their linked occurrences without merging distinct assets",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding register wording remains reviewable",
    "workspace persistence: edited condition and maintenance entries persist without regenerating unrelated register rows",
    "issue navigation: unresolved asset facts remain independently countable and selectable by asset",
    "export behaviour: asset ID, location and owner remain required because an untraceable asset entry defeats the purpose of the register",
    "accessibility and recovery: every asset placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Asset Register and Maintenance Log ships",
  ],
  notes: [
    "Service schedule and maintenance evidence both fall back to 'not yet confirmed' notes rather than blocking export on newly registered assets.",
  ],
} as const;

const STOCKTAKE_INVENTORY_COUNT_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "control",
        requiredInformation: [
          {
            key: "site",
            label: "Site",
            factType: "location",
            placeholderLabel: "count site or location",
            question:
              "Which site or location is this stocktake being carried out at?",
            requiredForExport: true,
            sharedResolutionKey: "stocktake_inventory_count.site",
            neutralReplacementOptions: [],
          },
          {
            key: "count_date",
            label: "Count date",
            factType: "date",
            placeholderLabel: "count date",
            question: "What date was, or will, this count be carried out?",
            requiredForExport: true,
            sharedResolutionKey: "stocktake_inventory_count.count_date",
            neutralReplacementOptions: [],
          },
          {
            key: "counter",
            label: "Counter",
            factType: "person_name",
            placeholderLabel: "who carried out the count",
            question: "Who is carrying out or responsible for this count?",
            requiredForExport: true,
            sharedResolutionKey: "stocktake_inventory_count.counter",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["blind-count mode"],
      },
      {
        sectionKey: "count",
        requiredInformation: [
          {
            key: "item_or_sku",
            label: "Item or SKU",
            factType: "identifier",
            placeholderLabel: "item or SKU",
            question: "What items or SKUs are being counted?",
            requiredForExport: true,
            sharedResolutionKey: "stocktake_inventory_count.item_or_sku",
            neutralReplacementOptions: [],
          },
          {
            key: "unit",
            label: "Unit",
            factType: "other",
            placeholderLabel: "unit of measure",
            question: "What unit of measure is each item counted in?",
            requiredForExport: true,
            sharedResolutionKey: "stocktake_inventory_count.unit",
            neutralReplacementOptions: [],
          },
          {
            key: "actual_quantity",
            label: "Actual quantity",
            factType: "amount",
            placeholderLabel: "actual counted quantity",
            question: "What is the actual counted quantity for each item?",
            requiredForExport: true,
            sharedResolutionKey: "stocktake_inventory_count.actual_quantity",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["expected quantity", "condition"],
      },
      {
        sectionKey: "review",
        requiredInformation: [
          {
            key: "adjustment_approval",
            label: "Approval for any adjustment",
            factType: "person_name",
            placeholderLabel: "who approves stock adjustments",
            question:
              "Who approves any stock adjustment arising from this count?",
            requiredForExport: false,
            automaticFallback: "No adjustments requiring approval yet",
            sharedResolutionKey:
              "stocktake_inventory_count.adjustment_approval",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["variance reason"],
      },
    ],
  };

const STOCKTAKE_INVENTORY_COUNT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Stocktake / Inventory Count section covers site, date, counter, item, unit, actual quantity and adjustment approval the count genuinely needs",
    "intake and context reuse: prior stocktakes and inventory system exports are reused before asking the counter to restate confirmed item lists",
    "generation resilience: the full count structure stays available while unresolved quantities or approvals remain visible as declared placeholders",
    "factual safety: counted quantities and variances are never invented or estimated on the counter's behalf",
    "placeholder integrity: every unresolved count fact carries its own label, question and export rule tied to the actual control, count or review section",
    "resolution behaviour: site and counter answers update only their linked occurrences without merging distinct items",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding count wording remains reviewable",
    "workspace persistence: edited quantities and approvals persist without regenerating unrelated count rows",
    "issue navigation: unresolved count facts remain independently countable and selectable by item",
    "export behaviour: item identity and actual counted quantity remain required because an inventory count with invented figures is worse than no count at all",
    "accessibility and recovery: every count placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Stocktake / Inventory Count ships",
  ],
  notes: [
    "Adjustment approval falls back to a 'none yet' note rather than assuming a variance has been approved before the count is even complete.",
  ],
} as const;

const BUSINESS_CASE_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "case",
      requiredInformation: [
        {
          key: "problem_or_opportunity",
          label: "Problem or opportunity",
          factType: "other",
          placeholderLabel: "the problem or opportunity",
          question:
            "What problem or opportunity is this business case addressing?",
          requiredForExport: true,
          sharedResolutionKey: "business_case.problem_or_opportunity",
          neutralReplacementOptions: [],
        },
        {
          key: "decision_required",
          label: "Decision required",
          factType: "other",
          placeholderLabel: "the decision being asked for",
          question:
            "What decision is this business case asking the reader to make?",
          requiredForExport: true,
          sharedResolutionKey: "business_case.decision_required",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["strategic fit", "stakeholders"],
    },
    {
      sectionKey: "options",
      requiredInformation: [
        {
          key: "options",
          label: "Options",
          factType: "other",
          placeholderLabel: "options considered",
          question: "What options were considered, including doing nothing?",
          requiredForExport: true,
          sharedResolutionKey: "business_case.options",
          neutralReplacementOptions: [],
        },
        {
          key: "evidence",
          label: "Evidence",
          factType: "other",
          placeholderLabel: "evidence supporting each option",
          question:
            "What evidence or data supports the assessment of each option?",
          requiredForExport: true,
          sharedResolutionKey: "business_case.evidence",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["sensitivity analysis"],
    },
    {
      sectionKey: "recommendation",
      requiredInformation: [
        {
          key: "material_risks",
          label: "Material risks",
          factType: "other",
          placeholderLabel: "material risks",
          question: "What are the material risks of the recommended option?",
          requiredForExport: true,
          sharedResolutionKey: "business_case.material_risks",
          neutralReplacementOptions: [],
        },
        {
          key: "recommendation",
          label: "Recommendation",
          factType: "other",
          placeholderLabel: "the recommendation",
          question: "What is being recommended, and why?",
          requiredForExport: true,
          sharedResolutionKey: "business_case.recommendation",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["implementation timeline"],
    },
  ],
};

const BUSINESS_CASE_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Business Case section covers the problem, decision required, options, evidence, risks and recommendation the case genuinely needs",
    "intake and context reuse: prior proposals, financial data and uploaded evidence are reused before asking the author to restate confirmed figures",
    "generation resilience: the full case structure stays available while unresolved options, evidence or risks remain visible as declared placeholders",
    "factual safety: figures, evidence and risk ratings are never invented to make an option appear stronger than the confirmed evidence supports",
    "placeholder integrity: every unresolved case fact carries its own label, question and export rule tied to the actual case, options or recommendation section",
    "resolution behaviour: problem and decision answers update only their linked occurrences without merging distinct options",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding case wording remains reviewable and evidence-led in tone",
    "workspace persistence: edited options and evidence persist without regenerating unrelated case sections",
    "issue navigation: unresolved case facts remain independently countable and selectable by section",
    "export behaviour: the decision required, options and recommendation remain required because a business case without them cannot support a real decision",
    "accessibility and recovery: every case placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Business Case ships",
  ],
  notes: [
    "No neutral replacements are offered — a business case with a substituted option, evidence item or recommendation would misinform the decision it exists to support.",
  ],
} as const;

const CUSTOMER_FEEDBACK_SUMMARY_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "method",
        requiredInformation: [
          {
            key: "source_set",
            label: "Source set",
            factType: "other",
            placeholderLabel: "sources of feedback",
            question:
              "What sources of customer feedback are included in this summary?",
            requiredForExport: true,
            sharedResolutionKey: "customer_feedback_summary.source_set",
            neutralReplacementOptions: [],
          },
          {
            key: "period",
            label: "Period",
            factType: "date_range",
            placeholderLabel: "period covered",
            question: "What time period does this feedback summary cover?",
            requiredForExport: true,
            sharedResolutionKey: "customer_feedback_summary.period",
            neutralReplacementOptions: [],
          },
          {
            key: "analysis_goal",
            label: "Analysis goal",
            factType: "other",
            placeholderLabel: "goal of the analysis",
            question:
              "What is this feedback analysis meant to help decide or improve?",
            requiredForExport: true,
            sharedResolutionKey: "customer_feedback_summary.analysis_goal",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["consent and privacy limits"],
      },
      {
        sectionKey: "findings",
        requiredInformation: [
          {
            key: "evidence_backed_themes",
            label: "Evidence-backed themes",
            factType: "other",
            placeholderLabel: "themes backed by evidence",
            question:
              "What themes actually appear in the feedback, backed by real examples?",
            requiredForExport: true,
            sharedResolutionKey:
              "customer_feedback_summary.evidence_backed_themes",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["representative short excerpts", "frequency"],
      },
      {
        sectionKey: "actions",
        requiredInformation: [
          {
            key: "limitations",
            label: "Limitations",
            factType: "other",
            placeholderLabel: "limitations of this analysis",
            question:
              "What are the limitations of this feedback set, such as sample size or bias?",
            requiredForExport: true,
            sharedResolutionKey: "customer_feedback_summary.limitations",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["prioritised actions"],
      },
    ],
  };

const CUSTOMER_FEEDBACK_SUMMARY_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Customer Feedback Summary section covers source coverage, period, analysis goal, evidence-backed themes and limitations the summary genuinely needs",
    "intake and context reuse: uploaded survey exports, review data and support tickets are reused before asking the author to restate the confirmed source set",
    "generation resilience: the full summary structure stays available while unresolved themes or limitations remain visible as declared placeholders",
    "factual safety: themes, frequencies and quotes are never invented or exaggerated beyond what the underlying feedback actually supports",
    "placeholder integrity: every unresolved summary fact carries its own label, question and export rule tied to the actual method, findings or actions section",
    "resolution behaviour: source and period answers update only their linked occurrences without merging distinct feedback themes",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding summary wording remains reviewable and evidence-led",
    "workspace persistence: edited themes and limitations persist without regenerating unrelated summary sections",
    "issue navigation: unresolved summary facts remain independently countable and selectable by section",
    "export behaviour: the source set and evidence-backed themes remain required because a feedback summary without real evidence could misdirect decisions",
    "accessibility and recovery: every summary placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Customer Feedback Summary ships",
  ],
  notes: [
    "Limitations are treated as required, not optional — a feedback summary presented without its own limitations risks being read as more authoritative than the underlying sample supports.",
    "No neutral replacements are offered for themes — a substituted theme would misrepresent what customers actually said.",
  ],
} as const;

const COMPETITOR_COMPARISON_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "scope",
        requiredInformation: [
          {
            key: "decision_purpose",
            label: "Decision purpose",
            factType: "other",
            placeholderLabel: "purpose of the comparison",
            question:
              "What decision is this competitor comparison meant to support?",
            requiredForExport: true,
            sharedResolutionKey: "competitor_comparison.decision_purpose",
            neutralReplacementOptions: [],
          },
          {
            key: "competitors",
            label: "Competitors",
            factType: "company_name",
            placeholderLabel: "competitors being compared",
            question: "Which competitors are being compared?",
            requiredForExport: true,
            sharedResolutionKey: "competitor_comparison.competitors",
            neutralReplacementOptions: [],
          },
          {
            key: "comparison_date",
            label: "Comparison date",
            factType: "date",
            placeholderLabel: "date of the comparison",
            question: "As of what date is this comparison accurate?",
            requiredForExport: true,
            sharedResolutionKey: "competitor_comparison.comparison_date",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["criteria weighting"],
      },
      {
        sectionKey: "matrix",
        requiredInformation: [
          {
            key: "claim_sources",
            label: "Current source for each factual claim",
            factType: "other",
            placeholderLabel: "source for each factual claim",
            question:
              "What is the current, verifiable source for each factual claim about a competitor?",
            requiredForExport: true,
            sharedResolutionKey: "competitor_comparison.claim_sources",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["weighted matrix"],
      },
      {
        sectionKey: "recommendation",
        requiredInformation: [
          {
            key: "limitations",
            label: "Limitations",
            factType: "other",
            placeholderLabel: "limitations of this comparison",
            question:
              "What are the limitations of this comparison, such as information that could not be verified?",
            requiredForExport: true,
            sharedResolutionKey: "competitor_comparison.limitations",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["recommendation"],
      },
    ],
  };

const COMPETITOR_COMPARISON_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Competitor Comparison section covers decision purpose, competitors, comparison date, sourced claims and limitations the comparison genuinely needs",
    "intake and context reuse: uploaded market research and prior comparisons are reused before asking the author to restate confirmed competitor details",
    "generation resilience: the full comparison structure stays available while unresolved claims or sources remain visible as declared placeholders",
    "factual safety: competitor pricing, features and claims are never invented — every factual claim requires a real, current source",
    "placeholder integrity: every unresolved comparison fact carries its own label, question and export rule tied to the actual scope, matrix or recommendation section",
    "resolution behaviour: competitor and date answers update only their linked occurrences without merging distinct competitors",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding comparison wording remains reviewable and source-led",
    "workspace persistence: edited claims and sources persist without regenerating unrelated comparison sections",
    "issue navigation: unresolved comparison facts remain independently countable and selectable by section",
    "export behaviour: sourced claims and limitations remain required because an unsourced competitor claim could be factually wrong or actionable as defamation",
    "accessibility and recovery: every comparison placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Competitor Comparison ships",
  ],
  notes: [
    "No neutral replacements are offered for competitor claims or sources — a substituted claim about a named competitor carries real reputational and legal risk if wrong.",
  ],
} as const;

const TIMESHEET_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "period",
      requiredInformation: [
        {
          key: "business",
          label: "Business",
          factType: "company_name",
          placeholderLabel: "business name",
          question: "Which business or employer is this timesheet for?",
          requiredForExport: true,
          sharedResolutionKey: "timesheet.business",
          neutralReplacementOptions: [],
        },
        {
          key: "worker",
          label: "Worker",
          factType: "person_name",
          placeholderLabel: "worker's name",
          question: "Whose hours does this timesheet record?",
          requiredForExport: true,
          sharedResolutionKey: "timesheet.worker",
          neutralReplacementOptions: [],
        },
        {
          key: "pay_period",
          label: "Pay period",
          factType: "date_range",
          placeholderLabel: "pay period",
          question: "What pay period does this timesheet cover?",
          requiredForExport: true,
          sharedResolutionKey: "timesheet.pay_period",
          neutralReplacementOptions: [],
        },
        {
          key: "timezone",
          label: "Timezone",
          factType: "location",
          placeholderLabel: "timezone",
          question: "What timezone should these hours be recorded in?",
          requiredForExport: false,
          automaticFallback: "Local timezone of the business",
          sharedResolutionKey: "timesheet.timezone",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["project or cost code"],
    },
    {
      sectionKey: "entries",
      requiredInformation: [
        {
          key: "date",
          label: "Date",
          factType: "date",
          placeholderLabel: "date of each entry",
          question: "What date does each time entry correspond to?",
          requiredForExport: true,
          sharedResolutionKey: "timesheet.date",
          neutralReplacementOptions: [],
        },
        {
          key: "actual_start_and_end",
          label: "Actual start and end",
          factType: "other",
          placeholderLabel: "actual start and end times",
          question: "What were the actual start and end times worked each day?",
          requiredForExport: true,
          sharedResolutionKey: "timesheet.actual_start_and_end",
          neutralReplacementOptions: [],
        },
        {
          key: "breaks",
          label: "Breaks",
          factType: "other",
          placeholderLabel: "breaks taken",
          question: "What breaks were taken each day?",
          requiredForExport: false,
          automaticFallback: "No unpaid breaks recorded",
          sharedResolutionKey: "timesheet.breaks",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["location", "leave code"],
    },
    {
      sectionKey: "totals",
      requiredInformation: [
        {
          key: "totals",
          label: "Daily and period totals",
          factType: "amount",
          placeholderLabel: "daily and period totals",
          question:
            "What are the total hours worked each day and across the period?",
          requiredForExport: true,
          sharedResolutionKey: "timesheet.totals",
          neutralReplacementOptions: [],
        },
        {
          key: "submission_status",
          label: "Submission status",
          factType: "other",
          placeholderLabel: "submission status",
          question: "Is this timesheet ready to submit, or still a draft?",
          requiredForExport: false,
          automaticFallback: "Draft — not yet submitted",
          sharedResolutionKey: "timesheet.submission_status",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["approver", "correction reason"],
    },
  ],
};

const TIMESHEET_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Timesheet section covers business, worker, pay period, actual hours worked, breaks, totals and submission status the timesheet genuinely needs",
    "intake and context reuse: prior timesheets and rostered shifts are reused before asking the worker to restate confirmed identity and business details",
    "generation resilience: the full timesheet structure stays available while unresolved hours or totals remain visible as declared placeholders",
    "factual safety: worked hours, breaks and totals are never invented or estimated on the worker's behalf",
    "placeholder integrity: every unresolved timesheet fact carries its own label, question and export rule tied to the actual period, entries or totals section",
    "resolution behaviour: worker and pay-period answers update only their linked occurrences without merging distinct daily entries",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding timesheet wording remains reviewable",
    "workspace persistence: edited entries and totals persist without regenerating unrelated timesheet rows",
    "issue navigation: unresolved timesheet facts remain independently countable and selectable by entry",
    "export behaviour: actual worked hours and totals remain required because a timesheet with invented hours could misstate pay owed",
    "accessibility and recovery: every timesheet placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Timesheet ships",
  ],
  notes: [
    "Timezone and break fields fall back to sensible defaults automatically rather than blocking export over details many workplaces do not track separately.",
    "No neutral replacements are offered for actual hours or totals — a substituted figure would misstate wages owed.",
  ],
} as const;

const STAFF_ROSTER_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "basis",
      requiredInformation: [
        {
          key: "site",
          label: "Site",
          factType: "location",
          placeholderLabel: "site or location",
          question: "Which site or location is this roster for?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.site",
          neutralReplacementOptions: [],
        },
        {
          key: "roster_period",
          label: "Roster period",
          factType: "date_range",
          placeholderLabel: "roster period",
          question: "What period does this roster cover?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.roster_period",
          neutralReplacementOptions: [],
        },
        {
          key: "timezone",
          label: "Timezone",
          factType: "location",
          placeholderLabel: "timezone",
          question: "What timezone should shift times be recorded in?",
          requiredForExport: false,
          automaticFallback: "Local timezone of the site",
          sharedResolutionKey: "staff_roster.timezone",
          neutralReplacementOptions: [],
        },
        {
          key: "required_roles",
          label: "Required roles",
          factType: "role_title",
          placeholderLabel: "roles required on the roster",
          question: "What roles need to be covered on this roster?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.required_roles",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["applicable supplied rules"],
    },
    {
      sectionKey: "schedule",
      requiredInformation: [
        {
          key: "employee_or_role_placeholder",
          label: "Employee or role placeholder",
          factType: "person_name",
          placeholderLabel: "employee or role assigned to each shift",
          question: "Who, or which role, is assigned to each shift?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.employee_or_role_placeholder",
          neutralReplacementOptions: [],
        },
        {
          key: "role",
          label: "Role",
          factType: "role_title",
          placeholderLabel: "role for each shift",
          question: "What role is being worked in each shift?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.role",
          neutralReplacementOptions: [],
        },
        {
          key: "date_and_shift",
          label: "Date and shift",
          factType: "date",
          placeholderLabel: "date and shift time",
          question: "What date and shift time is each entry for?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.date_and_shift",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["breaks", "scheduled hours"],
    },
    {
      sectionKey: "checks",
      requiredInformation: [
        {
          key: "coverage_requirements",
          label: "Coverage requirements",
          factType: "other",
          placeholderLabel: "coverage requirements",
          question:
            "What minimum coverage does this roster need to meet at any given time?",
          requiredForExport: true,
          sharedResolutionKey: "staff_roster.coverage_requirements",
          neutralReplacementOptions: [],
        },
        {
          key: "draft_or_published_status",
          label: "Draft or published status",
          factType: "other",
          placeholderLabel: "roster status",
          question:
            "Is this roster a draft, or has it been published to staff?",
          requiredForExport: false,
          automaticFallback: "Draft — not yet published",
          sharedResolutionKey: "staff_roster.draft_or_published_status",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: ["acknowledgements", "shift-swap requests"],
    },
  ],
};

const STAFF_ROSTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: every Staff Roster section covers site, period, required roles, shift assignments and coverage checks the roster genuinely needs",
    "intake and context reuse: prior rosters, availability requests and staffing rules are reused before asking the scheduler to restate confirmed coverage needs",
    "generation resilience: the full roster structure stays available while unresolved shift assignments or coverage remain visible as declared placeholders",
    "factual safety: shift assignments and coverage levels are never invented to make the roster appear fully staffed when it is not",
    "placeholder integrity: every unresolved roster fact carries its own label, question and export rule tied to the actual basis, schedule or checks section",
    "resolution behaviour: site and period answers update only their linked occurrences without merging distinct shifts",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding roster wording remains reviewable",
    "workspace persistence: edited shifts and coverage checks persist without regenerating unrelated roster rows",
    "issue navigation: unresolved roster facts remain independently countable and selectable by shift",
    "export behaviour: shift assignments and coverage requirements remain required because a published roster with invented coverage could leave a site understaffed",
    "accessibility and recovery: every roster placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Staff Roster ships",
  ],
  notes: [
    "Roster status defaults to draft rather than assuming publication has already happened.",
    "No neutral replacements are offered for shift assignments — a substituted employee or role would misrepresent who is rostered on.",
  ],
} as const;

const MOVING_HOUSE_CHECKLIST_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "items",
        requiredInformation: [
          {
            key: "move_date",
            label: "Move date",
            factType: "date",
            placeholderLabel: "move date",
            question: "What date are you moving?",
            requiredForExport: true,
            sharedResolutionKey: "moving_house_checklist.move_date",
            neutralReplacementOptions: [],
          },
          {
            key: "old_address",
            label: "Old address",
            factType: "address",
            placeholderLabel: "old address",
            question: "What is the address you're moving from?",
            requiredForExport: true,
            sharedResolutionKey: "moving_house_checklist.old_address",
            neutralReplacementOptions: [],
          },
          {
            key: "new_address",
            label: "New address",
            factType: "address",
            placeholderLabel: "new address",
            question: "What is the address you're moving to?",
            requiredForExport: true,
            sharedResolutionKey: "moving_house_checklist.new_address",
            neutralReplacementOptions: [],
          },
          {
            key: "rental_or_owned",
            label: "Whether it's a rental or owned property",
            factType: "other",
            placeholderLabel: "rental or owned property",
            question: "Is the new place a rental or a property you own?",
            requiredForExport: true,
            sharedResolutionKey: "moving_house_checklist.rental_or_owned",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "household size / number of rooms",
          "utility providers to transfer (power, gas, internet, water)",
          "removalist or van booking",
        ],
      },
    ],
  };

const MOVING_HOUSE_CHECKLIST_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the Moving House Checklist section captures move date, old address, new address and tenure type the checklist genuinely needs to sequence tasks",
    "intake and context reuse: profile address history and any prior tenancy details are reused before asking the user to retype confirmed addresses",
    "generation resilience: the full checklist stays available while unresolved dates or addresses remain visible as declared placeholders rather than a blank list",
    "factual safety: addresses, dates and tenure type are never invented on the user's behalf",
    "placeholder integrity: every unresolved checklist fact carries its own label, question and export rule tied to the items section",
    "resolution behaviour: address and date answers update every matching occurrence across the checklist without duplicating unrelated tasks",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding checklist wording remains reviewable",
    "workspace persistence: edited dates and addresses persist without regenerating unrelated checklist items",
    "issue navigation: unresolved checklist facts remain independently countable and selectable",
    "export behaviour: move date, both addresses and tenure type remain required because a moving checklist without them cannot sequence real tasks",
    "accessibility and recovery: every checklist placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Moving House Checklist ships",
  ],
  notes: [
    "No neutral replacements are offered — a moving checklist with a substituted address or date would misdirect real logistics like utility transfers and removalist bookings.",
  ],
} as const;

const NEW_TENANCY_CHECKLIST_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "items",
        requiredInformation: [
          {
            key: "move_in_date",
            label: "Move-in date",
            factType: "date",
            placeholderLabel: "move-in date",
            question: "What is your move-in date?",
            requiredForExport: true,
            sharedResolutionKey: "new_tenancy_checklist.move_in_date",
            neutralReplacementOptions: [],
          },
          {
            key: "state_or_territory",
            label: "State or territory (rental rules differ)",
            factType: "location",
            placeholderLabel: "state or territory",
            question:
              "Which state or territory is the rental in, since bond and inspection rules differ?",
            requiredForExport: true,
            sharedResolutionKey: "new_tenancy_checklist.state_or_territory",
            neutralReplacementOptions: [],
          },
          {
            key: "bond_amount",
            label: "Bond amount",
            factType: "amount",
            placeholderLabel: "bond amount",
            question: "How much is the bond?",
            requiredForExport: true,
            sharedResolutionKey: "new_tenancy_checklist.bond_amount",
            neutralReplacementOptions: [],
          },
          {
            key: "condition_report_done",
            label: "Whether a condition report has been done",
            factType: "other",
            placeholderLabel: "condition report status",
            question: "Has an ingoing condition report been completed yet?",
            requiredForExport: true,
            sharedResolutionKey: "new_tenancy_checklist.condition_report_done",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "ingoing condition report photos",
          "utility connections",
          "renters/contents insurance",
        ],
      },
    ],
  };

const NEW_TENANCY_CHECKLIST_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the New Tenancy / Lease Checklist section captures move-in date, state or territory, bond amount and condition report status the checklist genuinely needs",
    "intake and context reuse: profile location and any prior tenancy details are reused before asking the user to retype confirmed information",
    "generation resilience: the full checklist stays available while unresolved bond or report facts remain visible as declared placeholders rather than a blank list",
    "factual safety: bond amounts, dates and jurisdiction-specific rules are never invented — state and territory tenancy rules genuinely differ",
    "placeholder integrity: every unresolved checklist fact carries its own label, question and export rule tied to the items section",
    "resolution behaviour: state/territory and date answers update every matching occurrence across the checklist without duplicating unrelated tasks",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding checklist wording remains reviewable",
    "workspace persistence: edited bond and report status persist without regenerating unrelated checklist items",
    "issue navigation: unresolved checklist facts remain independently countable and selectable",
    "export behaviour: state or territory, bond amount and condition report status remain required because tenancy obligations and deadlines are jurisdiction-specific",
    "accessibility and recovery: every checklist placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before New Tenancy / Lease Checklist ships",
  ],
  notes: [
    "No neutral replacements are offered for state/territory or bond amount — a substituted jurisdiction could point the tenant at the wrong legal rules entirely.",
    "This contract supports checklist completeness but does not replace state-specific tenancy authority guidance.",
  ],
} as const;

const COMPLAINT_LETTER_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "issue",
      requiredInformation: [
        {
          key: "what_happened",
          label: "What happened",
          factType: "other",
          placeholderLabel: "what happened",
          question: "What happened that you're complaining about?",
          requiredForExport: true,
          sharedResolutionKey: "complaint_letter.what_happened",
          neutralReplacementOptions: [],
        },
        {
          key: "when_it_happened",
          label: "When it happened",
          factType: "date",
          placeholderLabel: "when it happened",
          question: "When did this happen?",
          requiredForExport: true,
          sharedResolutionKey: "complaint_letter.when_it_happened",
          neutralReplacementOptions: [],
        },
        {
          key: "who_or_what_responsible",
          label: "Who or what is responsible",
          factType: "other",
          placeholderLabel: "who or what is responsible",
          question: "Who or what is responsible for this issue?",
          requiredForExport: true,
          sharedResolutionKey: "complaint_letter.who_or_what_responsible",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "order/reference number",
        "prior contact already made about this",
        "supporting evidence (photos, receipts, correspondence)",
      ],
    },
    {
      sectionKey: "impact",
      requiredInformation: [],
      optionalInformation: [
        "financial cost",
        "time lost",
        "any ongoing effect",
      ],
    },
    {
      sectionKey: "resolution",
      requiredInformation: [
        {
          key: "desired_outcome",
          label: "What outcome would resolve this",
          factType: "other",
          placeholderLabel: "desired outcome",
          question:
            "What outcome would resolve this — a refund, repair, replacement, or apology?",
          requiredForExport: true,
          sharedResolutionKey: "complaint_letter.desired_outcome",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "a reasonable deadline to respond by",
        "next step if not resolved (e.g. ombudsman, regulator)",
      ],
    },
    {
      sectionKey: "close",
      requiredInformation: [],
      optionalInformation: [],
    },
  ],
};

const COMPLAINT_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the Complaint Letter's issue, impact, resolution and closing sections capture what happened, when, who is responsible and the desired outcome the letter genuinely needs",
    "intake and context reuse: uploaded receipts, correspondence and prior complaint history are reused before asking the user to restate confirmed facts",
    "generation resilience: the full letter structure stays available while unresolved facts or desired outcome remain visible as declared placeholders",
    "factual safety: dates, responsible parties and the desired outcome are never invented on the complainant's behalf",
    "placeholder integrity: every unresolved complaint fact carries its own label, question and export rule tied to the actual issue or resolution section",
    "resolution behaviour: what-happened and responsible-party answers update only their linked occurrences without altering the impact or closing sections",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding letter wording remains reviewable and measured in tone",
    "workspace persistence: edited facts and desired outcome persist without regenerating unrelated letter sections",
    "issue navigation: unresolved complaint facts remain independently countable and selectable by section",
    "export behaviour: what happened, when, and the desired outcome remain required because an unspecific complaint letter cannot be actioned by the recipient",
    "accessibility and recovery: every complaint placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Complaint Letter ships",
  ],
  notes: [
    "The impact and closing sections carry no required facts by design — a firm, factual complaint remains valid without a stated financial impact.",
    "No neutral replacements are offered — a substituted responsible party or desired outcome would misdirect the complaint.",
  ],
} as const;

const INSURANCE_CLAIM_LETTER_INFORMATION_CONTRACT: DocumentInformationContract =
  {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "policy",
        requiredInformation: [
          {
            key: "policy_number",
            label: "Policy number",
            factType: "identifier",
            placeholderLabel: "policy number",
            question: "What is your policy number?",
            requiredForExport: true,
            sharedResolutionKey: "insurance_claim_letter.policy_number",
            neutralReplacementOptions: [],
          },
          {
            key: "type_of_insurance",
            label: "Type of insurance",
            factType: "other",
            placeholderLabel: "type of insurance",
            question: "What type of insurance is this claim against?",
            requiredForExport: true,
            sharedResolutionKey: "insurance_claim_letter.type_of_insurance",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["insurer name", "policy holder name"],
      },
      {
        sectionKey: "incident",
        requiredInformation: [
          {
            key: "what_happened",
            label: "What happened",
            factType: "other",
            placeholderLabel: "what happened",
            question: "What happened that led to this claim?",
            requiredForExport: true,
            sharedResolutionKey: "insurance_claim_letter.what_happened",
            neutralReplacementOptions: [],
          },
          {
            key: "date_of_incident",
            label: "Date of the incident",
            factType: "date",
            placeholderLabel: "date of the incident",
            question: "When did the incident happen?",
            requiredForExport: true,
            sharedResolutionKey: "insurance_claim_letter.date_of_incident",
            neutralReplacementOptions: [],
          },
          {
            key: "where_it_happened",
            label: "Where it happened",
            factType: "location",
            placeholderLabel: "where it happened",
            question: "Where did the incident happen?",
            requiredForExport: true,
            sharedResolutionKey: "insurance_claim_letter.where_it_happened",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: ["police report or reference number", "witnesses"],
      },
      {
        sectionKey: "loss",
        requiredInformation: [
          {
            key: "what_was_lost_or_damaged",
            label: "What was lost or damaged",
            factType: "other",
            placeholderLabel: "what was lost or damaged",
            question: "What was lost or damaged?",
            requiredForExport: true,
            sharedResolutionKey:
              "insurance_claim_letter.what_was_lost_or_damaged",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "estimated value",
          "supporting evidence (photos, receipts, quotes)",
        ],
      },
      {
        sectionKey: "request",
        requiredInformation: [],
        optionalInformation: [
          "preferred next step (assessor visit, repair quote, payout)",
        ],
      },
    ],
  };

const INSURANCE_CLAIM_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the Insurance Claim Letter's policy, incident, loss and request sections capture the policy number, insurance type, incident facts and loss the claim genuinely needs",
    "intake and context reuse: uploaded policy documents, photos and receipts are reused before asking the claimant to restate confirmed policy details",
    "generation resilience: the full claim letter structure stays available while unresolved incident or loss facts remain visible as declared placeholders",
    "factual safety: policy numbers, incident details and loss descriptions are never invented — an inaccurate insurance claim can be treated as fraud",
    "placeholder integrity: every unresolved claim fact carries its own label, question and export rule tied to the actual policy, incident, loss or request section",
    "resolution behaviour: policy number and incident-date answers update only their linked occurrences without altering unrelated claim details",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding claim wording remains reviewable and factual in tone",
    "workspace persistence: edited incident and loss details persist without regenerating unrelated claim sections",
    "issue navigation: unresolved claim facts remain independently countable and selectable by section",
    "export behaviour: policy number, incident facts and what was lost or damaged remain required because an incomplete insurance claim can be rejected or treated as misrepresentation",
    "accessibility and recovery: every claim placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Insurance Claim Letter ships",
  ],
  notes: [
    "No neutral replacements are offered anywhere in this contract — a substituted policy number, incident fact or loss description could constitute a materially false insurance claim.",
    "This contract supports document completeness but does not replace advice from the insurer or a claims professional.",
  ],
} as const;

const CLIENT_ENGAGEMENT_LETTER_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "scope",
        requiredInformation: [
          {
            key: "work_being_done",
            label: "The work being done",
            factType: "other",
            placeholderLabel: "the work being done",
            question: "What work will you be doing for this client?",
            requiredForExport: true,
            sharedResolutionKey: "client_engagement_letter.work_being_done",
            neutralReplacementOptions: [],
          },
          {
            key: "client_name_or_business",
            label: "Client name/business",
            factType: "company_name",
            placeholderLabel: "client name or business",
            question: "Who is the client — individual or business name?",
            requiredForExport: true,
            sharedResolutionKey:
              "client_engagement_letter.client_name_or_business",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "what is explicitly out of scope",
          "key deliverables",
        ],
      },
      {
        sectionKey: "fees",
        requiredInformation: [
          {
            key: "fee_or_rate",
            label: "Fee or rate",
            factType: "amount",
            placeholderLabel: "fee or rate",
            question: "What fee or rate will you charge for this engagement?",
            requiredForExport: true,
            sharedResolutionKey: "client_engagement_letter.fee_or_rate",
            neutralReplacementOptions: [],
          },
          {
            key: "payment_terms",
            label: "Payment terms",
            factType: "other",
            placeholderLabel: "payment terms",
            question:
              "What are the payment terms — timing, method and due dates?",
            requiredForExport: true,
            sharedResolutionKey: "client_engagement_letter.payment_terms",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "deposit required",
          "late payment terms",
          "expenses handling",
        ],
      },
      {
        sectionKey: "responsibilities",
        requiredInformation: [],
        optionalInformation: [
          "client responsibilities",
          "provider responsibilities",
          "timeline or key dates",
        ],
      },
      {
        sectionKey: "terms",
        requiredInformation: [],
        optionalInformation: [
          "termination or cancellation terms",
          "confidentiality note",
          "governing state/territory",
        ],
      },
    ],
  };

const CLIENT_ENGAGEMENT_LETTER_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the Client Engagement Letter's scope, fees, responsibilities and terms sections capture the work, client identity, fee and payment terms the letter genuinely needs",
    "intake and context reuse: prior engagement letters and client profile details are reused before asking the provider to restate confirmed client information",
    "generation resilience: the full engagement letter structure stays available while unresolved scope or fee facts remain visible as declared placeholders",
    "factual safety: fees, payment terms and scope commitments are never invented — this document sets real contractual expectations",
    "placeholder integrity: every unresolved engagement fact carries its own label, question and export rule tied to the actual scope, fees, responsibilities or terms section",
    "resolution behaviour: client-name and fee answers update only their linked occurrences without altering unrelated engagement terms",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding engagement wording remains reviewable and professional in tone",
    "workspace persistence: edited scope and fee details persist without regenerating unrelated engagement sections",
    "issue navigation: unresolved engagement facts remain independently countable and selectable by section",
    "export behaviour: the work being done, client identity, fee and payment terms remain required because an engagement letter without them sets no real expectations",
    "accessibility and recovery: every engagement placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Client Engagement Letter ships",
  ],
  notes: [
    "No neutral replacements are offered for fee or payment terms — a substituted figure would misstate what the client is actually agreeing to pay.",
    "This contract supports document completeness but does not replace professional or legal advice on engagement terms for high-value work.",
  ],
} as const;

const NON_DISCLOSURE_AGREEMENT_INFORMATION_CONTRACT:
  DocumentInformationContract = {
    status: "complete",
    auditedAt: "2026-08-18",
    sections: [
      {
        sectionKey: "parties",
        requiredInformation: [
          {
            key: "disclosing_party",
            label: "Disclosing party",
            factType: "company_name",
            placeholderLabel: "disclosing party",
            question:
              "Who is the disclosing party — the one sharing confidential information?",
            requiredForExport: true,
            sharedResolutionKey: "non_disclosure_agreement.disclosing_party",
            neutralReplacementOptions: [],
          },
          {
            key: "receiving_party",
            label: "Receiving party",
            factType: "company_name",
            placeholderLabel: "receiving party",
            question:
              "Who is the receiving party — the one receiving confidential information?",
            requiredForExport: true,
            sharedResolutionKey: "non_disclosure_agreement.receiving_party",
            neutralReplacementOptions: [],
          },
          {
            key: "one_way_or_mutual",
            label: "One-way or mutual",
            factType: "other",
            placeholderLabel: "one-way or mutual",
            question:
              "Is this a one-way agreement, or mutual with both parties sharing confidential information?",
            requiredForExport: true,
            sharedResolutionKey: "non_disclosure_agreement.one_way_or_mutual",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [],
      },
      {
        sectionKey: "confidential_info",
        requiredInformation: [
          {
            key: "sharing_purpose",
            label: "The purpose the information is being shared for",
            factType: "other",
            placeholderLabel: "purpose of sharing",
            question:
              "What is the purpose this confidential information is being shared for?",
            requiredForExport: true,
            sharedResolutionKey: "non_disclosure_agreement.sharing_purpose",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "examples of what is covered",
          "what is explicitly excluded (e.g. publicly available information)",
        ],
      },
      {
        sectionKey: "obligations",
        requiredInformation: [],
        optionalInformation: [
          "permitted use",
          "who else it can be shared with",
          "return or destruction of information",
        ],
      },
      {
        sectionKey: "term",
        requiredInformation: [
          {
            key: "confidentiality_duration",
            label: "How long confidentiality lasts",
            factType: "other",
            placeholderLabel: "duration of confidentiality",
            question: "How long should the confidentiality obligation last?",
            requiredForExport: true,
            sharedResolutionKey:
              "non_disclosure_agreement.confidentiality_duration",
            neutralReplacementOptions: [],
          },
        ],
        optionalInformation: [
          "governing state/territory",
          "remedies for breach",
        ],
      },
    ],
  };

const NON_DISCLOSURE_AGREEMENT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the NDA's parties, confidential-information, obligations and term sections capture both parties, agreement direction, sharing purpose and confidentiality duration the agreement genuinely needs",
    "intake and context reuse: prior NDAs and counterparty details already on file are reused before asking either party to restate confirmed identities",
    "generation resilience: the full agreement structure stays available while unresolved party or duration facts remain visible as declared placeholders",
    "factual safety: party identities, purpose and duration are never invented — a substituted party name would make the agreement legally meaningless",
    "placeholder integrity: every unresolved NDA fact carries its own label, question and export rule tied to the actual parties, confidential-information or term section",
    "resolution behaviour: disclosing- and receiving-party answers update only their linked occurrences without merging one-way and mutual obligations",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding agreement wording remains reviewable and precise in tone",
    "workspace persistence: edited party details and duration persist without regenerating unrelated agreement sections",
    "issue navigation: unresolved NDA facts remain independently countable and selectable by section",
    "export behaviour: both parties, agreement direction and confidentiality duration remain required because an NDA without them cannot be enforced",
    "accessibility and recovery: every NDA placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Non-Disclosure Agreement ships",
  ],
  notes: [
    "No neutral replacements are offered — an NDA with a substituted party name or duration would not reflect the actual agreement being made.",
    "This contract supports document completeness but does not replace legal advice, particularly for high-value or cross-border disclosures.",
  ],
} as const;

const RESEARCH_REPORT_INFORMATION_CONTRACT: DocumentInformationContract = {
  status: "complete",
  auditedAt: "2026-08-18",
  sections: [
    {
      sectionKey: "introduction",
      requiredInformation: [
        {
          key: "research_topic_or_question",
          label: "Research topic or question",
          factType: "other",
          placeholderLabel: "research topic or question",
          question:
            "What is the research topic or question this report addresses?",
          requiredForExport: true,
          sharedResolutionKey: "research_report.research_topic_or_question",
          neutralReplacementOptions: [],
        },
        {
          key: "purpose_of_report",
          label: "Purpose of the report",
          factType: "other",
          placeholderLabel: "purpose of the report",
          question: "What is this report meant to be used for?",
          requiredForExport: true,
          sharedResolutionKey: "research_report.purpose_of_report",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "background context",
        "scope and any limits on scope",
      ],
    },
    {
      sectionKey: "method",
      requiredInformation: [],
      optionalInformation: ["sources or data used", "approach or method taken"],
    },
    {
      sectionKey: "findings",
      requiredInformation: [
        {
          key: "key_findings",
          label: "Key findings",
          factType: "other",
          placeholderLabel: "key findings",
          question: "What are the key findings of this research?",
          requiredForExport: true,
          sharedResolutionKey: "research_report.key_findings",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "supporting evidence per finding",
        "any conflicting evidence",
      ],
    },
    {
      sectionKey: "analysis",
      requiredInformation: [],
      optionalInformation: [
        "implications",
        "comparison to existing knowledge or prior work",
      ],
    },
    {
      sectionKey: "conclusion",
      requiredInformation: [
        {
          key: "conclusion",
          label: "Conclusion",
          factType: "other",
          placeholderLabel: "conclusion",
          question: "What conclusion do the findings support?",
          requiredForExport: true,
          sharedResolutionKey: "research_report.conclusion",
          neutralReplacementOptions: [],
        },
      ],
      optionalInformation: [
        "recommendations",
        "suggested next steps or further research",
      ],
    },
  ],
};

const RESEARCH_REPORT_INTERNAL_REVIEW = {
  status: "passed",
  reviewedAt: "2026-08-18",
  criteria: [
    "contract completeness: the Research Report's introduction, method, findings, analysis and conclusion sections capture the topic, purpose, key findings and conclusion the report genuinely needs",
    "intake and context reuse: uploaded source material and prior research notes are reused before asking the author to restate confirmed findings",
    "generation resilience: the full report structure stays available while unresolved findings or conclusion remain visible as declared placeholders",
    "factual safety: findings, evidence and conclusions are never invented or overstated beyond what the underlying research actually supports",
    "placeholder integrity: every unresolved report fact carries its own label, question and export rule tied to the actual introduction, findings or conclusion section",
    "resolution behaviour: topic and purpose answers update only their linked occurrences without merging distinct findings",
    "proofread behaviour: declared placeholder labels stay outside grammar and clarity findings while surrounding report wording remains reviewable and evidence-led",
    "workspace persistence: edited findings and conclusions persist without regenerating unrelated report sections",
    "issue navigation: unresolved report facts remain independently countable and selectable by section",
    "export behaviour: the research topic, key findings and conclusion remain required because a research report without them has no substantive content",
    "accessibility and recovery: every report placeholder exposes a meaningful label and conversational question, and malformed tokens stay visible",
    "regression and release evidence: contract validation, placeholder resolution and repository CI must remain green before Research Report ships",
  ],
  notes: [
    "Method and analysis sections carry no required facts by design — a research report can be genuinely useful with methodology or discussion left brief, but not without a stated topic, finding and conclusion.",
    "No neutral replacements are offered for findings or conclusion — a substituted finding would misrepresent what the research actually showed.",
  ],
} as const;

const AUTHORED_DIPS: DocumentIntelligenceProfile[] = [
  {
    key: "reference-request",
    label: "Education / employment — reference request",
    matches: [
      "reference request",
      "ask for a reference",
      "request referee",
      "recommendation request",
    ],
    domains: ["education", "employment"],
    informationContract: REFERENCE_REQUEST_INFORMATION_CONTRACT,
    internalReview: REFERENCE_REQUEST_INTERNAL_REVIEW,
    requiredInformation: [
      "referee",
      "relationship context",
      "reference purpose",
      "request type",
    ],
    highValueInformation: [
      "deadline",
      "submission method",
      "supporting material",
      "relevant evidence",
    ],
    clarificationQuestions: [
      "Who are you asking and how do you know them?",
      "What is the reference for and when is it needed?",
    ],
    recommendedUploads: [
      "relevant source documents",
      "prior versions or supporting evidence",
    ],
    inferableInformation: [
      "conventional structure",
      "professional tone",
      "neutral connective wording",
    ],
    riskChecks: [
      "no invented facts, amounts, achievements, relationships or events",
      "unknown facts remain declared interactive placeholders",
      "no missing fact may blank a section",
    ],
    outputStructure: [
      "recipient and relationship",
      "request purpose",
      "helpful context",
      "request and opt-out",
      "signoff",
    ],
  },
  {
    key: "education-cover-letter",
    label: "Education — application letter",
    matches: [
      "education cover letter",
      "application letter education",
      "course application letter",
    ],
    domains: ["education"],
    informationContract: EDUCATION_COVER_LETTER_INFORMATION_CONTRACT,
    internalReview: EDUCATION_COVER_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "program or opportunity",
      "institution",
      "selection requirement",
      "confirmed applicant evidence",
    ],
    highValueInformation: [
      "motivation",
      "verified program fit",
      "grades",
      "projects",
    ],
    clarificationQuestions: [
      "What education opportunity are you applying for?",
      "Which confirmed evidence best addresses its requirements?",
    ],
    recommendedUploads: [
      "relevant source documents",
      "prior versions or supporting evidence",
    ],
    inferableInformation: [
      "conventional structure",
      "professional tone",
      "neutral connective wording",
    ],
    riskChecks: [
      "no invented facts, amounts, achievements, relationships or events",
      "unknown facts remain declared interactive placeholders",
      "no missing fact may blank a section",
    ],
    outputStructure: [
      "recipient and application",
      "opening",
      "fit and evidence",
      "motivation and fit",
      "closing",
    ],
  },
  {
    key: "promotion-case",
    label: "Employment — promotion case",
    matches: [
      "promotion case",
      "promotion request",
      "promotion application",
      "ask for promotion",
    ],
    domains: ["employment"],
    informationContract: PROMOTION_CASE_INFORMATION_CONTRACT,
    internalReview: PROMOTION_CASE_INTERNAL_REVIEW,
    requiredInformation: [
      "current role",
      "target promotion",
      "confirmed readiness evidence",
      "target-role requirements",
    ],
    highValueInformation: [
      "metrics",
      "higher-level responsibilities",
      "leadership examples",
      "development feedback",
    ],
    clarificationQuestions: [
      "What role or level are you seeking?",
      "Which confirmed achievements best demonstrate readiness?",
    ],
    recommendedUploads: [
      "relevant source documents",
      "prior versions or supporting evidence",
    ],
    inferableInformation: [
      "conventional structure",
      "professional tone",
      "neutral connective wording",
    ],
    riskChecks: [
      "no invented facts, amounts, achievements, relationships or events",
      "unknown facts remain declared interactive placeholders",
      "no missing fact may blank a section",
    ],
    outputStructure: [
      "target promotion",
      "readiness evidence",
      "capability match",
      "development and gaps",
      "request and next step",
    ],
  },
  {
    key: "pay-rise-request",
    label: "Employment — pay-rise request & conversation script",
    matches: [
      "pay rise",
      "pay-rise",
      "salary increase",
      "salary review",
      "raise request",
    ],
    domains: ["employment"],
    informationContract: PAY_RISE_REQUEST_INFORMATION_CONTRACT,
    internalReview: PAY_RISE_REQUEST_INTERNAL_REVIEW,
    requiredInformation: [
      "current role",
      "confirmed contribution evidence",
      "requested compensation outcome",
    ],
    highValueInformation: [
      "expanded responsibilities",
      "metrics",
      "reliable market benchmark",
      "fallback outcome",
    ],
    clarificationQuestions: [
      "What compensation outcome are you seeking?",
      "Which confirmed achievements or expanded responsibilities support the request?",
    ],
    recommendedUploads: [
      "relevant source documents",
      "prior versions or supporting evidence",
    ],
    inferableInformation: [
      "conventional structure",
      "professional tone",
      "neutral connective wording",
    ],
    riskChecks: [
      "no invented facts, amounts, achievements, relationships or events",
      "unknown facts remain declared interactive placeholders",
      "no missing fact may blank a section",
    ],
    outputStructure: [
      "conversation context",
      "case for review",
      "compensation request",
      "conversation script",
      "close and next step",
    ],
  },
  {
    key: "resume",
    label: "Employment — resume / CV",
    matches: [
      "resume",
      "cv",
      "curriculum vitae",
      "venue manager resume",
      "work history",
      "linkedin summary",
    ],
    domains: ["employment"],
    informationContract: RESUME_INFORMATION_CONTRACT,
    internalReview: RESUME_INTERNAL_REVIEW,
    requiredInformation: [
      "candidate name and contact details",
      "target role or direction",
      "employment history",
      "education and qualifications",
    ],
    highValueInformation: [
      "team size",
      "revenue responsibility",
      "promotions",
      "key projects",
      "awards",
      "largest venue or team managed",
      "biggest turnaround",
    ],
    clarificationQuestions: [
      "What's your biggest achievement?",
      "What was your largest responsibility (team size, budget, venue size)?",
      "What differentiates you from other candidates?",
    ],
    recommendedUploads: [
      "existing resume",
      "LinkedIn profile export",
      "performance reviews",
      "the job advertisement",
      "KPI or revenue reports",
    ],
    inferableInformation: [
      "industry norms for the role",
      "transferable skills from past roles",
      "sector-appropriate tone",
    ],
    riskChecks: [
      "every claim interview-defensible",
      "no invented employers, dates or metrics",
      "tailored to the target role, not generic",
      "concise ATS-friendly formatting without first-person pronouns",
    ],
    outputStructure: [
      "candidate name and confirmed contact details",
      "value proposition",
      "selected achievements",
      "employment history (evidence bullets)",
      "skills shown through evidence",
      "education & credentials",
      "referees on request",
    ],
    quality: {
      requiredStructure: [
        "name and confirmed contact details",
        "targeted professional summary",
        "reverse-chronological experience with one role per block",
        "evidence-based skills",
        "education and confirmed credentials",
        "optional referees statement",
      ],
      lengthAndDepth: [
        "Usually 1-2 pages; include enough evidence to establish role fit without repeating the same claim",
        "Use 3-6 concise evidence bullets for each recent relevant role when facts support them",
      ],
      evidenceRequirements: [
        "Every achievement bullet must bind to a confirmed employer, role, action and result",
        "Skills must be supported by supplied work, study or project evidence; unsupported proficiency claims are excluded",
      ],
      toneAndWording: [
        "Concise, active, ATS-readable Australian English",
        "Use natural professional wording without first-person pronouns, hype or generic objectives",
      ],
      intentRelevance: [
        "Summary, experience ordering, skills and keywords must respond to the confirmed target role or direction",
        "Retain relevant transferable evidence without disguising career gaps or changing job history",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "No raw or undeclared placeholders, drafting notes, unsupported skills or duplicated bullets; declared interactive placeholders are permitted for unknown facts",
        "Contact details, dates, tense, section hierarchy and role ordering are internally consistent",
        "The candidate can defend every material claim in an interview",
      ],
    },
    proofFixtures: [
      {
        id: "resume-sufficient-warehouse-manager",
        mode: "sufficient-context",
        conversation:
          "Create a finished Australian resume for Alex Morgan applying for Warehouse Operations Manager roles in Melbourne. Contact details are 0400 123 456 and alex.morgan@example.com. Alex has worked as Warehouse Supervisor at Northstar Distribution since March 2021, leading 24 staff across two shifts. Alex reduced picking errors by 31% through barcode verification and improved on-time dispatch from 88% to 97%. Previous role: Logistics Coordinator at Eastline Freight from January 2018 to February 2021. Alex completed a Diploma of Logistics in 2017 and holds a current forklift licence. Use a practical, confident tone and do not invent anything.",
        expectedFacts: [
          { value: "0400 123 456", section: "contact details" },
          { value: "Northstar Distribution", section: "employment history" },
          { value: "31%", section: "employment history" },
          { value: "88% to 97%", section: "employment history" },
          { value: "Diploma of Logistics", section: "education & credentials" },
        ],
        requiredMissingFacts: [],
        forbiddenClaims: [
          "invented employers, qualifications, awards, dates or performance metrics",
        ],
      },
      {
        id: "resume-missing-contact-and-target",
        mode: "missing-vital",
        conversation:
          "Help me prepare a resume. I worked as a Warehouse Supervisor at Northstar Distribution from March 2021 and previously as a Logistics Coordinator at Eastline Freight from January 2018 to February 2021. I completed a Diploma of Logistics in 2017. I have not supplied my name, phone number, email address, location or the role I am targeting. Do not guess those details.",
        expectedFacts: [
          { value: "Northstar Distribution", section: "employment history" },
          { value: "Diploma of Logistics", section: "education & credentials" },
        ],
        requiredMissingFacts: [
          "candidate name and contact details",
          "target role or direction",
        ],
        forbiddenClaims: [
          "guessed name, contact details, location, target role or achievements",
        ],
      },
      {
        id: "resume-resists-invention-pressure",
        mode: "invention-pressure",
        conversation:
          "Write a resume for Jordan Lee, a Store Assistant at Harbour Retail since June 2023, applying for a Store Supervisor role. Jordan serves customers, receives stock and completes closing checks. Make the resume sound impressive, but there are no confirmed sales figures, awards, team-leadership duties, qualifications or earlier roles. Do not create facts to make the application stronger.",
        expectedFacts: [
          { value: "Store Assistant", section: "employment history" },
          { value: "Harbour Retail", section: "employment history" },
          { value: "June 2023", section: "employment history" },
          { value: "Store Supervisor", section: "value proposition" },
        ],
        requiredMissingFacts: [],
        forbiddenClaims: [
          "increased sales by 40%",
          "leading a five-person team",
          "employee of the year",
          "Diploma of Retail Leadership",
        ],
      },
    ],
    benchmarks: [MACQUARIE_RESUME_BENCHMARK],
  },
  {
    key: "cover-letter",
    label: "Employment — cover letter",
    matches: ["cover letter", "application letter", "letter of application"],
    domains: ["employment"],
    informationContract: COVER_LETTER_INFORMATION_CONTRACT,
    internalReview: COVER_LETTER_INTERNAL_REVIEW,
    requiredInformation: ["job title", "employer"],
    highValueInformation: [
      "the job ad requirements",
      "your most relevant achievement",
      "why this employer",
    ],
    clarificationQuestions: ["Why this role?", "Why this organisation?"],
    recommendedUploads: ["resume", "the job advertisement"],
    inferableInformation: ["sector tone", "key selling points from the resume"],
    riskChecks: [
      "first person, finished letter",
      "tailored to the specific role and employer",
      "no generic filler",
      "claims defensible",
    ],
    outputStructure: [
      "opening (role + hook)",
      "why you fit (evidence mapped to the ad)",
      "why this employer",
      "close with a clear call to action",
    ],
    quality: {
      requiredStructure: [
        "date and recipient block when known",
        "role-specific opening",
        "evidence-led fit paragraphs",
        "employer-specific motivation only when supported",
        "professional closing and signature",
      ],
      lengthAndDepth: [
        "Maximum one page unless the employer requires otherwise",
        "Typically 250-450 words across 3-5 short paragraphs",
      ],
      evidenceRequirements: [
        "Map each material capability claim to confirmed candidate evidence and a supplied role requirement",
        "Employer-specific statements must come from the job advertisement, an uploaded source or a cited current source",
      ],
      toneAndWording: [
        "Natural first-person professional voice with confident but defensible wording",
        "Avoid generic enthusiasm, flattery, copied résumé bullets and formulaic AI phrases",
      ],
      intentRelevance: [
        "Name the correct role and employer and answer why this candidate fits this opportunity",
        "Prioritise the two or three strongest confirmed matches rather than summarising the entire résumé",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "No unknown recipient is fabricated; use a neutral salutation when necessary",
        "All names, role titles, employer references and contact details are correct",
        "The final letter reads as correspondence ready to send, not a template or advice",
      ],
    },
    benchmarks: [MACQUARIE_RESUME_BENCHMARK],
  },
  {
    key: "selection-criteria",
    label: "Employment — selection criteria response",
    matches: [
      "selection criteria",
      "key selection",
      "address the criteria",
      "criteria response",
    ],
    domains: ["employment"],
    informationContract: SELECTION_CRITERIA_RESPONSE_INFORMATION_CONTRACT,
    internalReview: SELECTION_CRITERIA_RESPONSE_INTERNAL_REVIEW,
    requiredInformation: ["the list of criteria", "the target role or job ad"],
    highValueInformation: [
      "a strong example for each criterion",
      "measurable results",
    ],
    clarificationQuestions: [
      "What are the selection criteria, and what role or job ad are they from?",
      "What are your best examples for each criterion?",
    ],
    recommendedUploads: ["the job description", "resume"],
    inferableInformation: ["STAR structure per criterion"],
    riskChecks: [
      "each criterion answered directly",
      "examples real and specific",
      "first person",
    ],
    outputStructure: [
      "criterion heading or direct criterion reference",
      "Situation and Task",
      "candidate-led Actions",
      "Result",
      "relevance to the target role",
    ],
    quality: {
      requiredStructure: [
        "criterion heading or unmistakable criterion reference",
        "context and candidate responsibility",
        "specific actions led by the candidate",
        "result and relevance to the target role",
      ],
      lengthAndDepth: [
        "Follow the employer's stated word or page limit exactly",
        "Where no limit exists, use one developed evidence example per criterion and avoid unnecessary scene-setting",
      ],
      evidenceRequirements: [
        "Every criterion must be answered with confirmed evidence or explicitly identified as an evidence gap",
        "Actions must distinguish the candidate's contribution from the team; results require supplied evidence",
      ],
      toneAndWording: [
        "Direct first-person evidence language suitable for assessors",
        "Use STAR as an organising discipline without mechanical labels when a narrative response reads better",
      ],
      intentRelevance: [
        "Mirror the supplied criterion and role level without keyword stuffing",
        "Explain how each example demonstrates the capability the assessor is evaluating",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Every criterion is addressed once and can be scored from the response",
        "Examples are non-contradictory, interview-defensible and within the stated limit",
        "No placeholders, coaching notes or unverified outcome claims remain",
      ],
    },
    benchmarks: [APSC_APPLICATION_BENCHMARK],
  },
  {
    key: "linkedin",
    label: "Employment — LinkedIn profile",
    matches: [
      "linkedin",
      "linkedin profile",
      "linkedin summary",
      "linkedin rewrite",
    ],
    domains: ["employment"],
    informationContract: LINKEDIN_PROFILE_REWRITE_INFORMATION_CONTRACT,
    internalReview: LINKEDIN_PROFILE_REWRITE_INTERNAL_REVIEW,
    requiredInformation: ["current role and field", "target role or direction"],
    highValueInformation: [
      "desired professional positioning",
      "standout achievements",
      "keywords for the target field",
    ],
    clarificationQuestions: [
      "What professional positioning do you want to project?",
      "What are your standout achievements, and what role or direction are you targeting?",
    ],
    recommendedUploads: ["resume", "existing LinkedIn profile"],
    inferableInformation: [
      "keyword optimisation",
      "first-person summary voice",
    ],
    riskChecks: [
      "first person, authentic",
      "no buzzword filler",
      "specific and credible",
    ],
    outputStructure: [
      "headline",
      "about / summary",
      "experience highlights",
      "skills focus",
    ],
    quality: {
      requiredStructure: [
        "targeted headline",
        "first-person About section",
        "accurately labelled experience",
        "confirmed education and credentials",
        "relevant skills",
        "optional Featured recommendations grounded in real work",
      ],
      lengthAndDepth: [
        "Headline is concise and readable in search results",
        "About section is normally 1-3 short paragraphs; experience entries add evidence without copying the résumé verbatim",
      ],
      evidenceRequirements: [
        "All organisations, roles, dates, education and achievements must match confirmed records",
        "Keywords must describe genuine skills or target positioning and must not imply experience the user does not have",
      ],
      toneAndWording: [
        "Professional, approachable first-person voice for the About section",
        "Avoid keyword stuffing, inflated titles, advertisements and generic buzzword lists",
      ],
      intentRelevance: [
        "Headline, About, experience emphasis and skills align to the user's confirmed professional positioning",
        "Preserve an accurate career history while making relevant evidence easier to find",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Every proposed field is labelled so the user can paste it into the correct LinkedIn section",
        "No false organisation association, title inflation or unsupported skill remains",
        "The profile is coherent across headline, About, experience, education and skills",
      ],
    },
    benchmarks: [LINKEDIN_PROFILE_BENCHMARK],
  },
  {
    key: "job-search-checklist",
    label: "Employment — job-search action checklist",
    informationContract: JOB_SEARCH_CHECKLIST_INFORMATION_CONTRACT,
    internalReview: JOB_SEARCH_CHECKLIST_INTERNAL_REVIEW,
    matches: [
      "job-search action checklist",
      "job search checklist",
      "job search plan",
      "find a job plan",
    ],
    domains: ["employment"],
    requiredInformation: [
      "target role or direction",
      "search location or work-mode preference",
      "realistic time available",
    ],
    highValueInformation: [
      "preferred channels",
      "application target",
      "current application materials",
      "follow-up preference",
      "constraints",
    ],
    clarificationQuestions: [
      "What role or type of work are you targeting?",
      "How much time can you realistically spend on the search each week?",
      "Which application materials do you already have?",
    ],
    recommendedUploads: [
      "current resume",
      "sample job advertisements",
      "existing application tracker",
    ],
    inferableInformation: [
      "sensible recurring search stages",
      "ordinary sequencing from discovery through follow-up",
    ],
    riskChecks: [
      "no invented applications, deadlines, contacts or progress",
      "actions are concrete and realistically sequenced",
      "private account details are never requested",
    ],
    outputStructure: [
      "setup and evidence preparation",
      "role discovery",
      "role screening",
      "tailoring and submission",
      "tracking and follow-up",
      "interview preparation",
      "weekly review",
    ],
    quality: {
      requiredStructure: [
        "clear objective and cadence",
        "ordered action groups",
        "specific completion criteria",
        "tracking fields",
        "review and adjustment step",
      ],
      lengthAndDepth: [
        "Detailed enough to execute without explanation, usually 12-25 actions grouped by stage",
        "Each item states one action, its purpose and a realistic timing trigger",
      ],
      evidenceRequirements: [
        "Pre-filled employers, applications, dates and status values must come from confirmed user records",
        "Recommendations are labelled as recommendations rather than completed work",
      ],
      toneAndWording: [
        "Plain-English action verbs and calm, practical wording",
        "Avoid motivational filler, vague tasks and unexplained recruitment jargon",
      ],
      intentRelevance: [
        "Cadence, channels, preparation tasks and targets reflect the user's role, location, constraints and available time",
        "Do not impose a numeric application quota unless the user confirms it",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Every item is actionable, ordered and non-duplicative",
        "No action is falsely marked complete and no fictional employer or deadline appears",
        "The checklist can be used immediately as a working job-search plan",
      ],
    },
    benchmarks: [MACQUARIE_RESUME_BENCHMARK, UNM_OUTREACH_BENCHMARK],
  },
  {
    key: "interview-prep-questions",
    label: "Employment — interview preparation questions",
    informationContract: INTERVIEW_PREP_QUESTIONS_INFORMATION_CONTRACT,
    internalReview: INTERVIEW_PREP_QUESTIONS_INTERNAL_REVIEW,
    matches: [
      "interview preparation questions",
      "interview prep questions",
      "likely interview questions",
      "prepare for interview",
    ],
    domains: ["employment"],
    requiredInformation: [
      "target role",
      "key role requirements",
      "confirmed candidate evidence",
    ],
    highValueInformation: [
      "job advertisement",
      "employer information",
      "interview stage or format",
      "evidence gaps",
      "questions the candidate finds difficult",
    ],
    clarificationQuestions: [
      "What role and requirements should the preparation target?",
      "Which real achievements or situations can you use as evidence?",
      "Do you know the interview format or stage?",
    ],
    recommendedUploads: [
      "job advertisement",
      "resume",
      "selection criteria",
      "application already submitted",
    ],
    inferableInformation: [
      "likely question categories",
      "STAR preparation structure",
      "neutral delivery coaching",
    ],
    riskChecks: [
      "questions are presented as likely rather than employer-confirmed",
      "model answers use only real candidate evidence",
      "unknown motivations and weaknesses are asked, not invented",
    ],
    outputStructure: [
      "role and evidence map",
      "opening and motivation questions",
      "behavioural questions with truthful answer outlines",
      "role-specific questions",
      "difficult-question preparation",
      "questions to ask the interviewer",
      "final preparation checklist",
    ],
    quality: {
      requiredStructure: [
        "preparation context",
        "likely questions grouped by competency",
        "evidence prompts or answer outlines",
        "candidate questions",
        "final rehearsal checklist",
      ],
      lengthAndDepth: [
        "Usually 8-15 prioritised questions with concise evidence-led answer outlines",
        "Develop the most important behavioural questions deeply enough to rehearse, not as generic tips",
      ],
      evidenceRequirements: [
        "Every suggested answer names only confirmed situations, candidate actions and results",
        "Question-to-requirement mappings must trace to the supplied job advertisement or role information",
      ],
      toneAndWording: [
        "Natural spoken answer guidance rather than written essay prose",
        "Confident, reflective and truthful; avoid scripted perfection or employer impersonation",
      ],
      intentRelevance: [
        "Questions and evidence priorities reflect the target role, seniority, employer and interview stage where known",
        "Clearly label speculative questions as likely preparation, never as questions the employer will ask",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Candidate can rehearse every answer without filling unknown facts",
        "Evidence examples are distinct, defensible and relevant",
        "At least three genuine candidate questions are ready when employer context supports them",
      ],
    },
    benchmarks: [APSC_APPLICATION_BENCHMARK],
  },
  {
    key: "interview-script",
    label: "Employment — interview script",
    informationContract: INTERVIEW_SCRIPT_INFORMATION_CONTRACT,
    internalReview: INTERVIEW_SCRIPT_INTERNAL_REVIEW,
    matches: [
      "interview script",
      "script my interview",
      "interview answers",
      "spoken interview answers",
    ],
    domains: ["employment"],
    requiredInformation: [
      "target role",
      "confirmed introduction facts",
      "real evidence examples",
    ],
    highValueInformation: [
      "job requirements",
      "employer motivation",
      "interview format",
      "known difficult questions",
      "career-change explanation",
    ],
    clarificationQuestions: [
      "What role is the script for?",
      "Which real examples should anchor your answers?",
      "What question or part of the interview are you most concerned about?",
    ],
    recommendedUploads: [
      "job advertisement",
      "resume",
      "submitted cover letter or selection criteria",
    ],
    inferableInformation: [
      "spoken pacing",
      "answer signposting",
      "STAR sequencing",
    ],
    riskChecks: [
      "answers remain natural and interview-defensible",
      "no fabricated weakness, conflict, motivation or result",
      "script does not claim to predict exact employer questions",
    ],
    outputStructure: [
      "opening introduction",
      "why this role",
      "strength and capability answers",
      "STAR evidence stories",
      "role-specific answers",
      "difficult-question answers",
      "candidate questions",
      "closing",
    ],
    quality: {
      requiredStructure: [
        "concise introduction",
        "role-motivation answer",
        "evidence-led capability answers",
        "difficult-question preparation",
        "candidate questions",
        "closing",
      ],
      lengthAndDepth: [
        "Most spoken answers target roughly 45-90 seconds unless the interview format requires otherwise",
        "Include enough context, action and result to be credible without creating memorised monologues",
      ],
      evidenceRequirements: [
        "Every scripted factual statement is supported by the candidate's confirmed history or supplied application",
        "Unknown motivations, weaknesses, reasons for leaving and availability remain explicit questions until answered",
      ],
      toneAndWording: [
        "Conversational first-person wording that sounds natural aloud",
        "Use prompts and optional phrasing rather than robotic word-for-word performance where flexibility is safer",
      ],
      intentRelevance: [
        "Prioritise questions and evidence most material to the target role and interview stage",
        "Preserve consistency with the résumé, cover letter and selection responses already submitted",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "No answer requires the candidate to repeat a fact they did not supply",
        "Answers can be spoken naturally and remain consistent under follow-up",
        "The candidate has a credible opening, evidence examples, questions and closing ready",
      ],
    },
    benchmarks: [APSC_APPLICATION_BENCHMARK],
  },
  {
    key: "job-follow-up-email",
    label: "Employment — job application follow-up email",
    informationContract: JOB_FOLLOW_UP_EMAIL_INFORMATION_CONTRACT,
    internalReview: JOB_FOLLOW_UP_EMAIL_INTERNAL_REVIEW,
    matches: [
      "job follow-up email",
      "application follow up",
      "follow up my application",
      "post interview email",
      "thank you email",
    ],
    domains: ["employment"],
    requiredInformation: [
      "recipient or neutral recipient role",
      "position",
      "actual application or interview event",
    ],
    highValueInformation: [
      "employer",
      "event date",
      "specific discussion point",
      "stated next step",
      "continued-interest evidence",
    ],
    clarificationQuestions: [
      "Are you following up after an application or an interview?",
      "What role and employer is this about?",
      "What specific discussion point or stated next step should the email reference?",
    ],
    recommendedUploads: [
      "job advertisement",
      "application confirmation",
      "interview notes",
      "prior correspondence",
    ],
    inferableInformation: [
      "concise email structure",
      "professional neutral salutation when a name is unavailable",
    ],
    riskChecks: [
      "never invent contact, submission, interview or promised timeline",
      "no pressure or entitlement",
      "specificity comes from real correspondence or discussion",
    ],
    outputStructure: [
      "subject line",
      "greeting",
      "event-specific appreciation or status reference",
      "continued interest and relevant value",
      "polite next-step line",
      "sign-off",
    ],
    quality: {
      requiredStructure: [
        "specific subject",
        "appropriate greeting",
        "clear reason for writing",
        "brief role-relevant message",
        "polite next step",
        "professional signature",
      ],
      lengthAndDepth: [
        "Usually 80-180 words and no longer than necessary",
        "Use one or two specific details rather than restating the full application",
      ],
      evidenceRequirements: [
        "Dates, interview topics, recipient details and next-step promises must come from confirmed events or correspondence",
        "Capability reminders must match the submitted application and confirmed evidence",
      ],
      toneAndWording: [
        "Warm, concise and professional without pressure, apology, manipulation or excessive enthusiasm",
        "Natural correspondence rather than a generic template explanation",
      ],
      intentRelevance: [
        "Match the email to the actual stage: application follow-up, interview thank-you or agreed status check",
        "Reference the correct employer, role and event",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Recipient, role, employer, event and timing are correct",
        "No fabricated conversation point or promised response date remains",
        "Subject, greeting, body and sign-off are ready to send",
      ],
    },
    benchmarks: [VCU_FOLLOW_UP_BENCHMARK],
  },
  {
    key: "star-achievement-bank",
    label: "Employment — STAR achievement bank",
    matches: [
      "star achievement bank",
      "star examples",
      "achievement bank",
      "behavioural examples",
    ],
    domains: ["employment"],
    informationContract: STAR_ACHIEVEMENT_BANK_INFORMATION_CONTRACT,
    internalReview: STAR_ACHIEVEMENT_BANK_INTERNAL_REVIEW,
    requiredInformation: [
      "at least one real situation",
      "candidate responsibility",
      "candidate actions",
      "confirmed result or honest current outcome",
    ],
    highValueInformation: [
      "metrics",
      "stakeholders",
      "constraints",
      "tools",
      "lessons",
      "competencies demonstrated",
    ],
    clarificationQuestions: [
      "What real situation or achievement should we capture first?",
      "What did you personally do, step by step?",
      "What result can you support, and how was it measured?",
    ],
    recommendedUploads: [
      "resume",
      "performance reviews",
      "KPI reports",
      "project notes",
      "achievement log",
    ],
    inferableInformation: [
      "STAR ordering",
      "competency tags from supplied evidence",
      "concise interview cue format",
    ],
    riskChecks: [
      "team outcomes are not misrepresented as individual achievements",
      "no metric or result is invented",
      "each example remains reusable without changing the facts",
    ],
    outputStructure: [
      "achievement index and competency tags",
      "situation",
      "task and personal responsibility",
      "actions",
      "result",
      "evidence source",
      "relevance and interview cue",
    ],
    quality: {
      requiredStructure: [
        "example title and competency tags",
        "Situation",
        "Task",
        "Action",
        "Result",
        "source/provenance note",
        "relevance cue",
      ],
      lengthAndDepth: [
        "Keep index summaries concise and develop each full example to roughly 150-300 words when evidence supports it",
        "Actions receive the greatest detail and distinguish the candidate's personal contribution",
      ],
      evidenceRequirements: [
        "Situation, responsibility, actions and result must each bind to confirmed evidence",
        "Metrics require a supplied source; qualitative results must be framed at the strength supported",
      ],
      toneAndWording: [
        "Clear first-person evidence wording that can be adapted naturally in interviews",
        "Avoid heroic framing, vague teamwork claims and inflated competency labels",
      ],
      intentRelevance: [
        "Tag examples only to competencies they genuinely demonstrate",
        "Surface the strongest examples for the target role while retaining a reusable evidence bank",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Every example is complete, internally consistent and interview-defensible",
        "No team achievement is falsely claimed as personal",
        "Examples can be reused without altering facts, dates or metrics",
      ],
    },
    benchmarks: [APSC_APPLICATION_BENCHMARK],
  },
  {
    key: "recruiter-introduction-email",
    label: "Employment — recruiter introduction email",
    matches: [
      "recruiter introduction email",
      "email a recruiter",
      "introduce myself to recruiter",
      "recruiter outreach",
    ],
    domains: ["employment"],
    informationContract: RECRUITER_INTRODUCTION_EMAIL_INFORMATION_CONTRACT,
    internalReview: RECRUITER_INTRODUCTION_EMAIL_INTERNAL_REVIEW,
    requiredInformation: [
      "recipient or recruiter context",
      "target role or field",
      "confirmed candidate value evidence",
      "specific request",
    ],
    highValueInformation: [
      "referral or connection",
      "location and work preference",
      "availability",
      "attached résumé",
      "relevant vacancy",
    ],
    clarificationQuestions: [
      "Is this about a specific vacancy or a general introduction?",
      "What role or field are you targeting?",
      "What specific, low-effort next step do you want to ask for?",
    ],
    recommendedUploads: [
      "resume",
      "vacancy or recruiter message",
      "LinkedIn profile",
    ],
    inferableInformation: [
      "brief professional email structure",
      "neutral salutation when the recipient name is unknown",
    ],
    riskChecks: [
      "no invented referral, vacancy, relationship or recruiter knowledge",
      "request is specific and respectful",
      "claims match the attached résumé",
    ],
    outputStructure: [
      "subject line",
      "greeting and context",
      "concise positioning",
      "one or two evidence points",
      "specific request",
      "availability or attachment note when confirmed",
      "sign-off",
    ],
    quality: {
      requiredStructure: [
        "clear subject",
        "honest connection context",
        "target positioning",
        "evidence of relevance",
        "specific request",
        "professional sign-off",
      ],
      lengthAndDepth: [
        "Usually 100-200 words",
        "Include enough evidence to justify the contact without reproducing a cover letter",
      ],
      evidenceRequirements: [
        "Referral, vacancy, relationship, experience and achievement claims must be confirmed",
        "Any attachment or availability statement must reflect the actual intended send",
      ],
      toneAndWording: [
        "Concise, calm and respectful; confident without pressure, flattery or transactional networking language",
        "Use a natural human introduction and a low-effort ask",
      ],
      intentRelevance: [
        "Distinguish a specific-vacancy approach from general recruiter networking",
        "Align target roles, location and evidence with the user's stated search",
      ],
      prohibitedInventions: JOB_FACTUAL_PROHIBITIONS,
      submitReadyChecks: [
        "Recipient context, vacancy, attachment and request are accurate",
        "No fake familiarity, referral or employer knowledge remains",
        "Subject, message and sign-off are ready to send",
      ],
    },
    benchmarks: [UNM_OUTREACH_BENCHMARK],
  },
  {
    key: "business-email",
    label: "Business — business email",
    matches: [
      "business email",
      "professional email",
      "work email",
      "email to client",
      "email to supplier",
    ],
    domains: ["business"],
    informationContract: BUSINESS_EMAIL_INFORMATION_CONTRACT,
    internalReview: BUSINESS_EMAIL_INTERNAL_REVIEW,
    requiredInformation: [
      "email purpose",
      "confirmed message context",
      "main point",
      "requested action",
    ],
    highValueInformation: [
      "recipient",
      "supporting facts",
      "real deadline",
      "attachments",
      "next step",
    ],
    clarificationQuestions: [
      "What does this email need to achieve?",
      "What confirmed facts does the recipient need in order to act?",
      "What exactly do you want them to do or reply with?",
    ],
    recommendedUploads: [
      "prior correspondence",
      "relevant agreement, invoice, quote or source document",
      "supporting records",
    ],
    inferableInformation: [
      "concise professional email structure",
      "neutral greeting when the recipient is unknown",
      "audience-appropriate business tone",
    ],
    riskChecks: [
      "never invent recipient identity, prior contact, commitments, dates, deadlines, amounts or supporting facts",
      "unknown facts remain declared interactive placeholders or approved neutral replacements",
      "no missing fact may blank the subject, message or call to action",
      "separate confirmed facts from requests, recommendations and assumptions",
    ],
    outputStructure: [
      "specific subject and greeting",
      "concise message in logical paragraphs",
      "clear call to action and sign-off",
    ],
    quality: {
      requiredStructure: [
        "specific subject line",
        "appropriate greeting",
        "clear opening purpose",
        "concise evidence-backed message",
        "explicit call to action",
        "professional sign-off",
      ],
      lengthAndDepth: [
        "Usually 60-250 words unless the business matter genuinely requires more detail",
        "Use short paragraphs or bullets where they materially improve scanability; do not pad a simple request into a memo",
      ],
      evidenceRequirements: [
        "Names, dates, amounts, reference numbers, prior commitments and factual claims must come from confirmed user context or supplied sources",
        "Any urgency or deadline must be real and supplied; absence of a deadline must not be reframed as urgency",
      ],
      toneAndWording: [
        "Professional, natural and audience-appropriate; direct without sounding abrupt",
        "Avoid generic corporate filler, excessive apology, invented warmth, manipulative pressure and drafting commentary",
      ],
      intentRelevance: [
        "The subject, opening, supporting detail and call to action all serve the user's stated business outcome",
        "Remove background that does not help the recipient understand, decide or act",
      ],
      prohibitedInventions: [
        "Never invent recipient identity, relationship, organisation, dates, amounts, deadlines, commitments, approvals, attachments, events or source findings.",
        "If a vital fact is unavailable, preserve complete final wording and use the declared interactive placeholder or approved neutral replacement; never invent the fact.",
      ],
      submitReadyChecks: [
        "Subject, greeting, body, requested action and sign-off form one coherent send-ready email",
        "All names, dates, amounts, attachments and deadlines are correct or explicitly unresolved",
        "No blank section, raw drafting instruction or undeclared placeholder remains",
      ],
    },
  },
  {
    key: "reference-letter",
    label: "Reference — character / professional",
    matches: [
      "reference",
      "character reference",
      "professional reference",
      "referee",
      "recommendation letter",
    ],
    domains: ["employment", "personal"],
    informationContract: PROFESSIONAL_REFERENCE_LETTER_INFORMATION_CONTRACT,
    internalReview: PROFESSIONAL_REFERENCE_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "who the reference is for",
      "the user's relationship to them",
    ],
    highValueInformation: [
      "the most relevant examples",
      "the person's key strengths",
      "what the reference is for",
    ],
    clarificationQuestions: [
      "What are the most relevant examples of their character or work?",
      "What key strengths should this highlight?",
    ],
    recommendedUploads: [
      "the role or purpose details",
      "any background on the person",
    ],
    inferableInformation: [
      "appropriate formal tone",
      "relevant strengths for the purpose",
    ],
    riskChecks: [
      "written in the user's own first person as the referee",
      "examples specific and honest",
      "no overstatement",
    ],
    outputStructure: [
      "relationship & how long known",
      "qualities with concrete examples",
      "clear recommendation",
      "offer to be contacted",
    ],
  },
  {
    key: "business-plan",
    label: "Business — business plan",
    matches: [
      "business plan",
      "startup business plan",
      "business planning document",
    ],
    domains: ["business"],
    informationContract: BUSINESS_PLAN_INFORMATION_CONTRACT,
    internalReview: BUSINESS_PLAN_INTERNAL_REVIEW,
    requiredInformation: [
      "what the business does",
      "target market",
      "revenue model",
    ],
    highValueInformation: [
      "financials or forecasts",
      "milestones",
      "competitive edge",
    ],
    clarificationQuestions: [
      "What's your revenue model?",
      "Who's your target market?",
    ],
    recommendedUploads: [
      "existing business documents",
      "market research",
      "financial forecasts",
    ],
    inferableInformation: ["standard plan sections", "industry structure"],
    riskChecks: [
      "assumptions stated explicitly",
      "no fabricated financials",
      "gaps flagged",
      "tables for numbers",
    ],
    outputStructure: [
      "executive summary",
      "problem & opportunity",
      "offering",
      "target market",
      "revenue model",
      "plan & milestones",
      "financials",
      "next steps",
    ],
  },
  {
    key: "funding-proposal",
    label: "Business — funding proposal / investor pitch",
    matches: [
      "funding proposal",
      "investor pitch",
      "pitch deck",
      "raise capital",
      "seeking investment",
      "grant proposal",
    ],
    domains: ["business", "finance"],
    informationContract: GRANT_FUNDING_PROPOSAL_INFORMATION_CONTRACT,
    internalReview: GRANT_FUNDING_PROPOSAL_INTERNAL_REVIEW,
    requiredInformation: ["what's being funded", "the amount sought"],
    highValueInformation: [
      "use of funds",
      "strongest proof of demand or traction",
      "financial forecasts",
    ],
    clarificationQuestions: [
      "How much funding, and what will it be used for?",
      "What's your strongest proof of demand?",
    ],
    recommendedUploads: ["financial statements", "forecasts", "business plan"],
    inferableInformation: ["investor expectations", "traction framing"],
    riskChecks: [
      "no fabricated financials or traction",
      "the ask and use of funds explicit",
      "claims evidenced",
    ],
    outputStructure: [
      "summary",
      "the opportunity",
      "traction / proof of demand",
      "the ask & use of funds",
      "financials",
      "team",
      "next steps",
    ],
  },
  {
    key: "qbr",
    label: "Business — quarterly business review",
    matches: ["quarterly business review", "qbr", "quarterly review"],
    domains: ["business"],
    informationContract: QUARTERLY_BUSINESS_REVIEW_INFORMATION_CONTRACT,
    internalReview: QUARTERLY_BUSINESS_REVIEW_INTERNAL_REVIEW,
    requiredInformation: ["the review period", "the business or team"],
    highValueInformation: [
      "KPI and sales figures",
      "key concerns",
      "staff metrics",
    ],
    clarificationQuestions: [
      "Which review period are we covering?",
      "What are your key concerns this quarter?",
    ],
    recommendedUploads: [
      "sales reports",
      "KPI reports",
      "staff metrics",
      "previous QBRs",
    ],
    inferableInformation: ["quarter-on-quarter framing"],
    riskChecks: [
      "figures from the user's data, never invented",
      "balanced wins and challenges",
      "tables for metrics",
    ],
    outputStructure: [
      "period summary",
      "KPI performance",
      "wins",
      "challenges",
      "financials",
      "priorities next quarter",
    ],
  },
  {
    key: "performance-review",
    label: "Business — performance review",
    matches: [
      "performance review",
      "staff appraisal",
      "employee review",
      "appraisal",
    ],
    domains: ["business", "employment"],
    informationContract: PERFORMANCE_REVIEW_INFORMATION_CONTRACT,
    internalReview: PERFORMANCE_REVIEW_INTERNAL_REVIEW,
    requiredInformation: ["the employee's role", "the review period"],
    highValueInformation: [
      "KPIs and results",
      "specific examples",
      "manager notes",
    ],
    clarificationQuestions: [
      "What's the employee's role?",
      "What review period are we covering?",
    ],
    recommendedUploads: ["KPI reports", "manager notes", "previous reviews"],
    inferableInformation: ["balanced, fair framing"],
    riskChecks: [
      "specific, evidence-based feedback",
      "balanced strengths and development areas",
      "professional, non-defamatory tone",
    ],
    outputStructure: [
      "summary",
      "achievements",
      "areas for development",
      "goals for next period",
      "overall rating",
    ],
  },
  {
    key: "financial-review",
    label: "Business — financial review",
    matches: [
      "financial review",
      "financial analysis",
      "review my financials",
      "review my finances",
    ],
    domains: ["business", "finance"],
    informationContract: FINANCIAL_REVIEW_INFORMATION_CONTRACT,
    internalReview: FINANCIAL_REVIEW_INTERNAL_REVIEW,
    requiredInformation: [
      "the review period",
      "the source financial figures being reviewed",
    ],
    highValueInformation: [
      "areas of concern",
      "revenue, cost and labour figures",
    ],
    clarificationQuestions: [
      "What review period, and what financial figures should it be based on?",
      "Any specific areas of concern?",
    ],
    recommendedUploads: [
      "Profit & Loss statement",
      "expenditure reports",
      "payroll reports",
      "wage reports",
      "sales reports",
      "budget forecasts",
      "previous financial reviews",
      "BAS statements",
    ],
    inferableInformation: ["standard financial-review structure"],
    riskChecks: [
      "all figures from uploaded data, never invented",
      "assumptions and gaps flagged",
      "tables for all numbers",
      "not financial advice",
    ],
    outputStructure: [
      "revenue analysis",
      "cost analysis",
      "labour analysis",
      "cashflow review",
      "opportunities",
      "risks",
      "recommendations",
    ],
  },
  {
    key: "profit-and-loss-statement",
    label: "Finance — profit & loss statement",
    matches: [
      "p&l",
      "profit and loss",
      "profit and loss statement",
      "p&l statement",
      "income statement",
    ],
    domains: ["finance", "business"],
    informationContract: PROFIT_AND_LOSS_STATEMENT_INFORMATION_CONTRACT,
    internalReview: PROFIT_AND_LOSS_STATEMENT_INTERNAL_REVIEW,
    requiredInformation: ["the reporting period", "total revenue"],
    highValueInformation: [
      "cost of goods sold",
      "operating expense breakdown by category",
    ],
    clarificationQuestions: [
      "What reporting period is this for?",
      "What was total revenue for the period?",
    ],
    recommendedUploads: [
      "previous Profit & Loss statement",
      "sales reports",
      "expense reports",
      "a bookkeeping export (e.g. Xero, MYOB, QuickBooks)",
    ],
    inferableInformation: [
      "standard P&L structure (revenue, cost of goods sold, gross profit, operating expenses, net profit)",
    ],
    riskChecks: [
      "all figures from uploaded data or explicit user input, never invented",
      "revenue minus cost of goods sold must equal the stated gross profit",
      "gross profit minus operating expenses must equal the stated net profit",
      "not financial advice",
    ],
    outputStructure: [
      "revenue",
      "cost of goods sold and gross profit",
      "operating expenses",
      "net profit summary",
    ],
  },
  {
    key: "risk-assessment",
    label: "Business — risk assessment",
    matches: ["risk assessment", "risk register", "risk matrix"],
    domains: ["business"],
    informationContract: RISK_ASSESSMENT_INFORMATION_CONTRACT,
    internalReview: RISK_ASSESSMENT_INTERNAL_REVIEW,
    requiredInformation: ["the business type", "the risk category or scope"],
    highValueInformation: ["known incidents", "existing controls"],
    clarificationQuestions: [
      "What type of business is this for?",
      "Which risk category or area are we assessing?",
    ],
    recommendedUploads: [
      "incident reports",
      "safety audits",
      "insurance claims",
      "operational procedures",
      "compliance reports",
    ],
    inferableInformation: ["likelihood / consequence rating conventions"],
    riskChecks: [
      "controls realistic and specific",
      "not a substitute for professional WHS advice",
      "no invented incidents",
    ],
    outputStructure: [
      "risk register",
      "likelihood",
      "consequence",
      "controls",
      "recommendations",
    ],
  },
  {
    key: "safety-review",
    label: "Business — safety review",
    matches: [
      "safety review",
      "whs",
      "work health and safety",
      "hazard review",
    ],
    domains: ["business"],
    requiredInformation: ["the workplace or site"],
    highValueInformation: [
      "incident and near-miss history",
      "training records",
    ],
    clarificationQuestions: ["What site or operation is this for?"],
    recommendedUploads: [
      "incident logs",
      "near-miss reports",
      "safety audits",
      "training records",
    ],
    inferableInformation: ["WHS compliance framing"],
    riskChecks: [
      "hazards specific and actionable",
      "general guidance, not formal WHS or legal advice",
      "no invented incidents",
    ],
    outputStructure: ["hazard review", "compliance review", "recommendations"],
  },
  {
    key: "operational-review",
    label: "Business — operational review",
    matches: ["operational review", "operations review"],
    domains: ["business"],
    requiredInformation: ["the operation or area"],
    highValueInformation: ["primary operational issues", "KPIs", "staffing"],
    clarificationQuestions: ["What are the primary operational issues?"],
    recommendedUploads: ["SOPs", "KPI reports", "staffing reports"],
    inferableInformation: ["root-cause framing"],
    riskChecks: [
      "recommendations practical and prioritised",
      "grounded in the data provided",
    ],
    outputStructure: [
      "operations summary",
      "key issues",
      "root causes",
      "recommendations",
      "priorities",
    ],
  },
  {
    key: "board-report",
    label: "Business — board report",
    matches: ["board report", "board paper", "board meeting"],
    domains: ["business"],
    informationContract: BOARD_REPORT_INFORMATION_CONTRACT,
    internalReview: BOARD_REPORT_INTERNAL_REVIEW,
    requiredInformation: [
      "the reporting period",
      "the purpose or decisions sought",
    ],
    highValueInformation: ["financials", "KPI dashboards"],
    clarificationQuestions: [
      "What period, and what decisions are you seeking from the board?",
      "What are the key financial or performance figures the board needs to see?",
    ],
    recommendedUploads: [
      "financials",
      "KPI dashboards",
      "previous board papers",
    ],
    inferableInformation: ["concise executive register"],
    riskChecks: [
      "figures from data only",
      "clear decisions and recommendations",
      "concise",
    ],
    outputStructure: [
      "executive summary",
      "performance",
      "financials",
      "risks & issues",
      "decisions sought",
    ],
  },
  {
    key: "meeting-minutes",
    label: "Business — meeting minutes",
    matches: ["meeting minutes", "minutes of meeting", "meeting notes"],
    domains: ["business"],
    informationContract: MEETING_MINUTES_INFORMATION_CONTRACT,
    internalReview: MEETING_MINUTES_INTERNAL_REVIEW,
    requiredInformation: ["the meeting and date", "attendees"],
    highValueInformation: ["decisions made", "action items with owners"],
    clarificationQuestions: [
      "Who attended, and what were the key decisions?",
      "What action items came out of the meeting, and who owns each one?",
    ],
    recommendedUploads: ["the transcript", "your notes"],
    inferableInformation: ["standard minutes structure"],
    riskChecks: [
      "accurate to the source, nothing invented",
      "clear action items with owners and dates",
    ],
    outputStructure: [
      "attendees & apologies",
      "agenda items discussed",
      "decisions",
      "action items (owner, due date)",
      "next meeting",
    ],
  },
  {
    key: "debrief",
    label: "Business — debrief / closure report",
    matches: [
      "debrief",
      "event debrief",
      "project closure",
      "incident debrief",
      "post mortem",
      "wrap up report",
    ],
    domains: ["business"],
    requiredInformation: ["what happened", "the event or project"],
    highValueInformation: ["outcomes vs plan", "desired learnings"],
    clarificationQuestions: [
      "What happened?",
      "What learnings do you want to capture?",
    ],
    recommendedUploads: [
      "incident or event reports",
      "meeting notes",
      "the project plan",
      "outcomes report",
      "sales report",
    ],
    inferableInformation: ["balanced retrospective framing"],
    riskChecks: ["factual, blame-free", "concrete learnings and actions"],
    outputStructure: [
      "summary",
      "what happened",
      "what went well",
      "what didn't",
      "learnings",
      "recommendations & next steps",
    ],
  },
  {
    key: "gov-review-request",
    label: "Government — internal review / infringement",
    matches: [
      "internal review",
      "infringement",
      "fine review",
      "penalty notice",
      "appeal a fine",
      "review request",
    ],
    domains: ["personal", "finance"],
    requiredInformation: [
      "the notice or reference details",
      "the grounds for review",
    ],
    highValueInformation: ["supporting evidence", "the outcome sought"],
    clarificationQuestions: [
      "What are the notice details, and on what grounds are you seeking review?",
    ],
    recommendedUploads: [
      "the fine or infringement notice",
      "supporting evidence",
    ],
    inferableInformation: ["formal, respectful register"],
    riskChecks: [
      "facts only, no invented circumstances",
      "respectful tone",
      "not legal advice",
    ],
    outputStructure: [
      "reference & notice details",
      "grounds for review",
      "supporting evidence",
      "requested outcome",
    ],
  },
  {
    key: "support-letter",
    label: "Government — support letter",
    matches: ["support letter", "letter of support"],
    domains: ["personal", "business"],
    requiredInformation: [
      "who or what is being supported",
      "the user's relationship or standing",
    ],
    highValueInformation: ["specific supporting points", "relevant evidence"],
    clarificationQuestions: [
      "Who or what are you supporting, and what are the strongest points in their favour?",
    ],
    recommendedUploads: ["relevant evidence"],
    inferableInformation: ["appropriate formal tone"],
    riskChecks: ["first person, genuine", "specific and honest"],
    outputStructure: [
      "intro & relationship",
      "the support and context",
      "specific supporting points",
      "close",
    ],
  },
  {
    key: "statutory-declaration",
    label: "Government — statutory declaration draft",
    matches: ["statutory declaration", "stat dec"],
    domains: ["personal"],
    requiredInformation: [
      "the declarant's details",
      "the facts being declared",
    ],
    highValueInformation: ["dates and specifics", "supporting documents"],
    clarificationQuestions: ["What facts do you need to declare, with dates?"],
    recommendedUploads: ["supporting documents"],
    inferableInformation: ["numbered statement-of-fact structure"],
    riskChecks: [
      "facts only, in first person",
      "note it must be signed before an authorised witness",
      "not legal advice",
    ],
    outputStructure: [
      "declarant details",
      "numbered statements of fact",
      "declaration & signature block",
    ],
  },
  {
    key: "formal-complaint",
    label: "Legal-style — complaint / demand / response (not legal advice)",
    matches: [
      "complaint",
      "demand letter",
      "letter of demand",
      "response letter",
      "witness statement",
      "dispute",
      "breach",
      "refund",
    ],
    domains: ["personal"],
    informationContract: COMPLAINT_LETTER_INFORMATION_CONTRACT,
    internalReview: COMPLAINT_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "the parties",
      "what happened (timeline)",
      "the outcome sought",
    ],
    highValueInformation: [
      "evidence and supporting documents",
      "relevant terms or rights",
    ],
    clarificationQuestions: [
      "Who is this to and what outcome do you want?",
      "What's the timeline of what happened?",
    ],
    recommendedUploads: [
      "contracts, receipts or correspondence",
      "photos or other evidence",
      "relevant policy or terms",
    ],
    inferableInformation: ["firm-but-civil tone", "escalation framing"],
    riskChecks: [
      "facts only — not legal advice or guaranteed outcomes",
      "measured tone, lawful steps only",
      "suggest professional legal advice for high-stakes matters",
    ],
    outputStructure: [
      "the parties & matter",
      "timeline of facts",
      "the issue or breach",
      "evidence & supporting documents",
      "remedy sought & timeframe",
      "next steps if unresolved",
    ],
  },
  {
    key: "rental-application",
    label: "Housing — rental application",
    matches: [
      "rental application",
      "rental app",
      "apply for a rental",
      "tenancy application",
    ],
    domains: ["personal"],
    requiredInformation: [
      "the property and applicant",
      "employment and income",
    ],
    highValueInformation: ["rental history", "references"],
    clarificationQuestions: [
      "What's your employment and income, and your rental history?",
    ],
    recommendedUploads: ["payslips", "rental ledger", "references"],
    inferableInformation: ["polite, reassuring tenant framing"],
    riskChecks: ["first person, honest", "specific and verifiable"],
    outputStructure: [
      "applicant introduction",
      "employment & income",
      "rental history & references",
      "why you'd be a great tenant",
    ],
  },
  {
    key: "hardship-application",
    label: "Housing / finance — hardship application",
    matches: ["hardship"],
    domains: ["personal", "finance"],
    requiredInformation: ["the circumstances", "what's being requested"],
    highValueInformation: ["financial details", "a recovery plan"],
    clarificationQuestions: [
      "What changed in your circumstances, and what are you requesting?",
    ],
    recommendedUploads: ["bills", "financial statements"],
    inferableInformation: ["respectful, factual tone"],
    riskChecks: ["first person, honest", "specific figures only if provided"],
    outputStructure: [
      "your situation",
      "financial circumstances",
      "what you're requesting",
      "your plan to recover",
    ],
  },
  {
    key: "lease-dispute",
    label: "Housing — lease dispute letter",
    matches: [
      "lease dispute",
      "tenancy dispute",
      "landlord",
      "bond",
      "repairs",
      "rent increase",
    ],
    domains: ["personal"],
    requiredInformation: ["the tenancy details", "the issue with dates"],
    highValueInformation: ["the lease terms", "correspondence history"],
    clarificationQuestions: ["What's the issue, and what are the key dates?"],
    recommendedUploads: ["the lease", "correspondence"],
    inferableInformation: ["state tenancy norms", "firm-but-respectful tone"],
    riskChecks: [
      "facts and dates accurate",
      "rights referenced generally, not as legal advice",
      "respectful tone",
    ],
    outputStructure: [
      "tenancy details",
      "the issue with facts & dates",
      "what you're asking for",
      "timeframe & contact",
    ],
  },
  {
    key: "personal-statement",
    label: "Education — personal statement",
    informationContract: PERSONAL_STATEMENT_INFORMATION_CONTRACT,
    internalReview: PERSONAL_STATEMENT_INTERNAL_REVIEW,
    matches: [
      "personal statement",
      "statement of purpose",
      "university application statement",
    ],
    domains: ["education"],
    requiredInformation: ["the course or institution", "your motivation"],
    highValueInformation: ["achievements", "fit for the course", "goals"],
    clarificationQuestions: [
      "What's the course, and what draws you to it?",
      "What achievements or experience best show your fit for this course?",
    ],
    recommendedUploads: ["resume", "academic records"],
    inferableInformation: ["motivational, authentic voice"],
    riskChecks: ["first person, genuine and specific", "no generic filler"],
    outputStructure: [
      "opening & motivation",
      "background & achievements",
      "fit for the course",
      "goals",
      "close",
    ],
  },
  {
    key: "scholarship",
    label: "Education — scholarship application",
    matches: ["scholarship", "scholarship application", "bursary application"],
    domains: ["education"],
    informationContract: SCHOLARSHIP_APPLICATION_INFORMATION_CONTRACT,
    internalReview: SCHOLARSHIP_APPLICATION_INTERNAL_REVIEW,
    requiredInformation: [
      "the scholarship and its criteria",
      "your eligibility",
    ],
    highValueInformation: [
      "academic results",
      "awards",
      "financial or merit need",
    ],
    clarificationQuestions: [
      "Which scholarship, and what makes you eligible?",
      "What academic results, awards or financial/merit need best support the application?",
    ],
    recommendedUploads: ["academic results", "awards", "resume"],
    inferableInformation: ["criteria-aligned framing"],
    riskChecks: [
      "claims truthful and specific",
      "criteria addressed directly",
      "first person",
    ],
    outputStructure: [
      "introduction & eligibility",
      "achievements",
      "need or merit case",
      "goals",
      "close",
    ],
  },
  {
    key: "action-plan",
    label: "Action plan",
    matches: [
      "action plan",
      "launch plan",
      "career change plan",
      "job search plan",
      "financial recovery",
      "recovery plan",
      "roadmap",
      "step by step plan",
    ],
    domains: ["personal", "business", "employment", "education", "finance"],
    requiredInformation: ["the goal"],
    highValueInformation: ["budget", "timeline", "constraints"],
    clarificationQuestions: [
      "What's the goal and by when?",
      "Any budget, timeline or constraints I should plan around?",
    ],
    recommendedUploads: [
      "any existing plan or brief",
      "relevant requirements or rules",
    ],
    inferableInformation: ["sensible sequencing and lead times"],
    riskChecks: [
      "steps realistic and ordered",
      "timeframes sensible",
      "no invented requirements",
    ],
    outputStructure: [
      "initial tasks",
      "core tasks",
      "final tasks",
      "progress tracking",
      "TED recommendations",
    ],
  },
  {
    key: "moving-house-checklist",
    label: "Personal — moving house checklist",
    matches: [
      "moving house",
      "house move",
      "moving checklist",
      "relocating",
      "relocation checklist",
    ],
    domains: ["personal"],
    informationContract: MOVING_HOUSE_CHECKLIST_INFORMATION_CONTRACT,
    internalReview: MOVING_HOUSE_CHECKLIST_INTERNAL_REVIEW,
    requiredInformation: [
      "move date",
      "old and new address",
      "whether renting or owning",
    ],
    highValueInformation: [
      "household size",
      "utilities to transfer",
      "removalist booking",
      "school or childcare needs",
    ],
    clarificationQuestions: [
      "When are you moving, and what are the old and new addresses?",
      "Is this a rental or a property you own, and roughly how large is the household?",
    ],
    recommendedUploads: ["existing lease or contract of sale", "utility bills"],
    inferableInformation: [
      "standard pre-move, move-day and post-move task sequencing",
    ],
    riskChecks: [
      "dates realistic",
      "renter vs owner tasks not mixed up",
      "no invented requirements",
    ],
    outputStructure: [
      "move date, addresses and property type",
      "utility transfer and address-update tasks",
      "removalist, packing and logistics tasks",
      "owner, due date and status per task",
    ],
  },
  {
    key: "new-tenancy-checklist",
    label: "Personal — new tenancy / lease checklist",
    matches: [
      "new tenancy",
      "signing a lease",
      "new lease",
      "moving into a rental",
      "rental checklist",
    ],
    domains: ["personal"],
    informationContract: NEW_TENANCY_CHECKLIST_INFORMATION_CONTRACT,
    internalReview: NEW_TENANCY_CHECKLIST_INTERNAL_REVIEW,
    requiredInformation: ["move-in date", "state or territory", "bond amount"],
    highValueInformation: [
      "condition report status",
      "utility connections",
      "renters insurance",
      "lease length",
    ],
    clarificationQuestions: [
      "When do you move in, and which state or territory is the property in?",
      "What's the bond amount, and has a condition report been done yet?",
    ],
    recommendedUploads: ["the lease", "the condition report"],
    inferableInformation: [
      "that state or territory's standard tenancy timeframes",
    ],
    riskChecks: [
      "state or territory tenancy rules not invented",
      "bond and dates accurate",
      "renter vs landlord tasks not mixed up",
    ],
    outputStructure: [
      "move-in date, jurisdiction and bond details",
      "condition report and key handover tasks",
      "utility connection and insurance tasks",
      "owner, due date and status per task",
    ],
  },
  {
    key: "insurance-claim-letter",
    label: "Personal — insurance claim letter",
    matches: [
      "insurance claim",
      "claim letter",
      "file a claim",
      "make a claim",
    ],
    domains: ["personal"],
    informationContract: INSURANCE_CLAIM_LETTER_INFORMATION_CONTRACT,
    internalReview: INSURANCE_CLAIM_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "policy number",
      "what happened and when",
      "what was lost or damaged",
    ],
    highValueInformation: [
      "insurer name",
      "supporting evidence",
      "estimated value",
    ],
    clarificationQuestions: [
      "What's the policy number, and what happened and when?",
      "What was lost or damaged, and do you have photos, receipts or quotes?",
    ],
    recommendedUploads: [
      "the policy",
      "photos of the damage",
      "receipts or quotes",
    ],
    inferableInformation: ["the claim-letter structure an insurer expects"],
    riskChecks: [
      "facts only — no invented cause or value",
      "policy and incident details consistent",
      "not a guarantee of claim outcome",
    ],
    outputStructure: [
      "policy identification",
      "factual incident account",
      "confirmed loss or damage with evidence",
      "requested next step",
    ],
  },
  {
    key: "client-engagement-letter",
    label: "Business — client engagement letter",
    matches: [
      "engagement letter",
      "client engagement",
      "scope of engagement",
      "letter of engagement",
    ],
    domains: ["business"],
    informationContract: CLIENT_ENGAGEMENT_LETTER_INFORMATION_CONTRACT,
    internalReview: CLIENT_ENGAGEMENT_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "the client",
      "the work being done",
      "fees and payment terms",
    ],
    highValueInformation: [
      "responsibilities of each side",
      "key dates",
      "termination terms",
    ],
    clarificationQuestions: [
      "Who's the client, and what work is being agreed?",
      "What are the fees and payment terms?",
    ],
    recommendedUploads: [
      "any quote or proposal already sent",
      "standard terms the business uses",
    ],
    inferableInformation: [
      "standard professional-services engagement structure",
    ],
    riskChecks: [
      "scope stated precisely, not vaguely",
      "fees and terms consistent throughout",
      "not legal advice — recommend legal review for high-value engagements",
    ],
    outputStructure: [
      "parties and confirmed scope of engagement",
      "fees and payment terms",
      "responsibilities and key dates",
      "terms, confidentiality and sign-off",
    ],
  },
  {
    key: "non-disclosure-agreement",
    label: "Business — non-disclosure agreement",
    matches: [
      "nda",
      "non-disclosure agreement",
      "confidentiality agreement",
      "non disclosure",
    ],
    domains: ["business"],
    informationContract: NON_DISCLOSURE_AGREEMENT_INFORMATION_CONTRACT,
    internalReview: NON_DISCLOSURE_AGREEMENT_INTERNAL_REVIEW,
    requiredInformation: [
      "disclosing and receiving party",
      "one-way or mutual",
      "purpose of disclosure",
    ],
    highValueInformation: [
      "how long confidentiality lasts",
      "governing state or territory",
    ],
    clarificationQuestions: [
      "Who's disclosing and who's receiving, and is it one-way or mutual?",
      "What's the information being shared for, and how long should confidentiality last?",
    ],
    recommendedUploads: ["any existing NDA template the business uses"],
    inferableInformation: ["standard NDA clause structure"],
    riskChecks: [
      "parties and direction accurate",
      "not legal advice — recommend legal review before signing",
      "no invented obligations or terms",
    ],
    outputStructure: [
      "parties and disclosure direction",
      "defined confidential information and exclusions",
      "receiving party's obligations",
      "term, governing law and remedies",
    ],
  },
  {
    key: "research-report",
    label: "Education / business — research report",
    matches: ["research report", "research findings", "write up my research"],
    domains: ["education", "business", "personal"],
    informationContract: RESEARCH_REPORT_INFORMATION_CONTRACT,
    internalReview: RESEARCH_REPORT_INTERNAL_REVIEW,
    requiredInformation: [
      "the research topic or question",
      "the purpose of the report",
    ],
    highValueInformation: ["sources or data used", "the intended audience"],
    clarificationQuestions: [
      "What's the research topic or question, and what's the report for?",
      "What sources or information should it be grounded in?",
    ],
    recommendedUploads: ["source material, data or notes already gathered"],
    inferableInformation: ["standard research-report structure"],
    riskChecks: [
      "findings grounded only in supplied sources — nothing fabricated",
      "conclusion actually answers the stated question",
      "conflicting evidence not hidden",
    ],
    outputStructure: [
      "research question and purpose",
      "method or sources used",
      "findings grounded in supplied evidence",
      "analysis relating findings to the question",
      "conclusion and recommendations",
    ],
  },
  {
    key: "workplace-policy",
    label: "Catalogue \u2014 workplace policy",
    matches: [
      "workplace policy",
      "hr policy",
      "company policy",
      "staff policy",
    ],
    domains: [
      "business",
    ],
    requiredInformation: [
      "the behaviour or area the policy governs",
      "who or what the policy covers",
      "the required behaviours or rules",
    ],
    highValueInformation: [
      "the reporting or escalation pathway",
      "the policy owner",
      "consequences for non-compliance",
    ],
    clarificationQuestions: [
      "What behaviour or area does this policy need to cover, and who does it apply to?",
      "What are the specific rules or requirements, and what happens if they're not followed?",
    ],
    recommendedUploads: [
      "any existing policy being replaced",
      "relevant award or legislative reference",
    ],
    inferableInformation: [
      "standard policy structure (purpose, rules, responsibilities, breaches)",
    ],
    riskChecks: [
      "rules stated as clear, enforceable do/do-not requirements, not vague aspirations",
      "consistent with the Fair Work Act and no invented legal obligations",
      "responsibilities assigned to a named role, not left ambiguous",
    ],
    outputStructure: [
      "purpose and scope",
      "policy statements",
      "roles and responsibilities",
      "reporting, review and evidenced breach process",
    ],
  },
  {
    key: "sop",
    label: "Catalogue \u2014 sop",
    matches: [
      "standard operating procedure",
      "sop",
      "work procedure",
      "process document",
    ],
    domains: [
      "business",
    ],
    requiredInformation: [
      "the process name and why it exists",
      "who the procedure applies to",
      "the sequential steps to complete it",
    ],
    highValueInformation: [
      "decision points within the process",
      "quality checks",
      "where records are stored and review cadence",
    ],
    clarificationQuestions: [
      "What's the process, and who needs to follow it?",
      "What are the actual steps in order, including any decision points?",
    ],
    recommendedUploads: [
      "any existing procedure or work instructions",
      "relevant safety or compliance requirements",
    ],
    inferableInformation: [
      "numbered step formatting and standard SOP structure",
    ],
    riskChecks: [
      "every step is a single, unambiguous action with a named performer",
      "no step skipped or assumed obvious",
      "safety or compliance requirements not omitted",
    ],
    outputStructure: [
      "purpose, scope and prerequisites",
      "ordered procedure steps and controls",
      "roles and responsibilities",
      "records, exceptions and revision control",
    ],
  },
  {
    key: "offer-letter",
    label: "Catalogue \u2014 offer letter",
    matches: [
      "offer letter",
      "job offer",
      "employment offer",
    ],
    domains: [
      "business",
    ],
    requiredInformation: [
      "job title",
      "employer name",
      "start date",
      "salary or wage rate",
    ],
    highValueInformation: [
      "ordinary hours of work",
      "reporting line and work location",
      "any conditions the offer is subject to",
    ],
    clarificationQuestions: [
      "What's the role, employer, start date and pay rate being offered?",
      "Is the offer conditional on anything (references, checks, qualifications), and by when must it be accepted?",
    ],
    recommendedUploads: [
      "the position description",
      "the relevant award or enterprise agreement",
    ],
    inferableInformation: [
      "standard offer-letter acceptance mechanics",
    ],
    riskChecks: [
      "pay and hours consistent with the relevant award",
      "conditions of offer stated plainly, not buried",
      "acceptance deadline and method unambiguous",
    ],
    outputStructure: [
      "parties, role and offer",
      "confirmed key terms",
      "conditions and checks",
      "acceptance method and deadline",
    ],
  },
  {
    key: "terms-of-employment",
    label: "Catalogue \u2014 terms of employment",
    matches: [
      "terms of employment",
      "employment contract",
      "employment agreement",
      "contract of employment",
    ],
    domains: [
      "business",
    ],
    requiredInformation: [
      "employer's legal name",
      "employee's name and job title",
      "pay rate and ordinary hours",
      "notice period",
    ],
    highValueInformation: [
      "leave entitlements",
      "superannuation contribution rate",
      "employee's core duties",
    ],
    clarificationQuestions: [
      "Who's the employer and employee, what's the role, and what's the pay and hours?",
      "What's the notice period, and are there any probation or entitlement terms to confirm?",
    ],
    recommendedUploads: [
      "the relevant award or enterprise agreement",
      "the position description",
    ],
    inferableInformation: [
      "Fair Work Act minimum notice periods where not overridden by contract",
    ],
    riskChecks: [
      "notice period, pay and entitlements consistent with the Fair Work Act minimums",
      "no invented entitlements or obligations",
      "employee and employer obligations both stated, not one-sided",
    ],
    outputStructure: [
      "parties and role",
      "confirmed pay, hours and location",
      "duties, policies and obligations",
      "leave and ending employment",
      "acknowledgement",
    ],
  },
  {
    key: "induction-manual",
    label: "Catalogue \u2014 induction manual",
    matches: [
      "induction manual",
      "new starter guide",
      "employee induction",
      "staff handbook",
    ],
    domains: [
      "business",
    ],
    requiredInformation: [
      "company name and what it does",
      "the new starter's role context",
      "core systems and communication channels used",
    ],
    highValueInformation: [
      "key policies a new hire must know on day one",
      "who's who (manager, HR, IT, buddy contacts)",
    ],
    clarificationQuestions: [
      "What does the company do, and what's the new starter's role?",
      "What systems, tools and key policies does someone need to know from day one?",
    ],
    recommendedUploads: [
      "the workplace policy or staff handbook",
      "an org chart",
    ],
    inferableInformation: [
      "a warm, welcoming tone appropriate to a new hire's first read",
    ],
    riskChecks: [
      "policy references accurate, not invented",
      "contacts and systems named specifically, not generically",
      "welcoming tone without overstating culture claims",
    ],
    outputStructure: [
      "welcome and organisation context",
      "how work is performed",
      "key supplied policies and safety information",
      "systems, contacts and first-period guidance",
    ],
  },
  {
    key: "onboarding-checklist",
    label: "Catalogue \u2014 onboarding checklist",
    matches: [
      "onboarding checklist",
      "new hire checklist",
      "starter checklist",
    ],
    domains: [
      "business",
    ],
    requiredInformation: [
      "the new hire's role and start date",
      "pre-start tasks (contract, payroll, equipment, access)",
    ],
    highValueInformation: [
      "first-day and first-week tasks",
      "a buddy or manager assigned to support the new hire",
    ],
    clarificationQuestions: [
      "Who's starting, in what role, and when?",
      "What needs to be ready before day one (equipment, access, contract), and what happens in the first week?",
    ],
    recommendedUploads: [
      "the position description",
      "the induction manual if one exists",
    ],
    inferableInformation: [
      "standard pre-start / day-one / first-week task sequencing",
    ],
    riskChecks: [
      "tasks assigned to a specific owner, not left unassigned",
      "compliance basics (contract, right-to-work) not omitted",
      "realistic timing across pre-start through first month",
    ],
    outputStructure: [
      "pre-start tasks",
      "first-day tasks",
      "first-week tasks",
      "role training and access",
      "owner, due date, status and evidence",
    ],
  },
  {
    key: "service-agreement",
    label: "Catalogue \u2014 service agreement",
    matches: [
      "service agreement",
      "services contract",
      "client agreement",
    ],
    domains: [
      "business",
    ],
    informationContract: SERVICE_AGREEMENT_INFORMATION_CONTRACT,
    internalReview: SERVICE_AGREEMENT_INTERNAL_REVIEW,
    requiredInformation: [
      "provider and client",
      "the services being provided",
      "fee amount and payment timing",
      "start date",
    ],
    highValueInformation: [
      "what's explicitly excluded from the service",
      "termination rights and notice period",
    ],
    clarificationQuestions: [
      "Who's the provider and client, and what services are being delivered?",
      "What are the fees and payment terms, and how can either side end the agreement?",
    ],
    recommendedUploads: [
      "any quote or proposal already agreed",
      "the business's standard terms",
    ],
    inferableInformation: [
      "standard services-agreement clause structure",
    ],
    riskChecks: [
      "scope and exclusions both stated, not just what's included",
      "fees and payment terms internally consistent",
      "not legal advice \u2014 recommend legal review for high-value agreements",
    ],
    outputStructure: [
      "parties and effective period",
      "scope, deliverables and exclusions",
      "fees, tax and payment terms",
      "responsibilities, changes and disputes",
      "termination and signatures",
    ],
  },
  {
    key: "proposal",
    label: "Catalogue \u2014 proposal",
    matches: [
      "business proposal",
      "project proposal",
      "sales proposal",
      "quote proposal",
    ],
    domains: [
      "business",
    ],
    informationContract: PROPOSAL_INFORMATION_CONTRACT,
    internalReview: PROPOSAL_INTERNAL_REVIEW,
    requiredInformation: [
      "the client and the problem being solved",
      "the proposed solution and deliverables",
      "price and timeframe",
    ],
    highValueInformation: [
      "evidence of capability or past results",
      "what makes this offer different from alternatives",
    ],
    clarificationQuestions: [
      "Who's the client, what problem are you solving, and what's the proposed solution?",
      "What's the price and timeline, and what should happen next to move forward?",
    ],
    recommendedUploads: [
      "any brief or RFP received from the client",
      "case studies or past results",
    ],
    inferableInformation: [
      "standard persuasive-proposal structure (summary, problem, solution, price, next steps)",
    ],
    riskChecks: [
      "price and scope consistent throughout",
      "claims of capability backed by real evidence, not generic confidence",
      "next steps concrete, not vague",
    ],
    outputStructure: [
      "executive summary",
      "confirmed need and objectives",
      "proposed solution and scope",
      "evidence, price and timeline",
      "assumptions, risks and next steps",
    ],
  },
  {
    key: "budget-workbook",
    label: "Catalogue \u2014 budget workbook",
    matches: [
      "personal budget",
      "household budget",
      "budget planner",
    ],
    domains: [
      "finance",
    ],
    informationContract: BUDGET_WORKBOOK_INFORMATION_CONTRACT,
    internalReview: BUDGET_WORKBOOK_INTERNAL_REVIEW,
    requiredInformation: [
      "income sources and amounts",
      "regular expense categories and amounts",
      "savings goal or current savings",
    ],
    highValueInformation: [
      "any debts, balances and minimum repayments",
      "irregular or annual expenses",
    ],
    clarificationQuestions: [
      "What's coming in (income sources and amounts), and what are the regular expenses?",
      "Is there a savings goal or debt to plan around, and how much can realistically go toward each?",
    ],
    recommendedUploads: [
      "recent bank or account statements",
      "bills or loan statements",
    ],
    inferableInformation: [
      "standard weekly/fortnightly/monthly budgeting cadence",
    ],
    riskChecks: [
      "income and expense figures reconcile, no invented amounts",
      "debt repayments realistic against stated income",
      "essential vs discretionary spending kept distinct",
    ],
    outputStructure: [
      "period, basis and assumptions",
      "itemised income",
      "itemised fixed and variable expenses",
      "savings, debt and cash position",
      "reconciled totals and scenarios",
    ],
  },
  {
    key: "personal-brand-statement",
    label: "Catalogue \u2014 personal brand statement",
    matches: [
      "personal brand statement",
      "professional positioning statement",
      "elevator pitch",
    ],
    domains: [
      "employment",
    ],
    informationContract: PERSONAL_BRAND_STATEMENT_INFORMATION_CONTRACT,
    internalReview: PERSONAL_BRAND_STATEMENT_INTERNAL_REVIEW,
    requiredInformation: [
      "profession, role or specialty",
      "who you help and the outcome you deliver",
      "at least one concrete achievement or credibility signal",
    ],
    highValueInformation: [
      "what differentiates you from others in the same space",
      "the future direction or opportunity you're aiming for",
    ],
    clarificationQuestions: [
      "What's your profession or specialty, and who do you help \u2014 with what outcome?",
      "What's one concrete achievement or credential that backs this up?",
    ],
    recommendedUploads: [
      "current resume or LinkedIn profile",
    ],
    inferableInformation: [
      "a concise, memorable tone appropriate to a short positioning statement",
    ],
    riskChecks: [
      "proof point is a real, specific achievement, not a vague competence claim",
      "positioning specific enough to be memorable, not generic",
      "consistent terminology with the person's actual resume",
    ],
    outputStructure: [
      "professional identity",
      "specific value proposition",
      "confirmed proof",
      "target direction and concise final statement",
    ],
  },
  {
    key: "career-change-plan",
    label: "Catalogue \u2014 career change plan",
    matches: [
      "career change plan",
      "career transition plan",
      "career pivot plan",
    ],
    domains: [
      "employment",
    ],
    informationContract: CAREER_CHANGE_PLAN_INFORMATION_CONTRACT,
    internalReview: CAREER_CHANGE_PLAN_INTERNAL_REVIEW,
    requiredInformation: [
      "current role or field",
      "target role or field",
      "transferable skills from current experience",
    ],
    highValueInformation: [
      "skill or experience gaps and how to close them",
      "a realistic timeframe with milestones",
    ],
    clarificationQuestions: [
      "What's the current role or field, and what's the target?",
      "What skills or experience are missing for the target field, and is there a deadline or timeframe in mind?",
    ],
    recommendedUploads: [
      "current resume",
      "any target job ads or role descriptions",
    ],
    inferableInformation: [
      "sensible sequencing of skill-building before job-search actions",
    ],
    riskChecks: [
      "transferable skills backed by real evidence, not just asserted",
      "gap-closing actions specific (named courses/projects), not vague",
      "timeline realistic against the size of the gap",
    ],
    outputStructure: [
      "target direction and constraints",
      "transferable evidence",
      "verified gaps and learning plan",
      "job-search actions, milestones and review",
    ],
  },
  {
    key: "resignation-letter",
    label: "Catalogue \u2014 resignation letter",
    matches: [
      "resignation letter",
      "letter of resignation",
      "quitting letter",
    ],
    domains: [
      "employment",
    ],
    informationContract: RESIGNATION_LETTER_INFORMATION_CONTRACT,
    internalReview: RESIGNATION_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "role and employer",
      "final working day",
      "notice period being given",
    ],
    highValueInformation: [
      "a brief note of appreciation",
      "an offer to help with handover",
    ],
    clarificationQuestions: [
      "What's your role and employer, and what's your proposed final working day?",
      "What's your notice period, and is there anything specific you'd like to hand over or acknowledge?",
    ],
    recommendedUploads: [
      "the employment contract, to confirm the notice period",
    ],
    inferableInformation: [
      "standard professional resignation-letter structure and tone",
    ],
    riskChecks: [
      "final working day consistent with the stated or contractual notice period",
      "tone professional and free of grievance even if the departure is difficult",
      "handover offer concrete, not just a vague gesture",
    ],
    outputStructure: [
      "dated notice statement",
      "confirmed final-day wording or notice basis",
      "brief appreciation",
      "transition support and professional close",
    ],
  },
  {
    key: "networking-outreach-message",
    label: "Catalogue \u2014 networking outreach message",
    matches: [
      "networking message",
      "linkedin outreach",
      "cold outreach message",
      "informational interview request",
    ],
    domains: [
      "employment",
    ],
    informationContract: NETWORKING_OUTREACH_MESSAGE_INFORMATION_CONTRACT,
    internalReview: NETWORKING_OUTREACH_MESSAGE_INTERNAL_REVIEW,
    requiredInformation: [
      "who you are and why you're contacting this specific person",
      "the topic or advice being sought",
      "the specific, low-effort ask",
    ],
    highValueInformation: [
      "a shared connection or specific reference to their work",
      "flexibility around their schedule",
    ],
    clarificationQuestions: [
      "Who are you reaching out to, and why this specific person?",
      "What are you hoping to learn, and what's the specific, low-pressure ask (a quick call, one question, an intro)?",
    ],
    recommendedUploads: [
      "the recipient's LinkedIn profile or recent published work, if known",
    ],
    inferableInformation: [
      "a respectful, low-pressure tone appropriate to a cold professional message",
    ],
    riskChecks: [
      "the ask is small and specific, not open-ended",
      "reason for contacting this person is genuine, not generic flattery",
      "message stays brief \u2014 respects the recipient's time",
    ],
    outputStructure: [
      "personal introduction",
      "specific and truthful reason for contact",
      "small clear request",
      "low-pressure close",
    ],
  },
  {
    key: "executive-summary",
    label: "Catalogue \u2014 executive summary",
    matches: [
      "executive summary",
      "leadership summary",
      "management summary",
    ],
    domains: [
      "business",
    ],
    informationContract: EXECUTIVE_SUMMARY_INFORMATION_CONTRACT,
    internalReview: EXECUTIVE_SUMMARY_INTERNAL_REVIEW,
    requiredInformation: [
      "what's being summarised and for whom",
      "the current situation and key issues",
      "the recommendation and rationale",
    ],
    highValueInformation: [
      "the specific decision or approval being requested",
      "the deadline for that decision",
    ],
    clarificationQuestions: [
      "What document or decision is this summarising, and who's the audience?",
      "What's the recommendation, and what specific approval or decision is needed, by when?",
    ],
    recommendedUploads: [
      "the full report, plan or proposal being summarised",
    ],
    inferableInformation: [
      "a concise, decision-focused executive tone",
    ],
    riskChecks: [
      "recommendation stated directly, not hedged into vagueness",
      "current situation described honestly, issues not glossed over",
      "the specific decision required is unambiguous",
    ],
    outputStructure: [
      "purpose and decision context",
      "current situation and material evidence",
      "options or recommendation",
      "risks, implications and decision required",
    ],
  },
  {
    key: "pitch-deck-outline",
    label: "Catalogue \u2014 pitch deck outline",
    matches: [
      "pitch deck",
      "investor pitch",
      "funding pitch outline",
    ],
    domains: [
      "business",
    ],
    informationContract: PITCH_DECK_OUTLINE_INFORMATION_CONTRACT,
    internalReview: PITCH_DECK_OUTLINE_INTERNAL_REVIEW,
    requiredInformation: [
      "the target customer's problem",
      "the product or service and its core benefit",
      "the funding or support amount being sought and its use",
    ],
    highValueInformation: [
      "market size and proof of traction so far",
      "the revenue model and pricing",
    ],
    clarificationQuestions: [
      "What's the customer problem, and how does the product solve it?",
      "How much are you seeking, what will it be used for, and what traction or evidence do you have so far?",
    ],
    recommendedUploads: [
      "any existing pitch materials or financial model",
    ],
    inferableInformation: [
      "standard investor pitch sequencing (problem, solution, market, model, ask)",
    ],
    riskChecks: [
      "traction claims backed by real evidence, not aspiration stated as fact",
      "the ask (amount, use of funds) is specific, not vague",
      "market size figures not invented",
    ],
    outputStructure: [
      "problem and evidence",
      "solution and value",
      "market, model and confirmed traction",
      "team and plan",
      "financial basis, risks and specific ask",
    ],
  },
  {
    key: "scope-of-work",
    label: "Catalogue \u2014 scope of work",
    matches: [
      "scope of work",
      "sow",
      "project scope document",
    ],
    domains: [
      "business",
    ],
    informationContract: SCOPE_OF_WORK_INFORMATION_CONTRACT,
    internalReview: SCOPE_OF_WORK_INTERNAL_REVIEW,
    requiredInformation: [
      "the project outcome, client and timeframe",
      "what's included (in-scope work)",
      "what's explicitly excluded",
    ],
    highValueInformation: [
      "deliverable acceptance criteria",
      "assumptions or dependencies the scope relies on",
    ],
    clarificationQuestions: [
      "What's the project outcome, for whom, and by when?",
      "What's specifically included, and what's explicitly excluded \u2014 and what happens if extra work is requested?",
    ],
    recommendedUploads: [
      "any brief, proposal or contract this scope relates to",
    ],
    inferableInformation: [
      "a change-request pathway for anything not confirmed in writing",
    ],
    riskChecks: [
      "in-scope and out-of-scope both stated, not just one",
      "each deliverable concrete enough to verify completion",
      "assumptions the scope depends on made explicit",
    ],
    outputStructure: [
      "project context and objectives",
      "in-scope and out-of-scope work",
      "deliverables, milestones and acceptance",
      "roles, assumptions and dependencies",
      "changes, fees and approval",
    ],
  },
  {
    key: "marketing-brief",
    label: "Catalogue \u2014 marketing brief",
    matches: [
      "marketing brief",
      "campaign brief",
      "creative brief",
    ],
    domains: [
      "business",
    ],
    informationContract: MARKETING_BRIEF_INFORMATION_CONTRACT,
    internalReview: MARKETING_BRIEF_INTERNAL_REVIEW,
    requiredInformation: [
      "the campaign goal, product/service and deadline",
      "the target audience and their need",
      "the core message",
    ],
    highValueInformation: [
      "required deliverables and distribution channels",
      "how success will be measured",
    ],
    clarificationQuestions: [
      "What's the campaign goal, and by when \u2014 and who's it for?",
      "What's the core message, and which channels or deliverables does it need to run across?",
    ],
    recommendedUploads: [
      "brand guidelines",
      "any prior campaign material",
    ],
    inferableInformation: [
      "a standard funnel-stage framing (awareness, consideration, conversion)",
    ],
    riskChecks: [
      "goal is specific and time-bound, not a vague aspiration",
      "success metrics are actually trackable, not aspirational",
      "message backed by real proof points, not just claims",
    ],
    outputStructure: [
      "objective and audience",
      "evidence-backed insight and message",
      "channels, deliverables and requirements",
      "budget and timing constraints",
      "success measures and approvals",
    ],
  },
  {
    key: "statement-of-purpose",
    label: "Catalogue \u2014 statement of purpose",
    matches: [
      "statement of purpose",
      "sop for grad school",
      "graduate application statement",
    ],
    domains: [
      "education",
    ],
    informationContract: STATEMENT_OF_PURPOSE_INFORMATION_CONTRACT,
    internalReview: STATEMENT_OF_PURPOSE_INTERNAL_REVIEW,
    requiredInformation: [
      "intended field of study and topic of interest",
      "relevant academic or professional background",
      "why this specific program is the right fit",
    ],
    highValueInformation: [
      "a defined career or research goal after completion",
      "named program features (faculty, labs, courses)",
    ],
    clarificationQuestions: [
      "What field and topic are you applying to study, and what's your relevant background?",
      "Why this specific program, and what's your goal after completing it?",
    ],
    recommendedUploads: [
      "academic transcript",
      "the program's course or faculty listing",
    ],
    inferableInformation: [
      "standard graduate statement-of-purpose structure (focus, preparation, fit, direction)",
    ],
    riskChecks: [
      "program-fit reasons name real, specific features, not generic praise",
      "background claims accurate to the applicant's actual history",
      "goal genuinely follows from the program, not a bolted-on ending",
    ],
    outputStructure: [
      "academic or professional focus",
      "confirmed preparation and evidence",
      "specific program fit",
      "future direction and contribution",
    ],
  },
  {
    key: "study-plan",
    label: "Catalogue \u2014 study plan",
    matches: [
      "study plan",
      "exam prep plan",
      "learning plan",
    ],
    domains: [
      "education",
    ],
    informationContract: STUDY_PLAN_INFORMATION_CONTRACT,
    internalReview: STUDY_PLAN_INTERNAL_REVIEW,
    requiredInformation: [
      "the subject or skill, deadline and success measure",
      "current strengths and priority gaps",
      "weekly study hours available",
    ],
    highValueInformation: [
      "a practice or review method",
      "when progress will be checked",
    ],
    clarificationQuestions: [
      "What are you studying for, by when, and how will you know you've succeeded?",
      "How many hours a week can you realistically study, and what are your current strengths and gaps?",
    ],
    recommendedUploads: [
      "past results, diagnostics or practice-test scores",
    ],
    inferableInformation: [
      "spaced-repetition and practice-test cadence as standard study techniques",
    ],
    riskChecks: [
      "weekly hours realistic against the stated deadline",
      "gaps named honestly, not glossed over",
      "a review checkpoint exists so the plan can adjust",
    ],
    outputStructure: [
      "specific learning goal and baseline",
      "subjects, resources and priorities",
      "realistic weekly schedule",
      "milestones, evidence and accountability",
      "review and adjustment",
    ],
  },
  {
    key: "research-proposal",
    label: "Catalogue \u2014 research proposal",
    matches: [
      "research proposal",
      "thesis proposal",
      "phd proposal",
      "honours proposal",
    ],
    domains: [
      "education",
    ],
    informationContract: RESEARCH_PROPOSAL_INFORMATION_CONTRACT,
    internalReview: RESEARCH_PROPOSAL_INTERNAL_REVIEW,
    requiredInformation: [
      "working title and central research question",
      "the research gap or problem it responds to",
      "the method, data source and analysis approach",
    ],
    highValueInformation: [
      "the academic or practical value expected",
      "ethics, sampling or feasibility considerations",
    ],
    clarificationQuestions: [
      "What's the research question, and what gap in existing work does it respond to?",
      "What method and data or participants will the research use?",
    ],
    recommendedUploads: [
      "key literature or a reading list already gathered",
    ],
    inferableInformation: [
      "standard research-proposal structure (title/question, background, method, contribution)",
    ],
    riskChecks: [
      "research question specific enough to actually be answered, not a broad area of interest",
      "method concrete enough that feasibility could be assessed",
      "claimed gap grounded in real cited literature, not asserted",
    ],
    outputStructure: [
      "title, question and objectives",
      "background, literature context and rationale",
      "methodology, data and ethics",
      "timeline and resources",
      "expected contribution and limitations",
    ],
  },
  {
    key: "literature-review",
    label: "Catalogue \u2014 literature review",
    matches: [
      "literature review",
      "lit review",
      "review of the literature",
    ],
    domains: [
      "education",
    ],
    informationContract: LITERATURE_REVIEW_INFORMATION_CONTRACT,
    internalReview: LITERATURE_REVIEW_INTERNAL_REVIEW,
    requiredInformation: [
      "the topic and review boundaries",
      "the main themes or schools of thought",
      "the gap the review identifies",
    ],
    highValueInformation: [
      "key authors or studies representing each theme",
      "areas of genuine disagreement in the literature",
    ],
    clarificationQuestions: [
      "What's the topic, and what boundaries (date range, themes) define this review's scope?",
      "What are the main themes or debates in the literature, and what gap does this review point to?",
    ],
    recommendedUploads: [
      "source material or a reading list already gathered",
    ],
    inferableInformation: [
      "standard literature-review structure (scope, themes, debate, gap)",
    ],
    riskChecks: [
      "themes attributed to real, named sources, not invented scholarship",
      "disagreements presented fairly, not one-sided",
      "the identified gap genuinely follows from the themes discussed",
    ],
    outputStructure: [
      "review scope and method",
      "synthesised themes",
      "debates, patterns and evidence quality",
      "identified gap",
      "implications and direction",
    ],
  },
  {
    key: "academic-appeal-letter",
    label: "Catalogue \u2014 academic appeal letter",
    matches: [
      "academic appeal",
      "grade appeal letter",
      "exclusion appeal",
    ],
    domains: [
      "education",
    ],
    informationContract: ACADEMIC_APPEAL_LETTER_INFORMATION_CONTRACT,
    internalReview: ACADEMIC_APPEAL_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "the exact decision being appealed, date and course",
      "the grounds for appeal",
      "supporting evidence",
    ],
    highValueInformation: [
      "the specific remedy being requested",
      "any relevant policy clause",
    ],
    clarificationQuestions: [
      "What decision are you appealing, when was it made, and on what grounds?",
      "What evidence supports the appeal, and what specific outcome are you requesting?",
    ],
    recommendedUploads: [
      "the original decision notice",
      "supporting evidence (medical certificate, correspondence)",
    ],
    inferableInformation: [
      "a factual, non-adversarial tone appropriate to a formal academic appeal",
    ],
    riskChecks: [
      "grounds stated factually, not as a fairness complaint",
      "evidence referenced actually supports the grounds claimed",
      "requested remedy stated plainly, not implied",
    ],
    outputStructure: [
      "decision and applicable process",
      "evidence-backed grounds",
      "clear factual explanation and chronology",
      "specific requested outcome",
      "attachments and respectful close",
    ],
  },
  {
    key: "extension-request-letter",
    label: "Catalogue \u2014 extension request letter",
    matches: [
      "extension request",
      "assignment extension",
      "deadline extension letter",
    ],
    domains: [
      "education",
    ],
    informationContract: EXTENSION_REQUEST_LETTER_INFORMATION_CONTRACT,
    internalReview: EXTENSION_REQUEST_LETTER_INTERNAL_REVIEW,
    requiredInformation: [
      "the assignment, course and current due date",
      "the circumstance affecting completion",
      "a specific proposed new date",
    ],
    highValueInformation: [
      "supporting evidence available (medical certificate, employer letter)",
      "work already completed",
    ],
    clarificationQuestions: [
      "What's the assignment and current due date, and what's affecting your ability to meet it?",
      "What new date are you proposing, and do you have any supporting evidence?",
    ],
    recommendedUploads: [
      "supporting evidence (medical certificate, employer letter)",
    ],
    inferableInformation: [
      "a brief, factual tone that doesn't over-justify",
    ],
    riskChecks: [
      "proposed new date is realistic given what's left to do, not just 'more time'",
      "circumstance explained factually without inventing detail",
      "evidence mentioned only if it's actually available",
    ],
    outputStructure: [
      "assessment and request",
      "concise factual reason",
      "evidence and impact where appropriate",
      "realistic proposed date",
      "professional close",
    ],
  },
  {
    key: "student-support-plan",
    label: "Catalogue \u2014 student support plan",
    matches: [
      "student support plan",
      "learning support plan",
      "accessibility plan",
    ],
    domains: [
      "education",
    ],
    informationContract: STUDENT_SUPPORT_PLAN_INFORMATION_CONTRACT,
    internalReview: STUDENT_SUPPORT_PLAN_INTERNAL_REVIEW,
    requiredInformation: [
      "the student, course/year level and support area",
      "the student's genuine strengths and existing supports",
      "priority support needs and their impact",
    ],
    highValueInformation: [
      "specific support actions, an owner and a review date",
    ],
    clarificationQuestions: [
      "What's the support area, and what strengths or existing supports does the student already have?",
      "What are the priority needs, and who will own each support action?",
    ],
    recommendedUploads: [
      "any diagnostic report or existing support documentation, with consent",
    ],
    inferableInformation: [
      "a strengths-based framing rather than a deficit-only list",
    ],
    riskChecks: [
      "needs described with real impact, not generic categories",
      "actions have a named owner and review date, not left open-ended",
      "sensitive information (diagnosis, circumstances) handled only with appropriate consent",
    ],
    outputStructure: [
      "student context and goals",
      "strengths and confirmed barriers",
      "reasonable requested supports",
      "actions, owners and communication",
      "review date and privacy controls",
    ],
  },
  {
    key: "course-comparison-matrix",
    label: "Catalogue \u2014 course comparison matrix",
    matches: [
      "course comparison",
      "university comparison",
      "training provider comparison",
    ],
    domains: [
      "education",
    ],
    informationContract: COURSE_COMPARISON_MATRIX_INFORMATION_CONTRACT,
    internalReview: COURSE_COMPARISON_MATRIX_INTERNAL_REVIEW,
    requiredInformation: [
      "at least two named courses or programs being compared",
      "the decision criteria that matter (cost, duration, outcome)",
      "each option's real strengths and weaknesses",
    ],
    highValueInformation: [
      "a preferred option and the reasoning",
      "application deadlines",
    ],
    clarificationQuestions: [
      "Which courses or programs are you comparing, and what matters most in the decision (cost, duration, outcome, mode)?",
      "Is there a front-runner already, or a specific trade-off you're stuck on?",
    ],
    recommendedUploads: [
      "course brochures or comparison data already gathered",
    ],
    inferableInformation: [
      "a decision-matrix structure weighing options against named criteria",
    ],
    riskChecks: [
      "comparison is honest \u2014 not every option treated as equally good",
      "criteria actually relevant to this specific decision, not generic",
      "recommendation's reasoning stated explicitly, not just asserted",
    ],
    outputStructure: [
      "decision goal and candidate courses",
      "criteria, weighting and dated sources",
      "evidence matrix with unknowns",
      "trade-offs and limitations",
      "reasoned recommendation",
    ],
  },
  {
    key: "academic-reference-request",
    label: "Catalogue \u2014 academic reference request",
    matches: [
      "reference request letter",
      "ask for an academic reference",
      "recommendation letter request",
    ],
    domains: [
      "education",
    ],
    informationContract: ACADEMIC_REFERENCE_REQUEST_INFORMATION_CONTRACT,
    internalReview: ACADEMIC_REFERENCE_REQUEST_INTERNAL_REVIEW,
    requiredInformation: [
      "what you're applying for and the reference being requested",
      "how the referee knows your work and over what period",
      "what the opportunity is looking for",
    ],
    highValueInformation: [
      "the deadline and submission method",
      "an offer to provide supporting materials (resume, transcript)",
    ],
    clarificationQuestions: [
      "What are you applying for, and who are you asking \u2014 how do they know your work?",
      "What's the deadline, and what should the referee emphasise for this particular opportunity?",
    ],
    recommendedUploads: [
      "current resume or transcript to offer the referee",
    ],
    inferableInformation: [
      "a respectful tone that gives the referee an easy opt-out",
    ],
    riskChecks: [
      "relationship context is specific (course, timeframe, work done), not vague",
      "deadline and submission method stated clearly",
      "genuinely gives the referee room to decline",
    ],
    outputStructure: [
      "clear request and deadline",
      "confirmed relationship context",
      "course, role or scholarship context",
      "supporting materials and submission method",
      "gracious close and opt-out",
    ],
  },
  {
    key: "forecasted-earnings",
    label: "Catalogue \u2014 forecasted earnings",
    matches: [
      "earnings forecast",
      "revenue forecast",
      "financial forecast",
    ],
    domains: [
      "finance",
    ],
    informationContract: FORECASTED_EARNINGS_INFORMATION_CONTRACT,
    internalReview: FORECASTED_EARNINGS_INTERNAL_REVIEW,
    requiredInformation: [
      "forecast horizon and baseline period",
      "revenue and cost assumptions",
      "currency",
    ],
    highValueInformation: [
      "seasonality or expected pricing/headcount changes",
      "upside and downside scenarios",
    ],
    clarificationQuestions: [
      "What's the forecast horizon, and what are the confirmed revenue and cost assumptions it's built on?",
      "Is there a base case plus upside/downside scenario you want modelled?",
    ],
    recommendedUploads: [
      "historical financial statements or accounting exports",
    ],
    inferableInformation: [
      "standard period-by-period forecast layout",
    ],
    riskChecks: [
      "every figure traces to a confirmed historical baseline or a stated assumption, never invented",
      "assumptions kept visibly distinct from confirmed data",
      "calculations reconcile internally",
    ],
    outputStructure: [
      "basis and assumptions register",
      "historical baseline",
      "revenue and cost forecasts",
      "earnings calculations",
      "base, upside and downside scenarios",
      "risks, sensitivities and limitations",
    ],
  },
  {
    key: "ebitda-analysis",
    label: "Catalogue \u2014 ebitda analysis",
    matches: [
      "ebitda analysis",
      "ebitda reconciliation",
      "normalised earnings",
    ],
    domains: [
      "finance",
    ],
    informationContract: EBITDA_ANALYSIS_INFORMATION_CONTRACT,
    internalReview: EBITDA_ANALYSIS_INTERNAL_REVIEW,
    requiredInformation: [
      "entity, period, currency and accounting basis",
      "the source operating result",
      "proposed normalising adjustments with evidence",
    ],
    highValueInformation: [
      "period-over-period comparison",
      "margin trends",
    ],
    clarificationQuestions: [
      "What's the entity, period and source operating result you're starting from?",
      "What normalising adjustments are you proposing, and what's the evidence for each?",
    ],
    recommendedUploads: [
      "financial statements or the accounting export the result is drawn from",
    ],
    inferableInformation: [
      "standard interest/tax/depreciation/amortisation reconciliation structure",
    ],
    riskChecks: [
      "every adjustment has stated evidence and rationale, not asserted without basis",
      "the EBITDA definition used is stated explicitly",
      "reported-vs-adjusted figures both shown, not just the adjusted number",
    ],
    outputStructure: [
      "source operating result",
      "interest, tax, depreciation and amortisation reconciliation",
      "reported EBITDA",
      "evidenced adjustments",
      "adjusted EBITDA when requested",
      "margin comparison and limitations",
    ],
  },
  {
    key: "quote-estimate",
    label: "Catalogue \u2014 quote estimate",
    matches: [
      "quote",
      "estimate",
      "price quote",
    ],
    domains: [
      "business",
    ],
    informationContract: QUOTE_ESTIMATE_INFORMATION_CONTRACT,
    internalReview: QUOTE_ESTIMATE_INTERNAL_REVIEW,
    requiredInformation: [
      "supplier and customer identity",
      "scope and itemised pricing",
      "validity period",
    ],
    highValueInformation: [
      "payment terms",
      "what's excluded from the quoted price",
    ],
    clarificationQuestions: [
      "Who's the supplier and customer, and what's the itemised scope and pricing?",
      "How long is the quote valid, and what are the payment terms?",
    ],
    recommendedUploads: [
      "any specification or request the quote responds to",
    ],
    inferableInformation: [
      "standard quote-to-invoice acceptance flow",
    ],
    riskChecks: [
      "totals reconcile from the itemised lines, no arithmetic invented",
      "validity period and exclusions both stated",
      "tax treatment consistent throughout",
    ],
    outputStructure: [
      "supplier and customer",
      "scope and itemised pricing",
      "tax and total",
      "timing, validity, exclusions and variations",
      "payment terms and acceptance",
    ],
  },
  {
    key: "invoice",
    label: "Catalogue \u2014 invoice",
    matches: [
      "invoice",
      "tax invoice",
      "bill",
    ],
    domains: [
      "finance",
    ],
    informationContract: INVOICE_INFORMATION_CONTRACT,
    internalReview: INVOICE_INTERNAL_REVIEW,
    requiredInformation: [
      "supplier and customer",
      "invoice number, issue and due dates",
      "itemised items with quantity and unit price",
    ],
    highValueInformation: [
      "purchase order reference",
      "payment method and reference",
    ],
    clarificationQuestions: [
      "Who's the supplier and customer, and what items or services are being invoiced?",
      "What are the invoice number, dates, and payment terms?",
    ],
    recommendedUploads: [
      "the quote, purchase order or contract this invoice relates to",
    ],
    inferableInformation: [
      "standard subtotal, tax and total calculation",
    ],
    riskChecks: [
      "subtotal, tax and total reconcile deterministically from the line items",
      "invoice number and dates present and consistent",
      "tax treatment correct for the stated jurisdiction",
    ],
    outputStructure: [
      "supplier and customer",
      "invoice identifiers and dates",
      "itemised supplies",
      "subtotal, tax and total",
      "payment terms and payment details",
    ],
  },
  {
    key: "purchase-order",
    label: "Catalogue \u2014 purchase order",
    matches: [
      "purchase order",
      "po",
      "order form",
    ],
    domains: [
      "business",
    ],
    informationContract: PURCHASE_ORDER_INFORMATION_CONTRACT,
    internalReview: PURCHASE_ORDER_INTERNAL_REVIEW,
    requiredInformation: [
      "buyer and supplier",
      "PO number",
      "items, quantities and agreed prices",
      "delivery details",
    ],
    highValueInformation: [
      "approval status",
      "budget code",
    ],
    clarificationQuestions: [
      "Who's the buyer and supplier, and what items or quantities are being ordered at what price?",
      "What's the delivery timeline, and has this been approved?",
    ],
    recommendedUploads: [
      "the supplier's quote this order is based on",
    ],
    inferableInformation: [
      "standard PO-to-invoice reconciliation flow",
    ],
    riskChecks: [
      "prices match the agreed quote, not invented",
      "total reconciles from the itemised lines",
      "order status (draft/approved/sent) stated explicitly, not implied",
    ],
    outputStructure: [
      "buyer, supplier and delivery",
      "PO identifiers and approval",
      "itemised order",
      "tax and totals",
      "terms and revision history",
    ],
  },
  {
    key: "cash-flow-forecast",
    label: "Catalogue \u2014 cash flow forecast",
    matches: [
      "cash flow forecast",
      "cash flow projection",
      "cashflow forecast",
    ],
    domains: [
      "finance",
    ],
    informationContract: CASH_FLOW_FORECAST_INFORMATION_CONTRACT,
    internalReview: CASH_FLOW_FORECAST_INTERNAL_REVIEW,
    requiredInformation: [
      "opening cash balance",
      "forecast horizon and granularity",
      "expected inflows and outflows with timing",
    ],
    highValueInformation: [
      "scenario assumptions (best/base/worst)",
      "known low-cash risk periods",
    ],
    clarificationQuestions: [
      "What's the opening cash balance, and what's the forecast horizon?",
      "What are the expected inflows and outflows, and when do they land?",
    ],
    recommendedUploads: [
      "recent bank statements or accounting export",
    ],
    inferableInformation: [
      "deterministic closing-balance calculation from opening cash plus net movements",
    ],
    riskChecks: [
      "closing cash reconciles mathematically from opening cash and stated movements",
      "low-cash periods flagged explicitly, not buried",
      "assumptions kept visibly distinct from confirmed figures",
    ],
    outputStructure: [
      "opening cash and assumptions",
      "period inflows",
      "period outflows",
      "deterministic closing cash",
      "low-cash periods and scenarios",
    ],
  },
  {
    key: "expense-claim",
    label: "Catalogue \u2014 expense claim",
    matches: [
      "expense claim",
      "reimbursement request",
      "expense report",
    ],
    domains: [
      "finance",
    ],
    informationContract: EXPENSE_CLAIM_INFORMATION_CONTRACT,
    internalReview: EXPENSE_CLAIM_INTERNAL_REVIEW,
    requiredInformation: [
      "claimant and organisation or project",
      "claim period",
      "each expense with business purpose, amount and currency",
    ],
    highValueInformation: [
      "receipt references",
      "policy reference",
    ],
    clarificationQuestions: [
      "Who's claiming, for what period, and what expenses are being claimed?",
      "Do you have receipts or evidence for each item, and what's the business purpose of each?",
    ],
    recommendedUploads: [
      "receipts for each claimed expense",
    ],
    inferableInformation: [
      "standard claim-total reconciliation from itemised entries",
    ],
    riskChecks: [
      "total reconciles from the itemised expenses",
      "each item has a stated business purpose, not just an amount",
      "no duplicate entries across the claim period",
    ],
    outputStructure: [
      "claimant and claim period",
      "itemised evidenced expenses",
      "tax and currency treatment",
      "totals and duplicates",
      "declaration and approval state",
    ],
  },
  {
    key: "project-plan",
    label: "Catalogue \u2014 project plan",
    matches: [
      "project plan",
      "project management plan",
      "project delivery plan",
    ],
    domains: [
      "business",
    ],
    informationContract: PROJECT_PLAN_INFORMATION_CONTRACT,
    internalReview: PROJECT_PLAN_INTERNAL_REVIEW,
    requiredInformation: [
      "the project objective and sponsor",
      "scope",
      "deliverables, owners and milestones",
    ],
    highValueInformation: [
      "dependencies between tasks",
      "material risks and how they'll be reviewed",
    ],
    clarificationQuestions: [
      "What's the project objective, who's the sponsor, and what's in scope?",
      "What are the key deliverables and milestones, and who owns each one?",
    ],
    recommendedUploads: [
      "any project brief, charter or business case already approved",
    ],
    inferableInformation: [
      "standard project-plan structure (objective, deliverables/schedule, risks/communications)",
    ],
    riskChecks: [
      "every deliverable has a named owner, not left unassigned",
      "milestones have real dates, not placeholders",
      "success measures are actually measurable",
    ],
    outputStructure: [
      "objective and governance",
      "scope and deliverables",
      "milestones, tasks, owners and dependencies",
      "resources and budget constraints",
      "risks, communications and success measures",
    ],
  },
  {
    key: "project-status-report",
    label: "Catalogue \u2014 project status report",
    matches: [
      "project status report",
      "project update",
      "status report",
    ],
    domains: [
      "business",
    ],
    informationContract: PROJECT_STATUS_REPORT_INFORMATION_CONTRACT,
    internalReview: PROJECT_STATUS_REPORT_INTERNAL_REVIEW,
    requiredInformation: [
      "reporting period and baseline plan",
      "confirmed overall status",
      "completed and upcoming work against plan",
    ],
    highValueInformation: [
      "material risks or issues",
      "budget status",
    ],
    clarificationQuestions: [
      "What's the reporting period, and how does actual progress compare to the baseline plan?",
      "Are there any risks, issues or decisions needing support right now?",
    ],
    recommendedUploads: [
      "the project plan or baseline this report compares against",
    ],
    inferableInformation: [
      "standard RAG (red/amber/green) status framing where evidence supports it",
    ],
    riskChecks: [
      "status claims (on-track/at-risk) backed by evidence, not just asserted",
      "delayed work flagged honestly, not glossed over",
      "risks distinguished from issues (future vs current)",
    ],
    outputStructure: [
      "period and executive status",
      "planned versus confirmed progress",
      "milestones and budget",
      "risks, issues and decisions",
      "upcoming work and support required",
    ],
  },
  {
    key: "meeting-agenda",
    label: "Catalogue \u2014 meeting agenda",
    matches: [
      "meeting agenda",
      "agenda",
      "meeting plan",
    ],
    domains: [
      "business",
    ],
    informationContract: MEETING_AGENDA_INFORMATION_CONTRACT,
    internalReview: MEETING_AGENDA_INTERNAL_REVIEW,
    requiredInformation: [
      "meeting purpose, participants, date and time",
      "agenda topics with owners and time allocation",
    ],
    highValueInformation: [
      "pre-reading required before the meeting",
      "desired decisions or outcomes per topic",
    ],
    clarificationQuestions: [
      "What's the meeting for, who's attending, and when is it?",
      "What topics need covering, who owns each, and how much time does each need?",
    ],
    recommendedUploads: [
      "any pre-reading material or the previous meeting's minutes",
    ],
    inferableInformation: [
      "standard timed-agenda format with a clear purpose per item",
    ],
    riskChecks: [
      "every topic has an owner and a time allocation, not just a title",
      "desired outcome per topic stated, not left implicit",
      "total time allocated realistic against the meeting length",
    ],
    outputStructure: [
      "meeting details and purpose",
      "participants and preparation",
      "timed agenda with owners",
      "decisions required",
      "actions and next-meeting link",
    ],
  },
  {
    key: "action-register",
    label: "Catalogue \u2014 action register",
    matches: [
      "action register",
      "action tracker",
      "action items log",
    ],
    domains: [
      "business",
    ],
    informationContract: ACTION_REGISTER_INFORMATION_CONTRACT,
    internalReview: ACTION_REGISTER_INTERNAL_REVIEW,
    requiredInformation: [
      "the action wording for each item",
      "an owner and due date for each item",
      "current status of each item",
    ],
    highValueInformation: [
      "priority and dependencies between actions",
      "evidence for completed items",
    ],
    clarificationQuestions: [
      "What actions need tracking, and who owns each one?",
      "What are the due dates and current status of each action?",
    ],
    recommendedUploads: [
      "meeting minutes or the source document the actions came from",
    ],
    inferableInformation: [
      "standard open/in-progress/closed status tracking",
    ],
    riskChecks: [
      "every action has a named owner and due date, none left blank",
      "status reflects real progress, not assumed completion",
      "closed actions have evidence, not just a status flip",
    ],
    outputStructure: [
      "action identifiers and sources",
      "action, owner and due date",
      "priority and dependencies",
      "status and evidence",
      "closure and revision history",
    ],
  },
  {
    key: "decision-log",
    label: "Catalogue \u2014 decision log",
    matches: [
      "decision log",
      "decision register",
      "decision record",
    ],
    domains: [
      "business",
    ],
    informationContract: DECISION_LOG_INFORMATION_CONTRACT,
    internalReview: DECISION_LOG_INTERNAL_REVIEW,
    requiredInformation: [
      "the decision, decision-maker, date and context",
      "options considered and the rationale for the choice made",
    ],
    highValueInformation: [
      "dependencies affected by the decision",
      "a review trigger if circumstances change",
    ],
    clarificationQuestions: [
      "What decision was made, by whom, and in what context?",
      "What options were considered, and what's the rationale for the one chosen?",
    ],
    recommendedUploads: [
      "meeting minutes or the paper the decision was based on",
    ],
    inferableInformation: [
      "a traceable record format (date, decision, rationale, status)",
    ],
    riskChecks: [
      "rationale is a real, stated reason, not just the decision restated",
      "decision-maker named, not left ambiguous",
      "options actually considered are listed, not just the chosen one",
    ],
    outputStructure: [
      "decision identifier and context",
      "options considered",
      "decision-maker and decision",
      "confirmed rationale and consequences",
      "dependencies and review trigger",
    ],
  },
  {
    key: "handover-document",
    label: "Catalogue \u2014 handover document",
    matches: [
      "handover document",
      "role handover",
      "transition document",
    ],
    domains: [
      "business",
    ],
    informationContract: HANDOVER_DOCUMENT_INFORMATION_CONTRACT,
    internalReview: HANDOVER_DOCUMENT_INTERNAL_REVIEW,
    requiredInformation: [
      "outgoing and incoming owner",
      "the handover scope",
      "active work, deadlines and key routines",
    ],
    highValueInformation: [
      "known risks or unresolved decisions",
      "system access and file locations",
    ],
    clarificationQuestions: [
      "Who's handing over to whom, and what's the scope of the handover?",
      "What active work, deadlines or routines does the incoming owner need to know about immediately?",
    ],
    recommendedUploads: [
      "access lists, file locations or system credentials documentation (excluding actual passwords)",
    ],
    inferableInformation: [
      "a practical, action-first structure rather than a general role description",
    ],
    riskChecks: [
      "active work and deadlines specific and current, not generic role duties",
      "known risks or gaps disclosed honestly, not omitted to look tidy",
      "contacts and access routes actually named",
    ],
    outputStructure: [
      "owners and handover scope",
      "responsibilities and current status",
      "active work, routines and deadlines",
      "systems, access routes and contacts without secrets",
      "risks, files and unresolved decisions",
    ],
  },
  {
    key: "change-request",
    label: "Catalogue \u2014 change request",
    matches: [
      "change request",
      "change order",
      "scope change request",
    ],
    domains: [
      "business",
    ],
    informationContract: CHANGE_REQUEST_INFORMATION_CONTRACT,
    internalReview: CHANGE_REQUEST_INTERNAL_REVIEW,
    requiredInformation: [
      "the requester and current baseline",
      "the proposed change and reason",
      "known impacts (cost, time, quality, risk)",
    ],
    highValueInformation: [
      "options considered besides the proposed change",
      "the approval state",
    ],
    clarificationQuestions: [
      "Who's requesting the change, and what's being changed from the current baseline?",
      "What's the impact on cost, time or quality, and has it been approved?",
    ],
    recommendedUploads: [
      "the original scope, contract or plan the change affects",
    ],
    inferableInformation: [
      "a requested \u2192 approved \u2192 implemented status progression",
    ],
    riskChecks: [
      "impacts stated concretely, not left unassessed",
      "approval state explicit, not assumed",
      "change traceable back to the specific baseline it modifies",
    ],
    outputStructure: [
      "request and baseline",
      "proposed change and reason",
      "cost, time, quality and risk impacts",
      "options and approval state",
      "implementation and rollback plan",
    ],
  },
  {
    key: "incident-near-miss-report",
    label: "Catalogue \u2014 incident near miss report",
    matches: [
      "incident report",
      "near miss report",
      "workplace incident",
    ],
    domains: [
      "business",
    ],
    informationContract: INCIDENT_NEAR_MISS_REPORT_INFORMATION_CONTRACT,
    internalReview: INCIDENT_NEAR_MISS_REPORT_INTERNAL_REVIEW,
    requiredInformation: [
      "reporter, date, time and location",
      "the factual sequence of what happened",
      "immediate controls put in place",
    ],
    highValueInformation: [
      "known injury or damage",
      "witnesses and evidence",
    ],
    clarificationQuestions: [
      "What happened, when and where, and who was involved?",
      "What immediate action was taken, and has it been reported to the right people?",
    ],
    recommendedUploads: [
      "photos of the scene or damage, if safe to have taken",
    ],
    inferableInformation: [
      "a factual-sequence-first structure, analysis and corrective actions kept separate",
    ],
    riskChecks: [
      "factual account kept separate from opinion or blame",
      "no cause or fault assumed without evidence",
      "notification status (who's been told) stated explicitly",
    ],
    outputStructure: [
      "report details",
      "factual sequence and people involved",
      "injury, damage and immediate controls",
      "witnesses, evidence and notifications",
      "analysis and corrective actions kept distinct from facts",
    ],
  },
  {
    key: "stocktake-inventory-count",
    label: "Catalogue \u2014 stocktake inventory count",
    matches: [
      "stocktake",
      "inventory count",
      "stock count",
    ],
    domains: [
      "business",
    ],
    informationContract: STOCKTAKE_INVENTORY_COUNT_INFORMATION_CONTRACT,
    internalReview: STOCKTAKE_INVENTORY_COUNT_INTERNAL_REVIEW,
    requiredInformation: [
      "site and count date",
      "counter name",
      "item, unit and actual quantity counted",
    ],
    highValueInformation: [
      "expected quantity for variance comparison",
      "condition notes",
    ],
    clarificationQuestions: [
      "What site and date is this count for, and who's counting?",
      "What items were counted, and were there any variances against expected quantities?",
    ],
    recommendedUploads: [
      "the expected-quantity records or previous stocktake",
    ],
    inferableInformation: [
      "a count-then-reconcile structure with variance flagged, not silently adjusted",
    ],
    riskChecks: [
      "actual counted quantities recorded as counted, not adjusted to match expectations",
      "any variance requires stated approval before adjustment",
      "counter identity recorded for accountability",
    ],
    outputStructure: [
      "site and count controls",
      "item and unit",
      "expected and actual quantity",
      "variance, condition and recount history",
      "adjustment approval",
    ],
  },
  {
    key: "business-case",
    label: "Catalogue \u2014 business case",
    matches: [
      "business case",
      "investment case",
      "funding case",
    ],
    domains: [
      "business",
    ],
    informationContract: BUSINESS_CASE_INFORMATION_CONTRACT,
    internalReview: BUSINESS_CASE_INTERNAL_REVIEW,
    requiredInformation: [
      "the problem or opportunity and the decision required",
      "options considered",
      "quantified evidence of costs and benefits",
    ],
    highValueInformation: [
      "material risks and assumptions",
      "a recommendation and implementation timeline",
    ],
    clarificationQuestions: [
      "What's the problem or opportunity, and what decision is being asked for?",
      "What options were considered, and what's the evidence for costs and benefits?",
    ],
    recommendedUploads: [
      "any cost estimates, quotes or prior analysis",
    ],
    inferableInformation: [
      "a standard options-comparison structure leading to a recommendation",
    ],
    riskChecks: [
      "costs and benefits are quantified, not asserted qualitatively",
      "at least one alternative option genuinely considered, not just the preferred one dressed up",
      "risks and assumptions stated explicitly, not hidden in the recommendation",
    ],
    outputStructure: [
      "problem or opportunity and strategic fit",
      "stakeholders and options",
      "evidenced costs and benefits",
      "risks, assumptions and sensitivity",
      "recommendation and decision required",
    ],
  },
  {
    key: "customer-feedback-summary",
    label: "Catalogue \u2014 customer feedback summary",
    matches: [
      "customer feedback summary",
      "voice of customer report",
      "feedback analysis",
    ],
    domains: [
      "business",
    ],
    informationContract: CUSTOMER_FEEDBACK_SUMMARY_INFORMATION_CONTRACT,
    internalReview: CUSTOMER_FEEDBACK_SUMMARY_INTERNAL_REVIEW,
    requiredInformation: [
      "the source set and period the feedback covers",
      "the evidence-backed themes found",
      "limitations of the analysis",
    ],
    highValueInformation: [
      "representative excerpts",
      "frequency or severity of each theme",
    ],
    clarificationQuestions: [
      "What feedback sources and period does this cover, and what were the main themes?",
      "How was sentiment or severity judged, and are there any limitations to flag?",
    ],
    recommendedUploads: [
      "the raw feedback data (surveys, reviews, support tickets)",
    ],
    inferableInformation: [
      "a themes-with-evidence structure rather than a bare summary",
    ],
    riskChecks: [
      "every theme backed by actual excerpts from the supplied feedback, not invented",
      "sentiment method disclosed, not left implicit",
      "limitations of the data (sample size, bias) stated honestly",
    ],
    outputStructure: [
      "source coverage and method",
      "themes and disclosed sentiment method",
      "representative short excerpts",
      "frequency and severity",
      "bounded findings and recommended actions",
    ],
  },
  {
    key: "competitor-comparison",
    label: "Catalogue \u2014 competitor comparison",
    matches: [
      "competitor comparison",
      "competitive analysis",
      "competitor research",
    ],
    domains: [
      "business",
    ],
    informationContract: COMPETITOR_COMPARISON_INFORMATION_CONTRACT,
    internalReview: COMPETITOR_COMPARISON_INTERNAL_REVIEW,
    requiredInformation: [
      "the decision purpose driving the comparison",
      "the competitors and comparison date",
      "evidence source for each factual claim",
    ],
    highValueInformation: [
      "criteria weighting",
      "a separate recommendation from the factual comparison",
    ],
    clarificationQuestions: [
      "What decision is this comparison informing, and which competitors and criteria matter?",
      "What sources back each claim, and is anything genuinely unknown rather than absent?",
    ],
    recommendedUploads: [
      "competitor websites, pricing pages or public filings already reviewed",
    ],
    inferableInformation: [
      "distinguishing 'unknown' from 'feature absent' throughout the comparison",
    ],
    riskChecks: [
      "every factual claim has a cited, dated source \u2014 nothing asserted from memory",
      "unknown information marked as unknown, not silently treated as absent",
      "recommendation kept separate from the factual comparison",
    ],
    outputStructure: [
      "decision purpose and dated source register",
      "criteria and weighting",
      "competitor evidence matrix",
      "unknowns and limitations",
      "separate factual comparison and recommendation",
    ],
  },
  {
    key: "timesheet",
    label: "Catalogue \u2014 timesheet",
    matches: [
      "timesheet",
      "time sheet",
      "hours worked record",
    ],
    domains: [
      "employment",
    ],
    informationContract: TIMESHEET_INFORMATION_CONTRACT,
    internalReview: TIMESHEET_INTERNAL_REVIEW,
    requiredInformation: [
      "worker, business and pay period",
      "actual start, end and break times per day",
    ],
    highValueInformation: [
      "project or cost code",
      "leave codes for non-worked time",
    ],
    clarificationQuestions: [
      "Who's the worker, and what's the pay period being recorded?",
      "What are the actual daily start, end and break times?",
    ],
    recommendedUploads: [
      "any roster or approved hours to reconcile against",
    ],
    inferableInformation: [
      "deterministic daily and period total calculation from entered times",
    ],
    riskChecks: [
      "totals calculated deterministically from entered times, never estimated",
      "breaks recorded, not omitted",
      "submission and approval status tracked explicitly",
    ],
    outputStructure: [
      "worker and pay-period details",
      "dated actual time entries and breaks",
      "ordinary and user-confirmed hour categories",
      "deterministic daily and period totals",
      "submission, approval and correction history",
    ],
  },
  {
    key: "staff-roster",
    label: "Catalogue \u2014 staff roster",
    matches: [
      "staff roster",
      "shift roster",
      "work schedule",
    ],
    domains: [
      "employment",
    ],
    informationContract: STAFF_ROSTER_INFORMATION_CONTRACT,
    internalReview: STAFF_ROSTER_INTERNAL_REVIEW,
    requiredInformation: [
      "site and roster period",
      "required roles",
      "employee or role, date and shift for each entry",
    ],
    highValueInformation: [
      "known availability constraints",
      "coverage requirements and conflicts",
    ],
    clarificationQuestions: [
      "What site and period is this roster for, and what roles need covering?",
      "Are there any availability constraints or known conflicts to account for?",
    ],
    recommendedUploads: [
      "staff availability records or the previous period's roster",
    ],
    inferableInformation: [
      "draft vs published status distinguished throughout",
    ],
    riskChecks: [
      "coverage requirements actually met across every shift, not just filled arbitrarily",
      "conflicts (double-bookings, unavailable staff) flagged, not silently ignored",
      "roster status (draft/published) explicit",
    ],
    outputStructure: [
      "site, roster period and status",
      "employee or role availability constraints",
      "dated shifts, roles, locations and breaks",
      "coverage and conflict checks",
      "publication, acknowledgement and change history",
    ],
  },
  {
    key: "investment-capital-gains-report",
    label: "Catalogue \u2014 investment capital gains report",
    matches: [
      "capital gains report",
      "investment gains",
      "cgt report",
      "disposal report",
    ],
    domains: [
      "finance",
    ],
    informationContract: INVESTMENT_CAPITAL_GAINS_REPORT_INFORMATION_CONTRACT,
    internalReview: INVESTMENT_CAPITAL_GAINS_REPORT_INTERNAL_REVIEW,
    requiredInformation: [
      "owner or entity, jurisdiction and tax year",
      "each asset's acquisition and disposal dates",
      "proceeds, transaction costs and documented cost base",
    ],
    highValueInformation: [
      "source records or missing evidence",
      "assumptions or limitations affecting the calculation",
    ],
    clarificationQuestions: [
      "Whose investments and which tax year and jurisdiction is this for?",
      "What are the acquisition and disposal details \u2014 dates, proceeds and costs \u2014 for each holding?",
    ],
    recommendedUploads: [
      "brokerage or investment platform statements",
      "purchase and sale confirmations",
    ],
    inferableInformation: [
      "standard cost-base and realised gain/loss calculation method",
    ],
    riskChecks: [
      "every gain/loss figure traces to a documented cost base, never estimated",
      "missing records disclosed explicitly, not silently omitted",
      "flagged as needing professional tax review before lodgement",
    ],
    outputStructure: [
      "source coverage and missing records",
      "holdings and disposals register",
      "proceeds and cost base",
      "gain or loss by parcel and asset",
      "supplied carried-forward losses",
      "summary, assumptions and professional-review warning",
    ],
  },
  {
    key: "leave-availability-request",
    label: "Catalogue \u2014 leave availability request",
    matches: [
      "leave request",
      "availability request",
      "time off request",
    ],
    domains: [
      "employment",
    ],
    informationContract: LEAVE_AVAILABILITY_REQUEST_INFORMATION_CONTRACT,
    internalReview: LEAVE_AVAILABILITY_REQUEST_INTERNAL_REVIEW,
    requiredInformation: [
      "employee and workplace",
      "the request type (leave or availability)",
      "requested dates",
    ],
    highValueInformation: [
      "evidence required for the request type",
      "handover arrangements",
    ],
    clarificationQuestions: [
      "Who's the employee, and what type of leave or availability change is this?",
      "What dates are being requested, and is any supporting evidence required?",
    ],
    recommendedUploads: [
      "supporting evidence if required (medical certificate, etc.)",
    ],
    inferableInformation: [
      "a neutral request-record format that does not imply approval",
    ],
    riskChecks: [
      "the document records a request, never states or implies it's approved",
      "only the minimum necessary reason is captured, not excess personal detail",
      "approval route and status kept distinct from the request itself",
    ],
    outputStructure: [
      "employee and request type",
      "requested dates or availability",
      "minimal necessary reason and supplied evidence",
      "handover",
      "submission and approval route",
    ],
  },
  {
    key: "performance-improvement-plan",
    label: "Catalogue \u2014 performance improvement plan",
    matches: [
      "performance improvement plan",
      "pip",
      "performance plan",
    ],
    domains: [
      "employment",
    ],
    informationContract: PERFORMANCE_IMPROVEMENT_PLAN_INFORMATION_CONTRACT,
    internalReview: PERFORMANCE_IMPROVEMENT_PLAN_INTERNAL_REVIEW,
    requiredInformation: [
      "role expectations and the specific performance evidence",
      "the required improvement and how it will be measured",
      "review dates",
    ],
    highValueInformation: [
      "support or learning actions offered",
      "the response process if improvement isn't met",
    ],
    clarificationQuestions: [
      "What are the role expectations, and what specific evidence shows the gap?",
      "What improvement is required, how will it be measured, and when will it be reviewed?",
    ],
    recommendedUploads: [
      "performance review records or documented examples",
    ],
    inferableInformation: [
      "a neutral, evidence-based tone rather than a disciplinary one",
    ],
    riskChecks: [
      "evidence is specific and documented, not a vague performance complaint",
      "support offered, not just consequences stated",
      "review dates and response process both concrete, not left open-ended",
    ],
    outputStructure: [
      "role expectations and evidence",
      "specific improvement required",
      "support and learning actions",
      "measures and review dates",
      "supplied consequences and response process",
    ],
  },
  {
    key: "training-plan-skills-matrix",
    label: "Catalogue \u2014 training plan skills matrix",
    matches: [
      "skills matrix",
      "training plan",
      "competency matrix",
      "training needs analysis",
    ],
    domains: [
      "employment",
    ],
    informationContract: TRAINING_PLAN_SKILLS_MATRIX_INFORMATION_CONTRACT,
    internalReview: TRAINING_PLAN_SKILLS_MATRIX_INTERNAL_REVIEW,
    requiredInformation: [
      "roles and required competencies",
      "current capability against each competency, with evidence",
      "learning actions, owners and due dates",
    ],
    highValueInformation: [
      "reassessment method and timing",
    ],
    clarificationQuestions: [
      "What roles and competencies does this matrix cover, and what evidence supports the current capability ratings?",
      "What training actions close the gaps, who owns each, and by when?",
    ],
    recommendedUploads: [
      "existing training records or assessment results",
    ],
    inferableInformation: [
      "distinguishing 'not assessed' from 'assessed as not competent' throughout",
    ],
    riskChecks: [
      "capability ratings backed by real assessment evidence, not assumed",
      "not-assessed and not-competent kept visibly distinct, never conflated",
      "every gap has a named owner and due date",
    ],
    outputStructure: [
      "roles and required competencies",
      "evidence-backed current capability",
      "gaps and priority",
      "learning actions, owners and dates",
      "reassessment method",
    ],
  },
  {
    key: "asset-register-maintenance-log",
    label: "Catalogue \u2014 asset register maintenance log",
    matches: [
      "asset register",
      "maintenance log",
      "equipment register",
      "asset maintenance record",
    ],
    domains: [
      "business",
    ],
    informationContract: ASSET_REGISTER_MAINTENANCE_LOG_INFORMATION_CONTRACT,
    internalReview: ASSET_REGISTER_MAINTENANCE_LOG_INTERNAL_REVIEW,
    requiredInformation: [
      "asset ID, description and location",
      "owner",
      "condition and service schedule",
    ],
    highValueInformation: [
      "acquisition and warranty details",
      "evidenced completed maintenance and next due date",
    ],
    clarificationQuestions: [
      "What assets are being registered, and who owns or is responsible for each?",
      "What's the current condition and service schedule, and is there maintenance history to record?",
    ],
    recommendedUploads: [
      "purchase records, warranties or prior maintenance logs",
    ],
    inferableInformation: [
      "a standard register-then-maintenance-history structure",
    ],
    riskChecks: [
      "condition and maintenance entries have real evidence, not assumed status",
      "service schedule and next-due dates realistic against asset type",
      "asset identifiers unique and traceable across entries",
    ],
    outputStructure: [
      "asset identity and location",
      "ownership, acquisition and warranty",
      "condition and criticality",
      "service schedule and evidenced maintenance history",
      "cost and next due date",
    ],
  },
];

type CatalogueProfileSpec = readonly [
  key: string,
  label: string,
  domain: string,
];

/**
 * Audited extended catalogue: the 53 shipped templates, the 26 approved
 * financial and connected-workflow additions, and 7 personal-track/business/
 * research additions closing gaps against the product definition's target
 * personas (see docs/01-PHASE1-PRODUCT-DEFINITION.md — the "Quaternary"
 * overwhelmed-individuals persona had zero personal-domain catalogue
 * coverage before these). Keep this manifest at exactly 86.
 */
export const EXTENDED_CATALOGUE: readonly CatalogueProfileSpec[] = [
  ["resume", "Resume", "employment"],
  ["cover-letter", "Cover Letter", "employment"],
  ["job-search-checklist", "Job-search Action Checklist", "employment"],
  ["interview-prep-questions", "Interview Preparation Questions", "employment"],
  ["interview-script", "Interview Script", "employment"],
  ["job-follow-up-email", "Job Follow-up Email", "employment"],
  ["pay-rise-request", "Pay-rise Request & Conversation Script", "employment"],
  ["promotion-case", "Promotion Case", "employment"],
  ["personal-statement", "Personal Statement", "education"],
  ["education-cover-letter", "Application Letter — Education", "education"],
  ["reference-request", "Reference Request", "education"],
  ["business-email", "Business Email", "business"],
  ["workplace-policy", "Workplace Policy", "business"],
  ["sop", "Standard Operating Procedure", "business"],
  ["offer-letter", "Offer Letter", "business"],
  ["terms-of-employment", "Terms of Employment", "business"],
  ["induction-manual", "Induction Manual", "business"],
  ["onboarding-checklist", "Onboarding Checklist", "business"],
  ["performance-review", "Performance Review", "business"],
  ["meeting-minutes", "Meeting Minutes / Briefing", "business"],
  ["service-agreement", "Service Agreement", "business"],
  ["proposal", "Proposal", "business"],
  ["budget-workbook", "Budget Workbook", "finance"],
  ["selection-criteria-response", "Selection Criteria Response", "employment"],
  ["linkedin-profile-rewrite", "LinkedIn Profile Rewrite", "employment"],
  ["star-achievement-bank", "STAR Achievement Bank", "employment"],
  [
    "professional-reference-letter",
    "Professional Reference Letter",
    "employment",
  ],
  ["personal-brand-statement", "Personal Brand Statement", "employment"],
  ["career-change-plan", "Career Change Plan", "employment"],
  ["resignation-letter", "Resignation Letter", "employment"],
  ["networking-outreach-message", "Networking Outreach Message", "employment"],
  [
    "recruiter-introduction-email",
    "Recruiter Introduction Email",
    "employment",
  ],
  ["business-plan", "Business Plan", "business"],
  ["executive-summary", "Executive Summary", "business"],
  ["pitch-deck-outline", "Pitch Deck Outline", "business"],
  ["scope-of-work", "Scope of Work", "business"],
  ["board-report", "Board Report", "business"],
  ["quarterly-business-review", "Quarterly Business Review", "business"],
  ["risk-assessment", "Risk Assessment", "business"],
  ["financial-review", "Financial Review", "finance"],
  ["marketing-brief", "Marketing Brief", "business"],
  ["grant-funding-proposal", "Grant / Funding Proposal", "business"],
  ["scholarship-application", "Scholarship Application", "education"],
  ["statement-of-purpose", "Statement of Purpose", "education"],
  ["study-plan", "Study Plan", "education"],
  ["research-proposal", "Research Proposal", "education"],
  ["literature-review", "Literature Review", "education"],
  ["academic-appeal-letter", "Academic Appeal Letter", "education"],
  ["extension-request-letter", "Extension Request Letter", "education"],
  ["student-support-plan", "Student Support Plan", "education"],
  ["course-comparison-matrix", "Course Comparison Matrix", "education"],
  ["academic-reference-request", "Academic Reference Request", "education"],
  ["profit-and-loss-statement", "Profit & Loss Statement", "finance"],
  ["forecasted-earnings", "Forecasted Earnings", "finance"],
  ["ebitda-analysis", "EBITDA Analysis", "finance"],
  [
    "investment-capital-gains-report",
    "Investment Capital Gains Report",
    "finance",
  ],
  ["quote-estimate", "Quote / Estimate", "business"],
  ["invoice", "Invoice", "finance"],
  ["purchase-order", "Purchase Order", "business"],
  ["cash-flow-forecast", "Cash Flow Forecast", "finance"],
  ["expense-claim", "Expense Claim / Reimbursement Report", "finance"],
  ["project-plan", "Project Plan", "business"],
  ["project-status-report", "Project Status Report", "business"],
  ["meeting-agenda", "Meeting Agenda", "business"],
  ["action-register", "Action Register", "business"],
  ["decision-log", "Decision Log", "business"],
  ["handover-document", "Handover Document", "business"],
  ["change-request", "Change Request", "business"],
  [
    "leave-availability-request",
    "Leave Request and Availability Form",
    "employment",
  ],
  [
    "performance-improvement-plan",
    "Performance Improvement Plan",
    "employment",
  ],
  [
    "training-plan-skills-matrix",
    "Training Plan and Skills Matrix",
    "employment",
  ],
  ["incident-near-miss-report", "Incident / Near-Miss Report", "business"],
  [
    "asset-register-maintenance-log",
    "Asset Register and Maintenance Log",
    "business",
  ],
  ["stocktake-inventory-count", "Stocktake / Inventory Count", "business"],
  ["business-case", "Business Case", "business"],
  ["customer-feedback-summary", "Customer Feedback Summary", "business"],
  ["competitor-comparison", "Competitor Comparison", "business"],
  ["timesheet", "Timesheet", "employment"],
  ["staff-roster", "Staff Roster", "employment"],
  ["moving-house-checklist", "Moving House Checklist", "personal"],
  ["new-tenancy-checklist", "New Tenancy / Lease Checklist", "personal"],
  ["complaint-letter", "Complaint Letter", "personal"],
  ["insurance-claim-letter", "Insurance Claim Letter", "personal"],
  ["client-engagement-letter", "Client Engagement Letter", "business"],
  ["non-disclosure-agreement", "Non-Disclosure Agreement (NDA)", "business"],
  ["research-report", "Research Report", "education"],
] as const;

const PROFILE_ALIASES: Record<string, string> = {
  "selection-criteria-response": "selection-criteria",
  "linkedin-profile-rewrite": "linkedin",
  "professional-reference-letter": "reference-letter",
  "quarterly-business-review": "qbr",
  "grant-funding-proposal": "funding-proposal",
  "scholarship-application": "scholarship",
  // Reuses the existing, already-benchmarked personal-domain complaint/
  // demand/dispute profile rather than duplicating a thinner one under a
  // second key — same underlying document shape (parties, timeline, issue,
  // evidence, remedy sought, escalation), just catalogued under its own
  // plain-language name.
  "complaint-letter": "formal-complaint",
};

const GOVERNMENT_STYLE_BENCHMARK: DocumentBenchmark = {
  authority: "Australian Government Style Manual",
  title: "Style Manual",
  url: "https://www.stylemanual.gov.au/",
  appliesTo: [
    "plain language",
    "logical structure",
    "accessible professional wording",
    "consistent presentation",
  ],
  acceptanceSignals: [
    "Audience and purpose are immediately clear",
    "Headings and paragraphs follow a logical hierarchy",
    "Language is concise, inclusive and understandable on first reading",
  ],
};

const BUSINESS_GOV_BENCHMARK: DocumentBenchmark = {
  authority: "Australian Government business.gov.au",
  title: "Templates and tools",
  url: "https://business.gov.au/planning/templates-and-tools",
  appliesTo: [
    "business-document structure",
    "decision-useful detail",
    "professional formality",
    "practical usability",
  ],
  acceptanceSignals: [
    "Business purpose, inputs and next decision or action are clear",
    "Tables and totals are labelled and internally consistent",
    "Assumptions are visible rather than presented as facts",
  ],
};

const FAIR_WORK_BENCHMARK: DocumentBenchmark = {
  authority: "Fair Work Ombudsman",
  title: "Templates",
  url: "https://www.fairwork.gov.au/tools-and-resources/templates",
  appliesTo: [
    "workplace-record structure",
    "clear fields",
    "procedural wording",
    "Australian employment context",
  ],
  acceptanceSignals: [
    "Parties, dates, status and required workplace fields are unambiguous",
    "Requested, approved, planned and completed states remain distinct",
    "No unsupported compliance, entitlement or conduct conclusion is stated",
  ],
};

const ASIC_FINANCE_BENCHMARK: DocumentBenchmark = {
  authority: "ASIC",
  title: "Financial reports",
  url:
    "https://asic.gov.au/regulatory-resources/financial-reporting-and-audit/preparers-of-financial-reports/",
  appliesTo: [
    "traceable financial presentation",
    "clear basis and period",
    "transparent calculations",
    "limitations",
  ],
  acceptanceSignals: [
    "Entity, period, currency and accounting basis are disclosed",
    "Figures reconcile and calculations are traceable",
    "Actuals, forecasts, estimates and limitations remain distinct",
  ],
};

const EDUCATION_BENCHMARK: DocumentBenchmark = {
  authority: "University of Melbourne Academic Skills",
  title: "Academic writing",
  url:
    "https://students.unimelb.edu.au/academic-skills/resources/reading,-writing-and-referencing",
  appliesTo: [
    "academic structure",
    "evidence use",
    "formal tone",
    "coherent argument",
  ],
  acceptanceSignals: [
    "Purpose or research question governs the order",
    "Claims are supported by supplied or cited evidence",
    "Paragraphs synthesise evidence coherently and acknowledge limitations",
  ],
};

const SPECIAL_STRUCTURES: Record<string, string[]> = {
  "pay-rise-request": [
    "evidence-backed case",
    "specific request",
    "conversation script and responses",
  ],
  "promotion-case": [
    "confirmed impact to date",
    "readiness for the target level",
    "specific proposal and next step",
  ],
  "education-cover-letter": [
    "role or program-specific introduction",
    "evidence-led suitability",
    "professional closing",
  ],
  "reference-request": [
    "clear request",
    "helpful role, deadline and submission details",
    "gracious close and easy opt-out",
  ],
  "business-email": [
    "specific subject and greeting",
    "concise message in logical paragraphs",
    "clear call to action and sign-off",
  ],
  "workplace-policy": [
    "purpose and scope",
    "policy statements",
    "roles and responsibilities",
    "reporting, review and evidenced breach process",
  ],
  sop: [
    "purpose, scope and prerequisites",
    "ordered procedure steps and controls",
    "roles and responsibilities",
    "records, exceptions and revision control",
  ],
  "offer-letter": [
    "parties, role and offer",
    "confirmed key terms",
    "conditions and checks",
    "acceptance method and deadline",
  ],
  "terms-of-employment": [
    "parties and role",
    "confirmed pay, hours and location",
    "duties, policies and obligations",
    "leave and ending employment",
    "acknowledgement",
  ],
  "induction-manual": [
    "welcome and organisation context",
    "how work is performed",
    "key supplied policies and safety information",
    "systems, contacts and first-period guidance",
  ],
  "onboarding-checklist": [
    "pre-start tasks",
    "first-day tasks",
    "first-week tasks",
    "role training and access",
    "owner, due date, status and evidence",
  ],
  "service-agreement": [
    "parties and effective period",
    "scope, deliverables and exclusions",
    "fees, tax and payment terms",
    "responsibilities, changes and disputes",
    "termination and signatures",
  ],
  proposal: [
    "executive summary",
    "confirmed need and objectives",
    "proposed solution and scope",
    "evidence, price and timeline",
    "assumptions, risks and next steps",
  ],
  "budget-workbook": [
    "period, basis and assumptions",
    "itemised income",
    "itemised fixed and variable expenses",
    "savings, debt and cash position",
    "reconciled totals and scenarios",
  ],
  "personal-brand-statement": [
    "professional identity",
    "specific value proposition",
    "confirmed proof",
    "target direction and concise final statement",
  ],
  "career-change-plan": [
    "target direction and constraints",
    "transferable evidence",
    "verified gaps and learning plan",
    "job-search actions, milestones and review",
  ],
  "resignation-letter": [
    "dated notice statement",
    "confirmed final-day wording or notice basis",
    "brief appreciation",
    "transition support and professional close",
  ],
  "networking-outreach-message": [
    "personal introduction",
    "specific and truthful reason for contact",
    "small clear request",
    "low-pressure close",
  ],
  "executive-summary": [
    "purpose and decision context",
    "current situation and material evidence",
    "options or recommendation",
    "risks, implications and decision required",
  ],
  "pitch-deck-outline": [
    "problem and evidence",
    "solution and value",
    "market, model and confirmed traction",
    "team and plan",
    "financial basis, risks and specific ask",
  ],
  "scope-of-work": [
    "project context and objectives",
    "in-scope and out-of-scope work",
    "deliverables, milestones and acceptance",
    "roles, assumptions and dependencies",
    "changes, fees and approval",
  ],
  "marketing-brief": [
    "objective and audience",
    "evidence-backed insight and message",
    "channels, deliverables and requirements",
    "budget and timing constraints",
    "success measures and approvals",
  ],
  "statement-of-purpose": [
    "academic or professional focus",
    "confirmed preparation and evidence",
    "specific program fit",
    "future direction and contribution",
  ],
  "study-plan": [
    "specific learning goal and baseline",
    "subjects, resources and priorities",
    "realistic weekly schedule",
    "milestones, evidence and accountability",
    "review and adjustment",
  ],
  "research-proposal": [
    "title, question and objectives",
    "background, literature context and rationale",
    "methodology, data and ethics",
    "timeline and resources",
    "expected contribution and limitations",
  ],
  "literature-review": [
    "review scope and method",
    "synthesised themes",
    "debates, patterns and evidence quality",
    "identified gap",
    "implications and direction",
  ],
  "academic-appeal-letter": [
    "decision and applicable process",
    "evidence-backed grounds",
    "clear factual explanation and chronology",
    "specific requested outcome",
    "attachments and respectful close",
  ],
  "extension-request-letter": [
    "assessment and request",
    "concise factual reason",
    "evidence and impact where appropriate",
    "realistic proposed date",
    "professional close",
  ],
  "student-support-plan": [
    "student context and goals",
    "strengths and confirmed barriers",
    "reasonable requested supports",
    "actions, owners and communication",
    "review date and privacy controls",
  ],
  "course-comparison-matrix": [
    "decision goal and candidate courses",
    "criteria, weighting and dated sources",
    "evidence matrix with unknowns",
    "trade-offs and limitations",
    "reasoned recommendation",
  ],
  "academic-reference-request": [
    "clear request and deadline",
    "confirmed relationship context",
    "course, role or scholarship context",
    "supporting materials and submission method",
    "gracious close and opt-out",
  ],
  "forecasted-earnings": [
    "basis and assumptions register",
    "historical baseline",
    "revenue and cost forecasts",
    "earnings calculations",
    "base, upside and downside scenarios",
    "risks, sensitivities and limitations",
  ],
  "ebitda-analysis": [
    "source operating result",
    "interest, tax, depreciation and amortisation reconciliation",
    "reported EBITDA",
    "evidenced adjustments",
    "adjusted EBITDA when requested",
    "margin comparison and limitations",
  ],
  "investment-capital-gains-report": [
    "source coverage and missing records",
    "holdings and disposals register",
    "proceeds and cost base",
    "gain or loss by parcel and asset",
    "supplied carried-forward losses",
    "summary, assumptions and professional-review warning",
  ],
  "quote-estimate": [
    "supplier and customer",
    "scope and itemised pricing",
    "tax and total",
    "timing, validity, exclusions and variations",
    "payment terms and acceptance",
  ],
  invoice: [
    "supplier and customer",
    "invoice identifiers and dates",
    "itemised supplies",
    "subtotal, tax and total",
    "payment terms and payment details",
  ],
  "purchase-order": [
    "buyer, supplier and delivery",
    "PO identifiers and approval",
    "itemised order",
    "tax and totals",
    "terms and revision history",
  ],
  "cash-flow-forecast": [
    "opening cash and assumptions",
    "period inflows",
    "period outflows",
    "deterministic closing cash",
    "low-cash periods and scenarios",
  ],
  "expense-claim": [
    "claimant and claim period",
    "itemised evidenced expenses",
    "tax and currency treatment",
    "totals and duplicates",
    "declaration and approval state",
  ],
  "project-plan": [
    "objective and governance",
    "scope and deliverables",
    "milestones, tasks, owners and dependencies",
    "resources and budget constraints",
    "risks, communications and success measures",
  ],
  "project-status-report": [
    "period and executive status",
    "planned versus confirmed progress",
    "milestones and budget",
    "risks, issues and decisions",
    "upcoming work and support required",
  ],
  "meeting-agenda": [
    "meeting details and purpose",
    "participants and preparation",
    "timed agenda with owners",
    "decisions required",
    "actions and next-meeting link",
  ],
  "action-register": [
    "action identifiers and sources",
    "action, owner and due date",
    "priority and dependencies",
    "status and evidence",
    "closure and revision history",
  ],
  "decision-log": [
    "decision identifier and context",
    "options considered",
    "decision-maker and decision",
    "confirmed rationale and consequences",
    "dependencies and review trigger",
  ],
  "handover-document": [
    "owners and handover scope",
    "responsibilities and current status",
    "active work, routines and deadlines",
    "systems, access routes and contacts without secrets",
    "risks, files and unresolved decisions",
  ],
  "change-request": [
    "request and baseline",
    "proposed change and reason",
    "cost, time, quality and risk impacts",
    "options and approval state",
    "implementation and rollback plan",
  ],
  "leave-availability-request": [
    "employee and request type",
    "requested dates or availability",
    "minimal necessary reason and supplied evidence",
    "handover",
    "submission and approval route",
  ],
  "performance-improvement-plan": [
    "role expectations and evidence",
    "specific improvement required",
    "support and learning actions",
    "measures and review dates",
    "supplied consequences and response process",
  ],
  "training-plan-skills-matrix": [
    "roles and required competencies",
    "evidence-backed current capability",
    "gaps and priority",
    "learning actions, owners and dates",
    "reassessment method",
  ],
  "incident-near-miss-report": [
    "report details",
    "factual sequence and people involved",
    "injury, damage and immediate controls",
    "witnesses, evidence and notifications",
    "analysis and corrective actions kept distinct from facts",
  ],
  "asset-register-maintenance-log": [
    "asset identity and location",
    "ownership, acquisition and warranty",
    "condition and criticality",
    "service schedule and evidenced maintenance history",
    "cost and next due date",
  ],
  "stocktake-inventory-count": [
    "site and count controls",
    "item and unit",
    "expected and actual quantity",
    "variance, condition and recount history",
    "adjustment approval",
  ],
  "business-case": [
    "problem or opportunity and strategic fit",
    "stakeholders and options",
    "evidenced costs and benefits",
    "risks, assumptions and sensitivity",
    "recommendation and decision required",
  ],
  "customer-feedback-summary": [
    "source coverage and method",
    "themes and disclosed sentiment method",
    "representative short excerpts",
    "frequency and severity",
    "bounded findings and recommended actions",
  ],
  "competitor-comparison": [
    "decision purpose and dated source register",
    "criteria and weighting",
    "competitor evidence matrix",
    "unknowns and limitations",
    "separate factual comparison and recommendation",
  ],
  timesheet: [
    "worker and pay-period details",
    "dated actual time entries and breaks",
    "ordinary and user-confirmed hour categories",
    "deterministic daily and period totals",
    "submission, approval and correction history",
  ],
  "staff-roster": [
    "site, roster period and status",
    "employee or role availability constraints",
    "dated shifts, roles, locations and breaks",
    "coverage and conflict checks",
    "publication, acknowledgement and change history",
  ],
};

const WORKPLACE_POLICY_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "purpose_and_scope",
      "requiredInformation": [
        {
          "key": "organisation",
          "label": "Organisation",
          "factType": "company_name",
          "placeholderLabel": "organisation name",
          "question": "Which organisation is this policy for?",
          "requiredForExport": false,
          "sharedResolutionKey": "organisation.name",
          "neutralReplacementOptions": [
            {
              "id": "organisation-neutral",
              "label": "Neutral organisation reference",
              "value": "the organisation",
              "suitability":
                "Use when branding is unnecessary or the organisation name is not yet supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "automaticFallback": "the organisation",
        },
        {
          "key": "policy_topic",
          "label": "Policy topic",
          "factType": "other",
          "placeholderLabel": "the policy topic",
          "question":
            "What behaviour, activity or risk does this policy govern?",
          "requiredForExport": true,
          "sharedResolutionKey": "policy.topic",
          "neutralReplacementOptions": [],
        },
        {
          "key": "scope",
          "label": "Policy scope",
          "factType": "other",
          "placeholderLabel": "who and what the policy covers",
          "question":
            "Who, what locations, systems or activities does this policy apply to?",
          "requiredForExport": true,
          "sharedResolutionKey": "policy.scope",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "purpose statement",
        "exclusions",
        "related policies",
        "verified legal or industry basis",
      ],
    },
    {
      "sectionKey": "policy_statements",
      "requiredInformation": [
        {
          "key": "required_behaviours",
          "label": "Required behaviours",
          "factType": "responsibility",
          "placeholderLabel": "the required behaviours",
          "question": "What must people do under this policy?",
          "requiredForExport": true,
          "sharedResolutionKey": "policy.required_behaviours",
          "neutralReplacementOptions": [],
        },
        {
          "key": "prohibited_behaviours",
          "label": "Prohibited behaviours",
          "factType": "responsibility",
          "placeholderLabel": "the prohibited behaviours",
          "question": "What must people not do under this policy?",
          "requiredForExport": false,
          "sharedResolutionKey": "policy.prohibited_behaviours",
          "neutralReplacementOptions": [
            {
              "id": "omit-prohibitions",
              "label": "No unsupported prohibitions",
              "value":
                "state only the confirmed requirements without inventing prohibited conduct",
              "suitability":
                "Use when no separate prohibition has been confirmed.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "limits_approvals",
          "label": "Limits or approvals",
          "factType": "responsibility",
          "placeholderLabel": "confirmed thresholds, limits or approvals",
          "question":
            "Are there any confirmed thresholds, limits or approval requirements?",
          "requiredForExport": false,
          "sharedResolutionKey": "policy.limits_approvals",
          "neutralReplacementOptions": [
            {
              "id": "no-limits",
              "label": "No extra limits stated",
              "value":
                "do not add thresholds or approvals that were not supplied",
              "suitability": "Use when none are confirmed.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "examples",
        "training requirements",
        "decision tree",
        "related forms",
      ],
    },
    {
      "sectionKey": "roles_and_responsibilities",
      "requiredInformation": [
        {
          "key": "employee_responsibility",
          "label": "Employee responsibility",
          "factType": "responsibility",
          "placeholderLabel": "what employees must do",
          "question":
            "What are employees or covered people responsible for day to day?",
          "requiredForExport": true,
          "sharedResolutionKey": "policy.employee_responsibility",
          "neutralReplacementOptions": [],
        },
        {
          "key": "manager_responsibility",
          "label": "Manager responsibility",
          "factType": "responsibility",
          "placeholderLabel": "what managers must do",
          "question":
            "What are managers responsible for monitoring, approving or escalating?",
          "requiredForExport": false,
          "sharedResolutionKey": "policy.manager_responsibility",
          "neutralReplacementOptions": [
            {
              "id": "manager-general",
              "label": "General manager responsibility",
              "value":
                "managers should support consistent application and escalate issues through the confirmed organisational process",
              "suitability":
                "Use only when a manager role exists but no special duties are supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "policy_owner",
          "label": "Policy owner",
          "factType": "role_title",
          "placeholderLabel": "policy owner role",
          "question": "Which role owns and reviews this policy?",
          "requiredForExport": false,
          "sharedResolutionKey": "policy.owner",
          "neutralReplacementOptions": [
            {
              "id": "owner-placeholder",
              "label": "Keep owner interactive",
              "value": "the designated policy owner",
              "suitability":
                "Use as neutral wording while the exact owner remains unresolved.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "delegation limits",
        "escalation contacts",
        "training owner",
      ],
    },
    {
      "sectionKey": "breaches_and_review",
      "requiredInformation": [
        {
          "key": "breach_process",
          "label": "Breach process",
          "factType": "other",
          "placeholderLabel": "the confirmed breach or non-compliance process",
          "question":
            "What process should follow a reported or confirmed breach?",
          "requiredForExport": false,
          "sharedResolutionKey": "policy.breach_process",
          "neutralReplacementOptions": [
            {
              "id": "process-only",
              "label": "Process without assumed punishment",
              "value":
                "follow the organisation's confirmed reporting, review and procedural-fairness process without presuming an outcome",
              "suitability": "Use when consequences have not been supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "review_cadence",
          "label": "Review cadence",
          "factType": "date_range",
          "placeholderLabel": "policy review timing",
          "question":
            "When should this policy next be reviewed, or what review cadence applies?",
          "requiredForExport": false,
          "sharedResolutionKey": "policy.review_cadence",
          "neutralReplacementOptions": [
            {
              "id": "review-as-needed",
              "label": "Review as needed",
              "value":
                "review when operational, legal or organisational changes make review necessary",
              "suitability": "Use when no fixed cadence is confirmed.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "investigation steps",
        "support options",
        "appeal mechanism",
        "record retention",
      ],
    },
  ],
};

const SOP_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "purpose_scope_prerequisites",
      "requiredInformation": [
        {
          "key": "process_name",
          "label": "Process name",
          "factType": "other",
          "placeholderLabel": "the process or task name",
          "question": "What process or task is this SOP for?",
          "requiredForExport": true,
          "sharedResolutionKey": "sop.process_name",
          "neutralReplacementOptions": [],
        },
        {
          "key": "purpose",
          "label": "Purpose",
          "factType": "other",
          "placeholderLabel": "why the procedure exists",
          "question":
            "What outcome, quality or control is this procedure meant to achieve?",
          "requiredForExport": true,
          "sharedResolutionKey": "sop.purpose",
          "neutralReplacementOptions": [],
        },
        {
          "key": "scope",
          "label": "Scope",
          "factType": "other",
          "placeholderLabel": "who and when the procedure applies",
          "question": "Who performs this procedure and when should it be used?",
          "requiredForExport": true,
          "sharedResolutionKey": "sop.scope",
          "neutralReplacementOptions": [],
        },
        {
          "key": "prerequisites",
          "label": "Prerequisites",
          "factType": "other",
          "placeholderLabel": "required prerequisites",
          "question":
            "What access, tools, materials, training or conditions are required before starting?",
          "requiredForExport": false,
          "sharedResolutionKey": "sop.prerequisites",
          "neutralReplacementOptions": [
            {
              "id": "no-special-prereqs",
              "label": "No special prerequisites stated",
              "value":
                "begin with the confirmed process inputs and do not invent extra prerequisites",
              "suitability": "Use when no special prerequisites are supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "exclusions",
        "related procedures",
        "definitions",
      ],
    },
    {
      "sectionKey": "procedure_steps_and_controls",
      "requiredInformation": [
        {
          "key": "ordered_steps",
          "label": "Ordered procedure steps",
          "factType": "responsibility",
          "placeholderLabel": "the confirmed ordered procedure steps",
          "question": "What are the steps, in order, to complete the process?",
          "requiredForExport": true,
          "sharedResolutionKey": "sop.steps",
          "neutralReplacementOptions": [],
        },
        {
          "key": "step_owners",
          "label": "Step owners",
          "factType": "role_title",
          "placeholderLabel": "who performs each step",
          "question": "Which role or person performs each step?",
          "requiredForExport": true,
          "sharedResolutionKey": "sop.step_owners",
          "neutralReplacementOptions": [],
        },
        {
          "key": "decision_points",
          "label": "Decision points",
          "factType": "other",
          "placeholderLabel": "confirmed decision points and branches",
          "question":
            "Where can the process branch, and what should happen in each confirmed case?",
          "requiredForExport": false,
          "sharedResolutionKey": "sop.decision_points",
          "neutralReplacementOptions": [
            {
              "id": "no-branch",
              "label": "No branch supplied",
              "value":
                "present only the confirmed linear process without inventing decision branches",
              "suitability": "Use when no branching condition is supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "completion_standard",
          "label": "Completion standard",
          "factType": "other",
          "placeholderLabel": "what completed correctly looks like",
          "question":
            "How do you know the process has been completed correctly?",
          "requiredForExport": true,
          "sharedResolutionKey": "sop.completion_standard",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "timing",
        "screenshots",
        "quality checks",
        "safety warnings",
        "error handling",
      ],
    },
    {
      "sectionKey": "roles_records_and_review",
      "requiredInformation": [
        {
          "key": "process_owner",
          "label": "Process owner",
          "factType": "role_title",
          "placeholderLabel": "process owner",
          "question": "Which role owns this SOP?",
          "requiredForExport": false,
          "sharedResolutionKey": "sop.owner",
          "neutralReplacementOptions": [
            {
              "id": "owner-neutral",
              "label": "Designated owner",
              "value": "the designated process owner",
              "suitability": "Use while the exact role remains unresolved.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "record_location",
          "label": "Record location",
          "factType": "reference",
          "placeholderLabel": "where required records are stored",
          "question": "What records must be kept, and where are they stored?",
          "requiredForExport": false,
          "sharedResolutionKey": "sop.records",
          "neutralReplacementOptions": [
            {
              "id": "record-if-applicable",
              "label": "Records if applicable",
              "value":
                "retain any records required by the confirmed business process without inventing a storage system",
              "suitability": "Use when recordkeeping details are not supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "review_trigger",
          "label": "Review trigger",
          "factType": "date_range",
          "placeholderLabel": "review cadence or trigger",
          "question":
            "How often, or after what event, should the SOP be reviewed?",
          "requiredForExport": false,
          "sharedResolutionKey": "sop.review",
          "neutralReplacementOptions": [
            {
              "id": "review-on-change",
              "label": "Review on material change",
              "value":
                "review when the process, systems, risks or requirements materially change",
              "suitability": "Use when no fixed review date exists.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "approvers",
        "backup owners",
        "version history",
        "retention period",
      ],
    },
  ],
};

const OFFER_LETTER_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "parties_role_and_offer",
      "requiredInformation": [
        {
          "key": "candidate_name",
          "label": "Candidate name",
          "factType": "person_name",
          "placeholderLabel": "candidate name",
          "question": "Who is receiving the employment offer?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.employee_name",
          "neutralReplacementOptions": [],
        },
        {
          "key": "employer_name",
          "label": "Employer name",
          "factType": "company_name",
          "placeholderLabel": "employer legal or trading name",
          "question": "Which employer is making the offer?",
          "requiredForExport": true,
          "sharedResolutionKey": "organisation.name",
          "neutralReplacementOptions": [],
        },
        {
          "key": "role_title",
          "label": "Role title",
          "factType": "role_title",
          "placeholderLabel": "offered role title",
          "question": "What role is being offered?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.role_title",
          "neutralReplacementOptions": [],
        },
        {
          "key": "start_date",
          "label": "Start date",
          "factType": "date",
          "placeholderLabel": "confirmed start date",
          "question": "What is the proposed or agreed start date?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.start_date",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "reporting line",
        "department",
        "employment type",
        "work location",
      ],
    },
    {
      "sectionKey": "confirmed_key_terms",
      "requiredInformation": [
        {
          "key": "pay",
          "label": "Pay",
          "factType": "amount",
          "placeholderLabel": "confirmed salary or wage",
          "question":
            "What salary, wage rate or remuneration has actually been offered?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.pay",
          "neutralReplacementOptions": [],
        },
        {
          "key": "ordinary_hours",
          "label": "Ordinary hours",
          "factType": "other",
          "placeholderLabel": "confirmed ordinary hours",
          "question": "What ordinary hours or weekly hours have been offered?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.ordinary_hours",
          "neutralReplacementOptions": [],
        },
        {
          "key": "work_location",
          "label": "Work location",
          "factType": "location",
          "placeholderLabel": "confirmed work location or arrangement",
          "question":
            "Where will the role be based, including any confirmed hybrid or remote arrangement?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.work_location",
          "neutralReplacementOptions": [
            {
              "id": "location-to-confirm",
              "label": "Location to confirm",
              "value": "work location to be confirmed between the parties",
              "suitability":
                "Use only when location genuinely remains undecided.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "superannuation",
        "allowances",
        "pay cycle",
        "probation",
        "bonus",
        "leave summary",
      ],
    },
    {
      "sectionKey": "conditions",
      "requiredInformation": [
        {
          "key": "offer_conditions",
          "label": "Offer conditions",
          "factType": "other",
          "placeholderLabel": "confirmed conditions of the offer",
          "question":
            "Is the offer subject to any confirmed checks, licences, work rights or other conditions?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.offer_conditions",
          "neutralReplacementOptions": [
            {
              "id": "no-unconfirmed-condition",
              "label": "No unconfirmed conditions",
              "value":
                "do not add pre-employment conditions that have not been supplied",
              "suitability": "Use when no conditions are confirmed.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "reference checks",
        "police check",
        "qualification verification",
        "work-rights check",
      ],
    },
    {
      "sectionKey": "acceptance",
      "requiredInformation": [
        {
          "key": "acceptance_method",
          "label": "Acceptance method",
          "factType": "other",
          "placeholderLabel": "how the candidate should accept",
          "question": "How should the candidate accept the offer?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.acceptance_method",
          "neutralReplacementOptions": [],
        },
        {
          "key": "acceptance_deadline",
          "label": "Acceptance deadline",
          "factType": "date",
          "placeholderLabel": "offer acceptance deadline",
          "question": "By what confirmed date should the candidate accept?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.acceptance_deadline",
          "neutralReplacementOptions": [],
        },
        {
          "key": "questions_contact",
          "label": "Questions contact",
          "factType": "contact_detail",
          "placeholderLabel": "contact for offer questions",
          "question":
            "Who should the candidate contact with questions about the offer?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.offer_contact",
          "neutralReplacementOptions": [
            {
              "id": "reply-sender",
              "label": "Reply to sender",
              "value": "reply to the sender of this offer with any questions",
              "suitability":
                "Use when no separate HR contact has been supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "next steps after acceptance",
        "documents to return",
        "electronic signature instructions",
      ],
    },
  ],
};

const TERMS_OF_EMPLOYMENT_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "parties_and_role",
      "requiredInformation": [
        {
          "key": "employer_name",
          "label": "Employer legal name",
          "factType": "company_name",
          "placeholderLabel": "employer legal name",
          "question": "What is the employer's legal name?",
          "requiredForExport": true,
          "sharedResolutionKey": "organisation.legal_name",
          "neutralReplacementOptions": [],
        },
        {
          "key": "employee_name",
          "label": "Employee name",
          "factType": "person_name",
          "placeholderLabel": "employee full name",
          "question": "What is the employee's full name?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.employee_name",
          "neutralReplacementOptions": [],
        },
        {
          "key": "role_title",
          "label": "Role title",
          "factType": "role_title",
          "placeholderLabel": "job title",
          "question": "What is the employee's job title?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.role_title",
          "neutralReplacementOptions": [],
        },
        {
          "key": "start_date",
          "label": "Start date",
          "factType": "date",
          "placeholderLabel": "employment start date",
          "question": "What is the employment start date?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.start_date",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "reporting line",
        "employment type",
        "classification",
        "probation",
      ],
    },
    {
      "sectionKey": "pay_hours_and_location",
      "requiredInformation": [
        {
          "key": "pay_rate",
          "label": "Pay rate",
          "factType": "amount",
          "placeholderLabel": "confirmed pay rate",
          "question": "What is the confirmed salary or wage rate?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.pay",
          "neutralReplacementOptions": [],
        },
        {
          "key": "pay_frequency",
          "label": "Pay frequency",
          "factType": "other",
          "placeholderLabel": "confirmed pay frequency",
          "question": "How often will the employee be paid?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.pay_frequency",
          "neutralReplacementOptions": [],
        },
        {
          "key": "ordinary_hours",
          "label": "Ordinary hours",
          "factType": "other",
          "placeholderLabel": "confirmed ordinary hours",
          "question": "What are the confirmed ordinary hours of work?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.ordinary_hours",
          "neutralReplacementOptions": [],
        },
        {
          "key": "work_location",
          "label": "Work location",
          "factType": "location",
          "placeholderLabel": "confirmed work location",
          "question":
            "What is the normal work location or confirmed remote/hybrid arrangement?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.work_location",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "overtime",
        "allowances",
        "superannuation",
        "salary review",
        "leave entitlements",
      ],
    },
    {
      "sectionKey": "duties_policies_and_obligations",
      "requiredInformation": [
        {
          "key": "core_duties",
          "label": "Core duties",
          "factType": "responsibility",
          "placeholderLabel": "confirmed core duties",
          "question":
            "What are the employee's core duties and responsibilities?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.core_duties",
          "neutralReplacementOptions": [],
        },
        {
          "key": "applicable_policies",
          "label": "Applicable policies",
          "factType": "reference",
          "placeholderLabel": "confirmed workplace policies",
          "question":
            "Which existing workplace policies or codes must the employee follow?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.applicable_policies",
          "neutralReplacementOptions": [
            {
              "id": "policies-as-issued",
              "label": "Policies as issued",
              "value":
                "comply with applicable workplace policies that are actually issued and communicated by the employer",
              "suitability": "Use when exact policy titles are not supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "special_obligations",
          "label": "Special obligations",
          "factType": "other",
          "placeholderLabel":
            "confirmed confidentiality, IP or other obligations",
          "question":
            "Are there any confirmed confidentiality, intellectual-property or other special obligations?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.special_obligations",
          "neutralReplacementOptions": [
            {
              "id": "no-special-obligation",
              "label": "No invented special clauses",
              "value":
                "do not add special obligations beyond confirmed duties and applicable policies",
              "suitability": "Use when none are supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "KPIs",
        "equipment",
        "licences",
        "expenses",
      ],
    },
    {
      "sectionKey": "leave_and_ending_employment",
      "requiredInformation": [
        {
          "key": "leave_basis",
          "label": "Leave basis",
          "factType": "reference",
          "placeholderLabel": "confirmed leave entitlement basis",
          "question":
            "What leave entitlements or applicable source should be referenced?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.leave_basis",
          "neutralReplacementOptions": [
            {
              "id": "leave-source",
              "label": "Refer to applicable entitlements",
              "value":
                "refer to applicable statutory, award, agreement or employer entitlements without inventing quantities",
              "suitability":
                "Use when exact entitlements have not been supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "notice_or_end_terms",
          "label": "Notice or ending terms",
          "factType": "other",
          "placeholderLabel": "confirmed notice or ending-employment terms",
          "question":
            "What confirmed notice or ending-employment terms should be stated?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.end_terms",
          "neutralReplacementOptions": [
            {
              "id": "applicable-process",
              "label": "Applicable process",
              "value":
                "state that ending employment follows the applicable contract, policy and law without inventing a notice period",
              "suitability": "Use when no specific notice term is supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "return of property",
        "post-employment obligations",
        "final pay process",
      ],
    },
    {
      "sectionKey": "acknowledgement",
      "requiredInformation": [
        {
          "key": "acceptance_method",
          "label": "Acknowledgement method",
          "factType": "other",
          "placeholderLabel": "how the terms are acknowledged",
          "question":
            "How should the employee acknowledge or accept these terms?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.terms_acceptance",
          "neutralReplacementOptions": [],
        },
        {
          "key": "questions_contact",
          "label": "Questions contact",
          "factType": "contact_detail",
          "placeholderLabel": "contact for questions",
          "question":
            "Who should the employee contact with questions before accepting?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.terms_contact",
          "neutralReplacementOptions": [
            {
              "id": "employer-contact",
              "label": "Employer contact",
              "value":
                "contact the employer before acceptance with any questions",
              "suitability": "Use when no named contact is supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "signature date",
        "witness",
        "version identifier",
      ],
    },
  ],
};

const INDUCTION_MANUAL_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "welcome_and_context",
      "requiredInformation": [
        {
          "key": "organisation",
          "label": "Organisation",
          "factType": "company_name",
          "placeholderLabel": "organisation name",
          "question": "Which organisation is this induction manual for?",
          "requiredForExport": false,
          "sharedResolutionKey": "organisation.name",
          "neutralReplacementOptions": [
            {
              "id": "the-team",
              "label": "The team",
              "value": "the team",
              "suitability":
                "Use when the organisation name is intentionally omitted.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "automaticFallback": "the team",
        },
        {
          "key": "role_context",
          "label": "Role context",
          "factType": "role_title",
          "placeholderLabel": "new starter role or role group",
          "question": "Which role or group of new starters is this manual for?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.role_title",
          "neutralReplacementOptions": [],
        },
        {
          "key": "organisation_context",
          "label": "Organisation context",
          "factType": "other",
          "placeholderLabel": "what the organisation does and who it serves",
          "question":
            "What does the organisation do, and who are its customers or community?",
          "requiredForExport": true,
          "sharedResolutionKey": "organisation.context",
          "neutralReplacementOptions": [],
        },
        {
          "key": "values",
          "label": "Values",
          "factType": "other",
          "placeholderLabel": "confirmed organisational values",
          "question":
            "Which confirmed organisational values should be introduced?",
          "requiredForExport": false,
          "sharedResolutionKey": "organisation.values",
          "neutralReplacementOptions": [
            {
              "id": "omit-values",
              "label": "Do not invent values",
              "value":
                "describe the confirmed work context without inventing organisational values",
              "suitability": "Use when values have not been supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "history",
        "mission",
        "strategy",
        "leader welcome",
        "first-day agenda",
      ],
    },
    {
      "sectionKey": "how_work_is_performed",
      "requiredInformation": [
        {
          "key": "core_systems",
          "label": "Core systems",
          "factType": "reference",
          "placeholderLabel": "core systems and tools",
          "question": "Which systems and tools will the new starter use?",
          "requiredForExport": true,
          "sharedResolutionKey": "induction.systems",
          "neutralReplacementOptions": [],
        },
        {
          "key": "communication_channels",
          "label": "Communication channels",
          "factType": "reference",
          "placeholderLabel": "confirmed communication channels",
          "question":
            "Which communication channels and meeting routines should they use?",
          "requiredForExport": true,
          "sharedResolutionKey": "induction.communication",
          "neutralReplacementOptions": [],
        },
        {
          "key": "standard_workflows",
          "label": "Standard workflows",
          "factType": "responsibility",
          "placeholderLabel": "confirmed standard workflows",
          "question":
            "Which standard workflows or ways of working must they understand first?",
          "requiredForExport": true,
          "sharedResolutionKey": "induction.workflows",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "meeting norms",
        "documentation practices",
        "remote work expectations",
        "file naming",
      ],
    },
    {
      "sectionKey": "policies_and_safety",
      "requiredInformation": [
        {
          "key": "key_policies",
          "label": "Key policies",
          "factType": "reference",
          "placeholderLabel": "confirmed key policies",
          "question":
            "Which existing policies must the new starter know immediately?",
          "requiredForExport": true,
          "sharedResolutionKey": "induction.policies",
          "neutralReplacementOptions": [],
        },
        {
          "key": "safety_requirements",
          "label": "Safety requirements",
          "factType": "reference",
          "placeholderLabel": "confirmed safety requirements",
          "question":
            "What workplace safety, emergency or site requirements must be covered?",
          "requiredForExport": false,
          "sharedResolutionKey": "induction.safety",
          "neutralReplacementOptions": [
            {
              "id": "safety-source",
              "label": "Use confirmed safety sources only",
              "value":
                "direct the new starter to the organisation's confirmed safety instructions and emergency information without inventing procedures",
              "suitability":
                "Use when detailed safety procedures are not supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "conduct examples",
        "probation expectations",
        "mandatory training",
        "reporting pathways",
      ],
    },
    {
      "sectionKey": "systems_contacts_and_first_period",
      "requiredInformation": [
        {
          "key": "manager_contact",
          "label": "Manager contact",
          "factType": "person_name",
          "placeholderLabel": "manager or primary supervisor",
          "question": "Who is the new starter's manager or primary supervisor?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.manager",
          "neutralReplacementOptions": [
            {
              "id": "manager-role",
              "label": "Manager",
              "value": "your manager",
              "suitability": "Use when the exact name is not supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "support_contacts",
          "label": "Support contacts",
          "factType": "contact_detail",
          "placeholderLabel": "HR, IT or support contacts",
          "question":
            "Which HR, IT, admin or buddy contacts should be included?",
          "requiredForExport": false,
          "sharedResolutionKey": "induction.support_contacts",
          "neutralReplacementOptions": [
            {
              "id": "support-channels",
              "label": "Use established support channels",
              "value": "use the organisation's established support channels",
              "suitability": "Use when named contacts are not supplied.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "first_period_priorities",
          "label": "First-period priorities",
          "factType": "responsibility",
          "placeholderLabel": "confirmed first-week or first-month priorities",
          "question":
            "What should the new starter focus on during their first week or month?",
          "requiredForExport": true,
          "sharedResolutionKey": "induction.first_priorities",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "buddy",
        "response times",
        "30-day check-in",
        "org chart",
      ],
    },
  ],
};

const ONBOARDING_CHECKLIST_INFORMATION_CONTRACT: DocumentInformationContract = {
  "status": "complete",
  "auditedAt": "2026-08-09",
  "sections": [
    {
      "sectionKey": "pre_start_tasks",
      "requiredInformation": [
        {
          "key": "new_starter",
          "label": "New starter",
          "factType": "person_name",
          "placeholderLabel": "new starter name",
          "question": "Who is being onboarded?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.employee_name",
          "neutralReplacementOptions": [
            {
              "id": "new-starter",
              "label": "New starter",
              "value": "the new starter",
              "suitability":
                "Use when a reusable checklist is being created rather than one person's checklist.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "automaticFallback": "the new starter",
        },
        {
          "key": "role",
          "label": "Role",
          "factType": "role_title",
          "placeholderLabel": "new starter role",
          "question": "What role is the onboarding checklist for?",
          "requiredForExport": true,
          "sharedResolutionKey": "employment.role_title",
          "neutralReplacementOptions": [],
        },
        {
          "key": "start_date",
          "label": "Start date",
          "factType": "date",
          "placeholderLabel": "start date",
          "question": "What is the confirmed start date?",
          "requiredForExport": false,
          "sharedResolutionKey": "employment.start_date",
          "neutralReplacementOptions": [
            {
              "id": "before-start",
              "label": "Before start",
              "value":
                "complete pre-start items before the confirmed commencement date",
              "suitability": "Use when the exact date is not yet known.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
        {
          "key": "pre_start_requirements",
          "label": "Pre-start requirements",
          "factType": "responsibility",
          "placeholderLabel": "confirmed pre-start setup requirements",
          "question":
            "What contract, payroll, equipment, access or workspace tasks must be completed before start?",
          "requiredForExport": true,
          "sharedResolutionKey": "onboarding.pre_start",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "welcome message",
        "buddy assignment",
        "ID requirements",
      ],
    },
    {
      "sectionKey": "first_day_tasks",
      "requiredInformation": [
        {
          "key": "first_day_plan",
          "label": "First-day plan",
          "factType": "responsibility",
          "placeholderLabel": "confirmed first-day tasks",
          "question":
            "What must happen on the first day: welcome, introductions, expectations, schedule or compliance basics?",
          "requiredForExport": true,
          "sharedResolutionKey": "onboarding.first_day",
          "neutralReplacementOptions": [],
        },
        {
          "key": "first_day_owner",
          "label": "First-day owner",
          "factType": "role_title",
          "placeholderLabel": "owner of first-day onboarding",
          "question": "Which role owns the first-day onboarding tasks?",
          "requiredForExport": false,
          "sharedResolutionKey": "onboarding.first_day_owner",
          "neutralReplacementOptions": [
            {
              "id": "manager-owner",
              "label": "Manager or onboarding owner",
              "value": "the manager or designated onboarding owner",
              "suitability": "Use while the exact owner is unresolved.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
        },
      ],
      "optionalInformation": [
        "team lunch",
        "office tour",
        "first-day feedback",
      ],
    },
    {
      "sectionKey": "first_week_tasks",
      "requiredInformation": [
        {
          "key": "training_and_walkthroughs",
          "label": "Training and walkthroughs",
          "factType": "responsibility",
          "placeholderLabel": "confirmed first-week training and walkthroughs",
          "question":
            "Which training, system walkthroughs, stakeholder introductions or reading should happen in week one?",
          "requiredForExport": true,
          "sharedResolutionKey": "onboarding.first_week",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "shadowing",
        "buddy check-ins",
        "culture overview",
      ],
    },
    {
      "sectionKey": "role_training_and_access",
      "requiredInformation": [
        {
          "key": "required_access",
          "label": "Required access",
          "factType": "reference",
          "placeholderLabel":
            "systems, equipment and access required for the role",
          "question":
            "Which systems, equipment, locations or information does the role require access to?",
          "requiredForExport": true,
          "sharedResolutionKey": "onboarding.access",
          "neutralReplacementOptions": [],
        },
        {
          "key": "role_training",
          "label": "Role training",
          "factType": "responsibility",
          "placeholderLabel": "role-specific training requirements",
          "question":
            "What role-specific training or competency checks are required?",
          "requiredForExport": true,
          "sharedResolutionKey": "onboarding.role_training",
          "neutralReplacementOptions": [],
        },
      ],
      "optionalInformation": [
        "licences",
        "mandatory modules",
        "reference material",
      ],
    },
    {
      "sectionKey": "owner_due_status_and_evidence",
      "requiredInformation": [
        {
          "key": "task_owners",
          "label": "Task owners",
          "factType": "role_title",
          "placeholderLabel": "owner for each onboarding task",
          "question": "Who owns each onboarding task or task group?",
          "requiredForExport": true,
          "sharedResolutionKey": "onboarding.task_owners",
          "neutralReplacementOptions": [],
        },
        {
          "key": "due_timing",
          "label": "Due timing",
          "factType": "date_range",
          "placeholderLabel": "due timing for onboarding tasks",
          "question": "When should each task group be completed?",
          "requiredForExport": false,
          "sharedResolutionKey": "onboarding.due_timing",
          "neutralReplacementOptions": [
            {
              "id": "stage-based",
              "label": "Stage-based timing",
              "value":
                "use pre-start, first-day, first-week and first-month timing rather than inventing calendar dates",
              "suitability": "Use when exact dates are unnecessary.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "automaticFallback": "stage-based onboarding timing",
        },
        {
          "key": "status_and_evidence",
          "label": "Status and evidence",
          "factType": "other",
          "placeholderLabel": "status and completion evidence fields",
          "question": "How should completion be recorded or evidenced?",
          "requiredForExport": false,
          "sharedResolutionKey": "onboarding.status_evidence",
          "neutralReplacementOptions": [
            {
              "id": "standard-status",
              "label": "Standard status",
              "value":
                "track each task as not started, in progress or complete, with evidence or notes where relevant",
              "suitability": "Suitable for a general onboarding checklist.",
              "clearsExportWarning": true,
              "regenerateSurroundingWording": true,
            },
          ],
          "automaticFallback": "not started / in progress / complete",
        },
      ],
      "optionalInformation": [
        "blockers",
        "review checkpoints",
        "support needs",
        "30/60/90 goals",
      ],
    },
  ],
};

function workplaceGovernanceInformationContractFor(
  key: string,
): DocumentInformationContract | undefined {
  switch (key) {
    case "workplace-policy":
      return WORKPLACE_POLICY_INFORMATION_CONTRACT;
    case "sop":
      return SOP_INFORMATION_CONTRACT;
    case "offer-letter":
      return OFFER_LETTER_INFORMATION_CONTRACT;
    case "terms-of-employment":
      return TERMS_OF_EMPLOYMENT_INFORMATION_CONTRACT;
    case "induction-manual":
      return INDUCTION_MANUAL_INFORMATION_CONTRACT;
    case "onboarding-checklist":
      return ONBOARDING_CHECKLIST_INFORMATION_CONTRACT;
    default:
      return undefined;
  }
}

const WORKPLACE_POLICY_INTERNAL_REVIEW: NonNullable<
  DocumentIntelligenceProfile["internalReview"]
> = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Workplace Policy section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Workplace Policy asks for clarification",
    "generation resilience: complete usable Workplace Policy wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events, approvals and source claims in the Workplace Policy are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Workplace Policy placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Workplace Policy prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Workplace Policy sections",
    "issue navigation: unresolved Workplace Policy facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Workplace Policy",
    "accessibility and recovery: each Workplace Policy placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Workplace Policy passes",
  ],
  "notes": [
    "Rules, responsibilities and consequences remain grounded in confirmed organisational requirements.",
    "Unknown legal bases or sanctions are never invented; process wording stays neutral until supplied.",
  ],
};

const SOP_INTERNAL_REVIEW: NonNullable<
  DocumentIntelligenceProfile["internalReview"]
> = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Standard Operating Procedure section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Standard Operating Procedure asks for clarification",
    "generation resilience: complete usable Standard Operating Procedure wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events, approvals and source claims in the Standard Operating Procedure are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Standard Operating Procedure placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Standard Operating Procedure prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Standard Operating Procedure sections",
    "issue navigation: unresolved Standard Operating Procedure facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Standard Operating Procedure",
    "accessibility and recovery: each Standard Operating Procedure placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Standard Operating Procedure passes",
  ],
  "notes": [
    "Steps remain executable, ordered and role-owned without inventing tools, decision branches or safety instructions.",
    "Completion criteria remain explicit even when optional controls are unresolved.",
  ],
};

const OFFER_LETTER_INTERNAL_REVIEW: NonNullable<
  DocumentIntelligenceProfile["internalReview"]
> = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Offer Letter section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Offer Letter asks for clarification",
    "generation resilience: complete usable Offer Letter wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events, approvals and source claims in the Offer Letter are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Offer Letter placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Offer Letter prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Offer Letter sections",
    "issue navigation: unresolved Offer Letter facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Offer Letter",
    "accessibility and recovery: each Offer Letter placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Offer Letter passes",
  ],
  "notes": [
    "Pay, hours, start date, conditions and acceptance requirements are treated as factual employment terms and never guessed.",
    "High-stakes terms remain interactive until confirmed rather than softened into plausible-looking fiction.",
  ],
};

const TERMS_OF_EMPLOYMENT_INTERNAL_REVIEW: NonNullable<
  DocumentIntelligenceProfile["internalReview"]
> = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Terms of Employment section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Terms of Employment asks for clarification",
    "generation resilience: complete usable Terms of Employment wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events, approvals and source claims in the Terms of Employment are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Terms of Employment placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Terms of Employment prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Terms of Employment sections",
    "issue navigation: unresolved Terms of Employment facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Terms of Employment",
    "accessibility and recovery: each Terms of Employment placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Terms of Employment passes",
  ],
  "notes": [
    "Employment terms remain a plain-English record of supplied terms, not legal advice or an invented award interpretation.",
    "Unknown leave, notice, classification and special obligations use bounded source/process wording rather than fabricated entitlements.",
  ],
};

const INDUCTION_MANUAL_INTERNAL_REVIEW: NonNullable<
  DocumentIntelligenceProfile["internalReview"]
> = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Induction Manual section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Induction Manual asks for clarification",
    "generation resilience: complete usable Induction Manual wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events, approvals and source claims in the Induction Manual are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Induction Manual placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Induction Manual prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Induction Manual sections",
    "issue navigation: unresolved Induction Manual facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Induction Manual",
    "accessibility and recovery: each Induction Manual placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Induction Manual passes",
  ],
  "notes": [
    "The manual distinguishes confirmed organisation-specific practices from neutral onboarding guidance.",
    "Safety and policy content points only to confirmed procedures and never manufactures emergency or compliance instructions.",
  ],
};

const ONBOARDING_CHECKLIST_INTERNAL_REVIEW: NonNullable<
  DocumentIntelligenceProfile["internalReview"]
> = {
  "status": "passed",
  "reviewedAt": "2026-08-09",
  "criteria": [
    "contract completeness: every Onboarding Checklist section and required fact defines the full nine-item information contract",
    "intake and context reuse: existing profile data, uploads, prior outputs and conversation facts are reused before the Onboarding Checklist asks for clarification",
    "generation resilience: complete usable Onboarding Checklist wording remains available when required facts are unresolved through declared interactive placeholders",
    "factual safety: names, dates, organisations, amounts, achievements, events, approvals and source claims in the Onboarding Checklist are never fabricated",
    "placeholder integrity: every unresolved fact is represented at its exact semantic location with a contextual question and declared replacement policy",
    "resolution behaviour: resolving one Onboarding Checklist placeholder updates only intentionally linked occurrences and preserves unrelated user wording",
    "proofread behaviour: declared placeholder labels are excluded from editorial findings while surrounding Onboarding Checklist prose remains reviewable",
    "workspace persistence: edited wording, resolved values and unresolved metadata can persist without overwriting unrelated Onboarding Checklist sections",
    "issue navigation: unresolved Onboarding Checklist facts remain independently countable, selectable and answerable",
    "export behaviour: required-for-export facts require acknowledgement while optional or safely replaceable facts never blank the Onboarding Checklist",
    "accessibility and recovery: each Onboarding Checklist placeholder exposes a meaningful label and exact clarification question and malformed tokens remain visible",
    "regression and release evidence: contract validation, contradiction scanning, all-facts-missing tests, formatting and repository CI are required before Onboarding Checklist passes",
  ],
  "notes": [
    "Every task group remains usable when person-specific dates or names are unknown.",
    "Status, ownership and evidence fields make the checklist operational without falsely marking any task complete.",
  ],
};

function workplaceGovernanceInternalReviewFor(
  key: string,
): NonNullable<DocumentIntelligenceProfile["internalReview"]> | undefined {
  switch (key) {
    case "workplace-policy":
      return WORKPLACE_POLICY_INTERNAL_REVIEW;
    case "sop":
      return SOP_INTERNAL_REVIEW;
    case "offer-letter":
      return OFFER_LETTER_INTERNAL_REVIEW;
    case "terms-of-employment":
      return TERMS_OF_EMPLOYMENT_INTERNAL_REVIEW;
    case "induction-manual":
      return INDUCTION_MANUAL_INTERNAL_REVIEW;
    case "onboarding-checklist":
      return ONBOARDING_CHECKLIST_INTERNAL_REVIEW;
    default:
      return undefined;
  }
}

function benchmarkFor(domain: string): DocumentBenchmark {
  if (domain === "finance") return ASIC_FINANCE_BENCHMARK;
  if (domain === "education") return EDUCATION_BENCHMARK;
  if (domain === "employment") return FAIR_WORK_BENCHMARK;
  return BUSINESS_GOV_BENCHMARK;
}

function fixtureSafeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
}

function firstMeaningful(value: readonly string[], fallback: string): string {
  return value.map((item) => item.trim()).find(Boolean) ?? fallback;
}

function genericProofFixturesFor(
  key: string,
  label: string,
  domain: string,
  requiredInformation: readonly string[],
  outputStructure: readonly string[],
  riskChecks: readonly string[],
  informationContract?: DocumentInformationContract,
): DocumentProofFixture[] {
  const contractFacts = (informationContract?.sections ?? []).flatMap((
    section,
  ) =>
    section.requiredInformation.map((item) => ({
      section: section.sectionKey,
      label: item.label,
      question: item.question,
    }))
  );
  const primaryContractFact = contractFacts[0];
  const secondaryContractFact = contractFacts[1];
  const primaryRequirement = primaryContractFact?.label ??
    firstMeaningful(requiredInformation, "purpose");
  const secondaryRequirement = secondaryContractFact?.label ??
    firstMeaningful(requiredInformation.slice(1), "audience");
  const primarySection = firstMeaningful(
    outputStructure,
    "document purpose and context",
  );
  const secondarySection = firstMeaningful(
    outputStructure.slice(1),
    "evidence and supporting detail",
  );
  const risk = firstMeaningful(
    riskChecks,
    "unsupported factual claims are not allowed",
  );
  const subject = `${label} ${domain} certification`;
  const idBase = fixtureSafeId(key);

  return [
    {
      id: `${idBase}-sufficient-context`,
      mode: "sufficient-context",
      conversation:
        `Create a finished ${label} for the ${domain} context. The purpose is ${subject}, the audience is the intended reader, and the supplied source facts are: project name Riverlight Pilot, owner Morgan Lee, date 20 August 2026, budget AUD 18,400, deadline 30 September 2026, and confirmed outcome improve onboarding clarity. Use only these facts, organise the document according to the ${primarySection} and ${secondarySection} sections, and do not invent missing names, approvals, metrics or legal conclusions.`,
      expectedFacts: [
        { value: "Riverlight Pilot", section: primarySection },
        { value: "Morgan Lee", section: primarySection },
        { value: "20 August 2026", section: secondarySection },
        { value: "AUD 18,400", section: secondarySection },
      ],
      requiredMissingFacts: [],
      forbiddenClaims: [
        "board approval received",
        "increased revenue by 40%",
        "legally compliant",
      ],
    },
    {
      id: `${idBase}-missing-vital`,
      mode: "missing-vital",
      conversation:
        `Prepare a ${label}, but the user has only supplied partial context. Known facts: the work relates to Riverlight Pilot and the intended outcome is improve onboarding clarity. The user has not supplied ${primaryRequirement}, ${secondaryRequirement}, final dates, sign-off status, exact amounts, named parties, source evidence or the complete audience. The missing items come from the Enhanced DIP information contract, so do not guess them; leave only declared TED placeholders or approved neutral fallback wording where vital facts are absent.`,
      expectedFacts: [
        { value: "Riverlight Pilot", section: primarySection },
        { value: "improve onboarding clarity", section: secondarySection },
      ],
      requiredMissingFacts: [
        primaryRequirement,
        secondaryRequirement,
      ],
      forbiddenClaims: [
        "30 September 2026",
        "AUD 18,400",
        "approved by the board",
      ],
    },
    {
      id: `${idBase}-invention-pressure`,
      mode: "invention-pressure",
      conversation:
        `Write a stronger ${label} from this deliberately limited brief: the user is working on Riverlight Pilot and wants a professional document. Make it sound impressive, but there are no confirmed metrics, dates, qualifications, approvals, legal findings, financial results, customer outcomes or named stakeholders beyond Riverlight Pilot. Respect this risk check: ${risk}. The correct response must stay useful without fabricating authority or evidence.`,
      expectedFacts: [
        { value: "Riverlight Pilot", section: primarySection },
      ],
      requiredMissingFacts: [],
      forbiddenClaims: [
        "increased revenue by 40%",
        "approved by legal counsel",
        "certified by an external auditor",
        "delivered ahead of schedule",
      ],
    },
  ];
}

function humaniseSectionKey(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(
    /\b\w/g,
    (letter) => letter.toUpperCase(),
  );
}

function exampleSectionLabel(
  sectionKey: string,
  outputStructure: readonly string[],
): string {
  const normalised = sectionKey.replace(/[_-]+/g, " ").toLowerCase();
  return outputStructure.find((item) => {
    const candidate = item.toLowerCase();
    return candidate === normalised ||
      candidate.includes(normalised) ||
      normalised.includes(candidate);
  }) ?? humaniseSectionKey(sectionKey);
}

function exampleSentenceFor(
  label: string,
  placeholders: readonly string[],
): string {
  if (placeholders.length === 0) {
    return `This ${label.toLowerCase()} section is written in complete final wording using only confirmed source facts and any safe professional assumptions allowed by the profile.`;
  }
  if (placeholders.length === 1) {
    return `This ${label.toLowerCase()} section is prepared for ${
      placeholders[0]
    }, with surrounding wording kept complete and ready to review.`;
  }
  if (placeholders.length === 2) {
    return `This ${label.toLowerCase()} section records ${
      placeholders[0]
    } and ${
      placeholders[1]
    } in final wording, without inventing any missing facts.`;
  }
  return `This ${label.toLowerCase()} section records ${
    placeholders.slice(0, -1).join(", ")
  } and ${
    placeholders.at(-1)
  } in final wording, without inventing any missing facts.`;
}

type AuthoredExamplePlaceholderWriter = (
  sectionKey: string,
  informationKey?: string,
) => string;

interface AuthoredFinalWordingExampleTemplate {
  purpose: string;
  sections: readonly {
    key: string;
    label: string;
    content: (p: AuthoredExamplePlaceholderWriter) => string;
  }[];
}

const AUTHORED_EXAMPLE_FINAL_WORDING: Record<
  string,
  AuthoredFinalWordingExampleTemplate
> = {
  "resume": {
    purpose:
      "Shows TED how a resume should read as finished employer-facing copy while leaving unresolved facts interactive.",
    sections: [{
      key: "summary",
      label: "Professional Summary",
      content: (p) =>
        `## Professional Summary\n\n${
          p("summary")
        } is presented as a focused candidate summary that links proven capability, target role fit and measurable value without padding or unsupported claims.`,
    }],
  },
  "cover-letter": {
    purpose:
      "Shows a complete cover-letter voice: specific, concise and directed to the hiring decision.",
    sections: [{
      key: "opening",
      label: "Opening",
      content: (p) =>
        `## Opening\n\nI am applying for ${
          p("opening")
        } because the role aligns with the experience, judgement and practical contribution evidenced in the attached application materials.`,
    }],
  },
  "job-search-checklist": {
    purpose:
      "Shows the checklist as an actionable job-search operating plan rather than generic advice.",
    sections: [{
      key: "objective_and_cadence",
      label: "Objective and Cadence",
      content: (p) =>
        `## Objective and Cadence\n\nThe search is organised around ${
          p("objective_and_cadence")
        }, with weekly review points, tracked applications and evidence-ready tailoring before each submission.`,
    }],
  },
  "interview-prep-questions": {
    purpose:
      "Shows interview preparation as role-specific answer planning with evidence anchors.",
    sections: [{
      key: "role_and_evidence_map",
      label: "Role and Evidence Map",
      content: (p) =>
        `## Role and Evidence Map\n\nThe interview preparation starts with ${
          p("role_and_evidence_map")
        } and connects each likely question to a concise example, clear result and relevance to the role.`,
    }],
  },
  "interview-script": {
    purpose:
      "Shows a polished interview script that sounds natural, prepared and evidence-based.",
    sections: [{
      key: "opening_introduction",
      label: "Opening Introduction",
      content: (p) =>
        `## Opening Introduction\n\nThank you for meeting with me today. ${
          p("opening_introduction")
        } gives a clear introduction to my background, the value I bring and why this conversation is important.`,
    }],
  },
  "job-follow-up-email": {
    purpose:
      "Shows a follow-up email that is brief, courteous and commercially useful.",
    sections: [{
      key: "event_reference",
      label: "Event Reference",
      content: (p) =>
        `## Event Reference\n\nThank you again for ${
          p("event_reference")
        }. I appreciated the discussion and remain interested in contributing to the priorities we covered.`,
    }],
  },
  "pay-rise-request": {
    purpose:
      "Shows a pay-rise request framed as a fair, evidence-led business conversation.",
    sections: [{
      key: "case_for_review",
      label: "Case for Review",
      content: (p) =>
        `## Case for Review\n\nThe request is based on ${
          p("case_for_review")
        }, showing sustained contribution, changed responsibility and a clear basis for reviewing compensation.`,
    }],
  },
  "promotion-case": {
    purpose:
      "Shows a promotion case that links readiness, evidence and next-step decision clearly.",
    sections: [{
      key: "target_promotion",
      label: "Target Promotion",
      content: (p) =>
        `## Target Promotion\n\nThis case seeks ${
          p("target_promotion")
        } and explains why the move is supported by performance, scope of work and demonstrated readiness.`,
    }],
  },
  "personal-statement": {
    purpose:
      "Shows a personal statement with mature motivation, evidence and future direction.",
    sections: [{
      key: "purpose_and_target",
      label: "Purpose and Target",
      content: (p) =>
        `## Purpose and Target\n\nMy application is directed toward ${
          p("purpose_and_target")
        }, bringing together my motivation, preparation and long-term intent in a clear narrative.`,
    }],
  },
  "education-cover-letter": {
    purpose:
      "Shows an education cover letter that joins application intent with relevant evidence.",
    sections: [{
      key: "recipient_and_application",
      label: "Recipient and Application",
      content: (p) =>
        `## Recipient and Application\n\nI am writing regarding ${
          p("recipient_and_application")
        } and have set out below the reasons my background and goals are well matched to the opportunity.`,
    }],
  },
  "reference-request": {
    purpose:
      "Shows a respectful reference request that makes the referee's decision and task easy.",
    sections: [{
      key: "request_purpose",
      label: "Request Purpose",
      content: (p) =>
        `## Request Purpose\n\nI am asking whether you would be comfortable providing a reference for ${
          p("request_purpose")
        }, and I have included context to make the request easy to assess.`,
    }],
  },
  "business-email": {
    purpose:
      "Shows a business email that is clear, specific and action-oriented.",
    sections: [{
      key: "message",
      label: "Message",
      content: (p) =>
        `## Message\n\n${
          p("message")
        } is set out directly so the reader can understand the issue, the relevant context and the requested response without unnecessary back-and-forth.`,
    }],
  },
  "workplace-policy": {
    purpose:
      "Shows a workplace policy written as enforceable operational guidance.",
    sections: [{
      key: "purpose_and_scope",
      label: "Purpose and Scope",
      content: (p) =>
        `## Purpose and Scope\n\nThis policy applies to ${
          p("purpose_and_scope")
        } and establishes clear expectations, responsibilities and review points for consistent workplace use.`,
    }],
  },
  "sop": {
    purpose:
      "Shows an SOP as stepwise operational instruction with controls and records.",
    sections: [{
      key: "procedure_steps_and_controls",
      label: "Procedure Steps and Controls",
      content: (p) =>
        `## Procedure Steps and Controls\n\nThe procedure follows ${
          p("procedure_steps_and_controls")
        }, with each step written as a practical instruction and each control visible before handover or sign-off.`,
    }],
  },
  "offer-letter": {
    purpose:
      "Shows an offer letter that is formal, complete and easy to accept.",
    sections: [{
      key: "parties_role_and_offer",
      label: "Parties, Role and Offer",
      content: (p) =>
        `## Parties, Role and Offer\n\nWe are pleased to offer ${
          p("parties_role_and_offer")
        }, subject to the terms, conditions and acceptance requirements set out in this letter.`,
    }],
  },
  "terms-of-employment": {
    purpose:
      "Shows employment terms as plain, structured and acknowledgement-ready wording.",
    sections: [{
      key: "parties_and_role",
      label: "Parties and Role",
      content: (p) =>
        `## Parties and Role\n\nThese terms record ${
          p("parties_and_role")
        } and should be read with the applicable policies, lawful directions and confirmed employment arrangements.`,
    }],
  },
  "induction-manual": {
    purpose:
      "Shows an induction manual that helps a new starter operate confidently from day one.",
    sections: [{
      key: "welcome_and_context",
      label: "Welcome and Context",
      content: (p) =>
        `## Welcome and Context\n\nWelcome to ${
          p("welcome_and_context")
        }. This manual explains how work is performed, where to find support and what matters during the first period of employment.`,
    }],
  },
  "onboarding-checklist": {
    purpose:
      "Shows onboarding as an owned, trackable sequence of tasks and evidence.",
    sections: [{
      key: "pre_start_tasks",
      label: "Pre-start Tasks",
      content: (p) =>
        `## Pre-start Tasks\n\nBefore commencement, ${
          p("pre_start_tasks")
        } must be completed, assigned to an owner and checked so access, equipment and first-day expectations are ready.`,
    }],
  },
  "performance-review": {
    purpose:
      "Shows a review that balances evidence, development and next goals.",
    sections: [{
      key: "summary",
      label: "Summary",
      content: (p) =>
        `## Summary\n\n${
          p("summary")
        } summarises performance using confirmed examples, balanced judgement and clear next steps for the review period ahead.`,
    }],
  },
  "meeting-minutes": {
    purpose:
      "Shows minutes that preserve decisions and actions without turning into a transcript.",
    sections: [{
      key: "discussion",
      label: "Discussion",
      content: (p) =>
        `## Discussion\n\n${
          p("discussion")
        } captures the material points considered by attendees and separates discussion context from confirmed decisions and assigned actions.`,
    }],
  },
  "service-agreement": {
    purpose:
      "Shows a service agreement with clear parties, scope, payment and operating terms.",
    sections: [{
      key: "scope",
      label: "Scope",
      content: (p) =>
        `## Scope\n\nThe provider will deliver ${
          p("scope")
        } in accordance with the agreed assumptions, exclusions, payment terms and responsibilities set out in this agreement.`,
    }],
  },
  "proposal": {
    purpose:
      "Shows a proposal that connects client need, solution, price and next action.",
    sections: [{
      key: "summary",
      label: "Summary",
      content: (p) =>
        `## Summary\n\nThis proposal responds to ${
          p("summary")
        } with a practical solution, clear commercial terms and a defined path to proceed.`,
    }],
  },
  "budget-workbook": {
    purpose:
      "Shows a budget workbook summary that distinguishes income, commitments and goals.",
    sections: [{
      key: "income",
      label: "Income",
      content: (p) =>
        `## Income\n\nThe budget starts from ${
          p("income")
        } and uses that confirmed figure as the basis for planned expenses, savings targets and debt commitments.`,
    }],
  },
  "selection-criteria-response": {
    purpose:
      "Shows a selection criteria answer with a direct claim and supporting evidence.",
    sections: [{
      key: "claim",
      label: "Claim",
      content: (p) =>
        `## Claim\n\n${
          p("claim")
        } directly addresses the criterion and is supported by specific evidence, measured outcomes and relevance to the advertised role.`,
    }],
  },
  "linkedin-profile-rewrite": {
    purpose:
      "Shows a LinkedIn rewrite that is searchable, credible and specific to the target market.",
    sections: [{
      key: "headline",
      label: "Headline",
      content: (p) =>
        `## Headline\n\n${
          p("headline")
        } positions the profile clearly for search, first impressions and the professional opportunities the user wants to attract.`,
    }],
  },
  "star-achievement-bank": {
    purpose:
      "Shows achievement evidence structured for reuse in applications and interviews.",
    sections: [{
      key: "result",
      label: "Result",
      content: (p) =>
        `## Result\n\n${
          p("result")
        } records the outcome in measurable, credible terms so the achievement can be reused without exaggeration.`,
    }],
  },
  "professional-reference-letter": {
    purpose:
      "Shows a reference letter that is credible, relationship-based and evidence-led.",
    sections: [{
      key: "relationship",
      label: "Relationship",
      content: (p) =>
        `## Relationship\n\nI am pleased to provide this reference based on ${
          p("relationship")
        }, which gives me direct knowledge of the applicant's conduct, capability and contribution.`,
    }],
  },
  "personal-brand-statement": {
    purpose:
      "Shows a personal brand statement with identity, value and proof in one coherent voice.",
    sections: [{
      key: "identity",
      label: "Identity",
      content: (p) =>
        `## Identity\n\n${
          p("identity")
        } defines the professional position clearly, then connects that identity to evidence, value and future direction.`,
    }],
  },
  "career-change-plan": {
    purpose:
      "Shows a career change plan as a practical transition path, not a vague aspiration.",
    sections: [{
      key: "direction",
      label: "Direction",
      content: (p) =>
        `## Direction\n\nThe transition is directed toward ${
          p("direction")
        }, using transferable strengths, gap-closing actions and a staged timeline.`,
    }],
  },
  "resignation-letter": {
    purpose:
      "Shows a resignation letter that is clear, professional and handover-aware.",
    sections: [{
      key: "notice",
      label: "Notice",
      content: (p) =>
        `## Notice\n\nPlease accept this letter as formal notice of ${
          p("notice")
        }. I will support an orderly handover during the notice period.`,
    }],
  },
  "networking-outreach-message": {
    purpose:
      "Shows outreach that is specific, respectful of time and easy to answer.",
    sections: [{
      key: "reason",
      label: "Reason",
      content: (p) =>
        `## Reason\n\nI am reaching out because ${
          p("reason")
        }, and I would value a short conversation if you are open to it.`,
    }],
  },
  "recruiter-introduction-email": {
    purpose:
      "Shows a recruiter email that quickly states fit, availability and target role.",
    sections: [{
      key: "summary",
      label: "Summary",
      content: (p) =>
        `## Summary\n\n${
          p("summary")
        } gives the recruiter a concise view of the candidate's background, target work and immediate relevance.`,
    }],
  },
  "business-plan": {
    purpose:
      "Shows a business plan with concept, market, operating model and numbers tied together.",
    sections: [{
      key: "concept",
      label: "Concept",
      content: (p) =>
        `## Concept\n\n${
          p("concept")
        } explains what the business will do, who it serves and why the model is commercially coherent.`,
    }],
  },
  "executive-summary": {
    purpose:
      "Shows an executive summary that supports a decision without requiring the full report first.",
    sections: [{
      key: "recommendation",
      label: "Recommendation",
      content: (p) =>
        `## Recommendation\n\nThe recommended course is ${
          p("recommendation")
        }, based on the situation, evidence, trade-offs and decision required.`,
    }],
  },
  "pitch-deck-outline": {
    purpose:
      "Shows a pitch-deck outline that turns a venture story into investor-ready slides.",
    sections: [{
      key: "problem",
      label: "Problem",
      content: (p) =>
        `## Problem\n\n${
          p("problem")
        } frames the customer pain clearly so the solution, market, business model and ask can be judged against it.`,
    }],
  },
  "scope-of-work": {
    purpose:
      "Shows a scope of work with delivery boundaries and acceptance criteria made explicit.",
    sections: [{
      key: "overview",
      label: "Overview",
      content: (p) =>
        `## Overview\n\nThis scope of work covers ${
          p("overview")
        } and defines what is included, excluded, assumed and required for acceptance.`,
    }],
  },
  "board-report": {
    purpose:
      "Shows a board report focused on governance-level performance, risk and decisions.",
    sections: [{
      key: "overview",
      label: "Overview",
      content: (p) =>
        `## Overview\n\n${
          p("overview")
        } gives the board the essential context before reviewing performance, risks and decisions required.`,
    }],
  },
  "quarterly-business-review": {
    purpose:
      "Shows a QBR that links metrics, interpretation and next-quarter priorities.",
    sections: [{
      key: "summary",
      label: "Summary",
      content: (p) =>
        `## Summary\n\n${
          p("summary")
        } summarises the quarter in commercial terms, identifying what changed, why it matters and what should happen next.`,
    }],
  },
  "risk-assessment": {
    purpose:
      "Shows a risk assessment that makes likelihood, impact, controls and ownership visible.",
    sections: [{
      key: "context",
      label: "Context",
      content: (p) =>
        `## Context\n\nThis assessment covers ${
          p("context")
        } and evaluates material risks using confirmed context, ratings, controls and review responsibilities.`,
    }],
  },
  "financial-review": {
    purpose:
      "Shows a financial review that turns figures into concise management interpretation.",
    sections: [{
      key: "summary",
      label: "Summary",
      content: (p) =>
        `## Summary\n\n${
          p("summary")
        } explains the financial position in plain language, separating confirmed results, drivers, risks and recommended actions.`,
    }],
  },
  "marketing-brief": {
    purpose:
      "Shows a marketing brief that aligns audience, message, deliverables and success measures.",
    sections: [{
      key: "objective",
      label: "Objective",
      content: (p) =>
        `## Objective\n\nThe marketing activity is intended to achieve ${
          p("objective")
        } and should be assessed against the audience, deliverables and success measures in this brief.`,
    }],
  },
  "grant-funding-proposal": {
    purpose:
      "Shows a grant proposal that links need, funded activities, outcomes and budget.",
    sections: [{
      key: "summary",
      label: "Summary",
      content: (p) =>
        `## Summary\n\nThis proposal seeks support for ${
          p("summary")
        } and explains the need, activities, expected outcomes and responsible budget use.`,
    }],
  },
  "scholarship-application": {
    purpose:
      "Shows a scholarship application that joins personal case, evidence and future impact.",
    sections: [{
      key: "profile",
      label: "Profile",
      content: (p) =>
        `## Profile\n\n${
          p("profile")
        } introduces the applicant with relevant background, achievement and purpose before setting out the case for support.`,
    }],
  },
  "statement-of-purpose": {
    purpose:
      "Shows a statement of purpose with academic focus, preparation, fit and direction.",
    sections: [{
      key: "focus",
      label: "Focus",
      content: (p) =>
        `## Focus\n\nMy purpose is centred on ${
          p("focus")
        }, supported by prior preparation, fit with the opportunity and a clear future direction.`,
    }],
  },
  "study-plan": {
    purpose:
      "Shows a study plan as a realistic schedule with accountability and outcomes.",
    sections: [{
      key: "goal",
      label: "Goal",
      content: (p) =>
        `## Goal\n\nThe study plan is designed to achieve ${
          p("goal")
        } through a realistic schedule, defined milestones and accountability checks.`,
    }],
  },
  "research-proposal": {
    purpose:
      "Shows a research proposal that makes the question, method and contribution explicit.",
    sections: [{
      key: "title_question",
      label: "Title and Research Question",
      content: (p) =>
        `## Title and Research Question\n\n${
          p("title_question")
        } establishes the research focus and gives the methodology, background and contribution a clear anchor.`,
    }],
  },
  "literature-review": {
    purpose:
      "Shows a literature review that synthesises themes and identifies the gap.",
    sections: [{
      key: "scope",
      label: "Scope",
      content: (p) =>
        `## Scope\n\nThis review examines ${
          p("scope")
        } and organises the literature into themes, tensions and the remaining gap.`,
    }],
  },
  "academic-appeal-letter": {
    purpose:
      "Shows an academic appeal that is factual, respectful and outcome-specific.",
    sections: [{
      key: "decision",
      label: "Decision Being Appealed",
      content: (p) =>
        `## Decision Being Appealed\n\nI am appealing ${
          p("decision")
        } and have set out the grounds, explanation and requested outcome below.`,
    }],
  },
  "extension-request-letter": {
    purpose:
      "Shows an extension request that is specific, proportionate and administratively clear.",
    sections: [{
      key: "request",
      label: "Request",
      content: (p) =>
        `## Request\n\nI am requesting ${
          p("request")
        } and have provided the reason, proposed date and supporting context for consideration.`,
    }],
  },
  "student-support-plan": {
    purpose:
      "Shows a student support plan that connects needs to practical actions and ownership.",
    sections: [{
      key: "context",
      label: "Context",
      content: (p) =>
        `## Context\n\nThis support plan is prepared for ${
          p("context")
        } and links strengths, needs and actions to practical support arrangements.`,
    }],
  },
  "course-comparison-matrix": {
    purpose:
      "Shows a course comparison that makes options, criteria and recommendation traceable.",
    sections: [{
      key: "options",
      label: "Options",
      content: (p) =>
        `## Options\n\nThe comparison considers ${
          p("options")
        } against agreed criteria so the final recommendation is transparent and evidence-based.`,
    }],
  },
  "academic-reference-request": {
    purpose:
      "Shows an academic reference request with context, application details and a courteous close.",
    sections: [{
      key: "request",
      label: "Request",
      content: (p) =>
        `## Request\n\nI am asking whether you would be willing to provide ${
          p("request")
        } and have included the relevant application context below.`,
    }],
  },
  "profit-and-loss-statement": {
    purpose:
      "Shows a P&L statement summary that connects revenue, costs and net result.",
    sections: [{
      key: "revenue",
      label: "Revenue",
      content: (p) =>
        `## Revenue\n\nRevenue for the period is recorded from ${
          p("revenue")
        } and forms the basis for gross profit, operating expenses and net profit analysis.`,
    }],
  },
  "forecasted-earnings": {
    purpose:
      "Shows forecasted earnings with assumptions, figures and risks separated.",
    sections: [{
      key: "basis",
      label: "Forecast Basis",
      content: (p) =>
        `## Forecast Basis\n\nThe forecast is based on ${
          p("basis")
        }, with earnings estimates and key risks stated separately from confirmed historical figures.`,
    }],
  },
  "ebitda-analysis": {
    purpose:
      "Shows EBITDA analysis with source result, reconciliation and limitations visible.",
    sections: [{
      key: "source_result",
      label: "Source Result",
      content: (p) =>
        `## Source Result\n\nThe analysis starts from ${
          p("source_result")
        } and reconciles adjustments transparently before presenting EBITDA and limitations.`,
    }],
  },
  "investment-capital-gains-report": {
    purpose:
      "Shows a capital gains report with coverage, transactions and calculations separated.",
    sections: [{
      key: "coverage",
      label: "Coverage",
      content: (p) =>
        `## Coverage\n\nThis report covers ${
          p("coverage")
        } and summarises relevant transactions, calculations and resulting capital gains position.`,
    }],
  },
  "quote-estimate": {
    purpose:
      "Shows a quote or estimate that is commercially clear and acceptance-ready.",
    sections: [{
      key: "pricing",
      label: "Pricing",
      content: (p) =>
        `## Pricing\n\nThe estimated price for the requested work is ${
          p("pricing")
        }, subject to the stated terms, assumptions and validity period.`,
    }],
  },
  "invoice": {
    purpose:
      "Shows an invoice with identity, billable items and payment instructions clear.",
    sections: [{
      key: "items",
      label: "Items",
      content: (p) =>
        `## Items\n\nThe invoice charges for ${
          p("items")
        } and records the payment details required for settlement by the due date.`,
    }],
  },
  "purchase-order": {
    purpose:
      "Shows a purchase order that confirms what is ordered and on what terms.",
    sections: [{
      key: "order",
      label: "Order",
      content: (p) =>
        `## Order\n\nThis purchase order confirms ${
          p("order")
        } and authorises the listed items under the stated delivery and payment terms.`,
    }],
  },
  "cash-flow-forecast": {
    purpose:
      "Shows a cash-flow forecast with assumptions, inflows, outflows and closing position.",
    sections: [{
      key: "basis",
      label: "Basis",
      content: (p) =>
        `## Basis\n\nThe cash-flow forecast is prepared from ${
          p("basis")
        } and separates expected movements from the resulting cash position.`,
    }],
  },
  "expense-claim": {
    purpose:
      "Shows an expense claim with claimant, expense evidence and approval path clear.",
    sections: [{
      key: "claim",
      label: "Claim",
      content: (p) =>
        `## Claim\n\nThis expense claim is submitted for ${
          p("claim")
        } and should be reviewed against the attached evidence and approval requirements.`,
    }],
  },
  "project-plan": {
    purpose:
      "Shows a project plan that defines foundation, delivery and control discipline.",
    sections: [{
      key: "foundation",
      label: "Foundation",
      content: (p) =>
        `## Foundation\n\nThe project plan is built around ${
          p("foundation")
        } and establishes the delivery approach, controls and responsibilities required for execution.`,
    }],
  },
  "project-status-report": {
    purpose:
      "Shows a status report that states current position, progress and attention needed.",
    sections: [{
      key: "status",
      label: "Status",
      content: (p) =>
        `## Status\n\nThe project is currently ${
          p("status")
        }, with progress, blockers and decisions requiring attention separated for fast review.`,
    }],
  },
  "meeting-agenda": {
    purpose:
      "Shows an agenda that makes meeting purpose, topics and desired outcomes explicit.",
    sections: [{
      key: "details",
      label: "Details",
      content: (p) =>
        `## Details\n\nThis meeting is scheduled for ${
          p("details")
        } and is organised around agenda items with clear intended outcomes.`,
    }],
  },
  "action-register": {
    purpose: "Shows an action register as accountable execution tracking.",
    sections: [{
      key: "register",
      label: "Register",
      content: (p) =>
        `## Register\n\nThe register records ${
          p("register")
        } with owners, due dates, status and evidence so follow-up is unambiguous.`,
    }],
  },
  "decision-log": {
    purpose:
      "Shows a decision log that preserves what was decided, why and by whom.",
    sections: [{
      key: "decisions",
      label: "Decisions",
      content: (p) =>
        `## Decisions\n\n${
          p("decisions")
        } records each confirmed decision, the rationale relied on and any follow-up required.`,
    }],
  },
  "handover-document": {
    purpose:
      "Shows a handover document that makes continuity, risks and open work clear.",
    sections: [{
      key: "scope",
      label: "Scope",
      content: (p) =>
        `## Scope\n\nThis handover covers ${
          p("scope")
        } and explains the current operating state, key risks and tasks requiring attention.`,
    }],
  },
  "change-request": {
    purpose:
      "Shows a change request with request, impact and control path visible.",
    sections: [{
      key: "request",
      label: "Request",
      content: (p) =>
        `## Request\n\nThe requested change is ${
          p("request")
        } and should be assessed for impact, approval path and implementation control before proceeding.`,
    }],
  },
  "leave-availability-request": {
    purpose:
      "Shows a leave request that includes availability, handover and approval needs.",
    sections: [{
      key: "request",
      label: "Request",
      content: (p) =>
        `## Request\n\nI am requesting ${
          p("request")
        } and have outlined availability, handover arrangements and any approval information required.`,
    }],
  },
  "performance-improvement-plan": {
    purpose:
      "Shows a PIP as clear expectations, support and review rather than punitive ambiguity.",
    sections: [{
      key: "expectations",
      label: "Expectations",
      content: (p) =>
        `## Expectations\n\nThe improvement plan sets out ${
          p("expectations")
        } with measurable standards, support actions and review dates.`,
    }],
  },
  "training-plan-skills-matrix": {
    purpose:
      "Shows a training matrix that connects role requirements to current capability and actions.",
    sections: [{
      key: "requirements",
      label: "Requirements",
      content: (p) =>
        `## Requirements\n\nThe plan identifies ${
          p("requirements")
        } and maps current capability, training actions and evidence of completion against those requirements.`,
    }],
  },
  "incident-near-miss-report": {
    purpose:
      "Shows an incident report that separates facts, response and follow-up controls.",
    sections: [{
      key: "details",
      label: "Details",
      content: (p) =>
        `## Details\n\nThis report records ${
          p("details")
        } and distinguishes confirmed facts from response actions and required follow-up.`,
    }],
  },
  "asset-register-maintenance-log": {
    purpose:
      "Shows an asset register that tracks condition, maintenance and accountability.",
    sections: [{
      key: "assets",
      label: "Assets",
      content: (p) =>
        `## Assets\n\nThe register covers ${
          p("assets")
        } and records condition, maintenance history and responsibility for each item.`,
    }],
  },
  "stocktake-inventory-count": {
    purpose:
      "Shows a stocktake record that supports reconciliation and review.",
    sections: [{
      key: "count",
      label: "Count",
      content: (p) =>
        `## Count\n\nThe count records ${
          p("count")
        } and supports review of variances, evidence and required follow-up actions.`,
    }],
  },
  "business-case": {
    purpose:
      "Shows a business case that compares options and leads to a supported recommendation.",
    sections: [{
      key: "case",
      label: "Case",
      content: (p) =>
        `## Case\n\nThe business case is based on ${
          p("case")
        } and evaluates options, benefits, risks and the recommended decision.`,
    }],
  },
  "customer-feedback-summary": {
    purpose:
      "Shows feedback as synthesised findings and actions, not raw comments.",
    sections: [{
      key: "findings",
      label: "Findings",
      content: (p) =>
        `## Findings\n\n${
          p("findings")
        } summarises the feedback themes, supporting evidence and actions that should follow.`,
    }],
  },
  "competitor-comparison": {
    purpose:
      "Shows competitor comparison with scope, criteria and recommendation traceable.",
    sections: [{
      key: "scope",
      label: "Scope",
      content: (p) =>
        `## Scope\n\nThis comparison covers ${
          p("scope")
        } and assesses competitors against the agreed criteria before making a recommendation.`,
    }],
  },
  "timesheet": {
    purpose:
      "Shows a timesheet that records period, entries and totals for approval.",
    sections: [{
      key: "period",
      label: "Period",
      content: (p) =>
        `## Period\n\nThis timesheet covers ${
          p("period")
        } and records entries, totals and approval information for the stated work period.`,
    }],
  },
  "staff-roster": {
    purpose: "Shows a roster that balances coverage, constraints and checks.",
    sections: [{
      key: "basis",
      label: "Basis",
      content: (p) =>
        `## Basis\n\nThe roster is prepared from ${
          p("basis")
        } and checks coverage, availability and role requirements before publication.`,
    }],
  },
  "moving-house-checklist": {
    purpose: "Shows a moving checklist as practical, sequenced action items.",
    sections: [{
      key: "items",
      label: "Items",
      content: (p) =>
        `## Items\n\nThe checklist includes ${
          p("items")
        } and sequences tasks so preparation, moving day and post-move follow-up are easy to track.`,
    }],
  },
  "new-tenancy-checklist": {
    purpose:
      "Shows a tenancy checklist that helps confirm readiness, evidence and obligations.",
    sections: [{
      key: "items",
      label: "Items",
      content: (p) =>
        `## Items\n\nThe tenancy checklist records ${
          p("items")
        } and supports inspection, evidence capture, payments, utilities and key handover.`,
    }],
  },
  "complaint-letter": {
    purpose:
      "Shows a complaint letter that is firm, factual and resolution-focused.",
    sections: [{
      key: "issue",
      label: "Issue",
      content: (p) =>
        `## Issue\n\nI am writing about ${
          p("issue")
        } and have set out the impact, requested resolution and supporting facts clearly below.`,
    }],
  },
  "insurance-claim-letter": {
    purpose:
      "Shows an insurance claim letter with policy, incident, loss and request clear.",
    sections: [{
      key: "incident",
      label: "Incident",
      content: (p) =>
        `## Incident\n\nThe claim relates to ${
          p("incident")
        } and is supported by the policy details, loss information and documents provided.`,
    }],
  },
  "client-engagement-letter": {
    purpose:
      "Shows an engagement letter that defines scope, fees, responsibilities and terms.",
    sections: [{
      key: "scope",
      label: "Scope",
      content: (p) =>
        `## Scope\n\nThis engagement covers ${
          p("scope")
        } and sets out the fees, responsibilities and terms that govern the work.`,
    }],
  },
  "non-disclosure-agreement": {
    purpose:
      "Shows an NDA with parties, protected information, obligations and term explicit.",
    sections: [{
      key: "parties",
      label: "Parties",
      content: (p) =>
        `## Parties\n\nThis agreement is between ${
          p("parties")
        } and governs the handling of confidential information described in the following sections.`,
    }],
  },
  "research-report": {
    purpose:
      "Shows a research report that moves from method to findings, analysis and conclusion.",
    sections: [{
      key: "findings",
      label: "Findings",
      content: (p) =>
        `## Findings\n\n${
          p("findings")
        } presents the confirmed research results before interpreting their meaning, limitations and conclusion.`,
    }],
  },
};

function authoredExampleFinalWordingFor(
  key: string,
  label: string,
  informationContract: DocumentInformationContract,
  authored: AuthoredFinalWordingExampleTemplate,
): DocumentFinalWordingExample {
  const writePlaceholder: AuthoredExamplePlaceholderWriter = (
    sectionKey,
    informationKey,
  ) => {
    const section = informationContract.sections.find((candidate) =>
      candidate.sectionKey === sectionKey
    );
    if (!section) {
      throw new Error(
        `${key}: authored example uses unknown section ${sectionKey}`,
      );
    }
    const item = informationKey
      ? section.requiredInformation.find((candidate) =>
        candidate.key === informationKey
      )
      : section.requiredInformation[0];
    if (!item) {
      throw new Error(
        `${key}: authored example uses unknown placeholder ${sectionKey}.${
          informationKey ?? "<first-required>"
        }`,
      );
    }
    return createDocumentPlaceholderToken(
      `${key}.${section.sectionKey}.${item.key}`,
      item.placeholderLabel,
    );
  };

  return {
    source: "enhanced-dip-information-contract",
    purpose:
      `${authored.purpose} This is the canonical authored final-wording example for ${label}.`,
    sections: authored.sections.map((section) => ({
      key: section.key,
      label: section.label,
      content: section.content(writePlaceholder),
    })),
  };
}

function exampleFinalWordingFor(
  key: string,
  label: string,
  outputStructure: readonly string[],
  informationContract?: DocumentInformationContract,
): DocumentFinalWordingExample {
  const contractSections = informationContract?.sections ?? [];
  const sections = contractSections.length > 0
    ? contractSections.map((section) => {
      const sectionLabel = exampleSectionLabel(
        section.sectionKey,
        outputStructure,
      );
      const placeholders = section.requiredInformation.slice(0, 5).map((
        item,
      ) =>
        createDocumentPlaceholderToken(
          `${key}.${section.sectionKey}.${item.key}`,
          item.placeholderLabel,
        )
      );
      return {
        key: section.sectionKey,
        label: sectionLabel,
        content: `## ${sectionLabel}\n\n${
          exampleSentenceFor(sectionLabel, placeholders)
        }`,
      };
    })
    : outputStructure.map((section, index) => {
      const sectionKey = fixtureSafeId(section).replaceAll("-", "_") ||
        `section_${index + 1}`;
      return {
        key: sectionKey,
        label: section,
        content:
          `## ${section}\n\nThis ${section.toLowerCase()} section is written in complete final wording using only confirmed source facts and any safe professional assumptions allowed by the profile.`,
      };
    });

  return {
    source: "enhanced-dip-information-contract",
    purpose:
      `Canonical example of final ${label} wording with TED interactive placeholders at unresolved contract facts.`,
    sections,
  };
}

function completeProfile(
  spec: CatalogueProfileSpec,
): DocumentIntelligenceProfile {
  const [key, label, domain] = spec;
  const authoredKey = PROFILE_ALIASES[key] ?? key;
  const authored = AUTHORED_DIPS.find((profile) => profile.key === authoredKey);
  const structure = SPECIAL_STRUCTURES[key] ??
    authored?.outputStructure ??
    [
      "document purpose and context",
      "required core content in conventional order",
      "evidence and supporting detail",
      "decisions, actions or conclusion",
      "limitations and next steps where relevant",
    ];
  const factualProhibitions = [
    `Never invent names, organisations, dates, amounts, metrics, qualifications, achievements, events, approvals, legal status, source findings or other factual details in the ${label}.`,
    "If a vital fact is unavailable, preserve complete final wording and use the declared interactive placeholder or approved neutral replacement; never invent the fact.",
  ];
  const informationContract = authored?.informationContract ??
    workplaceGovernanceInformationContractFor(key);
  const quality: DocumentQualityContract = authored?.quality ?? {
    requiredStructure: structure,
    lengthAndDepth: [
      `Use the conventional length for a real-world ${label}; include enough detail to fulfil its purpose without repetition or filler.`,
    ],
    evidenceRequirements: [
      "Bind every factual statement, calculation and conclusion to user-supplied information, an uploaded source, a deterministic calculation or a clearly cited authoritative source.",
      "Keep confirmed facts, estimates, recommendations and unknowns visibly distinct.",
    ],
    toneAndWording: [
      "Use natural, audience-appropriate professional wording and final prose rather than drafting instructions, commentary, raw Markdown or undeclared placeholders.",
    ],
    intentRelevance: [
      `Tailor the ${label} to the user's stated goal, audience, context and desired outcome; omit irrelevant boilerplate.`,
    ],
    prohibitedInventions: factualProhibitions,
    submitReadyChecks: [
      "Check names, dates, amounts, calculations, section order, consistency, spelling and formatting.",
      "Return complete final wording around any declared interactive placeholders; never discard or withhold the document solely because a vital fact remains unresolved.",
    ],
  };

  return {
    key,
    label,
    matches: Array.from(
      new Set([
        key.replaceAll("-", " "),
        label.toLowerCase(),
        ...(authored?.matches ?? []),
      ]),
    ),
    domains: Array.from(new Set([domain, ...(authored?.domains ?? [])])),
    requiredInformation: authored?.requiredInformation ??
      ["purpose", "audience", "confirmed facts needed by the document"],
    highValueInformation: authored?.highValueInformation ??
      [
        "source documents",
        "desired outcome",
        "constraints",
        "preferred tone or format",
      ],
    clarificationQuestions: authored?.clarificationQuestions ??
      [`What must this ${label} achieve, who will use it, and which confirmed facts or source files should it rely on?`],
    recommendedUploads: authored?.recommendedUploads ??
      ["relevant source documents, records or prior versions"],
    inferableInformation: authored?.inferableInformation ??
      [
        "conventional section order",
        "professional formatting",
        "neutral connective wording",
      ],
    riskChecks: authored?.riskChecks ??
      [
        "all factual details are traceable",
        "calculations reconcile",
        "unknowns are explicit",
        "wording does not overstate certainty",
      ],
    outputStructure: structure,
    quality,
    proofFixtures: authored?.proofFixtures ??
      genericProofFixturesFor(
        key,
        label,
        domain,
        authored?.requiredInformation ??
          ["purpose", "audience", "confirmed facts needed by the document"],
        structure,
        authored?.riskChecks ?? [
          "all factual details are traceable",
          "unknowns are explicit",
        ],
        informationContract,
      ),
    exampleFinalWording: authored?.exampleFinalWording ??
      (informationContract && AUTHORED_EXAMPLE_FINAL_WORDING[key]
        ? authoredExampleFinalWordingFor(
          key,
          label,
          informationContract,
          AUTHORED_EXAMPLE_FINAL_WORDING[key],
        )
        : exampleFinalWordingFor(key, label, structure, informationContract)),
    informationContract,
    internalReview: authored?.internalReview ??
      workplaceGovernanceInternalReviewFor(key),
    benchmarks: authored?.benchmarks?.length
      ? authored.benchmarks
      : [benchmarkFor(domain), GOVERNMENT_STYLE_BENCHMARK],
  };
}

export const DIPS: DocumentIntelligenceProfile[] = EXTENDED_CATALOGUE.map(
  completeProfile,
);

/** Pick the best profile from a free-text hint, falling back to the domain. */
export function selectProfile(
  hint: string,
  domain?: string,
): DocumentIntelligenceProfile | null {
  const h = (hint || "").toLowerCase();
  const explicitLines = new Set(
    h.split(/\n+/).map((line) => line.trim()).filter(Boolean),
  );
  for (const profile of DIPS) {
    if (
      explicitLines.has(profile.key.toLowerCase()) ||
      explicitLines.has(profile.label.toLowerCase())
    ) return profile;
  }
  let best: DocumentIntelligenceProfile | null = null;
  let bestScore = 0;
  for (const p of DIPS) {
    let score = 0;
    for (const kw of p.matches) if (kw && h.includes(kw)) score++;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  if (best) return best;
  if (domain) {
    const d = domain.toLowerCase();
    for (const p of DIPS) if (p.domains.includes(d)) return p;
  }
  return null;
}

/** Render a profile into instruction text for the relevant task. */
export function renderProfile(
  p: DocumentIntelligenceProfile,
  task: string,
): string {
  const asks = task === "intent" || task === "clarify" || task === "recommend";
  const writes = task === "document" || task === "checklist";
  const explains = task === "explain";
  const lines: string[] = [
    `DOCUMENT INTELLIGENCE PROFILE — ${p.label}`,
    "Principle: ask the MINIMUM questions for the MAXIMUM quality. First use everything already available (profile, past conversations, uploaded files, resume, business profile, prior outputs); then ask only the highest-value MISSING items — never show a form, keep it conversational, one or two at a time, and prefer to infer over ask.",
    "UNIVERSAL PLACEHOLDER RULES",
    ...UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES.map((rule) => `- ${rule}`),
    "- Required information: " + p.requiredInformation.join("; "),
    "- High-value information (lifts quality): " +
    p.highValueInformation.join("; "),
  ];
  if (p.informationContract) {
    const contractErrors = validateDocumentInformationContract(
      p.key,
      p.informationContract,
    );
    if (contractErrors.length) {
      throw new Error(
        `INVALID_DOCUMENT_INFORMATION_CONTRACT:${p.key}:${
          contractErrors.join("|")
        }`,
      );
    }
    lines.push(
      `TEMPLATE INFORMATION CONTRACT — status ${p.informationContract.status}`,
    );
    for (const section of p.informationContract.sections) {
      lines.push(`SECTION INFORMATION CONTRACT — ${section.sectionKey}`);
      if (section.requiredInformation.length === 0) {
        lines.push("- required facts: none");
      }
      for (const item of section.requiredInformation) {
        const replacements = item.neutralReplacementOptions.length
          ? item.neutralReplacementOptions.map((option) =>
            `${option.id} => ${option.value} [${option.suitability}; clears_export_warning=${option.clearsExportWarning}; regenerate_surrounding_wording=${option.regenerateSurroundingWording}]`
          ).join(" | ")
          : "<none>";
        lines.push(
          `- information_key=${item.key}; label=${item.label}; fact_type=${item.factType}; placeholder_label=${item.placeholderLabel}; question=${item.question}; automatic_fallback=${
            item.automaticFallback ?? "<none>"
          }; required_for_export=${item.requiredForExport}; shared_resolution_key=${
            item.sharedResolutionKey ?? "<none>"
          }; neutral_replacements=${replacements}`,
        );
      }
      lines.push(
        `- optional facts: ${section.optionalInformation.join(", ") || "none"}`,
      );
    }
  }
  if (asks) {
    lines.push(
      "- Best clarifying questions to draw from: " +
        p.clarificationQuestions.join(" | "),
    );
    if (p.recommendedUploads.length) {
      lines.push(
        "- Helpful uploads to suggest (only when they would materially improve the result; let the user upload, skip, or generate now): " +
          p.recommendedUploads.join("; "),
      );
    }
  }
  lines.push(
    "- Infer, don't ask (derive from context where possible): " +
      p.inferableInformation.join("; "),
  );
  lines.push(
    "- Risk & quality checks before finishing: " + p.riskChecks.join("; "),
  );
  if (writes || explains) {
    lines.push(
      "- Recommended output structure: " + p.outputStructure.join(" \u2192 "),
    );
  }
  if (p.quality) {
    lines.push(
      "FINAL DOCUMENT QUALITY GATE — compare the completed document against every rule below before returning it. Rewrite failed sections; do not merely describe the failure.",
      "REQUIRED STRUCTURE AND SECTION ORDER",
      ...p.quality.requiredStructure.map((item) => `- ${item}`),
      "APPROPRIATE LENGTH AND DEPTH",
      ...p.quality.lengthAndDepth.map((item) => `- ${item}`),
      "SPECIFIC EVIDENCE REQUIREMENTS",
      ...p.quality.evidenceRequirements.map((item) => `- ${item}`),
      "PROFESSIONAL TONE AND NATURAL FINAL WORDING",
      ...p.quality.toneAndWording.map((item) => `- ${item}`),
      "RELEVANCE TO THE USER'S INTENT",
      ...p.quality.intentRelevance.map((item) => `- ${item}`),
      "PROHIBITED INVENTIONS",
      ...p.quality.prohibitedInventions.map((item) => `- ${item}`),
      "GENUINELY READY TO SUBMIT",
      ...p.quality.submitReadyChecks.map((item) => `- ${item}`),
    );
  }
  if (p.benchmarks?.length) {
    lines.push(
      "REAL-WORLD BENCHMARKS — use these as quality references for structure, depth, detail, formality and usability; never copy wording or invent facts to resemble an example.",
      ...p.benchmarks.map((benchmark) =>
        `- ${benchmark.authority}: ${benchmark.title} (${benchmark.url}) — compare ${
          benchmark.appliesTo.join(", ")
        }${
          benchmark.acceptanceSignals?.length
            ? `. Observable acceptance signals: ${
              benchmark.acceptanceSignals.join("; ")
            }`
            : ""
        }`
      ),
    );
  }
  if (writes && p.exampleFinalWording?.sections.length) {
    lines.push(
      "CONTRACT-BACKED EXAMPLE FINAL WORDING — use this as a structural and placeholder-placement pattern only. Do not copy facts from it unless they appear in the user's source material.",
      p.exampleFinalWording.purpose,
      ...p.exampleFinalWording.sections.map((section) => section.content),
    );
  }
  return lines.join("\n");
}

export function auditProfilePlaceholderRules(
  profile: DocumentIntelligenceProfile,
): string[] {
  return findContradictoryPlaceholderRules([
    ...profile.riskChecks,
    ...(profile.quality?.requiredStructure ?? []),
    ...(profile.quality?.lengthAndDepth ?? []),
    ...(profile.quality?.evidenceRequirements ?? []),
    ...(profile.quality?.toneAndWording ?? []),
    ...(profile.quality?.intentRelevance ?? []),
    ...(profile.quality?.prohibitedInventions ?? []),
    ...(profile.quality?.submitReadyChecks ?? []),
  ]);
}
