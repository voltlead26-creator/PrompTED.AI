import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type { ManualPlanSnapshot } from "@prompted/shared";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import type { LibraryTab } from "./useLibrary";

const auth = vi.hoisted(() => ({ id: "33333333-3333-4333-8333-333333333333", loading: false }));
const read = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const readPlan = vi.hoisted(() => vi.fn());
vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: auth.id }, loading: auth.loading }),
}));
vi.mock("@/lib/api/outcomes", () => ({ updateOutcome: update }));
vi.mock("@/lib/api/manual-plans", () => ({ readManualPlan: readPlan }));
vi.mock("@/lib/supabase/owner-client", () => ({ withOwnerSupabase: read }));
import { useLibrary } from "./useLibrary";

function row(n: number, saved = false) {
  const id = `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
  return {
    id,
    user_id: auth.id,
    situation_text: `Document ${n}`,
    status: "draft",
    is_saved: saved,
    business_id: null,
    bundle_id: null,
    recommendation_payload: null,
    conversation_revision: 0,
    created_at: "2026-09-11T00:00:00Z",
    updated_at: "2026-09-11T00:00:00Z",
    documents: [],
  };
}
function manualRow(n: number, saved = false) {
  return {
    ...row(n, saved),
    situation_text: "Manual action plan",
    recommendation_payload: { manual_plan: { contract_version: "manual-plan.1", plan_id: `manual:${n}` } },
  };
}
function manualSnapshot(n: number): ManualPlanSnapshot {
  return {
    contract_version: "manual-plan.1",
    owner_id: auth.id,
    plan_id: `manual:${n}`,
    outcome_id: row(n).id,
    artifact_id: `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`,
    revision: 1,
    created_at: "2026-09-11T00:00:00.000000Z",
    updated_at: "2026-09-11T00:00:00.123456Z",
    title: `Authoritative plan ${n}`,
    items: [{ id: "action:1", section: "", text: "", notes: "", due_date: null, done: false }],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function useLoadedLibrary(tab: LibraryTab) {
  const library = useLibrary(tab);
  const { load } = library;
  useEffect(() => {
    void load(true);
  }, [load]);
  return library;
}
beforeEach(() => {
  auth.id = "33333333-3333-4333-8333-333333333333";
  auth.loading = false;
  recordBrowserPrincipal(auth.id);
  read.mockReset();
  update.mockReset();
  readPlan.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("library request lifetime", () => {
  it("rejects a late response for a previous tab", async () => {
    const old = deferred<{ data: ReturnType<typeof row>[]; error: null }>();
    read
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ data: [row(2, true)], error: null });
    const { result, rerender } = renderHook(({ tab }) => useLoadedLibrary(tab), {
      initialProps: { tab: "recents" as LibraryTab },
    });
    rerender({ tab: "saved" });
    await waitFor(() => expect(result.current.items[0]?.outcome.id).toBe(row(2).id));
    await act(async () => old.resolve({ data: [row(1)], error: null }));
    expect(result.current.items.map((item) => item.outcome.id)).toEqual([row(2).id]);
  });

  it("dispatches a pending page only once and deduplicates overlapping results", async () => {
    const page = deferred<{ data: ReturnType<typeof row>[]; error: null }>();
    read
      .mockResolvedValueOnce({
        data: Array.from({ length: 10 }, (_, i) => row(i + 1)),
        error: null,
      })
      .mockReturnValue(page.promise);
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.items).toHaveLength(10));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.load();
      second = result.current.load();
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      page.resolve({ data: [row(10), row(11)], error: null });
      await Promise.all([first, second]);
    });
    expect(result.current.items).toHaveLength(11);
    expect(result.current.hasMore).toBe(false);
  });

  it("aborts a read when the library unmounts", () => {
    read.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useLoadedLibrary("recents"));
    const lease = read.mock.calls[0]?.[0];
    expect(lease).toBeDefined();
    unmount();
    expect(lease.signal.aborted).toBe(true);
  });

  it("handles a thrown fetch failure and allows an explicit retry", async () => {
    read.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    read.mockRejectedValueOnce(new Error("private transport detail"));
    await act(async () => {
      await expect(result.current.load(true)).resolves.toBeUndefined();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(/try again/i);
    expect(result.current.error).not.toContain("private transport detail");
    read.mockResolvedValueOnce({ data: [row(1)], error: null });
    await act(async () => {
      await result.current.load(true);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it("rejects malformed or foreign-owner rows without presenting an empty success", async () => {
    read.mockResolvedValueOnce({
      data: [{ ...row(1), user_id: "77777777-7777-4777-8777-777777777777" }],
      error: null,
    });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it("does not dispatch duplicate bookmarks and reports a rejected save", async () => {
    read.mockResolvedValue({ data: [row(1)], error: null });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const mutation = deferred<void>();
    update.mockReturnValue(mutation.promise);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.toggleSaved(row(1).id, false);
      second = result.current.toggleSaved(row(1).id, false);
    });
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => {
      mutation.reject(new Error("private database detail"));
      await expect(Promise.all([first, second])).resolves.toBeDefined();
    });
    expect(result.current.items[0]?.outcome.is_saved).toBe(false);
    expect(result.current.saveError).toMatch(/refresh/i);
    expect(result.current.savingIds).toEqual([]);
    await act(async () => {
      await result.current.toggleSaved(row(1).id, false);
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("loads when authentication finishes without changing the selected tab", async () => {
    auth.loading = true;
    read.mockResolvedValue({ data: [row(1)], error: null });
    const { result, rerender } = renderHook(() => useLoadedLibrary("recents"));
    expect(read).not.toHaveBeenCalled();
    auth.loading = false;
    rerender();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it("hides old-owner data immediately and rejects an A to B to A stale read", async () => {
    const old = deferred<{ data: ReturnType<typeof row>[]; error: null }>();
    const ownerA = auth.id;
    read.mockReturnValueOnce(old.promise).mockResolvedValue({ data: [], error: null });
    const { result, rerender } = renderHook(() => useLoadedLibrary("recents"));
    auth.id = "77777777-7777-4777-8777-777777777777";
    recordBrowserPrincipal(auth.id);
    rerender();
    expect(result.current.items).toEqual([]);
    auth.id = ownerA;
    recordBrowserPrincipal(auth.id);
    read.mockResolvedValueOnce({ data: [row(2)], error: null });
    rerender();
    await waitFor(() => expect(result.current.items[0]?.outcome.id).toBe(row(2).id));
    await act(async () => old.resolve({ data: [row(1)], error: null }));
    expect(result.current.items[0]?.outcome.id).toBe(row(2).id);
  });

  it("turns an aborted timeout into a recoverable error", async () => {
    vi.useFakeTimers();
    read.mockImplementation(
      (lease) =>
        new Promise((_resolve, reject) => {
          lease.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(/try again/i);
  });

  it("preserves existing cards after a failed page and retries the same cursor", async () => {
    read.mockResolvedValueOnce({
      data: Array.from({ length: 10 }, (_, i) => row(i + 1)),
      error: null,
    });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.items).toHaveLength(10));
    read.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.error).toBeTruthy();
    read.mockResolvedValueOnce({ data: [row(11)], error: null });
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.items).toHaveLength(11);
    expect(result.current.error).toBeNull();
  });

  it("refreshes Saved membership only after the bookmark is confirmed", async () => {
    read
      .mockResolvedValueOnce({ data: [row(1, true)], error: null })
      .mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useLoadedLibrary("saved"));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const mutation = deferred<void>();
    update.mockReturnValue(mutation.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.toggleSaved(row(1).id, true);
    });
    expect(result.current.items).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      mutation.resolve();
      await pending;
    });
    expect(result.current.items).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]?.slice(0, 2)).toEqual([row(1).id, { is_saved: false }]);
  });

  it("selects only card fields and filters template parents with an inner join", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    const from = vi.fn(() => query);
    read.mockImplementation((_lease, operation) => operation({ from }));
    const { result } = renderHook(() => useLoadedLibrary("templates"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).toHaveBeenCalledWith("outcomes");
    expect(query.select.mock.calls[0]?.[0]).toContain("documents:documents!inner(");
    expect(query.select.mock.calls[0]?.[0]).toContain("recommendation_payload");
    expect(query.select.mock.calls[0]?.[0]).not.toMatch(/content|version_history/);
    expect(query.eq.mock.calls).toEqual([
      ["user_id", auth.id],
      ["documents.is_template", true],
    ]);
    expect(query.order.mock.calls).toEqual([
      ["updated_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(query.range).toHaveBeenCalledWith(0, 9);
  });
});

describe("manual plans in My Work", () => {
  it("resolves an immutable marker by outcome under the page's exact owner lease", async () => {
    const plan = manualSnapshot(1);
    read.mockResolvedValue({ data: [manualRow(1), row(2)], error: null });
    readPlan.mockResolvedValue(plan);
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(readPlan).toHaveBeenCalledExactlyOnceWith({ outcomeId: row(1).id }, read.mock.calls[0]?.[0]);
    expect(result.current.items[0]?.manualPlan).toEqual({
      owner_id: plan.owner_id, plan_id: plan.plan_id, outcome_id: plan.outcome_id,
      artifact_id: plan.artifact_id, revision: plan.revision, updated_at: plan.updated_at, title: plan.title,
    });
    expect(result.current.items[0]?.documents).toEqual([]);
    expect(result.current.items[1]?.manualPlan).toBeUndefined();
    expect(result.current.hasMore).toBe(false);
  });

  it.each([
    { manual_plan: null },
    { manual_plan: {} },
    { manual_plan: { contract_version: "manual-plan.2", plan_id: "manual:1" } },
    { manual_plan: { contract_version: "manual-plan.1", plan_id: "invalid/id" } },
    { manual_plan: { contract_version: "manual-plan.1", plan_id: "manual:1", title: "untrusted" } },
    { manual_plan: { contract_version: "manual-plan.1", plan_id: "manual:1" }, title: "untrusted" },
  ])("blocks a present malformed marker rather than treating it as generated work: %j", async (recommendation_payload) => {
    read.mockResolvedValue({ data: [{ ...row(1), recommendation_payload }], error: null });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toMatch(/try again/i);
    expect(readPlan).not.toHaveBeenCalled();
  });

  it("rejects simultaneous manual and document identities before either is presented", async () => {
    read.mockResolvedValue({ data: [{ ...manualRow(1), documents: [{
      id: "44444444-4444-4444-8444-444444444444", user_id: auth.id,
      outcome_id: row(1).id, title: "Conflicting document", status: "draft", is_template: false,
    }] }], error: null });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeTruthy();
    expect(readPlan).not.toHaveBeenCalled();
  });

  it("rejects duplicate manual identities rather than showing two outcomes for one plan", async () => {
    read.mockResolvedValue({ data: [manualRow(1), {
      ...manualRow(2), recommendation_payload: manualRow(1).recommendation_payload,
    }], error: null });
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.items).toEqual([]);
    expect(readPlan).not.toHaveBeenCalled();
  });

  it.each(["absent", "owner", "outcome", "plan"] as const)(
    "rejects a %s snapshot mismatch without a generic document fallback", async (mismatch) => {
      const plan = manualSnapshot(1);
      const invalid = mismatch === "absent" ? null : {
        ...plan,
        ...(mismatch === "owner" ? { owner_id: "77777777-7777-4777-8777-777777777777" } : {}),
        ...(mismatch === "outcome" ? { outcome_id: row(2).id } : {}),
        ...(mismatch === "plan" ? { plan_id: "other" } : {}),
      };
      read.mockResolvedValue({ data: [manualRow(1)], error: null });
      readPlan.mockResolvedValue(invalid);
      const { result } = renderHook(() => useLoadedLibrary("recents"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.items).toEqual([]);
      expect(result.current.error).toMatch(/try again/i);
    },
  );

  it("retires a previous tab's pending manual lookup and its signal", async () => {
    const late = deferred<ManualPlanSnapshot | null>();
    const oldPlan = manualSnapshot(1);
    read.mockResolvedValueOnce({ data: [manualRow(1)], error: null })
      .mockResolvedValue({ data: [row(2, true)], error: null });
    readPlan.mockReturnValue(late.promise);
    const { result, rerender } = renderHook(({ tab }) => useLoadedLibrary(tab), {
      initialProps: { tab: "recents" as LibraryTab },
    });
    await waitFor(() => expect(readPlan).toHaveBeenCalledTimes(1));
    const lease = readPlan.mock.calls[0]?.[1];
    rerender({ tab: "saved" });
    expect(lease.signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.items[0]?.outcome.id).toBe(row(2).id));
    await act(async () => late.resolve(oldPlan));
    expect(result.current.items.map(item => item.outcome.id)).toEqual([row(2).id]);
  });

  it("turns a stalled manual lookup into a retryable library error at the shared deadline", async () => {
    vi.useFakeTimers();
    read.mockResolvedValue({ data: [manualRow(1)], error: null });
    readPlan.mockImplementation((_lookup, lease) => new Promise((_resolve, reject) => {
      lease.signal.addEventListener("abort", () => reject(new Error("private timeout")), { once: true });
    }));
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toMatch(/try again/i);
    expect(result.current.error).not.toContain("private");
    expect(readPlan.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });

  it("rejects A to B to A manual results even after returning to the original owner", async () => {
    const ownerA = auth.id;
    const late = deferred<ManualPlanSnapshot | null>();
    const oldPlan = manualSnapshot(1);
    read.mockResolvedValueOnce({ data: [manualRow(1)], error: null })
      .mockResolvedValue({ data: [], error: null });
    readPlan.mockReturnValueOnce(late.promise);
    const { result, rerender } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(readPlan).toHaveBeenCalledTimes(1));
    auth.id = "77777777-7777-4777-8777-777777777777";
    recordBrowserPrincipal(auth.id);
    rerender();
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    auth.id = ownerA;
    recordBrowserPrincipal(auth.id);
    read.mockResolvedValueOnce({ data: [manualRow(2)], error: null });
    readPlan.mockResolvedValueOnce(manualSnapshot(2));
    rerender();
    await waitFor(() => expect(result.current.items[0]?.manualPlan?.plan_id).toBe("manual:2"));
    await act(async () => late.resolve(oldPlan));
    expect(result.current.items[0]?.manualPlan?.plan_id).toBe("manual:2");
  });

  it("preserves outcome pagination and retries the same page after a manual read fails", async () => {
    const firstPage = [manualRow(1), ...Array.from({ length: 9 }, (_, index) => row(index + 2))];
    const responses = [firstPage, [manualRow(11)], [manualRow(11)]];
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) => resolve({ data: responses.shift(), error: null }),
    };
    read.mockImplementation((_lease, operation) => operation({ from: () => query }));
    readPlan.mockResolvedValueOnce(manualSnapshot(1)).mockRejectedValueOnce(new Error("private read failure"))
      .mockResolvedValueOnce(manualSnapshot(11));
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.items).toHaveLength(10));
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.load(); });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.error).toMatch(/try again/i);
    expect(result.current.error).not.toContain("private");
    await act(async () => { await result.current.load(); });
    expect(result.current.items).toHaveLength(11);
    expect(result.current.items[10]?.manualPlan?.title).toBe("Authoritative plan 11");
    expect(result.current.hasMore).toBe(false);
    expect(query.range.mock.calls).toEqual([[0, 9], [10, 19], [10, 19]]);
  });

  it("keeps manual bookmark changes on the existing outcome command and refresh path", async () => {
    read.mockResolvedValueOnce({ data: [manualRow(1)], error: null })
      .mockResolvedValueOnce({ data: [manualRow(1, true)], error: null });
    readPlan.mockResolvedValue(manualSnapshot(1));
    update.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLoadedLibrary("recents"));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.toggleSaved(row(1).id, false); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.slice(0, 2)).toEqual([row(1).id, { is_saved: true }]);
    expect(result.current.items[0]?.outcome.is_saved).toBe(true);
    expect(result.current.items[0]?.manualPlan?.title).toBe("Authoritative plan 1");
    expect(readPlan).toHaveBeenCalledTimes(2);
  });
});
