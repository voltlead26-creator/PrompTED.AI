"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/atoms/Badge";
import { Icon } from "@/components/atoms/Icon";
import { Spinner } from "@/components/atoms/Spinner";
import type { BadgeStatus } from "@/components/atoms/Badge";
import { useLibrary } from "@/hooks/useLibrary";
import type { LibraryTab, LibraryOutcome, LibraryDocument, LibraryItem } from "@/hooks/useLibrary";
import styles from "./LibraryList.module.css";

function outcomeStatus(outcome: LibraryOutcome, docs: LibraryDocument[]): BadgeStatus {
  if (outcome.status === "completed") return "done";
  const anyApproved = docs.some((d) => d.status === "approved" || d.status === "exported");
  if (anyApproved) return "approved";
  const anyEdited = docs.some((d) => d.status === "edited");
  if (anyEdited) return "edited";
  return outcome.status === "in_progress" ? "in_progress" : "draft";
}

function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

interface DocumentCardProps {
  outcome: LibraryOutcome;
  documents: LibraryDocument[];
  manualPlan?: LibraryItem["manualPlan"];
  onToggleSaved: () => void;
  saving: boolean;
  disabled: boolean;
}

function DocumentCard({ outcome, documents, manualPlan, onToggleSaved, saving, disabled }: DocumentCardProps) {
  const status = outcomeStatus(outcome, documents);
  const primaryDoc = documents[0];
  const title = manualPlan
    ? (manualPlan.title.trim() ? manualPlan.title : "Untitled plan")
    : primaryDoc?.title ?? outcome.situation_text.slice(0, 60);
  const href = manualPlan
    ? `/plans?create=manual&plan=${encodeURIComponent(manualPlan.plan_id)}`
    : `/outcomes/${outcome.id}`;

  return (
    <article className={styles.card}>
      <div className={styles.cardMain}>
        <Link
          href={href}
          className={styles.cardLink}
          aria-label={`Open ${title}`}
        >
          <h3 className={styles.cardTitle}>{title}</h3>
          <div className={styles.cardMeta}>
            <Badge status={status} />
            <span className={styles.cardDate}>{formatRelativeDate(outcome.updated_at)}</span>
          </div>
        </Link>

        <button
          type="button"
          className={styles.saveBtn}
          onClick={onToggleSaved}
          aria-label={outcome.is_saved ? "Remove from saved" : "Save to library"}
          aria-pressed={outcome.is_saved}
          aria-busy={saving}
          disabled={disabled}
        >
          <Icon name={outcome.is_saved ? "bookmark-filled" : "bookmark"} size={18} />
        </button>
      </div>

      {documents.length > 1 && (
        <ul className={styles.docList} aria-label="Documents in this outcome">
          {documents.slice(0, 3).map((doc) => (
            <li key={doc.id} className={styles.docItem}>
              <Icon name="file-text" size={14} aria-hidden="true" />
              <span>{doc.title}</span>
            </li>
          ))}
          {documents.length > 3 && <li className={styles.docMore}>+{documents.length - 3} more</li>}
        </ul>
      )}
    </article>
  );
}

interface LibraryListProps {
  userId: string;
}

const TAB_LABELS: Record<LibraryTab, string> = {
  recents: "Recents",
  saved: "Saved",
  templates: "Your Templates",
};

export function LibraryList({ userId }: LibraryListProps) {
  return <LibraryContent key={userId} />;
}

function LibraryContent() {
  const [activeTab, setActiveTab] = useState<LibraryTab>("recents");
  const { items, loading, error, hasMore, load, toggleSaved, saveError, savingIds } =
    useLibrary(activeTab);
  const id = useId();
  const tabButtons = useRef<Partial<Record<LibraryTab, HTMLButtonElement | null>>>({});
  const tabs = Object.keys(TAB_LABELS) as LibraryTab[];

  useEffect(() => {
    void load(true);
  }, [load]);

  return (
    <section className={styles.section} aria-label="Your documents">
      <div className={styles.tabs} role="tablist" aria-label="Library tabs">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            id={`${id}-${tab}`}
            aria-controls={`${id}-panel`}
            tabIndex={activeTab === tab ? 0 : -1}
            ref={(element) => {
              tabButtons.current[tab] = element;
            }}
            className={styles.tab}
            data-active={activeTab === tab || undefined}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              const nextTab = tabs[next];
              if (!nextTab) return;
              event.preventDefault();
              setActiveTab(nextTab);
              tabButtons.current[nextTab]?.focus();
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${activeTab}`}
        tabIndex={0}
        aria-busy={loading}
      >
        {(error || saveError) && (
          <div className={styles.error}>
            <p role="alert">{error || saveError}</p>
            <button
              type="button"
              className={styles.loadMoreBtn}
              disabled={loading}
              onClick={() => {
                void load(true);
              }}
            >
              Refresh library
            </button>
          </div>
        )}
        {loading && items.length === 0 ? (
          <div className={styles.loading}>
            <Spinner label="Loading your documents…" />
          </div>
        ) : items.length === 0 && !error ? (
          <div className={styles.empty}>
            <p>
              {activeTab === "saved"
                ? "No saved documents yet. Tap the bookmark on any document to save it."
                : activeTab === "templates"
                  ? "No custom templates yet."
                  : "No documents yet. Head to Home to get started."}
            </p>
            {activeTab === "recents" && (
              <Link href="/home" className={styles.emptyAction}>
                Start something new →
              </Link>
            )}
          </div>
        ) : (
          <>
            <ul className={styles.list}>
              {items.map(({ outcome, documents, manualPlan }) => (
                <li key={outcome.id}>
                  <DocumentCard
                    outcome={outcome}
                    documents={documents}
                    manualPlan={manualPlan}
                    onToggleSaved={() => {
                      void toggleSaved(outcome.id, outcome.is_saved);
                    }}
                    saving={savingIds.includes(outcome.id)}
                    disabled={
                      loading || Boolean(error || saveError) || savingIds.includes(outcome.id)
                    }
                  />
                </li>
              ))}
            </ul>

            {hasMore && !error && (
              <div className={styles.loadMore}>
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={() => {
                    void load(false);
                  }}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
