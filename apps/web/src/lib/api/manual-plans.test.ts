import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ManualPlanList,
  ManualPlanSaveCommand,
  ManualPlanSaveReceipt,
  ManualPlanSnapshot,
} from "@prompted/shared";
import {
  captureOwnerDispatch,
  OwnerDispatchError,
  recordBrowserPrincipal,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/owner-client", () => ({ withOwnerSupabase: withOwnerSupabaseMock }));

import { listRemoteManualPlans, readManualPlan, saveManualPlanCommand } from "./manual-plans";

const OWNER = "71000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "71000000-0000-4000-8000-000000000002";
const OUTCOME = "72000000-0000-4000-8000-000000000001";
const ARTIFACT = "73000000-0000-4000-8000-000000000001";
const OPERATION = "74000000-0000-4000-8000-000000000001";
const CREATED = "2026-09-13T01:02:03.123456Z";
const UPDATED = "2026-09-13T01:02:04.654321Z";
const LATER = "2026-09-13T01:02:05.654322Z";

function command(): ManualPlanSaveCommand {
  return {
    contract_version: "manual-plan-save.1", operation_id: OPERATION, plan_id: "manual-legacy:123",
    expected: null, title: "  Delivery plan 日本語  ",
    items: [
      { id: "item-legacy:1", section: " Before delivery ", text: "  Call Renée\nKeep the date.  ",
        notes: " Notes\n日本語 ", due_date: "2026-09-15", done: true },
      { id: "item-legacy:2", section: "", text: "", notes: "", due_date: null, done: false },
    ],
  };
}

function snapshot(input = command()): ManualPlanSnapshot {
  return {
    contract_version: "manual-plan.1", owner_id: OWNER, plan_id: input.plan_id,
    outcome_id: OUTCOME, artifact_id: ARTIFACT, revision: (input.expected?.revision ?? 0) + 1,
    created_at: CREATED, updated_at: UPDATED, title: input.title,
    items: input.items.map(item => ({ ...item })),
  };
}

function receipt(input = command()): ManualPlanSaveReceipt {
  const plan = snapshot(input);
  return {
    contract_version: "manual-plan-save.1", owner_id: OWNER, operation_id: input.operation_id,
    request_sha256: "a".repeat(64), status: "saved",
    committed: { outcome_id: plan.outcome_id, artifact_id: plan.artifact_id,
      revision: plan.revision, updated_at: plan.updated_at },
    snapshot: plan,
  };
}

function list(): ManualPlanList {
  const plan = snapshot();
  return { contract_version: "manual-plan-list.1", owner_id: OWNER, has_more: false,
    items: [{ owner_id: OWNER, plan_id: plan.plan_id, outcome_id: OUTCOME, artifact_id: ARTIFACT,
      title: plan.title, revision: 1, updated_at: UPDATED, item_count: 2, completed_count: 1,
      next_due_date: null }] };
}

type RpcResponse = { data: unknown; error: unknown };
type RpcHandler = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<RpcResponse>;

function installRpc(handler: RpcHandler = async () => ({ data: receipt(), error: null })) {
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({
    abortSignal: (signal: AbortSignal) => { signals.push(signal); return handler(name, args, signal); },
  }));
  withOwnerSupabaseMock.mockImplementation(async (
    lease: OwnerDispatchLease, operation: (client: { rpc: typeof rpc }) => Promise<unknown>,
  ) => {
    lease.assertCurrent();
    const value = await operation({ rpc });
    lease.assertCurrent();
    return value;
  });
  return { rpc, signals };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  withOwnerSupabaseMock.mockReset();
  recordBrowserPrincipal(undefined);
  recordBrowserPrincipal(OWNER);
});
afterEach(() => { recordBrowserPrincipal(undefined); vi.useRealTimers(); });

describe("manual plan save commands", () => {
  it("dispatches the exact command once with its original owner lease and caller signal", async () => {
    const input = command();
    const lease = captureOwnerDispatch(OWNER, new AbortController().signal);
    const { rpc, signals } = installRpc();
    await expect(saveManualPlanCommand(input, lease)).resolves.toEqual(receipt());
    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_own_manual_plan_v1", { p_command: input });
    expect(signals).toEqual([lease.signal]);
    expect(input).toEqual(command());
  });

  it("preserves microsecond CAS tokens and validates the next committed revision", async () => {
    const input = { ...command(), expected: { outcome_id: OUTCOME, artifact_id: ARTIFACT,
      revision: 4, updated_at: CREATED } };
    const { rpc } = installRpc(async () => ({ data: receipt(input), error: null }));
    await expect(saveManualPlanCommand(input, captureOwnerDispatch(OWNER))).resolves.toMatchObject({
      committed: { revision: 5, updated_at: UPDATED },
    });
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_command: input });
  });

  it("retries an uncertain save only when called again with the unchanged command", async () => {
    const input = command();
    const replay = { ...receipt(input), status: "replayed" };
    let attempts = 0;
    const { rpc } = installRpc(async () => {
      if (++attempts === 1) throw new TypeError("Private transport diagnostics");
      return { data: replay, error: null };
    });
    const lease = captureOwnerDispatch(OWNER);
    await expect(saveManualPlanCommand(input, lease)).rejects.toMatchObject({ code: "MANUAL_PLAN_SAVE_UNCONFIRMED" });
    expect(rpc).toHaveBeenCalledTimes(1);
    await expect(saveManualPlanCommand(input, lease)).resolves.toEqual(replay);
    expect(rpc.mock.calls).toEqual([
      ["save_own_manual_plan_v1", { p_command: input }],
      ["save_own_manual_plan_v1", { p_command: input }],
    ]);
  });

  it("binds dispatched bytes before awaiting credentials or a response", async () => {
    const input = command();
    const expected = receipt(input);
    const credentialWait = deferred<void>();
    const { rpc } = installRpc(async () => ({ data: expected, error: null }));
    const ordinary = withOwnerSupabaseMock.getMockImplementation()!;
    withOwnerSupabaseMock.mockImplementation(async (...args: unknown[]) => {
      await credentialWait.promise;
      return ordinary(...args);
    });
    const result = saveManualPlanCommand(input, captureOwnerDispatch(OWNER));
    input.title = "Later unsaved title";
    input.items[0]!.text = "Later unsaved wording";
    input.operation_id = "74000000-0000-4000-8000-000000000002";
    credentialWait.resolve();
    await expect(result).resolves.toEqual(expected);
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_command: command() });
  });

  it.each([
    ["null", null], ["partial", {}],
    ["foreign owner", { ...receipt(), owner_id: OTHER_OWNER }],
    ["foreign snapshot", { ...receipt(), snapshot: { ...snapshot(), owner_id: OTHER_OWNER } }],
    ["wrong operation", { ...receipt(), operation_id: "74000000-0000-4000-8000-000000000002" }],
    ["wrong source", { ...receipt(), snapshot: { ...snapshot(), plan_id: "another-plan" } }],
    ["changed wording", { ...receipt(), snapshot: { ...snapshot(), title: "Trimmed or changed" } }],
    ["incomplete items", { ...receipt(), snapshot: { ...snapshot(), items: snapshot().items.slice(0, 1) } }],
    ["invalid hash", { ...receipt(), request_sha256: "not-a-hash" }],
    ["wrong revision", { ...receipt(), committed: { ...receipt().committed, revision: 2 } }],
    ["unknown key", { ...receipt(), unsafe: "private diagnostics" }],
  ])("rejects a %s acknowledgement without a second dispatch or readback", async (_label, data) => {
    const { rpc } = installRpc(async () => ({ data, error: null }));
    await expect(saveManualPlanCommand(command(), captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ message: "MANUAL_PLAN_SAVE_UNCONFIRMED", code: "MANUAL_PLAN_SAVE_UNCONFIRMED" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["MANUAL_PLAN_OPERATION_CONFLICT", "MANUAL_PLAN_VERSION_CONFLICT", "MANUAL_PLAN_SOURCE_CONFLICT",
    "MANUAL_PLAN_ITEM_REMOVAL_BLOCKED", "MANUAL_PLAN_AUTHENTICATION_REQUIRED"])(
    "preserves the known %s failure", async code => {
      installRpc(async () => ({ data: null, error: { code: "P0001", message: code,
        details: "Private database detail", hint: "Private hint" } }));
      await expect(saveManualPlanCommand(command(), captureOwnerDispatch(OWNER)))
        .rejects.toMatchObject({ code, message: code });
    },
  );

  it.each([
    { code: "23505", message: "Private SQL details" },
    { code: "P0001", message: "MANUAL_PLAN_VERSION_CONFLICT private suffix" },
    { code: "P0001", message: "MANUAL_PLAN_UNKNOWN_ERROR" },
  ])("does not expose unrecognised server diagnostics: %j", async error => {
    installRpc(async () => ({ data: null, error }));
    await expect(saveManualPlanCommand(command(), captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_SAVE_UNCONFIRMED", message: "MANUAL_PLAN_SAVE_UNCONFIRMED" });
  });

  it("returns a valid superseded receipt for caller conflict handling", async () => {
    const value = { ...receipt(), status: "superseded", snapshot: {
      ...snapshot(), revision: 2, updated_at: LATER, title: "Newer remote work",
    } };
    installRpc(async () => ({ data: value, error: null }));
    await expect(saveManualPlanCommand(command(), captureOwnerDispatch(OWNER))).resolves.toEqual(value);
  });

  it("returns aggregate-token supersession without inventing an artifact revision", async () => {
    const value = { ...receipt(), status: "superseded", snapshot: { ...snapshot(), updated_at: LATER } };
    installRpc(async () => ({ data: value, error: null }));
    await expect(saveManualPlanCommand(command(), captureOwnerDispatch(OWNER))).resolves.toEqual(value);
  });

  it.each([null, [], { data: receipt() }, { error: null }])("rejects a malformed SDK envelope: %j", async response => {
    withOwnerSupabaseMock.mockResolvedValue(response);
    await expect(saveManualPlanCommand(command(), captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_SAVE_UNCONFIRMED" });
    expect(withOwnerSupabaseMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...command(), items: [] },
    { ...command(), operation_id: "not-a-uuid" },
    { ...command(), items: [command().items[0], command().items[0]] },
    { ...command(), owner_id: OTHER_OWNER },
  ])("rejects invalid commands before opening the owner client", async input => {
    await expect(saveManualPlanCommand(input as ManualPlanSaveCommand, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_INPUT_INVALID" });
    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });
});

describe("manual plan reads and lists", () => {
  it.each([{ planId: command().plan_id }, { outcomeId: OUTCOME }])("binds a read to lookup %j", async lookup => {
    const { rpc, signals } = installRpc(async () => ({
      data: { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: snapshot() }, error: null,
    }));
    const lease = captureOwnerDispatch(OWNER);
    await expect(readManualPlan(lookup, lease)).resolves.toEqual(snapshot());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_own_manual_plan_v1", {
      p_plan_id: "planId" in lookup ? lookup.planId : null,
      p_outcome_id: "outcomeId" in lookup ? lookup.outcomeId : null,
    });
    expect(signals).toEqual([lease.signal]);
    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
  });

  it("returns null only for a valid owner-bound absence envelope", async () => {
    installRpc(async () => ({ data: { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: null }, error: null }));
    await expect(readManualPlan({ planId: command().plan_id }, captureOwnerDispatch(OWNER))).resolves.toBeNull();
  });

  it.each([
    null, {}, { contract_version: "manual-plan-read.1", owner_id: OTHER_OWNER, plan: null },
    { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: { ...snapshot(), owner_id: OTHER_OWNER } },
    { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: { ...snapshot(), plan_id: "wrong-plan" } },
    { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: { ...snapshot(), items: [] } },
  ])("rejects malformed, mismatched or foreign read data: %j", async data => {
    installRpc(async () => ({ data, error: null }));
    await expect(readManualPlan({ planId: command().plan_id }, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_READ_INVALID" });
  });

  it("rejects a valid snapshot for the wrong requested outcome", async () => {
    installRpc(async () => ({ data: { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: snapshot() }, error: null }));
    await expect(readManualPlan({ outcomeId: "72000000-0000-4000-8000-000000000002" }, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_READ_INVALID" });
  });

  it.each([
    {}, { planId: "" }, { outcomeId: OUTCOME.toUpperCase() + " " }, { outcomeId: `${OUTCOME}\n` },
    { planId: command().plan_id, outcomeId: OUTCOME }, { planId: "../another" },
    { planId: "manual-plan\n" },
    { planId: command().plan_id, userId: OTHER_OWNER },
  ])("rejects an invalid or ambiguous lookup before dispatch: %j", async lookup => {
    await expect(readManualPlan(lookup, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_INPUT_INVALID" });
    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });

  it("distinguishes a failed read from absent data without exposing diagnostics", async () => {
    installRpc(async () => ({ data: null, error: { message: "Secret database diagnostics" } }));
    await expect(readManualPlan({ outcomeId: OUTCOME }, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_READ_FAILED", message: "MANUAL_PLAN_READ_FAILED" });
  });

  it("keeps a known not-found error distinct from an absence envelope", async () => {
    installRpc(async () => ({ data: null, error: { message: "MANUAL_PLAN_NOT_FOUND" } }));
    await expect(readManualPlan({ outcomeId: OUTCOME }, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_NOT_FOUND" });
  });

  it.each([[{}, 20, 0], [{ limit: 1, offset: 4 }, 1, 4]] as const)("uses exact bounded list arguments %j", async (options, limit, offset) => {
    const { rpc, signals } = installRpc(async () => ({ data: list(), error: null }));
    const lease = captureOwnerDispatch(OWNER);
    await expect(listRemoteManualPlans(options, lease)).resolves.toEqual(list());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_own_manual_plans_v1", { p_limit: limit, p_offset: offset });
    expect(signals).toEqual([lease.signal]);
  });

  it.each([
    null, { ...list(), owner_id: OTHER_OWNER }, { ...list(), has_more: "yes" },
    { ...list(), items: [list().items[0], list().items[0]] },
    { ...list(), items: [{ ...list().items[0], completed_count: 3 }] },
    { ...list(), has_more: true, items: [] },
  ])("rejects malformed list data instead of an empty success: %j", async data => {
    installRpc(async () => ({ data, error: null }));
    await expect(listRemoteManualPlans({}, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_LIST_INVALID" });
  });

  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { offset: -1 },
    { offset: 2_147_483_648 }, { offset: Number.NaN }, { limit: 2, unexpected: true }])(
    "rejects invalid pagination before dispatch: %j", async options => {
      await expect(listRemoteManualPlans(options, captureOwnerDispatch(OWNER)))
        .rejects.toMatchObject({ code: "MANUAL_PLAN_INPUT_INVALID" });
      expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
    },
  );

  it("keeps an unavailable list distinguishable from an empty list", async () => {
    installRpc(async () => { throw new TypeError("Private network diagnostics"); });
    await expect(listRemoteManualPlans({}, captureOwnerDispatch(OWNER)))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_LIST_FAILED", message: "MANUAL_PLAN_LIST_FAILED" });
  });
});

describe("manual plan owner and cancellation boundaries", () => {
  it.each(["save", "read", "list"] as const)("rejects an A → B → A %s result from the original epoch", async mode => {
    const pending = deferred<RpcResponse>();
    const { rpc } = installRpc(() => pending.promise);
    const lease = captureOwnerDispatch(OWNER);
    const result = mode === "save" ? saveManualPlanCommand(command(), lease)
      : mode === "read" ? readManualPlan({ outcomeId: OUTCOME }, lease)
        : listRemoteManualPlans({}, lease);
    const rejected = expect(result).rejects.toBeInstanceOf(OwnerDispatchError);
    recordBrowserPrincipal(OTHER_OWNER);
    recordBrowserPrincipal(OWNER);
    pending.resolve({ data: mode === "save" ? receipt() : mode === "read"
      ? { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: snapshot() } : list(), error: null });
    await rejected;
    expect(rpc).toHaveBeenCalledTimes(1);
    await expect(saveManualPlanCommand(command(), lease)).rejects.toBeInstanceOf(OwnerDispatchError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["AbortError", "TimeoutError"])("returns save uncertainty promptly on %s even if transport ignores abort", async name => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = deferred<RpcResponse>();
    const { rpc, signals } = installRpc(() => pending.promise);
    const lease = captureOwnerDispatch(OWNER, controller.signal);
    const result = saveManualPlanCommand(command(), lease);
    const rejected = expect(result).rejects.toMatchObject({ code: "MANUAL_PLAN_SAVE_UNCONFIRMED" });
    setTimeout(() => controller.abort(new DOMException("Private cancellation detail", name)), 25);
    await Promise.all([rejected, vi.advanceTimersByTimeAsync(25)]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(signals).toEqual([lease.signal]);
    pending.resolve({ data: receipt(), error: null });
  });

  it.each(["read", "list"] as const)("settles an aborted %s without accepting late data", async mode => {
    const controller = new AbortController();
    const pending = deferred<RpcResponse>();
    const { rpc } = installRpc(() => pending.promise);
    const lease = captureOwnerDispatch(OWNER, controller.signal);
    const result = mode === "read" ? readManualPlan({ outcomeId: OUTCOME }, lease) : listRemoteManualPlans({}, lease);
    const rejected = expect(result).rejects.toMatchObject({
      code: mode === "read" ? "MANUAL_PLAN_READ_FAILED" : "MANUAL_PLAN_LIST_FAILED",
    });
    controller.abort(new DOMException("Private cancellation detail", "AbortError"));
    await rejected;
    expect(rpc).toHaveBeenCalledTimes(1);
    pending.resolve({ data: mode === "read"
      ? { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: snapshot() } : list(), error: null });
  });

  it("does not dispatch when the caller cancelled before invocation", async () => {
    const controller = new AbortController();
    const lease = captureOwnerDispatch(OWNER, controller.signal);
    installRpc();
    controller.abort(new DOMException("Private caller detail", "AbortError"));
    await expect(saveManualPlanCommand(command(), lease))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_REQUEST_CANCELLED", message: "MANUAL_PLAN_REQUEST_CANCELLED" });
    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });

  it.each(["caller cancelled", { name: "AbortError", message: "Private reason" }, null])(
    "classifies a non-Error abort reason as cancellation and never revives the lease: %j", async reason => {
      const controller = new AbortController();
      const lease = captureOwnerDispatch(OWNER, controller.signal);
      const { rpc } = installRpc(() => new Promise(() => {}));
      const result = saveManualPlanCommand(command(), lease);
      const rejected = expect(result).rejects.toMatchObject({ code: "MANUAL_PLAN_SAVE_UNCONFIRMED" });
      controller.abort(reason);
      await rejected;
      await expect(saveManualPlanCommand(command(), lease)).rejects.toMatchObject({ code: "MANUAL_PLAN_REQUEST_CANCELLED" });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an invalid owner identity before dispatch", async () => {
    const lease = { ...captureOwnerDispatch(OWNER), expectedUserId: "guest:local" };
    await expect(saveManualPlanCommand(command(), lease))
      .rejects.toMatchObject({ code: "MANUAL_PLAN_AUTHENTICATION_REQUIRED" });
    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });
});
