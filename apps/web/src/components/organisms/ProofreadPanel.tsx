"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  proofreadDocument,
  type ProofreadItem,
  type ProofreadSectionResult,
} from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import styles from "./ProofreadPanel.module.css";

interface ProofreadPanelProps {
  sections: Section[];
  domain?: string;
  /** Apply approved wording to a section through the versioned edit path. */
  onApply: (sectionId: string, nextContent: string) => void;
  /** Mirrors scan results up so the Sections rail can show per-section counts. */
  onResultsChange?: (results: ProofreadSectionResult[] | null) => void;
  /** Section to show corrections/improvements for; defaults to the first with items. */
  activeSectionId?: string | null;
  /** Starts the first scan after this lazy panel has mounted. */
  autoScan?: boolean;
}

/**
 * Proofread review sidebar (spec 2026-07-07 / reference layout): a
 * whole-document scan grouped by section, shown one section at a time via
 * pill tabs \u2014 matching the "Personal Details / Summary / Experience"
 * tab row in the reference design. Corrections and improvements are listed
 * separately with approve (tick) / reject (X) bottom-right per item.
 * Nothing is applied without explicit approval.
 */
export interface ProofreadPanelHandle {
  scan: () => void;
}

export const ProofreadPanel = forwardRef<ProofreadPanelHandle, ProofreadPanelProps>(function ProofreadPanel({
  sections,
  domain,
  onApply,
  onResultsChange,
  activeSectionId,
  autoScan = false,
}, ref) {
  const { user } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProofreadSectionResult[] | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const autoScanRequestedRef = useRef(false);

  const pushResults = useCallback(
    (next: ProofreadSectionResult[] | null) => {
      setResults(next);
      onResultsChange?.(next);
    },
    [onResultsChange],
  );

  const scan = useCallback(async () => {
    if (!user?.id) {
      setError("Sign in again before asking TED to proofread this document.");
      return;
    }
    const requestContext = captureOwnerDispatch(user.id);
    setScanning(true);
    setError(null);
    try {
      const payload = sections
        .filter((s) => (s.content ?? "").trim())
        .map((s) => ({ id: s.id, key: s.key, label: s.name, content: s.content }));
      const res = await proofreadDocument({ sections: payload, domain }, requestContext);
      requestContext.assertCurrent();
      pushResults(res.sections);
      setTab(res.sections[0]?.id ?? null);
    } catch {
      if (ownerDispatchIsCurrent(requestContext)) {
        setError("TED couldn't finish the proofread. Try again in a moment.");
      }
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setScanning(false);
    }
  }, [sections, domain, pushResults, user?.id]);

  useImperativeHandle(ref, () => ({ scan: () => void scan() }));

  useEffect(() => {
    if (!autoScan || autoScanRequestedRef.current) return;
    autoScanRequestedRef.current = true;
    void scan();
  }, [autoScan, scan]);

  const resolveItem = useCallback(
    (sectionId: string, item: ProofreadItem, kind: "corrections" | "improvements", approve: boolean) => {
      if (approve) {
        const target = sections.find((s) => s.id === sectionId);
        const occurrences = target
          ? target.content.split(item.original_snippet).length - 1
          : 0;
        if (!target || occurrences === 0) {
          // The section was edited after the scan; applying now would
          // silently do nothing. Say so instead of pretending it worked,
          // and keep the item in the list.
          setError("That text has changed since the scan \u2014 run Proofread again to refresh suggestions.");
          return;
        }
        if (occurrences > 1) {
          // Ambiguous target: replacing the first occurrence could patch
          // the wrong instance. Refuse rather than guess.
          setError("That wording appears more than once in the section \u2014 edit it by hand or re-run Proofread for a more specific suggestion.");
          return;
        }
        setError(null);
        onApply(sectionId, target.content.replace(item.original_snippet, item.revised_snippet));
      }
      pushResults(
        (results ?? [])
          .map((entry) =>
            entry.id === sectionId
              ? { ...entry, [kind]: entry[kind].filter((i) => i !== item) }
              : entry,
          )
          .filter((entry) => entry.corrections.length + entry.improvements.length > 0),
      );
    },
    [sections, onApply, results, pushResults],
  );

  const total = (results ?? []).reduce(
    (sum, s) => sum + s.corrections.length + s.improvements.length,
    0,
  );

  // Tabs list every scanned section (even clean ones) so the row matches
  // the document structure, not just the ones with findings.
  const tabOrder = sections.filter((s) => (results ?? []).some((r) => r.id === s.id) || s.id === tab);
  const effectiveTab = tab && tabOrder.some((s) => s.id === tab)
    ? tab
    : (activeSectionId && tabOrder.some((s) => s.id === activeSectionId) ? activeSectionId : tabOrder[0]?.id ?? null);
  const activeEntry = results?.find((r) => r.id === effectiveTab) ?? null;

  return (
    <aside className={styles.wrap} aria-label="Proofread review">
      <h2 className={styles.heading}>Proofread review</h2>
      <p className={styles.sub}>Whole-document scan by section</p>

      {/* Text must always contain "Proofread" \u2014 the header's Proofread
          button (WorkspaceScreen.clickWorkspaceAction) finds and clicks
          whichever on-page button's text matches it by substring. Renaming
          this without keeping that word breaks the header trigger silently. */}
      <button type="button" className={styles.scanBtn} onClick={scan} disabled={scanning}>
        {scanning ? "Proofreading\u2026" : results ? "Proofread again" : "Proofread document"}
      </button>
      {error && <p className={styles.error}>{error}</p>}

      {results && results.length === 0 && (
        <p className={styles.clean}>No issues found \u2014 the document reads clean.</p>
      )}

      {results && results.length > 0 && (
        <>
          <div className={styles.tabs} role="tablist">
            {tabOrder.map((s) => {
              const entry = results.find((r) => r.id === s.id);
              const count = entry ? entry.corrections.length + entry.improvements.length : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={effectiveTab === s.id}
                  className={`${styles.tab}${effectiveTab === s.id ? ` ${styles.tabActive}` : ""}`}
                  onClick={() => setTab(s.id)}
                >
                  {s.name}
                  {count > 0 && <span className={styles.tabCount}>{count}</span>}
                </button>
              );
            })}
          </div>

          {activeEntry ? (
            <>
              {(["corrections", "improvements"] as const).map((kind) =>
                activeEntry[kind].length > 0 ? (
                  <div key={kind} className={styles.kindBlock}>
                    <p className={styles.kind}>
                      {kind === "corrections" ? "Corrections" : "Improvements"}
                      <span className={styles.count}>{activeEntry[kind].length} found</span>
                    </p>
                    <ul className={styles.items}>
                      {activeEntry[kind].map((item, idx) => (
                        <li key={`${activeEntry.id}-${kind}-${idx}`} className={styles.item}>
                          <p className={styles.itemTitle}>{item.title}</p>
                          <p className={styles.snippet}>
                            <span className={styles.original}>{item.original_snippet}</span>
                          </p>
                          {item.why && (
                            <p className={styles.why}><strong>Why:</strong> {item.why}</p>
                          )}
                          <div className={styles.approvals}>
                            <button
                              type="button"
                              className={styles.approve}
                              aria-label="Approve this change"
                              onClick={() => resolveItem(activeEntry.id, item, kind, true)}
                            >
                              \u2713
                            </button>
                            <button
                              type="button"
                              className={styles.reject}
                              aria-label="Reject this change"
                              onClick={() => resolveItem(activeEntry.id, item, kind, false)}
                            >
                              \u2715
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </>
          ) : (
            <p className={styles.clean}>This section is clean \u2014 nothing to review.</p>
          )}
        </>
      )}

      <p className={styles.rule}>
        Final rule: TED can suggest changes, but every correction and enhancement stays
        pending until you tick or reject it{total > 0 ? ` (${total} pending)` : ""}.
      </p>
    </aside>
  );
});
