// =====================================================
// PrompTED — Example chips (Home screen)
// Static seed data. Chips fill the input; they never auto-submit.
// =====================================================

import type { Domain } from "./types";

export interface ExampleChip {
  /** Short label shown on the chip. */
  label: string;
  /** Full text dropped into the composer when tapped. */
  fill: string;
  domain: Domain;
}

/**
 * Rotating example situations across the three primary domains.
 * The Home screen shows 5–8 at a time; the data is intentionally broad
 * so TED's clarification can converge from a wide starting point.
 */
export const EXAMPLE_CHIPS: ExampleChip[] = [
  // Employment
  { label: "I need a job", fill: "I'm looking for a new job and need help putting myself forward.", domain: "employment" },
  { label: "I'm applying", fill: "I'm applying for a role and want my application to stand out.", domain: "employment" },
  { label: "Onboard someone", fill: "I've hired someone new and need to get them set up properly.", domain: "employment" },
  { label: "Write a policy", fill: "I need a workplace policy for my team.", domain: "business" },
  // Education
  { label: "Enrol my child", fill: "I need to sort out enrolment for my child at a new school.", domain: "education" },
  { label: "Apply to study", fill: "I want to apply to study and need help with the application.", domain: "education" },
  // Business / personal
  { label: "Start a business", fill: "I'm starting a business and don't know what paperwork I need.", domain: "business" },
  { label: "Moving house", fill: "I'm moving house and want to make sure I've covered everything.", domain: "personal" },
];

/** Returns up to `count` chips, rotated by a stable seed (e.g. day-of-month). */
export function rotateChips(chips: ExampleChip[], seed: number, count = 6): ExampleChip[] {
  if (chips.length <= count) return chips;
  const start = Math.abs(seed) % chips.length;
  const out: ExampleChip[] = [];
  for (let i = 0; i < count; i++) {
    const chip = chips[(start + i) % chips.length];
    if (chip) out.push(chip);
  }
  return out;
}
