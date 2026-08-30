import type { Section, SectionStatus, SectionVersion } from "./types";

export interface ApprovalSummary {
  approved: number;
  required: number;
  total: number;
  allRequiredApproved: boolean;
  label: string;
}

export function summariseApproval(sections: Section[]): ApprovalSummary {
  const total = sections.length;
  const approved = sections.filter((section) => section.status === "approved").length;
  const requiredSections = sections.filter((section) => section.is_required);
  const required = requiredSections.length;
  const allRequiredApproved =
    required === 0
      ? approved === total && total > 0
      : requiredSections.every((section) => section.status === "approved");

  return {
    approved,
    required,
    total,
    allRequiredApproved,
    label: `${approved} of ${total} ${total === 1 ? "section" : "sections"} approved`,
  };
}

export function canExport(sections: Section[]): boolean {
  return sections.length > 0 && summariseApproval(sections).allRequiredApproved;
}

export function isLocked(section: Pick<Section, "status">): boolean {
  return section.status === "locked";
}

export function applyContentEdit(section: Section, content: string): Section {
  if (isLocked(section) || section.content === content) return section;
  return {
    ...section,
    content,
    status: "edited",
    updated_at: new Date().toISOString(),
  };
}

export function approveSection(section: Section): Section {
  if (isLocked(section) || section.status === "approved") return section;
  return { ...section, status: "approved", updated_at: new Date().toISOString() };
}

export function unapproveSection(section: Section): Section {
  if (section.status !== "approved") return section;
  return { ...section, status: "edited", updated_at: new Date().toISOString() };
}

export function toggleLock(section: Section): Section {
  const next: SectionStatus = isLocked(section) ? "edited" : "locked";
  return { ...section, status: next, updated_at: new Date().toISOString() };
}

export function pushVersion(section: Section): SectionVersion[] {
  return [
    ...section.version_history,
    { content: section.content, saved_at: new Date().toISOString() },
  ];
}

export function reindex(sections: Section[]): Section[] {
  return sections.map((section, index) =>
    section.order_index === index ? section : { ...section, order_index: index },
  );
}

export function sortByOrder(sections: Section[]): Section[] {
  return [...sections].sort((a, b) => a.order_index - b.order_index);
}

export function moveSectionTo(sections: Section[], id: string, toIndex: number): Section[] {
  const ordered = sortByOrder(sections);
  const fromIndex = ordered.findIndex((section) => section.id === id);
  if (fromIndex === -1) return sections;
  const moving = ordered[fromIndex];
  if (!moving || isLocked(moving)) return sections;

  const clamped = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (clamped === fromIndex) return sections;

  const next = [...ordered];
  next.splice(fromIndex, 1);
  next.splice(clamped, 0, moving);
  return reindex(next);
}

export function moveSectionUp(sections: Section[], id: string): Section[] {
  const ordered = sortByOrder(sections);
  const index = ordered.findIndex((section) => section.id === id);
  return index <= 0 ? sections : moveSectionTo(sections, id, index - 1);
}

export function moveSectionDown(sections: Section[], id: string): Section[] {
  const ordered = sortByOrder(sections);
  const index = ordered.findIndex((section) => section.id === id);
  return index === -1 || index >= ordered.length - 1
    ? sections
    : moveSectionTo(sections, id, index + 1);
}
