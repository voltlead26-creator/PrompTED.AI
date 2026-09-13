// Project authored fact contracts onto current catalogue identities. This is
// an execution adapter, not a saved-document migration or another registry.
// The authored DIP and immutable captured ledger versions remain unchanged.
import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};
import compatibility from "../../../docs/architecture/document-section-key-compatibility.proposed.json" with {
  type: "json",
};
import {
  DIPS,
  type DocumentIntelligenceProfile,
  selectProfile,
} from "./document-intelligence-profiles.ts";
import {
  createDocumentPlaceholderToken,
  parseDocumentPlaceholderTokens,
  validateDocumentInformationContract,
} from "./document-placeholder-policy.ts";
import type { ResolvedTemplate } from "./template-engine.ts";

export const DOCUMENT_PROFILE_PROJECTION_VERSION = "catalogue-section-facts.1";

export interface DocumentProfilePolicy {
  version: typeof DOCUMENT_PROFILE_PROJECTION_VERSION;
  templateId: string;
  /** Full authored snapshot retains risk, quality, examples and provenance. */
  sourceProfile: DocumentIntelligenceProfile | null;
  /** Exact snapshot consumed by every stage, including the base prompt. */
  profile: DocumentIntelligenceProfile | null;
  sectionBindings: Array<{ sectionKey: string; sourceSectionKeys: string[] }>;
  inactiveSourceSections: string[];
}

export class DocumentProfileProjectionError extends Error {
  constructor() {
    super("DOCUMENT_PROFILE_PROJECTION_INVALID");
    this.name = "DocumentProfileProjectionError";
  }
}

function requireProjection(condition: unknown): asserts condition {
  if (!condition) throw new DocumentProfileProjectionError();
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((key, i) => key === right[i]);
}

/** Exact historical selection is only evidence for a pending pre-policy call.
 * Never use this option for a new catalogue generation. */
export function resolveDocumentProfilePolicy(
  template: ResolvedTemplate,
  options: { historical?: boolean } = {},
): DocumentProfilePolicy {
  const catalogue = [...coreTemplates, ...phase2Templates].find((candidate) =>
    candidate.slug === template.id || candidate.id === template.id
  );
  const selected = catalogue && !options.historical
    ? DIPS.find((candidate) => candidate.key === catalogue.slug)
    : selectProfile(
      [template.name, template.id].filter(Boolean).join("\n"),
      template.domain,
    );
  if (catalogue) requireProjection(selected?.informationContract);
  const sourceProfile = selected ? structuredClone(selected) : null;
  const policy: DocumentProfilePolicy = {
    version: DOCUMENT_PROFILE_PROJECTION_VERSION,
    templateId: catalogue?.slug ?? template.id,
    sourceProfile,
    profile: sourceProfile ? structuredClone(sourceProfile) : null,
    sectionBindings: (sourceProfile?.informationContract?.sections ?? []).map((
      section,
    ) => ({
      sectionKey: section.sectionKey,
      sourceSectionKeys: [section.sectionKey],
    })),
    inactiveSourceSections: [],
  };
  if (!catalogue || options.historical) return policy;
  requireProjection(sourceProfile?.informationContract && policy.profile);
  const contract = sourceProfile.informationContract;
  requireProjection(
    validateDocumentInformationContract(sourceProfile.key, contract).length ===
      0,
  );
  const catalogueSections = [...catalogue.sections].sort((left, right) =>
    left.order - right.order
  );
  const currentKeys = catalogueSections.map((section) => section.key);
  const sourceKeys = contract.sections.map((section) => section.sectionKey);
  const selectedKeys = template.sections.map((section) => section.key);
  requireProjection(
    selectedKeys.length > 0 &&
      new Set(selectedKeys).size === selectedKeys.length,
  );
  requireProjection(selectedKeys.every((key) => currentKeys.includes(key)));
  const scoped = selectedKeys.length !== currentKeys.length;
  const entry = compatibility.templates.find((candidate) =>
    candidate.templateId === catalogue.slug
  );
  let bindings = currentKeys.map((key) => ({
    sectionKey: key,
    sourceSectionKeys: [key],
  }));
  if (entry) {
    // Refuse source drift instead of guessing from labels or a partial map.
    requireProjection(sameKeys(entry.catalogueSectionKeys, currentKeys));
    requireProjection(sameKeys(entry.profileSectionKeys, sourceKeys));
    bindings = currentKeys.map((key) => ({
      sectionKey: key,
      sourceSectionKeys: entry.mappings.filter((mapping) =>
        mapping.legacyKeys.some((candidate) => candidate === key)
      )
        .flatMap((mapping) => mapping.profileKeys),
    }));
    if (catalogue.slug === "promotion-case") {
      // The merged proof group is relevant to BOTH existing blocks. Original
      // sharedResolutionKey values remain the single clarification identity.
      for (const binding of bindings) {
        binding.sourceSectionKeys.sort((left, right) =>
          sourceKeys.indexOf(left) - sourceKeys.indexOf(right)
        );
      }
    }
    if (catalogue.slug === "job-follow-up-email") {
      // Sender identity is required even without a separate signature block.
      // Carry it in the required introduction/header; keep next-step optional.
      const introduction = bindings.find((binding) =>
        binding.sectionKey === "thanks"
      );
      requireProjection(introduction && sourceKeys.includes("sign_off"));
      introduction.sourceSectionKeys.push("sign_off");
    }
    const mapped = new Set(
      bindings.flatMap((binding) => binding.sourceSectionKeys),
    );
    policy.inactiveSourceSections = sourceKeys.filter((key) =>
      !mapped.has(key)
    );
    for (const key of policy.inactiveSourceSections) {
      const rule = entry.mappings.find((mapping) =>
        mapping.legacyKeys.length === 0 && mapping.profileKeys.includes(key)
      );
      const section = contract.sections.find((candidate) =>
        candidate.sectionKey === key
      );
      requireProjection(rule && section);
      if (
        catalogue.slug === "terms-of-employment" && key === "acknowledgement"
      ) {
        requireProjection(
          "newSectionPolicy" in rule &&
            rule.newSectionPolicy?.requiredness === "jurisdiction_controlled",
        );
      } else {
        requireProjection(
          catalogue.slug === "interview-script" &&
            ["candidate_questions", "closing"].includes(key),
        );
        requireProjection(
          "newSectionPolicy" in rule &&
            rule.newSectionPolicy?.requiredness === "optional",
        );
        requireProjection(section.requiredInformation.length === 0);
      }
    }
  } else requireProjection(sameKeys(sourceKeys, currentKeys));
  for (const binding of bindings) {
    requireProjection(binding.sourceSectionKeys.length > 0);
    requireProjection(
      new Set(binding.sourceSectionKeys).size ===
        binding.sourceSectionKeys.length,
    );
    requireProjection(
      binding.sourceSectionKeys.every((key) => sourceKeys.includes(key)),
    );
  }
  // Admission preserves an explicit repair scope order, including reordered
  // selected sections. Keep that exact order instead of recanonicalising it.
  policy.sectionBindings = selectedKeys.map((key) => {
    const binding = bindings.find((candidate) => candidate.sectionKey === key);
    requireProjection(binding);
    return binding;
  });
  const profile = policy.profile;
  profile.informationContract = {
    ...contract,
    sections: policy.sectionBindings.map((binding) => {
      const sections = binding.sourceSectionKeys.map((key) => {
        const section = contract.sections.find((candidate) =>
          candidate.sectionKey === key
        );
        requireProjection(section);
        return section;
      });
      return {
        sectionKey: binding.sectionKey,
        requiredInformation: sections.flatMap((section) =>
          structuredClone(section.requiredInformation)
        ),
        optionalInformation: [
          ...new Set(
            sections.flatMap((section) => section.optionalInformation),
          ),
        ],
      };
    }),
  };
  requireProjection(
    validateDocumentInformationContract(
      profile.key,
      profile.informationContract,
    ).length === 0,
  );
  // Matching keys do not establish that authored prose describes the same
  // section order. Every current execution uses this projection; only the
  // explicit historical branch above retains the unprojected authored rules.
  if (scoped) {
    // A repair must ask only for facts in its accepted scope. Whole-document
    // prose requirements have no exact section identity and remain provenance
    // in sourceProfile, rather than becoming extra blockers in this section.
    const facts = profile.informationContract.sections.flatMap((section) =>
      section.requiredInformation
    );
    profile.requiredInformation = [...new Set(facts.map((fact) => fact.label))];
    profile.clarificationQuestions = [
      ...new Set(facts.map((fact) => fact.question)),
    ];
    profile.highValueInformation = [
      ...new Set(
        profile.informationContract.sections.flatMap((section) =>
          section.optionalInformation
        ),
      ),
    ];
  }

  // Keep semantic requirements inside current blocks. This does not activate
  // the future canonical structure or relabel its historical review dates.
  const structure = policy.sectionBindings.map((binding) => {
    const section = catalogueSections.find((candidate) =>
      candidate.key === binding.sectionKey
    );
    requireProjection(section);
    return `${section.name} (${binding.sectionKey}): cover ${
      binding.sourceSectionKeys.join(", ")
    } within this section`;
  });
  profile.outputStructure = structure;
  if (profile.quality) {
    profile.quality.requiredStructure = [
      `Use only these current sections in this order: ${
        selectedKeys.join(", ")
      }. Preserve their requiredness and place the mapped content inside them.`,
      ...structure,
      ...(scoped
        ? [
          "This is a scoped repair. Whole-document requirements remain context only; do not request facts for, recreate, assess completeness of, or rewrite unselected sections. Apply the retained risk, evidence and wording rules only to the selected content.",
          ...profile.quality.requiredStructure.map((rule) =>
            `Whole-document reference only, not an additional requirement for this repair scope: ${rule}`
          ),
        ]
        : profile.quality.requiredStructure.map((rule) =>
        `Authored content guidance only; this list's position does not prescribe section order. Apply inside the current sections without adding section identities: ${rule}`
        )),
      ...(policy.inactiveSourceSections.length
        ? [
          `Future-only sections ${
            policy.inactiveSourceSections.join(", ")
          } are inactive in this current contract; do not require their content or add their sections.`,
        ]
        : []),
    ];
  }
  if (profile.exampleFinalWording) {
    const examples = profile.exampleFinalWording.sections;
    profile.exampleFinalWording = {
      ...profile.exampleFinalWording,
      purpose:
        `${profile.exampleFinalWording.purpose} Runtime structure projection ${DOCUMENT_PROFILE_PROJECTION_VERSION}; source authorship and evaluation dates are unchanged. Examples are content guidance, never supplied user evidence.`,
      sections: policy.sectionBindings.flatMap((binding) => {
        const section = catalogueSections.find((candidate) =>
          candidate.key === binding.sectionKey
        );
        requireProjection(section);
        const content = binding.sourceSectionKeys.flatMap((sourceKey) => {
          const example = examples.find((candidate) =>
            candidate.key === sourceKey
          );
          if (!example) return [];
          let content = example.content.replace(/^## /, "### ");
          // Only synthetic example tokens are rebased. No persisted text or
          // source facts ever pass through this transformation.
          for (const token of parseDocumentPlaceholderTokens(content)) {
            const prefix = `${profile.key}.${sourceKey}.`;
            requireProjection(token.id.startsWith(prefix));
            content = content.replaceAll(
              token.token,
              createDocumentPlaceholderToken(
                `${profile.key}.${binding.sectionKey}.${
                  token.id.slice(prefix.length)
                }`,
                token.label,
              ),
            );
          }
          return [content];
        }).join("\n\n");
        return content
          ? [{
            key: binding.sectionKey,
            label: section.name,
            content: `## ${section.name}\n\n${content}`,
          }]
          : [];
      }),
    };
  }
  return policy;
}
