"use client";

import { useState } from "react";
import type { SectionVersion } from "@prompted/shared";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { sanitiseSectionContent } from "@/lib/sanitise";
import styles from "./VersionHistory.module.css";

interface VersionHistoryProps {
  open: boolean;
  versions: SectionVersion[];
  onClose: () => void;
  onRestore: (version: SectionVersion) => void;
}

function looksLikeHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * VersionHistory — a dialog listing prior section versions. Selecting a version
 * previews its content; Restore replaces the current content (and itself
 * snapshots the current version, so history is never lost).
 */
export function VersionHistory({
  open,
  versions,
  onClose,
  onRestore,
}: VersionHistoryProps) {
  const [selected, setSelected] = useState<number>(0);

  if (!open) return null;

  const active = versions[selected];

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close version history"
        onClick={onClose}
      />
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
      >
        <div className={styles.head}>
          <h2 className={styles.title}>Version history</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        {versions.length === 0 ? (
          <p className={styles.empty}>
            No earlier versions yet. Edits you make will appear here.
          </p>
        ) : (
          <div className={styles.body}>
            <ul className={styles.list}>
              {versions.map((version, i) => (
                <li key={`${version.saved_at}-${i}`}>
                  <button
                    type="button"
                    className={`${styles.versionBtn} ${i === selected ? styles.versionActive : ""}`}
                    onClick={() => setSelected(i)}
                    aria-current={i === selected ? "true" : undefined}
                  >
                    <span className={styles.versionLabel}>
                      {i === 0 ? "Most recent" : `Version ${versions.length - i}`}
                    </span>
                    <time className={styles.versionTime}>
                      {formatTimestamp(version.saved_at)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>

            <div className={styles.preview}>
              {active &&
                (looksLikeHtml(active.content) ? (
                  <div
                    className={styles.previewBody}
                    dangerouslySetInnerHTML={{
                      __html: sanitiseSectionContent(active.content),
                    }}
                  />
                ) : (
                  <p className={styles.previewBody}>{active.content}</p>
                ))}
              <Button
                variant="primary"
                onClick={() => active && onRestore(active)}
                disabled={!active}
                leadingIcon={<Icon name="history" size={16} />}
              >
                Restore this version
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
