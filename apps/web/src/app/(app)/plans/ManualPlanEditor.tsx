"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditAction } from "@prompted/shared";
import { Icon } from "@/components/atoms/Icon";
import { TedChangeReview } from "@/components/organisms/TedChangeReview";
import { useEditWithTED } from "@/hooks/useEditWithTED";
import {
  createManualPlan,
  createManualPlanItem,
  loadGuestManualPlan,
  moveManualPlanItem,
  saveGuestManualPlan,
  type ManualPlanItem,
  type ManualPlanState,
} from "./manual-plan-store";
import styles from "./ManualPlanEditor.module.css";

interface PendingTedChange {
  itemId: string;
  suggested: string;
  changes: string[];
  action: EditAction;
  instruction?: string;
}

interface DeletedPlanItem {
  item: ManualPlanItem;
  index: number;
}

export function ManualPlanEditor({ planId }: { planId?: string | null }) {
  const [plan, setPlan] = useState<ManualPlanState | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [instruction, setInstruction] = useState("");
  const [pendingTedChange, setPendingTedChange] = useState<PendingTedChange | null>(null);
  const [lastDeleted, setLastDeleted] = useState<DeletedPlanItem | null>(null);
  const hydrated = useRef(false);
  const editor = useEditWithTED();

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const initial = (planId ? loadGuestManualPlan(planId) : null) ?? createManualPlan();
    setPlan(initial);
    setSelectedItemId(initial.items[0]?.id ?? null);
  }, [planId]);

  useEffect(() => {
    if (!plan || !hydrated.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const saved = saveGuestManualPlan({ ...plan, updatedAt: new Date().toISOString() });
      setSaveState(saved ? "saved" : "error");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [plan]);

  const selectedItem = useMemo(
    () => plan?.items.find((item) => item.id === selectedItemId) ?? null,
    [plan, selectedItemId],
  );

  if (!plan) return <div className={styles.loading}>Opening live editor…</div>;

  function updatePlan(mutator: (current: ManualPlanState) => ManualPlanState) {
    setPlan((current) => current ? mutator(current) : current);
  }

  function updateItem(itemId: string, patch: Partial<ManualPlanItem>) {
    updatePlan((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    }));
  }

  function addItem() {
    const item = createManualPlanItem();
    updatePlan((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedItemId(item.id);
  }

  function deleteItem(itemId: string) {
    const currentPlan = plan;
    if (!currentPlan) return;
    const deletedIndex = currentPlan.items.findIndex((item) => item.id === itemId);
    const deletedItem = currentPlan.items[deletedIndex];
    if (!deletedItem) return;

    setLastDeleted({ item: deletedItem, index: deletedIndex });
    if (selectedItemId === itemId && currentPlan.items.length > 1) {
      setSelectedItemId(currentPlan.items.find((item) => item.id !== itemId)?.id ?? null);
    }

    updatePlan((current) => {
      if (current.items.length === 1) {
        return {
          ...current,
          items: [{
            ...deletedItem,
            text: "",
            notes: "",
            dueDate: "",
            section: "",
            done: false,
          }],
        };
      }
      const next = current.items.filter((item) => item.id !== itemId);
      return { ...current, items: next };
    });
  }

  function undoDelete() {
    if (!lastDeleted) return;
    updatePlan((current) => {
      const existingIndex = current.items.findIndex((item) => item.id === lastDeleted.item.id);
      if (existingIndex >= 0) {
        return {
          ...current,
          items: current.items.map((item, index) =>
            index === existingIndex ? lastDeleted.item : item,
          ),
        };
      }
      const items = [...current.items];
      items.splice(Math.min(lastDeleted.index, items.length), 0, lastDeleted.item);
      return { ...current, items };
    });
    setSelectedItemId(lastDeleted.item.id);
    setLastDeleted(null);
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    updatePlan((current) => ({ ...current, items: moveManualPlanItem(current.items, itemId, direction) }));
  }

  async function requestTedEdit(
    action: EditAction,
    customInstruction?: string,
    allowPendingChange = false,
  ) {
    if (
      !selectedItem?.text.trim() ||
      (!allowPendingChange && pendingTedChange) ||
      editor.streaming
    ) return;
    const original = selectedItem.text;
    const result = await editor.run({
      action,
      content: original,
      instruction: customInstruction,
      domain: "action plan step",
    });
    if (!result?.content.trim()) return;
    setPendingTedChange({
      itemId: selectedItem.id,
      suggested: result.content.trim(),
      changes: result.changes,
      action,
      instruction: customInstruction,
    });
  }

  function applyTedChange() {
    if (!pendingTedChange) return;
    updateItem(pendingTedChange.itemId, { text: pendingTedChange.suggested });
    setPendingTedChange(null);
  }

  function retryTedChange() {
    if (!pendingTedChange) return;
    const { action, instruction: retryInstruction } = pendingTedChange;
    setPendingTedChange(null);
    window.setTimeout(() => void requestTedEdit(action, retryInstruction, true), 0);
  }

  const completed = plan.items.filter((item) => item.done).length;

  return (
    <section className={styles.editor} aria-label="Live interactive checklist and action-plan editor">
      <header className={styles.header}>
        <div className={styles.titleWrap}>
          <label htmlFor="manual-plan-title">Plan title</label>
          <input
            id="manual-plan-title"
            className={styles.titleInput}
            value={plan.title}
            onChange={(event) => updatePlan((current) => ({ ...current, title: event.target.value }))}
          />
          <p className={styles.saveState} aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved on this device"
                : saveState === "error"
                  ? "Couldn’t save on this device"
                  : "Live editor"}
          </p>
        </div>
        <div className={styles.progress}>
          <strong>{completed} / {plan.items.length}</strong>
          <span>complete</span>
        </div>
      </header>

      <div className={styles.itemList}>
        {plan.items.map((item, index) => {
          const selected = item.id === selectedItemId;
          return (
            <article
              key={item.id}
              className={`${styles.item}${selected ? ` ${styles.selected}` : ""}`}
            >
              <div className={styles.itemMain}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onFocus={() => setSelectedItemId(item.id)}
                    onChange={(event) => updateItem(item.id, { done: event.target.checked })}
                    aria-label={`Mark action ${index + 1} ${item.done ? "incomplete" : "complete"}`}
                  />
                  <span>{index + 1}</span>
                </label>
                <textarea
                  className={styles.itemText}
                  value={item.text}
                  rows={2}
                  placeholder="What needs to be done?"
                  onFocus={() => setSelectedItemId(item.id)}
                  onChange={(event) => updateItem(item.id, { text: event.target.value })}
                  aria-label={`Action ${index + 1}`}
                />
                <div className={styles.itemActions} aria-label={`Reorder or delete action ${index + 1}`}>
                  <button type="button" onFocus={() => setSelectedItemId(item.id)} onClick={() => moveItem(item.id, -1)} disabled={index === 0} aria-label="Move action up">
                    <Icon name="arrow-up" size={18} />
                  </button>
                  <button type="button" onFocus={() => setSelectedItemId(item.id)} onClick={() => moveItem(item.id, 1)} disabled={index === plan.items.length - 1} aria-label="Move action down">
                    <Icon name="arrow-down" size={18} />
                  </button>
                  <button type="button" onFocus={() => setSelectedItemId(item.id)} onClick={() => deleteItem(item.id)} aria-label="Delete action">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </div>

              <details className={styles.details}>
                <summary>Details</summary>
                <div className={styles.detailGrid}>
                  <label>
                    Section / phase
                    <input
                      value={item.section}
                      onFocus={() => setSelectedItemId(item.id)}
                      onChange={(event) => updateItem(item.id, { section: event.target.value })}
                      placeholder="e.g. Before the meeting"
                    />
                  </label>
                  <label>
                    Due date
                    <input
                      type="date"
                      value={item.dueDate}
                      onFocus={() => setSelectedItemId(item.id)}
                      onChange={(event) => updateItem(item.id, { dueDate: event.target.value })}
                    />
                  </label>
                  <label className={styles.notesLabel}>
                    Notes
                    <textarea
                      rows={3}
                      value={item.notes}
                      onFocus={() => setSelectedItemId(item.id)}
                      onChange={(event) => updateItem(item.id, { notes: event.target.value })}
                      placeholder="Extra detail, links, people to contact or evidence needed"
                    />
                  </label>
                </div>
              </details>
            </article>
          );
        })}
      </div>

      <button type="button" className={styles.addButton} onClick={addItem}>
        <Icon name="plus" size={18} /> Add action
      </button>

      {lastDeleted ? (
        <div className={styles.undoNotice} role="status">
          <span>Action deleted.</span>
          <button type="button" onClick={undoDelete}>
            Undo delete
          </button>
        </div>
      ) : null}

      <div className={styles.tedBar} role="toolbar" aria-label="Edit selected action with TED">
        <button type="button" disabled={!selectedItem?.text.trim() || editor.streaming || Boolean(pendingTedChange)} onClick={() => void requestTedEdit("expand")}>
          Expand
        </button>
        <button type="button" disabled={!selectedItem?.text.trim() || editor.streaming || Boolean(pendingTedChange)} onClick={() => void requestTedEdit("shorten")}>
          Shorten
        </button>
        <div className={styles.teditControl}>
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Tell TED how to change this action"
            aria-label="tEdit instruction"
          />
          <button
            type="button"
            className={styles.primary}
            disabled={!selectedItem?.text.trim() || !instruction.trim() || editor.streaming || Boolean(pendingTedChange)}
            onClick={() => {
              const nextInstruction = instruction.trim();
              setInstruction("");
              void requestTedEdit("improve", nextInstruction);
            }}
          >
            tEdit
          </button>
        </div>
        {editor.streaming ? <span className={styles.editStatus}>TED is drafting a suggestion…</span> : null}
        {editor.error ? <span className={styles.editError}>{editor.error}</span> : null}
      </div>

      {pendingTedChange ? (
        <TedChangeReview
          suggested={pendingTedChange.suggested}
          changes={pendingTedChange.changes}
          explanation="Only the selected action will change. The rest of your plan stays exactly as it is."
          onApply={applyTedChange}
          onRetry={retryTedChange}
          onDiscard={() => setPendingTedChange(null)}
        />
      ) : null}
    </section>
  );
}
