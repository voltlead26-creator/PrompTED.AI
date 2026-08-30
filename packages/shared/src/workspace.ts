// =====================================================
// PrompTED — Workspace domain helpers (pure, framework-agnostic)
// Drive the Master Workspace: approval counting, the export gate,
// section reordering, and status transitions. Shared by the web
// client and covered by unit tests.
//
// These operate on plain data so the same logic backs both the
// optimistic local cache (Layer 8) and DB-backed persistence
// (Layer 14). No I/O lives here.
// =====================================================

import type { Section, SectionStatus } from "./types";
import { getTemplateByName, resolveTemplateByRecommendationName } from "./templates/index";
import { templateDraftContent } from "./templates/template-drafts";
export * from "./workspace-sections";

// ---- Seed document (interim, pre-persistence) ------------------

export interface SeedDocumentInput {
  /** The outcome id this workspace belongs to. */
  outcomeId: string;
  /** The chosen template's display name (drives the title). */
  templateName: string;
  /** TED's understanding of the situation, shown in the preview lede. */
  situation?: string;
  /** Uploaded or persisted source text used to estimate repeatable sections. */
  sourceText?: string;
  /** Owning user, when known (anonymous → "anonymous"). */
  userId?: string;
}

export interface SeedDocument {
  documentId: string;
  title: string;
  sections: Section[];
}

/**
 * A generic, production-shaped section scaffold used when a recommendation
 * cannot be resolved to a catalogue template. Known catalogue templates use
 * template-specific starter drafts from templates/template-drafts.ts.
 */
const TEMPLATE_DRAFT_MARKER = "<!-- prompted:template-draft -->";

const DEFAULT_SECTION_BLUEPRINT: Array<{
  name: string;
  required: boolean;
  content: string;
}> = [
  {
    name: "Introduction",
    required: true,
    content: `${TEMPLATE_DRAFT_MARKER}<p>An overview of the situation, the purpose, and the outcome being worked toward.</p>`,
  },
  {
    name: "Key details",
    required: true,
    content: `${TEMPLATE_DRAFT_MARKER}<p>The important facts, names, dates, and goals the final document relies on.</p>`,
  },
  {
    name: "Main content",
    required: true,
    content: `${TEMPLATE_DRAFT_MARKER}<p>The main content of the document, written around the details described and ready to refine.</p>`,
  },
  {
    name: "Next steps",
    required: false,
    content: `${TEMPLATE_DRAFT_MARKER}<p>Practical follow-up actions to take next.</p>`,
  },
  {
    name: "Closing",
    required: false,
    content: `${TEMPLATE_DRAFT_MARKER}<p>A clear, professional close to the document.</p>`,
  },
];

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function countResumeJobs(sourceText: string | undefined): number {
  const text = sourceText?.replace(/\r\n?/g, "\n") ?? "";
  if (!text.trim()) return 1;

  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const dateRange =
    /(?:19|20)\d{2}\s*(?:-|–|—|to|until|\/)\s*(?:(?:19|20)\d{2}|present|current|now)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:19|20)\d{2}/i;
  const jobLike =
    /\b(manager|assistant|coordinator|supervisor|operator|administrator|chef|cook|server|waiter|waitress|bartender|barista|sales|consultant|director|officer|lead|labourer|technician|specialist|analyst|clerk|receptionist|driver|worker|owner|founder)\b/i;
  const bulletsOrHeadings = lines.filter((line) => {
    if (line.length > 140) return false;
    return dateRange.test(line) && (jobLike.test(line) || /\bat\b|\|/.test(line));
  });

  if (bulletsOrHeadings.length > 0) {
    return Math.max(1, Math.min(8, bulletsOrHeadings.length));
  }

  const experienceBlock =
    text.match(
      /(?:work experience|employment history|professional experience)([\s\S]{0,6000})/i,
    )?.[1] ?? text;
  const yearRanges =
    experienceBlock.match(
      /(?:19|20)\d{2}\s*(?:-|–|—|to|until|\/)\s*(?:(?:19|20)\d{2}|present|current|now)/gi,
    ) ?? [];
  return Math.max(1, Math.min(8, yearRanges.length || 1));
}

function resumeJobDraft(index: number): string {
  return `${TEMPLATE_DRAFT_MARKER}<p>This role (number ${index}) covers one job: the job title, employer, and dates, the duties I held, and what I achieved.</p>`;
}

function resumeBlueprint(input: SeedDocumentInput): Array<{
  name: string;
  required: boolean;
  content: string;
}> {
  const jobCount = countResumeJobs(input.sourceText);
  const jobSections = Array.from({ length: jobCount }, (_, index) => ({
    name: `Work Experience - Job ${index + 1}`,
    required: true,
    content: resumeJobDraft(index + 1),
  }));

  return [
    {
      name: "Contact Details",
      required: true,
      content:
        templateDraftContent({
          templateSlug: "resume",
          sectionKey: "contact_details",
          context: input.situation,
        }) ?? "",
    },
    {
      name: "Professional Summary",
      required: true,
      content:
        templateDraftContent({
          templateSlug: "resume",
          sectionKey: "summary",
          context: input.situation,
        }) ?? "",
    },
    ...jobSections,
    {
      name: "Education & Qualifications",
      required: true,
      content:
        templateDraftContent({
          templateSlug: "resume",
          sectionKey: "education",
          context: input.situation,
        }) ?? "",
    },
    {
      name: "Key Skills",
      required: true,
      content:
        templateDraftContent({
          templateSlug: "resume",
          sectionKey: "skills",
          context: input.situation,
        }) ?? "",
    },
    {
      name: "Referees",
      required: false,
      content:
        templateDraftContent({
          templateSlug: "resume",
          sectionKey: "referees",
          context: input.situation,
        }) ?? "",
    },
  ];
}

/**
 * Build an in-memory document + sections from a confirmed recommendation.
 * The first draft is still streamed in separately, but this seed is deliberately
 * non-blank so failed or delayed generation never leaves an empty workspace.
 */
export function buildSeedDocument(input: SeedDocumentInput): SeedDocument {
  const documentId = makeId("document");
  const now = new Date().toISOString();
  const userId = input.userId ?? "anonymous";

  // Prefer the real template's bespoke sections; fall back to a generic
  // blueprint only when the chosen template isn't in the catalogue.
  const template =
    resolveTemplateByRecommendationName(input.templateName) ??
    getTemplateByName(input.templateName);
  const blueprint =
    template?.slug === "resume"
      ? resumeBlueprint(input)
      : template
        ? template.sections
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => ({
              name: s.name,
              required: s.is_required,
              content:
                templateDraftContent({
                  templateSlug: template.slug,
                  sectionKey: s.key,
                  context: input.situation,
                }) ?? `${TEMPLATE_DRAFT_MARKER}<p>${s.description}</p>`,
            }))
        : DEFAULT_SECTION_BLUEPRINT;

  const sections: Section[] = blueprint.map((item, i) => ({
    id: makeId("section"),
    document_id: documentId,
    user_id: userId,
    name: item.name,
    order_index: i,
    content: item.content,
    status: "draft" as SectionStatus,
    version_history: [],
    is_required: item.required,
    created_at: now,
    updated_at: now,
  }));

  return { documentId, title: input.templateName, sections };
}
