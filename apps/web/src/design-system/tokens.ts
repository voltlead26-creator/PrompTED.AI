// =====================================================
// PrompTED — Design Tokens (TypeScript constants)
// Mirror of tokens.css for use in JS/TS (charts, inline styles, tests).
// Keep in sync with tokens.css.
// =====================================================

export const colors = {
  cream: "#F6F0E6",
  creamDeep: "#EFE5D4",
  card: "#FFFDF8",
  coral: "#DC5430",
  coralDeep: "#B83F22",
  charcoal: "#26211C",
  charcoalSoft: "#5E544A",
  charcoalMuted: "#8C7F74",
  line: "#DDD4C5",
  lineSoft: "#EDE5D9",
  teal: "#2D9E9E",
  amber: "#D97706",
  redSoft: "#DC2626",
  white: "#FFFFFF",
  bgHover: "#EFE7D9",
  tooltipBg: "#26211C",
  tooltipText: "#FFFFFF",
} as const;

export const statusColors = {
  draft: { bg: "#EFE5D4", text: "#5E544A", border: "#DDD4C5" },
  edited: { bg: "#FEF3C7", text: "#92400E", border: "#D97706" },
  approved: { bg: "#D1FAE5", text: "#065F46", border: "#2D9E9E" },
  locked: { bg: "#E5E2DE", text: "#26211C", border: "#5E544A" },
} as const;

export const fontSizes = {
  display: "2.5rem",
  headingXl: "1.75rem",
  headingLg: "1.375rem",
  headingMd: "1.1875rem",
  bodyLg: "1.125rem",
  bodyMd: "1.0625rem", // 17px floor
  bodySm: "0.9375rem",
  label: "0.875rem",
  caption: "0.8125rem",
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

export const spacing = {
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
} as const;

export const radius = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  pill: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 4px rgba(38, 33, 28, 0.06)",
  md: "0 4px 16px rgba(38, 33, 28, 0.10)",
  lg: "0 8px 32px rgba(38, 33, 28, 0.14)",
} as const;

export const breakpoints = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

export const TOUCH_TARGET = "2.75rem"; // 44px — minimum interactive size
export const BODY_FLOOR = "1.0625rem"; // 17px — minimum body text size

export type StatusKey = keyof typeof statusColors;
