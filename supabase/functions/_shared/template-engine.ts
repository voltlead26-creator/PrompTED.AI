// =====================================================
// PrompTED — Template Engine
// Loads a template and applies user/business profile pre-fill.
//
// Runtime authority is the existing shared catalogue. The old fallback
// definitions below are retained only to prove equivalence for an already
// accepted legacy request; they never admit a new catalogue request.
// =====================================================

import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};

export const LEGACY_TEMPLATE_POLICY_VERSION = "legacy-template-policy.1";

export interface TemplateSection {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  prefilled?: string;
  /** Facts the section cannot be considered complete without (mirrors missing_detail_rules at the section level). */
  vital?: string[];
  /** Optional facts that improve specificity, persuasion, or polish but never block completion. */
  improver?: string[];
}

export interface ResolvedTemplate {
  id: string;
  name: string;
  domain: string;
  structureType: "compose" | "structured_form" | "checklist";
  sections: TemplateSection[];
  adviceBoundary: "none" | "light" | "high-stakes";
}

export interface ProfileData {
  displayName?: string;
  businessName?: string;
  abn?: string;
  address?: string;
  phone?: string;
  email?: string;
  jobTitle?: string;
  [key: string]: string | undefined;
}

// ----- static stub registry -----

const STUB_TEMPLATES: Record<string, Omit<ResolvedTemplate, "id">> = {
  offer_letter: {
    name: "Offer Letter",
    domain: "employment",
    structureType: "compose",
    adviceBoundary: "light",
    sections: [
      {
        key: "intro",
        label: "Introduction",
        required: true,
        hint: "Confirm the offer and start date.",
      },
      { key: "role", label: "Role and Duties", required: true },
      {
        key: "remuneration",
        label: "Remuneration",
        required: true,
        hint: "Salary, superannuation, benefits.",
      },
      {
        key: "terms",
        label: "Key Terms",
        required: true,
        hint: "Hours, location, probation.",
      },
      { key: "acceptance", label: "Acceptance", required: true },
    ],
  },
  resignation_letter: {
    name: "Resignation Letter",
    domain: "employment",
    structureType: "compose",
    adviceBoundary: "none",
    sections: [
      { key: "intro", label: "Opening", required: true },
      { key: "notice", label: "Notice Period", required: true },
      { key: "handover", label: "Handover", required: false },
      { key: "close", label: "Closing", required: true },
    ],
  },
  business_plan: {
    name: "Business Plan",
    domain: "business",
    structureType: "structured_form",
    adviceBoundary: "light",
    sections: [
      { key: "executive_summary", label: "Executive Summary", required: true },
      {
        key: "problem_solution",
        label: "Problem and Solution",
        required: true,
      },
      { key: "market", label: "Target Market", required: true },
      { key: "revenue_model", label: "Revenue Model", required: true },
      { key: "operations", label: "Operations Plan", required: true },
      {
        key: "financials",
        label: "Financial Projections",
        required: true,
        hint: "Do not fabricate figures.",
      },
      { key: "milestones", label: "Milestones", required: false },
    ],
  },
  // Mirrors catalog slug "resume" (no hyphen, key unchanged).
  resume: {
    name: "Resume",
    domain: "employment",
    structureType: "structured_form",
    adviceBoundary: "none",
    sections: [
      {
        key: "contact_details",
        label: "Contact Details",
        required: true,
        hint:
          "The candidate's confirmed name, phone, email and location in a clear resume header.",
      },
      {
        key: "summary",
        label: "Professional Summary",
        required: true,
        hint: "A 2–3 line snapshot of who you are and what you offer.",
      },
      {
        key: "experience",
        label: "Work Experience",
        required: true,
        hint: "Roles, dates, and achievements in reverse chronological order.",
      },
      {
        key: "education",
        label: "Education & Qualifications",
        required: true,
        hint: "Degrees, certificates, and relevant training.",
      },
      {
        key: "skills",
        label: "Key Skills",
        required: true,
        hint: "The capabilities most relevant to the target role.",
      },
      {
        key: "referees",
        label: "Referees",
        required: false,
        hint: "Contacts who can speak to your work.",
      },
    ],
  },
  // Mirrors catalog slug "cover-letter" -> "cover_letter" after hyphen replace.
  cover_letter: {
    name: "Cover Letter",
    domain: "employment",
    structureType: "compose",
    adviceBoundary: "none",
    sections: [
      {
        key: "opening",
        label: "Opening & Role",
        required: true,
        hint: "Who you are and the role you're applying for.",
      },
      {
        key: "fit",
        label: "Why You Fit",
        required: true,
        hint: "The experience and strengths that match the role.",
      },
      {
        key: "motivation",
        label: "Why This Employer",
        required: true,
        hint: "What draws you to this organisation specifically.",
      },
      {
        key: "closing",
        label: "Closing & Next Step",
        required: true,
        hint: "A confident sign-off inviting an interview.",
      },
    ],
  },
  // Mirrors catalog slug "interview-prep-questions" -> "interview_prep_questions".
  interview_prep_questions: {
    name: "Interview Preparation Questions",
    domain: "employment",
    structureType: "compose",
    adviceBoundary: "none",
    sections: [
      {
        key: "about_you",
        label: "Questions About You",
        required: true,
        hint:
          "Strengths, weaknesses, and motivation questions — with strong example answers grounded in the user's real experience.",
      },
      {
        key: "role_specific",
        label: "Role-specific Questions",
        required: true,
        hint:
          "Technical and scenario questions for this role — with strong example answers.",
      },
      {
        key: "your_questions",
        label: "Questions to Ask Them",
        required: true,
        hint: "Smart questions that show genuine interest in the role.",
      },
    ],
  },
};

/**
 * Resolve a template by ID. Falls back to a generic stub.
 */
export function resolveLegacyTemplateForPolicyComparison(
  templateId: string,
): ResolvedTemplate {
  const stub = STUB_TEMPLATES[templateId] ??
    STUB_TEMPLATES[templateId.replace(/-/g, "_")];
  if (stub) return { id: templateId, ...stub };

  // Generic fallback for any unknown template ID.
  return {
    id: templateId,
    name: "Document",
    domain: "general",
    structureType: "compose",
    adviceBoundary: "none",
    sections: [
      { key: "body", label: "Content", required: true },
    ],
  };
}

/** Exact ID/slug lookup in the shared catalogue, with no recommendation or
 * generic-template fallback. Returned objects do not expose mutable assets. */
export function resolveTemplate(templateId: string): ResolvedTemplate | null {
  const source = [...coreTemplates, ...phase2Templates].find((entry) =>
    entry.id === templateId || entry.slug === templateId
  );
  if (!source) return null;
  const structureType = source.structure_type;
  const adviceBoundary = source.advice_boundary;
  // Narrow the exact runtime values without trusting an asserted JSON type.
  if (
    structureType !== "compose" && structureType !== "structured_form" &&
    structureType !== "checklist"
  ) {
    throw new Error("DOCUMENT_CATALOGUE_CONTRACT_INVALID");
  }
  if (
    adviceBoundary !== "none" && adviceBoundary !== "light" &&
    adviceBoundary !== "high-stakes"
  ) {
    throw new Error("DOCUMENT_CATALOGUE_CONTRACT_INVALID");
  }
  return {
    id: templateId,
    name: source.name,
    domain: source.domain,
    structureType,
    adviceBoundary,
    sections: [...source.sections].sort((left, right) =>
      left.order - right.order
    ).map((section) => ({
      key: section.key,
      label: section.name,
      required: section.is_required,
      hint: section.description,
      vital: [...(section.vital ?? [])],
      improver: [...(section.improver ?? [])],
    })),
  };
}

export class DocumentTemplateAdmissionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DocumentTemplateAdmissionError";
  }
}

function invalidRequest(): never {
  throw new DocumentTemplateAdmissionError("DOCUMENT_TEMPLATE_REQUEST_INVALID");
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    invalidRequest();
  }
  return value.trim();
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidRequest();
  }
  return Object.fromEntries(Object.entries(value));
}

function legacyWireKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_|_$/g,
    "",
  ) || "section";
}

function webKeylessWireKey(label: string): string {
  // Exact current web request normalisation; no title-similarity matching.
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(
    /\s+/g,
    "_",
  );
}

export interface AdmittedDocumentTemplate {
  mode: "catalogue" | "bespoke";
  template: ResolvedTemplate;
  /** Pipeline keys remain canonical. Only the final wire envelope uses these
   * exact accepted destinations; it never moves existing persisted prose. */
  destinations: Array<{ canonicalKey: string; wireKey: string }>;
}

/** A section list is a scope request. All policy and required facts come from
 * the existing server-read catalogue, even when a caller supplies hints. */
export function admitDocumentTemplate(
  body: Record<string, unknown>,
): AdmittedDocumentTemplate {
  const templateId = optionalText(body.template_id, 160);
  if (!templateId) invalidRequest();
  if (
    body.design_bespoke !== undefined &&
    typeof body.design_bespoke !== "boolean"
  ) invalidRequest();
  const domain = optionalText(body.domain, 80);
  const structure = optionalText(body.structure_type, 40);
  const boundary = optionalText(body.advice_boundary, 40);
  if (
    structure !== undefined &&
    !["compose", "structured_form", "checklist"].includes(structure)
  ) invalidRequest();
  if (
    boundary !== undefined &&
    !["none", "light", "high-stakes"].includes(boundary)
  ) invalidRequest();
  const requested = body.sections;
  if (
    requested !== undefined &&
    (!Array.isArray(requested) || requested.length < 1 || requested.length > 20)
  ) invalidRequest();
  const sections = Array.isArray(requested)
    ? requested.map((value) => {
      const raw = plainRecord(value);
      const key = optionalText(raw.key, 80);
      const label = optionalText(raw.label, 120);
      if (!key && !label) invalidRequest();
      if (
        raw.required !== undefined && typeof raw.required !== "boolean"
      ) invalidRequest();
      if (
        raw.hint !== undefined && typeof raw.hint !== "string"
      ) invalidRequest();
      for (const list of [raw.vital, raw.improver]) {
        if (
          list !== undefined &&
          (!Array.isArray(list) ||
            list.some((item) => typeof item !== "string"))
        ) invalidRequest();
      }
      return { key, label, required: raw.required };
    })
    : undefined;
  if (body.profile !== undefined) {
    const profile = plainRecord(body.profile);
    if (Object.values(profile).some((value) => typeof value !== "string")) {
      invalidRequest();
    }
  }
  const template = resolveTemplate(templateId);
  if (body.design_bespoke === true) {
    if (template) {
      throw new DocumentTemplateAdmissionError(
        "DOCUMENT_TEMPLATE_ROUTE_CONFLICT",
      );
    }
    const documentName = optionalText(body.document_name, 160) ?? templateId;
    return {
      mode: "bespoke",
      template: {
        id: "bespoke",
        name: documentName,
        domain: "general",
        structureType: "compose",
        adviceBoundary: "light",
        sections: [],
      },
      destinations: [],
    };
  }
  if (!template) {
    throw new DocumentTemplateAdmissionError("DOCUMENT_TEMPLATE_NOT_FOUND");
  }
  if (
    (domain !== undefined && domain !== template.domain) ||
    (structure !== undefined && structure !== template.structureType) ||
    (boundary !== undefined && boundary !== template.adviceBoundary)
  ) {
    throw new DocumentTemplateAdmissionError(
      "DOCUMENT_TEMPLATE_POLICY_MISMATCH",
    );
  }
  const destinations: AdmittedDocumentTemplate["destinations"] = [];
  const canonicalKeys = new Set<string>();
  const wireKeys = new Set<string>();
  const scoped = sections?.map((section) => {
    const wireKey = section.key ?? legacyWireKey(section.label ?? "");
    let canonical = template.sections.find((item) => item.key === wireKey);
    if (!canonical && section.label) {
      const matches = template.sections.filter((item) =>
        item.label === section.label &&
        [legacyWireKey(item.label), webKeylessWireKey(item.label)].includes(
          wireKey,
        )
      );
      if (matches.length === 1) canonical = matches[0];
    }
    if (
      !canonical || canonicalKeys.has(canonical.key) || wireKeys.has(wireKey) ||
      (section.required !== undefined &&
        section.required !== canonical.required)
    ) {
      throw new DocumentTemplateAdmissionError(
        "DOCUMENT_TEMPLATE_SECTION_INVALID",
      );
    }
    canonicalKeys.add(canonical.key);
    wireKeys.add(wireKey);
    destinations.push({ canonicalKey: canonical.key, wireKey });
    return { ...canonical, label: section.label ?? canonical.label };
  }) ?? template.sections;
  if (!sections) {
    destinations.push(
      ...scoped.map((section) => ({
        canonicalKey: section.key,
        wireKey: section.key,
      })),
    );
  }
  return {
    mode: "catalogue",
    template: { ...template, sections: scoped },
    destinations,
  };
}

/**
 * Apply profile pre-fill to a resolved template's sections.
 * Returns the template with `prefilled` text injected where available.
 */
export function applyPreFill(
  template: ResolvedTemplate,
  profile: ProfileData,
): ResolvedTemplate {
  const mappings: Record<string, string> = {
    intro: [profile.displayName, profile.businessName].filter(Boolean).join(
      " / ",
    ),
    acceptance: profile.email ?? "",
  };

  const sections = template.sections.map((s) => ({
    ...s,
    prefilled: mappings[s.key] || undefined,
  }));

  return { ...template, sections };
}

/**
 * Format the section list as an instruction string for the prompt builder.
 * This is injected as the `extra` field in `buildSystemPrompt`.
 */
export function sectionListInstruction(template: ResolvedTemplate): string {
  const lines = template.sections.map((s) => {
    const parts = [
      `- ${s.label}${s.required ? " (required)" : " (optional)"}${
        s.hint ? `: ${s.hint}` : ""
      }`,
    ];
    if (s.vital?.length) {
      parts.push(
        `  Vital (must be reflected for this section to count as complete): ${
          s.vital.join("; ")
        }.`,
      );
    }
    if (s.improver?.length) {
      parts.push(
        `  Improver (optional, use if available, never block on these): ${
          s.improver.join("; ")
        }.`,
      );
    }
    return parts.join("\n");
  });
  return `Document: ${template.name}\nSections (use exactly these names — do not add or remove sections):\n${
    lines.join("\n")
  }`;
}
