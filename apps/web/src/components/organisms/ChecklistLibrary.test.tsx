import { useLayoutEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChecklistItem } from "@prompted/shared";
import { recordBrowserPrincipal, type OwnerDispatchLease } from "@/lib/browser-principal-state";
import { currentDeviceDataScope } from "@/lib/owner-bound-device-store";
import { markLocalChecklistSaved, saveLocalChecklist } from "@/lib/local-checklist-store";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/owner-client", () => ({ withOwnerSupabase: withOwnerSupabaseMock }));
import { ChecklistLibrary } from "./ChecklistLibrary";

const OWNER = "81000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "81000000-0000-4000-8000-000000000002";
const OUTCOME = "82000000-0000-4000-8000-000000000001";
const MANUAL_OUTCOME = "82000000-0000-4000-8000-000000000002";

function item(index = 1, outcomeId = OUTCOME, ownerId = OWNER) {
  return { id: `83000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    user_id: ownerId, outcome_id: outcomeId, done: index % 2 === 0 };
}
function outcome(id = OUTCOME, ownerId = OWNER) {
  return { id, user_id: ownerId, situation_text: "Original situation", is_saved: true,
    recommendation_payload: { primary: { reason: "Generated action plan" } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
type Response = { data: unknown; error: unknown };
type ReadHandler = (table: string, signal: AbortSignal) => Promise<Response>;
interface FakeQuery {
  select(value: string): FakeQuery;
  eq(key: string, value: unknown): FakeQuery;
  in(key: string, value: unknown): FakeQuery;
  abortSignal(signal: AbortSignal): Promise<Response>;
}

function installRead(handler: ReadHandler = async table => ({
  data: table === "checklist_items" ? [item(1), item(2)] : [outcome()], error: null,
})) {
  const calls: Array<{ table: string; select: string; filters: Array<[string, unknown]>; signal: AbortSignal }> = [];
  const from = vi.fn((table: string) => {
    let selection = "";
    const filters: Array<[string, unknown]> = [];
    const query: FakeQuery = {
      select(value: string) { selection = value; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      in(key: string, value: unknown) { filters.push([key, value]); return query; },
      abortSignal(signal: AbortSignal) { calls.push({ table, select: selection, filters, signal }); return handler(table, signal); },
    };
    return query;
  });
  withOwnerSupabaseMock.mockImplementation(async (
    lease: OwnerDispatchLease, operation: (client: { from: typeof from }) => Promise<unknown>,
  ) => { lease.assertCurrent(); return operation({ from }); });
  return { calls, from };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  recordBrowserPrincipal(OWNER);
});
afterEach(() => {
  cleanup();
  recordBrowserPrincipal(undefined);
  vi.useRealTimers();
});

it("keeps the guest checklist route and local completion state without an account read", () => {
  recordBrowserPrincipal(null);
  const scope = currentDeviceDataScope();
  const local: ChecklistItem = { ...item(2), user_id: "", text: "Guest action", due_date: null, reason: null,
    reminder_offset_days: null, reminder_sent: false, order_index: 0,
    created_at: "2026-09-13T01:02:03Z", updated_at: "2026-09-13T01:02:03Z" };
  saveLocalChecklist(scope, OUTCOME, [local]);
  markLocalChecklistSaved(scope, OUTCOME);
  render(<ChecklistLibrary />);
  expect(screen.getByRole("link", { name: /Saved checklist or action plan/ }))
    .toHaveAttribute("href", `/outcomes/${OUTCOME}/checklist`);
  expect(screen.getByText("1 / 1")).toBeInTheDocument();
  expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
});

it("validates owned saved rows, excludes manual routing markers and retains the legacy checklist route", async () => {
  const { calls } = installRead(async table => ({ data: table === "checklist_items" ?
    [item(1), item(2), item(3, MANUAL_OUTCOME)] : [outcome(), {
      ...outcome(MANUAL_OUTCOME), situation_text: "Manual action plan",
      recommendation_payload: { manual_plan: { contract_version: "manual-plan.1", plan_id: "manual:1" } },
    }], error: null }));
  render(<ChecklistLibrary userId={OWNER} />);
  expect(await screen.findByRole("link", { name: /Generated action plan/ })).toHaveAttribute("href", `/outcomes/${OUTCOME}/checklist`);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.queryByText("Manual action plan")).not.toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.select).toBe("id, user_id, outcome_id, done");
  expect(calls[0]?.filters).toEqual([["user_id", OWNER]]);
  expect(calls[1]?.select).toBe("id, user_id, situation_text, recommendation_payload, is_saved");
  expect(calls[1]?.filters).toEqual([["id", [OUTCOME, MANUAL_OUTCOME]], ["is_saved", true], ["user_id", OWNER]]);
  const lease = withOwnerSupabaseMock.mock.calls[0]?.[0] as OwnerDispatchLease;
  expect(calls.every(call => call.signal === lease.signal)).toBe(true);
  expect(lease.expectedUserId).toBe(OWNER);
});

it.each([
  ["wrong version", { manual_plan: { contract_version: "manual-plan.2", plan_id: "manual:1" } }],
  ["missing identity", { manual_plan: { contract_version: "manual-plan.1" } }],
  ["invalid identity", { manual_plan: { contract_version: "manual-plan.1", plan_id: "unsafe/id" } }],
  ["null marker", { manual_plan: null }],
  ["extra outer content", { manual_plan: { contract_version: "manual-plan.1", plan_id: "manual:1" }, primary: { reason: "Misrouted manual" } }],
  ["editable content in marker", { manual_plan: { contract_version: "manual-plan.1", plan_id: "manual:1", title: "Misrouted manual" } }],
])("blocks a %s manual marker rather than sending the user to a checklist editor", async (_label, marker) => {
  installRead(async table => ({ data: table === "checklist_items" ? [item()] : [{ ...outcome(), recommendation_payload: marker }], error: null }));
  render(<ChecklistLibrary userId={OWNER} />);
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByText("Saved checklists and action plans will appear here.")).not.toBeInTheDocument();
});

it.each([
  ["foreign checklist owner", [item(1, OUTCOME, OTHER_OWNER)], [outcome()]],
  ["non-boolean completion", [{ ...item(), done: "false" }], [outcome()]],
  ["duplicate checklist identity", [item(), item()], [outcome()]],
  ["missing checklist data", null, [outcome()]],
  ["invalid outcome identity", [{ ...item(), outcome_id: "../../elsewhere" }], [outcome()]],
  ["foreign outcome owner", [item()], [outcome(OUTCOME, OTHER_OWNER)]],
  ["unrequested outcome", [item()], [outcome(MANUAL_OUTCOME)]],
  ["unsaved outcome", [item()], [{ ...outcome(), is_saved: false }]],
  ["duplicate outcome", [item()], [outcome(), outcome()]],
  ["invalid title boundary", [item()], [{ ...outcome(), recommendation_payload: { primary: { reason: {} } } }]],
  ["missing outcome data", [item()], null],
])("rejects %s without producing misleading counts or navigation", async (_label, rows, outcomes) => {
  installRead(async table => ({ data: table === "checklist_items" ? rows : outcomes, error: null }));
  render(<ChecklistLibrary userId={OWNER} />);
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("distinguishes a real empty library from a failed read and retries without server diagnostics", async () => {
  let failed = true;
  installRead(async () => failed ? { data: null, error: { message: "private bearer and SQL text" } } : { data: [], error: null });
  render(<ChecklistLibrary userId={OWNER} />);
  const retry = await screen.findByRole("button", { name: "Try again" });
  failed = false;
  fireEvent.click(retry);
  await screen.findByText("Saved checklists and action plans will appear here.");
  expect(screen.queryByText(/private bearer/)).not.toBeInTheDocument();
  expect(withOwnerSupabaseMock).toHaveBeenCalledTimes(2);
});

it("rejects a retired A to B to A request before dispatching its second query", async () => {
  const old = deferred<Response>();
  const { calls } = installRead(async () => old.promise);
  render(<ChecklistLibrary userId={OWNER} />);
  const lease = withOwnerSupabaseMock.mock.calls[0]?.[0] as OwnerDispatchLease;
  act(() => { recordBrowserPrincipal(OTHER_OWNER); recordBrowserPrincipal(OWNER); });
  expect(lease.signal.aborted).toBe(true);
  await act(async () => { old.resolve({ data: [item()], error: null }); });
  expect(calls).toHaveLength(1);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("hides a previous owner's completed results in the layout before new account hydration", async () => {
  installRead();
  const layouts: string[] = [];
  function Probe({ owner }: { owner: string }) {
    useLayoutEffect(() => { layouts.push(document.body.textContent ?? ""); }, [owner]);
    return <ChecklistLibrary userId={owner} />;
  }
  const view = render(<Probe owner={OWNER} />);
  await screen.findByText("Generated action plan");
  withOwnerSupabaseMock.mockReturnValue(new Promise(() => {}));
  act(() => recordBrowserPrincipal(OTHER_OWNER));
  view.rerender(<Probe owner={OTHER_OWNER} />);
  expect(layouts.at(-1)).not.toContain("Generated action plan");
  expect(screen.queryByText("Generated action plan")).not.toBeInTheDocument();
});

it("times out an unresponsive read, ignores late data and aborts the retry on unmount", async () => {
  vi.useFakeTimers();
  const old = deferred<Response>();
  const { calls } = installRead(async () => old.promise);
  const view = render(<ChecklistLibrary userId={OWNER} />);
  const first = withOwnerSupabaseMock.mock.calls[0]?.[0] as OwnerDispatchLease;
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(first.signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  await act(async () => { old.resolve({ data: [item()], error: null }); });
  expect(calls).toHaveLength(1);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  withOwnerSupabaseMock.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const retry = withOwnerSupabaseMock.mock.calls[1]?.[0] as OwnerDispatchLease;
  expect(retry.signal.aborted).toBe(false);
  view.unmount();
  expect(retry.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
