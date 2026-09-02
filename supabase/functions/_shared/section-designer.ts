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

interface RawDesign {
  name?: unknown;
  domain?: unknown;
  structure_type?: unknown;
  sections?: unknown;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

function cleanArray(
  value: unknown,
  maxItems: number,
  maxLen: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, maxLen).trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length > 0 ? items : undefined;
}

function slugKey(label: string, index: number): string {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_|_$/g,
    "",
  );
  return key || `section_${index + 1}`;
}

/**
 * Ask the model to design a bespoke section structure. Returns null on any
 * failure so the caller can fall back to its existing behaviour.
 */
export async function designBespokeTemplate(
  input: DesignInput,
): Promise<ResolvedTemplate | null> {
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

  try {
    const result = await routeRequest({
      task: "document",
      logicalStageKey: "generate-document.design",
      outputSchema: SECTION_DESIGN_OUTPUT_SCHEMA,
      systemPrompt: input.systemPrompt,
      messages: [{ role: "user", content }],
      maxTokens: 2200,
      signal: input.signal,
    });

    const parsed = result.structured as RawDesign | undefined;
    if (!parsed || !Array.isArray(parsed.sections)) return null;

    const sections: TemplateSection[] = [];
    for (const raw of parsed.sections.slice(0, 9)) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as Record<string, unknown>;
      const label = cleanText(item.label, 120);
      if (!label) continue;
      const section: TemplateSection = {
        key: slugKey(label, sections.length),
        label,
        required: item.required !== false,
      };
      const hint = cleanText(item.hint, 300);
      if (hint) section.hint = hint;
      const vital = cleanArray(item.vital, 6, 200);
      if (vital) section.vital = vital;
      const improver = cleanArray(item.improver, 10, 200);
      if (improver) section.improver = improver;
      sections.push(section);
    }
    if (sections.length < 3) return null;

    const domainRaw = cleanText(parsed.domain, 20);
    const domain =
      ["employment", "education", "business", "finance", "general"].includes(
          domainRaw,
        )
        ? domainRaw
        : "general";
    const structureRaw = cleanText(parsed.structure_type, 20);
    const structureType =
      structureRaw === "structured_form" || structureRaw === "checklist"
        ? structureRaw
        : "compose";

    return {
      id: "bespoke",
      name: cleanText(parsed.name, 120) || input.documentName,
      domain,
      structureType,
      // Bespoke documents get the cautious middle setting: TED flags
      // judgement calls without positioning itself as professional advice.
      adviceBoundary: "light",
      sections,
    };
  } catch {
    return null;
  }
}
