"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ConversationMessage, RecommendationPayload } from "@prompted/shared/browser";
import type { RecommendationItem } from "@prompted/shared/orchestration";
import { useAuth } from "@/components/providers";
import { upsertOutcome } from "@/lib/api/outcomes";

export interface ConfirmOutcomeParams {
  situation: string;
  templateName: string;
  templateId?: string;
  conversationContext?: string;
  uploadContext?: string;
  uploadId?: string;
  conversation?: ConversationMessage[];
  alternateFormats?: RecommendationItem[];
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
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `outcome-${Date.now()}`;

      const catalogue = await import("@prompted/shared/catalogue");
      const template = resolveConfirmedTemplate(catalogue, params.templateName, params.templateId);
      const resolvedParams: ConfirmOutcomeParams = {
        ...params,
        templateName: template?.name ?? params.templateName,
        templateId: template?.slug ?? template?.id ?? params.templateId,
      };

      try {
        sessionStorage.setItem(`prompted:pending:${id}`, JSON.stringify(resolvedParams));
      } catch {
        // sessionStorage may be unavailable.
      }

      const userId = user?.id;
      if (userId) {
        await upsertOutcome({
          id,
          user_id: userId,
          situation_text: resolvedParams.situation || resolvedParams.templateName,
          recommendation_payload: buildRecommendationPayload(catalogue, resolvedParams),
          status: "in_progress",
        });
      }

      router.push(
        isInteractivePlan(resolvedParams) ? `/outcomes/${id}/checklist` : `/outcomes/${id}`,
      );
      return id;
    },
    [router, user],
  );

  return { confirm };
}
