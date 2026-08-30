// =====================================================
// PrompTED — Font loading
// DM Sans via next/font — warm, legible, trusted.
// Used by Australian Government Digital Services (DTA).
// Single typeface for all UI and document chrome.
// =====================================================

import { DM_Sans } from "next/font/google";

export const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
