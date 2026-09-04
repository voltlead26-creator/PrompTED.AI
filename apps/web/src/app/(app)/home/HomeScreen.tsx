"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useDeferredTour } from "@/hooks/useDeferredTour";
import type { ConversationMessage } from "@prompted/shared/browser";
import type { RecommendationItem } from "@prompted/shared/orchestration";
import { ChatInput } from "@/components/organisms/ChatInput";
import { ExampleChips } from "@/components/organisms/ExampleChips";
import { FastLane, type FastLaneItem } from "@/components/organisms/FastLane";
import { ChatResponsiveClarify } from "@/components/organisms/ChatResponsiveClarify";
import { PhotoConfirmation } from "@/components/organisms/PhotoConfirmation";
import { SummaryCard } from "@/components/organisms/SummaryCard";
import { RecommendationCardGroup } from "@/components/organisms/RecommendationCardGroup";
import { Icon } from "@/components/atoms/Icon";
import { Button } from "@/components/atoms/Button";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useRecommendation } from "@/hooks/useRecommendation";
import { useOutcome, type ConfirmOutcomeParams } from "@/hooks/useOutcome";
import { useToast } from "@/components/atoms/Toast";
import { OptionalPanelBoundary } from "@/components/molecules/OptionalPanelBoundary";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import {
  beginHomeUploadIntake,
  type BeginHomeUploadIntakeInput,
  cancelHomeUploadIntake,
  confirmHomeUploadIntake,
  HomeUploadIntakeError,
} from "@/lib/api/home-intakes";
import type {
  HomeIntakeInitialState,
  HomeUploadIntakeSnapshot,
} from "@/lib/home-intake-initial-state";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import { signInHref } from "@/lib/auth-return";
import { ApiError, ingestUpload } from "@prompted/shared/api-client";
import styles from "./HomeScreen.module.css";

const BrowseModal = dynamic(
  () => import("@/components/organisms/BrowseModal").then((module) => module.BrowseModal),
  {
    ssr: false,
    loading: () => <p role="status">Loading document catalogue…</p>,
  },
);

const GuidedTour = dynamic(
  () => import("@/components/organisms/GuidedTour").then((module) => module.GuidedTour),
  { ssr: false },
);

interface HomeScreenProps {
  fastLaneItems?: FastLaneItem[];
  onConfirm?: (params: ConfirmOutcomeParams) => Promise<void> | void;
  /** Server-loaded critical upload state. Omitted by embedded legacy conversations. */
  initialState?: HomeIntakeInitialState;
  initialConversation?: ConversationMessage[];
  resumeSituation?: string;
  onMessagesChange?: (messages: ConversationMessage[]) => void;
}

interface PendingUpload {
  uploadId: string;
  typed: string;
  displayText: string;
  extractedText: string;
  summary: string;
  documentType: string;
  structure: { title: string; items: string[] }[] | null;
  fileName: string;
  durablyConfirmed: boolean;
}

interface HomeUploadAttempt {
  epoch: number;
  controller: AbortController;
  beginInput: BeginHomeUploadIntakeInput | null;
  receipt: HomeUploadIntakeSnapshot | null;
}

function pendingUploadFromSnapshot(intake: HomeUploadIntakeSnapshot | null): PendingUpload | null {
  if (!intake?.confirmPayload) return null;
  const source = intake.uploadState === "awaiting_confirmation"
    ? intake.extractedText
    : intake.uploadState === "confirmed"
      ? intake.confirmedText
      : null;
  if (!source) return null;
  const { summary, document_type: documentType, structure } = intake.confirmPayload;
  return {
    uploadId: intake.uploadId,
    typed: intake.typedSituation,
    displayText: [
      intake.typedSituation,
      `📎 ${intake.fileName}`,
      summary ? `TED read: ${summary}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim(),
    extractedText: source,
    summary,
    documentType,
    structure,
    fileName: intake.fileName,
    durablyConfirmed: intake.state === "confirmed",
  };
}

function createIntakeId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error("HOME_UPLOAD_INTAKE_ID_UNAVAILABLE");
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normaliseOwnerId(userId: string): string {
  return userId.trim().toLowerCase();
}

export function HomeScreen({
  fastLaneItems = [],
  onConfirm,
  initialState,
  initialConversation,
  resumeSituation,
  onMessagesChange,
}: HomeScreenProps) {
  const durableIntakeEnabled = Boolean(initialState && !onConfirm);
  // Embedded/legacy conversations own only their local upload state. A server
  // snapshot is accepted exclusively by the durable Home route, where it is
  // subsequently fenced against the hydrated principal below.
  const initialIntake = durableIntakeEnabled && initialState?.persistence === "persisted"
    ? initialState.intake
    : null;
  const [value, setValue] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(() =>
    pendingUploadFromSnapshot(initialIntake),
  );
  const [activeIntake, setActiveIntake] = useState<HomeUploadIntakeSnapshot | null>(
    initialIntake,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadTransitioning, setUploadTransitioning] = useState(false);
  const [ownerMismatch, setOwnerMismatch] = useState(false);
  const { attachment, error: attachError, attach, clear } = useFileAttachment();
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const outcome = useOutcome();
  const showTour = useDeferredTour("home-v2");
  const confirmationInFlightRef = useRef(false);
  const uploadTransitionInFlightRef = useRef(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const activeIntakeRef = useRef<HomeUploadIntakeSnapshot | null>(initialIntake);
  const uploadAttemptRef = useRef<HomeUploadAttempt | null>(null);
  const uploadAttemptEpochRef = useRef(0);
  const intakeIdRef = useRef<string | null>(
    initialIntake && initialIntake.state !== "consumed" ? initialIntake.intakeId : null,
  );
  const recoveredContextRef = useRef(false);
  const serverSnapshotMismatch = Boolean(
    durableIntakeEnabled &&
    !authLoading &&
    initialState &&
    (
      initialState.authenticated !== Boolean(user) ||
      (user
        ? !initialState.ownerUserId ||
          normaliseOwnerId(initialState.ownerUserId) !== normaliseOwnerId(user.id)
      : initialState.ownerUserId !== null)
    ),
  );
  const activeIntakeOwnerMismatch = Boolean(
    durableIntakeEnabled &&
    !authLoading &&
    activeIntake &&
    (!user || normaliseOwnerId(activeIntake.ownerUserId) !== normaliseOwnerId(user.id)),
  );
  const intakeUnavailable = durableIntakeEnabled &&
    (
      initialState?.persistence === "unavailable" ||
      ownerMismatch ||
      serverSnapshotMismatch ||
      activeIntakeOwnerMismatch
    );
  // Server state can outlive the browser principal during an account transition.
  // Never present or seed durable upload content until the hydrated principal and
  // both owner envelopes agree; the effect below remains cleanup, not the fence.
  const intakeStateTrusted = !durableIntakeEnabled || (!authLoading && !intakeUnavailable);
  const trustedActiveIntake = intakeStateTrusted ? activeIntake : null;
  const trustedPendingUpload = intakeStateTrusted ? pendingUpload : null;

  const rec = useRecommendation((message) => showToast({ tone: "error", message }));
  const publishActiveIntake = useCallback((next: HomeUploadIntakeSnapshot | null) => {
    activeIntakeRef.current = next;
    setActiveIntake(next);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (serverSnapshotMismatch || activeIntakeOwnerMismatch) {
      uploadAbortRef.current?.abort(new Error("HOME_UPLOAD_OWNER_CHANGED"));
      uploadAbortRef.current = null;
      uploadAttemptEpochRef.current += 1;
      uploadAttemptRef.current = null;
      setUploading(false);
      setOwnerMismatch(true);
      publishActiveIntake(null);
      setPendingUpload(null);
      intakeIdRef.current = null;
      rec.clearUploadContext();
      clear();
    }
  }, [
    activeIntakeOwnerMismatch,
    authLoading,
    clear,
    publishActiveIntake,
    rec,
    serverSnapshotMismatch,
  ]);

  useEffect(() => {
    if (
      recoveredContextRef.current ||
      !trustedActiveIntake ||
      trustedActiveIntake.state !== "confirmed" ||
      !trustedActiveIntake.confirmedText
    ) {
      return;
    }
    recoveredContextRef.current = true;
    rec.seedUploadContext({
      uploadId: trustedActiveIntake.uploadId,
      fileName: trustedActiveIntake.fileName,
      summary: trustedActiveIntake.confirmPayload?.summary,
      extractedText: trustedActiveIntake.confirmedText,
    });
  }, [rec, trustedActiveIntake]);

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (initialConversation && initialConversation.length > 0) {
      hydratedRef.current = true;
      rec.hydrate({ messages: initialConversation, situation: resumeSituation });
    }
  }, [initialConversation, resumeSituation, rec]);

  useEffect(() => {
    if (!onMessagesChange) return;
    onMessagesChange(rec.messages.map((message) => ({ role: message.role, text: message.text })));
  }, [rec.messages, onMessagesChange]);

  const handlePickExample = useCallback((fill: string) => setValue(fill), []);

  const cancelCurrentUpload = useCallback(async (): Promise<boolean> => {
    if (uploadTransitionInFlightRef.current) return false;
    const attempt = uploadAttemptRef.current;
    uploadAttemptEpochRef.current += 1;
    (attempt?.controller ?? uploadAbortRef.current)?.abort(
      new Error("HOME_UPLOAD_CANCELLED"),
    );
    uploadAbortRef.current = null;
    setUploading(false);
    let authoritativeIntake = attempt?.receipt ?? activeIntakeRef.current;
    if (durableIntakeEnabled && (attempt?.beginInput || authoritativeIntake)) {
      if (authLoading || !user) return false;
      uploadTransitionInFlightRef.current = true;
      setUploadTransitioning(true);
      const requestContext = captureOwnerDispatch(user.id);
      try {
        if (attempt?.beginInput && !attempt.receipt) {
          authoritativeIntake = await beginHomeUploadIntake(
            attempt.beginInput,
            requestContext,
          );
          requestContext.assertCurrent();
          attempt.receipt = authoritativeIntake;
          publishActiveIntake(authoritativeIntake);
        }
        if (!authoritativeIntake) {
          throw new Error("HOME_UPLOAD_INTAKE_CANCELLATION_UNCONFIRMED");
        }
        if (authoritativeIntake.state === "consumed") {
          publishActiveIntake(authoritativeIntake);
          showToast({
            tone: "error",
            message:
              "That upload already created a saved outcome. Continue the saved outcome before removing it.",
          });
          return false;
        }
        if (
          authoritativeIntake.state === "open" ||
          authoritativeIntake.state === "confirmed"
        ) {
          const cancellation = await cancelHomeUploadIntake(
            {
              intakeId: authoritativeIntake.intakeId,
              uploadId: authoritativeIntake.uploadId,
              expectedRevision: authoritativeIntake.revision,
            },
            requestContext,
          );
          requestContext.assertCurrent();
          if (cancellation.state !== "cancelled") {
            throw new Error("HOME_UPLOAD_INTAKE_CANCELLATION_UNCONFIRMED");
          }
        } else if (authoritativeIntake.state !== "cancelled") {
          throw new Error("HOME_UPLOAD_INTAKE_CANCELLATION_UNCONFIRMED");
        }
        requestContext.assertCurrent();
      } catch {
        if (ownerDispatchIsCurrent(requestContext)) {
          showToast({
            tone: "error",
            message: "TED couldn't cancel that saved upload yet. Nothing was cleared; please try again.",
          });
        }
        return false;
      } finally {
        if (ownerDispatchIsCurrent(requestContext)) setUploadTransitioning(false);
        uploadTransitionInFlightRef.current = false;
      }
    }

    uploadAttemptRef.current = null;
    publishActiveIntake(null);
    setPendingUpload(null);
    intakeIdRef.current = null;
    recoveredContextRef.current = false;
    rec.clearUploadContext();
    clear();
    return true;
  }, [authLoading, clear, durableIntakeEnabled, publishActiveIntake, rec, showToast, user]);

  const handleNewChat = useCallback(async () => {
    if (confirmationInFlightRef.current || uploadTransitionInFlightRef.current) return;
    if (!(await cancelCurrentUpload())) return;
    rec.reset();
    setValue("");
    setConfirming(false);
  }, [cancelCurrentUpload, rec]);

  const handleSubmit = useCallback(async () => {
    if (authLoading || !user) return;
    // Durable upload state is owner-scoped. When it cannot be trusted, keep the
    // independent text clarification path available but never dispatch a file.
    if (intakeUnavailable && attachment) return;
    const resumingUpload = activeIntake?.state === "open" &&
      (activeIntake.uploadState === "file_required" || activeIntake.uploadState === "processing");
    const typed = resumingUpload ? activeIntake.typedSituation : value.trim();
    if (typed.length === 0 && !attachment) return;
    ensureApiConfigured();

    if (attachment) {
      const uploadController = new AbortController();
      uploadAbortRef.current?.abort(new Error("HOME_UPLOAD_SUPERSEDED"));
      uploadAbortRef.current = null;
      const uploadAttemptEpoch = uploadAttemptEpochRef.current + 1;
      uploadAttemptEpochRef.current = uploadAttemptEpoch;
      const requestContext = captureOwnerDispatch(user.id, uploadController.signal);
      uploadAbortRef.current = uploadController;
      const attempt: HomeUploadAttempt = {
        epoch: uploadAttemptEpoch,
        controller: uploadController,
        beginInput: null,
        receipt: null,
      };
      uploadAttemptRef.current = attempt;
      setUploading(true);
      const acknowledgement: { value: HomeUploadIntakeSnapshot | null } = { value: null };
      const intakeId = activeIntake?.state === "open"
        ? activeIntake.intakeId
        : intakeIdRef.current ?? createIntakeId();
      intakeIdRef.current = intakeId;
      try {
        const ingest = await ingestUpload(attachment.file, typed, requestContext, {
          beforeDispatch: async (prepared) => {
            if (!durableIntakeEnabled) return;
            if (uploadAttemptEpochRef.current !== uploadAttemptEpoch) {
              throw new Error("HOME_UPLOAD_CANCELLED");
            }
            const beginInput = { intakeId, prepared };
            attempt.beginInput = beginInput;
            const receipt = await beginHomeUploadIntake(
              beginInput,
              requestContext,
            );
            attempt.receipt = receipt;
            requestContext.assertCurrent();
            if (uploadAttemptEpochRef.current !== uploadAttemptEpoch) {
              throw new Error("HOME_UPLOAD_CANCELLED");
            }
            acknowledgement.value = receipt;
            publishActiveIntake(receipt);
          },
        });
        requestContext.assertCurrent();
        if (uploadAttemptEpochRef.current !== uploadAttemptEpoch) return;
        if (
          durableIntakeEnabled &&
          (!acknowledgement.value || acknowledgement.value.uploadId !== ingest.upload_id)
        ) {
          throw new Error("HOME_UPLOAD_INTAKE_BEGIN_UNCONFIRMED");
        }
        const summary = ingest.confirm_payload.summary;
        const documentType = ingest.confirm_payload.document_type;
        const structure = ingest.confirm_payload.structure;
        const displayText = [typed, `📎 ${attachment.name}`, summary ? `TED read: ${summary}` : ""]
          .filter(Boolean)
          .join("\n")
          .trim();
        setPendingUpload({
          uploadId: ingest.upload_id,
          typed,
          displayText,
          extractedText: ingest.extracted_text,
          summary,
          documentType,
          structure,
          fileName: attachment.name,
          durablyConfirmed: false,
        });
        return;
      } catch (error) {
        if (!ownerDispatchIsCurrent(requestContext)) return;
        const serverMessage =
          error instanceof ApiError
            ? String(
                (error.payload as { error?: { message?: string } })?.error?.message ?? "",
              ).trim()
            : "";
        showToast({
          tone: "error",
          message:
            serverMessage ||
            "TED couldn't read that file. Try again or type the important details instead.",
        });
        return;
      } finally {
        if (uploadAbortRef.current === uploadController) {
          uploadAbortRef.current = null;
          if (ownerDispatchIsCurrent(requestContext)) setUploading(false);
        }
      }
    }

    setValue("");
    await rec.submit(typed);
  }, [
    activeIntake,
    attachment,
    authLoading,
    durableIntakeEnabled,
    intakeUnavailable,
    publishActiveIntake,
    rec,
    showToast,
    user,
    value,
  ]);

  const handleSelectOption = useCallback(
    async (option: string) => {
      if (authLoading || !user) return;
      await rec.submit(option);
    },
    [authLoading, rec, user],
  );

  const handleConfirmUpload = useCallback(
    async (confirmedText: string) => {
      if (
        authLoading ||
        !user ||
        !pendingUpload ||
        uploadTransitionInFlightRef.current
      ) {
        return;
      }
      const finalText = (confirmedText || pendingUpload.extractedText).trim();
      if (!finalText) return;
      uploadTransitionInFlightRef.current = true;
      setUploadTransitioning(true);
      const requestContext = captureOwnerDispatch(user.id);
      try {
        try {
          if (durableIntakeEnabled) {
            if (
              !activeIntake ||
              (activeIntake.state !== "open" && activeIntake.state !== "confirmed")
            ) {
              throw new Error("HOME_UPLOAD_INTAKE_CONFIRM_CONTEXT_MISSING");
            }
            if (activeIntake.state === "open") {
              const confirmation = await confirmHomeUploadIntake(
                {
                  intakeId: activeIntake.intakeId,
                  uploadId: activeIntake.uploadId,
                  expectedRevision: activeIntake.revision,
                  confirmedText: finalText,
                },
                requestContext,
              );
              requestContext.assertCurrent();
              publishActiveIntake(confirmation);
            }
          }
        } catch {
          if (ownerDispatchIsCurrent(requestContext)) {
            showToast({
              tone: "error",
              message: "TED couldn't save that confirmation yet. Your corrected wording is still here; please try again.",
            });
          }
          return;
        }

        try {
          if (rec.getUploadId() === pendingUpload.uploadId) {
            rec.replaceUploadContext(finalText);
          } else {
            rec.seedUploadContext({
              uploadId: pendingUpload.uploadId,
              fileName: pendingUpload.fileName,
              summary: pendingUpload.summary,
              extractedText: finalText,
            });
          }
          recoveredContextRef.current = true;
          const confirmedPending: PendingUpload = {
            ...pendingUpload,
            extractedText: finalText,
            durablyConfirmed: durableIntakeEnabled || pendingUpload.durablyConfirmed,
          };
          setPendingUpload(confirmedPending);
          setValue("");
          clear();
          const continued = await rec.submit(
            pendingUpload.typed,
            pendingUpload.displayText,
          );
          requestContext.assertCurrent();
          if (continued) setPendingUpload(null);
        } catch {
          if (ownerDispatchIsCurrent(requestContext)) {
            showToast({
              tone: "error",
              message: durableIntakeEnabled
                ? "TED saved your confirmation but couldn't continue from it. Use Continue with confirmed text to try again."
                : "TED couldn't continue from that confirmation. Your corrected wording is still here; please try again.",
            });
          }
        }
      } finally {
        if (ownerDispatchIsCurrent(requestContext)) setUploadTransitioning(false);
        uploadTransitionInFlightRef.current = false;
      }
    },
    [
      activeIntake,
      authLoading,
      clear,
      durableIntakeEnabled,
      pendingUpload,
      publishActiveIntake,
      rec,
      showToast,
      user,
    ],
  );

  const handleConfirm = useCallback(
    async (item: RecommendationItem) => {
      if (authLoading || !user || confirmationInFlightRef.current) return;
      confirmationInFlightRef.current = true;
      setConfirming(true);
      const situation = rec.result?.situation ?? "";
      const offered = rec.result?.recommendation;
      const alternateFormats = offered
        ? [offered.primary, ...offered.alternatives].filter(
            (candidate) => candidate.name !== item.name,
          )
        : [];
      const params: ConfirmOutcomeParams = {
        situation,
        templateName: item.name,
        conversationContext: rec.getDocumentContext(),
        uploadContext: rec.getUploadContext(),
        uploadId: rec.getUploadId(),
        conversation: rec.messages.map((message) => ({ role: message.role, text: message.text })),
        alternateFormats,
        ...(durableIntakeEnabled && activeIntake?.state === "confirmed"
          ? {
              homeUploadIntake: {
                intakeId: activeIntake.intakeId,
                uploadId: activeIntake.uploadId,
                expectedRevision: activeIntake.revision,
                confirmedText: activeIntake.confirmedText ?? "",
              },
            }
          : {}),
      };

      try {
        if (onConfirm) {
          await onConfirm(params);
        } else {
          if (durableIntakeEnabled && activeIntake?.state === "open") {
            throw new Error("HOME_UPLOAD_INTAKE_NOT_CONFIRMED");
          }
          if (
            durableIntakeEnabled &&
            activeIntake?.state === "confirmed" &&
            !activeIntake.confirmedText
          ) {
            throw new Error("HOME_UPLOAD_INTAKE_CONFIRMATION_INVALID");
          }
          await outcome.confirm(params);
        }
      } catch (error) {
        showToast({
          tone: "error",
          message: error instanceof HomeUploadIntakeError && error.ambiguous
            ? "TED couldn't confirm whether the outcome was saved. Reload to check your saved work before trying again."
            : "TED couldn't create that just now. Your conversation is still here; please try again.",
        });
      } finally {
        confirmationInFlightRef.current = false;
        setConfirming(false);
      }
    },
    [activeIntake, authLoading, durableIntakeEnabled, onConfirm, outcome, rec, showToast, user],
  );

  const recoveryRequiresFile = trustedActiveIntake?.state === "open" &&
    (
      trustedActiveIntake.uploadState === "file_required" ||
      trustedActiveIntake.uploadState === "processing"
    );
  const terminalUploadFailure = trustedActiveIntake?.state === "open" &&
    trustedActiveIntake.uploadState === "terminal_failure";
  const hasActiveUpload = Boolean(
    trustedActiveIntake &&
    (trustedActiveIntake.state === "open" || trustedActiveIntake.state === "confirmed"),
  );

  return (
    <div className={styles.screen}>
      {showTour && user ? (
        <OptionalPanelBoundary label="Guided tour">
          <GuidedTour
            tourId="home-v2"
            steps={[
              {
                anchor: "home-chat",
                title: "Start with what you need",
                body: "Describe it in your own words, paste rough notes or attach a document. TED will work out the next step.",
              },
              {
                anchor: "home-examples",
                title: "Use an example",
                body: "Choose a starting point when you are not sure how to explain the task.",
              },
              {
                anchor: "home-fastlane",
                title: "Continue your work",
                body: "Recent documents and plans stay within easy reach.",
              },
            ]}
          />
        </OptionalPanelBoundary>
      ) : null}
      <div className={styles.inner}>
        <div className={styles.homeControls}>
          {user && (rec.conversationStarted || hasActiveUpload) && (
            <button
              type="button"
              className={styles.themeButton}
              onClick={() => void handleNewChat()}
              disabled={confirming || uploadTransitioning}
              aria-label="Start again"
            >
              <Icon name="plus" size={17} />
              <span>Start again</span>
            </button>
          )}
        </div>

        {!rec.conversationStarted && (
          <header className={styles.intro}>
            <h1 className={styles.headline}>What do you need help completing?</h1>
            <p className={styles.subline}>
              Describe it in your own words. TED will work out what comes next.
            </p>
          </header>
        )}

        {user && intakeUnavailable ? (
          <section className={styles.intakeStatus} role="alert">
            <div>
              <h2>Saved uploads are temporarily unavailable</h2>
              <p>
                TED couldn&rsquo;t load your saved upload state. You can still describe what you
                need in the chat below, but uploads are paused until you reload.
              </p>
            </div>
          </section>
        ) : null}

        {user && trustedActiveIntake?.state === "consumed" && trustedActiveIntake.outcomeId ? (
          <section className={styles.intakeStatus} aria-labelledby="saved-outcome-title">
            <div>
              <h2 id="saved-outcome-title">Your uploaded outcome is saved</h2>
              <p>{trustedActiveIntake.safeNextAction}</p>
            </div>
            <Link
              className={styles.signInAction}
              href={`/outcomes/${trustedActiveIntake.outcomeId}`}
            >
              Continue saved outcome
            </Link>
          </section>
        ) : null}

        {user && trustedActiveIntake?.state === "open" && !trustedPendingUpload ? (
          <section
            className={styles.intakeStatus}
            role={terminalUploadFailure ? "alert" : "status"}
            aria-live="polite"
          >
            <div>
              <h2>
                {trustedActiveIntake.uploadState === "processing"
                  ? "Your upload is still processing"
                  : terminalUploadFailure
                    ? "This upload needs to be restarted"
                    : "Reselect your saved upload"}
              </h2>
              {trustedActiveIntake.typedSituation ? (
                <p>Saved request: {trustedActiveIntake.typedSituation}</p>
              ) : null}
              <p>{trustedActiveIntake.safeNextAction}</p>
            </div>
            <Button
              variant="ghost"
              size="md"
              onClick={() => void cancelCurrentUpload()}
              disabled={uploadTransitioning}
              loading={uploadTransitioning}
              loadingLabel="Cancelling upload"
            >
              Cancel saved upload
            </Button>
          </section>
        ) : null}

        {user && rec.conversationStarted && (
          <ChatResponsiveClarify
            messages={rec.messages}
            thinking={rec.thinking}
            onSelectOption={handleSelectOption}
          />
        )}

        {user && rec.showRecommendation && rec.result?.recommendation && (
          <>
            {rec.result.situation && (
              <SummaryCard understood={rec.result.situation} onUpdate={rec.adjustUnderstanding} />
            )}
            <RecommendationCardGroup
              recommendation={rec.result.recommendation}
              onConfirm={handleConfirm}
              busy={confirming}
            />
          </>
        )}

        {user && !rec.showRecommendation && trustedPendingUpload && (
          <PhotoConfirmation
            extractedText={trustedPendingUpload.extractedText}
            summary={trustedPendingUpload.summary}
            documentType={trustedPendingUpload.documentType}
            structure={trustedPendingUpload.structure}
            fileName={trustedPendingUpload.fileName}
            onConfirm={handleConfirmUpload}
            onCancel={async () => {
              await cancelCurrentUpload();
            }}
            busy={uploadTransitioning}
            confirmed={trustedPendingUpload.durablyConfirmed}
          />
        )}

        {(!user || (
          !rec.showRecommendation &&
          !trustedPendingUpload &&
          !terminalUploadFailure
        )) && (
          <div data-tour="home-chat" className={styles.chatDock}>
            {authLoading ? (
              <p className={styles.authStatus} role="status">
                Checking your sign-in…
              </p>
            ) : user ? (
              <ChatInput
                value={recoveryRequiresFile ? "" : value}
                onChange={setValue}
                onSubmit={handleSubmit}
                attachment={attachment}
                onAttachFile={attach}
                onRemoveAttachment={() => {
                  void cancelCurrentUpload();
                }}
                attachError={attachError}
                busy={rec.thinking || uploading || uploadTransitioning}
                textReadOnly={recoveryRequiresFile}
                placeholder={recoveryRequiresFile ? "Reselect the same file to continue" : "Ask TED"}
                submitLabel={recoveryRequiresFile ? "Resume upload" : "Ask TED"}
                ariaLabel={recoveryRequiresFile
                  ? "Reselect the same file to continue your saved upload"
                  : "What do you need help completing?"}
                allowAttachment={durableIntakeEnabled && !intakeUnavailable}
              />
            ) : (
              <section className={styles.signInGate} aria-labelledby="home-sign-in-title">
                <div>
                  <h2 id="home-sign-in-title">Sign in before asking TED</h2>
                  <p>
                    PrompTED checks your allowance and saves each accepted operation to your
                    account before any paid generation begins.
                  </p>
                </div>
                <Link className={styles.signInAction} href={signInHref("/home")}>
                  Sign in to ask TED
                </Link>
              </section>
            )}
          </div>
        )}

        {user && !rec.conversationStarted && !hasActiveUpload && !intakeUnavailable && (
          <>
            <div data-tour="home-examples">
              <ExampleChips onPick={handlePickExample} onBrowse={() => setBrowseOpen(true)} />
            </div>
            <div data-tour="home-fastlane">
              <FastLane items={fastLaneItems} />
            </div>
          </>
        )}
      </div>

      {browseOpen ? (
        <OptionalPanelBoundary
          label="Document catalogue"
          onClose={() => setBrowseOpen(false)}
        >
          <BrowseModal
            open
            onClose={() => setBrowseOpen(false)}
            onPick={(templateName) =>
              setValue((current) =>
                current.trim() ? current : `I need help with a ${templateName}.`,
              )
            }
          />
        </OptionalPanelBoundary>
      ) : null}
    </div>
  );
}
