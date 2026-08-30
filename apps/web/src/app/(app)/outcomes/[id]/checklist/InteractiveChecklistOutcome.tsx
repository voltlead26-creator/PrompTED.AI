"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { generateArtifactStream, generateChecklist } from "@prompted/shared/api-client";
import type { ChecklistItemResult } from "@prompted/shared/orchestration";
import { ArtifactActionScreen } from "@/components/organisms/ArtifactActionScreen";
import { AlternateFormats } from "@/components/organisms/AlternateFormats";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { useAuth } from "@/components/providers";
import { createClient } from "@/lib/supabase/client";
import { ensureApiConfigured } from "@/lib/api";
import { fetchOutcome, updateOutcome } from "@/lib/api/outcomes";
import { fetchArtifactByOutcome, saveArtifact } from "@/lib/api/artifacts";
import { loadPendingOutcome } from "@/lib/workspace-store";
import styles from "./InteractiveChecklistOutcome.module.css";

const SECTION_SEPARATOR = "␟";
const guestKey = (outcomeId: string) => `prompted:guest-checklist:${outcomeId}`;
const guestSavedKey = (outcomeId: string) => `prompted:guest-checklist-saved:${outcomeId}`;

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

export function InteractiveChecklistOutcome({ outcomeId }: { outcomeId: string }) {
  const { user, loading: authLoading } = useAuth();
  const [title, setTitle] = useState("Your action plan");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (authLoading || startedRef.current) return;
    startedRef.current = true;

    async function prepare() {
      const pending = loadPendingOutcome(outcomeId);
      const outcome = await fetchOutcome(outcomeId);
      setTitle(
        pending?.templateName ||
        outcome?.recommendation_payload?.primary?.reason ||
        "Your action plan",
      );
      setSaved(Boolean(outcome?.is_saved));

      const v2Artifact = user ? await fetchArtifactByOutcome(outcomeId) : null;
      if (v2Artifact) {
        setReady(true);
        return;
      }

      if (!user) {
        try {
          setSaved(window.localStorage.getItem(guestSavedKey(outcomeId)) === "true");
          const existing = window.localStorage.getItem(guestKey(outcomeId));
          if (existing) {
            setReady(true);
            return;
          }
        } catch {
          // Continue and regenerate if local storage is unavailable.
        }
      } else {
        const supabase = createClient();
        const { count } = await supabase
          .from("checklist_items")
          .select("id", { count: "exact", head: true })
          .eq("outcome_id", outcomeId);

        if ((count ?? 0) > 0) {
          setReady(true);
          return;
        }
      }

      const situation = [
        outcome?.situation_text,
        pending?.situation,
        pending?.conversationContext,
        pending?.uploadContext,
      ].filter(Boolean).join("\n\n").trim();

      try {
        ensureApiConfigured();
        const v2Kind = /checklist/i.test(pending?.templateName ?? "") ? "checklist" : "action_plan";
        try {
          if (!user) throw new Error("authenticated_artifact_required");
          const artifact = await generateArtifactStream({
            request_id: makeId(),
            outcome_id: outcomeId,
            kind: v2Kind,
            template_id: pending?.templateId ?? undefined,
            situation,
            conversation_context: pending?.conversationContext,
            upload_context: pending?.uploadContext,
            locale: navigator.language || "en-AU",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Melbourne",
          }, () => {});
          await saveArtifact(artifact);
          setReady(true);
          return;
        } catch {
          // Fall through to the existing checklist generator during rollout.
        }
        const generated = await generateChecklist({ situation });
        if (generated.length === 0) throw new Error("empty_checklist");

        const now = new Date().toISOString();
        const rows = generated.map((item: ChecklistItemResult, index: number) => ({
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
          const { error: insertError } = await supabase.from("checklist_items").insert(rows);
          if (insertError) throw insertError;
        } else {
          window.localStorage.setItem(guestKey(outcomeId), JSON.stringify(rows));
        }

        setReady(true);
      } catch {
        setError("TED could not build this plan just now. Your earlier information is still safe.");
        setReady(true);
      }
    }

    void prepare();
  }, [authLoading, outcomeId, user]);

  async function handleSave() {
    setSaving(true);
    try {
      if (user) await updateOutcome(outcomeId, { is_saved: true });
      else window.localStorage.setItem(guestSavedKey(outcomeId), "true");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className={styles.loading}><Spinner label="Building your plan…" size="md" /></div>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.saveButton}${saved ? ` ${styles.saved}` : ""}`}
            onClick={handleSave}
            disabled={saving || saved || Boolean(error)}
          >
            <Icon name={saved ? "check" : "save"} size={17} />
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
          <details className={styles.options}>
            <summary aria-label="Plan options"><Icon name="dots-vertical" size={20} /></summary>
            <div className={styles.optionsPanel}>
              <AlternateFormats outcomeId={outcomeId} />
            </div>
          </details>
        </div>
      </header>

      {error ? (
        <section className={styles.errorCard}>
          <p>{error}</p>
          <Link href={`/outcomes/${outcomeId}/conversation`}>Review the request</Link>
        </section>
      ) : (
        <ArtifactActionScreen outcomeId={outcomeId} />
      )}
    </main>
  );
}
