import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactActionScreen } from "./ArtifactActionScreen";

const toggleBlock = vi.fn();
const artifact = {
  id: "a1",
  blocks: [{
    id: "b1", artifact_id: "a1", kind: "action", stable_key: "prepare",
    parent_block_id: null, heading: "Preparation", order_index: 0,
    payload: {
      title: "Prepare the request", objective: "Have a complete request ready to send.",
      instructions: ["Add your reference number to the included wording."],
      required_inputs: ["Reference number"], included_materials: [{ label: "Wording", content: "I request a review of [decision]." }],
      dependencies: [], timing: null, completion_criteria: ["The request is complete."], cautions: [],
    },
    approval_status: "draft", completed_at: null, due_date: null, revision: 1, references: [],
  }],
};
const hookState: Record<string, unknown> = {};
vi.mock("@/hooks/useArtifact", () => ({
  useArtifact: () => hookState,
}));

describe("ArtifactActionScreen", () => {
  beforeEach(() => {
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

  it("shows the full self-contained action", () => {
    render(<ArtifactActionScreen outcomeId="o1" />);
    expect(screen.getByText("Prepare the request")).toBeInTheDocument();
    expect(screen.getByText("Add your reference number to the included wording.")).toBeInTheDocument();
    expect(screen.getByText("I request a review of [decision].")).toBeInTheDocument();
    expect(screen.getByText("The request is complete.")).toBeInTheDocument();
  });

  it("disables the exact in-flight action and exposes persistence uncertainty", () => {
    Object.assign(hookState, {
      savingBlockId: "b1",
      saveError: "TED could not confirm that progress change.",
    });
    render(<ArtifactActionScreen outcomeId="o1" />);
    expect(screen.getByRole("checkbox", {
      name: "Mark complete: Prepare the request",
    })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not confirm/i);
  });
});
