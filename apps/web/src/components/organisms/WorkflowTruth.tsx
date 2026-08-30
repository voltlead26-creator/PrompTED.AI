import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";
import type { WorkspaceSyncStatus } from "@/hooks/useDocument";
import styles from "./WorkflowTruth.module.css";

interface WorkflowTruthProps {
  initialTruth?: WorkspaceInitialState["truth"] | null;
  syncStatus: WorkspaceSyncStatus;
  currentRevision?: number | null;
  approvedRevision?: number | null;
  operationRevision?: number | null;
}

function persistenceLabel(
  truth: WorkspaceInitialState["truth"] | null | undefined,
  syncStatus: WorkspaceSyncStatus,
): string {
  if (syncStatus === "saving") return "Saving changes";
  if (syncStatus === "failed") return "Saved on this device; account sync needs attention";
  if (syncStatus === "local_only") return "Saved on this device only";
  if (syncStatus === "saved") return "Saved to your account";
  if (truth?.persistence === "unavailable") return "Account state is reconnecting";
  return "Ready to save";
}

export function WorkflowTruth({
  initialTruth,
  syncStatus,
  currentRevision,
  approvedRevision,
  operationRevision,
}: WorkflowTruthProps) {
  const warning = syncStatus === "failed" || syncStatus === "local_only";
  const effectiveCurrentRevision = currentRevision ?? initialTruth?.currentRevision;
  const effectiveApprovedRevision = approvedRevision ?? initialTruth?.approvedRevision;

  return (
    <p className={styles.bar} role="status" aria-live="polite">
      <span className={`${styles.item}${warning ? ` ${styles.warning}` : ""}`}>
        {persistenceLabel(initialTruth, syncStatus)}
      </span>
      {effectiveCurrentRevision ? (
        <span>Current revision {effectiveCurrentRevision}</span>
      ) : null}
      {effectiveApprovedRevision ? (
        <span>Database approval: revision {effectiveApprovedRevision}</span>
      ) : (
        <span>Not yet approved</span>
      )}
      {initialTruth?.ledgerBindingStatus === "captured" && initialTruth.ledgerVersion ? (
        <span>Ledger {initialTruth.ledgerVersion}</span>
      ) : null}
      {initialTruth?.operationStatus ? (
        <span>
          Generation: {initialTruth.operationStatus.replaceAll("_", " ")}
          {operationRevision ? ` · operation revision ${operationRevision}` : ""}
        </span>
      ) : null}
    </p>
  );
}
