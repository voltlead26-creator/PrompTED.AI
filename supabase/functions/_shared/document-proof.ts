import type {
  DocumentIntelligenceProfile,
  DocumentProofFixture,
} from "./document-intelligence-profiles.ts";

export interface DocumentProofSection {
  key: string;
  label: string;
  content: string;
  required: boolean;
}

export interface DocumentProofIssue {
  code:
    | "REQUIRED_SECTION_BLANK"
    | "FACT_MISSING_FROM_SECTION"
    | "MISSING_FACT_NOT_REPORTED"
    | "FORBIDDEN_CLAIM_PRESENT";
  detail: string;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ")
    .trim();
}

function matchesSection(
  section: DocumentProofSection,
  expectedDestination: string,
): boolean {
  const destinationTokens = new Set(normalise(expectedDestination).split(" "));
  const sectionTokens = new Set(normalise(`${section.key} ${section.label}`).split(" "));
  let shared = 0;
  for (const token of destinationTokens) {
    if (token.length >= 4 && sectionTokens.has(token)) shared += 1;
  }
  return shared >= 1;
}

export function evaluateDocumentProof(input: {
  profile: DocumentIntelligenceProfile;
  fixture: DocumentProofFixture;
  sections: DocumentProofSection[];
  reportedMissingFacts: string[];
}): { passed: boolean; issues: DocumentProofIssue[] } {
  const issues: DocumentProofIssue[] = [];
  const fullDocument = normalise(
    input.sections.map((section) => section.content).join("\n"),
  );

  for (const section of input.sections) {
    if (section.required && !section.content.trim()) {
      issues.push({
        code: "REQUIRED_SECTION_BLANK",
        detail: `${section.label} is blank`,
      });
    }
  }

  for (const expected of input.fixture.expectedFacts) {
    const matchingSections = input.sections.filter((section) =>
      matchesSection(section, expected.section)
    );
    const expectedValue = normalise(expected.value);
    if (
      matchingSections.length === 0 ||
      !matchingSections.some((section) =>
        normalise(section.content).includes(expectedValue)
      )
    ) {
      issues.push({
        code: "FACT_MISSING_FROM_SECTION",
        detail: `${expected.value} is missing from ${expected.section}`,
      });
    }
  }

  const reportedMissing = normalise(input.reportedMissingFacts.join("\n"));
  for (const requiredMissing of input.fixture.requiredMissingFacts) {
    if (!reportedMissing.includes(normalise(requiredMissing))) {
      issues.push({
        code: "MISSING_FACT_NOT_REPORTED",
        detail: `${requiredMissing} was not reported as missing`,
      });
    }
  }

  for (const forbiddenClaim of input.fixture.forbiddenClaims) {
    if (fullDocument.includes(normalise(forbiddenClaim))) {
      issues.push({
        code: "FORBIDDEN_CLAIM_PRESENT",
        detail: forbiddenClaim,
      });
    }
  }

  return { passed: issues.length === 0, issues };
}
