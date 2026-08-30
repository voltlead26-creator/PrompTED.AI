"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ConversationMessage,
  RecommendationPayload,
} from "@prompted/shared/browser";
import type {
  ChecklistItemResult,
  RecommendationItem,
} from "@prompted/shared/orchestration";
import { generateArtifactStream, generateChecklist } from "@prompted/shared/api-client";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { HomeScreen } from "@/app/(app)/home/HomeScreen";
import { fetchOutcome, updateOutcome } from "@/lib/api/outcomes";
import { loadPendingOutcome } from "@/lib/workspace-store";
import { createClient } from "@/lib/supabase/client";
import { ensureApiConfigured } from "@/lib/api";
import { useOutcome } from "@/hooks/useOutcome";
import { fetchArtifactByOutcome, saveArtifact } from "@/lib/api/artifacts";
import styles from "./ConversationView.module.css";

const SECTION_SEPARATOR = "\u241F";
const guestKey = (outcomeId: string) => `prompted:guest-checklist:${outcomeId}`;

function conversationContext(messages: ConversationMessage[]): string {
  return messages
    .map((message) => `${message.role === "ted" ? "TED" : "User"}: ${message.text}`)
    .join("\n");
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function encodeSection(item: ChecklistItemResult): string {
  const section = item.section?.trim() || "General";
  return `${section}${SECTION_SEPARATOR}${item.text.trim()}`;
}

export function ConversationView({ outcomeId }: { outcomeId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const outcome = useOutcome();
  const [loaded, setLoaded] = useState(false);
  const [initial, setInitial] = useState<ConversationMessage[]>([]);
  const [situation, setSituation] = useState("");
  const [isChecklist, setIsChecklist] = useState(false);
  const payloadRef = useRef<RecommendationPayload | null>(null);
  const latestMessagesRef = useRef<ConversationMessage[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const savedOutcome = await fetchOutcome(outcomeId);
      payloadRef.current = savedOutcome?.recommendation_payload ?? null;
      let thread = savedOutcome?.recommendation_payload?.conversation ?? null;
      let sit = savedOutcome?.situation_text ?? "";
      if (!thread || thread.length === 0) {
        const pending = loadPendingOutcome(outcomeId);
        thread = pending?.conversation ?? null;
        sit = sit || pending?.situation || "";
      }

      let checklist = false;
      try {
        const guest = window.localStorage.getItem(guestKey(outcomeId));
        checklist = Boolean(guest);
      } catch {
        checklist = false;
      }

      if (!checklist && user) {
        const artifact = await fetchArtifactByOutcome(outcomeId);
        checklist = artifact?.kind === "checklist" || artifact?.kind === "action_plan";
      }

      if (!checklist && user) {
        const supabase = createClient();
        const { count, error } = await supabase
          .from("checklist_items")
          .select("id", { count: "exact", head: true })
          .eq("outcome_id", outcomeId);
        if (error) throw error;
        checklist = (count ?? 0) > 0;
      }

      if (!cancelled) {
        const messages = thread ?? [];
        latestMessagesRef.current = messages;
        setInitial(messages);
        setSituation(sit);
        setIsChecklist(checklist);
        setLoaded(true);
      }
    }
    void load().catch(() => {
      if (!cancelled) {
        setLoaded(true);
        showToast({
          tone: "error",
          message: "TED couldn't reload that conversation just now. You can retry from the document.",
        });
      }
    });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [outcomeId, showToast, user]);

  const handleMessagesChange = useCallback(
    (messages: ConversationMessage[]) => {
      if (messages.length === 0) return;
      latestMessagesRef.current = messages;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const base: RecommendationPayload =
          payloadRef.current ?? { primary: { template_id: "", reason: "" }, alternatives: [] };
        const transcript = conversationContext(messages);
        const next = {
          ...base,
          conversation: messages,
          conversation_context: transcript,
          situation: base.situation || situation || transcript,
        };
        payloadRef.current = next;
        void updateOutcome(outcomeId, { recommendation_payload: next }).catch(() => {
          showToast({
            tone: "error",
            message: "TED couldn't save the latest conversation update just now.",
          });
        });
      }, 800);
    },
    [outcomeId, showToast, situation],
  );

  const refineChecklist = useCallback(async (nextSituation: string) => {
    const transcript = conversationContext(latestMessagesRef.current);
    const refinedSituation = [situation, nextSituation, transcript]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    ensureApiConfigured();
    const existingArtifact = user ? await fetchArtifactByOutcome(outcomeId) : null;
    if (existingArtifact && (existingArtifact.kind === "checklist" || existingArtifact.kind === "action_plan")) {
      const generatedArtifact = await generateArtifactStream({
        request_id: makeId(), outcome_id: outcomeId, kind: existingArtifact.kind,
        template_id: existingArtifact.template_id ?? undefined, situation: refinedSituation,
        conversation_context: transcript,
        locale: navigator.language || "en-AU",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Melbourne",
      }, () => {});
      const previousByKey = new Map(existingArtifact.blocks.map((block) => [block.stable_key, block]));
      const merged = {
        ...generatedArtifact,
        id: existingArtifact.id,
        current_revision: existingArtifact.current_revision + 1,
        blocks: generatedArtifact.blocks.map((block) => {
          const previous = previousByKey.get(block.stable_key);
          return previous ? {
            ...block,
            id: previous.id,
            completed_at: previous.completed_at,
            approval_status: previous.approval_status,
            revision: previous.revision + 1,
          } : block;
        }),
      };
      await saveArtifact(merged);
      showToast({ tone: "success", message: "Your plan has been updated and completed steps were kept." });
      router.push(`/outcomes/${outcomeId}/checklist`);
      router.refresh();
      return;
    }
    const generated = await generateChecklist({ situation: refinedSituation });
    if (generated.length === 0) throw new Error("empty_checklist");

    const now = new Date().toISOString();
    const rows = generated.map((item, index) => ({
      id: makeId(),
      outcome_id: outcomeId,
      user_id: user?.id ?? "guest",
      text: encodeSection(item),
      due_date: normaliseDueDate(item.due_date),
      reason: item.reason ?? null,
      done: false,
      reminder_offset_days: null,
      reminder_sent: false,
      order_index: index,
      created_at: now,
      updated_at: now,
    }));

    if (user) {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("checklist_items")
        .delete()
        .eq("outcome_id", outcomeId)
        .eq("user_id", user.id);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from("checklist_items").insert(rows);
      if (insertError) throw insertError;
    } else {
      window.localStorage.setItem(guestKey(outcomeId), JSON.stringify(rows));
    }

    showToast({ tone: "success", message: "Your checklist has been updated." });
    router.push(`/outcomes/${outcomeId}/checklist`);
    router.refresh();
  }, [outcomeId, router, showToast, situation, user]);

  const handleConfirm = useCallback(
    async (item: RecommendationItem, nextSituation: string) => {
      if (isChecklist) {
        await refineChecklist(nextSituation);
        return;
      }

      const { resolveTemplateByRecommendationName } = await import(
        "@prompted/shared/catalogue"
      );
      const template = resolveTemplateByRecommendationName(item.name);
      await outcome.confirm({
        situation: nextSituation || situation,
        templateName: template?.name ?? item.name,
        templateId: template?.slug ?? template?.id,
        conversationContext: conversationContext(latestMessagesRef.current),
        conversation: latestMessagesRef.current,
      });
      showToast({ tone: "success", message: "Creating a new document from your updated conversation." });
    },
    [isChecklist, outcome, refineChecklist, situation, showToast],
  );

  const backHref = isChecklist
    ? `/outcomes/${outcomeId}/checklist`
    : `/outcomes/${outcomeId}`;

  if (!loaded) {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading your conversation" size="md" />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <Link href={backHref} className={styles.back}>
          <Icon name="chevron-left" size={16} />
          {isChecklist ? "Back to checklist" : "Back to document"}
        </Link>
      </div>
      <HomeScreen
        initialConversation={initial}
        resumeSituation={situation}
        onConfirm={handleConfirm}
        onMessagesChange={handleMessagesChange}
      />
    </div>
  );
}
