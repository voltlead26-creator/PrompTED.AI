"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/atoms/Badge";
import { Icon } from "@/components/atoms/Icon";
import { Spinner } from "@/components/atoms/Spinner";
import type { BadgeStatus } from "@/components/atoms/Badge";
import { useLibrary } from "@/hooks/useLibrary";
import type { LibraryTab } from "@/hooks/useLibrary";
import type { Outcome, Document } from "@prompted/shared";
import styles from "./LibraryList.module.css";

function outcomeStatus(outcome: Outcome, docs: Document[]): BadgeStatus {
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
  outcome: Outcome;
  documents: Document[];
  onToggleSaved: () => void;
}

function DocumentCard({ outcome, documents, onToggleSaved }: DocumentCardProps) {
  const status = outcomeStatus(outcome, documents);
  const primaryDoc = documents[0];
  const title = primaryDoc?.title ?? outcome.situation_text.slice(0, 60);

  return (
    <article className={styles.card}>
      <div className={styles.cardMain}>
        <Link
          href={`/outcomes/${outcome.id}`}
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
        >
          <Icon
            name={outcome.is_saved ? "bookmark-filled" : "bookmark"}
            size={18}
          />
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
          {documents.length > 3 && (
            <li className={styles.docMore}>+{documents.length - 3} more</li>
          )}
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

export function LibraryList({ userId: _userId }: LibraryListProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>("recents");
  const { items, loading, error, hasMore, load, toggleSaved } = useLibrary(activeTab);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <section className={styles.section} aria-label="Your documents">
      <div className={styles.tabs} role="tablist" aria-label="Library tabs">
        {(Object.keys(TAB_LABELS) as LibraryTab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            className={styles.tab}
            data-active={activeTab === tab || undefined}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TAB_LABELS[activeTab]}>
        {loading && items.length === 0 ? (
          <div className={styles.loading}>
            <Spinner label="Loading your documents…" />
          </div>
        ) : error ? (
          <p className={styles.error} role="alert">{error}</p>
        ) : items.length === 0 ? (
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
              {items.map(({ outcome, documents }) => (
                <li key={outcome.id}>
                  <DocumentCard
                    outcome={outcome}
                    documents={documents}
                    onToggleSaved={() => toggleSaved(outcome.id, outcome.is_saved)}
                  />
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className={styles.loadMore}>
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={() => load(false)}
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
