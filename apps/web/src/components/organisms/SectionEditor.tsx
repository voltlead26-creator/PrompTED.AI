"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  renderTedPlaceholdersForEditor,
  serialiseTedPlaceholdersFromEditor,
  TedPlaceholderExtension,
} from "./TedPlaceholderExtension";
import type { Editor } from "@tiptap/react";
import type { EditAction } from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";
import { isVisiblyEmpty } from "@prompted/shared/visible-content";
import { Badge, type BadgeStatus } from "@/components/atoms/Badge";
import { Icon } from "@/components/atoms/Icon";
import { useAutosave } from "@/hooks/useAutosave";
import { useExplainWithTED } from "@/hooks/useExplainWithTED";
import { useEditWithTED } from "@/hooks/useEditWithTED";
import { sanitiseSectionContent } from "@/lib/sanitise";
import { ExplainWithTED } from "./ExplainWithTED";
import { EditWithTED } from "./EditWithTED";
import { TedChangeReview } from "./TedChangeReview";
import styles from "./SectionEditor.module.css";

interface SectionEditorProps {
  section: Section | null;
  domain?: string;
  onEdit: (id: string, content: string) => void;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onToggleLock: (id: string) => void;
  onOpenHistory: () => void;
  documentMode?: boolean;
  onPlaceholderSelect?: (placeholderId: string) => void;
  /** Captured documents approve one exact document revision, never a local section flag. */
  revisionApproval?: boolean;
}

interface ToolbarButton {
  label: string;
  icon: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

interface PendingTedChange {
  suggested: string;
  changes: string[];
  range: { from: number; to: number } | null;
  action: EditAction;
  instruction?: string;
}

const TOOLBAR: ToolbarButton[] = [
  { label: "Bold", icon: "bold", isActive: (editor) => editor.isActive("bold"), run: (editor) => editor.chain().focus().toggleBold().run() },
  { label: "Italic", icon: "italic", isActive: (editor) => editor.isActive("italic"), run: (editor) => editor.chain().focus().toggleItalic().run() },
  { label: "Heading 2", icon: "h-2", isActive: (editor) => editor.isActive("heading", { level: 2 }), run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", icon: "h-3", isActive: (editor) => editor.isActive("heading", { level: 3 }), run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Bullet list", icon: "list", isActive: (editor) => editor.isActive("bulletList"), run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", icon: "list-numbers", isActive: (editor) => editor.isActive("orderedList"), run: (editor) => editor.chain().focus().toggleOrderedList().run() },
];

const TED_PLACEHOLDER_TOKEN = "{{TED_PLACEHOLDER:";

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
  onApprove,
  onUnapprove,
  onToggleLock,
  onOpenHistory,
  documentMode = false,
  onPlaceholderSelect,
  revisionApproval = false,
}: SectionEditorProps) {
  const [showTEdit, setShowTEdit] = useState(false);
  const [showExplainPanel, setShowExplainPanel] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selection, setSelection] = useState<{ from: number; to: number; text: string } | null>(null);
  const [pendingTedChange, setPendingTedChange] = useState<PendingTedChange | null>(null);
  const [html, setHtml] = useState(section?.content ?? "");
  const ai = useEditWithTED();
  const explain = useExplainWithTED();

  const editor = useEditor({
    extensions: [StarterKit, TedPlaceholderExtension],
    content: renderTedPlaceholdersForEditor(section?.content ?? ""),
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
    onUpdate: ({ editor: currentEditor }) =>
      setHtml(serialiseTedPlaceholdersFromEditor(currentEditor.getHTML())),
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      const text = currentEditor.state.doc.textBetween(from, to, "\n").trim();
      const next = text ? { from, to, text } : null;
      setSelection(next);
      setHasSelection(Boolean(next));
    },
  });

  useEffect(() => {
    if (!editor || !section) return;
    if (editor.getHTML() !== section.content) {
      editor.commands.setContent(
        renderTedPlaceholdersForEditor(section.content || "<p></p>"),
        { emitUpdate: false },
      );
    }
    setHtml(section.content);
    setSelection(null);
    setHasSelection(false);
    setPendingTedChange(null);
    setShowTEdit(false);
    setShowExplainPanel(false);
  }, [section, editor]);

  const locked = section?.status === "locked";
  useEffect(() => {
    editor?.setEditable(!ai.streaming && !locked && !pendingTedChange);
  }, [editor, ai.streaming, locked, pendingTedChange]);

  useAutosave(html, (value) => {
    if (
      section &&
      value !== section.content &&
      !pendingTedChange &&
      !wouldEraseTedPlaceholder(value, section.content)
    ) {
      onEdit(section.id, sanitiseSectionContent(value));
    }
  });

  const runAiEdit = useCallback(
    async (action: EditAction, instruction?: string) => {
      if (!editor || !section || pendingTedChange || ai.streaming) return;
      const fullText = editor.getText();
      const selectedText = selection?.text?.trim() ?? "";
      const result = await ai.run({
        action,
        content: fullText,
        selection: selectedText || undefined,
        instruction,
        domain,
      });
      if (!result?.content.trim()) return;
      const range = selection ? { from: selection.from, to: selection.to } : null;
      setPendingTedChange({
        suggested: result.content.trim(),
        changes: result.changes,
        range,
        action,
        instruction,
      });
      setShowTEdit(false);
      // Bring the segment TED just edited into view in the real document
      // above, rather than only showing it duplicated inside the review
      // card -- the user's actual "before" reference is the live document.
      if (range) {
        editor.chain().setTextSelection(range).scrollIntoView().run();
      }
    },
    [editor, section, pendingTedChange, ai, selection, domain],
  );

  const applyTedChange = useCallback(() => {
    if (!editor || !section || !pendingTedChange) return;
    if (pendingTedChange.range) {
      editor.chain().focus().insertContentAt(pendingTedChange.range, pendingTedChange.suggested).run();
    } else {
      const asHtml = pendingTedChange.suggested
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
        .join("");
      editor.commands.setContent(asHtml);
    }
    const next = sanitiseSectionContent(
      serialiseTedPlaceholdersFromEditor(editor.getHTML()),
    );
    setHtml(next);
    onEdit(section.id, next);
    setPendingTedChange(null);
  }, [editor, section, pendingTedChange, onEdit]);

  const retryTedChange = useCallback(() => {
    if (!pendingTedChange) return;
    const { action, instruction } = pendingTedChange;
    setPendingTedChange(null);
    window.setTimeout(() => void runAiEdit(action, instruction), 0);
  }, [pendingTedChange, runAiEdit]);

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
    return <div className={styles.empty}><p>Select a section to start editing.</p></div>;
  }

  const approved = section.status === "approved";
  const busy = ai.streaming || Boolean(pendingTedChange);

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

          {pendingTedChange && (
            <TedChangeReview
              suggested={pendingTedChange.suggested}
              changes={pendingTedChange.changes}
              explanation={editExplanation(pendingTedChange.action)}
              onDiscard={() => setPendingTedChange(null)}
              onRetry={retryTedChange}
              onApply={applyTedChange}
            />
          )}

          <div className={styles.contextBar} role="toolbar" aria-label="Edit selected content">
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
              disabled={locked || Boolean(pendingTedChange)}
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
              <summary aria-label="More section options"><Icon name="dots" size={18} /></summary>
              <div className={styles.morePanel}>
                <div className={styles.formatting} role="toolbar" aria-label="Formatting">
                  {TOOLBAR.map((button) => (
                    <button
                      key={button.label}
                      type="button"
                      className={`${styles.toolBtn} ${editor && button.isActive(editor) ? styles.toolActive : ""}`}
                      aria-label={button.label}
                      aria-pressed={editor ? button.isActive(editor) : false}
                      disabled={!editor || busy || locked}
                      onClick={() => editor && button.run(editor)}
                    >
                      <Icon name={button.icon} size={18} />
                    </button>
                  ))}
                </div>
                <button type="button" onClick={onOpenHistory}><Icon name="history" size={16} />History</button>
                <button type="button" onClick={() => onToggleLock(section.id)}><Icon name={locked ? "lock-open" : "lock"} size={16} />{locked ? "Unlock section" : "Lock section"}</button>
                <button type="button" onClick={() => { setShowExplainPanel(true); setShowTEdit(false); }}><Icon name="book" size={16} />Explain this</button>
                {approved && revisionApproval ? (
                  <span role="status">Editing this wording creates a new revision that needs approval.</span>
                ) : approved ? (
                  <button type="button" onClick={() => onUnapprove(section.id)}>Mark as draft</button>
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
                <p>{hasSelection ? "TED will edit the selected wording." : "TED will edit this section."}</p>
              </div>
              <button type="button" className={styles.aiClose} onClick={() => setShowTEdit(false)} aria-label="Close tEdit">
                <Icon name="x" size={18} />
              </button>
            </div>
            <EditWithTED
              streaming={ai.streaming}
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
              <button type="button" className={styles.aiClose} onClick={() => setShowExplainPanel(false)} aria-label="Close explanation">
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
