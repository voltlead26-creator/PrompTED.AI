import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactActionScreen } from "./ArtifactActionScreen";

const mocks = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), cancel: vi.fn(), state: {} as Record<string, unknown>, auth: { user: { id: "u1" } } }));
vi.mock("@/components/providers", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/useArtifact", () => ({ useArtifact: () => mocks.state }));
vi.mock("@/hooks/useEditWithTED", () => ({ useEditWithTED: () => ({ run: mocks.run, cancel: mocks.cancel, streaming: false, error: null }) }));

const payload = { title: "Full stretching sequence", objective: "Gentle stretches", instructions: ["Keep comfortable"], required_inputs: [], included_materials: [], dependencies: [], timing: null, completion_criteria: ["Finished"], cautions: [] };
const block = { id: "b1", artifact_id: "a1", kind: "action", heading: "Evening", revision: 1, payload, completed_at: null };
const artifact = { id: "a1", user_id: "u1", outcome_id: "o1", current_revision: 1, blocks: [block] };

describe("action step title and description editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = { id: "u1" };
    mocks.run.mockResolvedValue({ content: "Evening stretches", changes: [] });
    mocks.save.mockResolvedValue(undefined);
    Object.assign(mocks.state, { artifact, loading: false, savingBlockId: null, loadError: null, saveError: null, updateBlockPayload: mocks.save, toggleBlock: vi.fn() });
  });

  it.each(["Expand", "Shorten"])("targets the title with %s and waits for Apply", async (name) => {
    render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.change(screen.getByLabelText("Edit field"), { target: { value: "title" } });
    fireEvent.click(screen.getByRole("button", { name }));
    await screen.findByRole("button", { name: "Apply" });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ content: payload.title }));
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("b1", { ...payload, title: "Evening stretches" }));
  });

  it("continues to edit only the description when selected", async () => {
    render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.change(screen.getByLabelText("Edit field"), { target: { value: "objective" } });
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("b1", { ...payload, objective: "Evening stretches" }));
  });

  it("sends a custom tEdit instruction for the selected title", async () => {
    render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.change(screen.getByLabelText("Edit field"), { target: { value: "title" } });
    fireEvent.click(screen.getByRole("button", { name: "tEdit" }));
    fireEvent.change(screen.getByLabelText("Tell TED what to change"), { target: { value: "Use a short heading" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
    await screen.findByRole("button", { name: "Apply" });
    expect(mocks.run).toHaveBeenCalledWith({ action: "improve", content: payload.title, instruction: "Use a short heading" });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("b1", { ...payload, title: "Evening stretches" }));
  });

  it("keeps the draft and review on an unsuccessful save", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Offline"));
    render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not confirm/i);
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByText("Gentle stretches")).toBeInTheDocument();
  });

  it("keeps manual drafts mounted during the save reload", () => {
    const view = render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit title and description" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "My unsaved title" } });
    mocks.state.loading = true;
    view.rerender(<ArtifactActionScreen outcomeId="o1" />);
    expect(screen.getByLabelText("Task title")).toHaveValue("My unsaved title");
  });

  it("drops a late response after changing outcomes", async () => {
    let resolve!: (result: { content: string; changes: string[] }) => void;
    mocks.run.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    view.rerender(<ArtifactActionScreen outcomeId="o2" />);
    await act(async () => resolve({ content: "Late suggestion", changes: [] }));
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("clears a proposal when the signed-in owner changes", async () => {
    const view = render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    await screen.findByRole("button", { name: "Apply" });
    mocks.auth.user = { id: "u2" };
    view.rerender(<ArtifactActionScreen outcomeId="o1" />);
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByText(payload.title)).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects an outdated direct edit while retaining its wording", async () => {
    const view = render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit title and description" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "My title" } });
    mocks.state.artifact = { ...artifact, current_revision: 2, blocks: [{ ...block, revision: 2 }] };
    view.rerender(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/changed since.*started/i);
    expect(screen.getByLabelText("Task title")).toHaveValue("My title");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("moves the full sequence into the description in one revision", async () => {
    render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit title and description" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Evening stretches" } });
    fireEvent.change(screen.getByLabelText("Task description"), { target: { value: payload.title } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("b1", { ...payload, title: "Evening stretches", objective: payload.title }));
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects applying a suggestion after the saved revision changes", async () => {
    const view = render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    await screen.findByRole("button", { name: "Apply" });
    mocks.state.artifact = { ...artifact, current_revision: 2, blocks: [{ ...block, revision: 2 }] };
    view.rerender(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/changed since.*started/i)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("drops a late response after cancellation", async () => {
    let resolve!: (result: { content: string; changes: string[] }) => void;
    mocks.run.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<ArtifactActionScreen outcomeId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel suggestion" }));
    await act(async () => resolve({ content: "Late suggestion", changes: [] }));
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
