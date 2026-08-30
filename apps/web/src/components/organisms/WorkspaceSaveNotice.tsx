"use client";

import { useEffect, useState } from "react";
import type { WorkspaceSyncStatus } from "@/hooks/useDocument";
import styles from "./WorkspaceSaveNotice.module.css";

export interface WorkspaceSaveNoticeProps {
  authenticated: boolean;
  syncStatus: WorkspaceSyncStatus;
  lastSyncedAt: string | null;
  onRetry: () => void;
}

export function WorkspaceSaveNotice({
  authenticated,
  syncStatus,
  onRetry,
}: WorkspaceSaveNoticeProps) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!online) {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="status">
        <strong>Offline — changes remain on this device.</strong>
        <span>Keep this page open. Account syncing resumes when your connection returns.</span>
      </div>
    );
  }

  if (!authenticated || syncStatus === "local_only") {
    return (
      <div className={`${styles.notice} ${styles.guest}`} role="status">
        <strong>Saved on this device only.</strong>
        <span>Sign in before relying on this document from another device or browser.</span>
      </div>
    );
  }

  if (syncStatus === "failed") {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="alert">
        <div>
          <strong>Account sync failed.</strong>
          <span>Your latest changes are still saved on this device.</span>
        </div>
        <button type="button" onClick={onRetry}>Retry sync</button>
      </div>
    );
  }

  // Healthy states (saving / saved) render nothing. The persistent banner
  // permanently consumed a row of workspace height for information the user
  // rarely needs; only problem states (offline, guest-only, sync failed)
  // surface a notice now.
  return null;
}
