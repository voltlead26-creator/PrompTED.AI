import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type LegacyModelCheckpoint,
  readLegacyModelCheckpoint,
  type TerminalModelAttemptRecord,
  trackTerminalModelAttempt,
} from "./cost-tracker.ts";

export interface ModelCallContext {
  userId: string;
  admin: SupabaseClient;
  generationRequestId?: string;
  checkpoint?: {
    scope: string;
    originReservationId?: string;
    executionClaimToken?: string;
  };
}

export class ModelCallContextError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ModelCallContextError";
  }
}

export interface PreparedLegacyModelAttempt {
  clientRequestId: string;
  attemptNumber: number;
  durableAdmissionId?: string;
  checkpoint?: LegacyModelCheckpoint;
}

export interface ProviderDispatchClaim {
  identity: string;
  resourceSha256: string;
  token: string;
}

export interface OpenAICapacityClaim {
  leaseId: string;
  leaseToken: string;
  environment: string;
  semanticRoute: "fast" | "deep" | "research" | "review";
  estimatedTokens: number;
  configRevision: number;
  expiresAt: string;
}

export class ModelCapacityError extends ModelCallContextError {
  constructor(
    code: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = "ModelCapacityError";
  }
}

const STAGE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const contexts = new WeakMap<AbortSignal, ModelCallContext>();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requiredContext(signal: AbortSignal | undefined): ModelCallContext {
  const context = signal ? contexts.get(signal) : undefined;
  if (!context) throw new ModelCallContextError("MODEL_CALL_CONTEXT_MISSING");
  return context;
}

export function bindModelCallContext(
  signal: AbortSignal,
  context: ModelCallContext,
): void {
  contexts.set(signal, { ...context });
}

export function inheritModelCallContext(
  parent: AbortSignal,
  child: AbortSignal,
): void {
  const context = contexts.get(parent);
  if (context) contexts.set(child, context);
}

export function setModelCallRequestIdentity(
  signal: AbortSignal,
  generationRequestId: string,
): void {
  const context = contexts.get(signal);
  if (!context) throw new ModelCallContextError("MODEL_CALL_CONTEXT_MISSING");
  contexts.set(signal, { ...context, generationRequestId });
}

export function setModelCallCheckpointContext(
  signal: AbortSignal,
  checkpoint: {
    scope: "generate-document" | "generate-checklist";
    originReservationId: string;
    executionClaimToken: string;
  },
): void {
  const context = contexts.get(signal);
  if (!context || !context.generationRequestId) {
    throw new ModelCallContextError("MODEL_CALL_CONTEXT_MISSING");
  }
  contexts.set(signal, { ...context, checkpoint: { ...checkpoint } });
}

export async function prepareLegacyModelAttempt(
  signal: AbortSignal | undefined,
  input: {
    logicalStageKey: string | undefined;
    requestSha256: string;
    attemptNumber: number;
    maxAttempts?: number;
  },
): Promise<PreparedLegacyModelAttempt> {
  const context = requiredContext(signal);
  if (!input.logicalStageKey || !STAGE_PATTERN.test(input.logicalStageKey)) {
    throw new ModelCallContextError("MODEL_CALL_STAGE_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(input.requestSha256)) {
    throw new ModelCallContextError("MODEL_CALL_REQUEST_HASH_INVALID");
  }
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new ModelCallContextError("MODEL_CALL_ATTEMPT_INVALID");
  }
  let attemptNumber = input.attemptNumber;
  let checkpoint: LegacyModelCheckpoint | undefined;
  if (context.checkpoint) {
    if (!context.generationRequestId) {
      throw new ModelCallContextError("MODEL_CALL_REQUEST_IDENTITY_MISSING");
    }
    checkpoint = await readLegacyModelCheckpoint(context.admin, {
      userId: context.userId,
      checkpointScope: context.checkpoint.scope,
      originReservationId: context.checkpoint.originReservationId,
      executionClaimToken: context.checkpoint.executionClaimToken,
      logicalRequestId: context.generationRequestId,
      logicalStageKey: input.logicalStageKey,
      requestSha256: input.requestSha256,
      maxAttempts: input.maxAttempts ?? 2,
      allocateAttempt: true,
    });
    if (checkpoint.state === "prepared") {
      attemptNumber = Number(checkpoint.attempt_number);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(String(checkpoint.attempt_admission_id ?? ""))
      ) {
        throw new ModelCallContextError("MODEL_CALL_ADMISSION_INVALID");
      }
      const executionClaimToken = String(
        checkpoint.execution_claim_token ?? "",
      );
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(executionClaimToken)
      ) {
        throw new ModelCallContextError("MODEL_CALL_CLAIM_INVALID");
      }
      contexts.set(signal!, {
        ...context,
        checkpoint: {
          ...context.checkpoint,
          executionClaimToken,
        },
      });
    } else {
      return {
        clientRequestId: "",
        attemptNumber: Number(checkpoint.attempt_number ?? 0),
        checkpoint,
      };
    }
  }
  const identity = await sha256(JSON.stringify({
    user_id: context.userId,
    logical_request_id: context.generationRequestId ?? null,
    logical_stage_key: input.logicalStageKey,
    request_sha256: input.requestSha256,
    attempt_number: attemptNumber,
    checkpoint_scope: context.checkpoint?.scope ?? null,
    origin_reservation_id: context.checkpoint?.originReservationId ?? null,
    execution_claim_token: checkpoint?.execution_claim_token ??
      context.checkpoint?.executionClaimToken ?? null,
  }));
  return {
    clientRequestId: `prompted-${identity}`,
    attemptNumber,
    durableAdmissionId: checkpoint?.attempt_admission_id,
    checkpoint,
  };
}

/**
 * Resolve a durable legacy checkpoint before reserving provider capacity.
 * This read never allocates an attempt: an exact completed replay or blocked
 * reconciliation state must not consume a fresh RPM/TPM reservation.
 */
export async function inspectLegacyModelCheckpointBeforeCapacity(
  signal: AbortSignal | undefined,
  input: {
    logicalStageKey: string | undefined;
    requestSha256: string;
    maxAttempts?: number;
  },
): Promise<LegacyModelCheckpoint | undefined> {
  const context = requiredContext(signal);
  if (!context.checkpoint) return undefined;
  if (!context.generationRequestId) {
    throw new ModelCallContextError("MODEL_CALL_REQUEST_IDENTITY_MISSING");
  }
  if (!input.logicalStageKey || !STAGE_PATTERN.test(input.logicalStageKey)) {
    throw new ModelCallContextError("MODEL_CALL_STAGE_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(input.requestSha256)) {
    throw new ModelCallContextError("MODEL_CALL_REQUEST_HASH_INVALID");
  }
  return await readLegacyModelCheckpoint(context.admin, {
    userId: context.userId,
    checkpointScope: context.checkpoint.scope,
    originReservationId: context.checkpoint.originReservationId,
    executionClaimToken: context.checkpoint.executionClaimToken,
    logicalRequestId: context.generationRequestId,
    logicalStageKey: input.logicalStageKey,
    requestSha256: input.requestSha256,
    maxAttempts: input.maxAttempts ?? 2,
    allocateAttempt: false,
  });
}

export async function markLegacyModelAttemptDispatched(
  signal: AbortSignal | undefined,
  input: {
    logicalStageKey: string;
    requestSha256: string;
    attemptNumber: number;
    durableAdmissionId: string;
  },
): Promise<void> {
  const context = requiredContext(signal);
  if (!context.checkpoint || !context.generationRequestId) {
    throw new ModelCallContextError("MODEL_CALL_CHECKPOINT_CONTEXT_MISSING");
  }
  if (!context.checkpoint.executionClaimToken) {
    throw new ModelCallContextError("MODEL_CALL_CLAIM_INVALID");
  }
  const dispatchToken = crypto.randomUUID();
  const args = {
    p_user_id: context.userId,
    p_checkpoint_scope: context.checkpoint.scope,
    p_origin_reservation_id: context.checkpoint.originReservationId,
    p_logical_request_id: context.generationRequestId,
    p_logical_stage_key: input.logicalStageKey,
    p_request_sha256: input.requestSha256,
    p_attempt_number: input.attemptNumber,
    p_attempt_admission_id: input.durableAdmissionId,
    p_execution_claim_token: context.checkpoint.executionClaimToken,
    p_dispatch_token: dispatchToken,
  };
  for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
    try {
      const { data, error } = await context.admin.rpc(
        "mark_legacy_model_attempt_dispatched",
        args,
      );
      const receipt = data as Record<string, unknown> | null;
      if (
        !error && receipt?.state === "dispatched" &&
        receipt.attempt_admission_id === input.durableAdmissionId &&
        receipt.provider_attempt_id === input.durableAdmissionId
      ) return;
    } catch {
      // An acknowledgement may be lost after commit. The exact dispatch token
      // makes one bounded retry idempotent without permitting a second caller.
    }
  }
  throw new ModelCallContextError("MODEL_CALL_DISPATCH_ACK_UNRESOLVED");
}

/**
 * Acquire shared OpenAI capacity before a provider attempt is prepared. The
 * database serializes route admission across Edge instances; an absent route
 * configuration is an intentional fail-closed activation state.
 */
export async function claimOpenAICapacity(
  signal: AbortSignal | undefined,
  input: {
    semanticRoute: "fast" | "deep" | "research" | "review";
    estimatedTokens: number;
    resourceIdentity: string;
  },
): Promise<OpenAICapacityClaim> {
  const context = requiredContext(signal);
  const environment = Deno.env.get("PROMPTED_DEPLOYMENT_ENV")?.trim()
    .toLowerCase() ?? "";
  if (
    !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(environment) ||
    !["fast", "deep", "research", "review"].includes(input.semanticRoute) ||
    !Number.isInteger(input.estimatedTokens) ||
    input.estimatedTokens < 1 ||
    input.estimatedTokens > 2_000_000 ||
    !input.resourceIdentity.trim() ||
    new TextEncoder().encode(input.resourceIdentity).byteLength > 512
  ) {
    throw new ModelCallContextError("MODEL_CALL_CAPACITY_INPUT_INVALID");
  }
  const leaseToken = crypto.randomUUID();
  const resourceSha256 = await sha256(input.resourceIdentity);
  const args = {
    p_user_id: context.userId,
    p_environment: environment,
    p_semantic_route: input.semanticRoute,
    p_resource_sha256: resourceSha256,
    p_estimated_tokens: input.estimatedTokens,
    p_lease_token: leaseToken,
  };
  for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
    try {
      const { data, error } = await context.admin.rpc(
        "claim_openai_capacity_lease",
        args,
      );
      const receipt = data as Record<string, unknown> | null;
      const retryAfterSeconds = Number(receipt?.retry_after_seconds);
      if (
        !error && receipt?.capacity_admitted === false &&
        receipt.outcome === "awaiting_capacity" &&
        Number.isInteger(retryAfterSeconds) &&
        retryAfterSeconds >= 1 && retryAfterSeconds <= 1800
      ) {
        throw new ModelCapacityError(
          "MODEL_CALL_AWAITING_CAPACITY",
          retryAfterSeconds,
        );
      }
      if (!error && receipt?.capacity_admitted === false) {
        const outcome = String(receipt.outcome ?? "");
        if (outcome === "configuration_unavailable") {
          throw new ModelCallContextError(
            "MODEL_CALL_CAPACITY_CONFIGURATION_UNAVAILABLE",
          );
        }
        if (outcome === "route_disabled") {
          throw new ModelCallContextError("MODEL_CALL_CAPACITY_ROUTE_DISABLED");
        }
        if (outcome === "capacity_request_too_large") {
          throw new ModelCallContextError(
            "MODEL_CALL_CAPACITY_REQUEST_TOO_LARGE",
          );
        }
        if (outcome === "reconciliation_required") {
          throw new ModelCallContextError(
            "MODEL_CALL_CAPACITY_RECONCILIATION_REQUIRED",
          );
        }
      }
      const leaseId = String(receipt?.capacity_lease_id ?? "");
      const returnedToken = String(receipt?.lease_token ?? "");
      const configRevision = Number(receipt?.config_revision);
      const expiresAt = String(receipt?.expires_at ?? "");
      if (
        !error && receipt?.capacity_admitted === true &&
        ["admitted", "idempotent_replay"].includes(
          String(receipt.outcome ?? ""),
        ) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(leaseId) &&
        returnedToken === leaseToken &&
        receipt.environment === environment &&
        receipt.semantic_route === input.semanticRoute &&
        receipt.estimated_tokens === input.estimatedTokens &&
        Number.isInteger(configRevision) && configRevision > 0 &&
        Number.isFinite(Date.parse(expiresAt))
      ) {
        return {
          leaseId,
          leaseToken,
          environment,
          semanticRoute: input.semanticRoute,
          estimatedTokens: input.estimatedTokens,
          configRevision,
          expiresAt,
        };
      }
    } catch (error) {
      if (
        error instanceof ModelCapacityError ||
        error instanceof ModelCallContextError
      ) throw error;
      // The exact lease token makes one acknowledgement retry idempotent.
    }
  }
  throw new ModelCallContextError(
    "MODEL_CALL_CAPACITY_ADMISSION_ACK_UNRESOLVED",
  );
}

export async function markOpenAICapacityDispatched(
  signal: AbortSignal | undefined,
  claim: OpenAICapacityClaim,
): Promise<void> {
  const context = requiredContext(signal);
  const args = {
    p_user_id: context.userId,
    p_capacity_lease_id: claim.leaseId,
    p_lease_token: claim.leaseToken,
  };
  for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
    try {
      const { data, error } = await context.admin.rpc(
        "mark_openai_capacity_lease_dispatched",
        args,
      );
      const receipt = data as Record<string, unknown> | null;
      if (
        !error &&
        ["dispatched", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        ) &&
        receipt?.capacity_lease_id === claim.leaseId &&
        Number.isFinite(Date.parse(String(receipt.dispatched_at ?? "")))
      ) return;
    } catch {
      // The exact lease token makes the dispatch-boundary retry idempotent.
    }
  }
  throw new ModelCallContextError(
    "MODEL_CALL_CAPACITY_DISPATCH_ACK_UNRESOLVED",
  );
}

export async function releaseOpenAICapacity(
  signal: AbortSignal | undefined,
  claim: OpenAICapacityClaim,
  terminalOutcome: "completed" | "reconciliation_required" | "cancelled",
): Promise<void> {
  const context = requiredContext(signal);
  const args = {
    p_user_id: context.userId,
    p_capacity_lease_id: claim.leaseId,
    p_lease_token: claim.leaseToken,
    p_terminal_outcome: terminalOutcome,
  };
  for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
    try {
      const { data, error } = await context.admin.rpc(
        "release_openai_capacity_lease",
        args,
      );
      const receipt = data as Record<string, unknown> | null;
      if (
        !error &&
        ["released", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        ) &&
        receipt?.capacity_lease_id === claim.leaseId &&
        receipt?.terminal_outcome === terminalOutcome
      ) return;
    } catch {
      // Retry only the same immutable release receipt.
    }
  }
  throw new ModelCallContextError(
    "MODEL_CALL_CAPACITY_RELEASE_ACK_UNRESOLVED",
  );
}

/**
 * Serialize the last pre-fetch boundary with account deletion. This applies to
 * captured and legacy lifecycles alike; model accounting remains authoritative
 * for usage while this receipt only prevents post-fence provider side effects.
 */
export async function claimUserProviderDispatch(
  signal: AbortSignal | undefined,
  providerAttemptIdentity: string,
): Promise<ProviderDispatchClaim> {
  const context = requiredContext(signal);
  if (
    !providerAttemptIdentity.trim() ||
    new TextEncoder().encode(providerAttemptIdentity).byteLength > 512
  ) {
    throw new ModelCallContextError("MODEL_CALL_PROVIDER_IDENTITY_INVALID");
  }
  const token = crypto.randomUUID();
  const resourceSha256 = await sha256(providerAttemptIdentity);
  const args = {
    p_user_id: context.userId,
    p_egress_kind: "openai",
    p_egress_route: "responses",
    p_resource_sha256: resourceSha256,
    p_dispatch_token: token,
  };
  for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
    try {
      const { data, error } = await context.admin.rpc(
        "claim_user_external_egress",
        args,
      );
      const receipt = data as Record<string, unknown> | null;
      if (
        !error && receipt?.egress_permitted === true &&
        receipt.dispatch_token === token &&
        ["accepted", "idempotent_replay"].includes(
          String(receipt.outcome ?? ""),
        )
      ) return { identity: providerAttemptIdentity, resourceSha256, token };
      const detail = String(error?.message ?? "");
      if (detail.includes("ACCOUNT_DELETION_FENCED")) {
        throw new ModelCallContextError("MODEL_CALL_ACCOUNT_DELETION_FENCED");
      }
      if (
        detail.includes("STALE_WORKER") ||
        receipt?.egress_permitted === false
      ) {
        throw new ModelCallContextError(
          "MODEL_CALL_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED",
        );
      }
    } catch (error) {
      if (error instanceof ModelCallContextError) throw error;
      // The exact token makes one acknowledgement retry idempotent.
    }
  }
  throw new ModelCallContextError(
    "MODEL_CALL_PROVIDER_DISPATCH_ACK_UNRESOLVED",
  );
}

export async function completeUserProviderDispatch(
  signal: AbortSignal | undefined,
  claim: ProviderDispatchClaim,
  terminalState: "completed" | "reconciliation_required",
): Promise<void> {
  const context = requiredContext(signal);
  const args = {
    p_user_id: context.userId,
    p_egress_kind: "openai",
    p_egress_route: "responses",
    p_resource_sha256: claim.resourceSha256,
    p_dispatch_token: claim.token,
    p_terminal_state: terminalState,
  };
  for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
    try {
      const { data, error } = await context.admin.rpc(
        "complete_user_external_egress",
        args,
      );
      const receipt = data as Record<string, unknown> | null;
      if (
        !error && ["completed", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        )
      ) return;
    } catch {
      // Retry only the exact immutable terminal receipt.
    }
  }
  throw new ModelCallContextError(
    "MODEL_CALL_PROVIDER_DISPATCH_COMPLETION_ACK_UNRESOLVED",
  );
}

export async function recordLegacyModelAttempt(
  signal: AbortSignal | undefined,
  record: Omit<TerminalModelAttemptRecord, "userId" | "logicalRequestId">,
): Promise<void> {
  const context = requiredContext(signal);
  await trackTerminalModelAttempt(context.admin, {
    ...record,
    resultEnvelope: context.checkpoint ? record.resultEnvelope : undefined,
    userId: context.userId,
    logicalRequestId: context.generationRequestId,
    checkpointScope: context.checkpoint?.scope,
    originReservationId: context.checkpoint?.originReservationId,
    executionClaimToken: context.checkpoint?.executionClaimToken,
  });
}
