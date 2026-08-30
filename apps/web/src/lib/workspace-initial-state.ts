import type {
  DocumentPlaceholderMetadata,
  Section,
} from "@prompted/shared/browser";
import type { DurableGenerationOperationState } from "@prompted/shared/document-operation";

export type InitialPersistenceState =
  | "anonymous"
  | "not_found"
  | "persisted"
  | "unavailable";

export interface InitialWorkspaceDocument {
  documentId: string;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  generated: boolean;
  templateId: string | null;
  conversationContext: string;
  uploadContext: string;
  unresolvedPlaceholders: DocumentPlaceholderMetadata[];
}

/**
 * Small, serialisable workflow snapshot streamed with the outcome route.
 * Optional panels and historical revisions are deliberately excluded.
 */
export interface WorkspaceInitialState {
  workspace: InitialWorkspaceDocument | null;
  truth: {
    authenticated: boolean;
    persistence: InitialPersistenceState;
    documentId: string | null;
    currentRevision: number | null;
    approvedRevision: number | null;
    ledgerBindingStatus: "legacy_unversioned" | "captured" | null;
    ledgerVersion: string | null;
    operationId: string | null;
    operationRevision: number | null;
    operationStatus: DurableGenerationOperationState | null;
    operationMessage: string | null;
    safeNextAction: string | null;
    persistedAt: string | null;
  };
}
