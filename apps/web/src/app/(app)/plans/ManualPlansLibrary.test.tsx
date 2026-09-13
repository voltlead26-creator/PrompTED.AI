import { useLayoutEffect } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManualPlanList, ManualPlanSummary } from "@prompted/shared";
import { recordBrowserPrincipal, type OwnerDispatchLease } from "@/lib/browser-principal-state";

const listRemoteManualPlansMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/manual-plans", () => ({ listRemoteManualPlans: listRemoteManualPlansMock }));

import { ManualPlansLibrary } from "./ManualPlansLibrary";
import { createManualPlan, saveManualPlan } from "./manual-plan-store";
import { MANUAL_PLAN_RECOVERY_RESOURCE, type ManualPlanRecovery } from "./manual-plan-recovery";
import { currentDeviceDataScope, readDeviceData, writeDeviceData } from "@/lib/owner-bound-device-store";

const OWNER = "71000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "71000000-0000-4000-8000-000000000002";
const RECOVERY = "74000000-0000-4000-8000-000000000001";
const OTHER_RECOVERY = "74000000-0000-4000-8000-000000000002";

function summary(index = 1, ownerId = OWNER): ManualPlanSummary {
  const suffix = String(index).padStart(12, "0");
  return {
    owner_id: ownerId, plan_id: `manual-plan:${index}`, title: `Account plan ${index}`,
    outcome_id: `72000000-0000-4000-8000-${suffix}`, artifact_id: `73000000-0000-4000-8000-${suffix}`,
    revision: 2, updated_at: "2026-09-13T01:02:03.123456Z", item_count: 7, completed_count: 3,
    next_due_date: "2026-09-20",
  };
}

function page(items: ManualPlanSummary[] = [], hasMore = false, ownerId = OWNER): ManualPlanList {
  return { contract_version: "manual-plan-list.1", owner_id: ownerId, items, has_more: hasMore };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function recovery(title: string): ManualPlanRecovery {
  return { version: 1, ownerId: OWNER, plan: { ...createManualPlan(), id: "one-shared-plan", title },
    expected: null, pending: null, dirty: true };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetAllMocks();
  recordBrowserPrincipal(OWNER);
  listRemoteManualPlansMock.mockImplementation(async (_options, lease: OwnerDispatchLease) => page([], false, lease.expectedUserId));
});

afterEach(() => {
  cleanup();
  recordBrowserPrincipal(undefined);
  vi.useRealTimers();
});

it("never renders the previous owner's titles during the layout before account hydration", async () => {
  saveManualPlan(currentDeviceDataScope(OWNER), { ...createManualPlan(), title: "A private title" });
  saveManualPlan(currentDeviceDataScope(OTHER_OWNER), { ...createManualPlan(), title: "B private title" });
  const layouts: string[] = [];
  function Probe({ owner }: { owner: string }) {
    useLayoutEffect(() => { layouts.push(document.body.textContent ?? ""); }, [owner]);
    return <ManualPlansLibrary ownerUserId={owner} />;
  }
  const view = render(<Probe owner={OWNER} />);
  expect(screen.getByText("A private title")).toBeInTheDocument();
  act(() => recordBrowserPrincipal(OTHER_OWNER));
  view.rerender(<Probe owner={OTHER_OWNER} />);
  expect(layouts.at(-1)).not.toContain("A private title");
  expect(screen.getByText("B private title")).toBeInTheDocument();
  await screen.findByText("No manual plans saved to your account yet.");
});

it("keeps guest plans on this device without dispatching an account request", () => {
  recordBrowserPrincipal(null);
  const plan = { ...createManualPlan(), title: "Guest action plan" };
  saveManualPlan(currentDeviceDataScope(), plan);
  render(<ManualPlansLibrary />);
  const region = screen.getByRole("region", { name: "Live plans saved on this device" });
  expect(within(region).getByRole("link", { name: /Guest action plan/ })).toHaveAttribute("href",
    `/plans?create=manual&plan=${encodeURIComponent(plan.id)}`);
  expect(listRemoteManualPlansMock).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Plans saved to your account" })).not.toBeInTheDocument();
});

it("uses authoritative account titles and counts, with a separate device-only legacy copy", async () => {
  const remote = { ...summary(), title: "  Delivery 日本語  " };
  listRemoteManualPlansMock.mockResolvedValue(page([remote]));
  saveManualPlan(currentDeviceDataScope(OWNER), { ...createManualPlan(), id: remote.plan_id, title: "Older device wording" });
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  const account = screen.getByRole("region", { name: "Plans saved to your account" });
  const link = await within(account).findByRole("link", { name: /Delivery 日本語/ });
  expect(link).toHaveAttribute("href", "/plans?create=manual&plan=manual-plan%3A1");
  expect(within(link).getByText("3 / 7 complete")).toBeInTheDocument();
  expect(link.querySelector("strong")?.textContent).toBe(remote.title);
  expect(within(account).queryByText("Older device wording")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Plan copies saved on this device" }))
    .getByText("Older device wording")).toBeInTheDocument();
  expect(listRemoteManualPlansMock).toHaveBeenCalledTimes(1);
  const [options, lease] = listRemoteManualPlansMock.mock.calls[0]!;
  expect(options).toEqual({ limit: 20, offset: 0 });
  expect(lease.expectedUserId).toBe(OWNER);
  expect(lease.signal.aborted).toBe(false);
  expect(() => lease.assertCurrent()).not.toThrow();
});

it("shows each owner-bound dirty recovery and opens its exact plan and recovery identity", async () => {
  const first = recovery("First tab wording");
  first.plan.items[0]!.dueDate = "2026-02-30";
  const second = recovery("Second tab wording");
  const scope = currentDeviceDataScope(OWNER);
  writeDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, RECOVERY, first);
  writeDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, OTHER_RECOVERY, second);
  writeDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, "invalid-key", recovery("Invalid key"));
  writeDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, "74000000-0000-4000-8000-000000000003",
    { ...recovery("Foreign owner"), ownerId: OTHER_OWNER });
  writeDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, "74000000-0000-4000-8000-000000000004",
    { ...recovery("Clean copy"), dirty: false });
  writeDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, "74000000-0000-4000-8000-000000000005",
    { ...recovery("Invalid pending"), pending: { operation_id: "unknown" } });
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  const recoveries = screen.getByRole("region", { name: "Unsaved recovery copies on this device" });
  expect(within(recoveries).getAllByRole("link")).toHaveLength(2);
  expect(within(recoveries).getByRole("link", { name: /First tab wording/ })).toHaveAttribute("href",
    `/plans?create=manual&plan=one-shared-plan&recovery=${RECOVERY}`);
  expect(within(recoveries).getByRole("link", { name: /Second tab wording/ })).toHaveAttribute("href",
    `/plans?create=manual&plan=one-shared-plan&recovery=${OTHER_RECOVERY}`);
  expect(within(recoveries).getAllByText("Changes saved only on this device")).toHaveLength(2);
  expect(screen.queryByText(/Foreign owner|Clean copy|Invalid pending|Invalid key/)).not.toBeInTheDocument();
  await screen.findByText("No manual plans saved to your account yet.");
});

it("requires explicit review to import guest copies and never coerces a malformed guest draft", async () => {
  const guestScope = currentDeviceDataScope();
  const plan = { ...createManualPlan(), id: "guest-plan:1", title: "Guest wording" };
  writeDeviceData(guestScope, "manual-plan", plan.id, plan);
  writeDeviceData(guestScope, "manual-plan", "guest-invalid", {
    ...plan, id: "guest-invalid", title: "Malformed guest", items: [{ ...plan.items[0], done: "false" }],
  });
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  const region = screen.getByRole("region", { name: "Guest plans on this device" });
  expect(within(region).getByRole("link", { name: /Guest wording.*Review and save to my account/ }))
    .toHaveAttribute("href", "/plans?create=manual&plan=guest-plan%3A1&import=guest");
  expect(screen.queryByText("Malformed guest")).not.toBeInTheDocument();
  expect(readDeviceData(guestScope, "manual-plan", plan.id, (value): value is unknown => value !== null)).toEqual(plan);
  await screen.findByText("No manual plans saved to your account yet.");
});

it("paginates in groups of 20 and retains authoritative counts for both pages", async () => {
  listRemoteManualPlansMock.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, index) => summary(index + 1)), true))
    .mockResolvedValueOnce(page([summary(21)]));
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more account plans" }));
  await screen.findByText("Account plan 21");
  expect(listRemoteManualPlansMock.mock.calls[1]?.[0]).toEqual({ limit: 20, offset: 20 });
  expect(within(screen.getByRole("region", { name: "Plans saved to your account" })).getAllByRole("link")).toHaveLength(21);
  expect(screen.queryByRole("button", { name: "Load more account plans" })).not.toBeInTheDocument();
});

it("restarts the list on retry after a failed page without exposing server diagnostics", async () => {
  listRemoteManualPlansMock.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, index) => summary(index + 1)), true))
    .mockRejectedValueOnce(new Error("private database detail and bearer token"))
    .mockResolvedValueOnce(page([summary(2)]));
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more account plans" }));
  const retry = await screen.findByRole("button", { name: "Retry account plans" });
  expect(screen.getByText("Account plan 1")).toBeInTheDocument();
  expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
  fireEvent.click(retry);
  await screen.findByText("Account plan 2");
  expect(listRemoteManualPlansMock.mock.calls[2]?.[0]).toEqual({ limit: 20, offset: 0 });
  expect(screen.queryByText("Account plan 1")).not.toBeInTheDocument();
});

it.each([
  ["foreign owner", page([summary(1, OTHER_OWNER)], false, OTHER_OWNER)],
  ["invalid count", page([{ ...summary(), completed_count: 8 }])],
  ["partial page claiming more", page([summary()], true)],
  ["duplicate identity", page([summary(), summary()])],
  ["malformed envelope", { items: [] }],
])("rejects %s instead of displaying an account save", async (_label, value) => {
  listRemoteManualPlansMock.mockResolvedValue(value);
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  await screen.findByRole("button", { name: "Retry account plans" });
  expect(screen.queryByText("Account plan 1")).not.toBeInTheDocument();
  expect(screen.queryByText("No manual plans saved to your account yet.")).not.toBeInTheDocument();
});

it("rejects duplicate identities across pages and offers a fresh list", async () => {
  listRemoteManualPlansMock.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, index) => summary(index + 1)), true))
    .mockResolvedValueOnce(page([summary(20)]));
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more account plans" }));
  await screen.findByRole("button", { name: "Retry account plans" });
  expect(screen.getAllByText("Account plan 20")).toHaveLength(1);
});

it("clears account results on A to B to A and ignores the retired request", async () => {
  const late = deferred<ManualPlanList>();
  listRemoteManualPlansMock.mockReturnValueOnce(late.promise).mockResolvedValueOnce(page([summary(2)]));
  render(<ManualPlansLibrary ownerUserId={OWNER} />);
  const original = listRemoteManualPlansMock.mock.calls[0]?.[1] as OwnerDispatchLease;
  act(() => { recordBrowserPrincipal(OTHER_OWNER); recordBrowserPrincipal(OWNER); });
  expect(original.signal.aborted).toBe(true);
  await act(async () => { late.resolve(page([summary()])); });
  expect(screen.queryByText("Account plan 1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry account plans" }));
  await screen.findByText("Account plan 2");
  const retry = listRemoteManualPlansMock.mock.calls[1]?.[1] as OwnerDispatchLease;
  expect(retry.principalEpoch).not.toBe(original.principalEpoch);
  act(() => recordBrowserPrincipal(OTHER_OWNER));
  expect(screen.queryByText("Account plan 2")).not.toBeInTheDocument();
});

it("bounds an unresponsive request, ignores late success and cancels on unmount", async () => {
  vi.useFakeTimers();
  const late = deferred<ManualPlanList>();
  listRemoteManualPlansMock.mockReturnValueOnce(late.promise).mockReturnValueOnce(new Promise(() => {}));
  const view = render(<ManualPlansLibrary ownerUserId={OWNER} />);
  const original = listRemoteManualPlansMock.mock.calls[0]?.[1] as OwnerDispatchLease;
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(original.signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Retry account plans" })).toBeInTheDocument();
  await act(async () => { late.resolve(page([summary()])); });
  expect(screen.queryByText("Account plan 1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry account plans" }));
  const retry = listRemoteManualPlansMock.mock.calls[1]?.[1] as OwnerDispatchLease;
  expect(retry.signal.aborted).toBe(false);
  view.unmount();
  expect(retry.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
