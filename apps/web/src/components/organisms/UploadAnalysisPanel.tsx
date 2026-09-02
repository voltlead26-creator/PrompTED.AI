"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import styles from "./UploadAnalysisPanel.module.css";

interface UploadAnalysisPanelProps {
  documentName: string;
  uploads: string[];
  uploadedNames: string[];
  busy?: boolean;
  error?: string | null;
  onUpload: () => void;
  onBuild: () => void;
  /** Hidden file input, rendered by the parent. */
  children?: ReactNode;
}

/**
 * UploadAnalysisPanel — the DIE "Universal Upload Analysis" step. Shown once,
 * before a document is generated: TED offers the uploads that would make this
 * specific document stronger, and the user can add files, or build straight
 * away. Anything uploaded is woven into the first draft.
 */
export function UploadAnalysisPanel({
  documentName,
  uploads,
  uploadedNames,
  busy = false,
  error,
  onUpload,
  onBuild,
  children,
}: UploadAnalysisPanelProps) {
  const hasUploads = uploadedNames.length > 0;
  return (
    <div className={styles.wrap}>
      <section className={styles.card} aria-label="Make this document stronger">
        <div className={styles.head}>
          <Icon name="sparkles" size={20} />
          <h2 className={styles.title}>I can build your {documentName} now</h2>
        </div>
        <p className={styles.lede}>
          To make it noticeably stronger, you can add one supporting file first. TED binds
          that exact source to this draft — or you can build straight away.
        </p>

        <ul className={styles.list}>
          {uploads.map((u, i) => (
            <li key={i} className={styles.item}>
              <span className={styles.check} aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
              <span>{u}</span>
            </li>
          ))}
        </ul>

        {hasUploads && (
          <div className={styles.added}>
            <span className={styles.addedLabel}>Added:</span>
            {uploadedNames.map((n, i) => (
              <span key={i} className={styles.chip}>
                <Icon name="file" size={14} /> {n}
              </span>
            ))}
          </div>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={onUpload}
            loading={busy}
            loadingLabel="Reading"
            leadingIcon={<Icon name="plus" size={16} />}
          >
            {hasUploads ? "Replace file" : "Upload a file"}
          </Button>
          <Button variant="primary" onClick={onBuild} disabled={busy}>
            {hasUploads ? "Build with these" : "Build now"}
            <Icon name="arrow-right" size={16} />
          </Button>
        </div>

        <p className={styles.skip}>
          Uploading is optional. You can replace this source before building or add confirmed
          details in the editor later.
        </p>

        {children}
      </section>
    </div>
  );
}
