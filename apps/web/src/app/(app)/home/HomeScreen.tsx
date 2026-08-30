"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useRecommendation } from "@/hooks/useRecommendation";
import { useOutcome } from "@/hooks/useOutcome";
import { useToast } from "@/components/atoms/Toast";
import { OptionalPanelBoundary } from "@/components/molecules/OptionalPanelBoundary";
import { ensureApiConfigured } from "@/lib/api";
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
  onConfirm?: (
    item: RecommendationItem,
    situation: string,
    alternatives?: RecommendationItem[],
  ) => Promise<void> | void;
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
}

export function HomeScreen({
  fastLaneItems = [],
  onConfirm,
  initialConversation,
  resumeSituation,
  onMessagesChange,
}: HomeScreenProps) {
  const [value, setValue] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const { attachment, error: attachError, attach, clear } = useFileAttachment();
  const { showToast } = useToast();
  const outcome = useOutcome();
  const showTour = useDeferredTour("home-v2");
  const confirmationInFlightRef = useRef(false);

  const rec = useRecommendation((message) => showToast({ tone: "error", message }));

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

  const handleNewChat = useCallback(() => {
    if (confirmationInFlightRef.current) return;
    rec.reset();
    setValue("");
    setPendingUpload(null);
    setConfirming(false);
    clear();
  }, [rec, clear]);

  const handleSubmit = useCallback(async () => {
    const typed = value.trim();
    if (typed.length === 0 && !attachment) return;
    ensureApiConfigured();

    if (attachment) {
      setUploading(true);
      try {
        const ingest = await ingestUpload(attachment.file, typed);
        const summary = String(ingest.confirm_payload?.summary ?? "").trim();
        const documentType = String(ingest.confirm_payload?.document_type ?? "").trim();
        const structure = ingest.confirm_payload?.structure ?? null;
        const displayText = [typed, `📎 ${attachment.name}`, summary ? `TED read: ${summary}` : ""]
          .filter(Boolean)
          .join("\n")
          .trim();
        rec.seedUploadContext({
          uploadId: ingest.upload_id,
          fileName: attachment.name,
          summary,
          extractedText: ingest.extracted_text,
        });
        setPendingUpload({
          uploadId: ingest.upload_id,
          typed,
          displayText,
          extractedText: ingest.extracted_text,
          summary,
          documentType,
          structure,
          fileName: attachment.name,
        });
        setUploading(false);
        return;
      } catch (error) {
        setUploading(false);
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
      }
    }

    setValue("");
    await rec.submit(typed);
  }, [value, attachment, rec, showToast]);

  const handleSelectOption = useCallback(
    async (option: string) => {
      await rec.submit(option);
    },
    [rec],
  );

  const handleConfirmUpload = useCallback(
    async (confirmedText: string) => {
      if (!pendingUpload) return;
      const { typed, displayText, extractedText } = pendingUpload;
      setPendingUpload(null);
      setValue("");
      clear();
      await rec.submit(typed, displayText, confirmedText || extractedText);
    },
    [pendingUpload, clear, rec],
  );

  const handleConfirm = useCallback(
    async (item: RecommendationItem) => {
      if (confirmationInFlightRef.current) return;
      confirmationInFlightRef.current = true;
      setConfirming(true);
      const situation = rec.result?.situation ?? "";
      const offered = rec.result?.recommendation;
      const alternateFormats = offered
        ? [offered.primary, ...offered.alternatives].filter(
            (candidate) => candidate.name !== item.name,
          )
        : [];

      try {
        if (onConfirm) {
          await onConfirm(item, situation, alternateFormats);
        } else {
          await outcome.confirm({
            situation,
            templateName: item.name,
            conversationContext: rec.getDocumentContext(),
            uploadContext: rec.getUploadContext(),
            uploadId: rec.getUploadId(),
            conversation: rec.messages.map((message) => ({ role: message.role, text: message.text })),
            alternateFormats,
          });
        }
      } catch {
        showToast({
          tone: "error",
          message: "TED couldn't create that just now. Your conversation is still here; please try again.",
        });
      } finally {
        confirmationInFlightRef.current = false;
        setConfirming(false);
      }
    },
    [onConfirm, outcome, rec, showToast],
  );

  return (
    <div className={styles.screen}>
      {showTour ? (
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
          {rec.conversationStarted && (
            <button
              type="button"
              className={styles.themeButton}
              onClick={handleNewChat}
              disabled={confirming}
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

        {rec.conversationStarted && (
          <ChatResponsiveClarify
            messages={rec.messages}
            thinking={rec.thinking}
            onSelectOption={handleSelectOption}
          />
        )}

        {rec.showRecommendation && rec.result?.recommendation && (
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

        {!rec.showRecommendation && pendingUpload && (
          <PhotoConfirmation
            extractedText={pendingUpload.extractedText}
            summary={pendingUpload.summary}
            documentType={pendingUpload.documentType}
            structure={pendingUpload.structure}
            fileName={pendingUpload.fileName}
            onConfirm={handleConfirmUpload}
            onCancel={() => {
              setPendingUpload(null);
              rec.clearUploadContext();
            }}
          />
        )}

        {!rec.showRecommendation && !pendingUpload && (
          <div data-tour="home-chat" className={styles.chatDock}>
            <ChatInput
              value={value}
              onChange={setValue}
              onSubmit={handleSubmit}
              attachment={attachment}
              onAttachFile={attach}
              onRemoveAttachment={clear}
              attachError={attachError}
              busy={rec.thinking || uploading}
              ariaLabel="What do you need help completing?"
            />
          </div>
        )}

        {!rec.conversationStarted && (
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
