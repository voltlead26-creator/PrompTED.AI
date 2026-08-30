"use client";

import type { Plan } from "@prompted/shared/browser";
import { PLAN_ORDER, PLANS } from "@prompted/shared/plans";
import { Button } from "@/components/atoms/Button";
import styles from "./PaywallModal.module.css";

interface PaywallModalProps {
  open: boolean;
  currentPlan: Plan;
  /** Which feature triggered the paywall. */
  feature?: string;
  onClose: () => void;
  /** Called with the chosen plan identifier for purchasing. */
  onSelectPlan: (plan: Plan) => void;
}

/**
 * PaywallModal — shown when user hits their plan cap.
 * Never shown before a completed draft (FR-012).
 * Prices are NOT shown here (read from RevenueCat in the parent).
 */
export function PaywallModal({
  open,
  currentPlan,
  feature,
  onClose,
  onSelectPlan,
}: PaywallModalProps) {
  if (!open) return null;

  const currentIdx = PLAN_ORDER.indexOf(currentPlan);
  const upgradablePlans = PLAN_ORDER.filter(
    (p) => PLAN_ORDER.indexOf(p) > currentIdx,
  );

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-heading"
      >
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <h2 id="paywall-heading" className={styles.heading}>
          {feature ? `Upgrade to use ${feature}` : "Upgrade your plan"}
        </h2>
        <p className={styles.sub}>
          {feature
            ? `${feature} is available on paid plans.`
            : "You've reached the limit on your current plan. Upgrade to keep going."}
        </p>
        <p className={styles.notice} role="note">
          Online checkout isn&apos;t available yet on the web. Choosing a plan below lets TED know
          what you&apos;re after — we&apos;ll follow up rather than charge you automatically.
        </p>

        <div className={styles.plans} role="list">
          {upgradablePlans.map((plan) => {
            const def = PLANS[plan];
            return (
              <div key={plan} className={styles.planCard} role="listitem">
                <div className={styles.planHeader}>
                  <span className={styles.planName}>{def.name}</span>
                  {plan === "premium" && (
                    <span className={styles.popularBadge}>Most popular</span>
                  )}
                </div>
                <ul className={styles.featureList} aria-label={`${def.name} features`}>
                  {def.features.map((f) => (
                    <li key={f} className={styles.featureItem}>
                      <span className={styles.check} aria-hidden="true">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  fullWidth
                  variant={plan === "premium" ? "primary" : "ghost"}
                  onClick={() => onSelectPlan(plan)}
                  aria-label={`Select ${def.name} plan`}
                >
                  Choose {def.name}
                </Button>
              </div>
            );
          })}
        </div>

        <button type="button" className={styles.notNow} onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
