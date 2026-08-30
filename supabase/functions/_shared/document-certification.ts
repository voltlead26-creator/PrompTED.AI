export const CERTIFICATION_DIMENSIONS = [
  "complete",
  "factually_grounded",
  "correctly_structured",
  "appropriately_deep",
  "natural_final_wording",
  "tailored_to_situation",
  "no_instruction_scaffolding",
  "ready_for_real_world_use",
  "outcome_helpfulness",
] as const;

export type CertificationDimension = (typeof CERTIFICATION_DIMENSIONS)[number];

export type CertificationFixtureMode =
  | "sufficient-context"
  | "missing-vital"
  | "invention-pressure";

export interface DocumentCertificationFixture {
  id: string;
  templateKey: string;
  mode: CertificationFixtureMode;
  conversation: string;
  expectedFacts: Array<{ value: string; section: string }>;
  requiredMissingFacts: string[];
  forbiddenClaims: string[];
}

export interface DocumentCertificationInput {
  deterministicPassed: boolean;
  scores: Record<CertificationDimension, number>;
  minimumDimensionScore?: number;
  minimumAverageScore?: number;
}

export interface DocumentCertificationResult {
  passed: boolean;
  average: number;
  blockers: string[];
}

const REQUIRED_MODES: readonly CertificationFixtureMode[] = [
  "sufficient-context",
  "missing-vital",
  "invention-pressure",
];

export function validateCertificationFixtureSet(
  templateKey: string,
  fixtures: readonly DocumentCertificationFixture[],
): string[] {
  const issues: string[] = [];
  const relevant = fixtures.filter((fixture) => fixture.templateKey === templateKey);

  for (const mode of REQUIRED_MODES) {
    const matches = relevant.filter((fixture) => fixture.mode === mode);
    if (matches.length === 0) {
      issues.push(`${templateKey}: missing ${mode} certification fixture`);
    } else if (matches.length > 1) {
      issues.push(`${templateKey}: duplicate ${mode} certification fixtures`);
    }
  }

  if (relevant.length !== REQUIRED_MODES.length) {
    issues.push(
      `${templateKey}: expected exactly ${REQUIRED_MODES.length} certification fixtures, received ${relevant.length}`,
    );
  }

  const ids = new Set<string>();
  for (const fixture of relevant) {
    if (!fixture.id.trim()) issues.push(`${templateKey}: fixture id is blank`);
    if (ids.has(fixture.id)) issues.push(`${templateKey}: duplicate fixture id ${fixture.id}`);
    ids.add(fixture.id);

    if (fixture.conversation.trim().length < 80) {
      issues.push(`${fixture.id || templateKey}: conversation is too thin for certification`);
    }
    if (
      fixture.expectedFacts.length + fixture.requiredMissingFacts.length +
          fixture.forbiddenClaims.length ===
        0
    ) {
      issues.push(`${fixture.id || templateKey}: fixture has no evidence oracle`);
    }
  }

  return issues;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreDocumentCertification(
  input: DocumentCertificationInput,
): DocumentCertificationResult {
  const minimumDimensionScore = input.minimumDimensionScore ?? 8;
  const minimumAverageScore = input.minimumAverageScore ?? 8.5;
  const blockers: string[] = [];

  if (!input.deterministicPassed) {
    blockers.push("deterministic document proof failed");
  }

  let total = 0;
  for (const dimension of CERTIFICATION_DIMENSIONS) {
    const score = input.scores[dimension];
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      blockers.push(`${dimension}: invalid score ${String(score)}`);
      continue;
    }
    total += score;
    if (score < minimumDimensionScore) {
      blockers.push(
        `${dimension}: ${score} is below the ${minimumDimensionScore} certification floor`,
      );
    }
  }

  const average = round(total / CERTIFICATION_DIMENSIONS.length);
  if (average < minimumAverageScore) {
    blockers.push(
      `average quality score ${average} is below the ${minimumAverageScore} certification floor`,
    );
  }

  return {
    passed: blockers.length === 0,
    average,
    blockers,
  };
}
