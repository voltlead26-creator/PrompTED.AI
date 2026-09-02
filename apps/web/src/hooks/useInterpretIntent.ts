"use client";

import { useCallback } from "react";
import {
  ApiError,
  clarify,
  interpretIntent,
  type ApiRequestContext,
  type ClarifyTurn,
} from "@prompted/shared/api-client";
import { requireInitialClarification, type IntentResult } from "@prompted/shared/orchestration";
import { ensureApiConfigured } from "@/lib/api";
import { withOwnerDispatchSignal } from "@/lib/browser-principal-state";

export interface InterpretIntentApi {
  start: (
    situationText: string,
    extractedText: string | undefined,
    requestContext: ApiRequestContext,
  ) => Promise<IntentResult>;
  continue: (params: {
    situation: string;
    domain?: IntentResult["domain"];
    history: ClarifyTurn[];
    answer: string;
    extractedText?: string;
  }, requestContext: ApiRequestContext) => Promise<IntentResult>;
}

const INTENT_TIMEOUT_MS = 25_000;

export function fallbackIntentAfterTimeout(params: {
  situation: string;
  answer?: string;
  domain?: IntentResult["domain"];
  phase: "start" | "continue";
}): IntentResult {
  const base: IntentResult = {
    domain: params.domain ?? "general",
    situation: params.situation,
    confidence: 0,
    intentClear: false,
    question: null,
    questionOptions: null,
    recommendation: null,
    jobSearch: false,
    missingInformation: [],
  };

  if (params.phase === "start") {
    return requireInitialClarification(base, params.situation);
  }

  return {
    ...base,
    question:
      "I couldn't safely confirm the document type from that response. What exact document or completed outcome do you need?",
  };
}

async function withIntentTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  fallback: () => T,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), INTENT_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (shouldRecoverIntentFailure(error)) {
      return fallback();
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function shouldRecoverIntentFailure(error: unknown): boolean {
  if ((error as { name?: string } | null)?.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return error instanceof ApiError && [500, 502, 503, 504].includes(error.status);
}

async function normaliseIntent(result: IntentResult, context: string): Promise<IntentResult> {
  if (!result.recommendation) return result;
  const { normaliseIntentRecommendationForCatalog } = await import("@prompted/shared/catalogue");
  return normaliseIntentRecommendationForCatalog(result, context);
}

export function useInterpretIntent(): InterpretIntentApi {
  const start = useCallback(async (
    situationText: string,
    extractedText: string | undefined,
    requestContext: ApiRequestContext,
  ) => {
    ensureApiConfigured();
    const result = await withIntentTimeout(
      (signal) =>
        interpretIntent(
          {
            situation_text: situationText,
            extracted_text: extractedText,
          },
          withOwnerDispatchSignal(requestContext, signal),
        ),
      () =>
        fallbackIntentAfterTimeout({
          situation: situationText,
          phase: "start",
        }),
    );
    requestContext.assertCurrent();
    const context = [situationText, extractedText].filter(Boolean).join("\n\n");
    const normalised = await normaliseIntent(result, context);
    requestContext.assertCurrent();
    return requireInitialClarification(normalised, situationText);
  }, []);

  const cont = useCallback(
    async (params: {
      situation: string;
      domain?: IntentResult["domain"];
      history: ClarifyTurn[];
      answer: string;
      extractedText?: string;
    }, requestContext: ApiRequestContext) => {
      ensureApiConfigured();
      const result = await withIntentTimeout(
        (signal) =>
          clarify(
            {
              situation: params.situation,
              domain: params.domain,
              history: params.history,
              answer: params.answer,
              extracted_text: params.extractedText,
            },
            withOwnerDispatchSignal(requestContext, signal),
          ),
        () =>
          fallbackIntentAfterTimeout({
            situation: params.situation,
            answer: params.answer,
            domain: params.domain,
            phase: "continue",
          }),
      );
      requestContext.assertCurrent();
      const context = [
        params.situation,
        params.answer,
        ...params.history.map((turn) => turn.content),
      ]
        .filter(Boolean)
        .join("\n\n");
      const normalised = await normaliseIntent(result, context);
      requestContext.assertCurrent();
      return normalised;
    },
    [],
  );

  return { start, continue: cont };
}
