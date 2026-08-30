import type { Section } from "@prompted/shared/browser";
import { commitGuestWorkspaceImport } from "@/lib/api/import-workspace";
import type { PendingOutcome, StoredWorkspace } from "@/lib/workspace-store";

const WORKSPACE_PREFIX = "prompted:workspace:";
const PENDING_PREFIX = "prompted:pending:";
const MIGRATED_PREFIX = "prompted:guest-migrated:";

export interface GuestMigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  failedOutcomeIds: string[];
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function listGuestWorkspaces(): StoredWorkspace[] {
  if (typeof window === "undefined") return [];
  const results: StoredWorkspace[] = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (!key?.startsWith(WORKSPACE_PREFIX)) continue;
    const workspace = safeParse<StoredWorkspace>(sessionStorage.getItem(key));
    if (workspace?.outcomeId && workspace.documentId) results.push(workspace);
  }
  return results;
}

function migrationMarker(userId: string, outcomeId: string): string {
  return `${MIGRATED_PREFIX}${userId}:${outcomeId}`;
}

function pendingFor(outcomeId: string): PendingOutcome | null {
  return safeParse<PendingOutcome>(sessionStorage.getItem(`${PENDING_PREFIX}${outcomeId}`));
}

async function migrateOne(userId: string, workspace: StoredWorkspace): Promise<void> {
  const pending = pendingFor(workspace.outcomeId);
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
  await commitGuestWorkspaceImport({
    idempotencyKey: `guest-workspace:${workspace.outcomeId}:${workspace.documentId}`,
    outcomeId: workspace.outcomeId,
    documentId: workspace.documentId,
    title: workspace.title,
    situationText: situation,
    recommendationPayload,
    templateId: templateUuid,
    documentStatus: workspace.status === "archived" ? "archived" : "draft",
    sections,
  });
}

export async function migrateGuestWorkspaces(userId: string): Promise<GuestMigrationResult> {
  const result: GuestMigrationResult = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    failedOutcomeIds: [],
  };

  for (const workspace of listGuestWorkspaces()) {
    const marker = migrationMarker(userId, workspace.outcomeId);
    if (sessionStorage.getItem(marker) === "done") {
      result.skipped += 1;
      continue;
    }

    try {
      await migrateOne(userId, workspace);
      sessionStorage.setItem(marker, "done");
      result.migrated += 1;
    } catch {
      result.failed += 1;
      result.failedOutcomeIds.push(workspace.outcomeId);
    }
  }

  return result;
}
