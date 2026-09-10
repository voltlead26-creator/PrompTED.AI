import type { WorkspaceDocumentState } from "./workspace-store";
import {
  MAX_WORKSPACE_SECTION_BODY_BYTES,
  MAX_WORKSPACE_SNAPSHOT_SECTIONS,
  workspaceSectionMetadata,
} from "./workspace-initial-state";
import { sha256Text } from "./api/sections";
import { sanitiseSectionContent } from "./sanitise";

export interface WorkspaceRecoverySection {
  readonly sectionId: string;
  readonly name: string;
  readonly content: string;
  readonly expectedRevision: number;
  readonly expectedSha256: string;
}

export interface WorkspaceRecoveryReview {
  readonly status: "ready" | "conflict" | "unavailable";
  readonly documentId: string;
  readonly documentRevision: number;
  readonly sections: readonly WorkspaceRecoverySection[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** A browser copy supplies wording only. Current server metadata owns every command. */
export async function reviewWorkspaceRecovery(
  cached: unknown,
  current: WorkspaceDocumentState,
  ownerId: string,
  outcomeId: string,
  documentRevision: number,
): Promise<WorkspaceRecoveryReview | null> {
  const value = record(cached);
  if (
    !value || value.documentId !== current.documentId || value.outcomeId !== outcomeId ||
    !Array.isArray(value.sections) || value.sections.length !== current.sections.length ||
    value.sections.length === 0 || value.sections.length > MAX_WORKSPACE_SNAPSHOT_SECTIONS ||
    !Number.isSafeInteger(documentRevision) || documentRevision < 1
  ) return null;

  let compatible = value.title === current.title &&
    (value.templateId ?? null) === current.templateId;
  let bytes = 0;
  const ids = new Set<string>();
  const captured: Array<WorkspaceRecoverySection & { compatible: boolean }> = [];
  // Capture and bound all untrusted primitives before the first asynchronous digest.
  for (let index = 0; index < current.sections.length; index++) {
    const saved = current.sections[index]!;
    const metadata = workspaceSectionMetadata(saved);
    const local = record(value.sections[index]);
    if (
      !local || !metadata || metadata.ledgerBindingStatus !== "legacy_unversioned" ||
      saved.user_id !== ownerId || local.user_id !== ownerId ||
      local.document_id !== current.documentId || local.id !== saved.id || ids.has(saved.id) ||
      local.content_loaded !== true || typeof local.content !== "string" ||
      new TextEncoder().encode(local.content).length > MAX_WORKSPACE_SECTION_BODY_BYTES
    ) return null;
    ids.add(saved.id);
    bytes += new TextEncoder().encode(local.content).length;
    if (bytes > 8 * MAX_WORKSPACE_SECTION_BODY_BYTES) return null;
    captured.push({
      sectionId: saved.id, name: saved.name, content: local.content,
      expectedRevision: metadata.revision, expectedSha256: metadata.contentSha256,
      compatible: local.revision === metadata.revision &&
        local.content_sha256 === metadata.contentSha256 &&
        local.approved_revision === metadata.approvedRevision &&
        local.name === saved.name && local.order_index === saved.order_index &&
        local.is_required === saved.is_required && saved.status !== "locked" &&
        sanitiseSectionContent(local.content) === local.content,
    });
  }
  const changes: WorkspaceRecoverySection[] = [];
  for (const section of captured) {
    if (await sha256Text(section.content) === section.expectedSha256) continue;
    compatible &&= section.compatible;
    changes.push(Object.freeze({
      sectionId: section.sectionId, name: section.name, content: section.content,
      expectedRevision: section.expectedRevision, expectedSha256: section.expectedSha256,
    }));
  }
  return changes.length === 0 ? null : Object.freeze({
    status: compatible ? "ready" : "conflict",
    documentId: current.documentId, documentRevision,
    sections: Object.freeze(changes),
  });
}
