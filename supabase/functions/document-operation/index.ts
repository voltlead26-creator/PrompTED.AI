// deno-lint-ignore-file no-import-prefix -- dependency is pinned by the repository Deno lockfile.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { corsHeaders, handleOptions, rejectForbiddenOrigin } from "../_shared/cors.ts";
import {
  type CapturedOperationBody,
  runCapturedDocumentOperation,
} from "../_shared/captured-operation-runner.ts";
import { scheduleEdgeBackgroundTaskWithModelContext } from "./background.ts";
import {
  classifyOwnerCancellationFailure,
  classifyOwnerOperationLookupFailure,
  deferredCapacityResumeResult,
  mapCapturedAcceptanceResult,
} from "./policy.ts";

function response(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json",
      Pragma: "no-cache",
      Vary: "Authorization, Origin",
    },
  });
}

function deploymentScope(): { environment: string } {
  return {
    environment: Deno.env.get("PROMPTED_DEPLOYMENT_ENV")?.trim().toLowerCase() || "unconfigured",
  };
}

function userClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization");
  if (!url || !anon || !authorization) return null;
  return createClient(url, anon, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type DocumentOperationAction = "start" | "resume" | "cancel";

function actionName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function operationUuid(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate
    : null;
}

function positiveRevision(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

function rpcCode(error: { message?: string; code?: string } | null): string {
  const match = (error?.message ?? "").match(/\b([A-Z][A-Z0-9_]{3,})\b/);
  return (
    match?.[1] ??
    (error?.code?.startsWith("CAPTURED_") ? error.code : undefined) ??
    (error?.code ? `DATABASE_${error.code}` : "CAPTURED_OPERATION_RPC_FAILED")
  );
}

function recordBackgroundResult(result: { status: number; body: Record<string, unknown> }): void {
  if (result.status < 400) return;
  const rawError = result.body.error;
  const code =
    rawError && typeof rawError === "object" && !Array.isArray(rawError)
      ? String((rawError as Record<string, unknown>).code ?? "UNKNOWN")
      : "UNKNOWN";
  console.error(
    JSON.stringify({
      event: "captured_operation_background_result",
      status: result.status,
      code,
    }),
  );
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");
  const forbidden = rejectForbiddenOrigin(req);
  if (forbidden) return forbidden;

  if (req.method !== "POST" && req.method !== "GET") {
    return response(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Use POST to start or resume and GET to reconnect.",
        },
        retryable: false,
      },
      405,
      origin,
    );
  }

  try {
    const auth = await guardRequest(req, {
      // Only acceptance of a genuinely new operation is allowance-gated.
      // Resume and cancellation operate on an already accepted owner record.
      enforceCap: req.method === "POST"
        ? (body) => {
            const action = actionName(body?.action);
            return action !== "resume" && action !== "cancel";
          }
        : false,
      // Status polling must never consume the mutation recovery budget. Four
      // active tabs can each use the documented two-second poll cadence while
      // start/resume/cancel retain independent bounded buckets.
      rateLimitOperation: req.method === "GET"
        ? "document-operation:status"
        : (body) => {
            const action = actionName(body?.action);
            return `document-operation:${
              action === "resume" || action === "cancel" ? action : "start"
            }`;
          },
      rateLimitLimit: req.method === "GET" ? 120 : 30,
      rateLimitWindowSeconds: 60,
    });

    if (req.method === "GET") {
      const operationId = new URL(req.url).searchParams.get("operation_id") ?? "";
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          operationId,
        )
      ) {
        return response(
          {
            error: {
              code: "CAPTURED_OPERATION_UUID_INVALID",
              message: "A valid operation_id is required.",
            },
            retryable: false,
          },
          400,
          origin,
        );
      }
      const client = userClient(req);
      if (!client) {
        const failure = classifyOwnerOperationLookupFailure(null, operationId);
        return response(failure.body, failure.status, origin);
      }
      const { data, error } = await client.rpc("get_captured_document_operation", {
        p_operation_id: operationId,
      });
      const operation =
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).operation_id === operationId
          ? (data as Record<string, unknown>)
          : null;
      if (error || !operation) {
        const failure = classifyOwnerOperationLookupFailure(
          error ? { message: error.message, code: error.code } : null,
          operationId,
        );
        return response(failure.body, failure.status, origin);
      }
      return response(
        {
          ...operation,
          reconnect: `/api/document-operation?operation_id=${operationId}`,
        },
        200,
        origin,
      );
    }

    const action = actionName(auth.body?.action) || "start";
    if (!(["start", "resume", "cancel"] as const).includes(action as DocumentOperationAction)) {
      return response(
        {
          error: {
            code: "CAPTURED_OPERATION_ACTION_INVALID",
            message: "Use start, resume, or cancel for this operation.",
          },
          retryable: false,
        },
        400,
        origin,
      );
    }

    if (action === "cancel") {
      const operationId = operationUuid(auth.body?.operation_id);
      const expectedRevision = positiveRevision(auth.body?.expected_operation_revision);
      const cancellationCode =
        typeof auth.body?.cancellation_code === "string" ? auth.body.cancellation_code.trim() : "";
      if (!operationId || !expectedRevision || !cancellationCode || cancellationCode.length > 120) {
        return response(
          {
            error: {
              code: "CAPTURED_CANCELLATION_REQUEST_INVALID",
              message:
                "A valid operation_id, expected_operation_revision, and cancellation_code are required.",
            },
            retryable: false,
          },
          400,
          origin,
        );
      }
      const client = userClient(req);
      if (!client) {
        return response(
          {
            operation_id: operationId,
            error: {
              code: "OPERATION_CANCELLATION_UNAVAILABLE",
              message: "Cancellation is temporarily unavailable.",
            },
            retryable: true,
          },
          503,
          origin,
        );
      }
      const { data, error } = await client.rpc("request_captured_document_cancellation", {
        p_operation_id: operationId,
        p_expected_operation_revision: expectedRevision,
        p_cancellation_code: cancellationCode,
      });
      if (error || !data) {
        const rpcFailure = error ? { message: error.message, code: error.code } : null;
        const failure = classifyOwnerCancellationFailure(
          rpcFailure,
          rpcCode(rpcFailure),
          operationId,
        );
        return response(failure.body, failure.status, origin);
      }
      return response(
        {
          ...(data as Record<string, unknown>),
          reconnect: `/api/document-operation?operation_id=${operationId}`,
          retryable: false,
        },
        200,
        origin,
      );
    }

    let executionBody = (auth.body ?? {}) as CapturedOperationBody;
    const environment = deploymentScope();
    if (action === "resume") {
      const operationId = operationUuid(auth.body?.operation_id);
      if (!operationId) {
        return response(
          {
            error: {
              code: "CAPTURED_OPERATION_RESUME_INVALID",
              message: "Resume requires the accepted operation_id.",
            },
            retryable: false,
          },
          400,
          origin,
        );
      }
      const client = userClient(req);
      if (!client) {
        const failure = classifyOwnerOperationLookupFailure(null, operationId);
        return response(failure.body, failure.status, origin);
      }
      const { data, error } = await client.rpc("get_captured_document_operation", {
        p_operation_id: operationId,
      });
      const existing =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null;
      if (error || !existing || existing.operation_id !== operationId) {
        const failure = classifyOwnerOperationLookupFailure(
          error ? { message: error.message, code: error.code } : null,
          operationId,
        );
        return response(failure.body, failure.status, origin);
      }
      const deferredResume = deferredCapacityResumeResult(existing, operationId);
      if (deferredResume) {
        return response(deferredResume.body, deferredResume.status, origin);
      }
      const resumableStatus = [
        "accepted",
        "generating",
        "validating",
        "persisting",
        "awaiting_capacity",
        "retryable_failure",
      ].includes(String(existing.status));
      if (!resumableStatus) {
        return response(
          {
            ...existing,
            reconnect: `/api/document-operation?operation_id=${operationId}`,
            retryable: false,
          },
          existing.status === "ready_for_review" ? 200 : 409,
          origin,
        );
      }
      executionBody = {
        action: "resume",
        operation_id: operationId,
      };
    }

    const gateway = {
      async rpc(name: string, args: Record<string, unknown>) {
        const { data, error } = await auth.admin.rpc(name, args);
        return {
          data,
          error: error ? { message: error.message, code: error.code } : null,
        };
      },
    };
    const accepted = mapCapturedAcceptanceResult(
      await runCapturedDocumentOperation({
        userId: auth.userId,
        body: executionBody,
        environment,
        gateway,
        executionMode: "accept_only",
      }),
    );
    const operationId = operationUuid(accepted.body.operation_id);
    const status = typeof accepted.body.status === "string" ? accepted.body.status : "";
    const deferredResume = operationId
      ? deferredCapacityResumeResult(accepted.body, operationId)
      : null;
    if (deferredResume) {
      return response(deferredResume.body, deferredResume.status, origin);
    }
    const schedulable =
      operationId &&
      [
        "accepted",
        "generating",
        "validating",
        "persisting",
        "awaiting_capacity",
        "retryable_failure",
      ].includes(status);
    if (accepted.status >= 400 || !schedulable || !operationId) {
      return response(accepted.body, accepted.status, origin);
    }

    const backgroundBody: CapturedOperationBody = {
      action: "resume",
      operation_id: operationId,
    };
    const scheduled = scheduleEdgeBackgroundTaskWithModelContext(
      req.signal,
      async (backgroundSignal) => {
        const result = await runCapturedDocumentOperation({
          userId: auth.userId,
          body: backgroundBody,
          environment,
          gateway,
          signal: backgroundSignal,
        });
        recordBackgroundResult(result);
      },
    );
    if (!scheduled) {
      return response(
        {
          ...accepted.body,
          error: {
            code: "CAPTURED_BACKGROUND_RUNTIME_UNAVAILABLE",
            message:
              "The document operation was saved, but background execution could not be scheduled.",
          },
          retryable: true,
        },
        503,
        origin,
      );
    }
    return response({ ...accepted.body, background_execution: "scheduled" }, 202, origin);
  } catch (error) {
    if (error instanceof AuthError) {
      return response(error.payload, error.status, origin);
    }
    return response(
      {
        error: {
          code: "CAPTURED_OPERATION_UNAVAILABLE",
          message: "TED's durable document operation is temporarily unavailable.",
        },
        retryable: true,
      },
      500,
      origin,
    );
  }
});
