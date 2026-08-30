"use client";

import { useMemo, useState } from "react";
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
  itemId: string;
  section: string;
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
  const [pending, setPending] = useState<PendingChange | null>(null);

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
  const selectedParsed = selectedItem ? splitItem(selectedItem.text) : null;

  if (checklist.loading) return <Spinner label="Loading plan" />;
  if (!checklist.items.length) return <p>No checklist items were generated.</p>;

  async function requestEdit(action: EditAction, instruction?: string) {
    if (!selectedItem || !selectedParsed || pending) return;
    const result = await editor.run({ action, content: selectedParsed.text, instruction });
    if (!result?.content.trim()) return;
    setPending({
      itemId: selectedItem.id,
      section: selectedParsed.section,
      suggested: result.content.trim(),
      changes: result.changes,
      action,
      instruction,
    });
    setShowTEdit(false);
  }

  async function applyChange() {
    if (!pending) return;
    await checklist.updateText(pending.itemId, `${pending.section}${SEP}${pending.suggested}`);
    setPending(null);
  }

  function retryChange() {
    if (!pending) return;
    const { action, instruction } = pending;
    setPending(null);
    window.setTimeout(() => void requestEdit(action, instruction), 0);
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
                      />
                      <button type="button" className={styles.selectItem} aria-pressed={selected} onClick={() => setSelectedItemId(item.id)}>
                        <span className={item.done ? styles.complete : ""}>{label}</span>
                        {item.reason ? <small>{item.reason}</small> : null}
                      </button>
                    </div>
                    {pending && pending.itemId === item.id && (
                      <div className={styles.pendingReview}>
                        <TedChangeReview
                          suggested={pending.suggested}
                          changes={pending.changes}
                          explanation="TED has suggested clearer wording for this item. Nothing changes until you apply it."
                          onDiscard={() => setPending(null)}
                          onRetry={retryChange}
                          onApply={() => void applyChange()}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className={styles.contextBar} role="toolbar" aria-label="Edit selected checklist item">
        <button type="button" onClick={() => void requestEdit("expand")} disabled={!selectedItem || editor.streaming || Boolean(pending)}>
          <Icon name="arrows-maximize" size={17} />Expand
        </button>
        <button type="button" onClick={() => void requestEdit("shorten")} disabled={!selectedItem || editor.streaming || Boolean(pending)}>
          <Icon name="arrows-minimize" size={17} />Shorten
        </button>
        <button type="button" className={styles.primary} onClick={() => setShowTEdit(true)} disabled={!selectedItem || Boolean(pending)} aria-expanded={showTEdit}>
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

      {checklist.savingItemId && <span className={styles.saving} aria-live="polite">Saving change…</span>}
    </section>
  );
}
