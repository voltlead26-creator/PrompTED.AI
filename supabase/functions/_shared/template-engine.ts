// =====================================================
// PrompTED — Template Engine
// Loads a template and applies user/business profile pre-fill.
//
// NOTE: This is a fallback registry only. The frontend's own catalogue
// (packages/shared/src/templates/templates.data.json) is the actual single
// source of truth for section structure AND for domain/structureType/
// adviceBoundary -- the frontend sends all of that explicitly on every
// generate-document request (see generate-document/index.ts's canonical
// template override). These entries only matter when a caller omits that
// metadata (e.g. a direct API call or test). Keys MUST be the catalogue
// slug with hyphens replaced by underscores -- a mismatch here silently
// falls through to the single-section generic template with no error.
// =====================================================

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
      { key: "intro", label: "Introduction", required: true, hint: "Confirm the offer and start date." },
      { key: "role", label: "Role and Duties", required: true },
      { key: "remuneration", label: "Remuneration", required: true, hint: "Salary, superannuation, benefits." },
      { key: "terms", label: "Key Terms", required: true, hint: "Hours, location, probation." },
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
      { key: "problem_solution", label: "Problem and Solution", required: true },
      { key: "market", label: "Target Market", required: true },
      { key: "revenue_model", label: "Revenue Model", required: true },
      { key: "operations", label: "Operations Plan", required: true },
      { key: "financials", label: "Financial Projections", required: true, hint: "Do not fabricate figures." },
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
      { key: "contact_details", label: "Contact Details", required: true, hint: "The candidate's confirmed name, phone, email and location in a clear resume header." },
      { key: "summary", label: "Professional Summary", required: true, hint: "A 2–3 line snapshot of who you are and what you offer." },
      { key: "experience", label: "Work Experience", required: true, hint: "Roles, dates, and achievements in reverse chronological order." },
      { key: "education", label: "Education & Qualifications", required: true, hint: "Degrees, certificates, and relevant training." },
      { key: "skills", label: "Key Skills", required: true, hint: "The capabilities most relevant to the target role." },
      { key: "referees", label: "Referees", required: false, hint: "Contacts who can speak to your work." },
    ],
  },
  // Mirrors catalog slug "cover-letter" -> "cover_letter" after hyphen replace.
  cover_letter: {
    name: "Cover Letter",
    domain: "employment",
    structureType: "compose",
    adviceBoundary: "none",
    sections: [
      { key: "opening", label: "Opening & Role", required: true, hint: "Who you are and the role you're applying for." },
      { key: "fit", label: "Why You Fit", required: true, hint: "The experience and strengths that match the role." },
      { key: "motivation", label: "Why This Employer", required: true, hint: "What draws you to this organisation specifically." },
      { key: "closing", label: "Closing & Next Step", required: true, hint: "A confident sign-off inviting an interview." },
    ],
  },
  // Mirrors catalog slug "interview-prep-questions" -> "interview_prep_questions".
  interview_prep_questions: {
    name: "Interview Preparation Questions",
    domain: "employment",
    structureType: "compose",
    adviceBoundary: "none",
    sections: [
      { key: "about_you", label: "Questions About You", required: true, hint: "Strengths, weaknesses, and motivation questions — with strong example answers grounded in the user's real experience." },
      { key: "role_specific", label: "Role-specific Questions", required: true, hint: "Technical and scenario questions for this role — with strong example answers." },
      { key: "your_questions", label: "Questions to Ask Them", required: true, hint: "Smart questions that show genuine interest in the role." },
    ],
  },
};

/**
 * Resolve a template by ID. Falls back to a generic stub.
 */
export function resolveTemplate(templateId: string): ResolvedTemplate {
  const stub = STUB_TEMPLATES[templateId] ?? STUB_TEMPLATES[templateId.replace(/-/g, "_")];
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

/**
 * Apply profile pre-fill to a resolved template's sections.
 * Returns the template with `prefilled` text injected where available.
 */
export function applyPreFill(
  template: ResolvedTemplate,
  profile: ProfileData,
): ResolvedTemplate {
  const mappings: Record<string, string> = {
    intro: [profile.displayName, profile.businessName].filter(Boolean).join(" / "),
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
      `- ${s.label}${s.required ? " (required)" : " (optional)"}${s.hint ? `: ${s.hint}` : ""}`,
    ];
    if (s.vital?.length) {
      parts.push(`  Vital (must be reflected for this section to count as complete): ${s.vital.join("; ")}.`);
    }
    if (s.improver?.length) {
      parts.push(`  Improver (optional, use if available, never block on these): ${s.improver.join("; ")}.`);
    }
    return parts.join("\n");
  });
  return `Document: ${template.name}\nSections (use exactly these names — do not add or remove sections):\n${lines.join("\n")}`;
}
