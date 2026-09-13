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

export function documentLimitNotice(err: unknown): DocumentLimitNotice | null {
  if (!isErrorRecord(err)) return null;
  const detail = isErrorRecord(err.payload) && isErrorRecord(err.payload.error)
    ? err.payload.error
    : null;
  if (err.code !== "DOCUMENT_LIMIT_REACHED" && detail?.code !== "DOCUMENT_LIMIT_REACHED") {
    return null;
  }
  const plan = detail?.current_plan;
  const confirmed =
    err.status === 402 &&
    err.code === "DOCUMENT_LIMIT_REACHED" &&
    detail?.code === "DOCUMENT_LIMIT_REACHED" &&
    typeof detail.message === "string" && detail.message.trim().length > 0 &&
    detail.paywall_trigger === false &&
    (plan === "free" || plan === "pro" || plan === "premium" || plan === "business") &&
    !Object.prototype.hasOwnProperty.call(detail, "plan_required");

  // A known cap cannot become an upgrade offer when its details are malformed.
  // Use fixed safe copy; server diagnostics are never presentation content.
  return {
    heading: confirmed ? "Monthly document limit reached" : "Document generation paused",
    reason: confirmed
      ? MONTHLY_LIMIT_REASON
      : UNCONFIRMED_LIMIT_REASON,
  };
}

export function generationLimitNotice(err: unknown): DocumentLimitNotice | null {
  // Preserve the non-upgrade cap contract, including contradictory billing codes.
  const monthlyLimit = documentLimitNotice(err);
  if (monthlyLimit) return monthlyLimit;
  if (!isErrorRecord(err)) return null;
  const detail = isErrorRecord(err.payload) && isErrorRecord(err.payload.error)
    ? err.payload.error
    : null;
  if (err.status !== 402 && err.code !== "PAYWALL" && detail?.code !== "PAYWALL") {
    return null;
  }
  const plan = detail?.current_plan;
  const confirmed =
    err.status === 402 &&
    err.code === "PAYWALL" &&
    detail?.code === "PAYWALL" &&
    typeof detail.message === "string" && detail.message.trim().length > 0 &&
    detail.paywall_trigger === true &&
    (plan === "free" || plan === "pro" || plan === "premium") &&
    detail.plan_required === nextPlanUp(plan);

  if (!confirmed) {
    return { heading: "Document generation paused", reason: UNCONFIRMED_LIMIT_REASON };
  }
  return {
    heading: "Monthly document limit reached",
    reason: MONTHLY_LIMIT_REASON,
    action: "review_account",
  };
}
