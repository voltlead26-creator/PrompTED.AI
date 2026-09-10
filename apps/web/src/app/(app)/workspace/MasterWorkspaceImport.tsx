"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { prepareUploadSource } from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";
import {
  preflightUploadMetadataV2 as preflightUploadMetadata,
  UPLOAD_ACCEPT_ATTRIBUTE_V2 as ACCEPT_ATTRIBUTE,
  UPLOAD_REQUIREMENT_V2 as UPLOAD_REQUIREMENT,
  UPLOAD_RESOURCE_POLICY_VERSION_V2,
  isWorkspaceUploadId,
} from "@prompted/shared/ingest-upload";
import { Icon } from "@/components/atoms/Icon";
import { Spinner } from "@/components/atoms/Spinner";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  withOwnerDispatchSignal,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import { commitDocumentImport, getWorkspaceUpload, type CommitDocumentImportResult } from "@/lib/api/import-workspace";
import { savePendingOutcome, saveWorkspace, userWorkspaceCacheScope } from "@/lib/workspace-store";
import { ImportReviewPanel } from "./ImportReviewPanel";
import { assessImportFidelity, type ImportFidelityReport } from "./import-fidelity";
import { splitImportedDocument } from "./import-structure";
import { canReviewRetainedText } from "./retained-text-review";
import styles from "./MasterWorkspaceImport.module.css";

const SECTION_PREVIEW_COUNT = 3;

type ImportFailureCode =
  | "empty_document"
  | "unsupported_file"
  | "password_protected"
  | "network_error"
  | "sync_failed"
  | "service_unavailable"
  | "unknown";

interface PendingImport {
  lease: OwnerDispatchLease;
  uploadId: string;
  fileName: string;
  title: string;
  extracted: string;
  outcomeId: string;
  documentId: string;
  sections: Section[];
  confirmedSections?: Section[];
  savedReplay?: CommitDocumentImportResult;
  fidelity: ImportFidelityReport;
}

class ImportFailure extends Error {
  constructor(
    public readonly code: ImportFailureCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ImportFailure";
  }
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function classifyImportFailure(error: unknown): ImportFailureCode {
  if (error instanceof ImportFailure) return error.code;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("password") || message.includes("encrypted")) return "password_protected";
  if (message.includes("unsupported") || message.includes("file type")) return "unsupported_file";
  if (message.includes("network") || message.includes("failed to fetch")) return "network_error";
  if (message.includes("503") || message.includes("service unavailable"))
    return "service_unavailable";
  return "unknown";
}

function importFailureMessage(code: ImportFailureCode): string {
  switch (code) {
    case "empty_document":
      return "TED could not find selectable text in that file. If it is a scan or photo, convert it with text recognition first and try again.";
    case "unsupported_file":
      return `TED cannot read that file type yet. ${UPLOAD_REQUIREMENT}`;
    case "password_protected":
      return "That document appears to be password protected. Save an unlocked copy and import that version.";
    case "network_error":
      return "Your connection dropped before the import finished. Retention in your account is not yet confirmed; check the uploaded file or retry the same file.";
    case "sync_failed":
      return "TED read the document but could not confirm the save to your account. Try again to check the same import and reopen it if it was saved.";
    case "service_unavailable":
      return "Document import is temporarily unavailable. Retention in your account is not yet confirmed; please try again shortly.";
    default:
      return `TED could not finish reading that document. Check the uploaded file to confirm its availability. ${UPLOAD_REQUIREMENT}`;
  }
}

function prepareImportReview(lease: OwnerDispatchLease, uploadId: string, fileName: string, mimeType: string, text: string): PendingImport {
  const extracted = text.trim();
  if (!extracted) throw new ImportFailure("empty_document");
  const documentId = makeId("document");
  const sections = splitImportedDocument({ extracted, documentId, userId: lease.expectedUserId, now: new Date().toISOString() });
  return {
    lease, uploadId, fileName, extracted, documentId, outcomeId: makeId("outcome"),
    title: fileName.replace(/\.[^.]+$/, "") || "Imported document", sections,
    fidelity: assessImportFidelity({ fileName, mimeType, extractedText: extracted, sections }),
  };
}

export function MasterWorkspaceImport({ initialUploadId = null }: { initialUploadId?: string | null }) {
  const router = useRouter();
  const navigate = router.push;
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const fileRef = useRef<HTMLInputElement>(null);
  const lifetimeRef = useRef<AbortController | null>(null);
  const requestRef = useRef<OwnerDispatchLease | null>(null);
  const [activeRequest, setActiveRequest] = useState<OwnerDispatchLease | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [sourceNotice, setSourceNotice] = useState<{ lease: OwnerDispatchLease; uploadId: string; available: boolean | null } | null>(null);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const resumedReview = useRef(false);
  const busy = activeRequest !== null && ownerDispatchIsCurrent(activeRequest);
  const visiblePending =
    pending &&
    !authLoading &&
    pending.lease.expectedUserId === userId?.toLowerCase() &&
    ownerDispatchIsCurrent(pending.lease)
      ? pending
      : null;

  // Retire the lease during the unmount/owner-change commit, before a late
  // promise can publish content while passive effect cleanup is still queued.
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetimeRef.current = controller;
    requestRef.current = null;
    setActiveRequest(null);
    setPending(null);
    setSourceNotice(null);
    setError(null);
    setDragOver(false);
    resumedReview.current = false;
    return () => {
      controller.abort();
      if (lifetimeRef.current === controller) lifetimeRef.current = null;
    };
  }, [userId, initialUploadId, resumeAttempt]);

  useLayoutEffect(() => {
    if (!initialUploadId || authLoading || !userId || resumedReview.current) return;
    if (!isWorkspaceUploadId(initialUploadId)) { setError("This uploaded-file link is invalid."); return; }
    const lifetime = lifetimeRef.current;
    if (!lifetime || lifetime.signal.aborted) return;
    let lease: OwnerDispatchLease;
    try { lease = captureOwnerDispatch(userId, lifetime.signal); }
    catch { setError("Your sign-in changed. Reconnect before reviewing this upload."); return; }
    const readController = new AbortController();
    const readLease = withOwnerDispatchSignal(lease, readController.signal);
    requestRef.current = lease; setActiveRequest(lease); setError(null);
    const timer = setTimeout(() => {
      readController.abort();
      if (ownerDispatchIsCurrent(lease) && requestRef.current === lease) {
        requestRef.current = null; setActiveRequest(null);
        setError("The saved upload took too long to load. Try loading it again.");
      }
    }, 30_000);
    void (async () => {
      try {
        const source = await getWorkspaceUpload(initialUploadId, readLease);
        readLease.assertCurrent();
        if (!source) { setError("This uploaded file was not found in this account."); return; }
        if (source?.imported_document) {
          resumedReview.current = true;
          navigate(`/outcomes/${source.imported_document.outcome_id}`);
          return;
        }
        if (!canReviewRetainedText(source)) {
          setError("This upload is not available as complete text for section review. Open its original-file view to check its status.");
          return;
        }
        const review = prepareImportReview(lease, source.upload_id, source.file_name, source.mime_type, source.preview.text);
        resumedReview.current = true;
        setPending(review);
      } catch {
        if (ownerDispatchIsCurrent(lease) && !readController.signal.aborted) {
          setError("The saved upload could not be loaded. Try loading it again to check its saved state.");
        }
      } finally {
        clearTimeout(timer);
        if (requestRef.current === lease) {
          requestRef.current = null;
          if (ownerDispatchIsCurrent(lease)) setActiveRequest(null);
        }
        readController.abort();
      }
    })();
    return () => { clearTimeout(timer); readController.abort(); };
  }, [authLoading, initialUploadId, resumeAttempt, navigate, userId]);

  const pickFile = useCallback(() => fileRef.current?.click(), []);

  const handleFile = useCallback(
    async (file: File) => {
      if (requestRef.current && ownerDispatchIsCurrent(requestRef.current)) return;
      const preflight = preflightUploadMetadata({
        fileName: file.name,
        mimeType: file.type,
        byteLength: file.size,
      });
      if (!preflight.ok) {
        setError(preflight.message);
        return;
      }
      if (authLoading) return;
      if (!userId) {
        // Anonymous access was removed: there is no fallback session to wait
        // out here anymore. If there's no user, there's no account.
        setError("Sign in to upload a document \u2014 anonymous uploads are no longer supported.");
        return;
      }
      const lifetime = lifetimeRef.current;
      if (!lifetime || lifetime.signal.aborted) return;
      let requestContext: OwnerDispatchLease;
      try {
        requestContext = captureOwnerDispatch(userId, lifetime.signal);
      } catch {
        setError("Your sign-in changed. Reconnect to your account before importing the document.");
        return;
      }

      requestRef.current = requestContext;
      setActiveRequest(requestContext);
      setError(null);
      setPending(null);
      setSourceNotice(null);

      let preparedUploadId: string | undefined;
      let readbackAttempted = false;
      let retainedOriginalConfirmed = false;
      try {
        ensureApiConfigured();
        const result = await prepareUploadSource(
          file,
          "Import this finished document into Master Workspace for editing. Keep its heading hierarchy, subheadings, paragraphs and list structure where they can be identified reliably.",
          requestContext,
          { metadataPolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION_V2,
            beforeDispatch: (prepared) => { preparedUploadId = prepared.uploadId; } },
        );
        requestContext.assertCurrent();
        preparedUploadId = result.upload_id;
        // A plain-text preview cannot recreate the source's layout or package.
        // Retain and reopen binary originals without manufacturing editor HTML.
        if (preflight.format !== "text" || result.truncated) {
          setSourceNotice({ lease: requestContext, uploadId: result.upload_id, available: null });
          readbackAttempted = true;
          const source = await getWorkspaceUpload(result.upload_id, requestContext);
          requestContext.assertCurrent();
          setSourceNotice({ lease: requestContext, uploadId: result.upload_id, available: Boolean(source?.original) });
          if (!source) throw new ImportFailure("sync_failed");
          return;
        }
        setPending(prepareImportReview(requestContext, result.upload_id, file.name, file.type, result.extracted_text));
      } catch (caught) {
        if (preparedUploadId && !readbackAttempted && ownerDispatchIsCurrent(requestContext)) {
          setSourceNotice({ lease: requestContext, uploadId: preparedUploadId, available: null });
          try {
            const source = await getWorkspaceUpload(preparedUploadId, requestContext);
            requestContext.assertCurrent();
            retainedOriginalConfirmed = Boolean(source?.original);
            setSourceNotice({ lease: requestContext, uploadId: preparedUploadId, available: Boolean(source?.original) });
          } catch {
            // Keep availability unknown; a failed read is not evidence of loss.
          }
        }
        if (ownerDispatchIsCurrent(requestContext)) {
          setError(retainedOriginalConfirmed
            ? "TED could not finish reading this document. Your original is available; open it below or retry the same file."
            : importFailureMessage(classifyImportFailure(caught)));
        }
      } finally {
        if (requestRef.current === requestContext) {
          requestRef.current = null;
          if (ownerDispatchIsCurrent(requestContext)) setActiveRequest(null);
        }
      }
    },
    [authLoading, userId],
  );

  const createWorkspace = useCallback(
    async (sections: Section[]) => {
      if (!visiblePending || !userId) return;
      if (requestRef.current && ownerDispatchIsCurrent(requestRef.current)) return;
      const pending = visiblePending;
      const requestContext = pending.lease;
      if (!ownerDispatchIsCurrent(requestContext)) return;
      const acceptedSections = pending.confirmedSections ?? sections;
      // After dispatch, a lost response is uncertain persistence. Keep the
      // confirmed wording immutable until the same upload can be reconciled.
      setPending({ ...pending, confirmedSections: acceptedSections });
      requestRef.current = requestContext;
      setActiveRequest(requestContext);
      setError(null);

      try {
        const situation = `Imported from ${pending.fileName}`;
        const pendingOutcome = {
          situation: `Edit the imported document: ${pending.fileName}`,
          templateName: pending.title,
          templateId: "imported_document",
          uploadContext: pending.extracted,
          conversationContext: "",
          conversation: [],
        };
        const workspace = {
          documentId: pending.documentId,
          outcomeId: pending.outcomeId,
          title: pending.title,
          situation,
          status: "draft" as const,
          generated: true,
          templateId: "imported_document",
          conversationContext: "",
          uploadContext: pending.extracted,
          sections: acceptedSections,
        };
        const recommendationPayload = {
          primary: { template_id: "imported_document", reason: pending.title },
          alternatives: [],
          conversation: [],
          situation: pendingOutcome.situation,
          upload_context: pending.extracted,
          upload_id: pending.uploadId,
        };

        let receipt;
        try {
          receipt = await commitDocumentImport(
            {
              uploadId: pending.uploadId,
              outcomeId: pending.outcomeId,
              documentId: pending.documentId,
              title: pending.title,
              situationText: pendingOutcome.situation,
              recommendationPayload,
              sections: acceptedSections,
            },
            requestContext,
          );
          requestContext.assertCurrent();
        } catch (syncError) {
          throw new ImportFailure("sync_failed", { cause: syncError });
        }

        if (
          receipt.idempotent_replay &&
          (receipt.outcome_id.toLowerCase() !== pending.outcomeId.toLowerCase() ||
            receipt.document_id.toLowerCase() !== pending.documentId.toLowerCase())
        ) {
          // This review cannot replace an earlier import's document. Keep it
          // visible and explain that result before the owner chooses to leave.
          setPending({ ...pending, confirmedSections: acceptedSections, savedReplay: receipt });
          return;
        }

        // A replay accepted the original saved content, not this review copy.
        // Reopen through the canonical server loader without publishing it to caches.
        if (!receipt.idempotent_replay) {
          const cacheScope = userWorkspaceCacheScope(requestContext.expectedUserId);
          requestContext.assertCurrent();
          savePendingOutcome(cacheScope, receipt.outcome_id, pendingOutcome);
          requestContext.assertCurrent();
          saveWorkspace(cacheScope, workspace);
        }
        requestContext.assertCurrent();
        router.push(`/outcomes/${receipt.outcome_id}`);
      } catch (caught) {
        if (ownerDispatchIsCurrent(requestContext)) {
          setError(importFailureMessage(classifyImportFailure(caught)));
        }
      } finally {
        if (requestRef.current === requestContext) {
          requestRef.current = null;
          if (ownerDispatchIsCurrent(requestContext)) setActiveRequest(null);
        }
      }
    },
    [visiblePending, router, userId],
  );

  const importFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file && !busy && !authLoading) void handleFile(file);
    },
    [handleFile, busy, authLoading],
  );

  const importUnavailable = busy || authLoading;

  return (
    <section className={styles.screen} aria-labelledby="master-workspace-heading">
      <h1 id="master-workspace-heading" className="sr-only">
        Master Workspace
      </h1>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        onChange={importFile}
        hidden
        tabIndex={-1}
        aria-hidden="true"
      />

      {sourceNotice && !authLoading && sourceNotice.lease.expectedUserId === userId?.toLowerCase() && ownerDispatchIsCurrent(sourceNotice.lease) && (
        <p role="status">
          {sourceNotice.available === true ? "Your original is available in this account." : "The original’s availability has not been confirmed."}
          {" "}<Link href={`/workspace?upload=${sourceNotice.uploadId}`}>{sourceNotice.available === true ? "Open uploaded original" : "Check uploaded file"}</Link>
          {" "}Open the original-file view to download the retained file and inspect its text preview.
        </p>
      )}

      {visiblePending ? (
        <>
          {visiblePending.savedReplay ? (
            <p role="status">
              This original file is already in your workspace. Changes in this import review have
              not been applied to it. Open the saved workspace to review and edit that document.
            </p>
          ) : visiblePending.confirmedSections ? (
            <p role="status">
              This review is locked while TED checks the save of the wording you confirmed. You can
              continue editing when the saved workspace opens.
            </p>
          ) : null}
          <ImportReviewPanel
            title={visiblePending.title}
            initialSections={visiblePending.sections}
            fidelity={visiblePending.fidelity}
            onBack={() => {
              setPending(null);
              setError(null);
            }}
            onConfirm={
              visiblePending.savedReplay
                ? () => {
                    const savedReplay = visiblePending.savedReplay;
                    if (savedReplay && ownerDispatchIsCurrent(visiblePending.lease)) {
                      router.push(`/outcomes/${savedReplay.outcome_id}`);
                    }
                  }
                : createWorkspace
            }
            busy={busy}
            readOnly={Boolean(visiblePending.confirmedSections)}
            confirmLabel={
              visiblePending.savedReplay
                ? "Open saved workspace"
                : visiblePending.confirmedSections
                  ? "Check saved import"
                  : "Create workspace"
            }
          />
        </>
      ) : (
        <div className={styles.body}>
          {!authLoading && !user ? (
            <div className={styles.dropzone}>
              <div className={styles.dropzoneInner}>
                <div className={styles.iconWrap}>
                  <Icon name="file-pencil" size={30} />
                </div>
                <p className={styles.dropzoneTitle}>Sign in before importing a document</p>
                <p className={styles.description}>
                  Your document is personal. Signing in ensures TED saves it only to your workspace.
                </p>
                <Link className={styles.uploadButton} href="/sign-in">
                  Sign in to upload
                </Link>
              </div>
            </div>
          ) : (
            <div
              className={`${styles.dropzone}${dragOver ? ` ${styles.dropzoneActive}` : ""}${importUnavailable ? ` ${styles.dropzoneBusy}` : ""}`}
              onDrop={onDrop}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragOver(false);
              }}
              role="button"
              tabIndex={importUnavailable ? -1 : 0}
              onClick={importUnavailable ? undefined : pickFile}
              onKeyDown={(event) => {
                if (!importUnavailable && (event.key === "Enter" || event.key === " ")) pickFile();
              }}
              aria-label="Drop a document here, or click to browse"
              aria-busy={importUnavailable}
            >
              <div className={styles.dropzoneInner}>
                <div className={styles.iconWrap}>
                  <Icon name="file-pencil" size={30} />
                </div>
                {importUnavailable ? (
                  <>
                    <Spinner
                      label={authLoading ? "Preparing workspace" : "Importing document"}
                      size="sm"
                    />
                    <p className={styles.dropzoneTitle}>
                      {authLoading
                        ? "Preparing your workspace..."
                        : "Reading and organising your document..."}
                    </p>
                  </>
                ) : (
                  <>
                    <p className={styles.dropzoneTitle}>
                      {dragOver ? "Drop it here" : "Drag a document into this page"}
                    </p>
                    <p className={styles.description}>
                      PDF, Word (DOCX) and spreadsheet files stay as originals. For complete text
                      files, review the wording before creating an editable workspace.
                    </p>
                    <span className={styles.uploadButton}>
                      <Icon name="upload" size={18} />
                      <span>Choose a file</span>
                    </span>
                  </>
                )}
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
              </div>
            </div>
          )}

          <aside className={styles.sidePanel} aria-label="Sections available after import">
            <h2 className={styles.panelHeading}>Sections</h2>
            <p className={styles.panelSub}>
              Complete text imports can be reviewed as sections. Original files open with a separate
              extracted text preview.
            </p>
            <div className={styles.sectionsStack} aria-hidden="true">
              {Array.from({ length: SECTION_PREVIEW_COUNT }, (_, index) => (
                <div key={index} className={styles.sectionThumb}>
                  <span className={styles.sectionThumbLine} />
                  <span className={styles.sectionThumbLine} />
                  <span className={`${styles.sectionThumbLine} ${styles.sectionThumbLineShort}`} />
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {visiblePending && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {initialUploadId && isWorkspaceUploadId(initialUploadId) && !authLoading && userId && !visiblePending && !busy && error && (
        <p>
          <button type="button" onClick={() => setResumeAttempt((value) => value + 1)}>Retry saved upload</button>
          {" "}<Link href={`/workspace?upload=${initialUploadId}`}>Open uploaded original</Link>
        </p>
      )}
    </section>
  );
}
