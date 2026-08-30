// =====================================================
// PrompTED — Colour contrast tests (Little Miss Scarlett palette)
// WCAG AA: normal text ≥ 4.5:1, large text / UI ≥ 3:1
// =====================================================

import { describe, it, expect } from "vitest";

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const chan = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(a: string, b: string): number {
  const lA = luminance(a);
  const lB = luminance(b);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Little Miss Scarlett — WCAG AA contrast", () => {
  it("ink on paper ≥ 4.5", () => {
    expect(contrastRatio("#2B2521", "#F7F1E7")).toBeGreaterThanOrEqual(4.5);
  });
  it("ink-soft on paper ≥ 4.5", () => {
    expect(contrastRatio("#5E544A", "#F7F1E7")).toBeGreaterThanOrEqual(4.5);
  });
  it("white on scarlet (CTA) ≥ 4.5", () => {
    expect(contrastRatio("#FFFFFF", "#C8442B")).toBeGreaterThanOrEqual(4.5);
  });
  it("paper on ink nav ≥ 7 (wordmark)", () => {
    expect(contrastRatio("#F7F1E7", "#2B2521")).toBeGreaterThanOrEqual(7);
  });
  it("scarlet on ink nav ≥ 3:1 (large logo text)", () => {
    expect(contrastRatio("#C8442B", "#2B2521")).toBeGreaterThanOrEqual(3);
  });
  // Policy: raw scarlet is a UI/large-text colour only (CTAs, wordmark,
  // icons). A single scarlet cannot mathematically satisfy both >=4.5 on
  // paper and >=3 on the ink nav — the luminance window is empty. Any
  // scarlet BODY text on paper must use --scarlet-deep instead.
  it("scarlet on paper ≥ 3 (UI components / large text)", () => {
    expect(contrastRatio("#C8442B", "#F7F1E7")).toBeGreaterThanOrEqual(3);
  });
  it("scarlet-deep on paper ≥ 4.5 (scarlet body text uses this token)", () => {
    expect(contrastRatio("#A8351F", "#F7F1E7")).toBeGreaterThanOrEqual(4.5);
  });
  it("sage on paper ≥ 4.5", () => {
    expect(contrastRatio("#5E7350", "#F7F1E7")).toBeGreaterThanOrEqual(4.5);
  });
});
