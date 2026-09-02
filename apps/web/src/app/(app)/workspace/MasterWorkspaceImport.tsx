"use client";

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ingestUpload } from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";
import {
  preflightUploadMetadata,
  UPLOAD_REQUIREMENT,
} from "@prompted/shared/ingest-upload";
import { Icon } from "@/components/atoms/Icon";
import { Spinner } from "@/components/atoms/Spinner";
import { useAuth } from "@/components/providers";
import { ACCEPT_ATTRIBUTE } from "@/hooks/useFileAttachment";
import { ensureApiConfigured } from "@/lib/api";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import { commitDocumentImport } from "@/lib/api/import-workspace";
import {
  savePendingOutcome,
  saveWorkspace,
  userWorkspaceCacheScope,
} from "@/lib/workspace-store";
import { ImportReviewPanel } from "./ImportReviewPanel";
import { assessImportFidelity, type ImportFidelityReport } from "./import-fidelity";
import { splitImportedDocument } from "./import-structure";
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
  uploadId: string;
  fileName: string;
  title: string;
  extracted: string;
  outcomeId: string;
  documentId: string;
  sections: Section[];
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
      return "Your connection dropped before the import finished. Your original file is safe; check your connection and try again.";
    case "sync_failed":
      return "TED read the document but could not save it securely to your account. Nothing was added to your workspace. Please try again.";
    case "service_unavailable":
      return "Document import is temporarily unavailable. Your original file is safe; please try again shortly.";
    default:
      return `TED could not import that document. Your original file is safe. ${UPLOAD_REQUIREMENT}`;
  }
}

export function MasterWorkspaceImport() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);

  const pickFile = useCallback(() => fileRef.current?.click(), []);

  const handleFile = useCallback(
    async (file: File) => {
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
      if (!user?.id) {
        // Anonymous access was removed: there is no fallback session to wait
        // out here anymore. If there's no user, there's no account.
        setError("Sign in to upload a document \u2014 anonymous uploads are no longer supported.");
        return;
      }
      const requestContext = captureOwnerDispatch(user.id);

      setBusy(true);
      setError(null);
      setPending(null);

      try {
        ensureApiConfigured();
        const result = await ingestUpload(
          file,
          "Import this finished document into Master Workspace for editing. Keep its heading hierarchy, subheadings, paragraphs and list structure where they can be identified reliably.",
          requestContext,
        );
        requestContext.assertCurrent();
        const extracted = result.extracted_text.trim();
        if (!extracted) throw new ImportFailure("empty_document");

        const outcomeId = makeId("outcome");
        const documentId = makeId("document");
        const now = new Date().toISOString();
        const title = file.name.replace(/\.[^.]+$/, "") || "Imported document";
        const sections = splitImportedDocument({
          extracted,
          documentId,
          userId: user?.id ?? "",
          now,
        });
        const fidelity = assessImportFidelity({
          fileName: file.name,
          mimeType: file.type,
          extractedText: extracted,
          sections,
        });

        setPending({
          uploadId: result.upload_id,
          fileName: file.name,
          title,
          extracted,
          outcomeId,
          documentId,
          sections,
          fidelity,
        });
      } catch (caught) {
        if (ownerDispatchIsCurrent(requestContext)) {
          setError(importFailureMessage(classifyImportFailure(caught)));
        }
      } finally {
        if (ownerDispatchIsCurrent(requestContext)) setBusy(false);
      }
    },
    [authLoading, user],
  );

  const createWorkspace = useCallback(
    async (sections: Section[]) => {
      if (!pending) return;
      const userId = user?.id;
      if (!userId) {
        setError(importFailureMessage("sync_failed"));
        return;
      }
      const requestContext = captureOwnerDispatch(userId);
      setBusy(true);
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
          sections,
        };
        const recommendationPayload = {
          primary: { template_id: "imported_document", reason: pending.title },
          alternatives: [],
          conversation: [],
          situation: pendingOutcome.situation,
          upload_context: pending.extracted,
          upload_id: pending.uploadId,
        };

        try {
          await commitDocumentImport(
            {
              uploadId: pending.uploadId,
              outcomeId: pending.outcomeId,
              documentId: pending.documentId,
              title: pending.title,
              situationText: pendingOutcome.situation,
              recommendationPayload,
              sections,
            },
            requestContext,
          );
          requestContext.assertCurrent();
        } catch (syncError) {
          throw new ImportFailure("sync_failed", { cause: syncError });
        }

        const cacheScope = userWorkspaceCacheScope(userId);
        requestContext.assertCurrent();
        savePendingOutcome(cacheScope, pending.outcomeId, pendingOutcome);
        requestContext.assertCurrent();
        saveWorkspace(cacheScope, workspace);
        requestContext.assertCurrent();
        router.push(`/outcomes/${pending.outcomeId}`);
      } catch (caught) {
        if (ownerDispatchIsCurrent(requestContext)) {
          setError(importFailureMessage(classifyImportFailure(caught)));
        }
      } finally {
        if (ownerDispatchIsCurrent(requestContext)) setBusy(false);
      }
    },
    [pending, router, user],
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

      {pending ? (
        <ImportReviewPanel
          title={pending.title}
          initialSections={pending.sections}
          fidelity={pending.fidelity}
          onBack={() => {
            setPending(null);
            setError(null);
          }}
          onConfirm={createWorkspace}
          busy={busy}
        />
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
                      TED will organise the readable content, explain any layout risks, then ask you
                      to check the sections before anything is added to your workspace.
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
              Detected sections and layout warnings will appear here after TED reads the document.
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

      {pending && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
