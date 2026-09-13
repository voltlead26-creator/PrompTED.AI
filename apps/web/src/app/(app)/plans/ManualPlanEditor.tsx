"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditAction } from "@prompted/shared";
import { Icon } from "@/components/atoms/Icon";
import { TedChangeReview } from "@/components/organisms/TedChangeReview";
import { useManualPlanPersistence } from "@/hooks/useManualPlanPersistence";
import { useEditWithTED } from "@/hooks/useEditWithTED";
import {
  createManualPlanItem,
  moveManualPlanItem,
  type ManualPlanItem,
  type ManualPlanState,
} from "./manual-plan-store";
import {
  currentDeviceDataScope,
  deviceDataOwnerToken,
} from "@/lib/owner-bound-device-store";
import { captureOwnerDispatch, ownerDispatchIsCurrent, type OwnerDispatchLease } from "@/lib/browser-principal-state";
import styles from "./ManualPlanEditor.module.css";

interface PendingTedChange {
  storageIdentity: string;
  sessionId: string;
  planId: string;
  revision: number;
  requestToken: number;
  original: string;
  lease: OwnerDispatchLease | null;
  itemId: string;
  suggested: string;
  changes: string[];
  action: EditAction;
  instruction?: string;
}

interface DeletedPlanItem {
  storageIdentity: string;
  sessionId: string;
  revision: number;
  lease: OwnerDispatchLease | null;
  item: ManualPlanItem;
  index: number;
}

interface BoundEditorText {
  identity: string;
  value: string;
}

interface BoundPlanState {
  storageIdentity: string;
  sessionId: string;
  plan: ManualPlanState;
  revision: number;
}

export function ManualPlanEditor({
  planId,
  ownerUserId,
}: {
  planId?: string | null;
  ownerUserId?: string | null;
}) {
  const deviceScope = useMemo(() => currentDeviceDataScope(ownerUserId), [ownerUserId]);
  const ownerToken = deviceDataOwnerToken(deviceScope);
  const storageIdentity = `${ownerToken}:${planId ?? "new"}`;
  const persistence = useManualPlanPersistence(ownerUserId, planId);
  const plan = persistence.plan;
  const sessionId = persistence.sessionId;
  const boundPlan: BoundPlanState | null = plan && sessionId
    ? { storageIdentity, sessionId, plan, revision: persistence.revision } : null;
  const auxiliaryIdentity = boundPlan ? `${ownerToken}:${boundPlan.plan.id}:${boundPlan.sessionId}` : null;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [boundInstruction, setBoundInstruction] = useState<BoundEditorText | null>(null);
  const [pendingTedChange, setPendingTedChange] = useState<PendingTedChange | null>(null);
  const [lastDeleted, setLastDeleted] = useState<DeletedPlanItem | null>(null);
  const [boundTedNotice, setBoundTedNotice] = useState<BoundEditorText | null>(null);
  const instruction = boundInstruction && boundInstruction.identity === auxiliaryIdentity ? boundInstruction.value : "";
  const tedNotice = boundTedNotice && boundTedNotice.identity === auxiliaryIdentity ? boundTedNotice.value : null;
  const setInstruction = (value: string) => setBoundInstruction(auxiliaryIdentity ? { identity: auxiliaryIdentity, value } : null);
  const setTedNotice = (value: string | null) => setBoundTedNotice(auxiliaryIdentity && value !== null ? { identity: auxiliaryIdentity, value } : null);
  const boundPlanRef = useRef<BoundPlanState | null>(null);
  boundPlanRef.current = boundPlan;
  const pendingChangeRef = useRef<PendingTedChange | null>(null);
  const inFlightRef = useRef<PendingTedChange | null>(null);
  const requestSequenceRef = useRef(0);
  const currentIdentityRef = useRef(storageIdentity);
  const currentOwnerRef = useRef(ownerToken);
  currentIdentityRef.current = storageIdentity;
  currentOwnerRef.current = ownerToken;
  const editor = useEditWithTED();
  const { cancel } = editor;

  useEffect(() => {
    // Canonical plan + hook lifetime remains stable when Next adopts this
    // session's allocated URL, but changes for another owner, plan or recovery.
    setBoundInstruction(previous => previous?.identity === auxiliaryIdentity ? previous : null);
    setBoundTedNotice(previous => previous?.identity === auxiliaryIdentity ? previous : null);
    setPendingTedChange(previous => previous && `${previous.storageIdentity}:${previous.sessionId}` === auxiliaryIdentity ? previous : null);
    setLastDeleted(previous => previous && `${previous.storageIdentity}:${previous.sessionId}` === auxiliaryIdentity ? previous : null);
    return () => {
      requestSequenceRef.current += 1;
      pendingChangeRef.current = null;
      if (inFlightRef.current) {
        inFlightRef.current = null;
        cancel();
      }
    };
  }, [auxiliaryIdentity, cancel]);

  useEffect(() => {
    setSelectedItemId(previous => plan?.items.some(item => item.id === previous) ? previous : plan?.items[0]?.id ?? null);
  }, [plan]);

  const selectedItem = useMemo(
    () => plan?.items.find((item) => item.id === selectedItemId) ?? null,
    [plan, selectedItemId],
  );

  if (!plan) return persistence.status === "error" || persistence.status === "unavailable"
    ? <div role="alert"><p>{persistence.message}</p>{persistence.status === "error" ? <button type="button" onClick={() => void persistence.reload()}>Retry opening plan</button> : null}</div>
    : <div className={styles.loading}>Opening live editor…</div>;

  function updatePlan(mutator: (current: ManualPlanState) => ManualPlanState): ManualPlanState | null {
    const current = boundPlanRef.current;
    if (currentIdentityRef.current !== storageIdentity || current?.storageIdentity !== storageIdentity) return null;
    const nextPlan = persistence.update(mutator);
    if (!nextPlan) return null;
    boundPlanRef.current = { ...current, revision: current.revision + 1, plan: nextPlan };
    requestSequenceRef.current += 1;
    if (pendingChangeRef.current || inFlightRef.current) {
      setTedNotice("Your plan changed. Ask TED again using the current wording.");
      pendingChangeRef.current = null;
      setPendingTedChange(null);
      if (inFlightRef.current) cancel();
    }
    return nextPlan;
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
    const current = boundPlanRef.current;
    if (!current || current.storageIdentity !== storageIdentity) return;
    const currentPlan = current.plan;
    const deletedIndex = currentPlan.items.findIndex((item) => item.id === itemId);
    const deletedItem = currentPlan.items[deletedIndex];
    if (!deletedItem) return;

    let lease: OwnerDispatchLease | null = null;
    try { if (ownerUserId) lease = captureOwnerDispatch(ownerUserId); }
    catch { return; }
    const next = updatePlan((current) => {
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
    const updated = boundPlanRef.current;
    if (!next || !updated) return;
    setLastDeleted({ storageIdentity: `${ownerToken}:${currentPlan.id}`, sessionId: current.sessionId,
      revision: updated.revision, lease, item: { ...deletedItem }, index: deletedIndex });
    if (selectedItemId === itemId && currentPlan.items.length > 1) {
      setSelectedItemId(currentPlan.items.find((item) => item.id !== itemId)?.id ?? null);
    }
  }

  function deletionIsCurrent(deleted: DeletedPlanItem): boolean {
    const current = boundPlanRef.current;
    return current !== null && `${currentOwnerRef.current}:${current.plan.id}` === deleted.storageIdentity &&
      current.sessionId === deleted.sessionId && current.revision === deleted.revision &&
      (!deleted.lease || ownerDispatchIsCurrent(deleted.lease));
  }

  function undoDelete() {
    if (!lastDeleted || !deletionIsCurrent(lastDeleted)) {
      setLastDeleted(null);
      return;
    }
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

  function changeIsCurrent(change: PendingTedChange) {
    const current = boundPlanRef.current;
    return current !== null && `${currentOwnerRef.current}:${current.plan.id}` === change.storageIdentity &&
      (currentIdentityRef.current === current.storageIdentity || currentIdentityRef.current === change.storageIdentity) &&
      current.plan.id === change.planId && current.sessionId === change.sessionId && current.revision === change.revision &&
      requestSequenceRef.current === change.requestToken &&
      current.plan.items.some(item => item.id === change.itemId && item.text === change.original) &&
      (!change.lease || ownerDispatchIsCurrent(change.lease));
  }

  async function requestTedEdit(
    action: EditAction,
    customInstruction?: string,
    retry?: PendingTedChange,
  ) {
    const current = boundPlanRef.current;
    const item = current?.plan.items.find(item => item.id === (retry?.itemId ?? selectedItemId));
    if (!current || current.storageIdentity !== storageIdentity || !item?.text.trim() ||
      inFlightRef.current || pendingChangeRef.current || editor.streaming || (retry && !changeIsCurrent(retry))) return;
    let lease: OwnerDispatchLease | null = null;
    try { if (ownerUserId) lease = captureOwnerDispatch(ownerUserId); }
    catch { setTedNotice("Sign in again before asking TED to edit this action."); return; }
    const request: PendingTedChange = { storageIdentity: `${ownerToken}:${current.plan.id}`, planId: current.plan.id, revision: current.revision,
      sessionId: current.sessionId,
      requestToken: ++requestSequenceRef.current, original: item.text, lease,
      itemId: item.id, suggested: "", changes: [], action, instruction: customInstruction };
    inFlightRef.current = request;
    setTedNotice(null);
    try {
      const result = await editor.run({ action, content: request.original,
        instruction: customInstruction, domain: "action plan step" });
      if (!changeIsCurrent(request) || !result?.content.trim()) return;
      const proposal = { ...request, suggested: result.content.trim(), changes: result.changes };
      pendingChangeRef.current = proposal;
      setPendingTedChange(proposal);
    } catch {
      if (changeIsCurrent(request)) setTedNotice("TED couldn’t finish that suggestion. Your plan is unchanged; try again.");
    } finally {
      if (inFlightRef.current === request) inFlightRef.current = null;
    }
  }

  function applyTedChange() {
    const pending = pendingChangeRef.current;
    if (!pending) return;
    pendingChangeRef.current = null;
    setPendingTedChange(null);
    if (!changeIsCurrent(pending)) {
      setTedNotice("Your plan or account changed. Ask TED again using the current wording.");
      return;
    }
    updateItem(pending.itemId, { text: pending.suggested });
  }

  function retryTedChange() {
    const pending = pendingChangeRef.current;
    if (!pending) return;
    pendingChangeRef.current = null;
    setPendingTedChange(null);
    if (!changeIsCurrent(pending)) {
      setTedNotice("Your plan or account changed. Ask TED again using the current wording.");
      return;
    }
    void requestTedEdit(pending.action, pending.instruction, pending);
  }

  const completed = plan.items.filter((item) => item.done).length;
  const visibleDeletion = lastDeleted && deletionIsCurrent(lastDeleted) ? lastDeleted : null;
  const visibleTedChange = pendingTedChange && changeIsCurrent(pendingTedChange) ? pendingTedChange : null;

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
            {persistence.status === "saving" ? "Saving to your account…"
              : persistence.status === "saved" ? persistence.account ? "Saved to your account" : "Saved on this device"
              : persistence.status === "opening" ? "Opening account version…"
              : persistence.status === "pending" ? "Changes waiting to save…"
              : persistence.account ? "Account save needs attention" : "Couldn’t save on this device"}
          </p>
          {persistence.message ? <p role="status">{persistence.message}</p> : null}
          {persistence.status === "error" || persistence.status === "import" ? <button type="button" onClick={() => void persistence.retry()}>
            {persistence.status === "import" ? "Save to my account" : persistence.account ? "Retry account save" : "Retry device save"}
          </button> : null}
          {persistence.status === "saving" ? <button type="button" onClick={persistence.cancelSave}>Cancel save request</button> : null}
          {persistence.status === "conflict" ? <div role="alert">
            <p>Your device edits are preserved. Load and review the account version before switching to it.</p>
            <button type="button" onClick={() => void persistence.reload()}>Review account version</button>
            {persistence.remote ? <details><summary>Account version: {persistence.remote.title || "Untitled action plan"}</summary>
              <ol>{persistence.remote.items.map(item => <li key={item.id}><strong>{item.section}</strong><p>{item.text}</p><p>{item.notes}</p><p>{item.due_date ?? "No due date"} · {item.done ? "Complete" : "Incomplete"}</p></li>)}</ol>
              <button type="button" onClick={persistence.useAccountVersion}>Use account version and keep device recovery copy</button>
            </details> : null}
          </div> : null}

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

      {visibleDeletion ? (
        <div className={styles.undoNotice} role="status">
          <span>Action deleted.</span>
          <button type="button" onClick={undoDelete}>
            Undo delete
          </button>
        </div>
      ) : null}

      <div className={styles.tedBar} role="toolbar" aria-label="Edit selected action with TED">
        <button type="button" disabled={!selectedItem?.text.trim() || editor.streaming || Boolean(visibleTedChange)} onClick={() => void requestTedEdit("expand")}>
          Expand
        </button>
        <button type="button" disabled={!selectedItem?.text.trim() || editor.streaming || Boolean(visibleTedChange)} onClick={() => void requestTedEdit("shorten")}>
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
            disabled={!selectedItem?.text.trim() || !instruction.trim() || editor.streaming || Boolean(visibleTedChange)}
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
        {tedNotice || editor.error ? <span className={styles.editError} role="status">{tedNotice ?? editor.error}</span> : null}
      </div>

      {visibleTedChange ? (
        <TedChangeReview
          suggested={visibleTedChange.suggested}
          changes={visibleTedChange.changes}
          explanation="Only the selected action will change. The rest of your plan stays exactly as it is."
          onApply={applyTedChange}
          onRetry={retryTedChange}
          onDiscard={() => { pendingChangeRef.current = null; setPendingTedChange(null); }}
        />
      ) : null}
    </section>
  );
}
