// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { requestPrivateStorageObject } from "./private-storage-object.ts";

const USER_ID = "71000000-0000-4000-8000-000000000001";
const UPLOAD_ID = "72000000-0000-4000-8000-000000000001";

function input() {
  return {
    baseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    serviceRoleKey: "synthetic-service-role",
    bucket: "original-documents" as const,
    path: `${USER_ID}/${UPLOAD_ID}/resume.txt`,
    method: "GET" as const,
    timeoutMs: 1_000,
    maximumResponseBytes: 1024,
  };
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "non-error";
}

Deno.test("private Storage maps retained 404 to source conflict and cancels its body", async () => {
  let cancelled = false;
  const failure = await assertRejects(() =>
    requestPrivateStorageObject(input(), () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode("private storage detail"),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 404 },
        ),
      ))
  );
  assertEquals(errorMessage(failure), "PRIVATE_STORAGE_NOT_FOUND");
  assertEquals(cancelled, true);
});

Deno.test("private Storage accepts only exact owner/upload/filename object paths", async () => {
  let fetchCalls = 0;
  const failure = await assertRejects(() =>
    requestPrivateStorageObject(
      { ...input(), path: `${USER_ID}/resume.txt` },
      () => {
        fetchCalls += 1;
        return Promise.resolve(new Response("source"));
      },
    )
  );
  assertEquals(errorMessage(failure), "PRIVATE_STORAGE_PATH_INVALID");
  assertEquals(fetchCalls, 0);
});

Deno.test("private Storage keeps transient service failures retryable and sanitized", async () => {
  let cancelled = false;
  const failure = await assertRejects(() =>
    requestPrivateStorageObject(input(), () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 503 },
        ),
      ))
  );
  assertEquals(errorMessage(failure), "PRIVATE_STORAGE_RETRYABLE");
  assertEquals(cancelled, true);
});
