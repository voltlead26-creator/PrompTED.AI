"use client";

import type { GuestMigrationResult } from "@/lib/guest-workspace-migration";
import type { GuestMigrationStatus } from "@/components/providers/AuthProvider";
import styles from "./GuestMigrationNotice.module.css";

export interface GuestMigrationNoticeProps {
  status: GuestMigrationStatus;
  result: GuestMigrationResult | null;
  onRetry: () => void;
}

export function GuestMigrationNotice({ status, result, onRetry }: GuestMigrationNoticeProps) {
  if (status === "idle" || (status === "complete" && !result?.migrated && !result?.failed)) return null;

  if (status === "migrating") {
    return (
      <div className={`${styles.notice} ${styles.progress}`} role="status">
        <strong>Moving your guest documents into your account…</strong>
        <span>Keep this page open until the migration finishes.</span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="alert">
        <div>
          <strong>Some guest documents could not be moved.</strong>
          <span>
            {result?.migrated ? `${result.migrated} moved successfully. ` : ""}
            {result?.failed ?? 0} still remain on this device.
          </span>
        </div>
        <button type="button" onClick={onRetry}>Retry migration</button>
      </div>
    );
  }

  return (
    <div className={`${styles.notice} ${styles.success}`} role="status">
      <strong>Guest documents moved into your account.</strong>
      <span>{result?.migrated ?? 0} document{result?.migrated === 1 ? "" : "s"} can now sync across devices.</span>
    </div>
  );
}
