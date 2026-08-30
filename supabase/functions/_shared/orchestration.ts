// =====================================================
// PrompTED — Orchestration helpers (Deno / Edge runtime)
// Pure functions for parsing model output and streaming.
// Validation of the resulting shapes is done client-side
// via packages/shared/orchestration.ts.
// =====================================================

/**
 * Parse JSON from a model's text response.
 * Handles ```json fenced blocks and surrounding prose by extracting the first
 * balanced JSON object/array. Returns null if no JSON can be recovered.
 */
export function parseModelJson(text: string): unknown {
  if (!text) return null;

  // Strip code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // Try a direct parse first.
  try {
    return JSON.parse(candidate.trim());
  } catch {
    // Fall through to bracket extraction.
  }

  const extracted = extractFirstJson(candidate);
  if (extracted) {
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
  return null;
}

/** Extract the first balanced {...} or [...] block from a string. */
function extractFirstJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ----- Server-Sent Events helpers -----

const encoder = new TextEncoder();

/** Format a single SSE data event with a JSON payload. */
export function sseEvent(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** The SSE done sentinel. */
export function sseDone(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

/**
 * A raw SSE comment line. Sent periodically during long-running,
 * no-progress-events stages (e.g. the multi-stage document pipeline, which
 * awaits one monolithic call before it has anything real to stream) purely
 * to keep bytes flowing — Supabase Edge Functions close the connection with
 * a 504 after ~150s of no output, regardless of how long the function's own
 * wall-clock budget is. Ignored by the client parser (it isn't valid JSON,
 * and malformed lines are silently skipped), never delivered to callers.
 */
export function sseHeartbeat(): Uint8Array {
  return encoder.encode(": heartbeat\n\n");
}

export const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};
