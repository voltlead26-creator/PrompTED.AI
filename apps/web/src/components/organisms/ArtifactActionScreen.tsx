"use client";

import { useMemo, useState } from "react";
import {
  isTedActionStepPayload,
  type PersistedTedArtifactBlock,
} from "@prompted/shared/artifacts";
import type { EditAction } from "@prompted/shared/api-client";
import { useArtifact } from "@/hooks/useArtifact";
import { useEditWithTED } from "@/hooks/useEditWithTED";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { StatusCheckbox } from "@/components/atoms/StatusCheckbox";
import { EditWithTED } from "./EditWithTED";
import { TedChangeReview } from "./TedChangeReview";
import { SectionedChecklistScreen } from "./SectionedChecklistScreen";
import styles from "./ArtifactActionScreen.module.css";

interface PendingChange {
  blockId: string;
  suggested: string;
  changes: string[];
  action: EditAction;
  instruction?: string;
}

export function ArtifactActionScreen({ outcomeId }: { outcomeId: string }) {
  const {
    artifact,
    loading,
    savingBlockId,
    loadError,
    saveError,
    toggleBlock,
    updateBlockPayload,
  } = useArtifact(outcomeId);
  const editor = useEditWithTED();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showTEdit, setShowTEdit] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const actions = useMemo(
    () => artifact?.blocks.filter((block) => block.kind === "action") ?? [],
    [artifact],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof actions>();
    for (const action of actions) {
      const section = action.heading.trim() || "Your actions";
      map.set(section, [...(map.get(section) ?? []), action]);
    }
    return [...map.entries()];
  }, [actions]);
  const selectedBlock = actions.find((block) => block.id === selectedBlockId) ?? actions[0] ?? null;

  if (loading) return <Spinner label="Loading your plan" />;
  if (!artifact || !actions.length) return <SectionedChecklistScreen outcomeId={outcomeId} />;

  const done = actions.filter((action) => action.completed_at).length;

  async function requestEdit(action: EditAction, instruction?: string) {
    if (!selectedBlock || !isTedActionStepPayload(selectedBlock.payload) || pending) return;
    const original = selectedBlock.payload.objective;
    const result = await editor.run({ action, content: original, instruction });
    if (!result?.content.trim()) return;
    setPending({
      blockId: selectedBlock.id,
      suggested: result.content.trim(),
      changes: result.changes,
      action,
      instruction,
    });
    setShowTEdit(false);
  }

  async function applyChange() {
    if (!pending) return;
    const block = actions.find((item) => item.id === pending.blockId);
    if (!block || !isTedActionStepPayload(block.payload)) return;
    await updateBlockPayload(block.id, { ...block.payload, objective: pending.suggested });
    setPending(null);
  }

  function retryChange() {
    if (!pending) return;
    const { action, instruction } = pending;
    setPending(null);
    window.setTimeout(() => void requestEdit(action, instruction), 0);
  }

  function renderStep(block: PersistedTedArtifactBlock) {
    if (!isTedActionStepPayload(block.payload)) return null;
    const step = block.payload;
    const selected = block.id === selectedBlock?.id;
    const completed = Boolean(block.completed_at);
    return (
      <li className={`${styles.item}${selected ? ` ${styles.selected}` : ""}${completed ? ` ${styles.completedItem}` : ""}`} key={block.id}>
        <StatusCheckbox
          checked={completed}
          label={`${completed ? "Mark incomplete" : "Mark complete"}: ${step.title}`}
          onToggle={() => void toggleBlock(block).catch(() => undefined)}
          disabled={savingBlockId === block.id}
        />
        <button
          type="button"
          className={styles.selectStep}
          aria-pressed={selected}
          onClick={() => setSelectedBlockId(block.id)}
        >
          <span className={styles.stepContent}>
            <strong className={completed ? styles.complete : ""}>{step.title}</strong>
            <span>{step.objective}</span>
          </span>
          {block.due_date ? <time dateTime={block.due_date}>{block.due_date}</time> : null}
        </button>
        {selected && (
          <details className={styles.details}>
            <summary>More detail</summary>
            <div className={styles.detailGrid}>
              <section><h5>How to do it</h5><ol>{step.instructions.map((value) => <li key={value}>{value}</li>)}</ol></section>
              {step.required_inputs.length ? <section><h5>What you need</h5><ul>{step.required_inputs.map((value) => <li key={value}>{value}</li>)}</ul></section> : null}
              {step.included_materials.map((material) => <section className={styles.material} key={material.label}><h5>{material.label}</h5><div>{material.content}</div></section>)}
              {step.dependencies.length ? <section><h5>Before you start</h5><ul>{step.dependencies.map((value) => <li key={value}>{value}</li>)}</ul></section> : null}
              <section><h5>Finished when</h5><ul>{step.completion_criteria.map((value) => <li key={value}>{value}</li>)}</ul></section>
              {step.cautions.length ? <section><h5>Take care</h5><ul>{step.cautions.map((value) => <li key={value}>{value}</li>)}</ul></section> : null}
            </div>
          </details>
        )}
      </li>
    );
  }

  return (
    <section className={styles.screen} aria-label="Interactive action plan">
      <div className={styles.progressRow}>
        <h2>Your plan</h2>
        <span>{done} of {actions.length} complete</span>
      </div>
      <ProgressBar value={done / actions.length} label={`${Math.round(done / actions.length * 100)}% complete`} />

      <div className={styles.groups}>
        {groups.map(([section, rows]) => (
          <section className={styles.group} key={section}>
            <div className={styles.sectionHead}>
              <h3>{section}</h3>
              <span>{rows.filter((row) => row.completed_at).length} / {rows.length}</span>
            </div>
            <ol className={styles.list}>{rows.map(renderStep)}</ol>
          </section>
        ))}
      </div>

      {pending && (
        <TedChangeReview
          suggested={pending.suggested}
          changes={pending.changes}
          explanation="TED has suggested clearer wording for this step. The step will not change until you apply it."
          onDiscard={() => setPending(null)}
          onRetry={retryChange}
          onApply={() => void applyChange()}
          busy={savingBlockId === pending.blockId}
        />
      )}

      {loadError ? <p className={styles.saving} role="alert">{loadError}</p> : null}
      {saveError ? <p className={styles.saving} role="alert">{saveError}</p> : null}

      <div className={styles.contextBar} role="toolbar" aria-label="Edit selected action step">
        <button type="button" onClick={() => void requestEdit("expand")} disabled={!selectedBlock || editor.streaming || Boolean(pending)}>
          <Icon name="arrows-maximize" size={17} />Expand
        </button>
        <button type="button" onClick={() => void requestEdit("shorten")} disabled={!selectedBlock || editor.streaming || Boolean(pending)}>
          <Icon name="arrows-minimize" size={17} />Shorten
        </button>
        <button type="button" className={styles.primary} onClick={() => setShowTEdit(true)} disabled={!selectedBlock || Boolean(pending)} aria-expanded={showTEdit}>
          <Icon name="sparkles" size={17} />tEdit
        </button>
      </div>

      {showTEdit && (
        <aside className={styles.teditSheet} aria-label="tEdit selected action step">
          <div className={styles.sheetHead}>
            <div><strong>tEdit</strong><p>TED will suggest a change to the selected step.</p></div>
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

      {savingBlockId && <span className={styles.saving} aria-live="polite">Saving change…</span>}
    </section>
  );
}
