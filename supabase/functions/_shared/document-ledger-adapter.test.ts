import assert from "node:assert/strict";
import { validateDocumentGenerationLedger } from "../../../packages/shared/src/document-ledger.ts";
import {
  auditCatalogueProfileSectionKeys,
  type CatalogueTemplateInput,
  compileDocumentLedgerShadow,
  compileTemplateLedgerEntry,
} from "./document-ledger-adapter.ts";
import { DIPS } from "./document-intelligence-profiles.ts";
import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};

const catalogue = [...coreTemplates, ...phase2Templates];

Deno.test("shadow compiler produces a valid versioned resume pilot without changing runtime output", () => {
  const ledger = compileDocumentLedgerShadow(["resume"]);
  const resume = ledger.templates.resume;

  assert.ok(resume);
  assert.equal(ledger.schemaVersion, "1.0.0");
  assert.equal(ledger.ledgerVersion, "2026-08-24.shadow.1");
  assert.equal(resume.lifecycle.status, "draft");
  assert.deepEqual(
    resume.sections.map((section) => section.sectionKey),
    [
      "contact_details",
      "summary",
      "experience",
      "education",
      "skills",
      "referees",
    ],
  );
  assert.deepEqual(validateDocumentGenerationLedger(ledger), []);
});

Deno.test("shadow compiler maps DIP facts to stable scoped inputs and affected sections", () => {
  const ledger = compileDocumentLedgerShadow(["resume"]);
  const resume = ledger.templates.resume;
  assert.ok(resume);

  const fullName = resume.requiredInputs.find((input) =>
    input.key === "contact_details.full_name"
  );
  assert.ok(fullName);
  assert.equal(fullName.mayInfer, false);
  assert.deepEqual(fullName.clarification.blocksSections, ["contact_details"]);
  assert.equal(fullName.clarification.blocksExport, true);
  assert.equal(
    fullName.clarification.fallbackIfUserSkips,
    "interactivePlaceholder",
  );
  assert.equal(
    resume.sections[0]?.dependsOnInputs.includes(fullName.key),
    true,
  );
});

Deno.test("shadow compiler fails closed when catalogue and DIP section keys diverge", async () => {
  const template = catalogue.find((candidate) => candidate.slug === "resume");
  const profile = DIPS.find((candidate) => candidate.key === "resume");
  assert.ok(template);
  assert.ok(profile);

  await assert.rejects(
    () =>
      Promise.resolve().then(() =>
        compileTemplateLedgerEntry(
          {
            ...template,
            sections: template.sections.slice(0, -1),
          } as CatalogueTemplateInput,
          profile,
          "2026-08-24.shadow.1",
        )
      ),
    /SECTION_KEY_MISMATCH/,
  );
});

Deno.test("catalogue/profile mismatch inventory remains explicit and deterministic", () => {
  const mismatches = auditCatalogueProfileSectionKeys();

  assert.equal(mismatches.length, 18);
  for (const mismatch of mismatches) {
    assert.ok(mismatch.templateId.length > 0);
    assert.ok(mismatch.catalogueSectionKeys.length > 0);
    assert.ok(mismatch.profileSectionKeys.length > 0);
  }
});

Deno.test("shadow compiler covers the five representative pilot categories", () => {
  const pilotIds = [
    "resume",
    "selection-criteria-response",
    "moving-house-checklist",
    "complaint-letter",
    "incident-near-miss-report",
  ];

  const ledger = compileDocumentLedgerShadow(pilotIds);

  assert.deepEqual(Object.keys(ledger.templates), pilotIds);
  for (const template of Object.values(ledger.templates)) {
    assert.equal(template.lifecycle.status, "draft");
    assert.ok(template.sections.length > 0);
    assert.equal(template.testCases.length, 3);
  }
  assert.equal(
    ledger.templates["incident-near-miss-report"]?.riskLevel,
    "high_risk",
  );
  assert.deepEqual(validateDocumentGenerationLedger(ledger), []);
});
