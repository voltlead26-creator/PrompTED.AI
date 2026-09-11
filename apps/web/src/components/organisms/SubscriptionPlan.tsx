"use client";

import type { Plan, SubscriptionStatus } from "@prompted/shared/browser";
import { PLANS, summariseUsage, type EffectiveProductAccess } from "@prompted/shared/plans";
import styles from "./SubscriptionPlan.module.css";

interface SubscriptionPlanProps {
  plan: Plan;
  access?: EffectiveProductAccess;
  documentsThisMonth: number;
  subscriptionStatus?: SubscriptionStatus | null;
  currentPeriodEnd?: string | null;
  onUpgrade?: () => void;
}

function statusLine(
  plan: Plan,
  status: SubscriptionStatus | null | undefined,
  periodEnd: string | null | undefined,
): string | null {
  if (plan === "free") return "Free plan — no billing period.";
  if (!periodEnd) return null;
  const formatted = new Date(periodEnd).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  if (status === "cancelled" || status === "expired") return `Access ends ${formatted}.`;
  return `Renews ${formatted}.`;
}

/**
 * SubscriptionPlan — displays current plan, usage meter, and upgrade CTA.
 * Used on the Settings → Account page.
 */
export function SubscriptionPlan({
  plan,
  access,
  documentsThisMonth,
  subscriptionStatus,
  currentPeriodEnd,
  onUpgrade,
}: SubscriptionPlanProps) {
  const def = PLANS[plan];
  const usage = summariseUsage({ plan, documentsThisMonth, access });
  const isOwner = access?.accessProfile === "owner";
  const featurePlan = PLANS[access?.effectivePlan ?? plan];
  const allowanceLabel = usage.cap === null ? "Unlimited documents" : `${usage.cap.toLocaleString("en-AU")} documents per month`;
  const features = [allowanceLabel, ...(isOwner
    ? ["AI editing", "Business features, including branding"]
    : featurePlan.features.slice(1))];
  const isUnlimited = usage.cap === null;
  const renewal = statusLine(plan, subscriptionStatus, currentPeriodEnd);

  return (
    <section className={styles.card} aria-label="Subscription plan">
      <div className={styles.header}>
        <div>
          <span className={styles.planLabel}>Current plan</span>
          <h2 className={styles.planName}>{isOwner ? "Owner access" : def.name}</h2>
          {isOwner && <p className={styles.renewal}>Subscription: {def.name}</p>}
          {renewal && <p className={styles.renewal}>{renewal}</p>}
        </div>
        {!isOwner && plan !== "business" && onUpgrade && (
          <button type="button" className={styles.upgradeBtn} onClick={onUpgrade}>
            Upgrade
          </button>
        )}
      </div>

      <div className={styles.usageSection} aria-label="Document usage this month">
        <div className={styles.usageHeader}>
          <span className={styles.usageLabel}>Documents this month</span>
          <span className={styles.usageCount}>
            {isUnlimited ? (
              <>{documentsThisMonth} <span className={styles.muted}>/ unlimited</span></>
            ) : (
              <>{documentsThisMonth} <span className={styles.muted}>/ {usage.cap}</span></>
            )}
          </span>
        </div>
        {!isUnlimited && (
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuenow={usage.percentUsed ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${usage.percentUsed?.toFixed(0) ?? 0}% of monthly documents used`}
          >
            <div
              className={styles.progressFill}
              data-at-cap={usage.atCap || undefined}
              style={{ width: `${usage.percentUsed ?? 0}%` }}
            />
          </div>
        )}
        {usage.atCap && (
          <p className={styles.capWarning} role="alert">
            {isOwner ? "You've reached your monthly limit. New allowance becomes available next month."
              : "You've reached your monthly limit. Upgrade to create more documents."}
          </p>
        )}
      </div>

      <ul className={styles.features} aria-label={isOwner ? "Owner access features" : `${def.name} plan features`}>
        {features.map((f) => (
          <li key={f} className={styles.featureItem}>
            <span className={styles.check} aria-hidden="true">✓</span>
            {f}
          </li>
        ))}
      </ul>
    </section>
  );
}
