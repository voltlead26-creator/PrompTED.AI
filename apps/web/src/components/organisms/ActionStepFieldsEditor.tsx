"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./ActionStepFieldsEditor.module.css";

export function ActionStepFieldsEditor({ title, description, onSave, onCancel }: {
  title: string;
  description: string;
  onSave: (fields: { title: string; objective: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [nextTitle, setNextTitle] = useState(title);
  const [nextDescription, setNextDescription] = useState(description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  async function save() {
    if (inFlight.current || !nextTitle.trim() || !nextDescription.trim()) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: nextTitle.trim(), objective: nextDescription.trim() });
    } catch {
      setError("TED could not confirm that change. Your wording is kept here. Review the saved step before retrying.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form className={styles.editor} aria-label="Edit title and description" onSubmit={(event) => {
      event.preventDefault();
      void save();
    }}>
      <p>Use a short title. Put the full sequence and other details in the description.</p>
      <label htmlFor={`${id}-title`}>Task title</label>
      <textarea ref={titleRef} id={`${id}-title`} rows={2} value={nextTitle} disabled={saving} required onChange={(event) => setNextTitle(event.target.value)} />
      <label htmlFor={`${id}-description`}>Task description</label>
      <textarea id={`${id}-description`} rows={7} value={nextDescription} disabled={saving} required onChange={(event) => setNextDescription(event.target.value)} />
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" disabled={saving || !nextTitle.trim() || !nextDescription.trim()}>{saving ? "Saving changes…" : "Save changes"}</button>
      </div>
    </form>
  );
}
