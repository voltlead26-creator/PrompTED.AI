"use client";

import { useCallback, useRef, useState } from "react";
import { editSectionStream, type EditAction } from "@prompted/shared/api-client";
import { ensureApiConfigured } from "@/lib/api";

export interface EditRequest {
  action: EditAction;
  content: string;
  selection?: string;
  instruction?: string;
  domain?: string;
}

export interface EditRunResult {
  content: string;
  changes: string[];
}

export interface UseEditWithTED {
  /** True while a stream is in flight. The editor should be read-only. */
  streaming: boolean;
  /** Accumulated streamed text so far (the in-progress revision). */
  draft: string;
  /** Plain-language list of what TED changed, once the stream reports it. */
  changes: string[];
  error: string | null;
  /**
   * Run an edit action. `onDelta` receives the cumulative draft on each chunk
   * so the caller can render progressively. Resolves with the final
   * content + changes, or null if cancelled/failed. Returned directly
   * (rather than read back off hook state) so callers awaiting this don't
   * hit a stale-closure read of `changes` from before the run completed.
   */
  run: (
    req: EditRequest,
    onDelta?: (cumulative: string) => void,
  ) => Promise<EditRunResult | null>;
  /** Cancel an in-flight stream. The caller restores prior content. */
  cancel: () => void;
}

/**
 * useEditWithTED — drives the streaming "Edit with TED" call.
 *
 * Accumulates SSE deltas into a draft string and exposes a cancel that aborts
 * the request. Content is never streamed straight into the editor DOM — the
 * caller applies the accumulated string, then commits it as one update when
 * the stream finishes (Build Plan Layer 9).
 */
export function useEditWithTED(): UseEditWithTED {
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreaming(false);
  }, []);

  const run = useCallback(
    async (req: EditRequest, onDelta?: (cumulative: string) => void) => {
      ensureApiConfigured();
      setError(null);
      setDraft("");
      setChanges([]);
      setStreaming(true);

      const controller = new AbortController();
      controllerRef.current = controller;
      let accumulated = "";
      let finalChanges: string[] = [];

      try {
        await editSectionStream(
          {
            action: req.action,
            content: req.content,
            selection: req.selection,
            instruction: req.instruction,
            domain: req.domain,
          },
          (text) => {
            accumulated += text;
            setDraft(accumulated);
            onDelta?.(accumulated);
          },
          (list) => {
            finalChanges = list;
            setChanges(list);
          },
          controller.signal,
        );
        return { content: accumulated, changes: finalChanges };
      } catch {
        if (controller.signal.aborted) return null;
        setError(
          "TED couldn't finish that edit. Please try again in a moment.",
        );
        return null;
      } finally {
        setStreaming(false);
        controllerRef.current = null;
      }
    },
    [],
  );

  return { streaming, draft, changes, error, run, cancel };
}
