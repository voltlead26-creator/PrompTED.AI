"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Resets transient explanation history when its owner or wording changes. */
  contextKey: string;
  running: boolean;
  error: string | null;
  result: ExplainResult | null;
  run: (req: ExplainRequest) => Promise<ExplainResult | null>;
  cancel: () => void;
}

export function useExplainWithTED(scopeKey?: string): UseExplainWithTED {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const scopeRef = useRef({ owner: user?.id, key: scopeKey });
  scopeRef.current = { owner: user?.id, key: scopeKey };

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    cancel();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [user?.id, scopeKey, cancel]);

  const run = useCallback(async (req: ExplainRequest) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setError(null);
    setResult(null);
    if (!user?.id) {
      setError("Sign in again before asking TED to explain this section.");
      setRunning(false);
      return null;
    }
    setRunning(true);

    const controller = new AbortController();
    controllerRef.current = controller;
    const owner = user.id;
    const acceptedScope = scopeKey;
    const isCurrent = () => controllerRef.current === controller &&
      !controller.signal.aborted && scopeRef.current.owner === owner &&
      scopeRef.current.key === acceptedScope;
    let requestContext: ReturnType<typeof captureOwnerDispatch> | null = null;

    try {
      ensureApiConfigured();
      requestContext = captureOwnerDispatch(owner, controller.signal);
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
      if (!isCurrent()) return null;
      requestContext.assertCurrent();
      setResult(next);
      return next;
    } catch {
      if (!isCurrent() || (requestContext && !ownerDispatchIsCurrent(requestContext))) return null;
      setError("TED couldn't explain that section right now. Please try again.");
      return null;
    } finally {
      if (isCurrent()) {
        setRunning(false);
        controllerRef.current = null;
      }
    }
  }, [user?.id, scopeKey]);

  return { contextKey: JSON.stringify([user?.id ?? null, scopeKey ?? null]), running, error, result, run, cancel };
}
