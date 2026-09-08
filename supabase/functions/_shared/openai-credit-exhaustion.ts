// Only explicit billing/quota errors can authorize a change of provider.
// Provider error messages are neither policy inputs nor safe log content.
const MAX_ERROR_BYTES = 16_384;
const CREDIT_ERROR_CODES = new Set([
  "credit_balance_exhausted",
  "insufficient_quota",
]);

export async function isOpenAICreditExhaustion(
  response: Response,
): Promise<boolean> {
  if (response.status !== 429 && response.status !== 402) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }
  const reader = response.body?.getReader();
  if (!reader) return false;
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return false;
      chunks.push(chunk.value);
    }
    const content = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(content),
    );
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const error = (data as Record<string, unknown>).error;
    if (!error || typeof error !== "object" || Array.isArray(error)) {
      return false;
    }
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" && CREDIT_ERROR_CODES.has(code);
  } catch {
    // Incomplete or malformed evidence must keep the ordinary upstream error;
    // it must never authorize fallback or imply that OpenAI billed nothing.
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
