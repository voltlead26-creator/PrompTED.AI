"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, generateArtifactStream, generateChecklist } from "@prompted/shared/api-client";
import type { ChecklistItemResult } from "@prompted/shared/orchestration";
import { ArtifactActionScreen } from "@/components/organisms/ArtifactActionScreen";
import { AlternateFormats } from "@/components/organisms/AlternateFormats";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import { captureOwnerDispatch, ownerDispatchIsCurrent } from "@/lib/browser-principal-state";
import { fetchOutcome, updateOutcome } from "@/lib/api/outcomes";
import { replaceOwnChecklist } from "@/lib/api/checklists";
import { createOrReplayArtifact, fetchArtifactByOutcome } from "@/lib/api/artifacts";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import {
  currentWorkspaceCacheScope,
  deterministicGenerationEntityId,
  resolveGenerationRequestIdentity,
} from "@/lib/workspace-store";
import styles from "./InteractiveChecklistOutcome.module.css";

const SECTION_SEPARATOR = "␟";

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
  const userId = user?.id;
  const [title, setTitle] = useState("Your action plan");
  const [preparationState, setPreparationState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const preparationAttemptRef = useRef(0);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const controller = new AbortController();
    const attempt = preparationAttemptRef.current + 1;
    preparationAttemptRef.current = attempt;
    setPreparationState("loading");
    setError(null);

    async function prepare() {
      let requestContext: ReturnType<typeof captureOwnerDispatch> | null = null;
      try {
        if (!userId) {
          setError("Sign in again before TED builds this plan.");
          setPreparationState("failed");
          return;
        }
        requestContext = captureOwnerDispatch(userId, controller.signal);
        const cacheScope = currentWorkspaceCacheScope(userId);
        const outcome = await fetchOutcome(outcomeId, requestContext);
        requestContext.assertCurrent();
        if (!outcome) throw new Error("OUTCOME_NOT_FOUND");
        setTitle(outcome.recommendation_payload?.primary?.reason || "Your action plan");
        setSaved(Boolean(outcome.is_saved));

        const v2Artifact = await fetchArtifactByOutcome(outcomeId, requestContext);
        if (v2Artifact) {
          if (!cancelled && attempt === preparationAttemptRef.current) {
            setPreparationState("ready");
          }
          return;
        }

        const { count, error: countError } = await withOwnerSupabase(
          requestContext,
          async (supabase) =>
            await supabase
              .from("checklist_items")
              .select("id", { count: "exact", head: true })
              .eq("outcome_id", outcomeId),
        );
        requestContext.assertCurrent();
        if (countError) throw countError;
        if (!Number.isSafeInteger(count) || Number(count) < 0) {
          throw new Error("CHECKLIST_COUNT_INVALID");
        }
        if (Number(count) > 0) {
          if (!cancelled && attempt === preparationAttemptRef.current) {
            setPreparationState("ready");
          }
          return;
        }

        const situation = [
          outcome.situation_text,
          outcome.recommendation_payload?.conversation_context,
          outcome.recommendation_payload?.upload_context,
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        ensureApiConfigured();
        const v2Kind: "checklist" | "action_plan" = /checklist/i.test(
          outcome.recommendation_payload?.primary?.reason ?? "",
        )
          ? "checklist"
          : "action_plan";
        try {
          const artifactInput = {
            outcome_id: outcomeId,
            kind: v2Kind,
            template_id: outcome.recommendation_payload?.primary?.template_id ?? undefined,
            situation,
            conversation_context: outcome.recommendation_payload?.conversation_context,
            upload_context: outcome.recommendation_payload?.upload_context,
            locale: navigator.language || "en-AU",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Melbourne",
          };
          const artifactRequestId = await resolveGenerationRequestIdentity(
            cacheScope,
            outcomeId,
            `initial-artifact:${v2Kind}`,
            artifactInput,
          );
          const artifact = await generateArtifactStream(
            {
              request_id: artifactRequestId,
              ...artifactInput,
            },
            () => {},
            requestContext,
          );
          requestContext.assertCurrent();
          await createOrReplayArtifact(artifact, requestContext);
          requestContext.assertCurrent();
          if (!cancelled && attempt === preparationAttemptRef.current) {
            setPreparationState("ready");
          }
          return;
        } catch (artifactError) {
          // Only the explicit cohort-disabled response may fall back. A
          // provider, settlement or post-generation save failure must not
          // start and charge a second logical generation.
          if (!(artifactError instanceof ApiError) || artifactError.status !== 404) {
            throw artifactError;
          }
        }
        const checklistInput = { situation };
        const checklistRequestId = await resolveGenerationRequestIdentity(
          cacheScope,
          outcomeId,
          "initial-checklist",
          checklistInput,
        );
        const generated = await generateChecklist(
          {
            ...checklistInput,
            generation_request_id: checklistRequestId,
          },
          requestContext,
        );
        requestContext.assertCurrent();
        if (generated.length === 0) throw new Error("empty_checklist");

        const now = new Date().toISOString();
        const rows = await Promise.all(
          generated.map(async (item: ChecklistItemResult, index: number) => ({
            id: await deterministicGenerationEntityId(
              checklistRequestId,
              `checklist-item:${index}`,
            ),
            outcome_id: outcomeId,
            user_id: userId,
            text: encodeSection(item),
            due_date: normaliseDueDate(item.due_date),
            reason: item.reason ?? null,
            done: false,
            reminder_offset_days: null,
            reminder_sent: false,
            order_index: index,
            created_at: now,
            updated_at: now,
          })),
        );

        await replaceOwnChecklist(
          {
            outcomeId,
            requestId: checklistRequestId,
            expectedOutcomeUpdatedAt: outcome.updated_at,
            items: rows.map(({ id, text, due_date, reason, order_index }) => ({
              id,
              text,
              due_date,
              reason,
              order_index,
            })),
          },
          requestContext,
        );
        requestContext.assertCurrent();
        if (!cancelled && attempt === preparationAttemptRef.current) {
          setPreparationState("ready");
        }
      } catch {
        if (
          !cancelled &&
          attempt === preparationAttemptRef.current &&
          (!requestContext || ownerDispatchIsCurrent(requestContext))
        ) {
          setError("TED couldn't load this plan safely. Your earlier information is still safe.");
          setPreparationState("failed");
        }
      }
    }

    void prepare();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authLoading, outcomeId, preparationAttempt, userId]);

  async function handleSave() {
    if (!userId) return;
    const requestContext = captureOwnerDispatch(userId);
    setSaving(true);
    try {
      await updateOutcome(outcomeId, { is_saved: true }, requestContext);
      requestContext.assertCurrent();
      setSaved(true);
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setSaving(false);
    }
  }

  if (preparationState === "loading") {
    return (
      <div className={styles.loading}>
        <Spinner label="Building your plan…" size="md" />
      </div>
    );
  }

  if (preparationState === "failed") {
    return (
      <main className={styles.page}>
        <section className={styles.errorCard} role="alert">
          <p>{error ?? "TED couldn't load this plan safely."}</p>
          <button
            type="button"
            className={styles.saveButton}
            onClick={() => setPreparationAttempt((value) => value + 1)}
          >
            Retry
          </button>
          <Link href={`/outcomes/${outcomeId}/conversation`}>Back to conversation</Link>
        </section>
      </main>
    );
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
            <summary aria-label="Plan options">
              <Icon name="dots-vertical" size={20} />
            </summary>
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
