import type { Section } from "@prompted/shared/browser";
import { commitGuestWorkspaceImport } from "@/lib/api/import-workspace";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import {
  claimGuestWorkspaceForMigration,
  completeGuestWorkspaceMigration,
  listGuestWorkspaceOutcomeIdsForMigration,
  markGuestWorkspaceMigrationImported,
  type PendingOutcome,
  type StoredWorkspace,
} from "@/lib/workspace-store";

export interface GuestMigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  failedOutcomeIds: string[];
  cleanupFailed: number;
  cleanupFailedOutcomeIds: string[];
}

async function migrateOne(
  userId: string,
  workspace: StoredWorkspace,
  pending: PendingOutcome | null,
  lease: OwnerDispatchLease,
): Promise<void> {
  const situation = pending?.situation || workspace.situation || `Continue ${workspace.title}`;
  const templateId = pending?.templateId || workspace.templateId || "imported_document";
  const { getTemplate } = await import("@prompted/shared/catalogue");
  const templateUuid = getTemplate(templateId)?.id ??
    (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(templateId)
      ? templateId
      : null);

  const recommendationPayload = {
      primary: {
        template_id: templateId,
        reason: pending?.templateName || workspace.title,
      },
      alternatives: [],
      conversation: pending?.conversation ?? [],
      situation,
      conversation_context: pending?.conversationContext || workspace.conversationContext || "",
      upload_context: pending?.uploadContext || workspace.uploadContext || "",
    };

  const sections: Section[] = workspace.sections.map((section) => ({
    ...section,
    document_id: workspace.documentId,
    user_id: userId,
  }));
  lease.assertCurrent();
  await commitGuestWorkspaceImport(
    {
      idempotencyKey: `guest-workspace:${workspace.outcomeId}:${workspace.documentId}`,
      outcomeId: workspace.outcomeId,
      documentId: workspace.documentId,
      title: workspace.title,
      situationText: situation,
      recommendationPayload,
      templateId: templateUuid,
      documentStatus: workspace.status === "archived" ? "archived" : "draft",
      sections,
    },
    lease,
  );
}

export async function migrateGuestWorkspaces(
  userId: string,
  lease: OwnerDispatchLease,
): Promise<GuestMigrationResult> {
  if (userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("GUEST_MIGRATION_OWNER_CONTEXT_MISMATCH");
  }
  lease.assertCurrent();
  const result: GuestMigrationResult = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    failedOutcomeIds: [],
    cleanupFailed: 0,
    cleanupFailedOutcomeIds: [],
  };

  for (const outcomeId of listGuestWorkspaceOutcomeIdsForMigration(userId)) {
    lease.assertCurrent();
    const candidate = claimGuestWorkspaceForMigration(userId, outcomeId);
    if (!candidate) {
      result.skipped += 1;
      continue;
    }

    try {
      if (!candidate.imported) {
        await migrateOne(userId, candidate.workspace, candidate.pending, lease);
        lease.assertCurrent();
        result.migrated += 1;
        markGuestWorkspaceMigrationImported(userId, outcomeId);
      }
      lease.assertCurrent();
      if (!completeGuestWorkspaceMigration(userId, outcomeId)) {
        result.cleanupFailed += 1;
        result.cleanupFailedOutcomeIds.push(outcomeId);
      }
    } catch {
      lease.assertCurrent();
      result.failed += 1;
      result.failedOutcomeIds.push(outcomeId);
    }
  }

  lease.assertCurrent();
  return result;
}
