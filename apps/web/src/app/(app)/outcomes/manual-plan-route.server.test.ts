import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createSdkClient } from "@supabase/supabase-js";
import type { ManualPlanRead, ManualPlanSnapshot } from "@prompted/shared";

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { resolveManualPlanRoute } from "./manual-plan-route.server";

const OWNER = "fa010000-0000-4000-8000-000000000001";
const OTHER_OWNER = "fa010000-0000-4000-8000-000000000002";
const OUTCOME = "fa020000-0000-4000-8000-000000000001";
const ARTIFACT = "fa030000-0000-4000-8000-000000000001";
const OTHER_OUTCOME = "fa020000-0000-4000-8000-000000000002";

function snapshot(): ManualPlanSnapshot {
  return {
    contract_version: "manual-plan.1", owner_id: OWNER, plan_id: "old-local-plan:1",
    outcome_id: OUTCOME, artifact_id: ARTIFACT, revision: 2,
    created_at: "2026-09-13T01:02:03.123456Z", updated_at: "2026-09-13T01:02:04.123457Z",
    title: "  My plan  ",
    items: [{ id: "local-item:1", section: "", text: "", notes: "", due_date: null, done: false }],
  };
}

function read(plan: ManualPlanSnapshot | null = snapshot()): ManualPlanRead {
  return { contract_version: "manual-plan-read.1", owner_id: OWNER, plan };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function installClient(result: unknown = { data: read(), error: null }) {
  const signals: AbortSignal[] = [];
  const respond = vi.fn(() => Promise.resolve(result));
  const abortSignal = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return respond();
  });
  const builder = { abortSignal };
  const rpc = vi.fn(() => builder);
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
  const client = { auth: { getUser }, rpc };
  createClientMock.mockResolvedValue(client);
  return { client, getUser, rpc, builder, abortSignal, respond, signals };
}

// A function returned from beforeEach is a Vitest cleanup callback. Do not
// return the reset mock, which would call the client factory during teardown.
beforeEach(() => { createClientMock.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("resolveManualPlanRoute server boundary", () => {
  it("reads one exact owner outcome with all SDK method receivers intact", async () => {
    const { client, getUser, rpc, builder, abortSignal, signals } = installClient();
    await expect(resolveManualPlanRoute(OUTCOME)).resolves.toEqual({ kind: "manual", planId: "old-local-plan:1" });
    expect(getUser.mock.contexts).toEqual([client.auth]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_own_manual_plan_v1", { p_plan_id: null, p_outcome_id: OUTCOME });
    expect(rpc.mock.contexts).toEqual([client]);
    expect(abortSignal.mock.contexts).toEqual([builder]);
    expect(signals[0]?.aborted).toBe(false);
  });

  it.each([
    ["manual plan", read(), { kind: "manual", planId: "old-local-plan:1" }],
    ["confirmed absence", read(null), { kind: "other" }],
    ["foreign owner", { ...read(), owner_id: OTHER_OWNER }, { kind: "unavailable" }],
    ["foreign plan", read({ ...snapshot(), owner_id: OTHER_OWNER }), { kind: "unavailable" }],
    ["wrong outcome", read({ ...snapshot(), outcome_id: OTHER_OUTCOME }), { kind: "unavailable" }],
    ["malformed plan", { ...read(), plan: {} }, { kind: "unavailable" }],
  ])("uses the real Supabase RPC and decoder for %s", async (_label, response, expected) => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://example.supabase.co/rest/v1/rpc/get_own_manual_plan_v1");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ p_plan_id: null, p_outcome_id: OUTCOME });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json(response);
    });
    const client = createSdkClient("https://example.supabase.co", "synthetic-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: `manual-plan-route-${_label}` }, global: { fetch },
    });
    vi.spyOn(client.auth, "getUser").mockResolvedValue({ data: { user: {
      id: OWNER, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-13T00:00:00.000Z",
    } }, error: null });
    const rpc = vi.spyOn(client, "rpc");
    createClientMock.mockResolvedValue(client);

    await expect(resolveManualPlanRoute(OUTCOME)).resolves.toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc.mock.contexts).toEqual([client]);
  });

  it("uses only an explicit null user as confirmed anonymous state", async () => {
    const { getUser, rpc } = installClient();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(resolveManualPlanRoute(OUTCOME)).resolves.toEqual({ kind: "other" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing envelope", null], ["missing error", { data: { user: null } }],
    ["missing user", { data: {}, error: null }], ["undefined user", { data: { user: undefined }, error: null }],
    ["wrong user type", { data: { user: false }, error: null }],
    ["missing owner", { data: { user: {} }, error: null }],
    ["non-UUID owner", { data: { user: { id: "unverified-owner" } }, error: null }],
    ["auth error", { data: { user: { id: OWNER } }, error: { message: "Private auth diagnostics" } }],
  ])("does not interpret %s as safe absence", async (_label, authentication) => {
    const { getUser, rpc } = installClient();
    getUser.mockResolvedValue(authentication);
    await expect(resolveManualPlanRoute(OUTCOME)).resolves.toEqual({ kind: "unavailable" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["null response", null], ["missing data", { error: null }], ["missing error", { data: read(null) }],
    ["undefined error", { data: read(null), error: undefined }],
    ["RPC error", { data: read(null), error: { message: "Private database diagnostics" } }],
    ["missing read envelope", { data: null, error: null }],
    ["partial read", { data: { owner_id: OWNER, plan: null }, error: null }],
    ["unknown read field", { data: { ...read(null), unsafe: true }, error: null }],
  ])("blocks generated routing on %s", async (_label, response) => {
    const { rpc } = installClient(response);
    await expect(resolveManualPlanRoute(OUTCOME)).resolves.toEqual({ kind: "unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid", OUTCOME.toUpperCase(), `${OUTCOME}\n`])("rejects an invalid outcome before authentication: %s", async outcome => {
    await expect(resolveManualPlanRoute(outcome)).resolves.toEqual({ kind: "unavailable" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("captures owner identity before awaiting readback", async () => {
    const rpcResult = deferred<unknown>();
    const { getUser, respond, rpc } = installClient();
    const user = { id: OWNER };
    getUser.mockResolvedValue({ data: { user }, error: null });
    respond.mockReturnValue(rpcResult.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    user.id = OTHER_OWNER;
    rpcResult.resolve({ data: { ...read({ ...snapshot(), owner_id: OTHER_OWNER }), owner_id: OTHER_OWNER }, error: null });
    await expect(result).resolves.toEqual({ kind: "unavailable" });
  });

  it("cleans its timer and caller listener after a successful read", async () => {
    vi.useFakeTimers();
    installClient();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    await expect(resolveManualPlanRoute(OUTCOME, caller.signal)).resolves.toEqual({ kind: "manual", planId: "old-local-plan:1" });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("manual route total read lifetime", () => {
  beforeEach(() => vi.useFakeTimers());

  it.each(["client", "auth", "rpc"])("returns a safe result and cleans up an immediate %s failure", async stage => {
    const { getUser, rpc } = installClient();
    const failure = new Error("Private server diagnostics");
    if (stage === "client") createClientMock.mockRejectedValue(failure);
    else if (stage === "auth") getUser.mockRejectedValue(failure);
    else rpc.mockImplementation(() => { throw failure; });
    await expect(resolveManualPlanRoute(OUTCOME)).resolves.toEqual({ kind: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
    if (stage !== "rpc") expect(rpc).not.toHaveBeenCalled();
  });

  it("bounds a hanging client factory and prevents late auth or RPC dispatch", async () => {
    const clientWait = deferred<ReturnType<typeof installClient>["client"]>();
    const { client, getUser, rpc } = installClient();
    createClientMock.mockReturnValue(clientWait.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    let settled = false;
    void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    clientWait.resolve(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, { id: OWNER }])("bounds hanging authentication and ignores its late user %j", async user => {
    const authWait = deferred<unknown>();
    const { getUser, rpc } = installClient();
    getUser.mockReturnValue(authWait.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(getUser).toHaveBeenCalledTimes(1);
    authWait.resolve({ data: { user }, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual({ kind: "unavailable" });
  });

  it("bounds an RPC that ignores abort and never accepts its late absence", async () => {
    const rpcWait = deferred<unknown>();
    const { respond, signals } = installClient();
    respond.mockReturnValue(rpcWait.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(signals[0]?.aborted).toBe(true);
    rpcWait.resolve({ data: read(null), error: null });
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
  });

  it("shares one total budget across client, authentication and RPC", async () => {
    const clientWait = deferred<ReturnType<typeof installClient>["client"]>();
    const authWait = deferred<unknown>();
    const rpcWait = deferred<unknown>();
    const { client, getUser, respond, signals } = installClient();
    createClientMock.mockReturnValue(clientWait.promise);
    getUser.mockReturnValue(authWait.promise);
    respond.mockReturnValue(rpcWait.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    await vi.advanceTimersByTimeAsync(5_000);
    clientWait.resolve(client);
    await vi.advanceTimersByTimeAsync(5_000);
    authWait.resolve({ data: { user: { id: OWNER } }, error: null });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(signals[0]?.aborted).toBe(true);
    rpcWait.reject(new Error("Late private transport failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch after elapsed time even before a delayed timeout callback runs", async () => {
    const authWait = deferred<unknown>();
    const { getUser, rpc } = installClient();
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    getUser.mockReturnValue(authWait.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    await vi.advanceTimersByTimeAsync(0);
    now.mockReturnValue(15_100);
    authWait.resolve({ data: { user: { id: OWNER } }, error: null });
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not begin work for a cancelled caller", async () => {
    const caller = new AbortController();
    caller.abort();
    await expect(resolveManualPlanRoute(OUTCOME, caller.signal)).resolves.toEqual({ kind: "unavailable" });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels during client creation without a late authentication call", async () => {
    const caller = new AbortController();
    const clientWait = deferred<ReturnType<typeof installClient>["client"]>();
    const { client, getUser, rpc } = installClient();
    createClientMock.mockReturnValue(clientWait.promise);
    const result = resolveManualPlanRoute(OUTCOME, caller.signal);
    caller.abort();
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    clientWait.resolve(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancels during authentication without admitting a late anonymous result", async () => {
    const caller = new AbortController();
    const authWait = deferred<unknown>();
    const { getUser, rpc } = installClient();
    getUser.mockReturnValue(authWait.promise);
    const result = resolveManualPlanRoute(OUTCOME, caller.signal);
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    authWait.resolve({ data: { user: null }, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancels the SDK signal and rejects late RPC absence", async () => {
    const caller = new AbortController();
    const rpcWait = deferred<unknown>();
    const { respond, signals } = installClient();
    respond.mockReturnValue(rpcWait.promise);
    const result = resolveManualPlanRoute(OUTCOME, caller.signal);
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(signals[0]?.aborted).toBe(true);
    rpcWait.resolve({ data: read(null), error: null });
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["client", "auth", "rpc"])("consumes a late %s rejection after timeout", async stage => {
    const wait = deferred<unknown>();
    const { getUser, respond } = installClient();
    if (stage === "client") createClientMock.mockReturnValue(wait.promise);
    else if (stage === "auth") getUser.mockReturnValue(wait.promise);
    else respond.mockReturnValue(wait.promise);
    const result = resolveManualPlanRoute(OUTCOME);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    wait.reject(new Error("Private late diagnostics"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
