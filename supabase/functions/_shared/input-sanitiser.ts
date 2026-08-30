// =====================================================

import { privateResponseHeaders } from "./cors.ts";
// PrompTED — Input Sanitiser
// Strips HTML, caps lengths, and validates types for all
// user-supplied input reaching Edge Functions.
// =====================================================

export const MAX_TEXT_LENGTH = 20_000;
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export class InputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** Strip all HTML tags from a string. */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

/**
 * Validate that `input` is a string, optionally strip HTML, and enforce the
 * character cap. Returns the sanitised string.
 */
export function sanitiseText(
  input: unknown,
  options: { strip?: boolean; max?: number; field?: string } = {},
): string {
  const { strip = false, max = MAX_TEXT_LENGTH, field = "input" } = options;

  if (typeof input !== "string") {
    throw new InputError("INVALID_TYPE", `${field} must be a string.`);
  }
  const text = strip ? stripHtml(input) : input;
  if (text.length > max) {
    throw new InputError(
      "INPUT_TOO_LONG",
      `${field} exceeds the maximum length of ${max} characters.`,
    );
  }
  return text;
}

/** Throw if a file size exceeds the 20 MB upload limit. */
export function validateFileSize(sizeBytes: number): void {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new InputError(
      "FILE_TOO_LARGE",
      "File exceeds the 20 MB size limit.",
      413,
    );
  }
}

/** Build a ready-to-return 400/413 response from an InputError. */
export function inputErrorResponse(err: InputError, origin: string | null = null): Response {
  const headers: Record<string, string> = {
    ...privateResponseHeaders(),
    "Content-Type": "application/json",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(
    JSON.stringify({ error: { code: err.code, message: err.message } }),
    { status: err.status, headers },
  );
}
