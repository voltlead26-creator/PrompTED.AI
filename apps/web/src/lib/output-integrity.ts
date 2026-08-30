export type OutputIntegrityCode =
  | "blank"
  | "scaffold"
  | "meta_instruction"
  | "prompt_leak";

export interface OutputIntegrityResult {
  valid: boolean;
  code: OutputIntegrityCode | null;
  message: string | null;
}

const META_INSTRUCTION_PATTERNS = [
  /\binsert (?:your|the)\b/i,
  /\bfill in (?:your|the)\b/i,
  /\breplace (?:this|with|the text)\b/i,
  /\bprovide (?:details|information|your)\b/i,
  /\badd (?:specific|relevant|your) (?:details|information|examples)\b/i,
  /\bwrite (?:a|your|the)\b.*\bhere\b/i,
  /\bprompt the user\b/i,
  /\bask the user\b/i,
  /\bthis section should\b/i,
  /\bthe document should\b/i,
];

const PROMPT_LEAK_PATTERNS = [
  /\bsystem prompt\b/i,
  /\byou are (?:an?|the) ai\b/i,
  /\brespond with only\b/i,
  /\bdo not include (?:a|any) preamble\b/i,
  /\btemplate_id\b/i,
  /\bconversation_context\b/i,
  /\bupload_context\b/i,
];

export function validateFinishedSection(content: string): OutputIntegrityResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { valid: false, code: "blank", message: "TED returned an empty section." };
  }

  if (/TED will replace this scaffold|prompted:template-draft/i.test(trimmed)) {
    return { valid: false, code: "scaffold", message: "TED returned unfinished scaffold text." };
  }

  if (PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { valid: false, code: "prompt_leak", message: "TED returned internal instruction text." };
  }

  if (META_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { valid: false, code: "meta_instruction", message: "TED returned instructions instead of final wording." };
  }

  return { valid: true, code: null, message: null };
}
