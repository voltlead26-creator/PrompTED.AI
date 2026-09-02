export type ExportTargetDecision =
  | { ok: true; kind: "document" | "artifact"; id: string }
  | { ok: false; code: "EXPORT_TARGET_REQUIRED" | "EXPORT_TARGET_AMBIGUOUS" };

export interface DocumentExportAuthority {
  status: string;
  current_revision: number;
  approved_revision: number | null;
}

export interface ArtifactExportAuthority extends DocumentExportAuthority {
  quality_status: string;
}

export interface ArtifactBlockExportAuthority {
  heading: string | null;
  kind: string;
  is_required: boolean | null;
  section_state: string | null;
  approval_status: string;
  revision: number;
  approved_revision: number | null;
}

export type ExactApprovalDecision =
  | { ok: true }
  | {
    ok: false;
    code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL";
    unapproved?: string[];
  };

export function decideExportTarget(
  documentId: string | undefined,
  artifactId: string | undefined,
): ExportTargetDecision {
  const hasDocument = Boolean(documentId?.trim());
  const hasArtifact = Boolean(artifactId?.trim());
  if (hasDocument && hasArtifact) {
    return { ok: false, code: "EXPORT_TARGET_AMBIGUOUS" };
  }
  if (!hasDocument && !hasArtifact) {
    return { ok: false, code: "EXPORT_TARGET_REQUIRED" };
  }
  return hasDocument
    ? { ok: true, kind: "document", id: documentId!.trim() }
    : { ok: true, kind: "artifact", id: artifactId!.trim() };
}

export function decideDocumentExport(
  target: DocumentExportAuthority,
): ExactApprovalDecision {
  return target.status === "approved" &&
      target.approved_revision !== null &&
      target.approved_revision === target.current_revision
    ? { ok: true }
    : { ok: false, code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL" };
}

function blockHasExactApproval(block: ArtifactBlockExportAuthority): boolean {
  return (block.approval_status === "approved" || block.approval_status === "locked") &&
    block.approved_revision !== null &&
    block.approved_revision === block.revision;
}

export function decideArtifactExport(
  target: ArtifactExportAuthority,
  blocks: ArtifactBlockExportAuthority[],
): ExactApprovalDecision {
  const requiredBlocks = blocks.filter((block) => block.is_required !== false);
  const unapproved = requiredBlocks
    .filter((block) => !blockHasExactApproval(block))
    .map((block) => block.heading?.trim() || "Untitled block");
  if (
    target.status !== "approved" ||
    target.quality_status !== "passed" ||
    target.approved_revision === null ||
    target.approved_revision !== target.current_revision ||
    requiredBlocks.length === 0 ||
    unapproved.length > 0
  ) {
    return {
      ok: false,
      code: "EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL",
      unapproved,
    };
  }
  return { ok: true };
}

export function artifactBlockIsApproved(
  block: ArtifactBlockExportAuthority,
): boolean {
  return blockHasExactApproval(block);
}
