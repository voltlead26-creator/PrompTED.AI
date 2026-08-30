// Universal Upload Analysis layer (DIE) — the client-side view of which
// uploads make each document type noticeably stronger. Mirrors the upload
// lists in the server-side Document Intelligence Profiles so the Workspace can
// offer them BEFORE generation. Keep these lists in sync with
// supabase/functions/_shared/document-intelligence-profiles.ts.

interface UploadSuggestion {
  keywords: string[];
  uploads: string[];
}

const SUGGESTIONS: UploadSuggestion[] = [
  { keywords: ["resume", "cv", "curriculum vitae", "venue manager"], uploads: ["your existing resume", "the job advertisement", "a recent performance review", "KPI or revenue reports"] },
  { keywords: ["cover letter", "application letter"], uploads: ["your resume", "the job advertisement"] },
  { keywords: ["selection criteria", "key selection"], uploads: ["the job description", "your resume"] },
  { keywords: ["linkedin"], uploads: ["your resume", "your current LinkedIn profile"] },
  { keywords: ["reference", "referee", "recommendation letter"], uploads: ["the role or purpose it's for", "any background on the person"] },
  { keywords: ["business plan"], uploads: ["existing business documents", "market research", "financial forecasts"] },
  { keywords: ["business proposal", "client proposal", "sales proposal", "service proposal", "project proposal", "commercial proposal", "proposal document"], uploads: ["the client brief or request for proposal", "discovery or sales-call notes", "pricing or quote details", "case studies or relevant proof", "scope of work or service details"] },
  { keywords: ["funding", "investor", "pitch", "grant"], uploads: ["financial statements", "forecasts", "your business plan"] },
  { keywords: ["quarterly business review", "qbr"], uploads: ["sales reports", "KPI reports", "staff metrics", "previous QBRs"] },
  { keywords: ["performance review", "appraisal"], uploads: ["KPI reports", "manager notes", "previous reviews"] },
  { keywords: ["financial review", "profit and loss", "p&l"], uploads: ["your P&L statement", "payroll reports", "sales reports", "BAS statements"] },
  { keywords: ["risk assessment", "risk register"], uploads: ["incident reports", "safety audits", "operational procedures"] },
  { keywords: ["safety review", "whs", "hazard"], uploads: ["incident logs", "near-miss reports", "safety audits", "training records"] },
  { keywords: ["operational review"], uploads: ["SOPs", "KPI reports", "staffing reports"] },
  { keywords: ["board report", "board paper"], uploads: ["financials", "KPI dashboards", "previous board papers"] },
  { keywords: ["meeting minutes", "minutes"], uploads: ["the meeting transcript", "your notes"] },
  { keywords: ["debrief", "event debrief", "project closure", "post mortem"], uploads: ["incident or event reports", "the project plan", "an outcomes report"] },
  { keywords: ["internal review", "infringement", "fine", "penalty notice"], uploads: ["the fine or infringement notice", "any supporting evidence"] },
  { keywords: ["support letter"], uploads: ["any relevant evidence"] },
  { keywords: ["statutory declaration", "stat dec"], uploads: ["any supporting documents"] },
  { keywords: ["complaint", "demand letter", "dispute", "refund"], uploads: ["contracts, receipts or correspondence", "photos or other evidence"] },
  { keywords: ["rental application", "tenancy application"], uploads: ["recent payslips", "your rental ledger", "references"] },
  { keywords: ["hardship"], uploads: ["recent bills", "financial statements"] },
  { keywords: ["lease dispute", "tenancy dispute", "bond", "rent increase"], uploads: ["your lease", "relevant correspondence"] },
  { keywords: ["personal statement", "statement of purpose"], uploads: ["your resume", "your academic records"] },
  { keywords: ["scholarship"], uploads: ["your academic results", "any awards", "your resume"] },
];

/**
 * Returns the uploads that would most improve a document, based on a free-text
 * hint (template name + id + situation). Empty array = nothing worth asking
 * for, so the Workspace should skip the Upload Analysis step entirely.
 */
export function suggestedUploadsForDocument(hint: string): string[] {
  const h = (hint || "").toLowerCase();
  for (const s of SUGGESTIONS) {
    if (s.keywords.some((k) => h.includes(k))) return s.uploads;
  }
  return [];
}
