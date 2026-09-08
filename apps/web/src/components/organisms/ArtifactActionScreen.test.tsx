import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactActionScreen } from "./ArtifactActionScreen";

const toggleBlock = vi.fn();
const runEdit = vi.fn();
const outcomeId = "74196188-a47f-46f6-bb2d-96f6d49952f4";
const otherOutcomeId = "687e0cf0-6df6-42f7-9e42-da0272ad10c7";
const artifactId = "73c57e79-f087-45c6-a227-fa071ff86f8c";
const blockId = "a147b419-15c3-4192-882d-22335924ac86";
const userId = "2183f2db-9470-44a9-a729-31bb5d0cfc26";
const editState: { error: string | null } = { error: null };
vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: userId } }),
}));
vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => ({ run: runEdit, streaming: false, error: editState.error, cancel: vi.fn() }),
}));
const artifact = {
  id: artifactId,
  outcome_id: outcomeId,
  user_id: userId,
  current_revision: 1,
  blocks: [{
    id: blockId, artifact_id: artifactId, kind: "action", stable_key: "prepare",
    parent_block_id: null, heading: "Preparation", order_index: 0,
    payload: {
      title: "Prepare the request", objective: "Have a complete request ready to send.",
      instructions: ["Add your reference number to the included wording."],
      required_inputs: ["Reference number"], included_materials: [{ label: "Wording", content: "I request a review of [decision]." }],
      dependencies: [], timing: null, completion_criteria: ["The request is complete."], cautions: [],
    },
    approval_status: "draft", completed_at: null, due_date: null, revision: 1, references: [],
  }] as const,
};
const hookState: Record<string, unknown> = {};
vi.mock("@/hooks/useArtifact", () => ({
  useArtifact: () => hookState,
}));

function editRequest(index: number) {
  const call = runEdit.mock.calls[index];
  expect(call).toBeDefined();
  if (!call) throw new Error("Expected an actual TED request");
  return call[0];
}

describe("ArtifactActionScreen", () => {
  beforeEach(() => {
    toggleBlock.mockReset();
    editState.error = null;
    runEdit.mockReset().mockResolvedValue({ content: "A clearer objective.", changes: [] });
    Object.assign(hookState, {
      loading: false,
      toggleBlock,
      updateBlockPayload: vi.fn(),
      savingBlockId: null,
      loadError: null,
      saveError: null,
      artifact,
    });
  });

  it("opens the completed suggestion as a modal without saving it", async () => {
    render(<ArtifactActionScreen outcomeId={outcomeId} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("A clearer objective.")).toBeInTheDocument();
    expect(hookState.updateBlockPayload).not.toHaveBeenCalled();
  });

  it("retries the reviewed step even if selection changes before retry", async () => {
    Object.assign(hookState, { artifact: { ...artifact, blocks: [...artifact.blocks, {
      ...artifact.blocks[0], id: "f13f60ee-b7c7-4267-8c5e-d4b2a1da3b64", payload: { ...artifact.blocks[0].payload, title: "Another step", objective: "Another original." },
    }] } });
    render(<ArtifactActionScreen outcomeId={outcomeId} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("A clearer objective.");
    fireEvent.click(screen.getByRole("button", { name: /Another step/ }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(runEdit).toHaveBeenCalledTimes(2));
    expect(editRequest(1)).toEqual(editRequest(0));
    expect(hookState.updateBlockPayload).not.toHaveBeenCalled();
  });

  it("keeps failed-save guidance in the suggestion modal", async () => {
    const view = render(<ArtifactActionScreen outcomeId={outcomeId} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByText("A clearer objective.");
    Object.assign(hookState, { saveError: "TED could not confirm that wording change." });
    view.rerender(<ArtifactActionScreen outcomeId={outcomeId} />);
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("could not confirm");
  });

  it("shows the full self-contained action", () => {
    render(<ArtifactActionScreen outcomeId={outcomeId} />);
    expect(screen.getByText("Prepare the request")).toBeInTheDocument();
    expect(screen.getByText("Add your reference number to the included wording.")).toBeInTheDocument();
    expect(screen.getByText("I request a review of [decision].")).toBeInTheDocument();
    expect(screen.getByText("The request is complete.")).toBeInTheDocument();
  });

  it("disables the exact in-flight action and exposes persistence uncertainty", () => {
    Object.assign(hookState, {
      savingBlockId: blockId,
      saveError: "TED could not confirm that progress change.",
    });
    render(<ArtifactActionScreen outcomeId={outcomeId} />);
    expect(screen.getByRole("checkbox", {
      name: "Mark complete: Prepare the request",
    })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
  });

  it.each(["null", "empty", "rejected"] as const)(
    "retains the reviewed proposal and an in-dialog error when a retry is %s",
    async (failure) => {
      render(<ArtifactActionScreen outcomeId={outcomeId} />);
      await userEvent.click(screen.getByRole("button", { name: "Expand" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("A clearer objective.")).toBeInTheDocument();
      if (failure === "rejected") runEdit.mockRejectedValueOnce(new Error("Synthetic provider failure"));
      else runEdit.mockImplementationOnce(async () => {
        editState.error = failure === "null" ? "TED could not finish this request." : null;
        return failure === "null" ? null : { content: " \n\t", changes: [] };
      });

      await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));

      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(within(dialog).getByText("A clearer objective.")).toBeInTheDocument();
      expect(within(dialog).getByRole("alert")).toHaveTextContent(/could not finish/i);
      expect(runEdit).toHaveBeenCalledTimes(2);
      expect(editRequest(1)).toEqual(editRequest(0));
      expect(hookState.updateBlockPayload).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
      expect(hookState.updateBlockPayload).toHaveBeenCalledExactlyOnceWith(blockId, {
        ...artifact.blocks[0].payload,
        objective: "A clearer objective.",
      });
    },
  );

  it("keeps a retry pending without duplicate dispatch or losing its proposal", async () => {
    render(<ArtifactActionScreen outcomeId={outcomeId} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    const dialog = await screen.findByRole("dialog");
    let resolve!: (value: { content: string; changes: string[] }) => void;
    runEdit.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const retry = within(dialog).getByRole("button", { name: "Try again" });
    try {
      act(() => { retry.click(); retry.click(); });
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(within(dialog).getByText("A clearer objective.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Trying again…" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Apply" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Discard" })).toBeDisabled();
      fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(runEdit).toHaveBeenCalledTimes(2);
      expect(hookState.updateBlockPayload).not.toHaveBeenCalled();
    } finally {
      await act(async () => { resolve({ content: "A replacement objective.", changes: ["More detail"] }); });
    }
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByText("A replacement objective.")).toBeInTheDocument();
    expect(editRequest(1)).toEqual(editRequest(0));
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(hookState.updateBlockPayload).toHaveBeenCalledExactlyOnceWith(blockId, {
      ...artifact.blocks[0].payload,
      objective: "A replacement objective.",
    });
  });

  it("hides an artifact belonging to a different outcome after that outcome read fails", () => {
    const view = render(<ArtifactActionScreen outcomeId={outcomeId} />);
    expect(screen.getByText("Prepare the request")).toBeInTheDocument();
    hookState.loadError = "TED could not load the requested plan.";
    view.rerender(<ArtifactActionScreen outcomeId={otherOutcomeId} />);
    expect(screen.queryByText("Prepare the request")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("TED could not load the requested plan.");
    expect(runEdit).not.toHaveBeenCalled();
    expect(hookState.updateBlockPayload).not.toHaveBeenCalled();
  });

  it("blocks provider, progress and manual editing while the retained artifact read is unavailable", () => {
    hookState.loadError = "TED could not confirm the saved plan.";
    render(<ArtifactActionScreen outcomeId={outcomeId} />);
    expect(screen.getByRole("button", { name: "Expand" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit title and description" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Mark complete: Prepare the request" })).toBeDisabled();
    expect(runEdit).not.toHaveBeenCalled();
    expect(toggleBlock).not.toHaveBeenCalled();
  });

  it("retains a reviewed proposal but refuses Apply and Retry after an unavailable read", async () => {
    const view = render(<ArtifactActionScreen outcomeId={outcomeId} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    const dialog = await screen.findByRole("dialog");
    hookState.loadError = "TED could not confirm the saved plan.";
    view.rerender(<ArtifactActionScreen outcomeId={outcomeId} />);
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(hookState.updateBlockPayload).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
    await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(runEdit).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText("A clearer objective.")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/saved plan|latest saved step/);
  });
});
