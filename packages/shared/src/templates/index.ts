// =====================================================
// PrompTED — Template catalogue (V1)
//
// The JSON data files are the single source of truth for the 22+
// launch templates and 4 bundles. The SQL seed (supabase/seed/*.sql)
// is generated from the same JSON, so the DB and the client never
// drift. These utilities give the app typed access plus pre-fill and
// derived-field logic.
// =====================================================

import type { Domain, StructureType, AdviceBoundary } from "../types";
import type {
  IntentResult,
  Recommendation,
  RecommendationItem,
} from "../orchestration";
import templatesData from "./templates.data.json";
import phase2TemplatesData from "./phase2-templates.data.json";
import bundlesData from "./bundles.data.json";

export interface CatalogSection {
  key: string;
  name: string;
  description: string;
  is_required: boolean;
  order: number;
  /** Facts the section cannot be considered complete without. Drives required follow-up questions. */
  vital?: string[];
  /** Optional facts that improve specificity, persuasion, or polish without blocking completion. */
  improver?: string[];
}

export interface CatalogField {
  name: string;
  type: string;
  label: string;
  placeholder?: string;
  fillFromProfile?: string;
  required: boolean;
  options?: string[];
}

export interface MissingDetailRule {
  field: string;
  reason: string;
  is_required: boolean;
}

export interface CatalogTemplate {
  id: string;
  slug: string;
  name: string;
  domain: Domain;
  category: string;
  plain_description: string;
  structure_type: StructureType;
  sections: CatalogSection[];
  fields: CatalogField[];
  missing_detail_rules: MissingDetailRule[];
  fill_from_profile: Record<string, string>;
  recommendation_reason: string;
  related_document_ids: string[];
  advice_boundary: AdviceBoundary;
  brandable: boolean;
  display_order: number;
  flags?: Record<string, unknown>;
}

export interface CatalogBundle {
  id: string;
  slug: string;
  name: string;
  description: string;
  domain: Domain;
  template_ids: string[];
  checklist_template_id: string | null;
  display_order: number;
}

export const TEMPLATES: CatalogTemplate[] = [
  ...(templatesData as CatalogTemplate[]),
  ...(phase2TemplatesData as CatalogTemplate[]),
];
export const BUNDLES: CatalogBundle[] = bundlesData as CatalogBundle[];

// ---- lookups ---------------------------------------------------

export function getTemplate(idOrSlug: string): CatalogTemplate | undefined {
  return TEMPLATES.find((t) => t.id === idOrSlug || t.slug === idOrSlug);
}

export function getTemplateByName(name: string): CatalogTemplate | undefined {
  const lower = name.trim().toLowerCase();
  return TEMPLATES.find((t) => t.name.toLowerCase() === lower);
}

function normaliseLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const LOOKUP_STOPWORDS = new Set(["a", "an", "the", "of", "for", "my", "your", "to", "and"]);

function lookupTokens(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !LOOKUP_STOPWORDS.has(token))
    .map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token));
  return new Set(tokens);
}

// Common recommendation names that do not textually match a catalogue
// template. Every alias maps to the nearest canonical slug so TED never
// falls back to a generic scaffold for these.
const TEMPLATE_ALIASES: Record<string, string> = {
  "product plan": "business-plan",
  "product roadmap": "business-plan",
  "work scope": "scope-of-work",
  "scope document": "scope-of-work",
  "statement of work": "scope-of-work",
  "sow": "scope-of-work",
  "cv": "resume",
  "curriculum vitae": "resume",
  "job application letter": "cover-letter",
  "application letter": "cover-letter",
  "quote": "proposal",
  "quotation": "proposal",
  "business proposal": "proposal",
  "standard operating procedure": "sop",
  "procedure": "sop",
  "employment contract": "terms-of-employment",
  "reference letter": "professional-reference-letter",
  "recommendation letter": "professional-reference-letter",
  "p&l": "profit-and-loss-statement",
  "profit and loss": "profit-and-loss-statement",
  "income statement": "profit-and-loss-statement",
  "personal statement for university": "personal-statement",
  "study proposal": "research-proposal",
};

export function resolveTemplateByRecommendationName(
  name: string,
): CatalogTemplate | undefined {
  const direct = getTemplate(name) ?? getTemplateByName(name);
  if (direct) return direct;

  const aliasSlug = TEMPLATE_ALIASES[name.trim().toLowerCase().replace(/\s+/g, " ")];
  if (aliasSlug) {
    const aliased = getTemplate(aliasSlug);
    if (aliased) return aliased;
  }

  const wanted = normaliseLookup(name);
  if (!wanted) return undefined;
  const substringMatch = TEMPLATES.find((template) => {
    const byName = normaliseLookup(template.name);
    const bySlug = normaliseLookup(template.slug);
    return (
      byName === wanted ||
      bySlug === wanted ||
      byName.includes(wanted) ||
      wanted.includes(byName) ||
      bySlug.includes(wanted) ||
      wanted.includes(bySlug)
    );
  });
  if (substringMatch) return substringMatch;

  // Word-order-insensitive fallback: "work scope" -> "Scope of Work".
  // Requires every meaningful requested token to appear in the template
  // name (after stemming), so loose one-word overlaps don't mis-resolve.
  const wantedTokens = lookupTokens(name);
  if (wantedTokens.size === 0) return undefined;
  let best: { template: CatalogTemplate; score: number } | undefined;
  for (const template of TEMPLATES) {
    const nameTokens = lookupTokens(`${template.name} ${template.slug}`);
    let hits = 0;
    for (const token of wantedTokens) if (nameTokens.has(token)) hits += 1;
    const coverage = hits / wantedTokens.size;
    if (coverage === 1) {
      const score = hits / nameTokens.size;
      if (!best || score > best.score) best = { template, score };
    }
  }
  return best?.template;
}

const JOB_SEEKER_TEMPLATE_SLUGS = [
  "resume",
  "cover-letter",
  "job-search-checklist",
  "interview-prep-questions",
  "interview-script",
  "job-follow-up-email",
  "reference-request",
  "selection-criteria-response",
  "linkedin-profile-rewrite",
  "star-achievement-bank",
  "professional-reference-letter",
  "personal-brand-statement",
  "networking-outreach-message",
  "recruiter-introduction-email",
] as const;

const JOB_SEEKER_DEFAULTS = [
  "resume",
  "cover-letter",
  "job-search-checklist",
] as const;

function templateBySlug(slug: string): CatalogTemplate {
  const template = getTemplate(slug);
  if (!template) throw new Error(`Missing built-in template: ${slug}`);
  return template;
}

function isJobSeekerContext(context: string): boolean {
  const text = context.toLowerCase();
  const leavingCurrentJob = /\b(resign|resignation|quit|leaving my job|leave my job|notice period)\b/.test(text);
  const hiringSomeone = /\b(hiring someone|hire someone|hire a|hiring a|offer letter|onboard|onboarding)\b/.test(text);
  const seekingWork =
    /\b(i need a job|need a job|looking for (a )?(new )?job|find (a )?job|job search|job application|apply for|applying for|resume|cv|cover letter|interview|unemployed|lost my job|work asap|warehouse supervisor)\b/.test(
      text,
    );
  return seekingWork && !leavingCurrentJob && !hiringSomeone;
}

function isJobSeekerTemplate(template: CatalogTemplate | undefined): boolean {
  return Boolean(
    template &&
      (JOB_SEEKER_TEMPLATE_SLUGS as readonly string[]).includes(template.slug),
  );
}

function jobSeekerFallbackForItem(
  item: RecommendationItem,
  fallbackSlug: string,
): CatalogTemplate {
  const text = `${item.name} ${item.format} ${item.use_case} ${item.reason}`.toLowerCase();
  if (/\bcover\b/.test(text)) return templateBySlug("cover-letter");
  if (/\binterview|question|script\b/.test(text)) return templateBySlug("interview-prep-questions");
  if (/\bchecklist|action|plan|steps\b/.test(text)) return templateBySlug("job-search-checklist");
  if (/\bfollow[- ]?up|thank\b/.test(text)) return templateBySlug("job-follow-up-email");
  if (/\breference|referee\b/.test(text)) return templateBySlug("reference-request");
  if (/\bselection criteria|key selection criteria|\bksc\b|criteria response\b/.test(text)) return templateBySlug("selection-criteria-response");
  return templateBySlug(fallbackSlug);
}

function itemForTemplate(
  item: RecommendationItem,
  template: CatalogTemplate,
): RecommendationItem {
  return {
    ...item,
    name: template.name,
    format: template.structure_type === "checklist" ? "checklist" : item.format || "document",
    reason: item.reason || template.recommendation_reason,
    use_case: item.use_case || template.plain_description,
    benefits:
      item.benefits.length > 0
        ? item.benefits
        : [template.recommendation_reason],
  };
}

function normaliseItemForCatalog(
  item: RecommendationItem,
  context: string,
  fallbackSlug: string,
): RecommendationItem {
  const resolved = resolveTemplateByRecommendationName(item.name);
  const template =
    isJobSeekerContext(context) && !isJobSeekerTemplate(resolved)
      ? jobSeekerFallbackForItem(item, fallbackSlug)
      : resolved;

  return template ? itemForTemplate(item, template) : item;
}

export function normaliseRecommendationForCatalog(
  recommendation: Recommendation,
  context: string,
): Recommendation {
  const jobSeeker = isJobSeekerContext(context);
  const fallbacks = jobSeeker ? JOB_SEEKER_DEFAULTS : [];
  const primary = normaliseItemForCatalog(
    recommendation.primary,
    context,
    fallbacks[0] ?? "business-email",
  );

  let alternatives = recommendation.alternatives.map((item, index) =>
    normaliseItemForCatalog(
      item,
      context,
      fallbacks[index + 1] ?? fallbacks[0] ?? "business-email",
    ),
  );

  if (jobSeeker) {
    const seen = new Set([primary.name]);
    alternatives = [
      ...alternatives.filter((item) => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
      }),
      ...JOB_SEEKER_DEFAULTS.map((slug) =>
        itemForTemplate(
          {
            name: slug,
            format: "document",
            reason: "",
            use_case: "",
            benefits: [],
          },
          templateBySlug(slug),
        ),
      ).filter((item) => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
      }),
    ].slice(0, 2);
  }

  return { primary, alternatives: alternatives.slice(0, 2) };
}

export function normaliseIntentRecommendationForCatalog(
  result: IntentResult,
  context?: string,
): IntentResult {
  if (!result.recommendation) return result;
  const recommendation = normaliseRecommendationForCatalog(
    result.recommendation,
    context ?? result.situation,
  );
  return { ...result, recommendation };
}

export function templatesByDomain(domain: Domain): CatalogTemplate[] {
  return TEMPLATES.filter((t) => t.domain === domain).sort(
    (a, b) => a.display_order - b.display_order,
  );
}

export function getBundle(idOrSlug: string): CatalogBundle | undefined {
  return BUNDLES.find((b) => b.id === idOrSlug || b.slug === idOrSlug);
}

/** The templates that make up a bundle, in their bundle order. */
export function bundleTemplates(idOrSlug: string): CatalogTemplate[] {
  const bundle = getBundle(idOrSlug);
  if (!bundle) return [];
  return bundle.template_ids
    .map((id) => getTemplate(id))
    .filter((t): t is CatalogTemplate => Boolean(t));
}

// ---- pre-fill --------------------------------------------------

export interface ProfileLike {
  display_name?: string | null;
  phone?: string | null;
  business_name?: string | null;
  [key: string]: unknown;
}

/**
 * Resolve a template's fields against a profile. Returns a map of field name →
 * pre-filled value for every field whose `fillFromProfile` key has a value in
 * the profile. Fields without a profile source, or with an empty source value,
 * are omitted (they remain to be filled by the user).
 */
export function applyPreFill(
  template: CatalogTemplate,
  profile: ProfileLike,
): Record<string, string> {
  const filled: Record<string, string> = {};
  for (const field of template.fields) {
    const source = field.fillFromProfile;
    if (!source) continue;
    const value = profile[source];
    if (typeof value === "string" && value.trim()) {
      filled[field.name] = value.trim();
    }
  }
  return filled;
}

/**
 * Fields the user still needs to supply: required fields (or those named in
 * missing_detail_rules as required) that pre-fill did not satisfy.
 */
export function missingRequiredFields(
  template: CatalogTemplate,
  prefilled: Record<string, string>,
): MissingDetailRule[] {
  const ruleByField = new Map(
    template.missing_detail_rules.map((r) => [r.field, r]),
  );
  const missing: MissingDetailRule[] = [];
  for (const field of template.fields) {
    const rule = ruleByField.get(field.name);
    const isRequired = rule ? rule.is_required : field.required;
    if (!isRequired) continue;
    if (!prefilled[field.name]) {
      missing.push(
        rule ?? {
          field: field.name,
          reason: `${field.label} is needed to complete this document.`,
          is_required: true,
        },
      );
    }
  }
  return missing;
}
