"use client";

import { useCallback, useRef, useState } from "react";
import { explainSection } from "@prompted/shared/api-client";
import type { ExplainResult } from "@prompted/shared/orchestration";
import { ensureApiConfigured } from "@/lib/api";

export interface ExplainRequest {
  content: string;
  selection?: string;
  question?: string;
  sectionName?: string;
  domain?: string;
}

export interface UseExplainWithTED {
  running: boolean;
  error: string | null;
  result: ExplainResult | null;
  run: (req: ExplainRequest) => Promise<ExplainResult | null>;
  cancel: () => void;
}

export function useExplainWithTED(): UseExplainWithTED {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
  }, []);

  const run = useCallback(async (req: ExplainRequest) => {
    ensureApiConfigured();
    setError(null);
    setResult(null);
    setRunning(true);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const next = await explainSection(
        {
          content: req.content,
          selection: req.selection,
          question: req.question,
          section_name: req.sectionName,
          domain: req.domain,
        },
        controller.signal,
      );
      setResult(next);
      return next;
    } catch {
      if (controller.signal.aborted) return null;
      setError("TED couldn't explain that section right now. Please try again.");
      return null;
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  }, []);

  return { running, error, result, run, cancel };
}
