"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Domain } from "@prompted/shared/browser";
import { TEMPLATES, templatesByDomain } from "@prompted/shared/catalogue";
import { Icon } from "@/components/atoms/Icon";
import styles from "./BrowseModal.module.css";

interface BrowseModalProps {
  open: boolean;
  onClose: () => void;
  /** Choosing a template fills the composer with a starting line. */
  onPick?: (templateName: string) => void;
}

const DOMAIN_LABELS: Record<Domain, string> = {
  employment: "Work & jobs",
  education: "Study & applications",
  business: "Business",
  personal: "Personal",
  finance: "Money",
};

const DOMAIN_ORDER: Domain[] = ["employment", "education", "business", "finance", "personal"];

/**
 * BrowseModal — searchable, categorised list of the V1 templates. Selecting a
 * template seeds the composer (never auto-submits — same rule as example chips).
 */
export function BrowseModal({ open, onClose, onPick }: BrowseModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return TEMPLATES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.plain_description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [query]);

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="browse-title">
        <div className={styles.header}>
          <h2 id="browse-title" className={styles.title}>
            Browse situations
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className={styles.search}>
          <Icon name="search" size={18} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search templates…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search templates"
          />
        </div>

        <div className={styles.body}>
          {results ? (
            results.length === 0 ? (
              <p className={styles.empty}>
                No templates match &ldquo;{query}&rdquo;. Try telling TED what you need in your own
                words.
              </p>
            ) : (
              <ul className={styles.grid}>
                {results.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={styles.templateBtn}
                      onClick={() => {
                        onPick?.(t.name);
                        onClose();
                      }}
                    >
                      <span className={styles.templateName}>{t.name}</span>
                      <span className={styles.templateDesc}>{t.plain_description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            DOMAIN_ORDER.map((domain) => {
              const items = templatesByDomain(domain);
              if (items.length === 0) return null;
              return (
                <section key={domain} className={styles.category}>
                  <h3 className={styles.categoryTitle}>{DOMAIN_LABELS[domain]}</h3>
                  <ul className={styles.grid}>
                    {items.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={styles.templateBtn}
                          onClick={() => {
                            onPick?.(t.name);
                            onClose();
                          }}
                        >
                          <span className={styles.templateName}>{t.name}</span>
                          <span className={styles.templateDesc}>{t.plain_description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
