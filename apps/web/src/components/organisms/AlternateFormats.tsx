"use client";

import { useEffect, useState } from "react";
import type { ConversationMessage } from "@prompted/shared/browser";
import { resolveTemplateByRecommendationName } from "@prompted/shared/catalogue";
import type { RecommendationItem } from "@prompted/shared/orchestration";
import { Icon } from "@/components/atoms/Icon";
import { useAuth } from "@/components/providers";
import { useOutcome } from "@/hooks/useOutcome";
import { fetchOutcome } from "@/lib/api/outcomes";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import { currentWorkspaceCacheScope, loadPendingOutcome } from "@/lib/workspace-store";
import styles from "./AlternateFormats.module.css";

interface AlternateFormatsProps {
  outcomeId: string;
}

type StoredAlternative = Partial<RecommendationItem> & {
  template_id?: string;
};

function normaliseAlternatives(raw: unknown): RecommendationItem[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((value): RecommendationItem | null => {
      if (!value || typeof value !== "object") return null;
      const item = value as StoredAlternative;
      const name = typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : typeof item.reason === "string" && item.reason.trim()
          ? item.reason.trim()
          : typeof item.template_id === "string" && item.template_id.trim()
            ? item.template_id.trim()
            : "";

      if (!name) return null;

      return {
        name,
        format: typeof item.format === "string" && item.format.trim()
          ? item.format.trim()
          : "document",
        reason: typeof item.reason === "string" ? item.reason : "",
        use_case: typeof item.use_case === "string" ? item.use_case : "",
        benefits: Array.isArray(item.benefits)
          ? item.benefits.filter((benefit): benefit is string => typeof benefit === "string")
          : [],
      };
    })
    .filter((item): item is RecommendationItem => item !== null);
}

export function AlternateFormats({ outcomeId }: AlternateFormatsProps) {
  const outcome = useOutcome();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [situation, setSituation] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [conversationContext, setConversationContext] = useState("");
  const [uploadContext, setUploadContext] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const requestContext = user?.id ? captureOwnerDispatch(user.id) : null;
      const saved = requestContext
        ? await fetchOutcome(outcomeId, requestContext)
        : null;
      const pending = user
        ? null
        : loadPendingOutcome(currentWorkspaceCacheScope(), outcomeId);
      const rawAlternatives = saved?.recommendation_payload?.alternatives ?? pending?.alternateFormats ?? [];
      const alternatives = normaliseAlternatives(rawAlternatives);
      const thread = saved?.recommendation_payload?.conversation ?? pending?.conversation ?? [];

      if (
        cancelled ||
        (requestContext && !ownerDispatchIsCurrent(requestContext))
      ) return;
      setItems(alternatives);
      setSituation(saved?.situation_text || pending?.situation || "");
      setConversation(thread);
      setConversationContext(
        saved?.recommendation_payload?.conversation_context ||
          pending?.conversationContext ||
          thread.map((message) => `${message.role === "ted" ? "TED" : "User"}: ${message.text}`).join("\n"),
      );
      setUploadContext(saved?.recommendation_payload?.upload_context || pending?.uploadContext || "");
    }

    void load().catch(() => undefined);
    return () => { cancelled = true; };
  }, [outcomeId, user]);

  if (items.length === 0) return null;

  function choose(item: RecommendationItem) {
    const template = resolveTemplateByRecommendationName(item.name);
    outcome.confirm({
      situation,
      templateName: template?.name ?? item.name,
      templateId: template?.slug ?? template?.id,
      conversationContext,
      uploadContext,
      conversation,
      alternateFormats: items.filter((candidate) => candidate.name !== item.name),
    });
  }

  return (
    <section className={styles.wrap} aria-label="Alternate formats">
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon name="layout-grid" size={17} />
        Alternate formats
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>

      {open ? (
        <div className={styles.panel}>
          <div className={styles.intro}>
            <strong>Use the same information in another format</strong>
            <span>Your current outcome stays unchanged.</span>
          </div>
          <div className={styles.grid}>
            {items.map((item) => (
              <article key={item.name} className={styles.card}>
                <h3>{item.name}</h3>
                {item.use_case ? <p>{item.use_case}</p> : null}
                <button type="button" onClick={() => choose(item)}>
                  Create this format
                  <Icon name="arrow-right" size={15} />
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
