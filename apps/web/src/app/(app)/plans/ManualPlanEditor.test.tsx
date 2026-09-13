import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualPlanSnapshot } from "@prompted/shared";
import { ManualPlanEditor } from "./ManualPlanEditor";
import { createManualPlan, createManualPlanItem, listManualPlans, loadManualPlan, saveManualPlan, type ManualPlanState } from "./manual-plan-store";
import { currentDeviceDataScope, writeDeviceData } from "@/lib/owner-bound-device-store";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const editor = vi.hoisted(() => ({
  run: vi.fn(),
  streaming: false,
  draft: "",
  error: null as string | null,
  cancel: vi.fn(),
}));

const persistenceApi = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/api/manual-plans", () => ({ readManualPlan: persistenceApi.read, saveManualPlanCommand: persistenceApi.save }));

vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => editor,
}));

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "44444444-4444-4444-8444-444444444444";

function accountSnapshot(plan: ManualPlanState, ownerId = ownerA): ManualPlanSnapshot {
  return {
    contract_version: "manual-plan.1", owner_id: ownerId, plan_id: plan.id,
    outcome_id: ownerId === ownerA ? "22222222-2222-4222-8222-222222222222" : "55555555-5555-4555-8555-555555555555",
    artifact_id: ownerId === ownerA ? "33333333-3333-4333-8333-333333333333" : "66666666-6666-4666-8666-666666666666",
    revision: 1, created_at: "2026-09-13T00:00:00.000001Z", updated_at: "2026-09-13T00:00:01.000001Z",
    title: plan.title,
    items: plan.items.map(item => ({ id: item.id, section: item.section, text: item.text,
      notes: item.notes, due_date: item.dueDate || null, done: item.done })),
  };
}

describe("ManualPlanEditor recovery controls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/plans?create=manual");
    vi.clearAllMocks();
    recordBrowserPrincipal(null);
    persistenceApi.read.mockResolvedValue(null);
    persistenceApi.save.mockRejectedValue(new Error("MANUAL_PLAN_SAVE_UNCONFIRMED"));
    editor.run.mockResolvedValue({
      content: "Contact the supplier and confirm the delivery date.",
      changes: [],
    });
  });

  it("regression: preserves every field when the editor unmounts immediately after an edit", () => {
    const page = render(<ManualPlanEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Plan title" }), { target: { value: "  Exact title  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "  Call Renée\n日本語  " } });
    fireEvent.change(screen.getByLabelText("Section / phase"), { target: { value: " Before " } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "  Keep\nthese notes  " } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-09-15" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark action 1 complete" }));
    page.unmount();
    const [saved] = listManualPlans(currentDeviceDataScope());
    expect(saved?.title).toBe("  Exact title  ");
    expect(saved?.items[0]).toMatchObject({ text: "  Call Renée\n日本語  ", section: " Before ", notes: "  Keep\nthese notes  ", dueDate: "2026-09-15", done: true });
  });

  it("regression: gives a new saved plan a stable URL and reopens that exact plan", () => {
    const page = render(<ManualPlanEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Reopen me" } });
    const id = new URLSearchParams(window.location.search).get("plan");
    expect(id).toBeTruthy();
    page.unmount();
    render(<ManualPlanEditor planId={id} />);
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Reopen me");
    expect(listManualPlans(currentDeviceDataScope())).toHaveLength(1);
  });

  it("regression: reports a missing or foreign plan instead of creating a replacement", async () => {
    const privatePlan = createManualPlan();
    saveManualPlan(currentDeviceDataScope("owner-a"), privatePlan);
    recordBrowserPrincipal("owner-b");
    render(<ManualPlanEditor ownerUserId="owner-b" planId={privatePlan.id} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This plan is unavailable for this account");
    expect(screen.queryByRole("textbox", { name: "Plan title" })).not.toBeInTheDocument();
    expect(listManualPlans(currentDeviceDataScope("owner-b"))).toEqual([]);
    expect(persistenceApi.save).not.toHaveBeenCalled();
  });

  it("regression: rejects a late TED response after the user edits the requested action", async () => {
    let resolve!: (result: { content: string; changes: string[] }) => void;
    editor.run.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<ManualPlanEditor />);
    const action = screen.getByRole("textbox", { name: "Action 1" });
    fireEvent.change(action, { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.change(action, { target: { value: "My newer correction" } });
    await act(async () => resolve({ content: "Stale suggestion", changes: [] }));
    expect(screen.queryByText("Stale suggestion")).not.toBeInTheDocument();
    expect(action).toHaveValue("My newer correction");
  });

  it("regression: invalidates a delivered proposal when the plan changes before Apply", async () => {
    render(<ManualPlanEditor />);
    const action = screen.getByRole("textbox", { name: "Action 1" });
    fireEvent.change(action, { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");
    fireEvent.change(action, { target: { value: "My newer correction" } });
    expect(screen.queryByText("Contact the supplier and confirm the delivery date.")).not.toBeInTheDocument();
    expect(action).toHaveValue("My newer correction");
  });

  it("regression: retries the reviewed item even if selection moves to a sibling", async () => {
    const plan = createManualPlan();
    plan.items[0]!.text = "First original";
    plan.items.push({ ...createManualPlanItem(), text: "Second original" });
    saveManualPlan(currentDeviceDataScope(), plan);
    render(<ManualPlanEditor planId={plan.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");
    fireEvent.focus(screen.getByRole("textbox", { name: "Action 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(editor.run).toHaveBeenCalledTimes(2));
    expect(editor.run.mock.calls[1]?.[0].content).toBe("First original");
    expect(loadManualPlan(currentDeviceDataScope(), plan.id)?.items[1]?.text).toBe("Second original");
  });

  it("regression: rejects a TED response across an A to B to A principal transition", async () => {
    recordBrowserPrincipal("owner-a");
    let resolve!: (result: { content: string; changes: string[] }) => void;
    editor.run.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<ManualPlanEditor ownerUserId="owner-a" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "A original" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    act(() => { recordBrowserPrincipal("owner-b"); recordBrowserPrincipal("owner-a"); });
    await act(async () => resolve({ content: "Stale owner suggestion", changes: [] }));
    expect(screen.queryByText("Stale owner suggestion")).not.toBeInTheDocument();
  });

  afterEach(() => { vi.restoreAllMocks(); recordBrowserPrincipal(undefined); });

  it("blocks duplicate dispatch before streaming state updates and cancels on unmount", async () => {
    let resolve!: (result: { content: string; changes: string[] }) => void;
    editor.run.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const page = render(<ManualPlanEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(editor.run).toHaveBeenCalledTimes(1);
    page.unmount();
    expect(editor.cancel).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ content: "Too late", changes: [] }));
    expect(listManualPlans(currentDeviceDataScope())[0]?.items[0]?.text).toBe("Original");
  });

  it("rejects the old response after delete and undo restore identical wording", async () => {
    let resolve!: (result: { content: string; changes: string[] }) => void;
    editor.run.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<ManualPlanEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete action" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
    await act(async () => resolve({ content: "Too late", changes: [] }));
    expect(screen.queryByText("Too late")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Original");
  });

  it("applies the reviewed action only and keeps sibling fields verbatim", async () => {
    const plan = createManualPlan();
    plan.items[0]!.text = "First original";
    const sibling = { ...createManualPlanItem(), text: "  Second\noriginal  ", section: " A ", notes: " B ", dueDate: "2026-09-16", done: true };
    plan.items.push(sibling);
    saveManualPlan(currentDeviceDataScope(), plan);
    render(<ManualPlanEditor planId={plan.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const saved = loadManualPlan(currentDeviceDataScope(), plan.id);
    expect(saved?.items[0]?.text).toBe("Contact the supplier and confirm the delivery date.");
    expect(saved?.items[1]).toEqual(sibling);
  });

  it("retries failed device storage with the same unsaved fields and identity", () => {
    const page = render(<ManualPlanEditor />);
    const id = new URLSearchParams(window.location.search).get("plan")!;
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Keep the unsaved draft" } });
    expect(screen.getByText("Couldn’t save on this device")).toBeInTheDocument();
    storage.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry device save" }));
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    page.unmount();
    expect(loadManualPlan(currentDeviceDataScope(), id)?.items[0]?.text).toBe("Keep the unsaved draft");
    expect(listManualPlans(currentDeviceDataScope())).toHaveLength(1);
  });

  it("retains unsaved typing when Next adopts the newly allocated plan URL", () => {
    const page = render(<ManualPlanEditor />);
    const id = new URLSearchParams(window.location.search).get("plan")!;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Unsaved while URL updates" } });
    page.rerender(<ManualPlanEditor planId={id} />);
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Unsaved while URL updates");
    expect(screen.getByText("Couldn’t save on this device")).toBeInTheDocument();
    expect(screen.queryByText("Saved on this device")).not.toBeInTheDocument();
  });

  it("keeps a current suggestion when Next adopts the same plan URL", async () => {
    const page = render(<ManualPlanEditor />);
    const id = new URLSearchParams(window.location.search).get("plan")!;
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");
    page.rerender(<ManualPlanEditor planId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(loadManualPlan(currentDeviceDataScope(), id)?.items[0]?.text).toBe("Contact the supplier and confirm the delivery date.");
  });

  it("retains Undo and its exact deleted fields when Next adopts the same plan URL", () => {
    const page = render(<ManualPlanEditor />);
    const id = new URLSearchParams(window.location.search).get("plan")!;
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "  Restore Renée\n日本語  " } });
    fireEvent.change(screen.getByLabelText("Section / phase"), { target: { value: " Before " } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: " Keep\nall notes " } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-09-16" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark action 1 complete" }));
    fireEvent.change(screen.getByRole("textbox", { name: "tEdit instruction" }), { target: { value: "Keep my phrasing" } });
    const deleted = loadManualPlan(currentDeviceDataScope(), id)?.items[0];
    expect(deleted).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete action" }));
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("");

    page.rerender(<ManualPlanEditor planId={id} />);

    expect(screen.getByRole("textbox", { name: "tEdit instruction" })).toHaveValue("Keep my phrasing");
    fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
    expect(loadManualPlan(currentDeviceDataScope(), id)?.items).toEqual([deleted]);
    expect(listManualPlans(currentDeviceDataScope()).map(plan => plan.id)).toEqual([id]);
  });

  it("retires Undo when newer typing replaces the deleted final action", () => {
    render(<ManualPlanEditor />);
    const id = new URLSearchParams(window.location.search).get("plan")!;
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Deleted wording" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete action" }));
    expect(screen.getByRole("button", { name: "Undo delete" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "My newer replacement" } });

    expect(screen.queryByRole("button", { name: "Undo delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("My newer replacement");
    expect(loadManualPlan(currentDeviceDataScope(), id)?.items[0]?.text).toBe("My newer replacement");
  });

  it("cannot carry deleted content or an instruction into another plan or restore it on return", () => {
    const first = createManualPlan();
    first.items[0]!.text = "Private deleted wording";
    const second = createManualPlan();
    second.title = "Second plan";
    second.items[0] = { ...first.items[0]!, text: "Second plan wording", notes: "Second plan notes" };
    saveManualPlan(currentDeviceDataScope(), first);
    saveManualPlan(currentDeviceDataScope(), second);
    const page = render(<ManualPlanEditor planId={first.id} />);
    fireEvent.change(screen.getByRole("textbox", { name: "tEdit instruction" }), { target: { value: "Private first-plan instruction" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete action" }));
    expect(screen.getByRole("button", { name: "Undo delete" })).toBeInTheDocument();

    page.rerender(<ManualPlanEditor planId={second.id} />);

    expect(screen.queryByRole("button", { name: "Undo delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "tEdit instruction" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Second plan wording");
    expect(loadManualPlan(currentDeviceDataScope(), second.id)).toEqual(second);
    page.rerender(<ManualPlanEditor planId={first.id} />);
    expect(screen.queryByRole("button", { name: "Undo delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "tEdit instruction" })).toHaveValue("");
  });

  it("hides a completed TED proposal immediately when another plan opens", async () => {
    const first = createManualPlan();
    first.items[0]!.text = "Private original";
    const second = createManualPlan();
    second.items[0]!.text = "Second plan wording";
    saveManualPlan(currentDeviceDataScope(), first);
    saveManualPlan(currentDeviceDataScope(), second);
    const page = render(<ManualPlanEditor planId={first.id} />);
    fireEvent.change(screen.getByRole("textbox", { name: "tEdit instruction" }), { target: { value: "Private first-plan instruction" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");

    page.rerender(<ManualPlanEditor planId={second.id} />);

    expect(screen.queryByText("Contact the supplier and confirm the delivery date.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "tEdit instruction" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Second plan wording");
    expect(loadManualPlan(currentDeviceDataScope(), second.id)).toEqual(second);
    expect(editor.run).toHaveBeenCalledTimes(1);
  });

  it("hides deleted content and a completed proposal when the same plan ID opens for another owner", async () => {
    const first = createManualPlan();
    first.items[0]!.text = "Owner A deleted action";
    first.items.push({ ...createManualPlanItem(), text: "Owner A requested action" });
    const second = { ...first, title: "Owner B plan", items: [{ ...first.items[0]!, text: "Owner B action" }] };
    recordBrowserPrincipal(ownerA);
    persistenceApi.read.mockResolvedValueOnce(accountSnapshot(first)).mockResolvedValue(accountSnapshot(second, ownerB));
    const page = render(<ManualPlanEditor ownerUserId={ownerA} planId={first.id} />);
    await screen.findByDisplayValue("Owner A deleted action");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete action" })[0]!);
    fireEvent.change(screen.getByRole("textbox", { name: "tEdit instruction" }), { target: { value: "Private owner A instruction" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");
    expect(screen.getByRole("button", { name: "Undo delete" })).toBeInTheDocument();
    expect(editor.run.mock.calls[0]?.[0].content).toBe("Owner A requested action");

    act(() => recordBrowserPrincipal(ownerB));
    page.rerender(<ManualPlanEditor ownerUserId={ownerB} planId={first.id} />);
    await screen.findByDisplayValue("Owner B action");

    expect(screen.queryByRole("button", { name: "Undo delete" })).not.toBeInTheDocument();
    expect(screen.queryByText("Contact the supplier and confirm the delivery date.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "tEdit instruction" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Owner B action");
    expect(screen.getByRole("textbox", { name: "Plan title" })).toHaveValue("Owner B plan");
    expect(editor.run).toHaveBeenCalledTimes(1);
  });

  it("retires a completed proposal and instruction when another recovery of the same plan opens", async () => {
    const plan = createManualPlan();
    plan.items[0]!.text = "Same action wording";
    const snapshot = accountSnapshot(plan);
    const expected = { outcome_id: snapshot.outcome_id, artifact_id: snapshot.artifact_id,
      revision: snapshot.revision, updated_at: snapshot.updated_at };
    const firstRecovery = "77777777-7777-4777-8777-777777777777";
    const secondRecovery = "88888888-8888-4888-8888-888888888888";
    for (const [id, title] of [[firstRecovery, "First recovery"], [secondRecovery, "Second recovery"]] as const) {
      expect(writeDeviceData(currentDeviceDataScope(ownerA), "manual-plan-recovery", id, {
        version: 1, ownerId: ownerA, plan: { ...plan, title }, expected, pending: null, dirty: true,
      })).toBe(true);
    }
    recordBrowserPrincipal(ownerA);
    persistenceApi.read.mockResolvedValue(snapshot);
    window.history.replaceState(null, "", `/plans?create=manual&plan=${plan.id}&recovery=${firstRecovery}`);
    const page = render(<ManualPlanEditor ownerUserId={ownerA} planId={plan.id} />);
    await screen.findByDisplayValue("First recovery");
    fireEvent.change(screen.getByRole("textbox", { name: "tEdit instruction" }), { target: { value: "Private first-recovery instruction" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");

    window.history.replaceState(null, "", `/plans?create=manual&plan=${plan.id}&recovery=${secondRecovery}`);
    page.rerender(<ManualPlanEditor ownerUserId={ownerA} planId={plan.id} />);
    await screen.findByDisplayValue("Second recovery");

    expect(screen.queryByText("Contact the supplier and confirm the delivery date.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "tEdit instruction" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Same action wording");
    expect(editor.run).toHaveBeenCalledTimes(1);
  });

  it("hides a completed proposal and private inputs after an A to B to A principal transition", async () => {
    recordBrowserPrincipal(ownerA);
    render(<ManualPlanEditor ownerUserId={ownerA} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), { target: { value: "Private owner A wording" } });
    fireEvent.change(screen.getByRole("textbox", { name: "tEdit instruction" }), { target: { value: "Private owner A instruction" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");

    act(() => { recordBrowserPrincipal(ownerB); recordBrowserPrincipal(ownerA); });

    expect(screen.queryByText("Contact the supplier and confirm the delivery date.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Action 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "tEdit instruction" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your account session changed. Reopen this plan before saving; your edits are kept.");
    expect(editor.run).toHaveBeenCalledTimes(1);
  });

  it("restores the most recently deleted action", async () => {
    const user = userEvent.setup();
    render(<ManualPlanEditor />);

    const action = await screen.findByRole("textbox", { name: "Action 1" });
    await user.type(action, "Contact the supplier");
    await user.click(screen.getByRole("button", { name: "Delete action" }));

    expect(action).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Undo delete" }));
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue(
      "Contact the supplier",
    );
  });

  it("starts a fresh TED request when the user asks to try again", async () => {
    const user = userEvent.setup();
    render(<ManualPlanEditor />);

    const action = await screen.findByRole("textbox", { name: "Action 1" });
    await user.type(action, "Contact supplier");
    await user.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Contact the supplier and confirm the delivery date.");

    editor.run.mockResolvedValueOnce({
      content: "Contact the supplier, confirm stock and agree delivery.",
      changes: [],
    });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(editor.run).toHaveBeenCalledTimes(2));
  });

  it("does not claim a plan was saved when device storage rejects the write", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });

    render(<ManualPlanEditor />);
    await user.type(await screen.findByRole("textbox", { name: "Action 1" }), "Call supplier");

    expect(await screen.findByText("Couldn’t save on this device")).toBeInTheDocument();
    expect(screen.queryByText("Saved on this device")).not.toBeInTheDocument();
  });
});
