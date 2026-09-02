"use client";

import { useCallback, useRef, useState } from "react";
import { explainSection } from "@prompted/shared/api-client";
import type { ExplainResult } from "@prompted/shared/orchestration";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";

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
  const { user } = useAuth();
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
    if (!user?.id) {
      setError("Sign in again before asking TED to explain this section.");
      return null;
    }
    ensureApiConfigured();
    setError(null);
    setResult(null);
    setRunning(true);

    const controller = new AbortController();
    const requestContext = captureOwnerDispatch(user.id, controller.signal);
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
        requestContext,
      );
      requestContext.assertCurrent();
      setResult(next);
      return next;
    } catch {
      if (!ownerDispatchIsCurrent(requestContext)) return null;
      setError("TED couldn't explain that section right now. Please try again.");
      return null;
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) {
        setRunning(false);
        controllerRef.current = null;
      }
    }
  }, [user?.id]);

  return { running, error, result, run, cancel };
}
