"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ConversationMessage, RecommendationPayload } from "@prompted/shared/browser";
import type { RecommendationItem } from "@prompted/shared/orchestration";
import { useAuth } from "@/components/providers";
import {
  commitHomeUploadIntake,
  HomeUploadIntakeError,
  reconcileHomeUploadIntakeCommit,
} from "@/lib/api/home-intakes";
import { upsertOutcome } from "@/lib/api/outcomes";
import { captureOwnerDispatch } from "@/lib/browser-principal-state";
import { currentWorkspaceCacheScope, savePendingOutcome } from "@/lib/workspace-store";

export interface ConfirmOutcomeParams {
  situation: string;
  templateName: string;
  templateId?: string;
  conversationContext?: string;
  uploadContext?: string;
  uploadId?: string;
  conversation?: ConversationMessage[];
  alternateFormats?: RecommendationItem[];
  /** Explicit durable Home checkpoint. Other upload callers retain the legacy path. */
  homeUploadIntake?: {
    intakeId: string;
    uploadId: string;
    expectedRevision: number;
    confirmedText: string;
  };
}

export interface UseOutcome {
  confirm: (params: ConfirmOutcomeParams) => Promise<string>;
}

type Catalogue = typeof import("@prompted/shared/catalogue");

function resolveConfirmedTemplate(catalogue: Catalogue, name: string, templateId?: string) {
  const direct = templateId ? catalogue.getTemplate(templateId) : undefined;
  if (direct) return direct;

  const text = name.toLowerCase();
  if (/\binterview\b/.test(text) && /\bscript|answers?|response/.test(text)) {
    return catalogue.getTemplate("interview-script");
  }
  if (/\binterview\b/.test(text) && /\bquestions?|prepared|preparation|prep|practice/.test(text)) {
    return catalogue.getTemplate("interview-prep-questions");
  }
  if (/\bprepared questions?\b/.test(text)) {
    return catalogue.getTemplate("interview-prep-questions");
  }

  return catalogue.resolveTemplateByRecommendationName(name);
}

function isInteractivePlan(params: ConfirmOutcomeParams): boolean {
  const hint = `${params.templateName} ${params.templateId ?? ""}`.toLowerCase();
  return /\b(checklist|action plan|routine|roadmap|step[- ]by[- ]step plan|launch plan|recovery plan)\b/.test(
    hint,
  );
}

function serialiseAlternatives(
  catalogue: Catalogue,
  items: RecommendationItem[] | undefined,
): RecommendationPayload["alternatives"] {
  return (items ?? []).map((item) => {
    const template = resolveConfirmedTemplate(catalogue, item.name);
    return {
      template_id: template?.slug ?? template?.id ?? item.name,
      reason: template?.name ?? item.name,
    };
  });
}

function buildRecommendationPayload(
  catalogue: Catalogue,
  resolvedParams: ConfirmOutcomeParams,
): RecommendationPayload {
  const payload: RecommendationPayload = {
    primary: {
      template_id: resolvedParams.templateId ?? "",
      reason: resolvedParams.templateName,
    },
    alternatives: serialiseAlternatives(catalogue, resolvedParams.alternateFormats),
    conversation: resolvedParams.conversation ?? [],
    situation: resolvedParams.situation,
  };

  const conversationContext = resolvedParams.conversationContext?.trim();
  if (conversationContext) payload.conversation_context = conversationContext;

  const uploadContext = resolvedParams.uploadContext?.trim();
  if (uploadContext) payload.upload_context = uploadContext;

  const uploadId = resolvedParams.uploadId?.trim();
  if (uploadId) payload.upload_id = uploadId;

  return payload;
}

export function useOutcome(): UseOutcome {
  const router = useRouter();
  const { user } = useAuth();

  const confirm = useCallback(
    async (params: ConfirmOutcomeParams) => {
      const userId = user?.id;
      if (!userId) {
        throw new Error("Sign in again before starting this outcome.");
      }
      const requestContext = captureOwnerDispatch(userId);

      const catalogue = await import("@prompted/shared/catalogue");
      requestContext.assertCurrent();
      const template = resolveConfirmedTemplate(catalogue, params.templateName, params.templateId);
      const resolvedParams: ConfirmOutcomeParams = {
        ...params,
        templateName: template?.name ?? params.templateName,
        templateId: template?.slug ?? template?.id ?? params.templateId,
      };
      const recommendationPayload = buildRecommendationPayload(catalogue, resolvedParams);
      let id: string;
      let persistedParams = resolvedParams;

      if (resolvedParams.homeUploadIntake) {
        if (
          !resolvedParams.uploadId ||
          resolvedParams.uploadId !== resolvedParams.homeUploadIntake.uploadId
        ) {
          throw new Error("HOME_UPLOAD_INTAKE_CONTEXT_MISMATCH");
        }
        const commitInput = {
          intakeId: resolvedParams.homeUploadIntake.intakeId,
          uploadId: resolvedParams.homeUploadIntake.uploadId,
          expectedRevision: resolvedParams.homeUploadIntake.expectedRevision,
          confirmedText: resolvedParams.homeUploadIntake.confirmedText,
          situation: resolvedParams.situation || resolvedParams.templateName,
          recommendationPayload,
        };
        let receipt: Awaited<ReturnType<typeof commitHomeUploadIntake>>;
        try {
          receipt = await commitHomeUploadIntake(commitInput, requestContext);
        } catch (error) {
          if (!(error instanceof HomeUploadIntakeError) || !error.ambiguous) throw error;
          try {
            receipt = await reconcileHomeUploadIntakeCommit(commitInput, requestContext);
            requestContext.assertCurrent();
          } catch {
            requestContext.assertCurrent();
            throw error;
          }
        }
        requestContext.assertCurrent();
        id = receipt.outcomeId;
        persistedParams = {
          ...resolvedParams,
          situation: receipt.situation,
          templateId: receipt.templateId,
          templateName: receipt.templateName,
          conversationContext: receipt.conversationContext,
          uploadContext: receipt.uploadContext,
          uploadId: receipt.uploadId,
        };
      } else {
        id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `outcome-${Date.now()}`;
        await upsertOutcome(
          {
            id,
            user_id: userId,
            situation_text: resolvedParams.situation || resolvedParams.templateName,
            recommendation_payload: recommendationPayload,
            status: "in_progress",
          },
          requestContext,
        );
      }
      requestContext.assertCurrent();
      savePendingOutcome(currentWorkspaceCacheScope(userId), id, persistedParams);

      requestContext.assertCurrent();
      router.push(
        isInteractivePlan(persistedParams) ? `/outcomes/${id}/checklist` : `/outcomes/${id}`,
      );
      return id;
    },
    [router, user],
  );

  return { confirm };
}
