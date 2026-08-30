import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualPlanEditor } from "./ManualPlanEditor";

const editor = vi.hoisted(() => ({
  run: vi.fn(),
  streaming: false,
  draft: "",
  error: null as string | null,
  cancel: vi.fn(),
}));

vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => editor,
}));

describe("ManualPlanEditor recovery controls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    editor.run.mockResolvedValue({
      content: "Contact the supplier and confirm the delivery date.",
      changes: [],
    });
  });

  afterEach(() => vi.restoreAllMocks());

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
