import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SectionedChecklistScreen } from "./SectionedChecklistScreen";

const runEdit = vi.fn();
const updateText = vi.fn();
const hookState: Record<string, unknown> = {};
vi.mock("@/hooks/useChecklist", () => ({ useChecklist: () => hookState }));
vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => ({ run: runEdit, streaming: false, error: null, cancel: vi.fn() }),
}));

describe("SectionedChecklistScreen suggestion review", () => {
  beforeEach(() => {
    runEdit.mockReset().mockResolvedValue({ content: "Clearer first item.", changes: [] });
    updateText.mockReset().mockResolvedValue(true);
    Object.assign(hookState, {
      loading: false, error: null, saveError: null, savingItemIds: [],
      isSavingItem: () => false, updateText, toggleDone: vi.fn(),
      items: [{ id: "i1", outcome_id: "o1", user_id: "u1", text: "Preparation␟First original item.", done: false },
        { id: "i2", outcome_id: "o1", user_id: "u1", text: "Preparation␟Second original item.", done: false }],
      done: 0, total: 2, progress: 0,
    });
  });

  it.each(["Preparation␟Newer wording.", "Preparation ␟First original item."])("rejects Apply after the exact accepted row text changes: %s", async (text) => {
    const view = render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByRole("dialog");
    Object.assign(hookState, { items: [{ id: "i1", outcome_id: "o1", user_id: "u1", text, done: false }] });
    view.rerender(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(updateText).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(/changed/i);
  });

  it.each([false, true])("fences a held response after outcome replacement (return to original: %s)", async (returnToOriginal) => {
    let finish!: (value: { content: string; changes: string[] }) => void;
    runEdit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const initialItems = hookState.items;
    const view = render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    Object.assign(hookState, { items: [{ id: "i3", outcome_id: "o2", user_id: "u1", text: "Replacement outcome item.", done: false }] });
    view.rerender(<SectionedChecklistScreen outcomeId="o2" />);
    if (returnToOriginal) {
      Object.assign(hookState, { items: initialItems });
      view.rerender(<SectionedChecklistScreen outcomeId="o1" />);
    }
    await act(async () => finish({ content: "Late obsolete proposal.", changes: [] }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand" })).toBeEnabled();
    expect(updateText).not.toHaveBeenCalled();
  });

  it("accepts only one same-turn request", async () => {
    let finish!: (value: { content: string; changes: string[] }) => void;
    runEdit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<SectionedChecklistScreen outcomeId="o1" />);
    const expand = screen.getByRole("button", { name: "Expand" });
    act(() => { fireEvent.click(expand); fireEvent.click(expand); });
    expect(runEdit).toHaveBeenCalledOnce();
    await act(async () => finish({ content: "One proposal.", changes: [] }));
  });

  it("retains a proposal when the save returns an explicit non-acceptance", async () => {
    updateText.mockResolvedValue(false);
    render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(within(screen.getByRole("dialog")).getByText("Clearer first item.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(/not confirm|changed/i);
  });

  it.each([false, true])("keeps review and Discard reachable when the reviewed item disappears (all removed: %s)", async (allRemoved) => {
    const view = render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByRole("dialog");
    Object.assign(hookState, { items: allRemoved ? [] : [{
      id: "i2", outcome_id: "o1", user_id: "u1", text: "Preparation␟Second original item.", done: false,
    }], total: allRemoved ? 0 : 1 });
    view.rerender(<SectionedChecklistScreen outcomeId="o1" />);
    expect(within(screen.getByRole("dialog")).getByText("Clearer first item.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(updateText).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(/changed/i);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    if (!allRemoved) expect(screen.getByRole("button", { name: "Expand" })).toBeEnabled();
  });

  it.each(["loading", "error"])("retains pending review and Discard while the current read is %s", async (state) => {
    const view = render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByRole("dialog");
    Object.assign(hookState, state === "loading" ? { loading: true } : { error: "Saved checklist temporarily unavailable." });
    view.rerender(<SectionedChecklistScreen outcomeId="o1" />);
    expect(within(screen.getByRole("dialog")).getByText("Clearer first item.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(updateText).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("brings a completed suggestion into a modal without applying it", async () => {
    render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Clearer first item.")).toBeInTheDocument();
    expect(updateText).not.toHaveBeenCalled();
  });

  it("retries the original reviewed item without a stale pending closure", async () => {
    render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Clearer first item.");
    fireEvent.click(screen.getByRole("button", { name: "Second original item." }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(runEdit).toHaveBeenCalledTimes(2));
    const [firstCall, retryCall] = runEdit.mock.calls;
    if (!firstCall || !retryCall) throw new Error("Expected the original request and its retry");
    expect(retryCall[0]).toEqual(firstCall[0]);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(updateText).toHaveBeenCalledExactlyOnceWith("i1", "Preparation␟Clearer first item.");
  });

  it("keeps persistence failure inside the modal and retains the wording", async () => {
    updateText.mockRejectedValue(new Error("SAVE_UNCONFIRMED"));
    const view = render(<SectionedChecklistScreen outcomeId="o1" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("Clearer first item.");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    Object.assign(hookState, { saveError: "PrompTED could not confirm this change." });
    view.rerender(<SectionedChecklistScreen outcomeId="o1" />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("could not confirm");
    expect(within(dialog).getByText("Clearer first item.")).toBeInTheDocument();
  });
});
