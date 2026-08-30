import { routeRequest } from "./provider-router.ts";
import type { ResolvedTemplate } from "./template-engine.ts";
import { stripResidual, validateSection } from "./draft-validator.ts";
import {
  affectedSectionKeys,
  boundedConversationSource,
  type FactualAuditEntry,
  type FactualAuditUnit,
  findUnsupportedNumericClaims,
  groundingIssuesFromAudit,
  mapWithConcurrency,
  mergeByKey,
  renderSectionRequirements,
} from "./document-pipeline-utils.ts";
import { parsePipelineJson } from "./document-pipeline-json.ts";
import {
  type DocumentIntelligenceProfile,
  renderProfile,
  selectProfile,
} from "./document-intelligence-profiles.ts";
import {
  createDocumentPlaceholderToken,
  DOCUMENT_PLACEHOLDER_TOKEN_PATTERN,
  parseDocumentPlaceholderTokens,
  type RequiredInformationDefinition,
  type UnresolvedDocumentPlaceholder,
} from "./document-placeholder-policy.ts";

export interface DocumentPipelineInput {
  template: ResolvedTemplate;
  situation: string;
  conversationContext: string;
  uploadContext: string;
  extractedText: string;
  memoryContext: string;
  systemPrompt: string;
  signal?: AbortSignal;
  onDraftSection?: (section: DraftSection) => void;
}

interface SectionReadiness {
  key: string;
  ready: boolean;
  missing_information: string[];
  /** Exact information keys from the resolved Enhanced DIP contract. */
  missing_information_keys?: string[];
}

interface OutcomeBrief {
  user_goal: string;
  primary_outcome: string;
  audience: string;
  author_perspective: string;
  tone: string[];
  required_content: string[];
  prohibited_content: string[];
  known_facts: string[];
  safe_assumptions: string[];
  missing_critical_information: string[];
  section_readiness: SectionReadiness[];
  confidence: number;
}

// One entry per template section. relevant_content is the planner's sorted
// excerpt of conversation/upload material for that section -- may be "" when
// nothing in the source material belongs there. The same fact may legitimately
// appear in more than one section's relevant_content; the planner does not
// force an exclusive split.
interface SectionContext {
  key: string;
  relevant_content: string;
  /** Situation-specific display name for this section (canonical key unchanged). */
  display_label?: string;
}

interface DraftSection {
  key: string;
  label: string;
  content: string;
}

interface ReviewIssue {
  severity: "low" | "medium" | "high";
  category:
    | "fact"
    | "intent"
    | "tone"
    | "structure"
    | "layout"
    | "completeness"
    | "instruction_leakage"
    | "blank_output";
  section_key?: string;
  finding: string;
  required_correction: string;
}

interface ReviewResult {
  decision: "approve" | "changes_required";
  issues: ReviewIssue[];
}

class DocumentGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentGenerationError";
  }
}

function readinessFor(
  brief: OutcomeBrief,
  key: string,
): SectionReadiness | undefined {
  return brief.section_readiness?.find((item) => item.key === key);
}

function resolvedProfileFor(
  input: DocumentPipelineInput,
): DocumentIntelligenceProfile | null {
  return selectProfile(
    [input.template.name, input.template.id].filter(Boolean).join("\n"),
    input.template.domain,
  );
}

function contractItemsForSection(
  profile: DocumentIntelligenceProfile | null,
  sectionKey: string,
): RequiredInformationDefinition[] {
  return profile?.informationContract?.sections.find((section) =>
    section.sectionKey === sectionKey
  )?.requiredInformation ?? [];
}

function normaliseInformationKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
}

function missingContractItems(
  profile: DocumentIntelligenceProfile | null,
  readiness: SectionReadiness | undefined,
  sectionKey: string,
): RequiredInformationDefinition[] {
  if (
    !profile?.informationContract || !readiness || readiness.ready !== false
  ) {
    return [];
  }
  const items = contractItemsForSection(profile, sectionKey);
  if (items.length === 0) return [];

  const exactKeys = new Set(
    (readiness.missing_information_keys ?? []).map(normaliseInformationKey),
  );
  const missingText = (readiness.missing_information ?? [])
    .map((value) => normaliseInformationKey(value))
    .filter(Boolean);

  const matched = items.filter((item) => {
    const key = normaliseInformationKey(item.key);
    if (exactKeys.has(key)) return true;
    const aliases = [
      item.key,
      item.label,
      item.placeholderLabel,
      item.question,
    ].map(normaliseInformationKey);
    return missingText.some((candidate) =>
      aliases.some((alias) =>
        candidate === alias ||
        candidate.includes(alias) ||
        alias.includes(candidate)
      )
    );
  });

  if (matched.length > 0) return matched;

  throw new DocumentGenerationError(
    `Could not map missing information to the resolved Enhanced DIP contract for section "${sectionKey}".`,
  );
}

function placeholderId(
  profileKey: string,
  sectionKey: string,
  informationKey: string,
): string {
  return [profileKey, sectionKey, informationKey]
    .map((value) => value.replace(/[^A-Za-z0-9._-]+/g, "_"))
    .join(".");
}

function unresolvedPlaceholdersForBrief(
  profile: DocumentIntelligenceProfile | null,
  brief: OutcomeBrief,
): UnresolvedDocumentPlaceholder[] {
  if (!profile?.informationContract) return [];
  const unresolved: UnresolvedDocumentPlaceholder[] = [];
  for (const readiness of brief.section_readiness ?? []) {
    for (
      const item of missingContractItems(profile, readiness, readiness.key)
    ) {
      if (item.automaticFallback?.trim()) continue;
      unresolved.push({
        id: placeholderId(profile.key, readiness.key, item.key),
        profileKey: profile.key,
        sectionKey: readiness.key,
        informationKey: item.key,
        label: item.placeholderLabel,
        question: item.question,
        factType: item.factType,
        requiredForExport: item.requiredForExport,
        sharedResolutionKey: item.sharedResolutionKey,
        neutralReplacementOptions: item.neutralReplacementOptions,
      });
    }
  }
  return unresolved;
}

function sectionResolutionDirective(
  profile: DocumentIntelligenceProfile | null,
  brief: OutcomeBrief,
  sectionKey: string,
): string {
  const readiness = readinessFor(brief, sectionKey);
  const items = missingContractItems(profile, readiness, sectionKey);
  if (items.length === 0) return "";

  const lines = [
    "ENHANCED DIP MISSING-FACT RESOLUTION — binding for this section:",
    "Use the declared handling below at the exact semantic location of each missing fact. Do not omit the fact silently and do not invent it.",
  ];
  for (const item of items) {
    if (item.automaticFallback?.trim()) {
      lines.push(
        `- ${item.key}: use the contract-declared automatic fallback exactly as a factual-neutral replacement: "${item.automaticFallback.trim()}". Do not emit a placeholder for this item.`,
      );
      continue;
    }
    const id = placeholderId(profile?.key ?? "document", sectionKey, item.key);
    const token = createDocumentPlaceholderToken(id, item.placeholderLabel);
    lines.push(
      `- ${item.key}: insert this exact token where the missing value belongs: ${token}. Contextual question: "${item.question}". required_for_export=${item.requiredForExport}; shared_resolution_key=${
        item.sharedResolutionKey ?? "<none>"
      }.`,
    );
  }
  return lines.join("\n");
}

function assertPlaceholderIntegrity(
  sections: readonly DraftSection[],
  placeholders: readonly UnresolvedDocumentPlaceholder[],
): void {
  for (const placeholder of placeholders) {
    const section = sections.find((candidate) =>
      candidate.key === placeholder.sectionKey
    );
    if (!section) {
      throw new DocumentGenerationError(
        `Missing section for unresolved placeholder ${placeholder.id}.`,
      );
    }
    const token = createDocumentPlaceholderToken(
      placeholder.id,
      placeholder.label,
    );
    if (!section.content.includes(token)) {
      throw new DocumentGenerationError(
        `Missing declared placeholder token ${placeholder.id} from generated section ${placeholder.sectionKey}.`,
      );
    }
  }
}

function contextFor(plan: SectionContext[], key: string): string {
  return plan.find((item) => item.key === key)?.relevant_content?.trim() ?? "";
}

function displayLabelFor(
  plan: SectionContext[],
  key: string,
  fallback: string,
): string {
  const label = plan.find((item) => item.key === key)?.display_label?.trim() ??
    "";
  // Guard against the model returning junk: keep it short, single-line, and
  // never let a personalised label hide what the section canonically is.
  if (!label || label.length > 90 || /\n/.test(label)) return fallback;
  return label;
}

// "compose" is the catalog's own deliberate signal that a document should be
// written as flowing prose rather than a strict data form. structureType is the
// intentional signal chosen by the catalog; trust it instead of re-deriving
// narrower, keyword-based guesses per document type.
function isCommunicationDocument(input: DocumentPipelineInput): boolean {
  return input.template.structureType === "compose";
}

function canDraftDespiteMissingInfo(
  _input: DocumentPipelineInput,
  _readiness: SectionReadiness | undefined,
): boolean {
  return true;
}

// A single section that TED genuinely could not write -- either because
// required information never arrived, or because the model produced only
// weak/instructional garbage after every writing and repair attempt -- must
// never take the rest of an otherwise-good document down with it (pass-gate
// rule: "Missing information never causes the section or document to be
// blanked, discarded or failed"). Instead of throwing, this isolates the
// failure inside the one section as a standard interactive TED placeholder,
// using the same token mechanism the Enhanced DIP contract already uses for
// declared missing facts, so the existing placeholder-resolution UI picks it
// up without new frontend work. Every other section is unaffected.
export function sectionFallbackPlaceholder(
  brief: OutcomeBrief,
  profile: DocumentIntelligenceProfile | null,
  section: Pick<ResolvedTemplate["sections"][number], "key" | "label">,
  readiness: SectionReadiness | undefined,
): { section: DraftSection; placeholder: UnresolvedDocumentPlaceholder } {
  const missing = readiness?.missing_information?.filter(Boolean) ?? [];
  const question = missing.length > 0
    ? `${section.label}: ${missing.join("; ")}`
    : `TED couldn't finish "${section.label}" automatically -- what should this section say?`;
  const label = `${section.label} needs your input`;
  const profileKey = profile?.key ?? "document";
  const id = placeholderId(profileKey, section.key, "section_content");
  const placeholder: UnresolvedDocumentPlaceholder = {
    id,
    profileKey,
    sectionKey: section.key,
    informationKey: "section_content",
    label,
    question,
    factType: "other",
    requiredForExport: true,
    neutralReplacementOptions: [],
  };
  return {
    section: {
      key: section.key,
      label: section.label,
      content: createDocumentPlaceholderToken(id, label),
    },
    placeholder,
  };
}

export function applySectionQualityGate(
  brief: OutcomeBrief,
  profile: DocumentIntelligenceProfile | null,
  templateSections: readonly Pick<
    ResolvedTemplate["sections"][number],
    "key" | "label"
  >[],
  draft: DraftSection[],
  blockingIssues: readonly ReviewIssue[],
): {
  draft: DraftSection[];
  documentLevelIssues: ReviewIssue[];
  blockedSectionKeys: string[];
} {
  const validSectionKeys = new Set(
    templateSections.map((section) => section.key),
  );
  const inferIssueSectionKeys = (issue: ReviewIssue): string[] => {
    if (issue.section_key && validSectionKeys.has(issue.section_key)) {
      return [issue.section_key];
    }

    const issueText = normaliseForSimilarity(
      [issue.finding, issue.required_correction].filter(Boolean).join(" "),
    );
    if (!issueText) return [];

    const byTemplateLabel = templateSections
      .filter((section) => {
        const sectionKey = normaliseForSimilarity(section.key);
        const sectionLabel = normaliseForSimilarity(section.label);
        return Boolean(sectionKey && issueText.includes(sectionKey)) ||
          Boolean(sectionLabel && issueText.includes(sectionLabel));
      })
      .map((section) => section.key);
    if (byTemplateLabel.length > 0) return byTemplateLabel;

    const issueNumbers = new Set(
      issueText.match(/\b\d+(?:[.,]\d+)*(?:\s*%)?/g)?.map((token) =>
        token.replace(/\s+/g, "").replace(/,/g, "")
      ) ?? [],
    );

    return draft
      .filter((section) => {
        if (!validSectionKeys.has(section.key)) return false;
        const contentText = normaliseForSimilarity(
          section.content.replace(
            new RegExp(DOCUMENT_PLACEHOLDER_TOKEN_PATTERN.source, "g"),
            " ",
          ),
        );
        if (!contentText) return false;

        const contentNumbers = contentText.match(
          /\b\d+(?:[.,]\d+)*(?:\s*%)?/g,
        )?.map((token) => token.replace(/\s+/g, "").replace(/,/g, "")) ?? [];
        if (
          contentNumbers.some((token) => issueNumbers.has(token)) &&
          issueNumbers.size > 0
        ) {
          return true;
        }

        const fragments = contentText
          .split(/\s+(?:and|but|because|while|with|without|that|which)\s+/)
          .flatMap((fragment) => fragment.split(/\s*[.;:]\s*/))
          .map((fragment) => fragment.trim())
          .filter((fragment) => fragment.length >= 24);
        return fragments.some((fragment) =>
          issueText.includes(fragment) || fragment.includes(issueText)
        );
      })
      .map((section) => section.key);
  };
  const declaredTokensBySection = new Map<string, Set<string>>();
  const sectionFallbackContent = new Map<string, string>();
  const sectionFallbackToken = new Map<string, string>();
  const registerDeclaredPlaceholder = (
    placeholder: UnresolvedDocumentPlaceholder,
  ) => {
    const tokens = declaredTokensBySection.get(placeholder.sectionKey) ??
      new Set<string>();
    tokens.add(
      createDocumentPlaceholderToken(placeholder.id, placeholder.label),
    );
    declaredTokensBySection.set(placeholder.sectionKey, tokens);
  };
  for (const placeholder of unresolvedPlaceholdersForBrief(profile, brief)) {
    registerDeclaredPlaceholder(placeholder);
  }
  for (const templateSection of templateSections) {
    const fallback = sectionFallbackPlaceholder(
      brief,
      profile,
      templateSection,
      readinessFor(brief, templateSection.key),
    );
    registerDeclaredPlaceholder(fallback.placeholder);
    sectionFallbackContent.set(
      templateSection.key,
      fallback.section.content,
    );
    sectionFallbackToken.set(
      templateSection.key,
      createDocumentPlaceholderToken(
        fallback.placeholder.id,
        fallback.placeholder.label,
      ),
    );
  }
  const recoveredBlankOutput = templateSections.length > 0 &&
    templateSections.every((templateSection) => {
      const section = draft.find((candidate) =>
        candidate.key === templateSection.key
      );
      if (!section) return false;
      const parsedTokens = parseDocumentPlaceholderTokens(section.content);
      const declaredTokens = declaredTokensBySection.get(templateSection.key);
      if (
        parsedTokens.length === 0 || !declaredTokens ||
        !parsedTokens.every((token) => declaredTokens.has(token.token))
      ) {
        return false;
      }
      const fallbackToken = sectionFallbackToken.get(templateSection.key);
      const containsWholeSectionFallback = parsedTokens.some((token) =>
        token.token === fallbackToken
      );
      return !containsWholeSectionFallback ||
        section.content === sectionFallbackContent.get(templateSection.key);
    });
  const documentLevelIssues = blockingIssues.filter((issue) => {
    const isUnscoped = !issue.section_key ||
      !validSectionKeys.has(issue.section_key);
    if (!isUnscoped) return false;
    return !(issue.category === "blank_output" && recoveredBlankOutput);
  });
  const recoverableDocumentIssueCategories = new Set([
    "blank_output",
    "instruction_leakage",
    "fact",
  ]);
  const recoverableDocumentIssues = documentLevelIssues.filter((issue) =>
    recoverableDocumentIssueCategories.has(issue.category)
  );
  const inferredRecoverableDocumentIssueKeys = new Set(
    recoverableDocumentIssues.flatMap(inferIssueSectionKeys),
  );
  const unresolvedRecoverableDocumentIssues = recoverableDocumentIssues.filter((
    issue,
  ) => inferIssueSectionKeys(issue).length === 0);
  const unrecoverableDocumentLevelIssues = documentLevelIssues.filter((
    issue,
  ) => !recoverableDocumentIssueCategories.has(issue.category));
  const blockedSectionKeys = [
    ...new Set([
      ...blockingIssues
        .map((issue) => issue.section_key)
        .filter((key): key is string =>
          typeof key === "string" && validSectionKeys.has(key)
        ),
      ...inferredRecoverableDocumentIssueKeys,
    ]),
  ];
  const hasRecoverableDocumentLevelIssue =
    unresolvedRecoverableDocumentIssues.length > 0;
  const blocked = new Set(blockedSectionKeys);
  const isolatedDraft = draft.map((section) => {
    if (!blocked.has(section.key) && !hasRecoverableDocumentLevelIssue) {
      return section;
    }
    const templateSection = templateSections.find((candidate) =>
      candidate.key === section.key
    );
    if (!templateSection) return section;
    return sectionFallbackPlaceholder(
      brief,
      profile,
      templateSection,
      readinessFor(brief, section.key),
    ).section;
  });
  return {
    draft: isolatedDraft,
    documentLevelIssues: unrecoverableDocumentLevelIssues,
    blockedSectionKeys,
  };
}

export function mergeFinalPlaceholders(
  declaredPlaceholders: readonly UnresolvedDocumentPlaceholder[],
  sectionFallbacks: readonly UnresolvedDocumentPlaceholder[],
): UnresolvedDocumentPlaceholder[] {
  const fallbackSectionKeys = new Set(
    sectionFallbacks.map((placeholder) => placeholder.sectionKey),
  );
  return [
    ...declaredPlaceholders.filter((placeholder) =>
      !fallbackSectionKeys.has(placeholder.sectionKey)
    ),
    ...sectionFallbacks,
  ];
}

function normaliseForSimilarity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ")
    .trim();
}

function looksLikeSectionPurpose(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  const compact = normaliseForSimilarity(text);
  const hasQuestion = /\?/.test(text);
  const hasListOrParagraphDepth = /\n|^\s*[-*]\s+/m.test(text) ||
    text.length >= 260;

  return !hasQuestion && !hasListOrParagraphDepth &&
    /\b(prepare|ask questions|show|surface|builds|helps|identify|plan|use this|gives you|reduces|ensures|covers|prompts you)\b/
      .test(compact);
}

function isNearCopyOfHint(value: string, hint?: string): boolean {
  if (!hint) return false;
  const written = normaliseForSimilarity(value);
  const source = normaliseForSimilarity(hint);
  if (!written || !source) return false;
  if (
    written === source || written.includes(source) || source.includes(written)
  ) return true;

  const writtenWords = new Set(
    written.split(" ").filter((word) => word.length > 4),
  );
  const sourceWords = source.split(" ").filter((word) => word.length > 4);
  if (writtenWords.size === 0 || sourceWords.length === 0) return false;
  const overlap = sourceWords.filter((word) => writtenWords.has(word)).length /
    sourceWords.length;
  return overlap >= 0.72 && value.trim().length < 320;
}

function isWeakOrInstructionalContent(
  value: string,
  section?: ResolvedTemplate["sections"][number],
): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  return /\b(this section (?:will|supports|should)|here you would|the user should|consider including|insert|placeholder only|draft scaffold|ted will replace|no matching sections)\b/i
    .test(value) ||
    looksLikeSectionPurpose(value) ||
    isNearCopyOfHint(value, section?.hint);
}

function hasWeakOutputCorrection(corrections: ReviewIssue[]): boolean {
  return corrections.some((issue) =>
    issue.category === "completeness" &&
    /section-purpose|purpose-only|actual material/i.test(issue.finding)
  );
}

function weakOutputCorrection(
  section: ResolvedTemplate["sections"][number],
): ReviewIssue {
  return {
    severity: "high",
    category: "completeness",
    section_key: section.key,
    finding:
      "section-purpose-only output: the draft described what the section should help with instead of writing the actual section material.",
    required_correction:
      "Rewrite this section as the actual usable material. Do not say what to prepare, what to ask, or what the section helps with. If the section needs questions, write the real questions. If it needs sample answers, write sample first-person answers. If it needs examples, write the concrete examples or answer frameworks grounded in the provided context.",
  };
}

async function interpretIntent(
  input: DocumentPipelineInput,
  profile: DocumentIntelligenceProfile | null,
): Promise<OutcomeBrief> {
  const context = [
    `Requested document: ${input.template.name}`,
    `Document structure type: ${input.template.structureType}`,
    `Situation: ${input.situation}`,
    input.conversationContext &&
    `Conversation context:\n${input.conversationContext}`,
    input.uploadContext && `Upload context:\n${input.uploadContext}`,
    input.extractedText && `Source material:\n${input.extractedText}`,
    input.memoryContext && `Relevant saved context:\n${input.memoryContext}`,
    profile && `Resolved Enhanced DIP:\n${renderProfile(profile, "intent")}`,
    `Required sections:\n${
      input.template.sections.map((section) =>
        `- ${renderSectionRequirements(section)}`
      ).join("\n")
    }`,
  ].filter(Boolean).join("\n\n");

  const result = await routeRequest({
    task: "intent",
    systemPrompt: `You are TED's Intent Architect.

Product identity: PrompTED is AI for the rest of us. It exists for non-tech-savvy people so they do not get left behind. The enemy is confusion. Your job is to remove confusion before drafting starts.

Separate unsupported factual claims from useful generated guidance.

Use educated professional judgement instead of making the user specify ordinary document choices. Distinguish:
- confirmed facts: details supplied by the user, profile, memory or uploads
- safe assumptions: conventional, reversible choices TED should make to finish the document, such as structure, ordering, professional tone, neutral wording, standard headings, sensible next steps, relative sequencing and clearly framed recommendations
- critical unknowns: facts whose absence would make the document materially misleading, unsafe or unusable

Do not ask for or block on a choice that a capable document professional could make safely. Never treat identity, exact dates, figures, credentials, past events, legal status, obligations, evidence or regulatory conclusions as safe assumptions. Record every safe assumption in safe_assumptions so the writer and auditor apply it consistently.

For factual documents, mark a section not ready when a vital fact is missing and list each exact missing fact. Not-ready means incomplete information, not a drafting prohibition: generation still continues using only the resolved template's declared structured TED placeholder or approved neutral fallback at the exact missing fact.

For emails, letters, replies, follow-up messages and other communication documents, a section is ready when the purpose, broad audience and main context are known. Missing recipient names, employer names, exact interview dates, email addresses or similar optional details must not block drafting. Instead, the writer should use a neutral greeting, avoid unsupported specifics and write a complete usable message from the known context.

For plans, routines, checklists, roadmaps and action documents, a section is ready when TED knows the user's goal, relevant constraints and preferred approach. Practical proposed steps, sequencing, routines, recommendations and relative timeframes are allowed because they are guidance, not claims about the user's past or circumstances.

For documents whose sections call for example content -- practice questions, sample answers, illustrative scenarios, or similar -- a section is ready once the relevant background and goal are known. The final document must contain the actual examples, questions, or sample wording themselves. Do not mark these sections not ready merely because the exact wording of each example is not dictated word-for-word by the user.

Never manufacture personal facts, past events, fixed dates, exact figures, credentials, legal conclusions or source evidence. If a section lacks vital facts, mark it not ready and list the exact missing facts so the resolved DIP can expose the corresponding placeholder and clarification metadata while drafting continues.

Return strict JSON with: user_goal, primary_outcome, audience, author_perspective, tone, required_content, prohibited_content, known_facts, safe_assumptions, missing_critical_information, section_readiness, confidence.

When a resolved Enhanced DIP information contract is supplied, every missing required fact MUST be identified by its exact information_key from that contract. Never invent a key and never substitute a prose label where a key is available.

section_readiness must contain one entry for every supplied section: {"key":"section_key","ready":true|false,"missing_information":["plain-language missing fact"],"missing_information_keys":["exact_contract_information_key"]}. If the section is ready, both missing arrays are empty.`,
    messages: [{ role: "user", content: context }],
    // section_readiness needs one entry per template section (each carrying
    // up to two missing-fact arrays), so this response scales with section
    // count the same way the later planner/review/audit stages do — but
    // this was the only one of the four requireJson pipeline calls left at
    // the original 1800 budget while the others were raised to 2400-5000.
    // On templates with several sections that's tight enough to truncate
    // mid-JSON, which fails isJsonContainerResponse() and burns the whole
    // provider fallback chain for nothing. Matched to the review stage's
    // budget rather than the largest (audit) stage, since this JSON is
    // comparable in shape to that one, not the per-unit audit response.
    maxTokens: 3200,
    requireJson: true,
    signal: input.signal,
  });

  return parsePipelineJson<OutcomeBrief>(result.text);
}

// The Document-Generator Planner. Runs once per document, after intent is
// confirmed -- not once per section. Sorts the full conversation/upload
// material into the section(s) it actually belongs to, so writeSection()
// never has to re-send (or re-search) the whole source blob for every
// section. Returns "" for a section's relevant_content when nothing in the
// source material belongs there; that is a correct result, not a failure.
async function planSections(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  profile: DocumentIntelligenceProfile | null,
): Promise<SectionContext[]> {
  const hasSourceMaterial = Boolean(
    input.conversationContext || input.uploadContext || input.extractedText,
  );

  // Nothing to sort -- skip the call entirely rather than spend a round trip
  // producing an all-empty map.
  if (!hasSourceMaterial) {
    return input.template.sections.map((section) => ({
      key: section.key,
      relevant_content: "",
    }));
  }

  const context = [
    `Document: ${input.template.name}`,
    `Approved outcome brief:\n${JSON.stringify(brief)}`,
    profile && `Resolved Enhanced DIP:\n${renderProfile(profile, "intent")}`,
    `Sections:\n${
      input.template.sections.map((section) =>
        `- ${renderSectionRequirements(section)}`
      ).join("\n")
    }`,
    `Original situation:\n${input.situation}`,
    input.conversationContext &&
    `Conversation context:\n${input.conversationContext}`,
    input.uploadContext && `Upload context:\n${input.uploadContext}`,
    input.extractedText && `Source material:\n${input.extractedText}`,
  ].filter(Boolean).join("\n\n");

  const result = await routeRequest({
    task: "intent",
    systemPrompt: `You are TED's Document Planner.

Product identity: PrompTED is AI for the rest of us. The enemy is confusion. Your job is to sort the user's conversation and uploaded material into the section it actually belongs to, so the writer for each section only sees what's relevant to that section instead of the whole document.

For every section listed, pull out the specific facts, statements and details from the conversation and source material that belong in that section. Quote or closely paraphrase the source -- do not invent, infer, embellish, or add anything not present in the supplied text. This is sorting and extraction, not drafting.

The same fact may belong in more than one section if it is genuinely relevant to both (e.g. years of experience may belong in both a summary section and an experience section). Do not force an exclusive one-section-only split.

If nothing in the supplied text is relevant to a section, return an empty string for that section's relevant_content. An empty result is correct and expected for some sections -- never pad it with invented content to avoid an empty string.

Also propose a display_label for each section: the section's canonical name personalised to this user's actual situation, so the document feels written for them, not from a template. Rules for display_label: keep the canonical meaning clearly visible (a Revenue section must still read as revenue, e.g. "Revenue — Scarlett Paper Trader FY2026"); use real names, employers, subjects or periods from the supplied material only; maximum 70 characters; single line; if the material gives you nothing specific, return the canonical name unchanged. Never invent details for a label.

Return strict JSON only: {"section_context":[{"key":"section_key","relevant_content":"...","display_label":"..."}]}. Include exactly one entry per supplied section key, in the order given.`,
    messages: [{ role: "user", content: context }],
    // Same truncation class as the intent-brief and quality-gate stages
    // (both confirmed in production): section_context needs one entry per
    // section, and relevant_content can genuinely be lengthy on templates
    // with long conversation/upload material, so this scales on two axes
    // at once rather than one.
    maxTokens: 4000,
    requireJson: true,
    signal: input.signal,
  });

  let parsed: { section_context?: SectionContext[] };
  try {
    parsed = parsePipelineJson<{ section_context: SectionContext[] }>(
      result.text,
    );
  } catch {
    // Planner output didn't parse -- fall back to empty map rather than fail
    // the whole document. writeSection still has the outcome brief's
    // known_facts and the section hint/prefilled data to draw on.
    return input.template.sections.map((section) => ({
      key: section.key,
      relevant_content: "",
    }));
  }

  const byKey = new Map(
    (parsed.section_context ?? []).map((item) => [item.key, item]),
  );
  return input.template.sections.map((section) => {
    const item = byKey.get(section.key);
    return {
      key: section.key,
      relevant_content: item?.relevant_content ?? "",
      display_label: typeof item?.display_label === "string"
        ? item.display_label
        : undefined,
    };
  });
}

async function writeSection(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  section: ResolvedTemplate["sections"][number],
  plan: SectionContext[],
  profile: DocumentIntelligenceProfile | null,
  corrections: ReviewIssue[] = [],
): Promise<DraftSection> {
  const readiness = readinessFor(brief, section.key);

  if (
    readiness && readiness.ready === false &&
    !canDraftDespiteMissingInfo(input, readiness)
  ) {
    return sectionFallbackPlaceholder(brief, profile, section, readiness)
      .section;
  }

  const relevantCorrections = corrections.filter(
    (issue) => !issue.section_key || issue.section_key === section.key,
  );

  const sectionMaterial = contextFor(plan, section.key);
  const resolutionDirective = sectionResolutionDirective(
    profile,
    brief,
    section.key,
  );

  const content = [
    `Approved outcome brief:\n${JSON.stringify(brief)}`,
    `Original situation:\n${input.situation}`,
    input.conversationContext &&
    `Primary source of truth — the user's conversation:\n${
      boundedConversationSource(input.conversationContext)
    }`,
    sectionMaterial &&
    `Relevant material gathered for this section:\n${sectionMaterial}`,
    profile && `Resolved Enhanced DIP:\n${renderProfile(profile, "document")}`,
    resolutionDirective,
    `Write the final finished wording for the section titled "${section.label}".`,
    section.hint && `Section purpose only, not output text: ${section.hint}`,
    section.vital?.length &&
    `Vital facts that must be reflected when supplied: ${
      section.vital.join("; ")
    }.`,
    section.improver?.length &&
    `Optional quality improvers to use when supplied, but never invent or block on: ${
      section.improver.join("; ")
    }.`,
    "Write the actual material this section needs, not a description of it. If the section calls for questions, write the real questions. If it calls for examples or sample answers, write the real examples or sample wording in the user's voice. If it calls for a list, write the real list items. A one-line summary of what the section is for is never an acceptable substitute for the section itself.",
    section.prefilled && `Known details for this section: ${section.prefilled}`,
    relevantCorrections.length > 0 &&
    `Required audit corrections:\n${
      relevantCorrections.map((issue) => `- ${issue.required_correction}`).join(
        "\n",
      )
    }`,
    "Product rule: PrompTED is AI for the rest of us. Remove confusion. Write for non-tech-savvy people without dumbing the document down.",
    "Treat the user's complete conversation as the primary source of truth for their goal, facts, constraints, corrections, priorities, tone and intended reader. Preserve every conversation detail that is relevant to this section. Uploaded files, profile memory and professional conventions may strengthen the result, but they must not overwrite, contradict or dilute what the user said.",
    "Use confirmed facts for any statement about the user, business, history, dates, figures, qualifications or circumstances.",
    "Ground every factual clause in an exact fact from the user's conversation, upload, extracted source or approved outcome brief. Do not infer typical duties, methods, training, audits, causes, improvements, safety results, awards, targets, provider accreditation or performance outcomes merely because they would be plausible for the role.",
    "Before returning the section, silently check each sentence that describes the user's past or present. If you cannot point to the supplied evidence for every factual clause, remove that clause. Professional phrasing may improve the wording, but it may never add a new event, action, method, responsibility, cause, result or credential.",
    "Apply the outcome brief's safe assumptions decisively. TED is expected to make conventional professional choices about structure, ordering, neutral wording, tone, standard headings, useful recommendations and next steps so the result is complete without unnecessary questions.",
    "Never present a safe assumption as a confirmed personal fact. If it is a proposed action, recommendation, relative timeframe or conventional clause, word it honestly as guidance or neutral document wording.",
    "Write in the user's voice. Match the user's tone and language where available, while keeping the document appropriate for its audience.",
    "For emails, letters, replies and follow-up messages, write a complete usable message from the known context. If a recipient name is unknown, use a neutral greeting. If employer or interviewer details are unknown, do not mention them.",
    "For a plan, checklist, routine, roadmap, recommendations or interview preparation section, generate practical, specific content from the confirmed goal and constraints. Clearly frame proposed actions as guidance rather than established facts.",
    "Never invent personal details, past events, exact figures, fixed dates, credentials, legal conclusions or evidence.",
    "If a factual value declared by the resolved Enhanced DIP is missing, use only its exact declared TED placeholder token or its contract-declared automatic fallback. Do not write around a required missing fact, hide the gap, invent a value, use raw bracket placeholders, or return an empty response.",
    "Do not copy, lightly rewrite, or paraphrase the section purpose/hint as the section content. The section content must be the useful material itself.",
    "Return only ready-to-use markdown for this section. Do not return instructions, criteria, an outline, code-like text, scaffold text, commentary, or a description of what should be written.",
  ].filter(Boolean).join("\n\n");

  const result = await routeRequest({
    task: "document",
    systemPrompt: input.systemPrompt,
    messages: [{ role: "user", content }],
    maxTokens: 2600,
    signal: input.signal,
  });

  const written = result.text.trim();
  if (isWeakOrInstructionalContent(written, section)) {
    if (!hasWeakOutputCorrection(relevantCorrections)) {
      return writeSection(input, brief, section, plan, profile, [
        ...corrections,
        weakOutputCorrection(section),
      ]);
    }
    // Second weak result: degrade to the best clean wording rather than
    // failing the whole document. enforceFinalText still validates it.
    const salvaged = stripResidual(written);
    if (salvaged) {
      return {
        key: section.key,
        label: displayLabelFor(plan, section.key, section.label),
        content: salvaged,
      };
    }
    return sectionFallbackPlaceholder(brief, profile, section, readiness)
      .section;
  }

  return {
    key: section.key,
    label: displayLabelFor(plan, section.key, section.label),
    content: written,
  };
}

async function generateDraft(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  plan: SectionContext[],
  profile: DocumentIntelligenceProfile | null,
  corrections: ReviewIssue[] = [],
  sectionKeys?: readonly string[],
): Promise<DraftSection[]> {
  const selected = sectionKeys
    ? input.template.sections.filter((section) =>
      sectionKeys.includes(section.key)
    )
    : input.template.sections;

  // Three concurrent section writes substantially reduce wall-clock time while
  // avoiding an unbounded burst against the configured provider.
  return mapWithConcurrency(
    selected,
    3,
    async (section) => {
      const written = await writeSection(
        input,
        brief,
        section,
        plan,
        profile,
        corrections,
      );
      if (validateSection(written).length === 0) {
        input.onDraftSection?.(written);
      }
      return written;
    },
  );
}

async function auditDraft(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  sections: DraftSection[],
  profile: DocumentIntelligenceProfile | null,
): Promise<ReviewResult> {
  const profileAudit = profile
    ? renderProfile(profile, "review")
    : "No document-specific profile was selected. Apply the universal checks below.";
  const result = await routeRequest({
    task: "edit",
    systemPrompt:
      `You are TED's independent document quality auditor. You do not write, rewrite, edit or replace the document.

Product identity: PrompTED is AI for the rest of us. It exists for non-tech-savvy people so they do not get left behind. The enemy is confusion.

Audit the draft against the approved outcome brief and source context. Check:
- factual claims against confirmed source information
- alignment with the user's intent and requested outcome
- tone alignment with the user's own language where available
- required structure and section order
- appropriate document layout
- completeness of every section and whether the document is ready to use without mandatory rewriting
- intelligent use of safe assumptions for ordinary professional choices, without turning them into claims about the user
- no unnecessary gaps merely because the user did not dictate standard wording, ordering, recommendations or next steps
- no blank sections, even when vital facts are missing
- absence of invented personal facts, unsupported context, undeclared or context-free placeholders and writing instructions
- absence of code-like or meta-instruction text such as "this section will", "the user should", "consider including", "insert", "draft scaffold" or "no matching sections"
- absence of section-purpose paraphrases, such as one-line content that merely says what to prepare, what to ask, or what the section helps with

Factual grounding is a hard gate. Silently inspect every sentence or bullet that describes the user's past or present and locate its exact supporting fact in the original situation, conversation, upload, extracted source or saved context. If no supporting fact exists, return a high-severity fact issue for that section. Typical-role assumptions are not evidence. Duties, methods, training, audits, causes, improvements, safety outcomes, awards, targets, accreditation and performance results are all factual claims and must be supported explicitly. Do not approve a plausible claim merely because it sounds professional.

Emails, letters, replies and follow-up messages may use neutral wording when optional recipient or employer details are missing. Do not fail a complete communication document merely because it avoids unknown names or exact dates.

Plans, routines, checklists, recommendations, and any document whose sections call for example content (practice questions, sample answers, illustrative scenarios) may contain sensible proposed actions, likely questions, answer frameworks and sample wording derived from the confirmed goal and constraints. Do not treat practical guidance as a fabricated fact merely because the user did not dictate each step.

Sections must contain final, send-ready wording. Declared structured TED placeholders are valid unresolved document content and must be ignored as editorial/factual claims; raw bracket placeholders, generic fill-in markers, missing-details lines and bare section-purpose descriptions remain forbidden. It must not be blank.

Document-specific final quality and benchmark comparison:
${profileAudit}

Treat every failed document-specific quality rule as an issue. Compare the draft's observable structure, length, depth, specificity, tone, formality and usability with the benchmark standards described in the profile. The benchmark is a quality reference only: do not copy example wording and do not add facts merely to resemble it.

Return strict JSON only: {"decision":"approve|changes_required","issues":[{"severity":"low|medium|high","category":"fact|intent|tone|structure|layout|completeness|instruction_leakage|blank_output","section_key":"canonical section key, required for section-specific issues; omit only when the finding genuinely applies to the whole document","finding":"...","required_correction":"..."}]}. Use only section keys present in the supplied complete draft.

Do not provide corrected prose. Findings must be specific enough for the original writer to correct its own document.`,
    messages: [{
      role: "user",
      content: [
        `Outcome brief:\n${JSON.stringify(brief)}`,
        `Original situation:\n${input.situation}`,
        input.conversationContext &&
        `Conversation context:\n${input.conversationContext}`,
        input.extractedText && `Source material:\n${input.extractedText}`,
        `Complete draft:\n${JSON.stringify(sections)}`,
      ].filter(Boolean).join("\n\n"),
    }],
    // Confirmed truncating in production via the invalid_json_response
    // diagnostic added in the intent-brief fix: a real response was cut off
    // mid-string inside the issues array ("section_key": "closing", with no
    // closing quote). This array scales with how many quality issues the
    // draft has across every section, so it's not bounded by a fixed shape
    // the way maxTokens: 3000 assumed. Matched to the audit stage's budget.
    maxTokens: 5000,
    requireJson: true,
    signal: input.signal,
  });

  const reviewed = parsePipelineJson<ReviewResult>(result.text);
  const sourceEvidence = [
    input.situation,
    input.conversationContext,
    input.uploadContext,
    input.extractedText,
    input.memoryContext,
  ].filter(Boolean).join("\n");
  const numericIssues: ReviewIssue[] = sections.flatMap((section) =>
    findUnsupportedNumericClaims(section.content, sourceEvidence).map((
      claim,
    ) => ({
      severity: "high" as const,
      category: "fact" as const,
      section_key: section.key,
      finding: `Unsupported numeric claim: ${claim}`,
      required_correction:
        `Remove ${claim} unless that exact figure is present in the confirmed source evidence. Never replace it with another estimated figure.`,
    }))
  );
  if (numericIssues.length === 0) return reviewed;

  const existing = new Set(
    reviewed.issues.map((issue) =>
      `${issue.section_key ?? ""}|${issue.category}|${issue.finding}`
    ),
  );
  const issues = [
    ...reviewed.issues,
    ...numericIssues.filter((issue) =>
      !existing.has(
        `${issue.section_key ?? ""}|${issue.category}|${issue.finding}`,
      )
    ),
  ];
  return { decision: "changes_required", issues };
}

function factualAuditUnits(sections: DraftSection[]): FactualAuditUnit[] {
  return sections.flatMap((section) => {
    let index = 0;
    return section.content
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))
      .map((text) => text.trim())
      .filter((text) => {
        if (!text || !/[a-z0-9]/i.test(text)) return false;
        const plain = text.replace(/^#+\s*/, "").replace(/\*/g, "").trim();
        const factualText = plain.replace(
          new RegExp(DOCUMENT_PLACEHOLDER_TOKEN_PATTERN.source, "g"),
          "",
        ).trim();
        return Boolean(factualText) &&
          factualText.toLowerCase() !== section.label.toLowerCase();
      })
      .map((text) => ({
        id: `${section.key}#${++index}`,
        sectionKey: section.key,
        text,
      }));
  });
}

async function auditFactualGrounding(
  input: DocumentPipelineInput,
  sections: DraftSection[],
): Promise<ReviewResult> {
  const units = factualAuditUnits(sections);
  if (units.length === 0) {
    return {
      decision: "changes_required",
      issues: [{
        severity: "high",
        category: "blank_output",
        finding: "No final wording was available for factual review.",
        required_correction: "Write complete final wording before release.",
      }],
    };
  }

  const sourceEvidence = [
    input.situation,
    input.conversationContext,
    input.uploadContext,
    input.extractedText,
    input.memoryContext,
  ].filter(Boolean).join("\n\n");
  const result = await routeRequest({
    task: "edit",
    systemPrompt:
      `You are TED's factual-grounding examiner. This is a separate hard gate from style and benchmark review.

For every supplied unit, classify it as exactly one of:
- supported: every personal, business, historical, present-tense or credential claim in the unit is explicitly supported by the source evidence
- convention: neutral standard document wording that makes no claim about the user's history or circumstances
- guidance: clearly framed advice, recommendation, proposed action, example or plan, not presented as an established fact
- unsupported: any factual clause is invented, inferred from a typical role, exaggerated, or only partly supported

Typical duties and plausible professional detail are not evidence. Methods, scheduling, training, audits, causes, improvements, safety outcomes, client effects, business effects, awards, targets, provider names, accreditation, skill level and performance results all require explicit source support.

Declared TED_PLACEHOLDER tokens are unresolved information slots supplied by the resolved template, not factual claims. Ignore the declared placeholder token itself when judging a unit, but continue to assess every surrounding factual clause normally. A placeholder never supplies evidence for another claim.

For a supported unit, provide one or more evidence_quotes copied verbatim from the source. The quotes together must support every factual clause, not merely the general topic. If any fragment lacks support, classify the whole unit unsupported and list each unsupported fragment. Convention and guidance need no evidence quote, but never use those labels to excuse a claim about what the user did, has, achieved, knows or is.

Return exactly one entry for every unit_id and no others. Return strict JSON only:
{"units":[{"unit_id":"...","classification":"supported|convention|guidance|unsupported","evidence_quotes":["exact source quote"],"unsupported_fragments":["exact unsupported fragment"]}]}`,
    messages: [{
      role: "user",
      content: `SOURCE EVIDENCE:\n${sourceEvidence}\n\nDRAFT UNITS:\n${
        units.map((unit) => `${unit.id}: ${unit.text}`).join("\n")
      }`,
    }],
    maxTokens: 5000,
    requireJson: true,
    signal: input.signal,
  });
  const parsed = parsePipelineJson<{ units: FactualAuditEntry[] }>(result.text);
  const issues = groundingIssuesFromAudit(
    units,
    Array.isArray(parsed.units) ? parsed.units : [],
    sourceEvidence,
  );
  return {
    decision: issues.length > 0 ? "changes_required" : "approve",
    issues,
  };
}

async function auditDocument(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  sections: DraftSection[],
  profile: DocumentIntelligenceProfile | null,
): Promise<ReviewResult> {
  const [grounding, quality] = await Promise.all([
    auditFactualGrounding(input, sections),
    auditDraft(input, brief, sections, profile),
  ]);
  const issues = [...grounding.issues, ...quality.issues];
  return {
    decision: issues.length > 0 ? "changes_required" : "approve",
    issues,
  };
}

function ensureNoBlankSections(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  draft: DraftSection[],
  profile: DocumentIntelligenceProfile | null,
): DraftSection[] {
  const byKey = new Map(draft.map((section) => [section.key, section]));
  return input.template.sections.map((section) => {
    const existing = byKey.get(section.key);
    // Weak content is repaired (retried, then stripped) in enforceFinalText;
    // only a truly missing/empty section is isolated here.
    if (existing && existing.content.trim()) return existing;
    return sectionFallbackPlaceholder(
      brief,
      profile,
      section,
      readinessFor(brief, section.key),
    ).section;
  });
}

// Deterministic backstop: nothing leaky/blank can leave this function --
// a section that still can't be salvaged after retry becomes an isolated
// placeholder (see sectionFallbackPlaceholder) rather than failing the
// whole document.
async function enforceFinalText(
  input: DocumentPipelineInput,
  brief: OutcomeBrief,
  draft: DraftSection[],
  plan: SectionContext[],
  profile: DocumentIntelligenceProfile | null,
): Promise<DraftSection[]> {
  const cleaned: DraftSection[] = [];
  for (const section of draft) {
    const tplForSection = input.template.sections.find((s) =>
      s.key === section.key
    );
    if (
      validateSection(section).length === 0 &&
      !isWeakOrInstructionalContent(section.content, tplForSection)
    ) {
      cleaned.push(section);
      continue;
    }
    const tpl = input.template.sections.find((s) => s.key === section.key);
    if (tpl) {
      const retry = await writeSection(input, brief, tpl, plan, profile, [{
        severity: "high",
        category: "instruction_leakage",
        section_key: section.key,
        finding:
          "Section contained an undeclared/raw placeholder, fill-in marker, writing instruction, or section-purpose text instead of final content.",
        required_correction:
          "Rewrite as final, ready-to-use wording using only confirmed facts, safe professional conventions, approved neutral fallbacks, and any declared structured TED placeholders supplied by the resolved template. Raw bracket placeholders, generic fill-in markers, instructions, or paraphrases of the section purpose are forbidden. If this section calls for example content, include the actual questions, sample answers, or wording, not a description of what should be included.",
      }]);
      if (
        validateSection(retry).length === 0 &&
        !isWeakOrInstructionalContent(retry.content, tpl)
      ) {
        cleaned.push(retry);
        continue;
      }
      const stripped = stripResidual(retry.content) ||
        stripResidual(section.content);
      if (!stripped) {
        cleaned.push(
          sectionFallbackPlaceholder(
            brief,
            profile,
            tpl,
            readinessFor(brief, tpl.key),
          ).section,
        );
        continue;
      }
      cleaned.push({ ...retry, content: stripped });
      continue;
    }
    const stripped = stripResidual(section.content);
    if (!stripped || isWeakOrInstructionalContent(stripped)) {
      cleaned.push(
        sectionFallbackPlaceholder(
          brief,
          profile,
          tpl ?? section,
          readinessFor(brief, section.key),
        ).section,
      );
      continue;
    }
    cleaned.push({ ...section, content: stripped });
  }
  return cleaned;
}

export interface SectionMissingInfo {
  key: string;
  label: string;
  missing: string[];
}

export interface DocumentPipelineResult {
  sections: DraftSection[];
  /** Backwards-compatible summary for older clients. */
  missingInfo: SectionMissingInfo[];
  /** Canonical Enhanced DIP unresolved state. */
  unresolvedPlaceholders: UnresolvedDocumentPlaceholder[];
}

export async function runDocumentPipeline(
  input: DocumentPipelineInput,
): Promise<DocumentPipelineResult> {
  const profile = resolvedProfileFor(input);
  const brief = await interpretIntent(input, profile);
  const plan = await planSections(input, brief, profile);
  let draft = ensureNoBlankSections(
    input,
    brief,
    await generateDraft(input, brief, plan, profile),
    profile,
  );
  let audit = await auditDocument(input, brief, draft, profile);

  // Give the original section writers two bounded, targeted opportunities to
  // address the independent audit. A single repair pass was too brittle: one
  // remaining low-severity wording preference discarded every otherwise safe
  // section and surfaced an entirely blank document to the user.
  for (
    let repairRound = 0;
    repairRound < 2 &&
    audit.decision === "changes_required" &&
    audit.issues.length > 0;
    repairRound += 1
  ) {
    const allKeys = input.template.sections.map((section) => section.key);
    const rewriteKeys = affectedSectionKeys(audit.issues, allKeys);
    const rewrittenSections = await generateDraft(
      input,
      brief,
      plan,
      profile,
      audit.issues,
      rewriteKeys,
    );
    draft = ensureNoBlankSections(
      input,
      brief,
      mergeByKey(draft, rewrittenSections),
      profile,
    );
    audit = await auditDocument(input, brief, draft, profile);
  }

  // Medium and high failures remain a hard boundary for the section they
  // affect. They must not erase sections that passed: a resume with one
  // flagged bullet is worth more to the user than no resume at all.
  //
  // Issues carrying a section_key are scoped to that section. Issues without
  // one are document-level and still fail the whole document, because we
  // cannot tell which section is unsafe.
  const blockingIssues = audit.issues.filter((issue) =>
    issue.severity === "medium" || issue.severity === "high"
  );
  const gate = applySectionQualityGate(
    brief,
    profile,
    input.template.sections,
    draft,
    blockingIssues,
  );
  draft = gate.draft;
  const documentLevelIssues = gate.documentLevelIssues;
  const blockedSectionKeys = new Set(gate.blockedSectionKeys);
  const validSectionKeys = new Set(
    input.template.sections.map((section) => section.key),
  );
  if (blockingIssues.length > 0) {
    console.warn("DOCUMENT_QUALITY_GATE", {
      blockingIssueCount: blockingIssues.length,
      blockedSectionKeys: [...blockedSectionKeys],
      documentLevelIssueCount: documentLevelIssues.length,
      invalidSectionKeys: [
        ...new Set(
          blockingIssues
            .map((issue) => issue.section_key)
            .filter((key): key is string =>
              typeof key === "string" && !validSectionKeys.has(key)
            ),
        ),
      ],
      categories: [...new Set(blockingIssues.map((issue) => issue.category))],
    });
  }

  if (documentLevelIssues.length > 0) {
    const categories = [
      ...new Set(documentLevelIssues.map((issue) => issue.category)),
    ].join(",");
    throw new Error(
      categories
        ? `DOCUMENT_QUALITY_FAILED:${categories}`
        : "DOCUMENT_QUALITY_FAILED",
    );
  }

  const guarded = ensureNoBlankSections(input, brief, draft, profile);
  const sections = await enforceFinalText(input, brief, guarded, plan, profile);

  // sectionFallbackPlaceholder is pure and deterministic in (brief, profile,
  // section, readiness) -- all fixed by this point in the run -- so a
  // section's final content matches it exactly if and only if that section
  // is currently sitting on a fallback placeholder. Deriving from the final
  // content (rather than logging fallbacks as they occur mid-pipeline) means
  // a section that failed in an early round but was then successfully
  // rewritten in a later repair round is never stuck reporting a stale
  // "needs your input" placeholder for content that no longer exists.
  const sectionFallbacks = input.template.sections
    .map((tpl) => {
      const final = sections.find((s) => s.key === tpl.key);
      if (!final) return null;
      const candidate = sectionFallbackPlaceholder(
        brief,
        profile,
        tpl,
        readinessFor(brief, tpl.key),
      );
      return final.content === candidate.section.content
        ? candidate.placeholder
        : null;
    })
    .filter((placeholder): placeholder is UnresolvedDocumentPlaceholder =>
      placeholder !== null
    );

  const unresolvedPlaceholders = mergeFinalPlaceholders(
    unresolvedPlaceholdersForBrief(profile, brief),
    sectionFallbacks,
  );
  assertPlaceholderIntegrity(sections, unresolvedPlaceholders);

  const missingInfo: SectionMissingInfo[] = input.template.sections
    .map((section) => {
      const missing = unresolvedPlaceholders
        .filter((placeholder) => placeholder.sectionKey === section.key)
        .map((placeholder) => placeholder.question);
      return { key: section.key, label: section.label, missing };
    })
    .filter((entry) => entry.missing.length > 0);

  return { sections, missingInfo, unresolvedPlaceholders };
}
