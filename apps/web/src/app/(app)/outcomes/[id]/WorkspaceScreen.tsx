"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ApiError,
  ingestUpload,
  type CapturedDocumentOperationStatus,
  type DocumentExportFormat,
  type ProofreadSectionResult,
} from "@prompted/shared/api-client";
import {
  resolveFirstCapturedTemplateId,
  type FirstCapturedTemplateId,
} from "@prompted/shared/document-operation";
import { suggestedUploadsForDocument } from "@prompted/shared/suggested-uploads";
import { preflightUploadMetadata } from "@prompted/shared/ingest-upload";
import { isVisiblyEmpty } from "@prompted/shared/visible-content";
import { Spinner } from "@/components/atoms/Spinner";
import { useToast } from "@/components/atoms/Toast";
import { ContextIssue } from "@/components/molecules/ContextIssue";
import { MissingInfoIssue } from "@/components/molecules/MissingInfoIssue";
import { OptionalPanelBoundary } from "@/components/molecules/OptionalPanelBoundary";
import { WorkspacePane } from "@/components/organisms/WorkspacePane";
import type { ProofreadPanelHandle } from "@/components/organisms/ProofreadPanel";
import { DraftingIndicator } from "@/components/organisms/DraftingIndicator";
import { WorkflowTruth } from "@/components/organisms/WorkflowTruth";
import { useAuth } from "@/components/providers";
import { AUTH_SECTION_ID, PAYWALL_SECTION_ID } from "@/hooks/useDocument";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useExport } from "@/hooks/useExport";
import { useDeferredTour } from "@/hooks/useDeferredTour";
import { ACCEPT_ATTRIBUTE } from "@/hooks/useFileAttachment";
import { ensureApiConfigured } from "@/lib/api";
import { captureOwnerDispatch, ownerDispatchIsCurrent } from "@/lib/browser-principal-state";
import { attachOutcomeUpload } from "@/lib/api/outcomes";
import { signInHref } from "@/lib/auth-return";
import {
  currentWorkspaceCacheScope,
  loadPendingOutcome,
  loadWorkspace,
  savePendingOutcome,
  type PendingOutcome,
} from "@/lib/workspace-store";
import styles from "./WorkspaceScreen.module.css";
import type { InitialWorkspaceIntake, WorkspaceInitialState } from "@/lib/workspace-initial-state";
import { isWorkspaceSectionContentLoaded } from "@/lib/workspace-initial-state";

const GuidedTour = dynamic(
  () => import("@/components/organisms/GuidedTour").then((module) => module.GuidedTour),
  { ssr: false },
);

const ProofreadPanel = dynamic(
  () => import("@/components/organisms/ProofreadPanel").then((module) => module.ProofreadPanel),
  {
    ssr: false,
    loading: () => <p role="status">Loading proofread tools…</p>,
  },
);

const UploadAnalysisPanel = dynamic(
  () =>
    import("@/components/organisms/UploadAnalysisPanel").then(
      (module) => module.UploadAnalysisPanel,
    ),
  {
    ssr: false,
    loading: () => <p role="status">Loading upload options…</p>,
  },
);

const CapturedAdmission = dynamic(
  () =>
    import("@/components/organisms/CapturedAdmission").then((module) => module.CapturedAdmission),
  {
    ssr: false,
    loading: () => <p role="status">Loading the verified document contract…</p>,
  },
);

function uploadFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const message = String(
      (error.payload as { error?: { message?: unknown } })?.error?.message ?? "",
    ).trim();
    if (message) return message;
  }
  if (error instanceof Error) {
    if (error.message === "WORKSPACE_CACHE_OWNER_UNAVAILABLE") {
      return "TED could not confirm this workspace owner. Refresh the page and attach the file again.";
    }
    if (error.message === "OUTCOME_UPLOAD_BINDING_UNCONFIRMED") {
      return "TED read the file, but could not attach it to this saved outcome yet.";
    }
  }
  return "That file didn't upload. Try another, or continue without it.";
}

interface WorkspaceScreenProps {
  outcomeId: string;
  initialState?: WorkspaceInitialState | null;
}

type Phase = "deciding" | "gate" | "build";

function capturedOperationFromInitialState(
  initialState?: WorkspaceInitialState | null,
): CapturedDocumentOperationStatus | null {
  const workspace = initialState?.workspace;
  const truth = initialState?.truth;
  if (
    !workspace ||
    !truth ||
    truth.ledgerBindingStatus !== "captured" ||
    !truth.operationId ||
    truth.operationRevision === null ||
    !truth.operationStatus ||
    truth.operationStatus === "ready_for_review"
  ) {
    return null;
  }

  return {
    operation_id: truth.operationId,
    document_id: truth.documentId ?? workspace.documentId,
    operation_revision: truth.operationRevision,
    status: truth.operationStatus,
    retryable: truth.operationStatus === "retryable_failure",
    message: truth.operationMessage,
    safe_next_action: truth.safeNextAction,
  };
}

export function WorkspaceScreen({ outcomeId, initialState }: WorkspaceScreenProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [phase, setPhase] = useState<Phase>(() => (initialState?.workspace ? "build" : "deciding"));
  const [uploads, setUploads] = useState<string[]>([]);
  const [docName, setDocName] = useState("your document");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [admissionChecked, setAdmissionChecked] = useState(Boolean(initialState?.workspace));
  const [capturedTemplateId, setCapturedTemplateId] = useState<FirstCapturedTemplateId | null>(
    null,
  );
  const [legacyFallback, setLegacyFallback] = useState(false);
  const [durableIntakeOverride, setDurableIntakeOverride] = useState<InitialWorkspaceIntake | null>(
    null,
  );
  const [retryingInitialState, startInitialStateRetry] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const initialStateUnavailable = initialState?.truth.persistence === "unavailable";
  const persistedCapturedTemplateId = initialState?.workspace
    ? resolveFirstCapturedTemplateId(initialState.workspace.templateId)
    : null;
  const persistedCapturedOperation = capturedOperationFromInitialState(initialState);
  const initialOwnerId = initialState?.truth.ownerUserId ?? null;
  const ownerMismatch = Boolean(
    initialState?.truth.authenticated &&
    (!initialOwnerId || !user?.id || user.id !== initialOwnerId),
  );
  const cacheScope = useMemo(
    () =>
      user?.id
        ? currentWorkspaceCacheScope(user.id)
        : initialState?.truth.authenticated
          ? null
          : currentWorkspaceCacheScope(),
    [initialState?.truth.authenticated, user?.id],
  );

  useEffect(() => {
    if (!authLoading && ownerMismatch) router.refresh();
  }, [authLoading, ownerMismatch, router]);

  useEffect(() => {
    if (authLoading || ownerMismatch || initialStateUnavailable) return;
    if (initialState?.workspace) {
      setAdmissionChecked(true);
      return;
    }
    const intake = initialState?.intake;
    const pending: PendingOutcome | null = intake
      ? {
          situation: intake.situation,
          templateName: intake.templateName,
          templateId: intake.templateId ?? undefined,
          conversationContext: intake.conversationContext,
          uploadContext: intake.uploadContext,
          uploadId: intake.uploadId ?? undefined,
        }
      : cacheScope
        ? loadPendingOutcome(cacheScope, outcomeId)
        : null;
    const cached =
      initialState?.truth.authenticated || !cacheScope
        ? null
        : loadWorkspace(cacheScope, outcomeId);
    const alreadyGenerated = Boolean(cached?.generated);
    const hint = `${pending?.templateName ?? ""} ${pending?.templateId ?? ""} ${pending?.situation ?? ""}`;
    const resolvedCapturedTemplate = resolveFirstCapturedTemplateId(pending?.templateId);
    const suggested =
      pending && !pending.uploadId && !alreadyGenerated && !resolvedCapturedTemplate
        ? suggestedUploadsForDocument(hint)
        : [];
    setDocName(pending?.templateName || "your document");
    setUploads(suggested);
    setCapturedTemplateId(resolvedCapturedTemplate);
    setAdmissionChecked(true);
    setPhase(suggested.length > 0 ? "gate" : "build");
  }, [
    authLoading,
    cacheScope,
    initialState?.intake,
    initialState?.truth.authenticated,
    initialState?.workspace,
    initialStateUnavailable,
    outcomeId,
    ownerMismatch,
  ]);

  const pickFile = useCallback(() => fileRef.current?.click(), []);

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const preflight = preflightUploadMetadata({
        fileName: file.name,
        mimeType: file.type,
        byteLength: file.size,
      });
      if (!preflight.ok) {
        setError(preflight.message);
        return;
      }
      if (!user?.id) {
        setError("Sign in again before attaching a source document.");
        return;
      }
      const requestContext = captureOwnerDispatch(user.id);
      setBusy(true);
      setError(null);
      try {
        ensureApiConfigured();
        if (!cacheScope) throw new Error("WORKSPACE_CACHE_OWNER_UNAVAILABLE");
        const pending = initialState?.intake
          ? {
              situation: initialState.intake.situation,
              templateName: initialState.intake.templateName,
              templateId: initialState.intake.templateId ?? undefined,
              conversationContext: initialState.intake.conversationContext,
              uploadContext: initialState.intake.uploadContext,
              uploadId: initialState.intake.uploadId ?? undefined,
            }
          : loadPendingOutcome(cacheScope, outcomeId);
        const result = await ingestUpload(file, pending?.situation ?? "", requestContext);
        requestContext.assertCurrent();

        const merged = result.extracted_text.trim();
        const fallbackPending: PendingOutcome = {
          situation: pending?.situation ?? "",
          templateName: pending?.templateName ?? docName,
          templateId: pending?.templateId,
          conversationContext: pending?.conversationContext ?? "",
          uploadContext: merged,
          uploadId: result.upload_id,
          conversation: pending?.conversation,
          alternateFormats: pending?.alternateFormats,
        };
        savePendingOutcome(cacheScope, outcomeId, fallbackPending);
        setDurableIntakeOverride({
          outcomeId,
          situation: fallbackPending.situation,
          templateName: fallbackPending.templateName,
          templateId: fallbackPending.templateId ?? null,
          conversationContext: fallbackPending.conversationContext ?? "",
          uploadContext: merged,
          uploadId: result.upload_id,
        });

        let durableAttachFailed = false;
        if (user.id) {
          try {
            const attached = await attachOutcomeUpload(outcomeId, result.upload_id, requestContext);
            requestContext.assertCurrent();
            setDurableIntakeOverride({
              outcomeId: attached.outcomeId,
              situation: attached.situation,
              templateName: attached.templateName,
              templateId: attached.templateId,
              conversationContext: attached.conversationContext,
              uploadContext: attached.uploadContext,
              uploadId: attached.uploadId,
            });
            router.refresh();
          } catch {
            durableAttachFailed = true;
          }
        }

        requestContext.assertCurrent();
        setUploadedNames([file.name]);
        setError(
          durableAttachFailed
            ? "TED read the file and will use it for this draft, but could not save the attachment link to your account yet. Build now, then save the workspace after generation."
            : null,
        );
      } catch (caught) {
        if (ownerDispatchIsCurrent(requestContext)) {
          setError(uploadFailureMessage(caught));
        }
      } finally {
        if (ownerDispatchIsCurrent(requestContext)) setBusy(false);
      }
    },
    [cacheScope, docName, initialState?.intake, outcomeId, router, user?.id],
  );

  const effectiveInitialState = useMemo<WorkspaceInitialState | null | undefined>(
    () =>
      durableIntakeOverride && initialState
        ? { ...initialState, intake: durableIntakeOverride }
        : initialState,
    [durableIntakeOverride, initialState],
  );

  if (authLoading && initialState?.truth.authenticated) {
    return (
      <div className={styles.loading}>
        <Spinner label="Confirming your workspace session" size="md" />
      </div>
    );
  }

  if (ownerMismatch) {
    return (
      <div className={styles.loading}>
        <Spinner label="Refreshing for the signed-in account" size="md" />
      </div>
    );
  }

  if (initialStateUnavailable) {
    return (
      <div className={styles.screen}>
        <header className={styles.head}>
          <div className={styles.brandLockup}>
            <p className={styles.subtitle}>PrompTED workspace</p>
          </div>
        </header>
        <div className={styles.body}>
          <div className={styles.loading}>
            <section aria-labelledby="workspace-unavailable-title">
              <h1 id="workspace-unavailable-title">
                Your saved workspace is temporarily unavailable
              </h1>
              <p role="status" aria-live="polite">
                {retryingInitialState
                  ? "PrompTED is checking your saved workspace again…"
                  : "PrompTED couldn’t confirm the latest saved version. This page has not loaded a device copy or started new work."}
              </p>
              <button
                type="button"
                className={styles.globalPrimary}
                disabled={retryingInitialState}
                onClick={() => {
                  startInitialStateRetry(() => router.refresh());
                }}
              >
                {retryingInitialState ? "Checking again…" : "Try again"}
              </button>
            </section>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "deciding") {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading your workspace" size="md" />
      </div>
    );
  }

  if (!admissionChecked) {
    return (
      <div className={styles.loading}>
        <Spinner label="Checking document contract" size="md" />
      </div>
    );
  }

  if (phase === "gate") {
    return (
      <OptionalPanelBoundary label="Upload suggestions" onClose={() => setPhase("build")}>
        <UploadAnalysisPanel
          documentName={docName}
          uploads={uploads}
          uploadedNames={uploadedNames}
          busy={busy}
          error={error}
          onUpload={pickFile}
          onBuild={() => setPhase("build")}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            onChange={onFile}
            hidden
            tabIndex={-1}
            aria-hidden="true"
          />
        </UploadAnalysisPanel>
      </OptionalPanelBoundary>
    );
  }

  if (
    !user?.id &&
    !legacyFallback &&
    ((initialState?.workspace && persistedCapturedTemplateId && persistedCapturedOperation) ||
      (!initialState?.workspace && capturedTemplateId))
  ) {
    return (
      <div className={styles.loading}>
        <ContextIssue
          title="Sign in to create this document"
          message="PrompTED binds confirmed facts and every generated revision to one account before TED starts."
          actionLabel="Sign in"
          href={signInHref(`/outcomes/${outcomeId}`)}
        />
      </div>
    );
  }

  if (
    user?.id &&
    !legacyFallback &&
    initialState?.workspace &&
    persistedCapturedTemplateId &&
    persistedCapturedOperation
  ) {
    return (
      <CapturedAdmission
        key={`${user.id}:${outcomeId}:${persistedCapturedTemplateId}:${persistedCapturedOperation.operation_id}:${persistedCapturedOperation.document_id}:${persistedCapturedOperation.operation_revision}`}
        ownerUserId={user.id}
        outcomeId={outcomeId}
        templateId={persistedCapturedTemplateId}
        title={initialState.workspace.title}
        initialOperation={persistedCapturedOperation}
        onLegacyFallback={() => undefined}
        onOpenPersistedWorkspace={() => setLegacyFallback(true)}
      />
    );
  }

  if (user?.id && !initialState?.workspace && capturedTemplateId && !legacyFallback) {
    return (
      <CapturedAdmission
        key={`${user.id}:${outcomeId}:${capturedTemplateId}:new`}
        ownerUserId={user.id}
        outcomeId={outcomeId}
        templateId={capturedTemplateId}
        title={docName}
        onLegacyFallback={() => setLegacyFallback(true)}
      />
    );
  }

  return <WorkspaceLoaded outcomeId={outcomeId} initialState={effectiveInitialState} />;
}

function WorkspaceLoaded({
  outcomeId,
  initialState,
}: {
  outcomeId: string;
  initialState?: WorkspaceInitialState | null;
}) {
  const workspace = useWorkspace(outcomeId, initialState);
  const { user } = useAuth();
  const { showToast } = useToast();
  const exporter = useExport();
  const [, setProofreadResults] = useState<ProofreadSectionResult[] | null>(null);
  const [proofreadStarted, setProofreadStarted] = useState(false);
  const [lastCapturedExportDelivery, setLastCapturedExportDelivery] = useState<{
    exportId: string;
    operationId: string;
    documentRevision: number;
  } | null>(null);
  const proofreadPanelRef = useRef<ProofreadPanelHandle | null>(null);
  const { active, start: startTour, next, prev, skip, steps } = useDeferredTour();
  const activeSection = workspace.activeSection;
  const activeQuestion = workspace.selectedPlaceholderId
    ? workspace.missingInfoQuestions.find(
        (question) => question.placeholderId === workspace.selectedPlaceholderId,
      )
    : null;
  const captured = workspace.captured;

  const handleExport = useCallback(
    async (format: DocumentExportFormat) => {
      if (!workspace.documentId || workspace.syncStatus !== "saved") {
        showToast({
          tone: "info",
          message: "Save and approve the exact current wording before exporting.",
        });
        return;
      }
      if (workspace.placeholderExportDecision.status === "acknowledgement_required") {
        const count = workspace.placeholderExportDecision.requiredForExport;
        showToast({
          tone: "info",
          message: `Answer ${count} required detail${count === 1 ? "" : "s"} before exporting.`,
        });
        return;
      }
      if (workspace.placeholderExportDecision.status === "warn") {
        showToast({
          tone: "info",
          message: `Exporting with ${workspace.placeholderExportDecision.total} unresolved optional placeholder${workspace.placeholderExportDecision.total === 1 ? "" : "s"}.`,
        });
      }

      let requestContext;
      try {
        if (!user?.id) throw new Error("AUTH_REQUIRED");
        requestContext = captureOwnerDispatch(user.id);
        if (captured) {
          if (format !== "pdf") {
            showToast({
              tone: "info",
              message: "This cohort currently exports captured documents as PDF.",
            });
            return;
          }
          const request = await workspace.requestCapturedExport("pdf", requestContext);
          if (!request) {
            showToast({
              tone: "info",
              message: "Approve the exact current revision before exporting.",
            });
            return;
          }
          let delivery = request;
          const needsFreshDelivery =
            !request.exportReady || !request.exportId || !request.downloadUrl;
          if (needsFreshDelivery && request.exportId) {
            const refreshed = workspace.createUpdatedCapturedExport("pdf", request.exportId);
            if (!refreshed && ownerDispatchIsCurrent(requestContext)) {
              showToast({
                tone: "info",
                message: "The revision-bound export is being prepared. Try PDF export again shortly.",
              });
            }
            return;
          }
          if (!delivery.exportId || !delivery.downloadUrl) {
            showToast({
              tone: "info",
              message: "The revision-bound export is being prepared. Try PDF export again shortly.",
            });
            return;
          }
          setLastCapturedExportDelivery({
            exportId: delivery.exportId,
            operationId: delivery.operationId,
            documentRevision: delivery.documentRevision,
          });
          if (
            !workspace.rememberCapturedExportDelivery("pdf", delivery.exportId)
          ) {
            showToast({
              tone: "info",
              message:
                "The browser prepared an export for an older revision. Approve the latest wording and export again.",
            });
            return;
          }
          window.open(delivery.downloadUrl, "_blank", "noopener,noreferrer");
          workspace.markExported();
          showToast({
            tone: "success",
            message: "Sent to your browser. Check downloads or the new tab.",
          });
          return;
        }
        const delivery = await exporter.exportDocument(format, requestContext);
        if (
          delivery.format === "pdf" &&
          !workspace.rememberCapturedExportDelivery("pdf", delivery.exportId)
        ) {
          showToast({
            tone: "info",
            message: "The current export receipt could not be verified. Export again after the save finishes.",
          });
          return;
        }
        window.open(delivery.downloadUrl, "_blank", "noopener,noreferrer");
        workspace.markExported();
        showToast({
          tone: "success",
          message: "Sent to your browser. Check downloads or the new tab.",
        });
      } catch {
        if (requestContext && !ownerDispatchIsCurrent(requestContext)) return;
        showToast({ tone: "error", message: "Export failed. Try again." });
      }
    },
    [captured, exporter, showToast, user?.id, workspace],
  );

  const handleApproveDocument = useCallback(async () => {
    const approved = await workspace.approveDocument();
    showToast({
      tone: approved ? "success" : "info",
      message: approved
        ? "Approved this exact revision. Export is unlocked."
        : "Load every section and save the latest wording before approving.",
    });
  }, [showToast, workspace]);

  const handleApproveAllVisible = useCallback(() => {
    const skipped = workspace.sections.filter(
      (section) => section.id !== AUTH_SECTION_ID && isVisiblyEmpty(section.content),
    );
    const notLoaded = workspace.sections.filter(
      (section) => section.id !== AUTH_SECTION_ID && !isWorkspaceSectionContentLoaded(section),
    );
    workspace.sections
      .filter(
        (section) =>
          section.id !== AUTH_SECTION_ID &&
          isWorkspaceSectionContentLoaded(section) &&
          !isVisiblyEmpty(section.content),
      )
      .forEach((section) => workspace.section.approve(section.id));
    showToast({
      tone: skipped.length || notLoaded.length ? "info" : "success",
      message:
        skipped.length || notLoaded.length
          ? "Approved loaded sections with wording. Empty or unloaded sections were left unchanged."
          : "Approved all visible sections.",
    });
  }, [showToast, workspace]);

  const handleMissingInfoAnswer = useCallback(
    async (answer: string) => {
      if (!activeQuestion) return;
      await workspace.answerMissingInfo(activeQuestion, answer);
    },
    [activeQuestion, workspace],
  );

  const downloadLabel = lastCapturedExportDelivery
    ? `Last PDF export matched revision ${lastCapturedExportDelivery.documentRevision}`
    : null;

  return (
    <div className={styles.screen} data-tour-active={active ? "true" : undefined}>
      <header className={styles.head} data-tour="workspace-header">
        <div className={styles.brandLockup}>
          <p className={styles.subtitle}>PrompTED workspace</p>
          <h1>{workspace.title}</h1>
          <p>{workspace.situation}</p>
          {downloadLabel && (
            <span className={styles.syncPill} data-status="saved">
              {downloadLabel}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={startTour}>
            Walk me through
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={handleApproveAllVisible}
            disabled={workspace.drafting || workspace.loading}
          >
            Approve visible
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void handleApproveDocument()}
            disabled={workspace.drafting || workspace.loading || !workspace.canExport}
          >
            Approve document
          </button>
          <button
            type="button"
            className={styles.export}
            onClick={() => void handleExport("pdf")}
            disabled={!workspace.canExport || workspace.syncStatus !== "saved"}
          >
            Export PDF
          </button>
          <button
            type="button"
            className={styles.export}
            onClick={() => void handleExport("docx")}
            disabled={!workspace.canExport || workspace.syncStatus !== "saved" || captured}
          >
            Export DOCX
          </button>
        </div>
      </header>

      <WorkflowTruth
        syncStatus={workspace.syncStatus}
        canExport={workspace.canExport}
        captured={workspace.captured}
        currentRevision={workspace.currentRevision}
        approvedRevision={workspace.approvedRevision}
        operationRevision={workspace.operationRevision}
        placeholderDecision={workspace.placeholderExportDecision.status}
        onRetrySync={workspace.retrySync}
      />
      {workspace.generationIssues.length > 0 && (
        <section className={styles.issuePanel} aria-label="Document generation issues">
          <h2>Needs attention</h2>
          <ul>
            {workspace.generationIssues.map((issue) => (
              <li key={issue.sectionId}>
                <strong>{issue.sectionName}</strong>
                <span>{issue.reason}</span>
                <button
                  type="button"
                  onClick={() => void workspace.retryGenerationSection(issue.sectionId)}
                  disabled={workspace.regeneratingSectionId === issue.sectionId}
                >
                  {workspace.regeneratingSectionId === issue.sectionId ? "Retrying…" : "Retry section"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {workspace.missingInfoQuestions.length > 0 && (
        <section className={styles.missingPanel} aria-label="Missing information">
          <h2>Details TED needs</h2>
          <p>
            Answer these only where you know the fact. TED will not invent them.
          </p>
          <ul>
            {workspace.missingInfoQuestions.slice(0, 6).map((question) => (
              <li key={question.placeholderId}>
                <button
                  type="button"
                  onClick={() => workspace.selectMissingPlaceholder(question.placeholderId)}
                  data-selected={workspace.selectedPlaceholderId === question.placeholderId}
                >
                  <strong>{question.label}</strong>
                  <span>{question.sectionLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DraftingIndicator active={workspace.drafting || workspace.loading} />
      <div className={styles.body}>
        {workspace.loading ? (
          <div className={styles.loading}>
            <Spinner label="Loading your workspace" size="md" />
          </div>
        ) : (
          <>
            <WorkspacePane
              title={workspace.title}
              situation={workspace.situation}
              sections={workspace.sections}
              activeSectionId={workspace.activeSectionId}
              onSelectSection={workspace.selectSection}
              onUpdateSection={workspace.section.update}
              onApproveSection={workspace.section.approve}
              onRejectSection={workspace.section.reject}
              onDeleteSection={workspace.section.remove}
              onAddSection={workspace.section.add}
              onMoveSection={workspace.reorder.moveSection}
              syncStatus={workspace.syncStatus}
              approval={workspace.approval}
              canExport={workspace.canExport}
              activePlaceholderId={workspace.selectedPlaceholderId}
              onLoadFullPreview={workspace.loadFullPreview}
            />
            <aside className={styles.side} data-tour="proofread">
              <section className={styles.card}>
                <h2>Proofread</h2>
                <p>
                  Check clarity, tone and missing details before you export.
                </p>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={!activeSection || isVisiblyEmpty(activeSection.content)}
                  onClick={() => {
                    setProofreadStarted(true);
                    proofreadPanelRef.current?.start();
                  }}
                >
                  Proofread active section
                </button>
                {activeSection && proofreadStarted && (
                  <ProofreadPanel
                    ref={proofreadPanelRef}
                    section={activeSection}
                    onResults={(results) => setProofreadResults(results)}
                  />
                )}
              </section>
              <section className={styles.card}>
                <h2>Missing details</h2>
                {activeQuestion ? (
                  <MissingInfoIssue
                    issue={activeQuestion}
                    busy={workspace.answeringMissingInfo}
                    onAnswer={handleMissingInfoAnswer}
                    onDismiss={() => workspace.dismissMissingInfo(activeQuestion)}
                    onNeutralReplacement={(option) =>
                      void workspace.applyNeutralReplacement(activeQuestion, option)
                    }
                  />
                ) : workspace.missingInfoQuestions.length > 0 ? (
                  <p>Select a missing detail above to answer it.</p>
                ) : (
                  <p>No required clarification is blocking this draft.</p>
                )}
              </section>
              <section className={styles.card}>
                <h2>Document truth</h2>
                <p>{workspace.approval.approved} of {workspace.approval.total} sections approved.</p>
                <p>
                  Status: <strong>{workspace.status}</strong>
                </p>
                <p>
                  Save: <strong>{workspace.syncStatus}</strong>
                </p>
                {workspace.syncStatus === "failed" && (
                  <button type="button" className={styles.secondary} onClick={workspace.retrySync}>
                    Retry save
                  </button>
                )}
              </section>
            </aside>
          </>
        )}
      </div>
      <GuidedTour active={active} step={steps[0]} onNext={next} onPrev={prev} onSkip={skip} />
      {workspace.syncStatus !== "saved" && (
        <div className={styles.saveNotice} role="status" aria-live="polite">
          <span>
            {workspace.syncStatus === "saving"
              ? "Saving…"
              : workspace.syncStatus === "failed"
                ? "Save failed. Your browser still has the current draft."
                : workspace.syncStatus === "local_only"
                  ? "Saved on this device. Sign in keeps it across devices."
                  : "Ready"}
          </span>
          {workspace.syncStatus === "failed" && (
            <button type="button" onClick={workspace.retrySync}>
              Retry
            </button>
          )}
          {workspace.syncStatus === "saved" && (
            <button type="button" onClick={() => {
              if (workspace.syncStatus === "failed") workspace.retrySync();
              else showToast({ tone: "success", message: "Your latest changes are saved." });
            }}>
              Saved
            </button>
          )}
        </div>
      )}
    </div>
  );
}
