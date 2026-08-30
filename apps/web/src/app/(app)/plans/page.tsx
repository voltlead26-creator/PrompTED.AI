"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers";
import { ChecklistLibrary } from "@/components/organisms/ChecklistLibrary";
import { WhatsDue } from "@/components/organisms/WhatsDue";
import { useWhatsDue } from "@/hooks/useChecklist";
import { Spinner } from "@/components/atoms/Spinner";
import { ManualPlanEditor } from "./ManualPlanEditor";
import { ManualPlansLibrary } from "./ManualPlansLibrary";
import { PlansCreatePanel } from "./PlansCreatePanel";
import styles from "../library/library.module.css";
import hubStyles from "./PlansHub.module.css";

type CreateMode = "manual" | "ted" | null;

export default function PlansPage() {
  const { user, loading } = useAuth();
  const { items: dueItems } = useWhatsDue(user?.id ?? "");
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("create");
    setCreateMode(mode === "manual" || mode === "ted" ? mode : null);
    setPlanId(params.get("plan"));
  }, []);

  if (loading)
    return (
      <section className={styles.page} aria-labelledby="plans-heading">
        <h1 id="plans-heading" className={styles.heading}>
          Checklists / Action Plans
        </h1>
        <Spinner label="Loading your plans" showLabel />
      </section>
    );

  if (createMode === "manual") {
    return (
      <section className={styles.page} aria-labelledby="manual-plan-heading">
        <header className={hubStyles.manualHeader}>
          <div>
            <h1 id="manual-plan-heading" className={styles.heading}>
              Live checklist / action plan
            </h1>
            <p>Edit the plan directly. Changes are saved as you work.</p>
          </div>
          <Link href="/plans" className={hubStyles.backLink}>
            Back to plans
          </Link>
        </header>
        <ManualPlanEditor planId={planId} />
      </section>
    );
  }

  return (
    <section className={styles.page} aria-labelledby="plans-heading">
      <header className={styles.header}>
        <div>
          <h1 id="plans-heading" className={styles.heading}>
            Checklists / Action Plans
          </h1>
          <p>
            Build a practical plan, edit it live, and keep progress separate from your documents.
          </p>
        </div>
      </header>

      {createMode === "ted" ? (
        <section className={styles.signInPrompt} aria-label="Create with TED">
          <p>
            Tell TED what you need to achieve and it will build the checklist or action plan around
            your situation.
          </p>
          <Link href="/create?intent=checklist-action-plan">Create with TED</Link>
        </section>
      ) : null}

      <PlansCreatePanel />
      <ManualPlansLibrary />

      {user && dueItems.length > 0 ? <WhatsDue items={dueItems} /> : null}

      <ChecklistLibrary userId={user?.id} />

      {!user ? (
        <div className={styles.signInPrompt}>
          <p>
            Guest plans are stored on this device. Sign in later to keep plans available across
            devices.
          </p>
        </div>
      ) : null}
    </section>
  );
}
