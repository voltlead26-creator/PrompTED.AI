import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedChecklistItem } from "@prompted/shared";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

interface QueryResult {
  data?: unknown;
  error?: unknown;
}

const USER_A = "a1000000-0000-4000-8000-000000000001";
const OUTCOME_A = "a2000000-0000-4000-8000-000000000001";
const OUTCOME_B = "a2000000-0000-4000-8000-000000000002";
const ITEM_A = "a3000000-0000-4000-8000-000000000001";
const ITEM_A_2 = "a3000000-0000-4000-8000-000000000002";
const ITEM_B = "a3000000-0000-4000-8000-000000000003";
const TOKEN_1 = "a4000000-0000-4000-8000-000000000001";
const TOKEN_2 = "a4000000-0000-4000-8000-000000000002";
const TOKEN_3 = "a4000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "a1000000-0000-4000-8000-000000000001" } as { id: string } | null,
    loading: false,
  },
  results: [] as Array<Promise<QueryResult> | QueryResult>,
  operations: [] as Array<{
    table: string;
    kind: "select" | null;
    filters: Array<[string, unknown]>;
  }>,
  updateOwnChecklistItem: vi.fn(),
}));

vi.mock("@/components/providers", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: async (_lease: unknown, operation: (client: unknown) => unknown) =>
    await operation({
    from: (table: string) => {
      const operation = {
        table,
        kind: null as "select" | null,
        filters: [] as Array<[string, unknown]>,
      };
      mocks.operations.push(operation);
      const builder = {
        select() {
          operation.kind = "select";
          return builder;
        },
        eq(column: string, value: unknown) {
          operation.filters.push([column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        then(resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(mocks.results.shift() ?? { data: [], error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return builder;
    },
    }),
}));
vi.mock("@/lib/api/checklists", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/checklists")>(
    "@/lib/api/checklists",
  );
  return { ...actual, updateOwnChecklistItem: mocks.updateOwnChecklistItem };
});

import { useChecklist } from "./useChecklist";

function item(
  outcomeId: string,
  options: {
    id?: string;
    token?: string;
    done?: boolean;
    text?: string;
    order?: number;
  } = {},
): PersistedChecklistItem {
  const id = options.id ?? (outcomeId === OUTCOME_A ? ITEM_A : ITEM_B);
  return {
    id,
    outcome_id: outcomeId,
    user_id: USER_A,
    text: options.text ?? `Task for ${outcomeId}`,
    due_date: null,
    reason: null,
    done: options.done ?? false,
    reminder_offset_days: null,
    reminder_sent: false,
    order_index: options.order ?? 0,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    mutation_token: options.token ?? TOKEN_1,
  };
}

function committed(next: PersistedChecklistItem) {
  return { status: "committed" as const, affectedRows: 1 as const, item: next };
}

describe("useChecklist durable truth", () => {
  beforeEach(() => {
    recordBrowserPrincipal(USER_A);
    mocks.auth = { user: { id: USER_A }, loading: false };
    mocks.results.length = 0;
    mocks.operations.length = 0;
    mocks.updateOwnChecklistItem.mockReset();
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("does not turn a signed read failure into an authoritative empty checklist", async () => {
    mocks.results.push({ data: null, error: new Error("offline") });
    const { result } = renderHook(() => useChecklist(OUTCOME_A));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toMatch(/could not confirm this checklist's saved revision/i);
    expect(mocks.operations[0]?.filters).toEqual([
      ["outcome_id", OUTCOME_A],
      ["user_id", USER_A],
    ]);
  });

  it("fails closed when the hosted row lacks its opaque mutation token", async () => {
    const missingToken = { ...item(OUTCOME_A) } as Partial<PersistedChecklistItem>;
    delete missingToken.mutation_token;
    mocks.results.push({ data: [missingToken], error: null });
    const { result } = renderHook(() => useChecklist(OUTCOME_A));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toMatch(/saved revision/i);
  });

  it("reconciles a lost toggle response instead of claiming a stale rollback", async () => {
    const initial = item(OUTCOME_A);
    const authoritative = item(OUTCOME_A, { token: TOKEN_2, done: false });
    mocks.results.push(
      { data: [initial], error: null },
      { data: [authoritative], error: null },
    );
    mocks.updateOwnChecklistItem.mockRejectedValue(new Error("response lost"));
    const { result } = renderHook(() => useChecklist(OUTCOME_A));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.toggleDone(ITEM_A);
    });

    expect(result.current.items[0]).toEqual(authoritative);
    expect(result.current.saveError).toMatch(/latest saved version is shown/i);
    expect(mocks.updateOwnChecklistItem).toHaveBeenCalledWith(
      {
        itemId: ITEM_A,
        outcomeId: OUTCOME_A,
        expectedMutationToken: TOKEN_1,
        expectedUserId: USER_A,
        done: true,
      },
      expect.objectContaining({ expectedUserId: USER_A }),
    );
  });

  it("uses the authoritative committed row and exposes a disabled-item boundary", async () => {
    const initial = item(OUTCOME_A);
    let resolveMutation!: (value: ReturnType<typeof committed>) => void;
    mocks.results.push({ data: [initial], error: null });
    mocks.updateOwnChecklistItem.mockReturnValue(
      new Promise<ReturnType<typeof committed>>((resolve) => {
        resolveMutation = resolve;
      }),
    );
    const { result } = renderHook(() => useChecklist(OUTCOME_A));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    let first!: Promise<void>;
    act(() => {
      first = result.current.toggleDone(ITEM_A);
    });
    expect(result.current.isSavingItem(ITEM_A)).toBe(true);
    expect(result.current.savingItemIds).toEqual([ITEM_A]);
    await act(async () => {
      await result.current.toggleDone(ITEM_A);
    });
    expect(mocks.updateOwnChecklistItem).toHaveBeenCalledTimes(1);

    const authoritative = item(OUTCOME_A, { token: TOKEN_2, done: true });
    await act(async () => {
      resolveMutation(committed(authoritative));
      await first;
    });
    expect(result.current.items[0]).toEqual(authoritative);
    expect(result.current.isSavingItem(ITEM_A)).toBe(false);
  });

  it("shows the authoritative conflict row instead of restoring captured stale state", async () => {
    const initial = item(OUTCOME_A);
    const current = item(OUTCOME_A, {
      token: TOKEN_2,
      done: true,
      text: "Changed in another tab",
    });
    mocks.results.push({ data: [initial], error: null });
    mocks.updateOwnChecklistItem.mockResolvedValue({
      status: "revision_conflict",
      affectedRows: 0,
      item: current,
    });
    const { result } = renderHook(() => useChecklist(OUTCOME_A));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.toggleDone(ITEM_A);
    });

    expect(result.current.items[0]).toEqual(current);
    expect(result.current.saveError).toMatch(/changed elsewhere/i);
    expect(result.current.error).toBeNull();
  });

  it("keeps independently saving items visible until each exact response finishes", async () => {
    const firstItem = item(OUTCOME_A);
    const secondItem = item(OUTCOME_A, { id: ITEM_A_2, token: TOKEN_2, order: 1 });
    mocks.results.push({ data: [firstItem, secondItem], error: null });
    const resolvers = new Map<string, (value: ReturnType<typeof committed>) => void>();
    mocks.updateOwnChecklistItem.mockImplementation(({ itemId }: { itemId: string }) =>
      new Promise((resolve) => resolvers.set(itemId, resolve))
    );
    const { result } = renderHook(() => useChecklist(OUTCOME_A));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.toggleDone(ITEM_A);
      second = result.current.toggleDone(ITEM_A_2);
    });
    expect(new Set(result.current.savingItemIds)).toEqual(new Set([ITEM_A, ITEM_A_2]));

    await act(async () => {
      resolvers.get(ITEM_A)?.(committed(item(OUTCOME_A, { token: TOKEN_3, done: true })));
      await first;
    });
    expect(result.current.isSavingItem(ITEM_A)).toBe(false);
    expect(result.current.isSavingItem(ITEM_A_2)).toBe(true);

    await act(async () => {
      resolvers.get(ITEM_A_2)?.(
        committed(item(OUTCOME_A, { id: ITEM_A_2, token: TOKEN_3, done: true, order: 1 })),
      );
      await second;
    });
    expect(result.current.savingItemIds).toEqual([]);
  });

  it("reports wording save status as unconfirmed when response and reconciliation fail", async () => {
    mocks.results.push(
      { data: [item(OUTCOME_A)], error: null },
      { data: null, error: new Error("still offline") },
    );
    mocks.updateOwnChecklistItem.mockRejectedValue(new Error("response lost"));
    const { result } = renderHook(() => useChecklist(OUTCOME_A));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await expect(result.current.updateText(ITEM_A, "Revised task")).rejects.toThrow(
        "response lost",
      );
    });
    expect(result.current.items[0]?.text).toBe("Revised task");
    expect(result.current.saveError).toMatch(/could not confirm whether that wording saved/i);
  });

  it("never lets a delayed outcome-A load replace outcome B", async () => {
    let resolveA!: (value: QueryResult) => void;
    mocks.results.push(new Promise((resolve) => { resolveA = resolve; }));
    mocks.results.push({ data: [item(OUTCOME_B)], error: null });
    const { result, rerender } = renderHook(
      ({ outcomeId }) => useChecklist(outcomeId),
      { initialProps: { outcomeId: OUTCOME_A } },
    );

    rerender({ outcomeId: OUTCOME_B });
    await waitFor(() => expect(result.current.items[0]?.outcome_id).toBe(OUTCOME_B));
    await act(async () => {
      resolveA({ data: [item(OUTCOME_A)], error: null });
      await Promise.resolve();
    });
    expect(result.current.items[0]?.outcome_id).toBe(OUTCOME_B);
  });
});
