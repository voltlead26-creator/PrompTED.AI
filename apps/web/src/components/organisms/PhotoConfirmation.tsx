"use client";

import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Textarea } from "@/components/atoms/Input";
import { Icon } from "@/components/atoms/Icon";
import styles from "./PhotoConfirmation.module.css";

export interface UploadSection {
  title: string;
  items: string[];
}

interface PhotoConfirmationProps {
  /** Text TED read from the attached photo/document. */
  extractedText: string;
  /** TED's own-words summary of what the document is for. */
  summary?: string;
  /** Plain-words name for the kind of document, e.g. "training checklist". */
  documentType?: string;
  /** Mirror of the document's own headings and entries, in its own order. */
  structure?: UploadSection[] | null;
  /** Optional file name shown to help the user confirm the source. */
  fileName?: string;
  /** Confirm the (possibly edited) text and proceed. */
  onConfirm: (text: string) => void | Promise<void>;
  /** Allow the user to go back and change the upload. */
  onCancel?: () => void | Promise<void>;
  /** Locks every transition while a durable acknowledgement is unresolved. */
  busy?: boolean;
  /** The shown wording was already confirmed durably and is no longer editable. */
  confirmed?: boolean;
}

/**
 * PhotoConfirmation — "What TED read from your photo".
 * Shown before any generation when a photo/document was attached, so the user
 * can correct OCR mistakes before TED works from the text.
 */
export function PhotoConfirmation({
  extractedText,
  summary,
  documentType,
  structure,
  fileName,
  onConfirm,
  onCancel,
  busy = false,
  confirmed = false,
}: PhotoConfirmationProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(extractedText);
  const hasStructure = Boolean(structure && structure.length > 0);

  return (
    <section className={styles.card} aria-label="Confirm what TED read">
      <div className={styles.header}>
        <Icon name="photo" size={18} />
        <h2 className={styles.title}>What TED read from your upload</h2>
      </div>

      {fileName && (
        <p className={styles.summary}>
          Uploaded file: <strong>{fileName}</strong>
        </p>
      )}

      {(summary || documentType) && (
        <p className={styles.summary}>
          {documentType ? <strong>{documentType.charAt(0).toUpperCase() + documentType.slice(1)}. </strong> : null}
          {summary}
        </p>
      )}

      {editing ? (
        <Textarea
          label="Correct the text TED read"
          multiline
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          disabled={busy}
        />
      ) : hasStructure ? (
        /* Mirror the document's own structure — like the Master Workspace —
           instead of dumping the extraction as flat text. The raw text stays
           reachable behind "Looks wrong? Edit". */
        <div className={styles.extracted} role="list" aria-label="Sections TED found">
          {structure!.map((section, i) => (
            <section key={`${section.title}-${i}`} role="listitem">
              {section.title && <h3 className={styles.title}>{section.title}</h3>}
              {section.items.length > 0 && (
                <ul>
                  {section.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : (
        <pre className={styles.extracted}>{text}</pre>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void onCancel()}
            disabled={busy}
            leadingIcon={<Icon name="arrow-left" size={16} />}
          >
            Back
          </Button>
        )}
        {!confirmed ? (
          <Button
            variant="ghost"
            size="md"
            onClick={() => setEditing((e) => !e)}
            disabled={busy}
            leadingIcon={<Icon name={editing ? "check" : "edit"} size={16} />}
          >
            {editing ? "Done editing" : "Looks wrong? Edit"}
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="md"
          onClick={() => void onConfirm(text.trim())}
          disabled={busy || !text.trim()}
          loading={busy}
          loadingLabel={confirmed ? "Continuing" : "Saving confirmation"}
        >
          {confirmed ? "Continue with confirmed text" : "That’s right — continue"}
        </Button>
      </div>
    </section>
  );
}
