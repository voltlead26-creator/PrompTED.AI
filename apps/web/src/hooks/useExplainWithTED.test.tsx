import { act, renderHook } from "@testing-library/react";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const state = vi.hoisted(() => ({ userId: "33333333-3333-4333-8333-333333333333" }));
const request = vi.hoisted(() => vi.fn());
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock("@/lib/api", () => ({ ensureApiConfigured: vi.fn() }));
vi.mock("@prompted/shared/api-client", () => ({ explainSection: request }));
import { useExplainWithTED } from "./useExplainWithTED";

const answer = { title: "Meaning", plain_english: "A reply is requested.", why_it_matters: [], what_to_watch: [], missing_or_risky: [], suggested_next_step: null };

beforeEach(() => { request.mockReset(); state.userId = "33333333-3333-4333-8333-333333333333"; recordBrowserPrincipal(state.userId); });

describe("Explanation lifetime", () => {
  it("rejects a reply for previous wording and resets its history key", async () => {
    let resolve!: (value: typeof answer) => void;
    request.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const { result, rerender } = renderHook(({ scope }) => useExplainWithTED(scope), { initialProps: { scope: "section-a:wording-1" } });
    const oldKey = result.current.contextKey;
    let pending!: ReturnType<typeof result.current.run>;
    act(() => { pending = result.current.run({ content: "Previous wording" }); });
    const call = request.mock.calls[0];
    assert(call, "The explanation request must have been dispatched");
    const context = call[1];
    rerender({ scope: "section-a:wording-2" });
    expect(context.signal.aborted).toBe(true);
    expect(result.current.contextKey).not.toBe(oldKey);
    await act(async () => { resolve(answer); await pending; });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it("cancellation clears the request without showing a late failure", async () => {
    let reject!: (reason: Error) => void;
    request.mockImplementation(() => new Promise((_yes, no) => { reject = no; }));
    const { result } = renderHook(() => useExplainWithTED());
    let pending!: ReturnType<typeof result.current.run>;
    act(() => { pending = result.current.run({ content: "Document" }); });
    act(() => result.current.cancel());
    await act(async () => { reject(new Error("Late network failure")); await pending; });
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it("does not let an older response replace a newer explanation", async () => {
    const resolve: Array<(value: typeof answer) => void> = [];
    request.mockImplementation(() => new Promise((yes) => resolve.push(yes)));
    const { result } = renderHook(() => useExplainWithTED());
    let first!: ReturnType<typeof result.current.run>;
    let second!: ReturnType<typeof result.current.run>;
    act(() => { first = result.current.run({ content: "Old" }); });
    act(() => { second = result.current.run({ content: "New" }); });
    const [resolveFirst, resolveSecond] = resolve;
    assert(resolveFirst && resolveSecond, "Both explanation requests must be pending");
    await act(async () => { resolveSecond({ ...answer, title: "New" }); await second; });
    await act(async () => { resolveFirst({ ...answer, title: "Old" }); await first; });
    expect(result.current.result?.title).toBe("New");
  });

  it("aborts and clears the response when its owner changes", async () => {
    request.mockResolvedValue(answer);
    const { result, rerender } = renderHook(() => useExplainWithTED());
    await act(async () => { await result.current.run({ content: "Private wording" }); });
    expect(result.current.result).toEqual(answer);
    state.userId = "77777777-7777-4777-8777-777777777777";
    recordBrowserPrincipal(state.userId);
    rerender();
    expect(result.current.result).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it("aborts the active request when the editor unmounts", () => {
    request.mockImplementation(() => new Promise(() => {}));
    const { result, unmount } = renderHook(() => useExplainWithTED());
    act(() => { void result.current.run({ content: "Document" }); });
    const call = request.mock.calls[0];
    assert(call, "The explanation request must have been dispatched");
    const context = call[1];
    unmount();
    expect(context.signal.aborted).toBe(true);
  });
});
