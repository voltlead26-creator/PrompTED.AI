"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConversationMessage } from "@prompted/shared/browser";
import type {
  ChecklistItemResult,
} from "@prompted/shared/orchestration";
import { generateChecklist } from "@prompted/shared/api-client";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { Button } from "@/components/atoms/Button";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { HomeScreen } from "@/app/(app)/home/HomeScreen";
import {
  fetchOutcome,
  saveOutcomeConversation,
  type SaveOutcomeConversationInput,
} from "@/lib/api/outcomes";
import { replaceOwnChecklist } from "@/lib/api/checklists";
import {
  currentWorkspaceCacheScope,
  deterministicGenerationEntityId,
  loadPendingOutcome,
  resolveGenerationRequestIdentity,
} from "@/lib/workspace-store";
import { ensureApiConfigured } from "@/lib/api";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import { useOutcome, type ConfirmOutcomeParams } from "@/hooks/useOutcome";
import { fetchArtifactByOutcome } from "@/lib/api/artifacts";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import { loadLocalChecklist, saveLocalChecklist } from "@/lib/local-checklist-store";
import {
  currentDeviceDataScope,
  type DeviceDataScope,
} from "@/lib/owner-bound-device-store";
import {
  clearConversationSaveCommand,
  loadConversationSaveCommand,
  persistConversationSaveCommand,
} from "@/lib/outcome-conversation-save-spool";
import styles from "./ConversationView.module.css";

const SECTION_SEPARATOR = "\u241F";

function conversationContext(messages: ConversationMessage[]): string {
  return messages
    .map((message) => `${message.role === "ted" ? "TED" : "User"}: ${message.text}`)
    .join("\n");
}

function normaliseDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function encodeSection(item: ChecklistItemResult): string {
  const section = item.section?.trim() || "General";
  return `${section}${SECTION_SEPARATOR}${item.text.trim()}`;
}

interface PendingConversationSave {
  messages: ConversationMessage[];
  lease: OwnerDispatchLease;
}

interface PreparedConversationSave extends PendingConversationSave {
  input: SaveOutcomeConversationInput;
}

interface ConversationSaveSession {
  outcomeId: string;
  userId: string;
  deviceScope: DeviceDataScope;
  conversationRevision: number;
  pending: PendingConversationSave | null;
  uncertain: PreparedConversationSave | null;
  pump: Promise<void> | null;
  blockedByConflict: boolean;
  visible: boolean;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function isConversationRevisionConflict(error: unknown): boolean {
  return (
    errorCode(error) === "40001" ||
    (error instanceof Error &&
      error.message.includes("OUTCOME_CONVERSATION_REVISION_CONFLICT"))
  );
}

function isRetryableConversationTransportFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  const code = errorCode(error);
  if (["PGRST000", "PGRST001", "PGRST002"].includes(code)) return true;
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 500
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    /failed to fetch|network request failed|load failed/i.test(error.message)
  );
}

export function ConversationView({ outcomeId }: { outcomeId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const deviceScope = useMemo(() => currentDeviceDataScope(user?.id), [user?.id]);
  const { showToast } = useToast();
  const outcome = useOutcome();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [initial, setInitial] = useState<ConversationMessage[]>([]);
  const [situation, setSituation] = useState("");
  const [isChecklist, setIsChecklist] = useState(false);
  const latestMessagesRef = useRef<ConversationMessage[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSessionRef = useRef<ConversationSaveSession | null>(null);

  const runConversationSavePump = useCallback(
    async (session: ConversationSaveSession): Promise<void> => {
      while (!session.blockedByConflict) {
        let prepared = session.uncertain;
        if (!prepared) {
          const pending = session.pending;
          if (!pending) return;
          session.pending = null;
          if (!ownerDispatchIsCurrent(pending.lease)) return;

          const messages = pending.messages.map((message) => ({ ...message }));
          const expectedConversationRevision = session.conversationRevision;
          const requestId = await resolveGenerationRequestIdentity(
            currentWorkspaceCacheScope(session.userId),
            session.outcomeId,
            "save-conversation",
            {
              contractVersion: "outcome-conversation-save.1",
              expectedConversationRevision,
              conversation: messages,
            },
          );
          if (!ownerDispatchIsCurrent(pending.lease)) return;
          prepared = {
            ...pending,
            messages,
            input: {
              outcomeId: session.outcomeId,
              expectedConversationRevision,
              requestId,
              conversation: messages,
            },
          };
          if (!persistConversationSaveCommand(session.deviceScope, prepared.input)) {
            session.pending = pending;
            if (session.visible) {
              showToast({
                tone: "error",
                message:
                  "TED couldn't safely stage this conversation save on your device. Your words remain on screen; check browser storage and retry.",
              });
            }
            return;
          }
          session.uncertain = prepared;
        }

        let receipt: Awaited<ReturnType<typeof saveOutcomeConversation>> | null = null;
        let failure: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            prepared.lease.assertCurrent();
            receipt = await saveOutcomeConversation(prepared.input, prepared.lease);
            prepared.lease.assertCurrent();
            break;
          } catch (error) {
            failure = error;
            if (!ownerDispatchIsCurrent(prepared.lease)) {
              session.uncertain = null;
              session.pending = null;
              return;
            }
            if (isConversationRevisionConflict(error)) {
              session.uncertain = null;
              session.pending = null;
              session.blockedByConflict = true;
              if (session.visible) {
                showToast({
                  tone: "error",
                  message:
                    "This conversation changed elsewhere. Your latest words are still here, but reload before saving again.",
                });
              }
              return;
            }
            if (attempt === 0 && isRetryableConversationTransportFailure(error)) {
              continue;
            }
            break;
          }
        }

        if (!receipt) {
          // The exact prepared command is retained. A later user-triggered
          // drain replays its immutable request identity before any newer text.
          session.uncertain = prepared;
          if (session.visible && ownerDispatchIsCurrent(prepared.lease)) {
            showToast({
              tone: "error",
              message:
                "TED couldn't confirm the latest conversation save. Your words remain on screen; try again before continuing.",
            });
          }
          void failure;
          return;
        }

        if (receipt.state === "superseded") {
          clearConversationSaveCommand(session.deviceScope, session.outcomeId);
          session.uncertain = null;
          session.pending = null;
          session.blockedByConflict = true;
          if (session.visible && ownerDispatchIsCurrent(prepared.lease)) {
            showToast({
              tone: "error",
              message:
                "This conversation changed elsewhere. Your latest words are still here, but reload before saving again.",
            });
          }
          return;
        }

        if (receipt.conversationRevision < session.conversationRevision) {
          session.uncertain = null;
          session.pending = null;
          session.blockedByConflict = true;
          if (session.visible && ownerDispatchIsCurrent(prepared.lease)) {
            showToast({
              tone: "error",
              message:
                "This conversation changed elsewhere. Your latest words are still here, but reload before saving again.",
            });
          }
          return;
        }

        clearConversationSaveCommand(session.deviceScope, session.outcomeId);
        session.uncertain = null;
        session.conversationRevision = receipt.conversationRevision;
      }
    },
    [showToast],
  );

  const startConversationSavePump = useCallback(
    (session: ConversationSaveSession): Promise<void> => {
      if (session.pump) return session.pump;
      const running = runConversationSavePump(session);
      let settled!: Promise<void>;
      settled = running.finally(() => {
        if (session.pump === settled) session.pump = null;
      });
      session.pump = settled;
      return settled;
    },
    [runConversationSavePump],
  );

  const flushConversationSave = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const session = saveSessionRef.current;
    if (!session) return;
    if (session.blockedByConflict) {
      throw new Error("OUTCOME_CONVERSATION_REVISION_CONFLICT");
    }
    await startConversationSavePump(session);
    if (session.blockedByConflict) {
      throw new Error("OUTCOME_CONVERSATION_REVISION_CONFLICT");
    }
    if (session.uncertain) {
      throw new Error("OUTCOME_CONVERSATION_SAVE_UNCONFIRMED");
    }
  }, [startConversationSavePump]);

  useEffect(() => {
    let cancelled = false;
    let requestContext: ReturnType<typeof captureOwnerDispatch> | null = null;
    let saveSession: ConversationSaveSession | null = null;
    async function load() {
      setLoadState("loading");
      requestContext = user?.id ? captureOwnerDispatch(user.id) : null;
      const savedOutcome = requestContext
        ? await fetchOutcome(outcomeId, requestContext)
        : null;
      if (requestContext && !savedOutcome) throw new Error("OUTCOME_NOT_FOUND");
      let thread = savedOutcome?.recommendation_payload?.conversation ?? null;
      let sit = savedOutcome?.situation_text ?? "";
      if ((!thread || thread.length === 0) && !user) {
        const pending = loadPendingOutcome(currentWorkspaceCacheScope(), outcomeId);
        thread = pending?.conversation ?? null;
        sit = sit || pending?.situation || "";
      }

      let checklist = !user && loadLocalChecklist(deviceScope, outcomeId).length > 0;

      if (!checklist && user) {
        const artifact = await fetchArtifactByOutcome(outcomeId, requestContext!);
        checklist = artifact?.kind === "checklist" || artifact?.kind === "action_plan";
      }

      if (!checklist && user) {
        const { count, error } = await withOwnerSupabase(
          requestContext!,
          async (supabase) =>
            await supabase
              .from("checklist_items")
              .select("id", { count: "exact", head: true })
              .eq("outcome_id", outcomeId),
        );
        if (error) throw error;
        if (!Number.isSafeInteger(count) || Number(count) < 0) {
          throw new Error("CHECKLIST_COUNT_INVALID");
        }
        checklist = Number(count) > 0;
      }

      if (
        !cancelled &&
        (!requestContext || ownerDispatchIsCurrent(requestContext))
      ) {
        let messages = thread ?? [];
        if (requestContext) {
          const stagedCommand = loadConversationSaveCommand(deviceScope, outcomeId);
          if (
            stagedCommand &&
            stagedCommand.expectedConversationRevision >=
              (savedOutcome?.conversation_revision ?? 0) - 1
          ) {
            messages = stagedCommand.conversation.map((message) => ({ ...message }));
          }
          saveSession = {
            outcomeId,
            userId: requestContext.expectedUserId,
            deviceScope,
            conversationRevision: savedOutcome?.conversation_revision ?? 0,
            pending: null,
            uncertain: stagedCommand
              ? {
                  messages: stagedCommand.conversation.map((message) => ({ ...message })),
                  lease: requestContext,
                  input: stagedCommand,
                }
              : null,
            pump: null,
            blockedByConflict: false,
            visible: true,
          };
          saveSessionRef.current = saveSession;
          if (stagedCommand) void startConversationSavePump(saveSession);
        } else {
          saveSessionRef.current = null;
        }
        latestMessagesRef.current = messages;
        setInitial(messages);
        setSituation(sit);
        setIsChecklist(checklist);
        setLoadState("ready");
      }
    }
    void load().catch(() => {
      if (
        !cancelled &&
        (!requestContext || ownerDispatchIsCurrent(requestContext))
      ) {
        setLoadState("failed");
        showToast({
          tone: "error",
          message: "TED couldn't reload that conversation just now. You can retry from the document.",
        });
      }
    });
    return () => {
      cancelled = true;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (saveSession) {
        saveSession.visible = false;
        if (
          saveSession.pending &&
          ownerDispatchIsCurrent(saveSession.pending.lease)
        ) {
          void startConversationSavePump(saveSession);
        } else if (saveSession.pending) {
          saveSession.pending = null;
        }
        if (saveSessionRef.current === saveSession) {
          saveSessionRef.current = null;
        }
      }
    };
  }, [deviceScope, loadAttempt, outcomeId, showToast, startConversationSavePump, user]);

  const handleMessagesChange = useCallback(
    (messages: ConversationMessage[]) => {
      if (messages.length === 0) return;
      latestMessagesRef.current = messages;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (!user?.id) return;
      const session = saveSessionRef.current;
      if (
        !session ||
        session.outcomeId !== outcomeId ||
        session.userId !== user.id.trim().toLowerCase() ||
        session.blockedByConflict
      ) {
        return;
      }
      let requestContext: OwnerDispatchLease;
      try {
        requestContext = captureOwnerDispatch(user.id);
      } catch {
        return;
      }
      session.pending = {
        messages: messages.map((message) => ({ ...message })),
        lease: requestContext,
      };
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        if (!ownerDispatchIsCurrent(requestContext)) return;
        void startConversationSavePump(session);
      }, 800);
    },
    [outcomeId, startConversationSavePump, user?.id],
  );

  const refineChecklist = useCallback(async (nextSituation: string) => {
    if (!user?.id) throw new Error("authenticated_checklist_required");
    await flushConversationSave();
    const requestContext = captureOwnerDispatch(user.id);
    const transcript = conversationContext(latestMessagesRef.current);
    const refinedSituation = [situation, nextSituation, transcript]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const existingArtifact = await fetchArtifactByOutcome(outcomeId, requestContext);
    if (existingArtifact && (existingArtifact.kind === "checklist" || existingArtifact.kind === "action_plan")) {
      requestContext.assertCurrent();
      showToast({
        tone: "error",
        message: "TED can't safely replace this saved plan yet. Your current plan is unchanged; edit individual steps instead.",
      });
      return;
    }
    ensureApiConfigured();
    const checklistInput = { situation: refinedSituation };
    const persistenceRevision = await fetchOutcome(outcomeId, requestContext);
    if (user && !persistenceRevision) throw new Error("outcome_not_found");
    const checklistRequestId = await resolveGenerationRequestIdentity(
      currentWorkspaceCacheScope(user?.id),
      outcomeId,
      "refine-checklist",
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
    const rows = await Promise.all(generated.map(async (item, index) => ({
      id: await deterministicGenerationEntityId(
        checklistRequestId,
        `checklist-item:${index}`,
      ),
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
    })));

    if (user) {
      await replaceOwnChecklist(
        {
          outcomeId,
          requestId: checklistRequestId,
          expectedOutcomeUpdatedAt: persistenceRevision!.updated_at,
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
    } else {
      saveLocalChecklist(deviceScope, outcomeId, rows);
    }

    if (!ownerDispatchIsCurrent(requestContext)) return;
    showToast({ tone: "success", message: "Your checklist has been updated." });
    router.push(`/outcomes/${outcomeId}/checklist`);
    router.refresh();
  }, [deviceScope, flushConversationSave, outcomeId, router, showToast, situation, user]);

  const handleConfirm = useCallback(
    async (params: ConfirmOutcomeParams) => {
      if (isChecklist) {
        await refineChecklist(params.situation);
        return;
      }

      await flushConversationSave();
      await outcome.confirm({
        ...params,
        situation: params.situation || situation,
        conversationContext: conversationContext(latestMessagesRef.current),
        conversation: latestMessagesRef.current,
      });
      showToast({ tone: "success", message: "Creating a new document from your updated conversation." });
    },
    [flushConversationSave, isChecklist, outcome, refineChecklist, situation, showToast],
  );

  const backHref = isChecklist
    ? `/outcomes/${outcomeId}/checklist`
    : `/outcomes/${outcomeId}`;

  if (loadState === "loading") {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading your conversation" size="md" />
      </div>
    );
  }

  if (loadState === "failed") {
    return (
      <div className={styles.loading} role="alert">
        <p>TED couldn&rsquo;t load this conversation safely, so editing is unavailable.</p>
        <Button
          variant="primary"
          size="md"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Retry
        </Button>
        <Link href={`/outcomes/${outcomeId}`} className={styles.back}>
          Back to outcome
        </Link>
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
