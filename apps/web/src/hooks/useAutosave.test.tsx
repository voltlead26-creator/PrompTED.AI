import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

describe("useAutosave owner epoch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordBrowserPrincipal(undefined);
  });

  afterEach(() => {
    recordBrowserPrincipal(undefined);
    vi.useRealTimers();
  });

  it("discards a pending prior-owner value when the authenticated owner changes", () => {
    const saveA = vi.fn();
    const saveB = vi.fn();
    recordBrowserPrincipal("user-a");
    const hook = renderHook(
      ({ value, save, ownerEpoch }) => useAutosave(value, save, 500, ownerEpoch),
      {
        initialProps: { value: "A0", save: saveA, ownerEpoch: "user:user-a" },
      },
    );

    hook.rerender({ value: "A1", save: saveA, ownerEpoch: "user:user-a" });
    recordBrowserPrincipal("user-b");
    hook.rerender({ value: "B0", save: saveB, ownerEpoch: "user:user-b" });
    act(() => vi.advanceTimersByTime(1_000));
    hook.unmount();

    expect(saveA).not.toHaveBeenCalled();
    expect(saveB).not.toHaveBeenCalled();
  });

  it("still debounces and flushes edits while the owner epoch is unchanged", () => {
    const save = vi.fn();
    recordBrowserPrincipal("user-a");
    const hook = renderHook(
      ({ value }) => useAutosave(value, save, 500, "user:user-a"),
      { initialProps: { value: "A0" } },
    );

    hook.rerender({ value: "A1" });
    act(() => vi.advanceTimersByTime(500));
    expect(save).toHaveBeenCalledWith(
      "A1",
      expect.objectContaining({ expectedUserId: "user-a" }),
    );

    hook.rerender({ value: "A2" });
    hook.unmount();
    expect(save).toHaveBeenLastCalledWith(
      "A2",
      expect.objectContaining({ expectedUserId: "user-a" }),
    );
  });

  it("discards a pending unmount flush after the provider records a newer principal", () => {
    const saveA = vi.fn();
    recordBrowserPrincipal("user-a");
    const hook = renderHook(
      ({ value }) => useAutosave(value, saveA, 500, "user:user-a"),
      { initialProps: { value: "A0" } },
    );

    hook.rerender({ value: "A1" });
    recordBrowserPrincipal("user-b");
    hook.unmount();
    act(() => vi.advanceTimersByTime(1_000));

    expect(saveA).not.toHaveBeenCalled();
  });

  it("does not revive a scheduled A save after an A to B to A transition", () => {
    const saveA = vi.fn();
    recordBrowserPrincipal("user-a");
    const hook = renderHook(
      ({ value }) => useAutosave(value, saveA, 500, "user:user-a"),
      { initialProps: { value: "A0" } },
    );

    hook.rerender({ value: "A1" });
    recordBrowserPrincipal("user-b");
    recordBrowserPrincipal("user-a");
    act(() => vi.advanceTimersByTime(500));

    expect(saveA).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("keeps the default local editor debounce functional without auth", () => {
    const save = vi.fn();
    const hook = renderHook(
      ({ value }) => useAutosave(value, save, 500),
      { initialProps: { value: "local-0" } },
    );

    hook.rerender({ value: "local-1" });
    act(() => vi.advanceTimersByTime(500));

    expect(save).toHaveBeenCalledWith("local-1", null);
    hook.unmount();
  });

  it("discards a scheduled value when a same-owner authoritative mutation advances", () => {
    const save = vi.fn();
    recordBrowserPrincipal("user-a");
    const hook = renderHook(
      ({ value, mutationEpoch }) =>
        useAutosave(value, save, 500, "user:user-a", mutationEpoch),
      { initialProps: { value: "draft-0", mutationEpoch: 0 } },
    );

    hook.rerender({ value: "stale-draft", mutationEpoch: 0 });
    hook.rerender({ value: "server-revision", mutationEpoch: 1 });
    act(() => vi.advanceTimersByTime(1_000));

    expect(save).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("does not flush a pre-mutation value on unmount but saves later edits", () => {
    const save = vi.fn();
    recordBrowserPrincipal("user-a");
    const hook = renderHook(
      ({ value, mutationEpoch }) =>
        useAutosave(value, save, 500, "user:user-a", mutationEpoch),
      { initialProps: { value: "draft-0", mutationEpoch: 0 } },
    );

    hook.rerender({ value: "stale-draft", mutationEpoch: 0 });
    hook.rerender({ value: "server-revision", mutationEpoch: 1 });
    hook.rerender({ value: "new-local-edit", mutationEpoch: 1 });
    act(() => vi.advanceTimersByTime(500));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      "new-local-edit",
      expect.objectContaining({ expectedUserId: "user-a" }),
    );
    hook.unmount();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
