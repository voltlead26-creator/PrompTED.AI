"use client";

import type {
  ConversationMessage,
  DocumentPlaceholderMetadata,
  Section,
} from "@prompted/shared/browser";
import type { RecommendationItem } from "@prompted/shared/orchestration";

export interface StoredWorkspace {
  documentId: string;
  outcomeId: string;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  generated?: boolean;
  templateId?: string;
  conversationContext?: string;
  uploadContext?: string;
  uploadId?: string;
  unresolvedPlaceholders?: DocumentPlaceholderMetadata[];
}

export interface PendingOutcome {
  situation: string;
  templateName: string;
  templateId?: string;
  conversationContext?: string;
  uploadContext?: string;
  uploadId?: string;
  conversation?: ConversationMessage[];
  /** Formats offered alongside the selected recommendation, available after opening it. */
  alternateFormats?: RecommendationItem[];
}

export interface WorkspaceDocumentState {
  documentId: string;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  generated: boolean;
  templateId: string | null;
  conversationContext: string;
  uploadContext: string;
  unresolvedPlaceholders?: DocumentPlaceholderMetadata[];
}

const KEY = (outcomeId: string) => `prompted:workspace:${outcomeId}`;
const PENDING = (outcomeId: string) => `prompted:pending:${outcomeId}`;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadWorkspace(outcomeId: string): StoredWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    return safeParse<StoredWorkspace>(sessionStorage.getItem(KEY(outcomeId)));
  } catch {
    return null;
  }
}

export function saveWorkspace(workspace: StoredWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY(workspace.outcomeId), JSON.stringify(workspace));
  } catch {
    // Storage may be full or unavailable.
  }
}

export function loadPendingOutcome(outcomeId: string): PendingOutcome | null {
  if (typeof window === "undefined") return null;
  try {
    return safeParse(sessionStorage.getItem(PENDING(outcomeId)));
  } catch {
    return null;
  }
}

export function savePendingOutcome(outcomeId: string, pending: PendingOutcome): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING(outcomeId), JSON.stringify(pending));
  } catch {
    // Best-effort persistence.
  }
}
