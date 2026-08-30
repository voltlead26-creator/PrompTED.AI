// =====================================================
// PrompTED — Plan Definitions and Usage Helpers
// Prices are NOT stored here — they live in RevenueCat.
// This file only stores capability gates.
// =====================================================

import type { Plan, SubscriptionStatus } from "./types/index";

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
  const cap = def.monthlyDocumentCap;
  const used = state.documentsThisMonth;
  const remaining = cap === null ? null : Math.max(0, cap - used);
  const atCap = cap !== null && used >= cap;
  const percentUsed = cap === null ? null : Math.min(100, (used / cap) * 100);

  return { plan: state.plan, cap, used, remaining, atCap, percentUsed };
}

export function canCreateDocument(state: UsageState): boolean {
  const def = planDefinition(state.plan);
  if (def.monthlyDocumentCap === null) return true;
  return state.documentsThisMonth < def.monthlyDocumentCap;
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
