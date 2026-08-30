export interface DeliverableSection {
  key: string;
  label: string;
  content: string;
}

/** Final boundary invariant: a successful document response may never contain
 * a blank section. Missing facts must already have been represented as declared
 * placeholders or approved neutral fallbacks before this point. */
export function assertDeliverableSections(
  sections: readonly DeliverableSection[],
): void {
  const hasBlankSection = sections.some((section) => !section.content.trim());
  if (hasBlankSection) {
    throw new Error("DOCUMENT_QUALITY_FAILED:blank_output");
  }
}
