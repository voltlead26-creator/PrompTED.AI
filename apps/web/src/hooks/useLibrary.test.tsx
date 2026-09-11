import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import type { LibraryTab } from "./useLibrary";

const auth = vi.hoisted(() => ({ id: "33333333-3333-4333-8333-333333333333", loading: false }));
const read = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: auth.id }, loading: auth.loading }),
}));
vi.mock("@/lib/api/outcomes", () => ({ updateOutcome: update }));
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
    expect(query.select.mock.calls[0]?.[0]).not.toMatch(
      /recommendation_payload|content|version_history/,
    );
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
