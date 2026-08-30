"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import styles from "./PlansHub.module.css";

export function PlansCreatePanel() {
  return (
    <section className={styles.createSection} aria-labelledby="plans-create-heading">
      <div className={styles.createHeadingRow}>
        <div>
          <h2 id="plans-create-heading">Create a checklist or action plan</h2>
          <p>Build it with TED, work live from a blank plan, or start from an existing template.</p>
        </div>
      </div>

      <div className={styles.createGrid}>
        <Link href="/create?intent=checklist-action-plan" className={styles.createCard}>
          <span className={styles.cardIcon}><Icon name="sparkles" size={22} /></span>
          <strong>Create with TED</strong>
          <span>Describe what you need to achieve and TED will turn it into a practical interactive plan.</span>
        </Link>

        <Link href="/plans?create=manual" className={styles.createCard}>
          <span className={styles.cardIcon}><Icon name="edit" size={22} /></span>
          <strong>Create manually</strong>
          <span>Open the live editor now. Add, reorder and update actions as you work.</span>
        </Link>

        <Link href="/create?intent=plan-template" className={styles.createCard}>
          <span className={styles.cardIcon}><Icon name="template" size={22} /></span>
          <strong>Start from template</strong>
          <span>Use an existing checklist or action-plan structure and tailor it to your situation.</span>
        </Link>
      </div>
    </section>
  );
}
