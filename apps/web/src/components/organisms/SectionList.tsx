"use client";

import type { ApprovalSummary, Section } from "@prompted/shared";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { SectionListItem } from "./SectionListItem";
import styles from "./SectionList.module.css";

interface SectionListProps {
  sections: Section[];
  activeSectionId: string | null;
  approval: ApprovalSummary;
  canExport: boolean;
  exporting?: boolean;
  onSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onDropAt: (id: string, toIndex: number) => void;
  onExport: () => void;
}

/**
 * SectionList — left pane. Lists every section with its status, shows the
 * approval counter, and houses the export button. The export button is gated:
 * disabled with an explanatory label until all REQUIRED sections are approved,
 * then enabled (coral) as "Export PDF".
 */
export function SectionList({
  sections,
  activeSectionId,
  approval,
  canExport,
  exporting = false,
  onSelect,
  onMoveUp,
  onMoveDown,
  onApprove,
  onUnapprove,
  onDropAt,
  onExport,
}: SectionListProps) {
  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <h2 className={styles.title}>Sections</h2>
        <p className={styles.counter} aria-live="polite">
          {approval.label}
        </p>
      </div>

      <ul className={styles.list}>
        {sections.map((section, index) => (
          <SectionListItem
            key={section.id}
            section={section}
            index={index}
            total={sections.length}
            active={section.id === activeSectionId}
            onSelect={onSelect}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onApprove={onApprove}
            onUnapprove={onUnapprove}
            onDropAt={onDropAt}
          />
        ))}
      </ul>

      <div className={styles.exportZone}>
        <Button
          variant="primary"
          fullWidth
          onClick={onExport}
          disabled={!canExport}
          loading={exporting}
          loadingLabel="Preparing export"
          leadingIcon={<Icon name="download" size={18} />}
        >
          Export PDF
        </Button>
        {!canExport && (
          <p className={styles.gateHint}>Approve all sections to export</p>
        )}
      </div>
    </div>
  );
}
