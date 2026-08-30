"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Section } from "@prompted/shared/browser";
import { renderSectionHtml } from "@prompted/shared/export";
import type { ImportFidelityReport } from "./import-fidelity";
import styles from "./ImportReviewPanel.module.css";

export interface ImportReviewPanelProps {
  title: string;
  initialSections: Section[];
  fidelity: ImportFidelityReport;
  onBack: () => void;
  onConfirm: (sections: Section[]) => void | Promise<void>;
  busy?: boolean;
}

function reindex(sections: Section[]): Section[] {
  return sections.map((section, index) => ({ ...section, order_index: index }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ImportReviewPanel({
  initialSections,
  fidelity,
  onBack,
  onConfirm,
  busy = false,
}: ImportReviewPanelProps) {
  const [sections, setSections] = useState(() => reindex(initialSections));
  const [activeSectionId, setActiveSectionId] = useState(initialSections[0]?.id ?? "");
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const activeIndex = Math.max(0, sections.findIndex((section) => section.id === activeSectionId));
  const activeSection = sections[activeIndex];
  const activeConfidence = activeSection
    ? fidelity.confidenceBySectionId[activeSection.id] ?? "medium"
    : "medium";
  const activeEvidence = activeSection
    ? fidelity.evidenceBySectionId[activeSection.id] ?? []
    : [];

  // Auto-resize the content textarea to fit its section: large content uses
  // the available screen space instead of scrolling inside a small fixed
  // box, while short content still respects the CSS min-height floor.
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const resizeContent = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => {
    resizeContent();
  }, [activeSection?.content, resizeContent]);

  const updateSection = (index: number, patch: Partial<Section>) => {
    setSections((current) => current.map((section, itemIndex) => (
      itemIndex === index ? { ...section, ...patch } : section
    )));
  };

  const removeSection = (index: number) => {
    const next = reindex(sections.filter((_, itemIndex) => itemIndex !== index));
    if (sections[index]?.id === activeSectionId) {
      setActiveSectionId(next[Math.min(index, next.length - 1)]?.id ?? "");
    }
    setSections(next);
    setPendingRemoveId(null);
  };

  const setActiveSection = (id: string) => {
    setActiveSectionId(id);
    setPendingRemoveId(null);
  };

  const mergeWithPrevious = (index: number) => {
    if (index <= 0) return;
    const previous = sections[index - 1];
    const selected = sections[index];
    if (!previous || !selected) return;
    const merged: Section = {
      ...previous,
      content: [previous.content.trim(), selected.content.trim()].filter(Boolean).join("\n\n"),
      updated_at: new Date().toISOString(),
    };
    setPendingRemoveId(null);
    setActiveSectionId(merged.id);
    setSections(reindex([
      ...sections.slice(0, index - 1),
      merged,
      ...sections.slice(index + 1),
    ]));
  };

  const splitSection = (index: number) => {
    const selected = sections[index];
    if (!selected) return;
    const paragraphs = selected.content.split(/\n\s*\n/).filter((part) => part.trim());
    if (paragraphs.length < 2) return;
    setPendingRemoveId(null);
    const midpoint = Math.ceil(paragraphs.length / 2);
    const now = new Date().toISOString();
    const first = { ...selected, content: paragraphs.slice(0, midpoint).join("\n\n"), updated_at: now };
    const second: Section = {
      ...selected,
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `section-${Date.now()}-${index}`,
      name: `${selected.name} — continued`,
      content: paragraphs.slice(midpoint).join("\n\n"),
      created_at: now,
      updated_at: now,
    };
    setActiveSectionId(first.id);
    setSections(reindex([...sections.slice(0, index), first, second, ...sections.slice(index + 1)]));
  };

  const valid = sections.length > 0 && sections.every(
    (section) => section.name.trim() && section.content.trim(),
  );

  return (
    <section className={styles.review} aria-label="Review imported document">
      <div className={styles.workspaceLayout}>
        <div className={styles.editorViewport}>
          {activeSection && (
            <article key={activeSection.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <label>
                  <span>Section {activeIndex + 1} name</span>
                  <input
                    value={activeSection.name}
                    onChange={(event) => updateSection(activeIndex, { name: event.target.value })}
                    disabled={busy}
                  />
                </label>
                <span className={`${styles.confidence} ${styles[activeConfidence]}`}>
                  {activeConfidence === "high" ? "Looks clear" : activeConfidence === "medium" ? "Check this" : "TED is unsure"}
                </span>
              </div>

              {activeEvidence.length > 0 && (
                <details className={styles.evidence}>
                  <summary>Why TED gave this confidence</summary>
                  <ul>{activeEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              )}

              <label className={styles.contentLabel}>
                <span>Content</span>
                <textarea
                  ref={contentRef}
                  value={activeSection.content}
                  onChange={(event) => updateSection(activeIndex, { content: event.target.value })}
                  disabled={busy}
                  className={styles.contentTextarea}
                />
              </label>

              <div className={styles.actions}>
                <button type="button" onClick={() => mergeWithPrevious(activeIndex)} disabled={busy || activeIndex === 0}>
                  Merge with previous
                </button>
                <button
                  type="button"
                  onClick={() => splitSection(activeIndex)}
                  disabled={busy || !/\n\s*\n/.test(activeSection.content)}
                >
                  Split in half
                </button>
                {pendingRemoveId === activeSection.id ? (
                  <span className={styles.confirmRemove}>
                    <span>Remove this section?</span>
                    <button
                      type="button"
                      className={styles.destructive}
                      onClick={() => removeSection(activeIndex)}
                      disabled={busy}
                    >
                      Confirm remove
                    </button>
                    <button type="button" onClick={() => setPendingRemoveId(null)} disabled={busy}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingRemoveId(activeSection.id)}
                    disabled={busy || sections.length === 1}
                  >
                    Remove section
                  </button>
                )}
              </div>
            </article>
          )}
        </div>

        <aside className={styles.sectionRail} aria-label="Imported document sections">
          <div className={styles.railHeader}>
            <strong>Sections</strong>
            <span>Choose a page to check it</span>
          </div>
          <div className={styles.previewList}>
            {sections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                className={`${styles.previewCard}${section.id === activeSection?.id ? ` ${styles.previewCardActive}` : ""}`}
                onClick={() => setActiveSection(section.id)}
                aria-label={`Edit section ${index + 1}: ${section.name}`}
                aria-current={section.id === activeSection?.id ? "true" : undefined}
              >
                <span className={styles.previewPage} aria-hidden="true">
                  <span
                    className={styles.previewPageInner}
                    dangerouslySetInnerHTML={{
                      __html: `<h3>${escapeHtml(section.name)}</h3>${renderSectionHtml(section.content)}`,
                    }}
                  />
                </span>
                <span className={styles.previewMeta}>
                  <span>{index + 1}. {section.name}</span>
                  <small>
                    {(fidelity.confidenceBySectionId[section.id] ?? "medium") === "high"
                      ? "Looks clear"
                      : "Needs review"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={onBack} disabled={busy}>
          Choose another file
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void onConfirm(reindex(sections))}
          disabled={busy || !valid}
        >
          {busy ? "Creating workspace…" : "Create workspace"}
        </button>
      </footer>
    </section>
  );
}
