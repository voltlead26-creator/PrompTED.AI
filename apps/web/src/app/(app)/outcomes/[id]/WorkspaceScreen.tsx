"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import dynamic from "next/dynamic";
import {
  ingestUpload,
  type DocumentExportFormat,
  type ProofreadSectionResult,
} from "@prompted/shared/api-client";
import {
  resolveFirstCapturedTemplateId,
  type FirstCapturedTemplateId,
} from "@prompted/shared/document-operation";
import { suggestedUploadsForDocument } from "@prompted/shared/suggested-uploads";
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
import { signInHref } from "@/lib/auth-return";
import {
  loadPendingOutcome,
  loadWorkspace,
  savePendingOutcome,
} from "@/lib/workspace-store";
import styles from "./WorkspaceScreen.module.css";
import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";

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
    import("@/components/organisms/CapturedAdmission").then(
      (module) => module.CapturedAdmission,
    ),
  {
    ssr: false,
    loading: () => <p role="status">Loading the verified document contract…</p>,
  },
);

interface WorkspaceScreenProps {
  outcomeId: string;
  initialState?: WorkspaceInitialState | null;
}

type Phase = "deciding" | "gate" | "build";

export function WorkspaceScreen({ outcomeId, initialState }: WorkspaceScreenProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialState?.workspace ? "build" : "deciding",
  );
  const [uploads, setUploads] = useState<string[]>([]);
  const [docName, setDocName] = useState("your document");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [admissionChecked, setAdmissionChecked] = useState(
    Boolean(initialState?.workspace),
  );
  const [capturedTemplateId, setCapturedTemplateId] =
    useState<FirstCapturedTemplateId | null>(null);
  const [legacyFallback, setLegacyFallback] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialState?.workspace) {
      setAdmissionChecked(true);
      return;
    }
    const pending = loadPendingOutcome(outcomeId);
    const cached = loadWorkspace(outcomeId);
    const alreadyGenerated = Boolean(cached?.generated);
    const hint = `${pending?.templateName ?? ""} ${pending?.templateId ?? ""} ${pending?.situation ?? ""}`;
    const suggested = pending && !alreadyGenerated ? suggestedUploadsForDocument(hint) : [];
    setDocName(pending?.templateName || "your document");
    setUploads(suggested);
    setCapturedTemplateId(resolveFirstCapturedTemplateId(pending?.templateId));
    setAdmissionChecked(true);
    setPhase(suggested.length > 0 ? "gate" : "build");
  }, [initialState?.workspace, outcomeId]);

  const pickFile = useCallback(() => fileRef.current?.click(), []);

  const onFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      ensureApiConfigured();
      const pending = loadPendingOutcome(outcomeId);
      const result = await ingestUpload(file, pending?.situation ?? "");
      const merged = [pending?.uploadContext ?? "", result.extracted_text]
        .filter((value) => value && value.trim())
        .join("\n\n");
      if (pending) savePendingOutcome(outcomeId, { ...pending, uploadContext: merged });
      setUploadedNames((names) => [...names, file.name]);
    } catch {
      setError("That file didn't upload. Try another, or continue without it.");
    } finally {
      setBusy(false);
    }
  }, [outcomeId]);

  if (phase === "deciding") {
    return <div className={styles.loading}><Spinner label="Loading your workspace" size="md" /></div>;
  }

  if (!admissionChecked) {
    return <div className={styles.loading}><Spinner label="Checking document contract" size="md" /></div>;
  }

  if (phase === "gate") {
    return (
      <OptionalPanelBoundary
        label="Upload suggestions"
        onClose={() => setPhase("build")}
      >
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

  if (!initialState?.workspace && capturedTemplateId && !legacyFallback) {
    return (
      <CapturedAdmission
        outcomeId={outcomeId}
        templateId={capturedTemplateId}
        title={docName}
        onLegacyFallback={() => setLegacyFallback(true)}
      />
    );
  }

  return <WorkspaceLoaded outcomeId={outcomeId} initialState={initialState} />;
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
  const showTour = useDeferredTour("workspace-v2");
  const proofreadRef = useRef<ProofreadPanelHandle>(null);

  async function handleExport(format: DocumentExportFormat) {
    if (!workspace.canExport) return;

    let placeholderAcknowledged = false;
    if (workspace.placeholderExportDecision.status === "acknowledgement_required") {
      placeholderAcknowledged = window.confirm(
        `This document still has ${workspace.placeholderExportDecision.requiredForExport} required missing detail(s). Export anyway with those placeholders visible?`,
      );
      if (!placeholderAcknowledged) return;
    } else if (workspace.placeholderExportDecision.status === "warn") {
      showToast({
        tone: "info",
        message:
          `Exporting with ${workspace.placeholderExportDecision.total} unresolved optional detail(s) visible.`,
      });
    }

    let capturedExport:
      | { exportId: string; operationId: string; expectedOperationRevision: number }
      | undefined;
    if (workspace.captured) {
      if (format !== "pdf") {
        showToast({
          tone: "info",
          message: "This cohort currently exports inspected PDF artifacts only.",
        });
        return;
      }
      try {
        const request = await workspace.requestCapturedExport("pdf");
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
        showToast({
          tone: "info",
          message: "The revision-bound export request could not be recorded yet.",
        });
        return;
      }
    }

    const ok = await exporter.run({
      documentId: workspace.documentId ?? undefined,
      title: workspace.title,
      format,
      sections: workspace.sections,
      lede: workspace.situation,
      unresolvedPlaceholders: workspace.unresolvedPlaceholders,
      placeholderAcknowledged,
      capturedExport,
    });
    if (ok) {
      if (!workspace.captured) workspace.markExported();
      showToast({
        tone: "success",
        message: workspace.captured
          ? "Your inspected, revision-bound PDF is ready."
          : "Your document is ready.",
      });
    }
  }

  if (workspace.loading) {
    return <div className={styles.loading}><Spinner label="Loading your workspace" size="md" /></div>;
  }

  const authIssue = workspace.generationIssues.find((issue) => issue.sectionId === AUTH_SECTION_ID);
  const paywallIssue = workspace.generationIssues.find((issue) => issue.sectionId === PAYWALL_SECTION_ID);
  const activeIssue = workspace.generationIssues.find((issue) => issue.sectionId === workspace.activeSectionId);
  const activeMissingInfo =
    workspace.missingInfoQuestions.find(
      (question) => question.placeholderId === workspace.selectedPlaceholderId,
    ) ??
    workspace.missingInfoQuestions.find(
      (question) => question.sectionId === workspace.activeSectionId,
    ) ??
    workspace.missingInfoQuestions[0];
  const saveLabel = workspace.syncStatus === "saving"
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
    for (const section of workspace.sections) {
      if (section.status === "approved") continue;
      if (isVisiblyEmpty(section.content)) {
        skipped.push(section.name);
        continue;
      }
      workspace.section.approve(section.id);
    }
    showToast({
      tone: skipped.length ? "info" : "success",
      message: skipped.length
        ? `Approved completed sections. Still needs wording: ${skipped.join(", ")}.`
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
        label={workspace.regeneratingSectionId ? "TED is redrafting this section" : "TED is drafting your document"}
      />

      <div className={`${styles.body}${proofreadStarted ? ` ${styles.bodyWithProofread}` : ""}`}>
        {proofreadStarted && (
          <OptionalPanelBoundary
            label="Proofread tools"
            onClose={() => setProofreadStarted(false)}
          >
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
          />
        </div>
      </div>
    </div>
  );
}
