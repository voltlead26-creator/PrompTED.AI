// supabase/functions/_shared/draft-validator.ts
// =====================================================
// PrompTED — Draft Validator (deterministic backstop)
// A finished document section must read as final, send-ready
// wording: no bracketed placeholders, fill-in markers, or
// writing instructions. This module is pure, dependency-free
// and unit-tested. The document pipeline calls it as a hard
// gate so nothing leaky or blank can reach the user.
// =====================================================

import { maskDeclaredDocumentPlaceholderTokens } from "./document-placeholder-policy.ts";

export interface ValidatableSection {
  content: string;
  label?: string;
}

// Legitimate markdown that uses square brackets — must NOT be treated as placeholders.
const MARKDOWN_LINK = /!?\[[^\]]*\]\([^)]*\)/g; // [text](url) and ![alt](url)
const TASK_CHECKBOX = /(^|[\s>])\[[ xX]\](?=\s|$)/gm; // - [ ] and - [x] task items

// Fill-in / placeholder markers that must never reach the user.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/, // [recipient name], [date], [insert ...]
  /\{\{[^}]*\}\}/, // {{name}}
  /<[^>]*\b(?:insert|your|name|date|company|address|placeholder|tbd|todo)\b[^>]*>/i, // <your email here>
  /_{3,}/, // ____ blank line
  /\bX{4,}\b/, // XXXX fill marker
  /\b(?:TBD|TODO)\b/, // TBD / TODO
];

// Lines/phrases that read as instructions or scaffold rather than final wording.
const INSTRUCTION_PATTERNS: RegExp[] = [
  /^\s*use this section to\b/im,
  /^\s*insert\s+(?:your|the|a)\b/im,
  /^\s*missing (?:vital )?details\s*:/im,
  /\bas an ai\b/i,
  /\b(?:here'?s|here is) (?:a|the) (?:prompt|template)\b/i,
];

// Unreplaced starter-draft markers and phrasing that DESCRIBES the document
// instead of BEING it. The marker is the primary signal (every starter draft
// carries it). The phrase patterns are anchored to "this section/document/
// letter/proposal/the draft" + a structural verb, so real final wording
// ("services will be provided", "I will bring...") is not hit.
const SCAFFOLD_PATTERNS: RegExp[] = [
  /<!--\s*prompted:[^>]*-->/i,
  /\b(?:this section|this document|this letter|this proposal|the proposal|the draft)\s+(?:will|supports|begins by|contains|captures|lists|records|sets out|closes|introduces|explains|covers|identifies|summaris(?:es)?)\b/i,
  /\bthe (?:user|candidate)\b/i,
];

function mask(content: string): string {
  const { masked } = maskDeclaredDocumentPlaceholderTokens(content);
  return masked.replace(MARKDOWN_LINK, " ").replace(TASK_CHECKBOX, " ");
}

/**
 * Returns reasons the section is NOT final, send-ready wording.
 * An empty array means the section is clean and may ship unchanged.
 */
export function validateSection(section: ValidatableSection): string[] {
  const issues: string[] = [];
  const raw = (section.content ?? "").trim();
  if (!raw) return ["empty: section has no usable content"];

  // Rich-text editors can leave tag-only husks (e.g. "<p><br></p>" or
  // "&nbsp;") after the user deletes everything. That is still an empty
  // section: strip tags and non-breaking spaces before judging emptiness.
  const visible = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .trim();
  if (!visible) return ["empty: section has no usable content"];

  const masked = mask(raw);
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(masked)) {
      issues.push(`placeholder: ${pattern}`);
      break;
    }
  }
  for (const pattern of INSTRUCTION_PATTERNS) {
    if (pattern.test(raw)) {
      issues.push(`instruction: ${pattern}`);
      break;
    }
  }
  for (const pattern of SCAFFOLD_PATTERNS) {
    if (pattern.test(raw)) {
      issues.push(`scaffold: ${pattern}`);
      break;
    }
  }
  return issues;
}

/**
 * Last-resort cleanup when a retry still fails validation: strips residual
 * placeholders and instruction lines while preserving legitimate markdown
 * links and task checkboxes. May return "" (the caller then falls back to the
 * section label rather than ever shipping leaky text).
 */
export function stripResidual(content: string): string {
  const safe: string[] = [];
  const protect = (match: string): string => {
    safe.push(match);
    return `\uE000${safe.length - 1}\uE000`;
  };

  const declared = maskDeclaredDocumentPlaceholderTokens(content);
  let work = declared.masked.replace(MARKDOWN_LINK, protect).replace(TASK_CHECKBOX, protect);

  work = work
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/<!--\s*prompted:[^>]*-->/gi, "")
    .replace(/<[^>]*\b(?:insert|your|name|date|company|address|placeholder|tbd|todo)\b[^>]*>/gi, "")
    .replace(/_{3,}/g, "")
    .replace(/\bX{4,}\b/g, "")
    .replace(/\b(?:TBD|TODO)\b/g, "");

  work = work
    .split("\n")
    .filter((line) => ![...INSTRUCTION_PATTERNS, ...SCAFFOLD_PATTERNS].some((p) => p.test(line)))
    .join("\n");

  work = work.replace(/\uE000(\d+)\uE000/g, (_full, index) => safe[Number(index)] ?? "");
  work = declared.restore(work);

  return work
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
