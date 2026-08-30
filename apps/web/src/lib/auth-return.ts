const DEFAULT_RETURN_PATH = "/home";

/**
 * Accept only same-origin application paths. Authentication return values are
 * user-controlled query parameters, so protocol-relative URLs, backslashes,
 * control characters and non-path values must fall back safely.
 */
export function safeInternalReturnPath(
  value: string | null | undefined,
  fallback = DEFAULT_RETURN_PATH,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\u0000-\u001F\u007F]/u.test(value)) return fallback;

  try {
    const parsed = new URL(value, "https://prompted.local");
    if (parsed.origin !== "https://prompted.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function signInHref(returnPath: string): string {
  return `/sign-in?next=${encodeURIComponent(safeInternalReturnPath(returnPath))}`;
}
