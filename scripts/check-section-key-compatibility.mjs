#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const EXPECTED_CONFLICT_TEMPLATE_IDS = Object.freeze([
  "business-email",
  "cover-letter",
  "education-cover-letter",
  "induction-manual",
  "interview-prep-questions",
  "interview-script",
  "job-follow-up-email",
  "job-search-checklist",
  "offer-letter",
  "onboarding-checklist",
  "pay-rise-request",
  "personal-statement",
  "promotion-case",
  "reference-request",
  "resignation-letter",
  "sop",
  "terms-of-employment",
  "workplace-policy",
]);

const SUPPORTED_CLASSIFICATIONS = new Set([
  "unchanged",
  "one_to_one_rename",
  "one_to_many_split",
  "many_to_one_merge",
  "semantic_replacement",
  "legacy_alias_only",
  "new_canonical_section",
  "unresolved",
]);

const SUPPORTED_CONSUMER_ROLES = new Set([
  "producer",
  "validator",
  "renderer",
  "persistence",
  "workspace",
  "library",
  "export",
  "replay",
  "repair",
  "test",
  "fixture",
  "fallback",
]);

const EXPECTED_APPROVED_NEW_SECTION_REQUIREDNESS = new Map([
  ["interview-script:candidate_questions", "optional"],
  ["interview-script:closing", "optional"],
  ["job-follow-up-email:sign_off", "required"],
  ["terms-of-employment:acknowledgement", "jurisdiction_controlled"],
]);

const EXPECTED_ADOPTION_STEP_IDS = Object.freeze([
  "L0.1",
  "L0.1A",
  "F0",
  "L0.2",
  "L0.3",
  "L0.4",
  "L1",
  "L2",
  "L3",
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = resolve(scriptDirectory, "..");
export const DEFAULT_MATRIX_PATH = resolve(
  DEFAULT_REPOSITORY_ROOT,
  "docs/architecture/document-section-key-compatibility.proposed.json",
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function repositoryPathExists(repositoryRoot, path) {
  if (!nonEmptyString(path)) return false;
  const root = resolve(repositoryRoot);
  const candidate = resolve(root, path);
  return candidate.startsWith(`${root}${sep}`) && existsSync(candidate);
}

function loadCatalogue(repositoryRoot) {
  const cataloguePaths = [
    "packages/shared/src/templates/templates.data.json",
    "packages/shared/src/templates/phase2-templates.data.json",
  ];
  const templates = cataloguePaths.flatMap((path) =>
    readJson(resolve(repositoryRoot, path))
  );
  return { cataloguePaths, templates };
}

function loadProfilesWithDeno(repositoryRoot) {
  const source = [
    'import { DIPS } from "./supabase/functions/_shared/document-intelligence-profiles.ts";',
    "console.log(JSON.stringify(DIPS.map((profile) => ({",
    "  templateId: profile.key,",
    "  sectionKeys: (profile.informationContract?.sections ?? []).map((section) => section.sectionKey),",
    "  enhanced: Boolean(profile.informationContract && profile.internalReview?.status === 'passed'),",
    "}))));",
  ].join("\n");
  const result = spawnSync("deno", ["eval", source], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    throw new Error(`Unable to execute Deno profile inventory: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Deno profile inventory failed (${result.status}): ${result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

export function loadCurrentSectionKeyInventory(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
) {
  const { cataloguePaths, templates } = loadCatalogue(repositoryRoot);
  const profiles = loadProfilesWithDeno(repositoryRoot);
  const catalogueById = new Map(
    templates.map((template) => [
      template.slug,
      template.sections.map((section) => section.key),
    ]),
  );
  const profileById = new Map(
    profiles.map((profile) => [profile.templateId, profile.sectionKeys]),
  );
  const allTemplateIds = [...catalogueById.keys()].sort();
  const missingProfiles = allTemplateIds.filter((id) => !profileById.has(id));
  const orphanProfiles = [...profileById.keys()].filter((id) => !catalogueById.has(id));
  const conflicts = allTemplateIds.filter((id) => {
    const catalogueKeys = catalogueById.get(id) ?? [];
    const profileKeys = profileById.get(id) ?? [];
    return JSON.stringify(catalogueKeys) !== JSON.stringify(profileKeys);
  });
  return {
    cataloguePaths,
    profilePaths: [
      "supabase/functions/_shared/document-intelligence-profiles.ts",
    ],
    catalogueTemplateCount: templates.length,
    profileTemplateCount: profiles.length,
    enhancedProfileCount: profiles.filter((profile) => profile.enhanced).length,
    exactMatchCount: templates.length - conflicts.length,
    conflictTemplateIds: conflicts,
    missingProfiles,
    orphanProfiles,
    catalogueById,
    profileById,
  };
}

function setDifference(expected, actual) {
  return [...expected].filter((item) => !actual.has(item));
}

function scanForFalseImplementationClaims(value, path, issues) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      /(?:live|runtime|persistence|database|migration|adapter).*implemented/i.test(key) &&
      child === true
    ) {
      issues.push(`${childPath} must not claim live implementation`);
    }
    if (typeof child === "string" && /\b(?:live migration|runtime compatibility adapter|persistence migration) (?:is|has been) implemented\b/i.test(child)) {
      issues.push(`${childPath} falsely claims live implementation`);
    }
    scanForFalseImplementationClaims(child, childPath, issues);
  }
}

export function validateProposedSectionKeyCompatibilityMatrix(
  matrix,
  inventory,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
) {
  const issues = [];
  if (!matrix || typeof matrix !== "object") return ["matrix must be an object"];
  if (matrix.schemaVersion !== "1.1.0") issues.push('schemaVersion must be "1.1.0"');
  if (matrix.status !== "owner_approved") issues.push('status must be exactly "owner_approved"');
  if (matrix.ownerApprovalRequired !== true) issues.push("top-level ownerApprovalRequired must be true");
  if (matrix.liveMigrationImplemented !== false) issues.push("liveMigrationImplemented must be false");
  const ownerApproval = matrix.ownerApproval ?? {};
  if (ownerApproval.status !== "approved") issues.push('ownerApproval.status must be "approved"');
  if (ownerApproval.approvedBy !== "PrompTED owner") issues.push('ownerApproval.approvedBy must be "PrompTED owner"');
  if (ownerApproval.approvedAt !== "2026-08-25") issues.push('ownerApproval.approvedAt must be "2026-08-25"');
  if (!nonEmptyString(ownerApproval.scope)) issues.push("ownerApproval.scope must be non-empty");
  for (const field of [
    "liveImplementationAuthorized",
    "protectedActionsAuthorized",
  ]) {
    if (ownerApproval[field] !== false) issues.push(`ownerApproval.${field} must be false`);
  }
  if (ownerApproval.phaseL02Authorized !== true) {
    issues.push("ownerApproval.phaseL02Authorized must be true");
  }
  const approvedAuthority = matrix.approvedAuthority ?? {};
  for (const field of [
    "decision",
    "historicalReadPolicy",
    "newWritePolicy",
    "userContentPolicy",
  ]) {
    if (!nonEmptyString(approvedAuthority[field])) {
      issues.push(`approvedAuthority.${field} must be non-empty`);
    }
  }
  if (!Array.isArray(matrix.templates)) issues.push("templates must be an array");

  const templates = Array.isArray(matrix.templates) ? matrix.templates : [];
  const ids = templates.map((template) => template?.templateId);
  const expectedIds = new Set(EXPECTED_CONFLICT_TEMPLATE_IDS);
  const actualIds = new Set(ids);
  if (templates.length !== EXPECTED_CONFLICT_TEMPLATE_IDS.length) {
    issues.push(`templates must contain exactly ${EXPECTED_CONFLICT_TEMPLATE_IDS.length} entries`);
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of new Set(duplicates)) issues.push(`duplicate templateId: ${id}`);
  for (const id of setDifference(expectedIds, actualIds)) issues.push(`missing expected template: ${id}`);
  for (const id of setDifference(actualIds, expectedIds)) issues.push(`unexpected template: ${id}`);

  const liveConflicts = new Set(inventory.conflictTemplateIds);
  for (const id of setDifference(expectedIds, liveConflicts)) issues.push(`expected conflict absent from current inventory: ${id}`);
  for (const id of setDifference(liveConflicts, expectedIds)) issues.push(`new current conflict not represented: ${id}`);
  if (inventory.catalogueTemplateCount !== 86) issues.push(`current catalogue must contain 86 templates, found ${inventory.catalogueTemplateCount}`);
  if (inventory.profileTemplateCount !== 86) issues.push(`current profile set must contain 86 templates, found ${inventory.profileTemplateCount}`);
  if (inventory.enhancedProfileCount !== 86) issues.push(`all 86 profiles must be enhanced and internally passed, found ${inventory.enhancedProfileCount}`);
  if (inventory.exactMatchCount !== 68) issues.push(`current exact-match count must be 68, found ${inventory.exactMatchCount}`);
  if (inventory.missingProfiles.length > 0) issues.push(`catalogue templates without profiles: ${inventory.missingProfiles.join(", ")}`);
  if (inventory.orphanProfiles.length > 0) issues.push(`profiles without catalogue templates: ${inventory.orphanProfiles.join(", ")}`);

  const source = matrix.source ?? {};
  const expectedSourceIdentity = {
    repositoryRemote: "https://github.com/voltlead26-creator/PrompTED.git",
    worktreeDirectory: "/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED",
    branch: "reliably-prompTED",
    headCommit: "e7f4e37e3087ee166c16ab242b17c60b3877f16b",
    comparisonBaseBranch: "reliably-prompTED",
  };
  for (const [field, expected] of Object.entries(expectedSourceIdentity)) {
    if (source[field] !== expected) {
      issues.push(`source.${field} must be ${JSON.stringify(expected)}`);
    }
  }
  if (!strings(source.cataloguePaths) || !strings(source.profilePaths)) {
    issues.push("source cataloguePaths and profilePaths must be string arrays");
  }
  const citedSourcePaths = [
    ...(strings(source.cataloguePaths) ? source.cataloguePaths : []),
    ...(strings(source.profilePaths) ? source.profilePaths : []),
  ];
  for (const path of citedSourcePaths) {
    if (!repositoryPathExists(repositoryRoot, path)) issues.push(`source path does not exist inside the repository: ${path}`);
  }
  if (JSON.stringify(source.cataloguePaths ?? []) !== JSON.stringify(inventory.cataloguePaths)) {
    issues.push("source.cataloguePaths does not match the current catalogue inventory");
  }
  if (JSON.stringify(source.profilePaths ?? []) !== JSON.stringify(inventory.profilePaths)) {
    issues.push("source.profilePaths does not match the current profile inventory");
  }
  const claimedInventory = matrix.inventory ?? {};
  const expectedInventoryClaims = {
    catalogueTemplateCount: inventory.catalogueTemplateCount,
    enhancedDocumentIntelligenceProfileCount: inventory.enhancedProfileCount,
    exactSectionKeyMatchCount: inventory.exactMatchCount,
    conflictCount: inventory.conflictTemplateIds.length,
  };
  for (const [field, expected] of Object.entries(expectedInventoryClaims)) {
    if (claimedInventory[field] !== expected) {
      issues.push(`inventory.${field} must be ${expected}`);
    }
  }

  const adoptionPlan = matrix.adoptionPlan ?? {};
  if (adoptionPlan.authority !== "AGENTS.md") {
    issues.push('adoptionPlan.authority must be "AGENTS.md"');
  }
  const catalogueScope = adoptionPlan.catalogueScope ?? {};
  const expectedCatalogueScope = {
    enhancedProfileCount: 86,
    exactStructureCount: 68,
    compatibilityDecisionCount: 18,
  };
  for (const [field, expected] of Object.entries(expectedCatalogueScope)) {
    if (catalogueScope[field] !== expected) {
      issues.push(`adoptionPlan.catalogueScope.${field} must be ${expected}`);
    }
  }
  if (!nonEmptyString(catalogueScope.policy)) {
    issues.push("adoptionPlan.catalogueScope.policy must be non-empty");
  }

  const foundationDependency = adoptionPlan.foundationDependency ?? {};
  const expectedFoundationStrings = {
    workflowId: "01a02eca-55a4-79f3-926a-09c32df95900",
    status: "owner_accepted_locally_uncommitted_no_hosted_evidence",
    repositoryRemote: "https://github.com/voltlead26-creator/PrompTED.git",
    sourceBranch: "codex/recovery-foundation-successor",
    sourceHeadCommit: "e7f4e37e3087ee166c16ab242b17c60b3877f16b",
    targetBranch: "reliably-prompTED",
    targetHeadCommit: "e7f4e37e3087ee166c16ab242b17c60b3877f16b",
    comparisonBaseBranch: "reliably-prompTED",
    handoffPath: "docs/quality/2026-08-24-recovery-foundation-successor-handoff.md",
  };
  for (const [field, expected] of Object.entries(expectedFoundationStrings)) {
    if (foundationDependency[field] !== expected) {
      issues.push(`adoptionPlan.foundationDependency.${field} must be ${JSON.stringify(expected)}`);
    }
  }
  for (const field of [
    "observedAt",
    "sourceGitCommonDirectory",
    "sourceWorktreeDirectory",
    "targetGitCommonDirectory",
    "targetWorktreeDirectory",
    "acceptanceRequirement",
    "provenancePolicy",
  ]) {
    if (!nonEmptyString(foundationDependency[field])) {
      issues.push(`adoptionPlan.foundationDependency.${field} must be non-empty`);
    }
  }
  for (const field of [
    "sameRemoteAsTargetWorktree",
    "sameCheckpointAsTargetWorktree",
    "locallyAppliedToTargetWorktree",
  ]) {
    if (foundationDependency[field] !== true) {
      issues.push(`adoptionPlan.foundationDependency.${field} must be true`);
    }
  }
  for (const field of [
    "sameGitCommonDirectoryAsTargetWorktree",
    "committed",
    "pushed",
    "reviewedInPullRequest",
    "hostedCiVerified",
    "mergedIntoIntegrationBase",
    "productionPromoted",
    "deployed",
  ]) {
    if (foundationDependency[field] !== false) {
      issues.push(`adoptionPlan.foundationDependency.${field} must be false`);
    }
  }

  const testingPolicy = adoptionPlan.currentTestingPolicy ?? {};
  if (testingPolicy.mode !== "standalone_individual_only") {
    issues.push('adoptionPlan.currentTestingPolicy.mode must be "standalone_individual_only"');
  }
  if (testingPolicy.standaloneInvocationRequired !== true) {
    issues.push("adoptionPlan.currentTestingPolicy.standaloneInvocationRequired must be true");
  }
  for (const field of [
    "ciIntegrationAuthorized",
    "workflowIntegrationAuthorized",
    "applicationWorkflowExerciseAuthorized",
  ]) {
    if (testingPolicy[field] !== false) {
      issues.push(`adoptionPlan.currentTestingPolicy.${field} must be false`);
    }
  }
  if (!nonEmptyString(testingPolicy.transitionGate)) {
    issues.push("adoptionPlan.currentTestingPolicy.transitionGate must be non-empty");
  }

  const l02Implementation = adoptionPlan.l02Implementation ?? {};
  const expectedL02Values = {
    workflowId: "01a02f99-b81f-7102-ab15-f9b5a4a7a9e4",
    status: "implemented_and_verified_locally_live_integration_not_authorized",
    implementedAt: "2026-08-25",
    freshLocalMigrationCount: 24,
    databaseTestCount: 60,
    sharedFocusedTestCount: 9,
  };
  for (const [field, expected] of Object.entries(expectedL02Values)) {
    if (l02Implementation[field] !== expected) {
      issues.push(`adoptionPlan.l02Implementation.${field} must be ${JSON.stringify(expected)}`);
    }
  }
  for (const field of [
    "migrationPath",
    "databaseTestPath",
    "sharedContractPath",
    "adrPath",
  ]) {
    if (!nonEmptyString(l02Implementation[field])) {
      issues.push(`adoptionPlan.l02Implementation.${field} must be non-empty`);
    } else if (!repositoryPathExists(repositoryRoot, l02Implementation[field])) {
      issues.push(`adoptionPlan.l02Implementation.${field} does not exist: ${l02Implementation[field]}`);
    }
  }
  for (const field of [
    "liveLedgerSelectionEnabled",
    "compatibilityAdaptersImplemented",
    "applicationWorkflowExercised",
    "hostedMutationPerformed",
  ]) {
    if (l02Implementation[field] !== false) {
      issues.push(`adoptionPlan.l02Implementation.${field} must be false`);
    }
  }
  if (!nonEmptyString(l02Implementation.summary)) {
    issues.push("adoptionPlan.l02Implementation.summary must be non-empty");
  }

  const adoptionSteps = Array.isArray(adoptionPlan.steps) ? adoptionPlan.steps : [];
  if (JSON.stringify(adoptionSteps.map((step) => step?.id)) !== JSON.stringify(EXPECTED_ADOPTION_STEP_IDS)) {
    issues.push(`adoptionPlan.steps must contain exactly: ${EXPECTED_ADOPTION_STEP_IDS.join(", ")}`);
  }
  for (const [index, step] of adoptionSteps.entries()) {
    const stepPrefix = `adoptionPlan.steps[${index}]`;
    for (const field of [
      "id",
      "name",
      "status",
      "entryGate",
      "authorizedScope",
      "verification",
      "exitGate",
    ]) {
      if (!nonEmptyString(step?.[field])) {
        issues.push(`${stepPrefix}.${field} must be non-empty`);
      }
    }
  }
  const l02 = adoptionSteps.find((step) => step?.id === "L0.2");
  const l01 = adoptionSteps.find((step) => step?.id === "L0.1");
  if (l01?.status !== "owner_approved_locally_live_implementation_not_authorized") {
    issues.push('adoptionPlan L0.1 status must be "owner_approved_locally_live_implementation_not_authorized"');
  }
  const l01a = adoptionSteps.find((step) => step?.id === "L0.1A");
  if (l01a?.status !== "owner_approved_shadow_live_integration_not_authorized") {
    issues.push('adoptionPlan L0.1A status must be "owner_approved_shadow_live_integration_not_authorized"');
  }
  if (l02?.status !== "implemented_and_verified_locally_live_integration_not_authorized") {
    issues.push('adoptionPlan L0.2 status must be "implemented_and_verified_locally_live_integration_not_authorized"');
  }
  const f0 = adoptionSteps.find((step) => step?.id === "F0");
  if (f0?.status !== "owner_accepted_locally_uncommitted_no_hosted_evidence") {
    issues.push('adoptionPlan F0 status must be "owner_accepted_locally_uncommitted_no_hosted_evidence"');
  }

  const seenApprovedNewSections = new Set();
  for (const template of templates) {
    if (!template || typeof template !== "object") {
      issues.push("template entry must be an object");
      continue;
    }
    const id = template.templateId;
    const prefix = `templates.${id}`;
    if (template.ownerApprovalRequired !== true) issues.push(`${prefix}.ownerApprovalRequired must be true`);
    for (const field of ["catalogueSectionKeys", "profileSectionKeys", "proposedCanonicalSectionKeys"]) {
      if (!strings(template[field])) issues.push(`${prefix}.${field} must be a string array`);
    }
    const currentCatalogueKeys = inventory.catalogueById.get(id) ?? [];
    const currentProfileKeys = inventory.profileById.get(id) ?? [];
    if (JSON.stringify(template.catalogueSectionKeys ?? []) !== JSON.stringify(currentCatalogueKeys)) {
      issues.push(`${prefix}.catalogueSectionKeys does not match current catalogue order`);
    }
    if (JSON.stringify(template.profileSectionKeys ?? []) !== JSON.stringify(currentProfileKeys)) {
      issues.push(`${prefix}.profileSectionKeys does not match current profile order`);
    }
    if (!Array.isArray(template.mappings) || template.mappings.length === 0) {
      issues.push(`${prefix}.mappings must be a non-empty array`);
      continue;
    }
    const accountedCatalogue = new Set();
    const accountedProfile = new Set();
    const mappedCanonical = new Set();
    for (const [index, mapping] of template.mappings.entries()) {
      const mappingPrefix = `${prefix}.mappings[${index}]`;
      for (const field of ["legacyKeys", "profileKeys", "proposedCanonicalKeys", "sourceEvidence", "unresolvedQuestions"]) {
        if (!strings(mapping[field])) issues.push(`${mappingPrefix}.${field} must be a string array`);
      }
      for (const key of mapping.legacyKeys ?? []) accountedCatalogue.add(key);
      for (const key of mapping.profileKeys ?? []) accountedProfile.add(key);
      for (const key of mapping.proposedCanonicalKeys ?? []) mappedCanonical.add(key);
      for (const key of mapping.legacyKeys ?? []) {
        if (!currentCatalogueKeys.includes(key)) issues.push(`${mappingPrefix} references unknown catalogue key: ${key}`);
      }
      for (const key of mapping.profileKeys ?? []) {
        if (!currentProfileKeys.includes(key)) issues.push(`${mappingPrefix} references unknown profile key: ${key}`);
      }
      for (const key of mapping.proposedCanonicalKeys ?? []) {
        if (!(template.proposedCanonicalSectionKeys ?? []).includes(key)) issues.push(`${mappingPrefix} references undeclared canonical key: ${key}`);
      }
      if ((mapping.legacyKeys ?? []).length === 0 && (mapping.profileKeys ?? []).length === 0) {
        issues.push(`${mappingPrefix} must reference at least one legacy or profile key`);
      }
      if (!SUPPORTED_CLASSIFICATIONS.has(mapping.classification)) issues.push(`${mappingPrefix}.classification is unsupported`);
      if (!nonEmptyString(mapping.semanticRationale)) issues.push(`${mappingPrefix}.semanticRationale must be non-empty`);
      if (!Array.isArray(mapping.sourceEvidence) || mapping.sourceEvidence.length === 0) issues.push(`${mappingPrefix}.sourceEvidence must be non-empty`);
      for (const path of mapping.sourceEvidence ?? []) {
        if (!repositoryPathExists(repositoryRoot, path)) issues.push(`${mappingPrefix} source path does not exist: ${path}`);
      }
      for (const field of ["preserveHistoricalRead", "deterministicMigrationPossible", "compatibilityAdapterRequired", "durableMigrationRequired", "ownerDecisionRequired"]) {
        if (typeof mapping[field] !== "boolean") issues.push(`${mappingPrefix}.${field} must be boolean`);
      }
      if (!["high", "medium", "low"].includes(mapping.confidence)) issues.push(`${mappingPrefix}.confidence is invalid`);
      if (mapping.classification === "one_to_many_split") {
        const strategy = mapping.historicalContentStrategy;
        if (
          !nonEmptyString(strategy) ||
          !/(?:keep|preserv|retain)/i.test(strategy) ||
          !/(?:never|not|without)/i.test(strategy) ||
          !/(?:content|section|prose)/i.test(strategy)
        ) {
          issues.push(`${mappingPrefix} split requires a non-lossy historicalContentStrategy`);
        }
      }
      if (mapping.classification === "many_to_one_merge") {
        const strategy = mapping.mergeStrategy;
        if (!strategy || !Array.isArray(strategy.deterministicOrdering) || strategy.deterministicOrdering.length === 0) issues.push(`${mappingPrefix} merge requires deterministic ordering`);
        for (const field of ["headingTreatment", "duplicateContentHandling", "approvalConflictHandling", "provenancePreservation", "rollbackAndHistoricalRendering"]) {
          if (!nonEmptyString(strategy?.[field])) issues.push(`${mappingPrefix} merge requires ${field}`);
        }
      }
      if (mapping.classification === "one_to_one_rename") {
        if (mapping.preserveHistoricalRead !== true || !nonEmptyString(mapping.historicalReadStrategy)) {
          issues.push(`${mappingPrefix} rename requires historical-read support`);
        }
      }
      if (mapping.classification === "unresolved" && (mapping.unresolvedQuestions ?? []).length === 0) {
        issues.push(`${mappingPrefix} unresolved mapping requires an unresolved question`);
      }
      if (mapping.classification === "new_canonical_section") {
        if ((mapping.legacyKeys ?? []).length !== 0) {
          issues.push(`${mappingPrefix} new canonical section must not claim a legacy key`);
        }
        if ((mapping.profileKeys ?? []).length === 0 || (mapping.proposedCanonicalKeys ?? []).length === 0) {
          issues.push(`${mappingPrefix} new canonical section requires profile and canonical keys`);
        }
        if (mapping.ownerDecisionRequired !== true || mapping.ownerDecisionStatus !== "approved") {
          issues.push(`${mappingPrefix} new canonical section requires recorded owner approval`);
        }
        if (mapping.approvedAt !== ownerApproval.approvedAt) {
          issues.push(`${mappingPrefix} new canonical section approval date must match top-level approval`);
        }
        if ((mapping.unresolvedQuestions ?? []).length !== 0) {
          issues.push(`${mappingPrefix} approved new canonical section must not retain unresolved questions`);
        }
        if (mapping.deterministicMigrationPossible !== false) {
          issues.push(`${mappingPrefix} new canonical section must not claim deterministic historical migration`);
        }
        if (
          mapping.preserveHistoricalRead !== true ||
          mapping.compatibilityAdapterRequired !== true ||
          mapping.durableMigrationRequired !== true
        ) {
          issues.push(`${mappingPrefix} new canonical section must preserve historical reads and require versioned compatibility`);
        }
        const policy = mapping.newSectionPolicy;
        if (!policy || !["required", "optional", "jurisdiction_controlled"].includes(policy.requiredness)) {
          issues.push(`${mappingPrefix} new canonical section requires approved requiredness`);
        }
        for (const field of [
          "historicalContentStrategy",
          "newWriteStrategy",
          "renderingStrategy",
          "activationAuthority",
        ]) {
          if (!nonEmptyString(policy?.[field])) {
            issues.push(`${mappingPrefix} new canonical section requires ${field}`);
          }
        }
        if (
          !/(?:preserv|retain)/i.test(policy?.historicalContentStrategy ?? "") ||
          !/(?:never|not|without)/i.test(policy?.historicalContentStrategy ?? "") ||
          !/(?:historical|legacy)/i.test(policy?.historicalContentStrategy ?? "")
        ) {
          issues.push(`${mappingPrefix} new canonical section requires a non-lossy historical-content strategy`);
        }
        if (
          policy?.requiredness === "jurisdiction_controlled" &&
          (!/(?:approved)/i.test(policy.activationAuthority) ||
            !/(?:jurisdiction)/i.test(policy.activationAuthority))
        ) {
          issues.push(`${mappingPrefix} jurisdiction-controlled section requires approved jurisdiction authority`);
        }
        const newSectionIdentity = `${id}:${(mapping.profileKeys ?? []).join(",")}`;
        const expectedRequiredness = EXPECTED_APPROVED_NEW_SECTION_REQUIREDNESS.get(
          newSectionIdentity,
        );
        if (!expectedRequiredness) {
          issues.push(`${mappingPrefix} unexpected approved new canonical section: ${newSectionIdentity}`);
        } else {
          seenApprovedNewSections.add(newSectionIdentity);
          if (policy?.requiredness !== expectedRequiredness) {
            issues.push(
              `${mappingPrefix} approved requiredness must be ${expectedRequiredness}`,
            );
          }
        }
      }
    }
    for (const key of currentCatalogueKeys) {
      if (!accountedCatalogue.has(key)) issues.push(`${prefix} unaccounted catalogue key: ${key}`);
    }
    for (const key of currentProfileKeys) {
      if (!accountedProfile.has(key)) issues.push(`${prefix} unaccounted profile key: ${key}`);
    }
    for (const key of template.proposedCanonicalSectionKeys ?? []) {
      if (!mappedCanonical.has(key)) issues.push(`${prefix} orphan proposed canonical key: ${key}`);
    }
    if (!Array.isArray(template.consumers) || template.consumers.length === 0) {
      issues.push(`${prefix}.consumers must be non-empty`);
    }
    for (const [index, consumer] of (template.consumers ?? []).entries()) {
      if (!repositoryPathExists(repositoryRoot, consumer.path)) issues.push(`${prefix}.consumers[${index}] path does not exist: ${consumer.path}`);
      if (!SUPPORTED_CONSUMER_ROLES.has(consumer.role)) issues.push(`${prefix}.consumers[${index}].role is unsupported`);
      if (!nonEmptyString(consumer.evidence)) issues.push(`${prefix}.consumers[${index}].evidence must be non-empty`);
    }
    for (const field of ["persistedDataImpact", "replayImpact", "exportImpact", "workspaceImpact", "compatibilityAdapterProposal", "rollbackProposal"]) {
      if (!nonEmptyString(template[field])) issues.push(`${prefix}.${field} must be non-empty`);
    }
    if (!Array.isArray(template.unresolvedQuestions) || template.unresolvedQuestions.length !== 0) {
      issues.push(`${prefix}.unresolvedQuestions must be empty after owner approval`);
    }
  }

  for (const identity of EXPECTED_APPROVED_NEW_SECTION_REQUIREDNESS.keys()) {
    if (!seenApprovedNewSections.has(identity)) {
      issues.push(`missing approved new canonical section: ${identity}`);
    }
  }

  scanForFalseImplementationClaims(matrix, "matrix", issues);
  return issues;
}

export function assertValidProposedSectionKeyCompatibilityMatrix(
  matrix,
  inventory,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
) {
  const issues = validateProposedSectionKeyCompatibilityMatrix(matrix, inventory, repositoryRoot);
  if (issues.length > 0) {
    throw new Error(`Section-key compatibility proposal is invalid:\n- ${issues.join("\n- ")}`);
  }
}

function runCli() {
  const matrixPath = resolve(process.argv[2] ?? DEFAULT_MATRIX_PATH);
  const matrix = readJson(matrixPath);
  const inventory = loadCurrentSectionKeyInventory(DEFAULT_REPOSITORY_ROOT);
  assertValidProposedSectionKeyCompatibilityMatrix(matrix, inventory);
  console.log(
    `Owner-approved section-key compatibility decision passed: ${inventory.catalogueTemplateCount} catalogue templates, ` +
      `${inventory.enhancedProfileCount} enhanced profiles, ${inventory.exactMatchCount} exact matches, ` +
      `${inventory.conflictTemplateIds.length} owner-approved conflict decisions.`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
