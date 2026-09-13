import { nextPlanUp } from "@prompted/shared/plans";

export interface DocumentLimitNotice {
  heading: string;
  reason: string;
  action?: "review_account";
}

const MONTHLY_LIMIT_REASON = "You've reached your document limit for this month. New allowance becomes available next month.";
const UNCONFIRMED_LIMIT_REASON = "PrompTED could not confirm the document limit details. New generation is paused. You can still edit your existing wording.";

function isErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitNotice(err: unknown, includePaywall: boolean): DocumentLimitNotice | null {
  if (!isErrorRecord(err)) return null;
  const detail = isErrorRecord(err.payload) && isErrorRecord(err.payload.error)
    ? err.payload.error
    : null;
  // A known cap keeps its non-upgrade contract even when billing codes conflict.
  const nonUpgrade = err.code === "DOCUMENT_LIMIT_REACHED" || detail?.code === "DOCUMENT_LIMIT_REACHED";
  if (!nonUpgrade && (!includePaywall ||
    (err.status !== 402 && err.code !== "PAYWALL" && detail?.code !== "PAYWALL"))) {
    return null;
  }
  const plan = detail?.current_plan;
  const code = nonUpgrade ? "DOCUMENT_LIMIT_REACHED" : "PAYWALL";
  const confirmed =
    err.status === 402 &&
    err.code === code &&
    detail?.code === code &&
    typeof detail.message === "string" && detail.message.trim().length > 0 &&
    detail.paywall_trigger === !nonUpgrade &&
    (plan === "free" || plan === "pro" || plan === "premium" || plan === "business") &&
    (nonUpgrade
      ? !Object.prototype.hasOwnProperty.call(detail, "plan_required")
      : plan !== "business" && detail.plan_required === nextPlanUp(plan));

  // Use fixed safe copy; server diagnostics are never presentation content.
  const notice: DocumentLimitNotice = {
    heading: confirmed ? "Monthly document limit reached" : "Document generation paused",
    reason: confirmed
      ? MONTHLY_LIMIT_REASON
      : UNCONFIRMED_LIMIT_REASON,
  };
  if (confirmed && !nonUpgrade) notice.action = "review_account";
  return notice;
}

export function documentLimitNotice(err: unknown): DocumentLimitNotice | null {
  return limitNotice(err, false);
}

export function generationLimitNotice(err: unknown): DocumentLimitNotice | null {
  return limitNotice(err, true);
}
