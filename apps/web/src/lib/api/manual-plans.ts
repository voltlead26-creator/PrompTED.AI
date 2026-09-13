import {
  isManualPlanId,
  parseManualPlanList,
  parseManualPlanRead,
  parseManualPlanSaveCommand,
  parseManualPlanSaveReceipt,
  type ManualPlanList,
  type ManualPlanSaveCommand,
  type ManualPlanSaveReceipt,
  type ManualPlanSnapshot,
} from "@prompted/shared";
import { OwnerDispatchError, type OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && UUID.test(value);
const KNOWN_DATABASE_ERRORS = [
  "MANUAL_PLAN_INPUT_INVALID", "MANUAL_PLAN_AUTHENTICATION_REQUIRED", "MANUAL_PLAN_NOT_FOUND",
  "MANUAL_PLAN_OPERATION_CONFLICT", "MANUAL_PLAN_VERSION_CONFLICT", "MANUAL_PLAN_SOURCE_CONFLICT",
  "MANUAL_PLAN_ITEM_REMOVAL_BLOCKED", "MANUAL_PLAN_COMMAND_REQUIRED", "MANUAL_PLAN_HISTORY_IMMUTABLE",
] as const;
type DatabaseErrorCode = typeof KNOWN_DATABASE_ERRORS[number];
type ManualPlanApiErrorCode = DatabaseErrorCode | "MANUAL_PLAN_SAVE_UNCONFIRMED" |
  "MANUAL_PLAN_READ_FAILED" | "MANUAL_PLAN_READ_INVALID" | "MANUAL_PLAN_LIST_FAILED" |
  "MANUAL_PLAN_LIST_INVALID" | "MANUAL_PLAN_REQUEST_CANCELLED";

/** Only fixed public codes leave this API; callers never display server diagnostics. */
export class ManualPlanApiError extends Error {
  constructor(public readonly code: ManualPlanApiErrorCode) {
    super(code);
    this.name = "ManualPlanApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOwner(lease: OwnerDispatchLease): void {
  lease.assertCurrent();
  lease.signal.throwIfAborted();
  if (!isUuid(lease.expectedUserId)) throw new ManualPlanApiError("MANUAL_PLAN_AUTHENTICATION_REQUIRED");
}

function safeError(error: unknown, lease: OwnerDispatchLease, fallback: ManualPlanApiErrorCode, dispatched: boolean): Error {
  if (lease.signal.aborted) {
    // The principal primitive may substitute OwnerDispatchError when a caller's
    // DOMException comes from another realm. The signal retains the real reason:
    // principal retirement uses our OwnerDispatchError; other aborts remain
    // cancellation/uncertainty. Every path still rejects the original lease.
    if (lease.signal.reason instanceof OwnerDispatchError) return lease.signal.reason;
    return new ManualPlanApiError(dispatched ? fallback : "MANUAL_PLAN_REQUEST_CANCELLED");
  }
  if (error instanceof OwnerDispatchError || error instanceof ManualPlanApiError) return error;
  return new ManualPlanApiError(fallback);
}

function rpcData(value: unknown, fallback: ManualPlanApiErrorCode): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, "data") || !Object.hasOwn(value, "error")) {
    throw new ManualPlanApiError(fallback);
  }
  if (value.error !== null) {
    const error = value.error;
    const code = isRecord(error) ? KNOWN_DATABASE_ERRORS.find(known => error.message === known || error.code === known) : undefined;
    throw new ManualPlanApiError(code ?? fallback);
  }
  return value.data;
}

/** Abort promptly even if a stalled SDK/auth promise ignores the caller's signal. */
function callRpc(
  name: "save_own_manual_plan_v1" | "get_own_manual_plan_v1" | "list_own_manual_plans_v1",
  args: Record<string, unknown>,
  lease: OwnerDispatchLease,
  onDispatch: () => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = () => lease.signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      try { assertOwner(lease); }
      catch (error) { reject(error); return; }
      reject(new ManualPlanApiError("MANUAL_PLAN_REQUEST_CANCELLED"));
    };
    lease.signal.addEventListener("abort", onAbort, { once: true });
    if (lease.signal.aborted) { onAbort(); return; }
    void withOwnerSupabase(lease, async supabase => {
      assertOwner(lease);
      onDispatch();
      return await supabase.rpc(name, args).abortSignal(lease.signal);
    }).then(
      result => { cleanup(); resolve(result); },
      error => { cleanup(); reject(error); },
    );
  });
}

/** One dispatch only. An uncertain result must be retried with the same command. */
export async function saveManualPlanCommand(
  command: ManualPlanSaveCommand,
  lease: OwnerDispatchLease,
): Promise<ManualPlanSaveReceipt> {
  let dispatched = false;
  try {
    assertOwner(lease);
    const parsed = parseManualPlanSaveCommand(command);
    if (!parsed) throw new ManualPlanApiError("MANUAL_PLAN_INPUT_INVALID");
    // Capture before credentials or network awaits. Later typing cannot change
    // either the sent command or the identity/content used to validate its receipt.
    const expected: ManualPlanSaveCommand = { ...parsed,
      expected: parsed.expected ? { ...parsed.expected } : null,
      items: parsed.items.map(item => ({ ...item })),
    };
    const response = await callRpc("save_own_manual_plan_v1", { p_command: expected }, lease,
      () => { dispatched = true; });
    assertOwner(lease);
    const value = rpcData(response, "MANUAL_PLAN_SAVE_UNCONFIRMED");
    const receipt = parseManualPlanSaveReceipt(value, lease.expectedUserId, expected);
    if (!receipt) throw new ManualPlanApiError("MANUAL_PLAN_SAVE_UNCONFIRMED");
    return receipt;
  } catch (error) {
    throw safeError(error, lease, "MANUAL_PLAN_SAVE_UNCONFIRMED", dispatched);
  }
}

export async function readManualPlan(
  lookup: { planId?: string; outcomeId?: string },
  lease: OwnerDispatchLease,
): Promise<ManualPlanSnapshot | null> {
  let dispatched = false;
  try {
    assertOwner(lease);
    if (!isRecord(lookup) || Object.keys(lookup).some(key => key !== "planId" && key !== "outcomeId") ||
      Number(lookup.planId !== undefined) + Number(lookup.outcomeId !== undefined) !== 1 ||
      (lookup.planId !== undefined && !isManualPlanId(lookup.planId)) ||
      (lookup.outcomeId !== undefined && !isUuid(lookup.outcomeId))) {
      throw new ManualPlanApiError("MANUAL_PLAN_INPUT_INVALID");
    }
    const planId = lookup.planId ?? null;
    const outcomeId = lookup.outcomeId ?? null;
    const response = await callRpc("get_own_manual_plan_v1", { p_plan_id: planId, p_outcome_id: outcomeId },
      lease, () => { dispatched = true; });
    assertOwner(lease);
    const read = parseManualPlanRead(rpcData(response, "MANUAL_PLAN_READ_FAILED"), lease.expectedUserId);
    if (!read || (read.plan !== null && (
      (planId !== null && read.plan.plan_id !== planId) ||
      (outcomeId !== null && read.plan.outcome_id !== outcomeId)
    ))) throw new ManualPlanApiError("MANUAL_PLAN_READ_INVALID");
    return read.plan;
  } catch (error) {
    throw safeError(error, lease, "MANUAL_PLAN_READ_FAILED", dispatched);
  }
}

export async function listRemoteManualPlans(
  options: { limit?: number; offset?: number },
  lease: OwnerDispatchLease,
): Promise<ManualPlanList> {
  let dispatched = false;
  try {
    assertOwner(lease);
    if (!isRecord(options) || Object.keys(options).some(key => key !== "limit" && key !== "offset")) {
      throw new ManualPlanApiError("MANUAL_PLAN_INPUT_INVALID");
    }
    const limit = options.limit === undefined ? 20 : options.limit;
    const offset = options.offset === undefined ? 0 : options.offset;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_647) {
      throw new ManualPlanApiError("MANUAL_PLAN_INPUT_INVALID");
    }
    const response = await callRpc("list_own_manual_plans_v1", { p_limit: limit, p_offset: offset },
      lease, () => { dispatched = true; });
    assertOwner(lease);
    const list = parseManualPlanList(rpcData(response, "MANUAL_PLAN_LIST_FAILED"), lease.expectedUserId);
    if (!list || list.items.length > limit || (list.has_more && list.items.length !== limit)) {
      throw new ManualPlanApiError("MANUAL_PLAN_LIST_INVALID");
    }
    return list;
  } catch (error) {
    throw safeError(error, lease, "MANUAL_PLAN_LIST_FAILED", dispatched);
  }
}
