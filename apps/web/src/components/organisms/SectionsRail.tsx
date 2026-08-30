"use client";

import type { ProofreadSectionResult } from "@prompted/shared";
import type { Section } from "@prompted/shared";
import styles from "./SectionsRail.module.css";

interface SectionsRailProps {
  sections: Section[];
  activeSectionId: string | null;
  onSelect: (id: string) => void;
  /** Latest proofread scan, if one has run \u2014 drives the per-card counts. */
  proofread: ProofreadSectionResult[] | null;
}

/**
 * Right-hand rail: a portrait preview card per section, numbered in document
 * order, showing proofread findings ("2 corrections, 1 improvement") once a
 * scan has run, or approval status otherwise. Matches the reference design's
 * "Sections / Portrait previews of the official document" panel.
 */
export function SectionsRail({ sections, activeSectionId, onSelect, proofread }: SectionsRailProps) {
  return (
    <aside className={styles.wrap} aria-label="Sections">
      <h2 className={styles.heading}>Sections</h2>
      <p className={styles.sub}>Portrait previews of the official document</p>
      <ul className={styles.list}>
        {sections.map((section, index) => {
          const entry = proofread?.find((r) => r.id === section.id);
          const corrections = entry?.corrections.length ?? 0;
          const improvements = entry?.improvements.length ?? 0;
          const active = section.id === activeSectionId;

          let statusLine: string;
          if (entry) {
            const parts: string[] = [];
            if (corrections > 0) parts.push(`${corrections} correction${corrections === 1 ? "" : "s"}`);
            if (improvements > 0) parts.push(`${improvements} improvement${improvements === 1 ? "" : "s"}`);
            statusLine = parts.length > 0 ? parts.join(", ") : "No corrections";
          } else {
            statusLine = section.status === "approved" ? "Ready" : "Not yet reviewed";
          }

          return (
            <li key={section.id}>
              <button
                type="button"
                className={`${styles.card}${active ? ` ${styles.active}` : ""}`}
                onClick={() => onSelect(section.id)}
                aria-current={active}
              >
                <span className={styles.thumb} aria-hidden="true">
                  <span className={styles.thumbLine} />
                  <span className={styles.thumbLine} />
                  <span className={styles.thumbLineShort} />
                </span>
                <span className={styles.meta}>
                  <span className={styles.number}>{index + 1}</span>
                  <span className={styles.name}>{section.name}</span>
                  <span className={styles.status}>{statusLine}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
