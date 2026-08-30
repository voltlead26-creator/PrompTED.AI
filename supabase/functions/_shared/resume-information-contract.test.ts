import { assert, assertEquals } from "jsr:@std/assert";
import {
  auditProfilePlaceholderRules,
  DIPS,
  renderProfile,
} from "./document-intelligence-profiles.ts";
import { validateDocumentInformationContract } from "./document-placeholder-policy.ts";
import { buildSystemPrompt } from "./prompt-builder.ts";
import templates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};

Deno.test("resume profile passes the strict information-contract gate", () => {
  const resume = DIPS.find((profile) => profile.key === "resume");
  assert(resume);
  assert(resume.informationContract);
  assertEquals(resume.informationContract.status, "complete");
  assertEquals(
    validateDocumentInformationContract(resume.key, resume.informationContract),
    [],
  );
  assertEquals(resume.internalReview?.status, "passed");
  assertEquals(
    resume.informationContract.sections.map((section) => section.sectionKey),
    [
      "contact_details",
      "summary",
      "experience",
      "education",
      "skills",
      "referees",
    ],
  );
});

Deno.test("resume information-contract sections match the canonical catalogue keys", () => {
  const resume = DIPS.find((profile) => profile.key === "resume");
  const template = templates.find((candidate) => candidate.slug === "resume");
  assert(resume?.informationContract);
  assert(template);
  assertEquals(
    resume.informationContract.sections.map((section) => section.sectionKey),
    template.sections.map((section) => section.key),
  );
});

Deno.test("resume profile contains no contradictory anti-placeholder rules", () => {
  const resume = DIPS.find((profile) => profile.key === "resume");
  assert(resume);
  assertEquals(auditProfilePlaceholderRules(resume), []);
});

Deno.test("resume contract explicitly declares neutral replacement options for every fact", () => {
  const resume = DIPS.find((profile) => profile.key === "resume");
  assert(resume?.informationContract);
  for (const section of resume.informationContract.sections) {
    for (const item of section.requiredInformation) {
      assert(Array.isArray(item.neutralReplacementOptions));
    }
  }
});

Deno.test("resume renderer consumes universal rules and the template contract", () => {
  const resume = DIPS.find((profile) => profile.key === "resume");
  assert(resume);
  const rendered = renderProfile(resume, "document");
  assert(rendered.includes("UNIVERSAL PLACEHOLDER RULES"));
  assert(rendered.includes("TEMPLATE INFORMATION CONTRACT — status complete"));
  assert(rendered.includes("Never blank, omit, discard"));
});

Deno.test("assembled Resume prompt uses conventional pronoun-free resume voice", () => {
  const prompt = buildSystemPrompt({
    task: "document",
    domain: "employment",
    profileHint: "resume",
  });
  assert(
    prompt.includes(
      "Resumes and CVs use concise implied-first-person wording without I/my pronouns.",
    ),
  );
  assert(!/Use "I" and "my"[^\n]*resumes\./.test(prompt));
});
