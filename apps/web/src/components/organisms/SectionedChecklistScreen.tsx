"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChecklistItem, EditAction } from "@prompted/shared";
import { useChecklist } from "@/hooks/useChecklist";
import { useEditWithTED } from "@/hooks/useEditWithTED";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { StatusCheckbox } from "@/components/atoms/StatusCheckbox";
import { EditWithTED } from "./EditWithTED";
import { TedChangeReview } from "./TedChangeReview";
import styles from "./SectionedChecklistScreen.module.css";

const SEP = "␟";

function splitItem(text: string) {
  const index = text.indexOf(SEP);
  return index < 0
    ? { section: "General", text }
    : { section: text.slice(0, index).trim() || "General", text: text.slice(index + 1).trim() };
}

interface PendingChange {
  outcomeId: string;
  userId: string;
  epoch: number;
  itemId: string;
  section: string;
  originalText: string;
  suggested: string;
  changes: string[];
  action: EditAction;
  instruction?: string;
}

export function SectionedChecklistScreen({ outcomeId }: { outcomeId: string }) {
  const checklist = useChecklist(outcomeId);
  const editor = useEditWithTED();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showTEdit, setShowTEdit] = useState(false);
  const [pendingSnapshot, setPending] = useState<PendingChange | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const requestRef = useRef<symbol | null>(null);
  const currentRef = useRef({ outcomeId, epoch: 0, checklist });
  const previous = currentRef.current;
  if (previous.outcomeId !== outcomeId) requestRef.current = null;
  currentRef.current = {
    outcomeId,
    epoch: previous.epoch + Number(previous.outcomeId !== outcomeId),
    checklist,
  };
  const pending = pendingSnapshot?.outcomeId === outcomeId && pendingSnapshot.epoch === currentRef.current.epoch
    ? pendingSnapshot : null;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      currentRef.current.epoch += 1;
      requestRef.current = null;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, Array<{ item: ChecklistItem; label: string }>>();
    for (const item of checklist.items) {
      const parsed = splitItem(item.text);
      const list = map.get(parsed.section) ?? [];
      list.push({ item, label: parsed.text });
      map.set(parsed.section, list);
    }
    return Array.from(map.entries());
  }, [checklist.items]);

  const selectedItem = checklist.items.find((item) => item.id === selectedItemId) ?? checklist.items[0] ?? null;
  const selectedItemSaving = selectedItem ? checklist.isSavingItem(selectedItem.id) : false;

  if (checklist.loading) return <><Spinner label="Loading plan" />{renderReview()}</>;
  if (checklist.error) {
    return (
      <>
        <div role="alert">
          <p>{checklist.error}</p>
          <button type="button" onClick={() => void checklist.retry()}>Try again</button>
        </div>
        {renderReview()}
      </>
    );
  }
  if (!checklist.items.length) return <><p>No checklist items were generated.</p>{renderReview()}</>;

  function sameLifetime(accepted: Pick<PendingChange, "outcomeId" | "epoch">): boolean {
    return mountedRef.current && accepted.outcomeId === currentRef.current.outcomeId &&
      accepted.epoch === currentRef.current.epoch;
  }

  function currentSource(accepted: Pick<PendingChange, "outcomeId" | "epoch" | "itemId" | "userId" | "originalText">): ChecklistItem | null {
    const live = currentRef.current.checklist;
    if (!sameLifetime(accepted) || live.loading || live.error || live.isSavingItem(accepted.itemId)) return null;
    const item = live.items.find((candidate) => candidate.id === accepted.itemId);
    return item && item.outcome_id === accepted.outcomeId && item.user_id === accepted.userId &&
      item.text === accepted.originalText ? item : null;
  }

  async function requestEdit(action: EditAction, instruction?: string, reviewed?: PendingChange) {
    if (requestRef.current || (pending && reviewed !== pending)) return;
    const live = currentRef.current;
    const item = reviewed ? currentSource(reviewed) : selectedItem;
    const parsed = item ? splitItem(item.text) : null;
    if (reviewed && !item) {
      setReviewNotice("This checklist item changed after TED prepared the suggestion. Discard it and review the latest item before editing again.");
      return;
    }
    if (!item || !parsed) return;
    const accepted = {
      outcomeId: live.outcomeId,
      userId: item.user_id,
      epoch: live.epoch,
      itemId: item.id,
      section: parsed.section,
      originalText: item.text,
      action,
      instruction,
    };
    if (!currentSource(accepted)) return;
    const token = Symbol("checklist-edit");
    requestRef.current = token;
    setReviewNotice(null);
    try {
      const result = await editor.run({ action, content: parsed.text, instruction });
      if (requestRef.current !== token || !sameLifetime(accepted)) return;
      if (!currentSource(accepted)) {
        setReviewNotice("This checklist item changed while TED was preparing the suggestion. Review the latest item and try again.");
        return;
      }
      if (!result?.content.trim()) return;
      setPending({ ...accepted, suggested: result.content.trim(), changes: result.changes });
      setShowTEdit(false);
    } finally {
      if (requestRef.current === token) requestRef.current = null;
    }
  }

  async function applyChange() {
    if (!pending || checklist.isSavingItem(pending.itemId)) return;
    const accepted = pending;
    if (!currentSource(accepted)) {
      setReviewNotice("This checklist item changed after TED prepared the suggestion. Discard it and review the latest item before editing again.");
      return;
    }
    try {
      const saved = await currentRef.current.checklist.updateText(accepted.itemId, `${accepted.section}${SEP}${accepted.suggested}`);
      if (!sameLifetime(accepted)) return;
      if (saved) {
        setPending((current) => current === accepted ? null : current);
        setReviewNotice(null);
      } else {
        setReviewNotice("PrompTED could not confirm this change. Review the latest saved item before trying Apply again.");
      }
    } catch {
      // The hook exposes exact reconciliation or unconfirmed-save truth.
      // Keep the review open so the user does not lose the proposed wording.
    }
  }

  async function retryChange() {
    if (!pending) return;
    await requestEdit(pending.action, pending.instruction, pending);
  }

  function renderReview() {
    return pending && (
      <TedChangeReview
        suggested={pending.suggested}
        changes={pending.changes}
        explanation="TED has suggested clearer wording for this item. Nothing changes until you apply it."
        onDiscard={() => { setPending(null); setReviewNotice(null); }}
        onRetry={retryChange}
        onApply={applyChange}
        busy={checklist.isSavingItem(pending.itemId)}
        notice={reviewNotice || checklist.error || (checklist.loading ? "Checking the latest checklist. Your suggestion is retained; wait before applying it." : null) || checklist.saveError || editor.error}
        returnFocusRef={toolbarRef}
      />
    );
  }

  return (
    <section className={styles.screen} aria-label="Interactive checklist">
      <div className={styles.progressRow}>
        <h2>Your checklist</h2>
        <span>{checklist.done} of {checklist.total} complete</span>
      </div>
      <ProgressBar value={checklist.progress} label={`${Math.round(checklist.progress * 100)}% complete`} />

      <div className={styles.groups}>
        {groups.map(([section, rows]) => (
          <section key={section} className={styles.group}>
            <div className={styles.sectionHead}>
              <h3>{section}</h3>
              <span>{rows.filter(({ item }) => item.done).length} / {rows.length}</span>
            </div>
            <ul className={styles.list}>
              {rows.map(({ item, label }) => {
                const selected = item.id === selectedItem?.id;
                return (
                  <li key={item.id} className={styles.itemSlot}>
                    <div className={`${styles.item}${selected ? ` ${styles.selected}` : ""}${item.done ? ` ${styles.completedItem}` : ""}`}>
                      <StatusCheckbox
                        checked={item.done}
                        label={item.done ? `Mark ${label} as not done` : `Mark ${label} as done`}
                        onToggle={() => void checklist.toggleDone(item.id)}
                        disabled={checklist.isSavingItem(item.id)}
                      />
                      <button type="button" className={styles.selectItem} aria-pressed={selected} onClick={() => setSelectedItemId(item.id)}>
                        <span className={item.done ? styles.complete : ""}>{label}</span>
                        {item.reason ? <small>{item.reason}</small> : null}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {renderReview()}
      {!pending && reviewNotice && <p role="alert">{reviewNotice}</p>}
      <div ref={toolbarRef} tabIndex={-1} className={styles.contextBar} role="toolbar" aria-label="Edit selected checklist item">
        <button type="button" onClick={() => void requestEdit("expand")} disabled={!selectedItem || selectedItemSaving || editor.streaming || Boolean(pending)}>
          <Icon name="arrows-maximize" size={17} />Expand
        </button>
        <button type="button" onClick={() => void requestEdit("shorten")} disabled={!selectedItem || selectedItemSaving || editor.streaming || Boolean(pending)}>
          <Icon name="arrows-minimize" size={17} />Shorten
        </button>
        <button type="button" className={styles.primary} onClick={() => setShowTEdit(true)} disabled={!selectedItem || selectedItemSaving || Boolean(pending)} aria-expanded={showTEdit}>
          <Icon name="sparkles" size={17} />tEdit
        </button>
      </div>

      {showTEdit && (
        <aside className={styles.teditSheet} aria-label="tEdit selected checklist item">
          <div className={styles.sheetHead}>
            <div><strong>tEdit</strong><p>TED will suggest a change to the selected item.</p></div>
            <button type="button" onClick={() => setShowTEdit(false)} aria-label="Close tEdit"><span className={styles.closeSymbol} aria-hidden="true">×</span></button>
          </div>
          <EditWithTED
            streaming={editor.streaming}
            hasSelection={false}
            error={editor.error}
            onRun={requestEdit}
            onCancel={editor.cancel}
          />
        </aside>
      )}

      {!pending && checklist.saveError && <span className={styles.saving} role="status" aria-live="polite">{checklist.saveError}</span>}
      {checklist.savingItemIds.length > 0 && <span className={styles.saving} role="status" aria-live="polite">Saving change…</span>}
    </section>
  );
}
