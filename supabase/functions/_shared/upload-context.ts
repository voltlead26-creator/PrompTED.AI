export const MAX_INLINE_UPLOAD_CONTEXT_CHARS = 20_000;

export interface PreparedUploadText {
  retainedText: string;
  contextExcerpt: string;
  contextExcerptTruncated: boolean;
}

export function prepareUploadText(completeText: string): PreparedUploadText {
  return {
    retainedText: completeText,
    contextExcerpt: completeText.slice(0, MAX_INLINE_UPLOAD_CONTEXT_CHARS),
    contextExcerptTruncated:
      completeText.length > MAX_INLINE_UPLOAD_CONTEXT_CHARS,
  };
}

export async function resolveRetainedUploadContext(
  admin: SupabaseClient,
  userId: string,
  uploadId: string,
  inlineContext: string,
): Promise<string> {
  if (!uploadId) return inlineContext;
  const { data } = await admin
    .from("uploads")
    .select("extracted_text")
    .eq("id", uploadId)
    .eq("user_id", userId)
    .maybeSingle();
  const retainedText = String(data?.extracted_text ?? "").trim();
  return retainedText
    ? `Complete uploaded document:\n${retainedText}`
    : inlineContext;
}
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
