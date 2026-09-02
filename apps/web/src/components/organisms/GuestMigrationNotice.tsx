"use client";

import type { GuestMigrationResult } from "@/lib/guest-workspace-migration";
import type { GuestMigrationStatus } from "@/components/providers/AuthProvider";
import styles from "./GuestMigrationNotice.module.css";

export interface GuestMigrationNoticeProps {
  status: GuestMigrationStatus;
  result: GuestMigrationResult | null;
  onRetry: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}

export function GuestMigrationNotice({
  status,
  result,
  onRetry,
  onConfirm,
  onDiscard,
}: GuestMigrationNoticeProps) {
  if (
    status === "idle" ||
    (status === "complete" &&
      !result?.migrated &&
      !result?.failed &&
      !result?.skipped &&
      !result?.cleanupFailed)
  ) return null;

  if (status === "review_required") {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="alert">
        <div>
          <strong>Unclaimed browser drafts need your choice.</strong>
          <span>
            These drafts are stored on this device and are not yet proven to belong to this account.
            Move them only if they are yours, especially on a shared browser.
          </span>
        </div>
        <button type="button" onClick={onConfirm}>Move my browser drafts</button>
        <button type="button" onClick={onDiscard}>Discard browser drafts</button>
      </div>
    );
  }

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
          <strong>Guest document migration needs attention.</strong>
          <span>
            {!result
              ? "PrompTED could not confirm which guest documents moved. Your device copy has not been described as complete."
              : [
                  result.migrated ? `${result.migrated} moved successfully.` : "",
                  result.failed ? `${result.failed} still need to be moved.` : "",
                  result.skipped ? `${result.skipped} could not be safely claimed yet.` : "",
                  result.cleanupFailed
                    ? `${result.cleanupFailed} moved successfully but still need local cleanup on this device.`
                    : "",
                ].filter(Boolean).join(" ")}
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
