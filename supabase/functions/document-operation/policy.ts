export interface DocumentOperationResult {
  status: number;
  body: Record<string, unknown>;
}

export interface RpcFailure {
  message?: string;
  code?: string;
}

const OWNER_SAFE_NOT_FOUND = "CAPTURED_OPERATION_NOT_FOUND";
const CAPACITY_CONFIGURATION_UNAVAILABLE = "CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE";

function hasExactRpcError(error: RpcFailure | null, expected: string): boolean {
  if (error?.code === expected) return true;
  const message = (error?.message ?? "").trim();
  return message === expected || message.startsWith(`${expected}:`);
}

function resultErrorCode(result: DocumentOperationResult): string {
  const error = result.body.error;
  return error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as Record<string, unknown>).code === "string"
    ? String((error as Record<string, unknown>).code)
    : "";
}

export function classifyOwnerOperationLookupFailure(
  error: RpcFailure | null,
  operationId: string,
): DocumentOperationResult {
  if (hasExactRpcError(error, OWNER_SAFE_NOT_FOUND)) {
    return {
      status: 404,
      body: {
        operation_id: operationId,
        error: {
          code: OWNER_SAFE_NOT_FOUND,
          message: "That document operation is unavailable for this account.",
        },
        retryable: false,
      },
    };
  }
  return {
    status: 503,
    body: {
      operation_id: operationId,
      error: {
        code: "CAPTURED_OPERATION_STATUS_UNAVAILABLE",
        message: "TED could not confirm this operation's durable status yet.",
      },
      retryable: true,
    },
  };
}

export function isOwnerSafeOperationNotFound(error: RpcFailure | null): boolean {
  return hasExactRpcError(error, OWNER_SAFE_NOT_FOUND);
}

export function classifyOwnerCancellationFailure(
  error: RpcFailure | null,
  inferredCode: string,
  operationId: string,
): DocumentOperationResult {
  if (isOwnerSafeOperationNotFound(error)) {
    return {
      status: 404,
      body: {
        operation_id: operationId,
        error: {
          code: OWNER_SAFE_NOT_FOUND,
          message: "That document operation is unavailable for this account.",
        },
        retryable: false,
      },
    };
  }

  const invalid = inferredCode.includes("INVALID");
  const conflict = inferredCode.startsWith("STALE_") || inferredCode.includes("NOT_CANCELLABLE");
  if (invalid || conflict) {
    return {
      status: invalid ? 400 : 409,
      body: {
        operation_id: operationId,
        error: {
          code: inferredCode,
          message: invalid
            ? "The cancellation request is invalid."
            : "The operation changed before cancellation could be recorded. Refresh its status and try again.",
        },
        retryable: false,
      },
    };
  }

  return {
    status: 503,
    body: {
      operation_id: operationId,
      error: {
        code: "CAPTURED_OPERATION_CANCELLATION_UNAVAILABLE",
        message: "TED could not record cancellation safely.",
      },
      retryable: true,
    },
  };
}

export function shouldDeferCapacityResume(operation: Record<string, unknown>): boolean {
  return operation.status === "awaiting_capacity" && operation.resume_available !== true;
}

export function deferredCapacityResumeResult(
  operation: Record<string, unknown>,
  operationId: string,
): DocumentOperationResult | null {
  if (!shouldDeferCapacityResume(operation)) return null;
  return {
    status: 202,
    body: {
      ...operation,
      operation_id: operationId,
      reconnect: `/api/document-operation?operation_id=${operationId}`,
      retryable: true,
      background_execution: "deferred",
    },
  };
}

export function mapCapturedAcceptanceResult(
  result: DocumentOperationResult,
): DocumentOperationResult {
  if (result.status < 400 || resultErrorCode(result) !== CAPACITY_CONFIGURATION_UNAVAILABLE) {
    return result;
  }
  return {
    status: 503,
    body: {
      error: {
        code: "CAPTURED_ACTIVATION_NOT_READY",
        message: "Captured document generation is not ready in this environment.",
      },
      retryable: false,
    },
  };
}
