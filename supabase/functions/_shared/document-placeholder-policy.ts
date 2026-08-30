// =====================================================
// PrompTED — Universal Document Placeholder Policy
//
// Blanket behaviour for every generated document. Template-specific
// information contracts remain owned by the existing Document Intelligence
// profiles, so PrompTED has one engine rather than competing registries.
// =====================================================

export const DOCUMENT_PLACEHOLDER_TOKEN_PREFIX = "{{TED_PLACEHOLDER:";
export const DOCUMENT_PLACEHOLDER_TOKEN_PATTERN =
  /\{\{TED_PLACEHOLDER:([A-Za-z0-9._-]+):([^{}]+)\}\}/g;

export const UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES = [
  "Generate every requested section in complete final wording.",
  "Never invent, infer as fact, or silently substitute missing factual information.",
  "Represent each missing required fact with its own declared interactive placeholder.",
  "Allow multiple independent placeholders in the same section and document.",
  "Never blank, omit, discard, or fail an otherwise valid section because information is missing.",
  "Use an automatic fallback only when the template contract explicitly declares it and it does not invent a fact.",
  "Offer only template-approved neutral replacement options, and never silently choose one unless the contract marks an automatic fallback.",
  "Exclude unresolved placeholder labels from grammar, style, and editorial quality findings while continuing to review surrounding wording.",
  "Count unresolved placeholders by section, document, and export requirement.",
  "Require acknowledgement before export when any unresolved placeholder is marked required for export.",
  "Resolve every occurrence sharing the same placeholder id, and resolve related occurrences sharing a declared shared resolution key within the same outcome.",
  "Render malformed or unrecognised placeholder tokens safely as visible text and keep them unresolved.",
  "Continue to block genuine blank output, instruction leakage, malformed undeclared placeholders, and unsupported factual claims.",
] as const;

export const PROHIBITED_LEGACY_PLACEHOLDER_RULE_PATTERNS: readonly RegExp[] = [
  /\bno placeholders\b/i,
  /\bplaceholders? (?:are|is) not allowed\b/i,
  /\bdo not (?:use|include|return) placeholders?\b/i,
  /\bnever (?:use|include|return) placeholders?\b/i,
  /\bask for (?:the )?(?:missing|vital|required) (?:fact|facts|information) instead of (?:drafting|generating|writing)\b/i,
  /\bif (?:a )?(?:vital|required) fact is unavailable,? (?:ask|fail|stop|do not draft)\b/i,
  /\breturn the document only when it can be used .* without .* placeholders?\b/i,
  /\bidentify the exact vital fact still required(?: before drafting)?\b/i,
] as const;

export type InformationFactType =
  | "person_name"
  | "role_title"
  | "company_name"
  | "date"
  | "date_range"
  | "location"
  | "address"
  | "contact_detail"
  | "amount"
  | "credential"
  | "institution"
  | "achievement"
  | "responsibility"
  | "skill"
  | "reference"
  | "event"
  | "identifier"
  | "other";

export interface NeutralReplacementOption {
  id: string;
  label: string;
  value: string;
  suitability: string;
  clearsExportWarning: boolean;
  regenerateSurroundingWording: boolean;
}

export interface RequiredInformationDefinition {
  key: string;
  label: string;
  factType: InformationFactType;
  placeholderLabel: string;
  question: string;
  automaticFallback?: string;
  requiredForExport: boolean;
  sharedResolutionKey?: string;
  neutralReplacementOptions: NeutralReplacementOption[];
}

export interface SectionInformationContract {
  sectionKey: string;
  requiredInformation: RequiredInformationDefinition[];
  optionalInformation: string[];
}

export interface DocumentInformationContract {
  status: "not_started" | "in_progress" | "complete";
  auditedAt?: string;
  sections: SectionInformationContract[];
}

export interface UnresolvedDocumentPlaceholder {
  id: string;
  profileKey: string;
  sectionKey: string;
  informationKey: string;
  label: string;
  question: string;
  factType: InformationFactType;
  automaticFallback?: string;
  requiredForExport: boolean;
  sharedResolutionKey?: string;
  neutralReplacementOptions: NeutralReplacementOption[];
}

export interface ParsedDocumentPlaceholderToken {
  id: string;
  label: string;
  token: string;
  start: number;
  end: number;
}

export interface PlaceholderCounts {
  total: number;
  requiredForExport: number;
  automaticFallbackAvailable: number;
  neutralReplacementAvailable: number;
  bySection: Record<string, number>;
}

export type PlaceholderExportDecision =
  | { status: "clear"; counts: PlaceholderCounts }
  | { status: "warn"; counts: PlaceholderCounts }
  | { status: "acknowledgement_required"; counts: PlaceholderCounts };

export function validateDocumentInformationContract(
  profileKey: string,
  contract: DocumentInformationContract,
): string[] {
  const errors: string[] = [];
  const sectionKeys = new Set<string>();
  const scopedInformationKeys = new Set<string>();

  if (!profileKey.trim()) errors.push("profile key is required");
  if (contract.status === "complete" && !contract.auditedAt?.trim()) {
    errors.push(`${profileKey}: auditedAt is required when status is complete`);
  }
  if (contract.sections.length === 0) {
    errors.push(`${profileKey}: at least one section contract is required`);
  }

  for (const section of contract.sections) {
    if (!section.sectionKey.trim()) {
      errors.push(`${profileKey}: sectionKey is required`);
      continue;
    }
    if (sectionKeys.has(section.sectionKey)) {
      errors.push(`${profileKey}: duplicate section key ${section.sectionKey}`);
    }
    sectionKeys.add(section.sectionKey);

    for (const item of section.requiredInformation) {
      const scopedKey = `${section.sectionKey}:${item.key}`;
      if (!item.key.trim()) {
        errors.push(
          `${profileKey}:${section.sectionKey}: information key is required`,
        );
      }
      if (scopedInformationKeys.has(scopedKey)) {
        errors.push(`${profileKey}: duplicate information key ${scopedKey}`);
      }
      scopedInformationKeys.add(scopedKey);
      if (!item.label.trim()) {
        errors.push(`${profileKey}:${scopedKey}: label is required`);
      }
      if (!item.placeholderLabel.trim()) {
        errors.push(`${profileKey}:${scopedKey}: placeholderLabel is required`);
      }
      if (!item.question.trim()) {
        errors.push(`${profileKey}:${scopedKey}: question is required`);
      }
      if (
        item.automaticFallback !== undefined && !item.automaticFallback.trim()
      ) {
        errors.push(
          `${profileKey}:${scopedKey}: automaticFallback must be omitted or non-empty`,
        );
      }
      if (
        item.sharedResolutionKey !== undefined &&
        !item.sharedResolutionKey.trim()
      ) {
        errors.push(
          `${profileKey}:${scopedKey}: sharedResolutionKey must be omitted or non-empty`,
        );
      }

      const optionIds = new Set<string>();
      for (const option of item.neutralReplacementOptions) {
        const optionKey =
          `${profileKey}:${scopedKey}:neutralReplacementOptions`;
        if (!option.id.trim()) {
          errors.push(`${optionKey}: option id is required`);
        }
        if (optionIds.has(option.id)) {
          errors.push(`${optionKey}: duplicate option id ${option.id}`);
        }
        optionIds.add(option.id);
        if (!option.label.trim()) {
          errors.push(`${optionKey}:${option.id}: label is required`);
        }
        if (!option.value.trim()) {
          errors.push(`${optionKey}:${option.id}: value is required`);
        }
        if (!option.suitability.trim()) {
          errors.push(`${optionKey}:${option.id}: suitability is required`);
        }
      }
    }
  }

  return errors;
}

export function findContradictoryPlaceholderRules(
  values: readonly string[],
): string[] {
  return values.filter((value) =>
    PROHIBITED_LEGACY_PLACEHOLDER_RULE_PATTERNS.some((pattern) =>
      pattern.test(value)
    )
  );
}

export function flattenRequiredInformation(
  contract: DocumentInformationContract,
): RequiredInformationDefinition[] {
  return contract.sections.flatMap((section) => section.requiredInformation);
}

export function deriveRequiredInformationLabels(
  contract: DocumentInformationContract,
): string[] {
  return flattenRequiredInformation(contract).map((item) => item.label);
}

export function deriveOptionalInformation(
  contract: DocumentInformationContract,
): string[] {
  return Array.from(
    new Set(
      contract.sections.flatMap((section) => section.optionalInformation),
    ),
  );
}

export function deriveClarificationQuestions(
  contract: DocumentInformationContract,
): string[] {
  return flattenRequiredInformation(contract).map((item) => item.question);
}

export function createDocumentPlaceholderToken(
  id: string,
  label: string,
): string {
  const cleanId = id.trim();
  const cleanLabel = label.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(cleanId)) {
    throw new Error(
      "placeholder id may contain only letters, numbers, dots, underscores, and hyphens",
    );
  }
  if (!cleanLabel || /[{}]/.test(cleanLabel)) {
    throw new Error(
      "placeholder label must be non-empty and cannot contain braces",
    );
  }
  return `{{TED_PLACEHOLDER:${cleanId}:${cleanLabel}}}`;
}

export function parseDocumentPlaceholderTokens(
  content: string,
): ParsedDocumentPlaceholderToken[] {
  const tokens: ParsedDocumentPlaceholderToken[] = [];
  const pattern = new RegExp(DOCUMENT_PLACEHOLDER_TOKEN_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    tokens.push({
      id: match[1],
      label: match[2].trim(),
      token: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

export function maskDeclaredDocumentPlaceholderTokens(content: string): {
  masked: string;
  restore: (value: string) => string;
} {
  const preserved: string[] = [];
  const masked = content.replace(
    new RegExp(DOCUMENT_PLACEHOLDER_TOKEN_PATTERN.source, "g"),
    (token) => {
      preserved.push(token);
      return "\uE100" + (preserved.length - 1) + "\uE100";
    },
  );
  return {
    masked,
    restore: (value: string) =>
      value.replace(
        /\uE100(\d+)\uE100/g,
        (_full, index) => preserved[Number(index)] ?? "",
      ),
  };
}
export function countUnresolvedPlaceholders(
  placeholders: readonly UnresolvedDocumentPlaceholder[],
): PlaceholderCounts {
  const unique = new Map(
    placeholders.map((placeholder) => [placeholder.id, placeholder]),
  );
  const counts: PlaceholderCounts = {
    total: unique.size,
    requiredForExport: 0,
    automaticFallbackAvailable: 0,
    neutralReplacementAvailable: 0,
    bySection: {},
  };

  for (const placeholder of unique.values()) {
    counts.bySection[placeholder.sectionKey] =
      (counts.bySection[placeholder.sectionKey] ?? 0) + 1;
    if (placeholder.requiredForExport) counts.requiredForExport += 1;
    if (placeholder.automaticFallback?.trim()) {
      counts.automaticFallbackAvailable += 1;
    }
    if (placeholder.neutralReplacementOptions.length > 0) {
      counts.neutralReplacementAvailable += 1;
    }
  }
  return counts;
}

export function determinePlaceholderExportDecision(
  placeholders: readonly UnresolvedDocumentPlaceholder[],
): PlaceholderExportDecision {
  const counts = countUnresolvedPlaceholders(placeholders);
  if (counts.total === 0) return { status: "clear", counts };
  if (counts.requiredForExport > 0) {
    return { status: "acknowledgement_required", counts };
  }
  return { status: "warn", counts };
}

export function resolveDocumentPlaceholders(
  contentBySection: Readonly<Record<string, string>>,
  placeholders: readonly UnresolvedDocumentPlaceholder[],
  selectedPlaceholderId: string,
  answer: string,
): {
  contentBySection: Record<string, string>;
  unresolved: UnresolvedDocumentPlaceholder[];
  resolvedIds: string[];
} {
  const cleanAnswer = answer.trim();
  if (!cleanAnswer) throw new Error("placeholder answer cannot be empty");

  const selected = placeholders.find((placeholder) =>
    placeholder.id === selectedPlaceholderId
  );
  if (!selected) {
    throw new Error(`unknown placeholder id: ${selectedPlaceholderId}`);
  }

  const shouldResolve = (placeholder: UnresolvedDocumentPlaceholder): boolean =>
    placeholder.id === selected.id ||
    Boolean(
      selected.sharedResolutionKey &&
        placeholder.sharedResolutionKey === selected.sharedResolutionKey,
    );

  const targets = placeholders.filter(shouldResolve);
  const resolvedIds = Array.from(new Set(targets.map((target) => target.id)));
  const updated = { ...contentBySection };

  for (const target of targets) {
    const token = createDocumentPlaceholderToken(target.id, target.label);
    for (const [sectionKey, content] of Object.entries(updated)) {
      if (content.includes(token)) {
        updated[sectionKey] = content.split(token).join(cleanAnswer);
      }
    }
  }

  return {
    contentBySection: updated,
    unresolved: placeholders.filter((placeholder) =>
      !shouldResolve(placeholder)
    ),
    resolvedIds,
  };
}

export function applyDeclaredAutomaticFallback(
  contentBySection: Readonly<Record<string, string>>,
  placeholders: readonly UnresolvedDocumentPlaceholder[],
  placeholderId: string,
) {
  const placeholder = placeholders.find((item) => item.id === placeholderId);
  if (!placeholder) throw new Error(`unknown placeholder id: ${placeholderId}`);
  if (!placeholder.automaticFallback?.trim()) {
    throw new Error(
      `placeholder ${placeholderId} has no declared automatic fallback`,
    );
  }
  return resolveDocumentPlaceholders(
    contentBySection,
    placeholders,
    placeholderId,
    placeholder.automaticFallback,
  );
}

export function applyApprovedNeutralReplacement(
  contentBySection: Readonly<Record<string, string>>,
  placeholders: readonly UnresolvedDocumentPlaceholder[],
  placeholderId: string,
  replacementOptionId: string,
) {
  const placeholder = placeholders.find((item) => item.id === placeholderId);
  if (!placeholder) throw new Error(`unknown placeholder id: ${placeholderId}`);
  const option = placeholder.neutralReplacementOptions.find(
    (candidate) => candidate.id === replacementOptionId,
  );
  if (!option) {
    throw new Error(
      `placeholder ${placeholderId} has no approved neutral replacement ${replacementOptionId}`,
    );
  }
  return {
    ...resolveDocumentPlaceholders(
      contentBySection,
      placeholders,
      placeholderId,
      option.value,
    ),
    appliedOption: option,
  };
}

export function renderDocumentPlaceholderLabels(content: string): string {
  return content.replace(
    new RegExp(DOCUMENT_PLACEHOLDER_TOKEN_PATTERN.source, "g"),
    (_token, _id, label) => String(label).trim(),
  );
}
