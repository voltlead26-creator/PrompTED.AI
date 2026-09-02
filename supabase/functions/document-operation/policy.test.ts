// deno-lint-ignore-file no-import-prefix -- dependency is pinned by the repository Deno lockfile.
import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyOwnerCancellationFailure,
  classifyOwnerOperationLookupFailure,
  deferredCapacityResumeResult,
  mapCapturedAcceptanceResult,
  shouldDeferCapacityResume,
} from "./policy.ts";

const OPERATION_ID = "55555555-5555-4555-8555-555555555555";

Deno.test("only the exact owner-safe operation-not-found RPC error becomes 404", () => {
  assertEquals(
    classifyOwnerOperationLookupFailure(
      {
        code: "P0001",
        message: "CAPTURED_OPERATION_NOT_FOUND",
      },
      OPERATION_ID,
    ),
    {
      status: 404,
      body: {
        operation_id: OPERATION_ID,
        error: {
          code: "CAPTURED_OPERATION_NOT_FOUND",
          message: "That document operation is unavailable for this account.",
        },
        retryable: false,
      },
    },
  );
  assertEquals(
    classifyOwnerOperationLookupFailure(
      { code: "CAPTURED_OPERATION_NOT_FOUND", message: "owner-safe absence" },
      OPERATION_ID,
    ).status,
    404,
  );

  for (const error of [
    { code: "08006", message: "connection failure" },
    { code: "P0001", message: "CAPTURED_OPERATION_NOT_FOUNDISH" },
    { code: "P0001", message: "wrapped CAPTURED_OPERATION_NOT_FOUND detail" },
    null,
  ]) {
    assertEquals(classifyOwnerOperationLookupFailure(error, OPERATION_ID), {
      status: 503,
      body: {
        operation_id: OPERATION_ID,
        error: {
          code: "CAPTURED_OPERATION_STATUS_UNAVAILABLE",
          message: "TED could not confirm this operation's durable status yet.",
        },
        retryable: true,
      },
    });
  }
});

Deno.test("cancellation exposes not-found only for the exact owner-safe RPC error", () => {
  assertEquals(
    classifyOwnerCancellationFailure(
      { code: "P0001", message: "CAPTURED_OPERATION_NOT_FOUND" },
      "CAPTURED_OPERATION_NOT_FOUND",
      OPERATION_ID,
    ).status,
    404,
  );
  assertEquals(
    classifyOwnerCancellationFailure(
      { code: "P0001", message: "wrapped CAPTURED_OPERATION_NOT_FOUND detail" },
      "CAPTURED_OPERATION_NOT_FOUND",
      OPERATION_ID,
    ),
    {
      status: 503,
      body: {
        operation_id: OPERATION_ID,
        error: {
          code: "CAPTURED_OPERATION_CANCELLATION_UNAVAILABLE",
          message: "TED could not record cancellation safely.",
        },
        retryable: true,
      },
    },
  );
  assertEquals(
    classifyOwnerCancellationFailure(
      { code: "08006", message: "connection failure" },
      "DATABASE_08006",
      OPERATION_ID,
    ),
    {
      status: 503,
      body: {
        operation_id: OPERATION_ID,
        error: {
          code: "CAPTURED_OPERATION_CANCELLATION_UNAVAILABLE",
          message: "TED could not record cancellation safely.",
        },
        retryable: true,
      },
    },
  );
});

Deno.test("an early capacity resume stays accepted without background scheduling", () => {
  assertEquals(
    shouldDeferCapacityResume({
      operation_id: OPERATION_ID,
      status: "awaiting_capacity",
      resume_available: false,
    }),
    true,
  );
  assertEquals(
    shouldDeferCapacityResume({
      operation_id: OPERATION_ID,
      status: "awaiting_capacity",
      resume_available: true,
    }),
    false,
  );
  assertEquals(
    shouldDeferCapacityResume({
      operation_id: OPERATION_ID,
      status: "generating",
      resume_available: false,
    }),
    false,
  );
  assertEquals(
    deferredCapacityResumeResult(
      {
        operation_id: OPERATION_ID,
        document_id: "33333333-3333-4333-8333-333333333333",
        operation_revision: 9,
        status: "awaiting_capacity",
        resume_available: false,
        retryable: true,
      },
      OPERATION_ID,
    ),
    {
      status: 202,
      body: {
        operation_id: OPERATION_ID,
        document_id: "33333333-3333-4333-8333-333333333333",
        operation_revision: 9,
        status: "awaiting_capacity",
        resume_available: false,
        retryable: true,
        reconnect: "/api/document-operation?operation_id=55555555-5555-4555-8555-555555555555",
        background_execution: "deferred",
      },
    },
  );
});

Deno.test(
  "capacity configuration failure maps to a stable nonretryable activation response",
  () => {
    assertEquals(
      mapCapturedAcceptanceResult({
        status: 500,
        body: {
          error: {
            code: "CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE",
            message: "internal database detail",
          },
          retryable: true,
        },
      }),
      {
        status: 503,
        body: {
          error: {
            code: "CAPTURED_ACTIVATION_NOT_READY",
            message: "Captured document generation is not ready in this environment.",
          },
          retryable: false,
        },
      },
    );

    const unrelated = {
      status: 500,
      body: {
        error: { code: "CAPTURED_OPERATION_RPC_FAILED" },
        retryable: true,
        operation_id: OPERATION_ID,
      },
    };
    assertEquals(mapCapturedAcceptanceResult(unrelated), unrelated);
  },
);
