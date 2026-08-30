"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type { BrandKit, SectionVersion } from "@prompted/shared/browser";
import type { DocumentExportFormat } from "@prompted/shared/api-client";
import { Icon } from "@/components/atoms/Icon";
import { OptionalPanelBoundary } from "@/components/molecules/OptionalPanelBoundary";
import { SectionEditor } from "./SectionEditor";
import type { UseWorkspace } from "@/hooks/useWorkspace";
import { fetchSectionVersionHistory } from "@/lib/api/sections";
import styles from "./WorkspacePane.module.css";

const LivePreview = dynamic(
  () => import("./LivePreview").then((module) => module.LivePreview),
  {
    ssr: false,
    loading: () => <p role="status">Loading document preview…</p>,
  },
);

const VersionHistory = dynamic(
  () => import("./VersionHistory").then((module) => module.VersionHistory),
  {
    ssr: false,
    loading: () => <p role="status">Loading version history…</p>,
  },
);

const FORMAT_OPTIONS: { value: DocumentExportFormat; label: string; icon: string }[] = [
  { value: "pdf", label: "PDF", icon: "file-type-pdf" },
  { value: "word", label: "Word document", icon: "file-type-doc" },
  { value: "excel", label: "Spreadsheet", icon: "file-type-xls" },
];

const RAIL_EXCERPT_LIMIT = 120;

function railExcerpt(content: string): string {
  const text = content
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{TED_PLACEHOLDER:[^}]+\}\}/g, "Needs input")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/&(nbsp|#160|#xA0);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "No wording yet";
  return text.length <= RAIL_EXCERPT_LIMIT
    ? text
    : `${text.slice(0, RAIL_EXCERPT_LIMIT - 1).trimEnd()}…`;
}

interface WorkspacePaneProps {
  workspace: UseWorkspace;
  brandKit?: BrandKit | null;
  exporting?: boolean;
  exportError?: string | null;
  onExport: (format: DocumentExportFormat) => void;
  allowedFormats?: DocumentExportFormat[];
}

export interface WorkspacePaneHandle {
  triggerExport: () => void;
  openPreview: () => void;
}

interface TouchStart {
  x: number;
  y: number;
  fromMargin: boolean;
}

export const WorkspacePane = forwardRef<WorkspacePaneHandle, WorkspacePaneProps>(function WorkspacePane({
  workspace,
  brandKit,
  exporting = false,
  exportError,
  onExport,
  allowedFormats,
}, ref) {
  const [showPreview, setShowPreview] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [persistedHistory, setPersistedHistory] = useState<SectionVersion[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pageButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<TouchStart | null>(null);

  const { section, sections, activeSection, activeSectionId, selectSection, versionHistory } = workspace;
  const activeIndex = useMemo(
    () => sections.findIndex((item) => item.id === activeSectionId),
    [sections, activeSectionId],
  );
  const total = sections.length;
  const current = activeSection ?? sections[0] ?? null;

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryError(null);
    if (!current) return;
    setHistoryLoading(true);
    try {
      setPersistedHistory(await fetchSectionVersionHistory(current.id));
    } catch {
      setHistoryError("Version history could not be loaded. The editor is still available.");
    } finally {
      setHistoryLoading(false);
    }
  }, [current]);

  const visibleFormats = allowedFormats
    ? FORMAT_OPTIONS.filter((format) => allowedFormats.includes(format.value))
    : FORMAT_OPTIONS.filter((format) => format.value !== "excel");

  function sectionNeedsAttention(sectionId: string): boolean {
    return workspace.generationIssues.some((issue) => issue.sectionId === sectionId) ||
      workspace.missingInfoQuestions.some((question) => question.sectionId === sectionId);
  }

  function goTo(index: number) {
    const target = sections[index];
    if (target) selectSection(target.id);
  }

  function openFocusedEditor() {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 700px)").matches) setExpanded(true);
  }

  function closeFocusedEditor() {
    setExpanded(false);
    window.setTimeout(() => pageButtonRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFocusedEditor();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  function beginTouch(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    const width = window.innerWidth;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      fromMargin: touch.clientX <= 44 || touch.clientX >= width - 44,
    };
  }

  function endTouch(event: React.TouchEvent) {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
      closeFocusedEditor();
      return;
    }
    if (!start.fromMargin || Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) goTo(activeIndex + 1);
    else goTo(activeIndex - 1);
  }

  function exportDefault() {
    const first = visibleFormats[0];
    if (first) onExport(first.value);
  }

  useImperativeHandle(ref, () => ({
    triggerExport: exportDefault,
    openPreview: () => setShowPreview(true),
  }));

  return (
    <div className={`${styles.workspace}${expanded ? ` ${styles.expanded}` : ""}`}>
      <header className={styles.bar}>
        <div className={styles.nav} data-tour="ws-sections">
          <button type="button" className={styles.chev} onClick={() => goTo(activeIndex - 1)} disabled={activeIndex <= 0} aria-label="Previous section">
            <Icon name="chevron-left" size={18} />
          </button>
          <div className={styles.select}>
            <select className={styles.selectInput} value={activeSectionId ?? ""} onChange={(event) => selectSection(event.target.value)} aria-label="Choose a section">
              {sections.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {index + 1}. {item.name}{sectionNeedsAttention(item.id) ? " — needs attention" : ""}
                </option>
              ))}
            </select>
            <span className={styles.selectIcon} aria-hidden="true"><Icon name="chevron-down" size={16} /></span>
          </div>
          <button type="button" className={styles.chev} onClick={() => goTo(activeIndex + 1)} disabled={activeIndex < 0 || activeIndex >= total - 1} aria-label="Next section">
            <Icon name="chevron-right" size={18} />
          </button>
          {total > 0 && activeIndex >= 0 && <span className={styles.counter}>{activeIndex + 1} of {total}</span>}
        </div>

        <div className={styles.menuWrap}>
          {exportError && <span className={styles.menuIssue} title={exportError}><Icon name="alert-circle" size={16} /></span>}
          <button type="button" className={styles.menuButton} aria-label="Document options" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            <Icon name="dots-vertical" size={20} />
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" onClick={() => { setShowPreview(true); setMenuOpen(false); }}>
                <Icon name="eye" size={17} />Preview document
              </button>
              <button type="button" role="menuitem" onClick={() => { void openHistory(); setMenuOpen(false); }}>
                <Icon name="history" size={17} />Version history
              </button>
              <div className={styles.menuDivider} />
              {visibleFormats.map((format) => (
                <button
                  key={format.value}
                  type="button"
                  role="menuitem"
                  disabled={!workspace.canExport || exporting}
                  onClick={() => { onExport(format.value); setMenuOpen(false); }}
                  data-tour={format.value === visibleFormats[0]?.value ? "ws-export" : undefined}
                >
                  <Icon name={format.icon} size={17} />
                  {exporting ? "Preparing…" : `Export ${format.label}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {expanded && (
        <div className={styles.focusedHeader}>
          <button type="button" className={styles.closeFocused} onClick={closeFocusedEditor} aria-label="Close focused editor">
            <Icon name="chevron-down" size={21} />
          </button>
          <strong>{current?.name}</strong>
          <span>{activeIndex + 1} of {total}</span>
        </div>
      )}

      <div className={styles.main} data-tour="ws-editor" onTouchStart={expanded ? beginTouch : undefined} onTouchEnd={expanded ? endTouch : undefined}>
        <div className={styles.documentViewport}>
          <button
            ref={pageButtonRef}
            type="button"
            className={styles.expandTarget}
            onClick={openFocusedEditor}
            aria-label={expanded ? undefined : "Open this section in the focused mobile editor"}
            tabIndex={expanded ? -1 : 0}
          >
            <span className={styles.expandHint}>Tap to edit full screen</span>
          </button>
          <article className={styles.documentPage} aria-label={`Edit ${workspace.title}`}>
            {current && (
              <section key={current.id} className={`${styles.documentSection} ${styles.documentSectionActive}`} aria-labelledby={`document-section-${current.id}`}>
                <h2 id={`document-section-${current.id}`}>{current.name}</h2>
                <SectionEditor
                  key={current.id}
                  section={current}
                  documentMode
                  onEdit={section.editContent}
                  onApprove={workspace.captured
                    ? () => void workspace.approveDocument()
                    : section.approve}
                  onUnapprove={section.unapprove}
                  onToggleLock={section.toggleLock}
                  onOpenHistory={() => void openHistory()}
                  onPlaceholderSelect={workspace.selectMissingPlaceholder}
                  revisionApproval={workspace.captured}
                />
              </section>
            )}
          </article>
        </div>

        <aside className={styles.previewRail} aria-label="Document sections">
          <div className={styles.previewRailHead}><span>Sections</span></div>
          <div className={styles.previewList}>
            {sections.map((item, index) => {
              const needsAttention = sectionNeedsAttention(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.previewCard}${item.id === activeSectionId ? ` ${styles.previewCardActive}` : ""}`}
                  onClick={() => selectSection(item.id)}
                  aria-label={`${index + 1}. ${item.name}${needsAttention ? ", needs attention" : ""}`}
                >
                  <span className={styles.previewPage} aria-hidden="true">
                    <span className={styles.previewPageInner}>
                      <h3>{item.name}</h3>
                      <p>{railExcerpt(item.content)}</p>
                    </span>
                  </span>
                  <span className={styles.previewMeta}>
                    <span className={styles.previewName}>{index + 1}. {item.name}</span>
                    <span className={styles.previewStatus}>
                      {needsAttention ? "Needs attention" : item.status === "approved" ? "Approved" : "Draft"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {showPreview && (
        <div className={styles.previewOverlay} role="dialog" aria-modal="true" aria-label="Document preview">
          <button type="button" className={styles.previewClose} onClick={() => setShowPreview(false)} aria-label="Close preview">
            <Icon name="x" size={20} />
          </button>
          <OptionalPanelBoundary
            label="Document preview"
            onClose={() => setShowPreview(false)}
          >
            <LivePreview title={workspace.title} sections={sections} lede={workspace.situation} brandKit={brandKit} />
          </OptionalPanelBoundary>
        </div>
      )}

      {historyOpen && historyLoading ? (
        <div role="dialog" aria-modal="true" aria-label="Version history">
          <p role="status">Loading version history…</p>
          <button type="button" onClick={() => setHistoryOpen(false)}>Close</button>
        </div>
      ) : historyOpen && historyError ? (
        <div role="dialog" aria-modal="true" aria-label="Version history">
          <p role="alert">{historyError}</p>
          <button type="button" onClick={() => void openHistory()}>Try again</button>
          <button type="button" onClick={() => setHistoryOpen(false)}>Close</button>
        </div>
      ) : historyOpen ? (
        <OptionalPanelBoundary
          label="Version history"
          onClose={() => setHistoryOpen(false)}
        >
          <VersionHistory
            open
            versions={persistedHistory ?? versionHistory.versionsFor(activeSection)}
            onClose={() => setHistoryOpen(false)}
            onRestore={(version) => {
              if (activeSection) versionHistory.restore(activeSection.id, version);
              setHistoryOpen(false);
            }}
          />
        </OptionalPanelBoundary>
      ) : null}
    </div>
  );
});
