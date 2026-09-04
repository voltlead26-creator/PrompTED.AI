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
          requestContext.assertCurrent();
          router.refresh();
        } catch {
          durableAttachFailed = true;
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
  const showTour = useDeferredTour("workspace-v2");
  const proofreadRef = useRef<ProofreadPanelHandle>(null);

  async function handleExport(format: DocumentExportFormat) {
    if (!workspace.documentId || workspace.syncStatus !== "saved") {
      showToast({
        tone: "info",
        message: "Save and approve the exact current revision before exporting.",
      });
      return;
    }
    const approvedRevision = workspace.currentRevision;
    if (!workspace.canExport || !user?.id || approvedRevision === null) return;

    let placeholderAcknowledged = false;
    if (workspace.placeholderExportDecision.status === "acknowledgement_required") {
      placeholderAcknowledged = window.confirm(
        `This document still has ${workspace.placeholderExportDecision.requiredForExport} required missing detail(s). Export anyway with those placeholders visible?`,
      );
      if (!placeholderAcknowledged) return;
    } else if (workspace.placeholderExportDecision.status === "warn") {
      showToast({
        tone: "info",
        message: `Exporting with ${workspace.placeholderExportDecision.total} unresolved optional detail(s) visible.`,
      });
    }

    let capturedExport:
      { exportId: string; operationId: string; expectedOperationRevision: number } | undefined;
    const requestContext = captureOwnerDispatch(user.id);
    if (workspace.captured) {
      if (format !== "pdf") {
        showToast({
          tone: "info",
          message: "This cohort currently exports inspected PDF artifacts only.",
        });
        return;
      }
      try {
        const request = await workspace.requestCapturedExport("pdf", requestContext);
        if (!request) {
          showToast({
            tone: "info",
            message: "Approve the exact current revision before exporting.",
          });
          return;
        }
        capturedExport = {
          exportId: request.export_id,
          operationId: request.operation_id,
          expectedOperationRevision: request.operation_revision,
        };
      } catch {
        if (ownerDispatchIsCurrent(requestContext)) {
          showToast({
            tone: "info",
            message: "The revision-bound export request could not be recorded yet.",
          });
        }
        return;
      }
    }

    const delivery = await exporter.run(
      {
        documentId: workspace.documentId,
        title: workspace.title,
        format,
        sections: workspace.sections,
        unresolvedPlaceholders: workspace.unresolvedPlaceholders,
        placeholderAcknowledged,
        capturedExport,
      },
      requestContext,
    );
    if (delivery && ownerDispatchIsCurrent(requestContext)) {
      if (workspace.captured && capturedExport) {
        if (
          delivery.capturedExportId !== capturedExport.exportId ||
          !workspace.rememberCapturedExportDelivery("pdf", capturedExport.exportId)
        ) {
          showToast({
            tone: "info",
            message:
              "The browser received an artifact, but its durable export receipt was not retained.",
          });
          return;
        }
        setLastCapturedExportDelivery({
          exportId: capturedExport.exportId,
          operationId: capturedExport.operationId,
          documentRevision: approvedRevision,
        });
      } else {
        workspace.markExported();
      }
      showToast({
        tone: "success",
        message: "Sent to your browser. Check your Downloads folder.",
      });
    }
  }

  async function handleCreateUpdatedCapturedExport() {
    const delivery = lastCapturedExportDelivery;
    if (
      !delivery ||
      delivery.operationId !== workspace.operationId ||
      delivery.documentRevision !== workspace.currentRevision ||
      !workspace.createUpdatedCapturedExport("pdf", delivery.exportId)
    ) {
      showToast({
        tone: "info",
        message: "The current export receipt changed. Export the approved revision again.",
      });
      setLastCapturedExportDelivery(null);
      return;
    }
    setLastCapturedExportDelivery(null);
    await handleExport("pdf");
  }

  const hasCurrentCapturedDelivery = Boolean(
    lastCapturedExportDelivery &&
    lastCapturedExportDelivery.operationId === workspace.operationId &&
    lastCapturedExportDelivery.documentRevision === workspace.currentRevision,
  );

  if (workspace.loading) {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading your workspace" size="md" />
      </div>
    );
  }

  const authIssue = workspace.generationIssues.find((issue) => issue.sectionId === AUTH_SECTION_ID);
  const paywallIssue = workspace.generationIssues.find(
    (issue) => issue.sectionId === PAYWALL_SECTION_ID,
  );
  const activeIssue = workspace.generationIssues.find(
    (issue) => issue.sectionId === workspace.activeSectionId,
  );
  const activeMissingInfo =
    workspace.missingInfoQuestions.find(
      (question) => question.placeholderId === workspace.selectedPlaceholderId,
    ) ??
    workspace.missingInfoQuestions.find(
      (question) => question.sectionId === workspace.activeSectionId,
    ) ??
    workspace.missingInfoQuestions[0];
  const saveLabel =
    workspace.syncStatus === "saving"
      ? "Saving…"
      : workspace.syncStatus === "saved"
        ? "Saved"
        : "Save";

  async function approveAll() {
    if (workspace.captured) {
      const approved = await workspace.approveDocument();
      showToast({
        tone: approved ? "success" : "info",
        message: approved
          ? "The exact current document revision is approved."
          : "PrompTED could not approve this revision. Check save state and required wording.",
      });
      return;
    }
    const skipped: string[] = [];
    const notLoaded: string[] = [];
    for (const section of workspace.sections) {
      if (section.status === "approved") continue;
      if (!isWorkspaceSectionContentLoaded(section)) {
        notLoaded.push(section.name);
        continue;
      }
      if (isVisiblyEmpty(section.content)) {
        skipped.push(section.name);
        continue;
      }
      workspace.section.approve(section.id);
    }
    showToast({
      tone: skipped.length || notLoaded.length ? "info" : "success",
      message:
        skipped.length || notLoaded.length
          ? [
              "Approved the sections currently ready for review.",
              skipped.length ? `Still needs wording: ${skipped.join(", ")}.` : "",
              notLoaded.length
                ? `Saved sections still need to be opened and reviewed: ${notLoaded.join(", ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : "All sections approved.",
    });
  }

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.brandLockup}>
          <p className={styles.subtitle}>{workspace.title}</p>
          <WorkflowTruth
            initialTruth={initialState?.truth}
            syncStatus={workspace.syncStatus}
            currentRevision={workspace.currentRevision}
            approvedRevision={workspace.approvedRevision}
            operationRevision={workspace.operationRevision}
          />
        </div>
        <div className={styles.headerActions} aria-label="Document actions">
          {authIssue && !user?.id && (
            <ContextIssue
              title="Sign in to continue"
              message="Your work is safe. Sign in and PrompTED will return to this document."
              actionLabel="Sign in"
              href={signInHref(`/outcomes/${outcomeId}`)}
            />
          )}
          {paywallIssue && (
            <ContextIssue
              title="Document credits used"
              message="You can still read, edit and export this document. Update your plan only when you need another document."
              actionLabel="View plans"
              href="/settings/account"
            />
          )}
          {workspace.syncStatus === "failed" && (
            <ContextIssue
              label="Save problem"
              title="This version is saved on this device"
              message="PrompTED could not sync it to your account yet. Try saving again."
              actionLabel="Try saving again"
              onAction={workspace.retrySync}
            />
          )}
          {activeIssue && (
            <ContextIssue
              title={`${activeIssue.sectionName} needs attention`}
              message="TED could not finish this section. Your existing wording has not been replaced."
              actionLabel="Try this section again"
              onAction={() => void workspace.retryGenerationSection(activeIssue.sectionId)}
              busy={workspace.regeneratingSectionId === activeIssue.sectionId}
            />
          )}
          {activeMissingInfo && (
            <MissingInfoIssue
              question={activeMissingInfo}
              busy={workspace.answeringMissingInfo}
              onAnswer={(question, answer) => void workspace.answerMissingInfo(question, answer)}
              onDismiss={workspace.dismissMissingInfo}
              onNeutralReplacement={(question, option) =>
                void workspace.applyNeutralReplacement(question, option)
              }
              autoOpen={workspace.selectedPlaceholderId === activeMissingInfo.placeholderId}
            />
          )}
          <button
            type="button"
            className={styles.globalAction}
            onClick={() => void approveAll()}
            disabled={workspace.approving}
          >
            {workspace.approving
              ? "Approving…"
              : workspace.captured
                ? "Approve revision"
                : "Approve all"}
          </button>
          <button
            type="button"
            className={styles.globalAction}
            disabled={workspace.syncStatus === "saving"}
            onClick={() => {
              if (workspace.syncStatus === "failed") workspace.retrySync();
              else showToast({ tone: "success", message: "Your latest changes are saved." });
            }}
          >
            {saveLabel}
          </button>
          <button
            type="button"
            className={styles.globalPrimary}
            onClick={() => {
              if (proofreadStarted) proofreadRef.current?.scan();
              else setProofreadStarted(true);
            }}
          >
            Proofread
          </button>
        </div>
      </header>

      {showTour ? (
        <OptionalPanelBoundary label="Guided tour">
          <GuidedTour
            tourId="workspace-v2"
            steps={[
              {
                anchor: "ws-sections",
                title: "Move through your document",
                body: "Choose a section or use the arrows. On a phone, tap the page to open the focused editor.",
              },
              {
                anchor: "ws-editor",
                title: "Edit without losing control",
                body: "Use Expand, Shorten or tEdit at the bottom. TED always shows a suggestion before applying it.",
              },
              {
                anchor: "ws-export",
                title: "Finish when you are ready",
                body: "Export and other occasional options are kept in the document menu.",
              },
            ]}
          />
        </OptionalPanelBoundary>
      ) : null}

      <DraftingIndicator
        active={workspace.drafting}
        label={
          workspace.regeneratingSectionId
            ? "TED is redrafting this section"
            : "TED is drafting your document"
        }
      />

      <div className={`${styles.body}${proofreadStarted ? ` ${styles.bodyWithProofread}` : ""}`}>
        {proofreadStarted && (
          <OptionalPanelBoundary label="Proofread tools" onClose={() => setProofreadStarted(false)}>
            <ProofreadPanel
              ref={proofreadRef}
              sections={workspace.sections}
              activeSectionId={workspace.activeSectionId}
              onApply={(sectionId, next) => workspace.section.editContent(sectionId, next)}
              onResultsChange={setProofreadResults}
              autoScan
            />
          </OptionalPanelBoundary>
        )}
        <div className={styles.center}>
          <WorkspacePane
            workspace={workspace}
            exporting={exporter.exporting}
            exportError={exporter.error}
            onExport={handleExport}
            allowedFormats={workspace.captured ? ["pdf"] : undefined}
            capturedExportDelivered={hasCurrentCapturedDelivery}
            onCreateUpdatedExport={
              workspace.captured ? handleCreateUpdatedCapturedExport : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
