// =====================================================
// PrompTED — section-designer
// Designs a bespoke document structure for situations no
// catalogue template covers. Returns sections with the same
// vital/improver quality criteria the catalogue enforces, so
// custom documents go through identical completion checks.
// =====================================================

import { routeRequest } from "./provider-router.ts";
import { SECTION_DESIGN_OUTPUT_SCHEMA } from "./model-output-contracts.ts";
import type { ResolvedTemplate, TemplateSection } from "./template-engine.ts";

export interface DesignInput {
  documentName: string;
  situation: string;
  conversationContext?: string;
  uploadContext?: string;
  systemPrompt: string;
  signal?: AbortSignal;
}

/** Included in the server-owned allowance policy for new bespoke requests. */
export const BESPOKE_DESIGN_VALIDATOR_VERSION = "bespoke-section-validation.1";

function isClosedObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isText(
  value: unknown,
  max: number,
  allowEmpty = false,
): value is string {
  return typeof value === "string" && value.length <= max &&
    (allowEmpty || value.trim().length > 0);
}

function isTextArray(
  value: unknown,
  minItems: number,
  maxItems: number,
  maxLen: number,
): value is string[] {
  return Array.isArray(value) && value.length >= minItems &&
    value.length <= maxItems && value.every((item) => isText(item, maxLen));
}

function slugKey(label: string, index: number): string {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_|_$/g,
    "",
  );
  return key || `section_${index + 1}`;
}

/**
 * Ask the model to design a bespoke section structure. Invalid completed output
 * returns null; provider and accounting failures retain their exact identity so
 * the caller can reconcile uncertain work. No caller scaffold is substituted.
 */
export async function designBespokeTemplate(
  input: DesignInput,
): Promise<ResolvedTemplate | null> {
  input.signal?.throwIfAborted();
  const content = [
    `The user needs a document that no catalogue template covers: "${input.documentName}".`,
    `Situation:\n${input.situation || "(not provided)"}`,
    input.conversationContext &&
    `Conversation context:\n${input.conversationContext.slice(0, 12000)}`,
    input.uploadContext &&
    `Uploaded material:\n${input.uploadContext.slice(0, 12000)}`,
    [
      "Design the ideal structure for THIS specific document and situation — not a generic outline.",
      "Respond ONLY with JSON, no markdown fences, matching exactly:",
      '{"name": string, "domain": "employment"|"education"|"business"|"finance"|"general", "structure_type": "compose"|"structured_form"|"checklist", "sections": [{"label": string, "required": boolean, "hint": string, "vital": string[], "improver": string[]}]}',
      "Rules: 3 to 9 sections, ordered as the reader should encounter them.",
      "hint: one line describing the section purpose (never output text).",
      "vital: 2-4 facts or elements this section is incomplete without — only what is truly necessary.",
      "improver: 4-8 optional quality levers that lift the section from adequate to excellent.",
      "Section labels must be specific to this situation (use the user's real subject matter), plain Australian English, no jargon.",
    ].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n\n");

  const result = await routeRequest({
    task: "document",
    logicalStageKey: "generate-document.design",
    outputSchema: SECTION_DESIGN_OUTPUT_SCHEMA,
    systemPrompt: input.systemPrompt,
    messages: [{ role: "user", content }],
    maxTokens: 2200,
    signal: input.signal,
  });
  input.signal?.throwIfAborted();

  const parsed: unknown = result.structured;
  if (
    !isClosedObject(parsed, ["name", "domain", "structure_type", "sections"]) ||
    !isText(parsed.name, 120) || !isText(parsed.domain, 20) ||
    !["employment", "education", "business", "finance", "general"].includes(
      parsed.domain,
    ) ||
    (parsed.structure_type !== "compose" &&
      parsed.structure_type !== "structured_form" &&
      parsed.structure_type !== "checklist") ||
    !Array.isArray(parsed.sections) || parsed.sections.length < 3 ||
    parsed.sections.length > 9
  ) return null;

  const sections: TemplateSection[] = [];
  const keys = new Set<string>();
  for (const item of parsed.sections) {
    if (
      !isClosedObject(item, [
        "label",
        "required",
        "hint",
        "vital",
        "improver",
      ]) ||
      !isText(item.label, 120) || typeof item.required !== "boolean" ||
      !isText(item.hint, 300, true) || !isTextArray(item.vital, 2, 6, 200) ||
      !isTextArray(item.improver, 4, 10, 200)
    ) return null;
    const label = item.label.trim();
    const key = slugKey(label, sections.length);
    // The browser stream and subsequent scoped requests use this exact key.
    // Reject ambiguous or oversized identity rather than renaming its meaning.
    if (key.length > 80 || keys.has(key)) return null;
    keys.add(key);
    const section: TemplateSection = {
      key,
      label,
      required: item.required,
      vital: item.vital.map((value) => value.trim()),
      improver: item.improver.map((value) => value.trim()),
    };
    const hint = item.hint.trim();
    if (hint) section.hint = hint;
    sections.push(section);
  }

  return {
    id: "bespoke",
    name: parsed.name.trim(),
    domain: parsed.domain,
    structureType: parsed.structure_type,
    // Bespoke documents get the cautious middle setting: TED flags
    // judgement calls without positioning itself as professional advice.
    adviceBoundary: "light",
    sections,
  };
}
