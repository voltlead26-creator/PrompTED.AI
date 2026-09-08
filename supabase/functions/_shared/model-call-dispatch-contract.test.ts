import { deepStrictEqual, strictEqual } from "node:assert";
// Match the deployed Supabase SDK boundary rather than an in-memory RPC mock.
// deno-lint-ignore no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bindModelCallContext,
  markLegacyModelAttemptDispatched,
} from "./model-call-context.ts";

Deno.test("non-allowance dispatch serializes the required nullable RPC argument", async () => {
  const requests: Record<string, unknown>[] = [];
  const admission = "20000000-0000-4000-8000-000000000003";
  const admin = createClient("http://127.0.0.1:54321", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init) => {
        strictEqual(
          new URL(String(url)).pathname,
          "/rest/v1/rpc/mark_legacy_model_attempt_dispatched",
        );
        const args = await new Request(url, init).json();
        requests.push(args);
        if (!Object.hasOwn(args, "p_origin_reservation_id")) {
          return Response.json({
            code: "PGRST202",
            message: "Required RPC argument omitted",
          }, { status: 404 });
        }
        return Response.json({
          state: "dispatched",
          attempt_admission_id: admission,
          provider_attempt_id: admission,
        });
      },
    },
  });
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "10000000-0000-4000-8000-000000000001",
    admin,
    generationRequestId: "synthetic-upload",
    checkpoint: {
      scope: "ingest-upload",
      executionClaimToken: "30000000-0000-4000-8000-000000000001",
    },
  });
  await markLegacyModelAttemptDispatched(signal, {
    logicalStageKey: "ingest-upload.classify",
    requestSha256: "a".repeat(64),
    attemptNumber: 1,
    durableAdmissionId: admission,
  });
  strictEqual(requests.length, 1);
  strictEqual(requests[0].p_origin_reservation_id, null);
  deepStrictEqual(
    Object.keys(requests[0]).sort(),
    [
      "p_user_id",
      "p_checkpoint_scope",
      "p_origin_reservation_id",
      "p_logical_request_id",
      "p_logical_stage_key",
      "p_request_sha256",
      "p_attempt_number",
      "p_attempt_admission_id",
      "p_execution_claim_token",
      "p_dispatch_token",
    ].sort(),
  );
});
