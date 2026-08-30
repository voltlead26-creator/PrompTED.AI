import { createClient } from "jsr:@supabase/supabase-js@2";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import {
  corsHeaders,
  handleOptions,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";
import {
  type CapturedOperationBody,
  runCapturedDocumentOperation,
} from "../_shared/captured-operation-runner.ts";

function response(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json",
      "Pragma": "no-cache",
      "Vary": "Authorization, Origin",
    },
  });
}

function deploymentScope(): { environment: string; userCohort: string } {
  return {
    environment:
      Deno.env.get("PROMPTED_DEPLOYMENT_ENV")?.trim().toLowerCase() || "local",
    userCohort:
      Deno.env.get("PROMPTED_CAPTURED_COHORT")?.trim().toLowerCase() ||
      "disabled",
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

async function previewAction(req: Request): Promise<string> {
  if (
    req.method !== "POST" ||
    !(req.headers.get("content-type") ?? "").toLowerCase().includes(
      "application/json",
    )
  ) {
    return "";
  }
  try {
    const value = await req.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? actionName((value as Record<string, unknown>).action)
      : "";
  } catch {
    // The authenticated input guard returns the stable malformed-body error.
    return "";
  }
}

function operationUuid(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
    ? candidate
    : null;
}

function positiveRevision(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

function rpcCode(error: { message?: string; code?: string } | null): string {
  const match = (error?.message ?? "").match(/\b([A-Z][A-Z0-9_]{3,})\b/);
  return match?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "CAPTURED_OPERATION_RPC_FAILED");
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
    const actionPreview = await previewAction(req);
    const auth = await guardRequest(req, {
      // Only acceptance of a genuinely new operation is allowance-gated.
      // Resume and cancellation operate on an already accepted owner record.
      enforceCap: req.method === "POST" &&
        actionPreview !== "resume" && actionPreview !== "cancel",
    });

    if (req.method === "GET") {
      const operationId = new URL(req.url).searchParams.get("operation_id") ??
        "";
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(
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
        return response(
          {
            error: {
              code: "OPERATION_STATUS_UNAVAILABLE",
              message: "Operation status is temporarily unavailable.",
            },
            retryable: true,
          },
          503,
          origin,
        );
      }
      const { data, error } = await client.rpc(
        "get_captured_document_operation",
        { p_operation_id: operationId },
      );
      if (error || !data) {
        return response(
          {
            error: {
              code: "CAPTURED_OPERATION_NOT_FOUND",
              message:
                "That document operation is unavailable for this account.",
            },
            retryable: false,
          },
          404,
          origin,
        );
      }
      return response(
        {
          ...(data as Record<string, unknown>),
          reconnect: `/api/document-operation?operation_id=${operationId}`,
        },
        200,
        origin,
      );
    }

    const action = actionName(auth.body?.action) || "start";
    if (
      !(["start", "resume", "cancel"] as const).includes(
        action as DocumentOperationAction,
      )
    ) {
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
      const expectedRevision = positiveRevision(
        auth.body?.expected_operation_revision,
      );
      const cancellationCode = typeof auth.body?.cancellation_code === "string"
        ? auth.body.cancellation_code.trim()
        : "";
      if (
        !operationId || !expectedRevision || !cancellationCode ||
        cancellationCode.length > 120
      ) {
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
      const { data, error } = await client.rpc(
        "request_captured_document_cancellation",
        {
          p_operation_id: operationId,
          p_expected_operation_revision: expectedRevision,
          p_cancellation_code: cancellationCode,
        },
      );
      if (error || !data) {
        const code = rpcCode(
          error ? { message: error.message, code: error.code } : null,
        );
        const status = code === "CAPTURED_OPERATION_NOT_FOUND"
          ? 404
          : code.includes("INVALID")
          ? 400
          : code.startsWith("STALE_") || code.includes("NOT_CANCELLABLE")
          ? 409
          : 500;
        return response(
          {
            error: {
              code,
              message: status === 404
                ? "That document operation is unavailable for this account."
                : status === 409
                ? "The operation changed before cancellation could be recorded. Refresh its status and try again."
                : "TED could not record cancellation safely.",
            },
            retryable: status >= 500,
          },
          status,
          origin,
        );
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

    if (action === "resume") {
      const operationId = operationUuid(auth.body?.operation_id);
      const documentId = operationUuid(auth.body?.document_id);
      const client = userClient(req);
      if (!operationId || !documentId || !client) {
        return response(
          {
            error: {
              code: "CAPTURED_OPERATION_RESUME_INVALID",
              message:
                "Resume requires the accepted operation_id and original document request.",
            },
            retryable: false,
          },
          400,
          origin,
        );
      }
      const { data, error } = await client.rpc(
        "get_captured_document_operation",
        { p_operation_id: operationId },
      );
      const existing = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        error || !existing || existing.operation_id !== operationId ||
        existing.document_id !== documentId
      ) {
        return response(
          {
            error: {
              code: "CAPTURED_OPERATION_NOT_FOUND",
              message:
                "That document operation is unavailable for this account.",
            },
            retryable: false,
          },
          404,
          origin,
        );
      }
      const resumableStatus = [
        "accepted",
        "generating",
        "validating",
        "persisting",
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
    }

    const result = await runCapturedDocumentOperation({
      userId: auth.userId,
      body: (auth.body ?? {}) as CapturedOperationBody,
      environment: deploymentScope(),
      gateway: {
        async rpc(name, args) {
          const { data, error } = await auth.admin.rpc(name, args);
          return {
            data,
            error: error ? { message: error.message, code: error.code } : null,
          };
        },
      },
      signal: req.signal,
    });
    return response(result.body, result.status, origin);
  } catch (error) {
    if (error instanceof AuthError) {
      return response(error.payload, error.status, origin);
    }
    return response(
      {
        error: {
          code: "CAPTURED_OPERATION_UNAVAILABLE",
          message:
            "TED's durable document operation is temporarily unavailable.",
        },
        retryable: true,
      },
      500,
      origin,
    );
  }
});
