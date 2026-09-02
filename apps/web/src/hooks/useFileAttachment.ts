"use client";

import { useCallback, useState } from "react";
import {
  preflightUploadMetadata,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@prompted/shared/ingest-upload";

export const ACCEPT_ATTRIBUTE = UPLOAD_ACCEPT_ATTRIBUTE;

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

/**
 * useFileAttachment - single-file picker state for the Home composer.
 * Validates type and size, surfacing plain non-technical error messages.
 * Never auto-submits; the caller decides when to send.
 */
export function useFileAttachment(): UseFileAttachment {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback((file: File): boolean => {
    const result = preflightUploadMetadata({
      fileName: file.name,
      mimeType: file.type,
      byteLength: file.size,
    });
    if (!result.ok) {
      setError(result.message);
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
