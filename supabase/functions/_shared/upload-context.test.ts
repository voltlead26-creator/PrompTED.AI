import { assertEquals } from "jsr:@std/assert";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  prepareUploadText,
  resolveRetainedUploadContext,
} from "./upload-context.ts";

Deno.test("upload preparation retains the complete document while bounding only inline context", () => {
  const completeText = `Resume\n${"evidence ".repeat(12_000)}`;
  const prepared = prepareUploadText(completeText);

  assertEquals(prepared.retainedText, completeText);
  assertEquals(prepared.contextExcerpt.length, 20_000);
  assertEquals(prepared.contextExcerptTruncated, true);
});

Deno.test("retained upload context is loaded only for the authenticated owner", async () => {
  const filters: Array<[string, string]> = [];
  const chain = {
    select: () => chain,
    eq: (field: string, value: string) => {
      filters.push([field, value]);
      return chain;
    },
    maybeSingle: async () => ({
      data: { extracted_text: "complete retained resume" },
      error: null,
    }),
  };
  const admin = {
    from: (table: string) => {
      assertEquals(table, "uploads");
      return chain;
    },
  } as unknown as SupabaseClient;

  const resolved = await resolveRetainedUploadContext(
    admin,
    "owner-user-id",
    "upload-id",
    "inline excerpt",
  );

  assertEquals(
    resolved,
    "Complete uploaded document:\ncomplete retained resume",
  );
  assertEquals(filters, [
    ["id", "upload-id"],
    ["user_id", "owner-user-id"],
  ]);
});
