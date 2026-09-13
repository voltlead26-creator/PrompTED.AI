import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualPlanSaveCommand, ManualPlanSaveReceipt, ManualPlanSnapshot } from "@prompted/shared";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import { useManualPlanPersistence } from "./useManualPlanPersistence";
import { currentDeviceDataScope, writeDeviceData } from "@/lib/owner-bound-device-store";
import { listManualPlanRecoveries } from "@/app/(app)/plans/manual-plan-recovery";

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/api/manual-plans", () => ({ readManualPlan: api.read, saveManualPlanCommand: api.save }));
const owner = "11111111-1111-4111-8111-111111111111";
const outcome = "22222222-2222-4222-8222-222222222222";
const artifact = "33333333-3333-4333-8333-333333333333";
function snapshot(text = "Stored wording", revision = 1): ManualPlanSnapshot {
  return { contract_version: "manual-plan.1", owner_id: owner, plan_id: "plan-1", outcome_id: outcome,
    artifact_id: artifact, revision, created_at: "2026-09-13T00:00:00.000001Z", updated_at: `2026-09-13T00:00:0${revision}.000001Z`,
    title: "Exact title", items: [{ id: "item-1", section: "", text, notes: "", due_date: null, done: false }] };
}
function receipt(command: ManualPlanSaveCommand, status: "saved" | "replayed" = "saved"): ManualPlanSaveReceipt {
  const value = { ...snapshot(), plan_id: command.plan_id, title: command.title, items: command.items,
    revision: (command.expected?.revision ?? 0) + 1 };
  return { contract_version: "manual-plan-save.1", owner_id: owner, operation_id: command.operation_id,
    request_sha256: "a".repeat(64), status, committed: { outcome_id: outcome, artifact_id: artifact,
      revision: value.revision, updated_at: value.updated_at }, snapshot: value };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/plans?create=manual&plan=plan-1");
  recordBrowserPrincipal(owner); vi.clearAllMocks();
  api.read.mockResolvedValue(snapshot());
  api.save.mockImplementation(async command => receipt(command));
});
afterEach(() => vi.restoreAllMocks());

describe("durable manual plan editor", () => {
  it("opens from account storage on a browser with no device copy", async () => {
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan?.items[0]?.text).toBe("Stored wording"));
    expect(result.current.status).toBe("saved");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("keeps newer typing while an uncertain save retries the identical command", async () => {
    const pending = deferred<ManualPlanSaveReceipt>();
    api.save.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    act(() => result.current.update(plan => ({ ...plan, title: "First change" })));
    act(() => { void result.current.retry(); });
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const first = structuredClone(api.save.mock.calls[0]![0]);
    act(() => result.current.update(plan => ({ ...plan, title: "Newer typing" })));
    await act(async () => pending.reject(new Error("MANUAL_PLAN_SAVE_UNCONFIRMED")));
    expect(result.current.plan?.title).toBe("Newer typing");
    expect(result.current.status).toBe("error");
    await act(async () => { await result.current.retry(); });
    expect(api.save.mock.calls[1]![0]).toEqual(first);
    expect(result.current.plan?.title).toBe("Newer typing");
    expect(result.current.status).toBe("pending");
  });

  it("recovers exact pending identity and newer draft on reload without resubmitting automatically", async () => {
    api.save.mockRejectedValueOnce(new Error("MANUAL_PLAN_SAVE_UNCONFIRMED"));
    const first = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(first.result.current.plan).not.toBeNull());
    act(() => first.result.current.update(plan => ({ ...plan, title: "Recover me" })));
    await act(async () => { await first.result.current.retry(); });
    const command = structuredClone(api.save.mock.calls[0]![0]);
    act(() => first.result.current.update(plan => ({ ...plan, title: "Preserve this later edit" })));
    first.unmount();
    const next = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(next.result.current.status).toBe("error"));
    expect(next.result.current.plan?.title).toBe("Preserve this later edit");
    expect(api.save).toHaveBeenCalledTimes(1);
    await act(async () => { await next.result.current.retry(); });
    expect(api.save.mock.calls[1]![0]).toEqual(command);
  });

  it("preserves the draft on stale revision and requires explicit use of the account version", async () => {
    api.save.mockRejectedValueOnce(new Error("MANUAL_PLAN_VERSION_CONFLICT"));
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    act(() => result.current.update(plan => ({ ...plan, title: "My draft" })));
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe("conflict");
    api.read.mockResolvedValue(snapshot("Other device", 2));
    await act(async () => { await result.current.reload(); });
    expect(result.current.plan?.title).toBe("My draft");
    expect(result.current.remote?.items[0]?.text).toBe("Other device");
    act(() => result.current.useAccountVersion());
    expect(result.current.plan?.items[0]?.text).toBe("Other device");
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("rejects late acknowledgement after A to B to A without acquiring a fresh lease", async () => {
    const pending = deferred<ManualPlanSaveReceipt>(); api.save.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    act(() => result.current.update(plan => ({ ...plan, title: "A change" })));
    act(() => { void result.current.retry(); });
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    act(() => { recordBrowserPrincipal("44444444-4444-4444-8444-444444444444"); recordBrowserPrincipal(owner); });
    await act(async () => pending.resolve(receipt(api.save.mock.calls[0]![0])));
    expect(result.current.status).not.toBe("saved");
    expect(result.current.plan).toBeNull();
    expect(result.current.remote).toBeNull();
    await act(async () => { await result.current.retry(); });
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("does not create a replacement for a missing requested account plan", async () => {
    api.read.mockResolvedValue(null);
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.plan).toBeNull(); expect(api.save).not.toHaveBeenCalled();
  });

  it("keeps separate recovery records when two tabs edit the same source copy", async () => {
    const first = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(first.result.current.plan).not.toBeNull());
    act(() => first.result.current.update(plan => ({ ...plan, title: "First tab" })));
    const firstRecovery = new URLSearchParams(location.search).get("recovery");
    const second = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(second.result.current.plan).not.toBeNull());
    act(() => second.result.current.update(plan => ({ ...plan, title: "Second tab" })));
    const secondRecovery = new URLSearchParams(location.search).get("recovery");
    expect(firstRecovery).not.toBe(secondRecovery);
    first.unmount(); second.unmount();
    const values = Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i)!));
    expect(values.some(raw => raw?.includes('"title":"First tab"'))).toBe(true);
    expect(values.some(raw => raw?.includes('"title":"Second tab"'))).toBe(true);
  });

  it("keeps a new plan's allocated identity when its own recovery URL is published", async () => {
    window.history.replaceState(null, "", "/plans?create=manual"); api.read.mockResolvedValue(null);
    const { result } = renderHook(() => useManualPlanPersistence(owner));
    await waitFor(() => expect(result.current.status).toBe("pending"));
    const id = result.current.plan!.id; const session = result.current.sessionId;
    act(() => result.current.update(plan => ({ ...plan, title: "New plan" })));
    expect(result.current.plan!.id).toBe(id); expect(result.current.sessionId).toBe(session);
    await act(async () => { await result.current.retry(); });
    expect(api.save).toHaveBeenCalledTimes(1); expect(api.save.mock.calls[0]![0].plan_id).toBe(id);
  });

  it("selects a different recovery copy for the same plan after query navigation", async () => {
    const current = snapshot();
    const expected = { outcome_id: outcome, artifact_id: artifact, revision: current.revision, updated_at: current.updated_at };
    for (const [id, title] of [["55555555-5555-4555-8555-555555555555", "First recovery"], ["66666666-6666-4666-8666-666666666666", "Second recovery"]]) {
      writeDeviceData(currentDeviceDataScope(owner), "manual-plan-recovery", id!, { version: 1, ownerId: owner,
        plan: { id: "plan-1", title, updatedAt: current.updated_at, items: current.items.map(item => ({
          id: item.id, section: item.section, text: item.text, notes: item.notes, dueDate: "", done: item.done,
        })) }, expected, pending: null, dirty: true });
    }
    window.history.replaceState(null, "", "/plans?create=manual&plan=plan-1&recovery=55555555-5555-4555-8555-555555555555");
    const { result, rerender } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan?.title).toBe("First recovery"));
    const firstSession = result.current.sessionId;
    window.history.replaceState(null, "", "/plans?create=manual&plan=plan-1&recovery=66666666-6666-4666-8666-666666666666"); rerender();
    await waitFor(() => expect(result.current.plan?.title).toBe("Second recovery"));
    expect(result.current.sessionId).not.toBe(firstSession); expect(api.save).not.toHaveBeenCalled();
  });

  it("allows a corrected draft a new command after a definite server rejection", async () => {
    api.save.mockRejectedValueOnce(new Error("MANUAL_PLAN_ITEM_REMOVAL_BLOCKED"));
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    act(() => result.current.update(plan => ({ ...plan, title: "Rejected edit" })));
    await act(async () => { await result.current.retry(); });
    const rejected = structuredClone(api.save.mock.calls[0]![0]);
    expect(result.current.message).toContain("Undo");
    expect(listManualPlanRecoveries(currentDeviceDataScope(owner))[0]?.value.rejected?.command).toEqual(rejected);
    act(() => result.current.update(plan => ({ ...plan, title: "Corrected edit" })));
    await act(async () => { await result.current.retry(); });
    expect(api.save.mock.calls[1]![0].operation_id).not.toBe(rejected.operation_id);
    expect(api.save.mock.calls[1]![0].title).toBe("Corrected edit");
    expect(result.current.status).toBe("saved");
  });

  it("rejects a device record whose embedded plan identity differs from its key", async () => {
    writeDeviceData(currentDeviceDataScope(owner), "manual-plan", "plan-1", { id: "different-plan", title: "Wrong identity",
      items: [{ id: "step-1", section: "", text: "Preserved original", notes: "", dueDate: "", done: false }], updatedAt: "" });
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.plan).toBeNull(); expect(api.read).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
  });

  it("retains failed reads as an explicit blocker rather than treating them as new plans", async () => {
    api.read.mockRejectedValueOnce(new Error("MANUAL_PLAN_READ_FAILED"));
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.plan).toBeNull(); expect(api.save).not.toHaveBeenCalled();
    await act(async () => { await result.current.reload(); });
    expect(result.current.plan?.items[0]?.text).toBe("Stored wording"); expect(result.current.status).toBe("saved");
  });

  it.each([undefined, "44444444-4444-4444-8444-444444444444"])("hides and preserves device data when the initial principal is %s", async principal => {
    writeDeviceData(currentDeviceDataScope(owner), "manual-plan", "plan-1", { id: "plan-1", title: "Private owner wording",
      items: [{ id: "step-1", section: "", text: "Preserved original", notes: "", dueDate: "", done: false }], updatedAt: "" });
    const before = JSON.stringify(localStorage);
    recordBrowserPrincipal(principal);
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    expect(result.current.plan).toBeNull(); expect(result.current.remote).toBeNull();
    act(() => { expect(result.current.update(plan => ({ ...plan, title: "Forbidden change" }))).toBeNull(); });
    await act(async () => { await result.current.retry(); });
    expect(api.read).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  it.each(["MANUAL_PLAN_ITEM_REMOVAL_BLOCKED", "MANUAL_PLAN_SAVE_UNCONFIRMED"])("preserves the storage-failure warning after %s", async code => {
    const pending = deferred<ManualPlanSaveReceipt>(); api.save.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useManualPlanPersistence(owner, "plan-1"));
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    act(() => result.current.update(plan => ({ ...plan, title: "Submitted wording" })));
    act(() => { void result.current.retry(); });
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota", "QuotaExceededError"); });
    act(() => result.current.update(plan => ({ ...plan, title: "Newest unretained wording" })));
    await act(async () => pending.reject(new Error(code)));
    expect(result.current.plan?.title).toBe("Newest unretained wording");
    expect(result.current.status).toBe("error");
    expect(result.current.message).toContain("latest edits are only in this open editor");
    expect(result.current.message).not.toContain("kept on this device");
    expect(listManualPlanRecoveries(currentDeviceDataScope(owner)).every(copy => copy.value.plan.title !== "Newest unretained wording")).toBe(true);
  });
});
