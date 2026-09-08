"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  isTedActionStepPayload,
  type PersistedTedArtifactBlock,
} from "@prompted/shared/artifacts";
import type { EditAction } from "@prompted/shared/api-client";
import { useArtifact } from "@/hooks/useArtifact";
import { useEditWithTED } from "@/hooks/useEditWithTED";
import { useAuth } from "@/components/providers";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import { Spinner } from "@/components/atoms/Spinner";
import { Icon } from "@/components/atoms/Icon";
import { StatusCheckbox } from "@/components/atoms/StatusCheckbox";
import { EditWithTED } from "./EditWithTED";
import { TedChangeReview } from "./TedChangeReview";
import { SectionedChecklistScreen } from "./SectionedChecklistScreen";
import { ActionStepFieldsEditor } from "./ActionStepFieldsEditor";
import styles from "./ArtifactActionScreen.module.css";

type EditField = "title" | "objective";

interface EditBase {
  outcomeId: string;
  artifactId: string;
  userId: string;
  authUserId: string | null;
  artifactRevision: number;
  blockId: string;
  blockRevision: number;
  originalPayload: string;
}

interface PendingChange extends EditBase {
  field: EditField;
  suggested: string;
  changes: string[];
  action: EditAction;
  instruction?: string;
}

export function ArtifactActionScreen({ outcomeId }: { outcomeId: string }) {
  const { user } = useAuth();
  const authUserId = user?.id ?? null;
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
  const [editField, setEditField] = useState<EditField>("objective");
  const [manualEdit, setManualEdit] = useState<EditBase | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const requestEpoch = useRef(0);
  const requestInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const cancelRef = useRef(editor.cancel);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ artifact, outcomeId, authUserId, loading, loadError });
  useLayoutEffect(() => {
    latest.current = { artifact, outcomeId, authUserId, loading, loadError };
    cancelRef.current = editor.cancel;
  });
  useEffect(() => {
    setPending(null);
    setManualEdit(null);
    setShowTEdit(false);
    setEditError(null);
    setRequesting(false);
    requestInFlight.current = false;
    return () => {
      requestEpoch.current += 1;
      if (requestInFlight.current) cancelRef.current();
    };
  }, [outcomeId, artifact?.id, artifact?.user_id, authUserId]);

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

  if ((loading && !artifact) || (artifact && artifact.user_id !== authUserId)) return <Spinner label="Loading your plan" />;
  if (artifact && artifact.outcome_id !== outcomeId) {
    return loading
      ? <Spinner label="Loading your plan" />
      : <p role="alert">{loadError ?? "TED could not confirm this outcome's saved plan. Reload before editing it."}</p>;
  }
  if (!artifact || !actions.length) return <SectionedChecklistScreen outcomeId={outcomeId} />;

  const done = actions.filter((action) => action.completed_at).length;

  function captureBase(block: PersistedTedArtifactBlock): EditBase {
    if (!artifact) throw new Error("ARTIFACT_UNAVAILABLE");
    return {
      outcomeId, artifactId: artifact.id, userId: artifact.user_id, authUserId,
      artifactRevision: artifact.current_revision, blockId: block.id,
      blockRevision: block.revision, originalPayload: JSON.stringify(block.payload),
    };
  }

  function baseIsCurrent(base: EditBase) {
    const current = latest.current.artifact;
    const block = current?.blocks.find((item) => item.id === base.blockId);
    return !latest.current.loading && !latest.current.loadError &&
      latest.current.authUserId === base.authUserId && latest.current.outcomeId === base.outcomeId &&
      current?.outcome_id === base.outcomeId && current?.id === base.artifactId &&
      current?.user_id === base.userId && current?.current_revision === base.artifactRevision &&
      block?.revision === base.blockRevision && JSON.stringify(block.payload) === base.originalPayload;
  }

  const staleMessage = "This plan changed since the edit started. Discard this edit and review the latest saved step before editing again.";
  const controlsBusy = loading || Boolean(loadError) || Boolean(savingBlockId) || requesting || editor.streaming || Boolean(pending) || Boolean(manualEdit);

  async function requestEdit(action: EditAction, instruction?: string, retry?: PendingChange) {
    const block = retry ? actions.find((item) => item.id === retry.blockId) : selectedBlock;
    if (!block || !isTedActionStepPayload(block.payload) || requestInFlight.current ||
      savingBlockId || loading || loadError || manualEdit || (pending && !retry)) return;
    if (retry && !baseIsCurrent(retry)) { setEditError(staleMessage); return; }
    const base = retry ?? captureBase(block);
    if (!baseIsCurrent(base)) { setEditError(staleMessage); return; }
    const field = retry?.field ?? editField;
    const epoch = ++requestEpoch.current;
    requestInFlight.current = true;
    setRequesting(true);
    if (!retry) setPending(null);
    setEditError(null);
    try {
      const result = await editor.run({ action, content: block.payload[field], instruction });
      if (epoch !== requestEpoch.current) return;
      if (!baseIsCurrent(base)) { setEditError(staleMessage); return; }
      if (!result?.content.trim()) {
        setEditError(retry
          ? "TED could not finish another suggestion. Your previous suggestion is still available."
          : "TED could not finish this suggestion. Try again.");
        return;
      }
      setPending({ ...base, field, suggested: result.content.trim(), changes: result.changes, action, instruction });
      setShowTEdit(false);
    } catch {
      if (epoch === requestEpoch.current) setEditError("TED could not finish this suggestion. Try again.");
    } finally {
      if (epoch === requestEpoch.current) {
        requestInFlight.current = false;
        setRequesting(false);
      }
    }
  }

  function cancelSuggestion() {
    requestEpoch.current += 1;
    requestInFlight.current = false;
    setRequesting(false);
    editor.cancel();
  }

  async function applyChange() {
    if (!pending || saveInFlight.current || savingBlockId || loading) return;
    if (!baseIsCurrent(pending)) { setEditError(staleMessage); return; }
    const block = actions.find((item) => item.id === pending.blockId);
    if (!block || !isTedActionStepPayload(block.payload)) return;
    saveInFlight.current = true;
    const epoch = requestEpoch.current;
    setEditError(null);
    try {
      await updateBlockPayload(block.id, { ...block.payload, [pending.field]: pending.suggested });
      if (epoch === requestEpoch.current) setPending(null);
    } catch {
      if (epoch === requestEpoch.current) setEditError("TED could not confirm that wording change. Your suggestion is kept here; review the saved step before retrying.");
    } finally {
      saveInFlight.current = false;
    }
  }

  async function retryChange() {
    if (!pending) return;
    await requestEdit(pending.action, pending.instruction, pending);
  }

  async function saveFields(fields: { title: string; objective: string }) {
    if (!manualEdit || !baseIsCurrent(manualEdit)) {
      setEditError(staleMessage);
      throw new Error("ARTIFACT_EDIT_STALE");
    }
    const block = actions.find((item) => item.id === manualEdit.blockId);
    if (!block || !isTedActionStepPayload(block.payload)) throw new Error("ARTIFACT_BLOCK_UNAVAILABLE");
    const epoch = requestEpoch.current;
    await updateBlockPayload(block.id, { ...block.payload, ...fields });
    if (epoch === requestEpoch.current) {
      setManualEdit(null);
      setEditError(null);
    }
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
          onToggle={() => {
            if (baseIsCurrent(captureBase(block))) void toggleBlock(block).catch(() => undefined);
          }}
          disabled={Boolean(savingBlockId) || Boolean(manualEdit) || Boolean(pending) || requesting || loading || Boolean(loadError)}
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
        {manualEdit?.blockId === block.id && (
          <ActionStepFieldsEditor
            title={step.title}
            description={step.objective}
            onSave={saveFields}
            onCancel={() => { setManualEdit(null); setEditError(null); }}
          />
        )}
        {selected && !manualEdit && (
          <button type="button" className={styles.editFields} disabled={controlsBusy}
            onClick={() => { setManualEdit(captureBase(block)); setShowTEdit(false); setEditError(null); }}>
            Edit title and description
          </button>
        )}
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
          explanation={`TED has suggested a change to the ${pending.field === "title" ? "title" : "description"} of this step. Nothing changes until you apply it.`}
          onDiscard={() => { setPending(null); setEditError(null); }}
          onRetry={retryChange}
          onApply={applyChange}
          busy={savingBlockId === pending.blockId}
          notice={editError ?? saveError ?? loadError ?? editor.error}
          returnFocusRef={returnFocusRef}
        />
      )}

      {loadError ? <p className={styles.saving} role="alert">{loadError}</p> : null}
      {!pending && saveError ? <p className={styles.saving} role="alert">{saveError}</p> : null}
      {!pending && editError ? <p role="alert">{editError}</p> : null}
      {!pending && !showTEdit && editor.error ? <p role="alert">{editor.error}</p> : null}

      {!manualEdit && <div className={styles.contextBar} role="toolbar" aria-label="Edit selected action step">
        <label className={styles.fieldChoice}>Edit field
          <select value={editField} disabled={controlsBusy} onChange={(event) => {
            if (event.target.value === "title" || event.target.value === "objective") setEditField(event.target.value);
          }}><option value="title">Title</option><option value="objective">Description</option></select>
        </label>
        <button type="button" onClick={() => void requestEdit("expand")} disabled={!selectedBlock || controlsBusy}>
          <Icon name="arrows-maximize" size={17} />Expand
        </button>
        <button type="button" onClick={() => void requestEdit("shorten")} disabled={!selectedBlock || controlsBusy}>
          <Icon name="arrows-minimize" size={17} />Shorten
        </button>
        <button ref={returnFocusRef} type="button" className={styles.primary} onClick={() => setShowTEdit(true)} disabled={!selectedBlock || controlsBusy} aria-expanded={showTEdit}>
          <Icon name="sparkles" size={17} />tEdit
        </button>
      </div>}
      {requesting && <button type="button" onClick={cancelSuggestion}>Cancel suggestion</button>}

      {showTEdit && (
        <aside className={styles.teditSheet} aria-label="tEdit selected action step">
          <div className={styles.sheetHead}>
            <div><strong>tEdit</strong><p>TED will suggest a change to the selected task {editField === "title" ? "title" : "description"}.</p></div>
            <button type="button" onClick={() => { if (requesting) cancelSuggestion(); setShowTEdit(false); }} aria-label="Close tEdit"><span className={styles.closeSymbol} aria-hidden="true">×</span></button>
          </div>
          <EditWithTED
            streaming={requesting || editor.streaming}
            hasSelection={false}
            error={editor.error}
            onRun={requestEdit}
            onCancel={cancelSuggestion}
          />
        </aside>
      )}

      {savingBlockId && <span className={styles.saving} aria-live="polite">Saving change…</span>}
    </section>
  );
}
