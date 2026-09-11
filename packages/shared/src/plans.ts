// =====================================================
// PrompTED — Plan Definitions and Usage Helpers
// Prices are NOT stored here — they live in RevenueCat.
// This file only stores capability gates.
// =====================================================

import type { Plan, SubscriptionStatus } from "./types/index.ts";

/** Validated projection of the database's versioned account-access authority. */
export interface EffectiveProductAccess {
  userId: string;
  subscriptionPlan: Plan;
  effectivePlan: Plan;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  accessProfile: "subscription" | "owner";
  monthlyDocumentCap: number;
  aiEditing: boolean;
  businessFeatures: boolean;
}

export function parseEffectiveProductAccess(value: unknown, userId: string): EffectiveProductAccess {
  const invalid = () => { throw new Error("PRODUCT_ACCESS_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  const keys = ["contract_version", "user_id", "subscription_plan", "effective_plan",
    "subscription_status", "current_period_end", "access_profile", "monthly_document_cap",
    "ai_editing", "business_features"];
  const isPlan = (plan: unknown): plan is Plan =>
    plan === "free" || plan === "pro" || plan === "premium" || plan === "business";
  const status = v.subscription_status, periodEnd = v.current_period_end;
  if (Object.keys(v).length !== keys.length || !keys.every(key => Object.hasOwn(v, key)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
    v.user_id !== userId || v.contract_version !== "product-access.1" ||
    !isPlan(v.subscription_plan) || !isPlan(v.effective_plan) ||
    (status !== null && status !== "active" && status !== "trialing" && status !== "cancelled" && status !== "expired") ||
    (periodEnd !== null && (typeof periodEnd !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(periodEnd) || !Number.isFinite(Date.parse(periodEnd)))) ||
    (v.access_profile !== "subscription" && v.access_profile !== "owner") ||
    typeof v.monthly_document_cap !== "number" || !Number.isSafeInteger(v.monthly_document_cap) || v.monthly_document_cap < 1 ||
    typeof v.ai_editing !== "boolean" || typeof v.business_features !== "boolean") return invalid();
  const effectivePlan = status === "active" || status === "trialing" ? v.subscription_plan : "free";
  const owner = v.access_profile === "owner";
  if ((status === null && (v.subscription_plan !== "free" || periodEnd !== null)) ||
    v.effective_plan !== effectivePlan ||
    (owner && v.monthly_document_cap !== 1000) ||
    v.ai_editing !== (owner || effectivePlan !== "free") ||
    v.business_features !== (owner || effectivePlan === "business")) return invalid();
  return { userId, subscriptionPlan: v.subscription_plan, effectivePlan,
    subscriptionStatus: status, currentPeriodEnd: periodEnd, accessProfile: v.access_profile,
    monthlyDocumentCap: v.monthly_document_cap, aiEditing: v.ai_editing, businessFeatures: v.business_features };
}

export interface PlanDefinition {
  id: Plan;
  name: string;
  /** null = unlimited */
  monthlyDocumentCap: number | null;
  aiEditing: boolean;
  businessFeatures: boolean;
  features: string[];
}

export const PLANS: Record<Plan, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    monthlyDocumentCap: 3,
    aiEditing: false,
    businessFeatures: false,
    features: [
      "3 documents per month",
      "All document templates",
      "PDF, Word export",
      "Manual editing",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyDocumentCap: 50,
    aiEditing: true,
    businessFeatures: false,
    features: [
      "50 documents per month",
      "All document templates",
      "PDF, Word, Excel export",
      "Edit with TED (AI editing)",
      "Version history",
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    monthlyDocumentCap: null,
    aiEditing: true,
    businessFeatures: false,
    features: [
      "Unlimited documents",
      "All document templates",
      "PDF, Word, Excel export",
      "Edit with TED (AI editing)",
      "Version history",
      "Priority support",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    monthlyDocumentCap: null,
    aiEditing: true,
    businessFeatures: true,
    features: [
      "Unlimited documents",
      "All document templates",
      "PDF, Word, Excel export",
      "Edit with TED (AI editing)",
      "Version history",
      "Brand kit (logo, colours, footer)",
      "Business profile pre-fill",
      "Team members",
      "Priority support",
    ],
  },
};

export const PLAN_ORDER: Plan[] = ["free", "pro", "premium", "business"];

export function planDefinition(plan: Plan): PlanDefinition {
  return PLANS[plan];
}

// -----------------------------------------------
// Usage state (subset fetched from DB)
// -----------------------------------------------

export interface UsageState {
  plan: Plan;
  /** Owner-bound server access; absent only in older consumers that did not fetch it. */
  access?: EffectiveProductAccess;
  /** How many document_created events this calendar month */
  documentsThisMonth: number;
  /** Null on the free plan, where there's no billing record. Omitted where not fetched. */
  subscriptionStatus?: SubscriptionStatus | null;
  /** ISO date the current billing period ends, if known. Omitted where not fetched. */
  currentPeriodEnd?: string | null;
}

export interface UsageSummary {
  plan: Plan;
  cap: number | null;
  used: number;
  remaining: number | null;
  atCap: boolean;
  percentUsed: number | null;
}

export function summariseUsage(state: UsageState): UsageSummary {
  const def = planDefinition(state.plan);
  const cap = state.access?.monthlyDocumentCap ?? def.monthlyDocumentCap;
  const used = state.documentsThisMonth;
  const remaining = cap === null ? null : Math.max(0, cap - used);
  const atCap = cap !== null && used >= cap;
  const percentUsed = cap === null ? null : Math.min(100, (used / cap) * 100);

  return { plan: state.plan, cap, used, remaining, atCap, percentUsed };
}

export function canCreateDocument(state: UsageState): boolean {
  return !summariseUsage(state).atCap;
}

export function nextPlanUp(plan: Plan): Plan | null {
  const idx = PLAN_ORDER.indexOf(plan);
  if (idx === -1 || idx === PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[idx + 1] ?? null;
}

export function hasAiEditing(plan: Plan): boolean {
  return planDefinition(plan).aiEditing;
}

export function hasBusinessFeatures(plan: Plan): boolean {
  return planDefinition(plan).businessFeatures;
}
