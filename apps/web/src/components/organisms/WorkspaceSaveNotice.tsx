"use client";

import { useEffect, useState } from "react";
import type { WorkspaceSyncStatus } from "@/hooks/useDocument";
import type { WorkspaceDeviceSaveStatus } from "@/lib/workspace-store";
import styles from "./WorkspaceSaveNotice.module.css";

export interface WorkspaceSaveNoticeProps {
  authenticated: boolean;
  syncStatus: WorkspaceSyncStatus;
  deviceSaveStatus?: WorkspaceDeviceSaveStatus;
  lastSyncedAt: string | null;
  onRetry: () => void;
}

export function WorkspaceSaveNotice({
  authenticated,
  syncStatus,
  deviceSaveStatus = "unknown",
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

  const cacheUnavailable =
    deviceSaveStatus === "quota_exceeded" || deviceSaveStatus === "unavailable";
  if (cacheUnavailable) {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="alert">
        <div>
          <strong>
            {deviceSaveStatus === "quota_exceeded"
              ? "Browser storage is full."
              : "The browser recovery copy is unavailable."}
          </strong>
          <span>
            {syncStatus === "saved"
              ? "This version is saved to your account."
              : "Keep this page open. A browser recovery copy is unavailable."}
          </span>
        </div>
        <button type="button" onClick={onRetry}>
          Try saving again
        </button>
      </div>
    );
  }
  if (!online) {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="status">
        <strong>Offline.</strong>
        <span>
          {deviceSaveStatus === "saved"
            ? "A recovery copy is saved in this browser tab."
            : "Keep this page open."}{" "}
          Retry account saving when your connection returns.
        </span>
      </div>
    );
  }
  if (!authenticated || syncStatus === "local_only") {
    return (
      <div className={`${styles.notice} ${styles.guest}`} role="status">
        <strong>
          {deviceSaveStatus === "saved"
            ? "Saved in this browser tab only."
            : "Changes are in this open page."}
        </strong>
        <span>Keep this tab open. Sign in and save before relying on this document elsewhere.</span>
        {deviceSaveStatus !== "saved" && (
          <button type="button" onClick={onRetry}>
            Try saving again
          </button>
        )}
      </div>
    );
  }
  if (syncStatus === "failed") {
    return (
      <div className={`${styles.notice} ${styles.warning}`} role="alert">
        <div>
          <strong>Account sync failed.</strong>
          <span>
            {deviceSaveStatus === "saved"
              ? "Your latest changes are saved in this browser tab."
              : "Keep this page open and try saving again."}
          </span>
        </div>
        <button type="button" onClick={onRetry}>
          Retry sync
        </button>
      </div>
    );
  }
  return null;
}
