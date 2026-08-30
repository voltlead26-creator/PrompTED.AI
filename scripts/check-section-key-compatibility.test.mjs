import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_MATRIX_PATH,
  DEFAULT_REPOSITORY_ROOT,
  loadCurrentSectionKeyInventory,
  validateProposedSectionKeyCompatibilityMatrix,
} from "./check-section-key-compatibility.mjs";

const validMatrix = JSON.parse(readFileSync(DEFAULT_MATRIX_PATH, "utf8"));
const inventory = loadCurrentSectionKeyInventory(DEFAULT_REPOSITORY_ROOT);

function clone() {
  return structuredClone(validMatrix);
}

function issuesFor(matrix) {
  return validateProposedSectionKeyCompatibilityMatrix(
    matrix,
    inventory,
    DEFAULT_REPOSITORY_ROOT,
  );
}

function expectFailure(mutator, expectedText) {
  const matrix = clone();
  mutator(matrix);
  const issues = issuesFor(matrix);
  assert.ok(
    issues.some((issue) => issue.includes(expectedText)),
    `Expected an issue containing ${JSON.stringify(expectedText)}; got:\n${issues.join("\n")}`,
  );
}

test("accepts the owner-approved 86-profile, 18-conflict decision", () => {
  assert.deepEqual(issuesFor(validMatrix), []);
});

test("rejects a missing expected template", () => {
  expectFailure((matrix) => matrix.templates.pop(), "missing expected template");
});

test("rejects an unexpected template", () => {
  expectFailure((matrix) => {
    matrix.templates[matrix.templates.length - 1].templateId = "unexpected-template";
  }, "unexpected template");
});

test("rejects a duplicate template", () => {
  expectFailure((matrix) => {
    matrix.templates[1].templateId = matrix.templates[0].templateId;
  }, "duplicate templateId");
});

test("rejects an unaccounted catalogue key", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "business-email");
    for (const mapping of template.mappings) {
      mapping.legacyKeys = mapping.legacyKeys.filter((key) => key !== "subject");
    }
  }, "unaccounted catalogue key: subject");
});

test("rejects an unaccounted profile key", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "business-email");
    for (const mapping of template.mappings) {
      mapping.profileKeys = mapping.profileKeys.filter((key) => key !== "subject_and_greeting");
    }
  }, "unaccounted profile key: subject_and_greeting");
});

test("rejects an orphan proposed canonical key", () => {
  expectFailure((matrix) => {
    matrix.templates[0].proposedCanonicalSectionKeys.push("orphan_key");
  }, "orphan proposed canonical key: orphan_key");
});

test("rejects a missing rationale", () => {
  expectFailure((matrix) => {
    matrix.templates[0].mappings[0].semanticRationale = "";
  }, "semanticRationale must be non-empty");
});

test("rejects a nonexistent consumer path", () => {
  expectFailure((matrix) => {
    matrix.templates[0].consumers[0].path = "does/not/exist.ts";
  }, "path does not exist");
});

test("rejects a consumer path outside the repository", () => {
  expectFailure((matrix) => {
    matrix.templates[0].consumers[0].path = "/etc/passwd";
  }, "path does not exist");
});

test("rejects a split without a non-lossy preservation strategy", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "cover-letter");
    const split = template.mappings.find((mapping) => mapping.classification === "one_to_many_split");
    split.historicalContentStrategy = "";
  }, "split requires a non-lossy historicalContentStrategy");
});

test("rejects a merge without ordering or conflict handling", () => {
  const matrix = clone();
  const template = matrix.templates.find((entry) => entry.templateId === "promotion-case");
  const merge = template.mappings.find((mapping) => mapping.classification === "many_to_one_merge");
  merge.mergeStrategy.deterministicOrdering = [];
  merge.mergeStrategy.approvalConflictHandling = "";
  const issues = issuesFor(matrix);
  assert.ok(issues.some((issue) => issue.includes("merge requires deterministic ordering")));
  assert.ok(issues.some((issue) => issue.includes("merge requires approvalConflictHandling")));
});

test("rejects a merge without duplicate-content handling", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "promotion-case");
    const merge = template.mappings.find((mapping) => mapping.classification === "many_to_one_merge");
    merge.mergeStrategy.duplicateContentHandling = "";
  }, "merge requires duplicateContentHandling");
});

test("rejects a rename without historical-read support", () => {
  expectFailure((matrix) => {
    const rename = matrix.templates[0].mappings.find((mapping) => mapping.classification === "one_to_one_rename");
    rename.preserveHistoricalRead = false;
    rename.historicalReadStrategy = "";
  }, "rename requires historical-read support");
});

test("rejects an unresolved mapping without a question", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "interview-script");
    const candidateQuestions = template.mappings.find((mapping) =>
      mapping.profileKeys.includes("candidate_questions")
    );
    candidateQuestions.classification = "unresolved";
    candidateQuestions.unresolvedQuestions = [];
  }, "unresolved mapping requires an unresolved question");
});

test("rejects an owner-approved decision without exact approval metadata", () => {
  const matrix = clone();
  matrix.ownerApproval.status = "pending";
  matrix.ownerApproval.phaseL02Authorized = false;
  const issues = issuesFor(matrix);
  assert.ok(issues.some((issue) => issue.includes('ownerApproval.status must be "approved"')));
  assert.ok(issues.some((issue) => issue.includes("ownerApproval.phaseL02Authorized must be true")));
});

test("rejects an owner-approved decision without an authority policy", () => {
  expectFailure((matrix) => {
    matrix.approvedAuthority.decision = "";
  }, "approvedAuthority.decision must be non-empty");
});

test("rejects a new canonical section that claims a legacy key", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "interview-script");
    const candidateQuestions = template.mappings.find((mapping) =>
      mapping.profileKeys.includes("candidate_questions")
    );
    candidateQuestions.legacyKeys = ["stories"];
  }, "new canonical section must not claim a legacy key");
});

test("rejects a new canonical section without approved requiredness", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "interview-script");
    const closing = template.mappings.find((mapping) => mapping.profileKeys.includes("closing"));
    delete closing.newSectionPolicy.requiredness;
  }, "new canonical section requires approved requiredness");
});

test("rejects drift from the exact owner-approved requiredness", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "interview-script");
    const candidateQuestions = template.mappings.find((mapping) =>
      mapping.profileKeys.includes("candidate_questions")
    );
    candidateQuestions.newSectionPolicy.requiredness = "required";
  }, "approved requiredness must be optional");
});

test("rejects a new canonical section without owner approval", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "job-follow-up-email");
    const signOff = template.mappings.find((mapping) => mapping.profileKeys.includes("sign_off"));
    signOff.ownerDecisionStatus = "pending";
  }, "new canonical section requires recorded owner approval");
});

test("rejects a new canonical section with an unsafe historical strategy", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "job-follow-up-email");
    const signOff = template.mappings.find((mapping) => mapping.profileKeys.includes("sign_off"));
    signOff.newSectionPolicy.historicalContentStrategy = "Move content into the new section.";
  }, "new canonical section requires a non-lossy historical-content strategy");
});

test("rejects a jurisdiction-controlled section without approved jurisdiction authority", () => {
  expectFailure((matrix) => {
    const template = matrix.templates.find((entry) => entry.templateId === "terms-of-employment");
    const acknowledgement = template.mappings.find((mapping) =>
      mapping.profileKeys.includes("acknowledgement")
    );
    acknowledgement.newSectionPolicy.activationAuthority = "The model decides when useful.";
  }, "jurisdiction-controlled section requires approved jurisdiction authority");
});

test("rejects residual template-level unresolved questions after approval", () => {
  expectFailure((matrix) => {
    matrix.templates[0].unresolvedQuestions = ["Still pending"];
  }, "unresolvedQuestions must be empty after owner approval");
});

test("rejects ownerApprovalRequired false", () => {
  expectFailure((matrix) => {
    matrix.ownerApprovalRequired = false;
  }, "top-level ownerApprovalRequired must be true");
});

test("rejects a decision without the exact Bible-integrated adoption steps", () => {
  expectFailure((matrix) => {
    matrix.adoptionPlan.steps = matrix.adoptionPlan.steps.filter(
      (step) => step.id !== "L0.2",
    );
  }, "adoptionPlan.steps must contain exactly");
});

test("rejects decision provenance from a branch other than reliably-prompTED", () => {
  expectFailure((matrix) => {
    matrix.source.branch = "codex/reliably-prompted-architecture-rebuild";
  }, 'source.branch must be "reliably-prompTED"');
});

test("rejects premature CI or application-workflow authorization", () => {
  const matrix = clone();
  matrix.adoptionPlan.currentTestingPolicy.ciIntegrationAuthorized = true;
  matrix.adoptionPlan.currentTestingPolicy.applicationWorkflowExerciseAuthorized = true;
  const issues = issuesFor(matrix);
  assert.ok(
    issues.some((issue) =>
      issue.includes("currentTestingPolicy.ciIntegrationAuthorized must be false")
    ),
  );
  assert.ok(
    issues.some((issue) =>
      issue.includes("currentTestingPolicy.applicationWorkflowExerciseAuthorized must be false")
    ),
  );
});

test("rejects L0.2 evidence that claims live selection or adapter implementation", () => {
  const matrix = clone();
  matrix.adoptionPlan.l02Implementation.liveLedgerSelectionEnabled = true;
  matrix.adoptionPlan.l02Implementation.compatibilityAdaptersImplemented = true;
  const issues = issuesFor(matrix);
  assert.ok(issues.some((issue) =>
    issue.includes("l02Implementation.liveLedgerSelectionEnabled must be false")
  ));
  assert.ok(issues.some((issue) =>
    issue.includes("l02Implementation.compatibilityAdaptersImplemented must be false")
  ));
});

test("rejects false foundation lineage or hosted proof after bounded local placement", () => {
  const matrix = clone();
  matrix.adoptionPlan.foundationDependency.sameGitCommonDirectoryAsTargetWorktree = true;
  matrix.adoptionPlan.foundationDependency.locallyAppliedToTargetWorktree = false;
  matrix.adoptionPlan.foundationDependency.hostedCiVerified = true;
  matrix.adoptionPlan.foundationDependency.deployed = true;
  const issues = issuesFor(matrix);
  assert.ok(issues.some((issue) => issue.includes(
    "foundationDependency.sameGitCommonDirectoryAsTargetWorktree must be false",
  )));
  assert.ok(issues.some((issue) => issue.includes(
    "foundationDependency.locallyAppliedToTargetWorktree must be true",
  )));
  assert.ok(issues.some((issue) => issue.includes(
    "foundationDependency.hostedCiVerified must be false",
  )));
  assert.ok(issues.some((issue) => issue.includes(
    "foundationDependency.deployed must be false",
  )));
});

test("rejects an owner-approved decision that falsely claims live implementation", () => {
  expectFailure((matrix) => {
    matrix.liveMigrationImplemented = true;
  }, "liveMigrationImplemented must be false");
});
