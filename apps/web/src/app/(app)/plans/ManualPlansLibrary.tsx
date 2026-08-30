"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listGuestManualPlans, type ManualPlanState } from "./manual-plan-store";
import styles from "./PlansHub.module.css";

export function ManualPlansLibrary() {
  const [plans, setPlans] = useState<ManualPlanState[]>([]);

  useEffect(() => {
    setPlans(listGuestManualPlans());
  }, []);

  if (!plans.length) return null;

  return (
    <section className={styles.manualLibrary} aria-labelledby="manual-plans-heading">
      <div>
        <h2 id="manual-plans-heading">Live plans saved on this device</h2>
        <p>Reopen a plan and keep editing exactly where you left it.</p>
      </div>
      <div className={styles.manualGrid}>
        {plans.map((plan) => {
          const done = plan.items.filter((item) => item.done).length;
          return (
            <Link
              key={plan.id}
              href={`/plans?create=manual&plan=${encodeURIComponent(plan.id)}`}
              className={styles.manualCard}
            >
              <strong>{plan.title.trim() || "Untitled action plan"}</strong>
              <span>{done} / {plan.items.length} complete</span>
              <span>Open live editor</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
