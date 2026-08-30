import { DIPS, EXTENDED_CATALOGUE } from "./document-intelligence-profiles.ts";
import {
  type DocumentCertificationFixture,
  validateCertificationFixtureSet,
} from "./document-certification.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("all 86 catalogue templates have three behavioural certification fixtures", () => {
  assert(
    EXTENDED_CATALOGUE.length === 86,
    `expected 86 catalogue templates, received ${EXTENDED_CATALOGUE.length}`,
  );

  const failures: string[] = [];
  for (const [templateKey] of EXTENDED_CATALOGUE) {
    const profile = DIPS.find((candidate) => candidate.key === templateKey);
    if (!profile) {
      failures.push(`${templateKey}: intelligence profile missing`);
      continue;
    }

    const fixtures: DocumentCertificationFixture[] = (profile.proofFixtures ??
      []).map((fixture) => ({ ...fixture, templateKey }));
    failures.push(...validateCertificationFixtureSet(templateKey, fixtures));
  }

  assert(
    failures.length === 0,
    `Document certification is incomplete:\n${
      failures.map((failure) => `- ${failure}`).join("\n")
    }`,
  );
});
