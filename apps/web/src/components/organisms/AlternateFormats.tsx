"use client";

import { useEffect, useState } from "react";
import type { ConversationMessage } from "@prompted/shared/browser";
import { resolveTemplateByRecommendationName } from "@prompted/shared/catalogue";
import type { RecommendationItem } from "@prompted/shared/orchestration";
import { Icon } from "@/components/atoms/Icon";
import { useOutcome } from "@/hooks/useOutcome";
import { fetchOutcome } from "@/lib/api/outcomes";
import { loadPendingOutcome } from "@/lib/workspace-store";
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
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [situation, setSituation] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [conversationContext, setConversationContext] = useState("");
  const [uploadContext, setUploadContext] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const pending = loadPendingOutcome(outcomeId);
      const saved = await fetchOutcome(outcomeId);
      const rawAlternatives = pending?.alternateFormats ?? saved?.recommendation_payload?.alternatives ?? [];
      const alternatives = normaliseAlternatives(rawAlternatives);
      const thread = pending?.conversation ?? saved?.recommendation_payload?.conversation ?? [];

      if (cancelled) return;
      setItems(alternatives);
      setSituation(pending?.situation || saved?.situation_text || "");
      setConversation(thread);
      setConversationContext(
        pending?.conversationContext ||
          thread.map((message) => `${message.role === "ted" ? "TED" : "User"}: ${message.text}`).join("\n"),
      );
      setUploadContext(pending?.uploadContext || saved?.recommendation_payload?.upload_context || "");
    }

    void load();
    return () => { cancelled = true; };
  }, [outcomeId]);

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
