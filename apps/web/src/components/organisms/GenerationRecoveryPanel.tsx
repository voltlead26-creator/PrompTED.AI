"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AUTH_SECTION_ID,
  PAYWALL_SECTION_ID,
  type GenerationIssue,
} from "@/hooks/useDocument";
import { signInHref } from "@/lib/auth-return";
import styles from "./GenerationRecoveryPanel.module.css";

export interface GenerationRecoveryPanelProps {
  issues: GenerationIssue[];
  regeneratingSectionId: string | null;
  onRetry: (sectionId: string) => void;
}

export function GenerationRecoveryPanel({
  issues,
  regeneratingSectionId,
  onRetry,
}: GenerationRecoveryPanelProps) {
  const pathname = usePathname() ?? "/home";
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const returnPath = `${pathname}${query ? `?${query}` : ""}`;

  if (issues.length === 0) return null;

  const paywall = issues.find((issue) => issue.sectionId === PAYWALL_SECTION_ID);
  if (paywall) {
    return (
      <section className={styles.panel} aria-labelledby="generation-recovery-title">
        <div>
          <p className={styles.eyebrow}>Out of credits</p>
          <h2 id="generation-recovery-title">You&apos;re out of document credits</h2>
          <p>{paywall.reason}</p>
          <p>Your existing documents are safe — you can still read, edit and export them.</p>
        </div>

        <div className={styles.list}>
          <article className={styles.item}>
            <div>
              <strong>Keep using TED</strong>
              <p>Choose a plan with more monthly documents.</p>
            </div>
            <Link className={styles.upgradeLink} href="/settings/account">
              Update subscription
            </Link>
          </article>
        </div>
      </section>
    );
  }

  const auth = issues.find((issue) => issue.sectionId === AUTH_SECTION_ID);
  if (auth) {
    return (
      <section className={styles.panel} aria-labelledby="generation-recovery-title">
        <div>
          <p className={styles.eyebrow}>Sign-in required</p>
          <h2 id="generation-recovery-title">Your session has expired</h2>
          <p>{auth.reason}</p>
          <p>Your document and supplied information are still safe.</p>
        </div>

        <div className={styles.list}>
          <article className={styles.item}>
            <div>
              <strong>Continue this document</strong>
              <p>Sign in again and TED will bring you back here.</p>
            </div>
            <Link className={styles.upgradeLink} href={signInHref(returnPath)}>
              Sign in again
            </Link>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="generation-recovery-title">
      <div>
        <p className={styles.eyebrow}>Needs attention</p>
        <h2 id="generation-recovery-title">TED could not safely finish every section</h2>
        <p>Your existing document has not been overwritten. Retry only the affected section or write it manually.</p>
      </div>

      <div className={styles.list}>
        {issues.map((issue) => {
          const busy = regeneratingSectionId === issue.sectionId;
          return (
            <article key={issue.sectionId} className={styles.item}>
              <div>
                <strong>{issue.sectionName}</strong>
                <p>{issue.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => onRetry(issue.sectionId)}
                disabled={Boolean(regeneratingSectionId)}
              >
                {busy ? "Regenerating…" : "Regenerate this section"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
