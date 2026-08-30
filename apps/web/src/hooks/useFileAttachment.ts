"use client";

import { useCallback, useState } from "react";

/** Accepted upload types supported by the Edge Function text extractor. */
export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export const ACCEPT_ATTRIBUTE =
  ".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv";

export const MAX_FILE_BYTES = 8 * 1024 * 1024; // Matches ingest-upload MAX_BYTES.

export interface Attachment {
  file: File;
  name: string;
  sizeBytes: number;
  type: string;
}

export interface UseFileAttachment {
  attachment: Attachment | null;
  error: string | null;
  /** Validate + set. Returns true if accepted. */
  attach: (file: File) => boolean;
  clear: () => void;
}

function isAccepted(type: string, name: string): boolean {
  if ((ACCEPTED_MIME_TYPES as readonly string[]).includes(type)) return true;
  const lower = name.toLowerCase();
  return [".pdf", ".docx", ".txt", ".md", ".csv"].some((ext) => lower.endsWith(ext));
}

/**
 * useFileAttachment - single-file picker state for the Home composer.
 * Validates type and size, surfacing plain non-technical error messages.
 * Never auto-submits; the caller decides when to send.
 */
export function useFileAttachment(): UseFileAttachment {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback((file: File): boolean => {
    if (!isAccepted(file.type, file.name)) {
      setError("TED can read PDF, DOCX, TXT, Markdown or CSV files. Save this file in one of those formats and try again.");
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is a bit too big. Files need to be 8MB or smaller.");
      return false;
    }
    setError(null);
    setAttachment({
      file,
      name: file.name,
      sizeBytes: file.size,
      type: file.type,
    });
    return true;
  }, []);

  const clear = useCallback(() => {
    setAttachment(null);
    setError(null);
  }, []);

  return { attachment, error, attach, clear };
}
