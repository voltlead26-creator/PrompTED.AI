"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { createNodeFromContent } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import {
  renderTedPlaceholdersForEditor,
  serialiseTedPlaceholdersFromEditor,
  TedPlaceholderExtension,
} from "./TedPlaceholderExtension";
import type { Editor } from "@tiptap/react";
import type { EditAction } from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";
import { renderSectionHtml } from "@prompted/shared/export";
import { isVisiblyEmpty } from "@prompted/shared/visible-content";
import { Badge, type BadgeStatus } from "@/components/atoms/Badge";
import { Icon } from "@/components/atoms/Icon";
import type { ContentEditOptions } from "@/hooks/useSection";
import { useExplainWithTED } from "@/hooks/useExplainWithTED";
import { type PersistedEditIdentity, useEditWithTED } from "@/hooks/useEditWithTED";
import type { LegacySectionApplyResult } from "@/lib/api/sections";
import { sanitiseSectionContent } from "@/lib/sanitise";
import { ExplainWithTED } from "./ExplainWithTED";
import { EditWithTED } from "./EditWithTED";
import { TedChangeReview } from "./TedChangeReview";
import styles from "./SectionEditor.module.css";

function renderSectionForEditor(content: string): string {
  // Stored legacy/imported sections may be plain text. Use the same paragraph
  // and line-break conversion as preview/export before Tiptap parses HTML.
  // This is presentation only; opening a section must not publish a new edit.
  return renderTedPlaceholdersForEditor(renderSectionHtml(content));
}

interface SectionEditorProps {
  section: Section | null;
  domain?: string;
  onEdit: (id: string, content: string, options?: ContentEditOptions) => void;
  /** Confirmed aggregate save state; local text equality is not a saved revision. */
  workspaceSaved?: boolean;
  /** Merge a confirmed DB Apply response as authoritative truth without
   * scheduling a second generic document/section save. */
  onPersistedLegacyApply?: (result: LegacySectionApplyResult) => void;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onToggleLock: (id: string) => void;
  onOpenHistory: () => void;
  documentMode?: boolean;
  onPlaceholderSelect?: (placeholderId: string) => void;
  /** Captured documents approve one exact document revision, never a local section flag. */
  revisionApproval?: boolean;
  /** Authoritative document binding from the persisted workspace truth. Never
   * infer this security boundary from a display/template section key. */
  ledgerBindingStatus?: "legacy_unversioned" | "captured";
}

interface ToolbarButton {
  label: string;
  icon: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

interface PendingTedChange {
  sourceEpoch: number;
  suggested: string;
  changes: string[];
  range: { from: number; to: number } | null;
  action: EditAction;
  instruction?: string;
  persisted: PersistedEditIdentity | null;
  recoverableApply: boolean;
  recovered: boolean;
}

interface RevisionedSection extends Section {
  revision?: number;
  section_key?: string | null;
  ledger_binding_status?: "legacy_unversioned" | "captured";
}

const TOOLBAR: ToolbarButton[] = [
  {
    label: "Bold",
    icon: "bold",
    isActive: (editor) => editor.isActive("bold"),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    label: "Italic",
    icon: "italic",
    isActive: (editor) => editor.isActive("italic"),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    label: "Heading 2",
    icon: "h-2",
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    icon: "h-3",
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Bullet list",
    icon: "list",
    isActive: (editor) => editor.isActive("bulletList"),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered list",
    icon: "list-numbers",
    isActive: (editor) => editor.isActive("orderedList"),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
];

const TED_PLACEHOLDER_TOKEN = "{{TED_PLACEHOLDER:";
const LEGACY_RECOVERY_INITIAL_DELAY_MS = 750;
const LEGACY_RECOVERY_MAX_DELAY_MS = 30_000;

function legacyRecoveryDelayMs(attempt: number): number {
  return Math.min(
    LEGACY_RECOVERY_INITIAL_DELAY_MS * 2 ** Math.min(attempt, 6),
    LEGACY_RECOVERY_MAX_DELAY_MS,
  );
}

export function wouldEraseTedPlaceholder(value: string, currentContent: string): boolean {
  return currentContent.includes(TED_PLACEHOLDER_TOKEN) && isVisiblyEmpty(value);
}

function editExplanation(action: EditAction): string {
  switch (action) {
    case "shorten":
      return "TED shortened the wording while preserving its meaning and facts.";
    case "expand":
      return "TED added useful detail based only on the wording already supplied.";
    case "change_tone":
      return "TED adjusted the tone without intentionally changing the facts.";
    case "add_detail":
      return "TED incorporated the additional detail into this section.";
    default:
      return "TED revised the wording for clarity. Check that the meaning and facts remain correct.";
  }
}

export function SectionEditor({
  section,
  domain,
  onEdit,
  onPersistedLegacyApply,
  onApprove,
  onUnapprove,
  onToggleLock,
  onOpenHistory,
  documentMode = false,
  onPlaceholderSelect,
  revisionApproval = false,
  ledgerBindingStatus,
  workspaceSaved = false,
}: SectionEditorProps) {
  const [showTEdit, setShowTEdit] = useState(false);
  const [showExplainPanel, setShowExplainPanel] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selection, setSelection] = useState<{ from: number; to: number; text: string } | null>(
    null,
  );
  const [pendingTedSnapshot, setPendingTedChange] = useState<PendingTedChange | null>(null);
  const [proposalNotice, setProposalNotice] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [confirmedRevision, setConfirmedRevision] = useState<{
    sectionId: string;
    revision: number;
    content: string;
  } | null>(null);
  const [legacyRecoveryState, setLegacyRecoveryState] = useState<"checking" | "reconciling" | null>(
    null,
  );
  const typingBurst = useRef<{ identity: string; lastInputAt: number } | null>(null);
  const syncedIdentity = useRef<string | null>(null);
  const lastPublished = useRef<{ identity: string; content: string } | null>(null);
  const editorIdentity = section ? `${section.user_id}:${section.document_id}:${section.id}` : null;
  const ai = useEditWithTED();
  const explain = useExplainWithTED();
  const editLifetimeRef = useRef<symbol | null>(null);
  const sourceSnapshot = {
    identity: editorIdentity,
    revision: (section as RevisionedSection | null)?.revision,
    content: section?.content,
    binding: ledgerBindingStatus ?? (section as RevisionedSection | null)?.ledger_binding_status,
    confirmedRevision: confirmedRevision?.revision,
  };
  const editSourceRef = useRef({ ...sourceSnapshot, epoch: 0 });
  const previousSource = editSourceRef.current;
  const sourceChanged = previousSource.identity !== sourceSnapshot.identity ||
    previousSource.revision !== sourceSnapshot.revision || previousSource.content !== sourceSnapshot.content ||
    previousSource.binding !== sourceSnapshot.binding || previousSource.confirmedRevision !== sourceSnapshot.confirmedRevision;
  editSourceRef.current = { ...sourceSnapshot, epoch: previousSource.epoch + Number(sourceChanged) };
  const sourceEpoch = editSourceRef.current.epoch;
  const pendingTedChange = pendingTedSnapshot?.sourceEpoch === sourceEpoch ? pendingTedSnapshot : null;

  useLayoutEffect(() => {
    const lifetime = Symbol("section-editor");
    editLifetimeRef.current = lifetime;
    return () => {
      if (editLifetimeRef.current === lifetime) editLifetimeRef.current = null;
    };
  }, []);

  const editSourceIsCurrent = useCallback((epoch: number, lifetime: symbol | null) =>
    lifetime !== null && editLifetimeRef.current === lifetime && editSourceRef.current.epoch === epoch,
  []);

  const editor = useEditor({
    extensions: [StarterKit, TedPlaceholderExtension],
    content: renderSectionForEditor(section?.content ?? ""),
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": section ? `Edit ${section.name}` : "Section editor",
        class: styles.prose ?? "",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const placeholder = target?.closest<HTMLElement>("[data-ted-placeholder-id]");
        const id = placeholder?.dataset.tedPlaceholderId?.trim();
        if (!id) return false;
        onPlaceholderSelect?.(id);
        return true;
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          if (event.key !== "Enter" && event.key !== " ") return false;
          const target = event.target as HTMLElement | null;
          const placeholder = target?.closest<HTMLElement>("[data-ted-placeholder-id]");
          const id = placeholder?.dataset.tedPlaceholderId?.trim();
          if (!id) return false;
          event.preventDefault();
          onPlaceholderSelect?.(id);
          return true;
        },
      },
    },
    onUpdate: ({ editor: currentEditor, transaction }) => {
      if (
        !transaction.docChanged ||
        !section ||
        !editorIdentity ||
        section.status === "locked" ||
        ai.streaming ||
        pendingTedChange
      )
        return;
      const value = sanitiseSectionContent(
        serialiseTedPlaceholdersFromEditor(currentEditor.getHTML()),
      );
      // Several transactions may precede React's next render (including undo).
      // Compare with the previous publication, not the previous render's prop.
      const previousContent =
        lastPublished.current?.identity === editorIdentity
          ? lastPublished.current.content
          : section.content;
      if (value === previousContent || wouldEraseTedPlaceholder(value, previousContent)) return;
      const now = Date.now();
      const previous = typingBurst.current;
      const continuing =
        previous?.identity === editorIdentity &&
        now >= previous.lastInputAt &&
        now - previous.lastInputAt < 500;
      typingBurst.current = { identity: editorIdentity, lastInputAt: now };
      lastPublished.current = { identity: editorIdentity, content: value };
      onEdit(section.id, value, { recordHistory: !continuing });
    },
    onBlur: () => {
      typingBurst.current = null;
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      const text = currentEditor.state.doc.textBetween(from, to, "\n").trim();
      const next = text ? { from, to, text } : null;
      setSelection(next);
      setHasSelection(Boolean(next));
    },
  });

  const revisionedSection = section as RevisionedSection | null;
  const sectionId = section?.id;
  const sectionContent = section?.content;
  const sectionRevision = revisionedSection?.revision;
  const recoverLegacyEdit = ai.recover;
  const authoritativeLedgerBinding =
    ledgerBindingStatus ?? revisionedSection?.ledger_binding_status;
  const capturedSection = authoritativeLedgerBinding === "captured";
  const confirmedSectionRevision =
    confirmedRevision && confirmedRevision.sectionId === sectionId
      ? confirmedRevision.revision
      : null;
  const persistedSectionRevision =
    Math.max(
      Number.isInteger(sectionRevision) ? Number(sectionRevision) : 0,
      confirmedSectionRevision ?? 0,
    ) || undefined;
  const revisionBoundLegacy = Boolean(
    sectionId &&
    authoritativeLedgerBinding === "legacy_unversioned" &&
    !capturedSection &&
    Number.isInteger(persistedSectionRevision) &&
    Number(persistedSectionRevision) > 0,
  );

  useEffect(() => {
    setConfirmedRevision((current) => {
      if (!current) return null;
      if (current.sectionId !== sectionId) return null;
      if (Number.isInteger(sectionRevision) && Number(sectionRevision) >= current.revision) {
        return null;
      }
      return current;
    });
  }, [sectionContent, sectionId, sectionRevision]);

  useEffect(() => {
    if (!editor || !editorIdentity) return;
    const incomingHtml = renderSectionForEditor(sectionContent || "<p></p>");
    const incoming = createNodeFromContent(incomingHtml, editor.schema, { slice: false });
    const sameIdentity = syncedIdentity.current === editorIdentity;
    syncedIdentity.current = editorIdentity;
    lastPublished.current = { identity: editorIdentity, content: sectionContent ?? "" };
    // Compare with the same schema that renders the editor. Tokens, plain text
    // and equivalent HTML must not reset the caret on a local echo or receipt.
    if (sameIdentity && incoming instanceof ProseMirrorNode && editor.state.doc.eq(incoming))
      return;
    editor.commands.setContent(incomingHtml, { emitUpdate: false });
    typingBurst.current = null;
    setSelection(null);
    setHasSelection(false);
    setPendingTedChange(null);
    setProposalNotice(null);
    setShowTEdit(false);
    setShowExplainPanel(false);
  }, [editor, editorIdentity, sectionContent]);

  useEffect(() => {
    // Preserve the existing invalidation of suggestions bound to an older
    // revision while allowing unchanged wording to retain its caret.
    setPendingTedChange(null);
    setProposalNotice(null);
  }, [editorIdentity, sectionRevision]);

  useEffect(() => {
    // Local wording has no matching persisted edit to recover yet. Keep the
    // composer available so its existing save guard can explain the blocker;
    // the account receipt will restart recovery against the saved revision.
    if (!sectionId || !revisionBoundLegacy || !workspaceSaved) {
      setLegacyRecoveryState(null);
      return;
    }
    if (pendingTedChange || ai.streaming) return;
    let active = true;
    let timer: number | null = null;
    let pollAttempt = 0;
    const acceptedLifetime = editLifetimeRef.current;
    setLegacyRecoveryState("checking");
    const poll = async (): Promise<void> => {
      const recovered = await recoverLegacyEdit(sectionId);
      if (!active || !editSourceIsCurrent(sourceEpoch, acceptedLifetime)) return;
      if (!recovered) {
        setLegacyRecoveryState(null);
        return;
      }
      if (recovered.state === "accepted" || recovered.state === "provider_dispatched") {
        setLegacyRecoveryState("reconciling");
        setProposalNotice(
          recovered.state === "accepted"
            ? "TED accepted this saved edit and is reconciling its durable progress. No second attempt will start."
            : "TED already dispatched this saved edit and is reconciling the result. No second attempt will start.",
        );
        const delay = legacyRecoveryDelayMs(pollAttempt);
        pollAttempt += 1;
        timer = window.setTimeout(() => void poll(), delay);
        return;
      }
      setLegacyRecoveryState(null);
      if (recovered.state !== "ready") {
        switch (recovered.state) {
          case "stale":
            setProposalNotice(
              "This section changed after TED prepared the saved suggestion. The stale suggestion was not restored or applied.",
            );
            break;
          case "cancelled":
            setProposalNotice(
              "TED confirmed that the edit was cancelled. Your saved wording was not changed; you may start a new attempt.",
            );
            break;
          case "terminal_failure":
            setProposalNotice(
              "TED confirmed that the edit ended without changing your saved wording. You may start a new attempt.",
            );
            break;
          case "reconciliation_required":
            setProposalNotice(
              "TED could not confirm the provider outcome, but your saved wording was not changed. Start a new edit with a new attempt.",
            );
            break;
          default:
            setProposalNotice(null);
        }
        return;
      }
      const identity: PersistedEditIdentity = {
        operationId: recovered.operation_id,
        acceptedSectionRevision: recovered.accepted_section_revision,
        resultSha256: recovered.result_sha256,
        appliedCandidateContent: recovered.applied_candidate_content,
        appliedCandidateSha256: recovered.applied_candidate_sha256,
        requestFingerprint: null,
      };
      setPendingTedChange({
        sourceEpoch,
        suggested: recovered.suggested_content,
        changes: recovered.changes,
        range: null,
        action: recovered.action,
        persisted: identity,
        recoverableApply: recovered.recoverable,
        recovered: true,
      });
      setProposalNotice(
        recovered.scope === "selection"
          ? "Recovered TED's selection edit as the exact saved full-section result. Applying it still requires your confirmation."
          : "Recovered TED's saved suggestion. Applying it still requires your confirmation.",
      );
    };
    void poll();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [ai.streaming, pendingTedChange, recoverLegacyEdit, revisionBoundLegacy, sectionId, sourceEpoch, editSourceIsCurrent, workspaceSaved]);

  const locked = section?.status === "locked";
  useEffect(() => {
    editor?.setEditable(!ai.streaming && !locked && !pendingTedChange, false);
  }, [editor, ai.streaming, locked, pendingTedChange]);

  const runAiEdit = useCallback(
    async (action: EditAction, instruction?: string, ignoreReviewedSuggestion = false) => {
      const acceptedLifetime = editLifetimeRef.current;
      if (
        !editor ||
        !section ||
        !editSourceIsCurrent(sourceEpoch, acceptedLifetime) ||
        (pendingTedChange && !ignoreReviewedSuggestion) ||
        ai.streaming ||
        legacyRecoveryState !== null
      )
        return;
      if (
        !authoritativeLedgerBinding ||
        (authoritativeLedgerBinding === "legacy_unversioned" && !revisionBoundLegacy)
      ) {
        setProposalNotice(
          "TED needs the latest saved revision before it can edit this section safely. Wait for saving to finish or reload the workspace, then try again.",
        );
        return;
      }
      const currentContent = sanitiseSectionContent(
        serialiseTedPlaceholdersFromEditor(editor.getHTML()),
      );
      if (revisionBoundLegacy && currentContent !== sanitiseSectionContent(section.content)) {
        setProposalNotice(
          "Save the current wording before asking TED to edit it, so the suggestion is bound to the exact saved revision.",
        );
        onEdit(section.id, currentContent);
        return;
      }
      if (revisionBoundLegacy && !workspaceSaved) {
        setProposalNotice(
          "Save the current wording before asking TED to edit it, so the suggestion is bound to the exact saved revision.",
        );
        return;
      }
      // The service reloads the provider input from Postgres. Sending the
      // byte-exact stored body here is solely for its accepted SHA-256 binding;
      // an editor/sanitiser-normalised equivalent must not create a false stale.
      const fullText = revisionBoundLegacy ? section.content : editor.getText();
      const selectedText = selection?.text?.trim() ?? "";
      const result = await ai.run({
        action,
        content: fullText,
        selection: selectedText || undefined,
        instruction,
        domain,
        persistence: revisionBoundLegacy
          ? {
              userId: section.user_id,
              documentId: section.document_id,
              sectionId: section.id,
              expectedSectionRevision: Number(persistedSectionRevision),
            }
          : undefined,
      });
      if (!editSourceIsCurrent(sourceEpoch, acceptedLifetime) || editor.isDestroyed ||
          sanitiseSectionContent(serialiseTedPlaceholdersFromEditor(editor.getHTML())) !== currentContent) return;
      if (!result?.content.trim()) return;
      if (revisionBoundLegacy && !result.persisted) {
        setProposalNotice(
          "TED returned wording without a valid durable revision binding. Nothing was applied; retry only after TED reconciles the saved operation.",
        );
        return;
      }
      const range = selection ? { from: selection.from, to: selection.to } : null;
      setPendingTedChange({
        sourceEpoch,
        suggested: result.content.trim(),
        changes: result.changes,
        range,
        action,
        instruction,
        persisted: result.persisted,
        recoverableApply: true,
        recovered: false,
      });
      setProposalNotice(null);
      setShowTEdit(false);
      // Bring the segment TED just edited into view in the real document
      // above, rather than only showing it duplicated inside the review
      // card -- the user's actual "before" reference is the live document.
      if (range) {
        editor.chain().setTextSelection(range).scrollIntoView().run();
      }
    },
    [
      editor,
      section,
      pendingTedChange,
      ai,
      selection,
      domain,
      onEdit,
      authoritativeLedgerBinding,
      persistedSectionRevision,
      revisionBoundLegacy,
      legacyRecoveryState,
      workspaceSaved,
      sourceEpoch,
      editSourceIsCurrent,
    ],
  );

  const applyTedChange = useCallback(async () => {
    if (!editor || !section || !pendingTedChange) return;
    const accepted = pendingTedChange;
    const acceptedLifetime = editLifetimeRef.current;
    if (!editSourceIsCurrent(accepted.sourceEpoch, acceptedLifetime) || editor.isDestroyed) return;
    if (!pendingTedChange.recoverableApply) {
      setProposalNotice(
        "This recovered suggestion cannot be applied safely because its exact accepted wording or selection is no longer current.",
      );
      return;
    }
    typingBurst.current = null;
    if (pendingTedChange.persisted) {
      const applied = await ai.applyPersisted(pendingTedChange.persisted);
      if (!applied || !editSourceIsCurrent(accepted.sourceEpoch, acceptedLifetime) || editor.isDestroyed) return;
      setConfirmedRevision({
        sectionId: section.id,
        revision: applied.section_revision,
        content: applied.section_content,
      });
      onPersistedLegacyApply?.(applied);
      editor.commands.setContent(renderSectionForEditor(applied.section_content), {
        emitUpdate: false,
      });
    } else {
      if (pendingTedChange.range) {
        editor.chain().insertContentAt(pendingTedChange.range, pendingTedChange.suggested).run();
      } else {
        const asHtml = pendingTedChange.suggested
          .split(/\n{2,}/)
          .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
          .join("");
        editor.commands.setContent(asHtml, { emitUpdate: false });
      }
      const next = sanitiseSectionContent(serialiseTedPlaceholdersFromEditor(editor.getHTML()));
      onEdit(section.id, next);
    }
    setPendingTedChange((current) => current === accepted ? null : current);
    setProposalNotice(null);
  }, [ai, editor, section, pendingTedChange, onEdit, onPersistedLegacyApply, editSourceIsCurrent]);

  const discardTedChange = useCallback(async () => {
    if (!pendingTedChange) return;
    const accepted = pendingTedChange;
    const acceptedLifetime = editLifetimeRef.current;
    if (!editSourceIsCurrent(accepted.sourceEpoch, acceptedLifetime)) return;
    if (pendingTedChange.persisted && !(await ai.discardPersisted(pendingTedChange.persisted))) {
      return;
    }
    if (!editSourceIsCurrent(accepted.sourceEpoch, acceptedLifetime)) return;
    setPendingTedChange((current) => current === accepted ? null : current);
    setProposalNotice(null);
  }, [ai, pendingTedChange, editSourceIsCurrent]);

  const retryTedChange = useCallback(async () => {
    if (!pendingTedChange) return;
    const accepted = pendingTedChange;
    const acceptedLifetime = editLifetimeRef.current;
    if (!editSourceIsCurrent(accepted.sourceEpoch, acceptedLifetime)) return;
    const { action, instruction } = pendingTedChange;
    if (pendingTedChange.persisted && !(await ai.discardPersisted(pendingTedChange.persisted))) {
      return;
    }
    if (!editSourceIsCurrent(accepted.sourceEpoch, acceptedLifetime)) return;
    setPendingTedChange((current) => current === accepted ? null : current);
    setProposalNotice(null);
    await runAiEdit(action, instruction, true);
  }, [ai, pendingTedChange, runAiEdit, editSourceIsCurrent]);

  const runAiExplain = useCallback(
    async (question?: string) => {
      if (!editor || !section) return null;
      return await explain.run({
        content: editor.getText().slice(0, 20000),
        selection: selection?.text?.trim() || undefined,
        question,
        sectionName: section.name,
        domain,
      });
    },
    [editor, section, explain, domain, selection],
  );

  if (!section) {
    return (
      <div className={styles.empty}>
        <p>Select a section to start editing.</p>
      </div>
    );
  }

  const approved = section.status === "approved";
  const busy = ai.streaming || Boolean(pendingTedChange) || legacyRecoveryState !== null;

  return (
    <div className={`${styles.pane}${documentMode ? ` ${styles.documentMode}` : ""}`}>
      <div className={styles.sectionMeta}>
        <Badge status={section.status as BadgeStatus} />
      </div>

      <div className={styles.body}>
        <div className={styles.editorColumn}>
          <div className={styles.editorWrap}>
            <EditorContent editor={editor} className={styles.editor} />
          </div>

          {!pendingTedChange && proposalNotice && <p role="alert">{proposalNotice}</p>}

          {pendingTedChange && (
            <TedChangeReview
              suggested={pendingTedChange.suggested}
              changes={pendingTedChange.changes}
              explanation={editExplanation(pendingTedChange.action)}
              onDiscard={discardTedChange}
              onRetry={retryTedChange}
              onApply={applyTedChange}
              notice={proposalNotice || ai.error}
              returnFocusRef={toolbarRef}
            />
          )}

          <div ref={toolbarRef} tabIndex={-1} className={styles.contextBar} role="toolbar" aria-label="Edit selected content">
            <button
              type="button"
              className={styles.contextAction}
              disabled={locked || busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void runAiEdit("expand")}
            >
              <Icon name="arrows-maximize" size={17} />
              {ai.streaming ? "Working…" : "Expand"}
            </button>
            <button
              type="button"
              className={styles.contextAction}
              disabled={locked || busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void runAiEdit("shorten")}
            >
              <Icon name="arrows-minimize" size={17} />
              Shorten
            </button>
            <button
              type="button"
              className={`${styles.contextAction} ${styles.contextPrimary}`}
              disabled={locked || busy}
              aria-expanded={showTEdit}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setShowTEdit((value) => !value);
                setShowExplainPanel(false);
              }}
            >
              <Icon name="sparkles" size={17} />
              tEdit
            </button>

            <details className={styles.moreMenu}>
              <summary aria-label="More section options">
                <Icon name="dots" size={18} />
              </summary>
              <div className={styles.morePanel}>
                <div className={styles.formatting} role="toolbar" aria-label="Formatting">
                  {TOOLBAR.map((button) => (
                    <button
                      key={button.label}
                      type="button"
                      className={`${styles.toolBtn} ${
                        editor && button.isActive(editor) ? styles.toolActive : ""
                      }`}
                      aria-label={button.label}
                      aria-pressed={editor ? button.isActive(editor) : false}
                      disabled={!editor || busy || locked}
                      onClick={() => editor && button.run(editor)}
                    >
                      <Icon name={button.icon} size={18} />
                    </button>
                  ))}
                </div>
                <button type="button" onClick={onOpenHistory}>
                  <Icon name="history" size={16} />
                  History
                </button>
                <button type="button" onClick={() => onToggleLock(section.id)}>
                  <Icon name={locked ? "lock-open" : "lock"} size={16} />
                  {locked ? "Unlock section" : "Lock section"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExplainPanel(true);
                    setShowTEdit(false);
                  }}
                >
                  <Icon name="book" size={16} />
                  Explain this
                </button>
                {approved && revisionApproval ? (
                  <span role="status">
                    Editing this wording creates a new revision that needs approval.
                  </span>
                ) : approved ? (
                  <button type="button" onClick={() => onUnapprove(section.id)}>
                    Mark as draft
                  </button>
                ) : (
                  <button type="button" onClick={() => onApprove(section.id)} disabled={locked}>
                    {revisionApproval ? "Approve current revision" : "Approve section"}
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>

        {showTEdit && (
          <aside className={styles.aiSidebar} aria-label="tEdit">
            <div className={styles.aiSidebarHead}>
              <div>
                <span className={styles.aiSidebarTitle}>tEdit</span>
                <p>
                  {hasSelection
                    ? "TED will edit the selected wording."
                    : "TED will edit this section."}
                </p>
              </div>
              <button
                type="button"
                className={styles.aiClose}
                onClick={() => setShowTEdit(false)}
                aria-label="Close tEdit"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <EditWithTED
              streaming={ai.streaming}
              reconciling={legacyRecoveryState !== null}
              hasSelection={hasSelection}
              error={ai.error}
              onRun={runAiEdit}
              onCancel={ai.cancel}
            />
          </aside>
        )}

        {showExplainPanel && (
          <aside className={styles.aiSidebar} aria-label="Explain this">
            <div className={styles.aiSidebarHead}>
              <span className={styles.aiSidebarTitle}>Explain this</span>
              <button
                type="button"
                className={styles.aiClose}
                onClick={() => setShowExplainPanel(false)}
                aria-label="Close explanation"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <ExplainWithTED
              running={explain.running}
              hasSelection={hasSelection}
              error={explain.error}
              result={explain.result}
              onRun={runAiExplain}
              onCancel={explain.cancel}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
