import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactActionScreen } from "./ArtifactActionScreen";

const toggleBlock = vi.fn();
vi.mock("@/hooks/useArtifact", () => ({
  useArtifact: () => ({
    loading: false,
    toggleBlock,
    artifact: {
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
    },
  }),
}));

describe("ArtifactActionScreen", () => {
  it("shows the full self-contained action", () => {
    render(<ArtifactActionScreen outcomeId="o1" />);
    expect(screen.getByText("Prepare the request")).toBeInTheDocument();
    expect(screen.getByText("Add your reference number to the included wording.")).toBeInTheDocument();
    expect(screen.getByText("I request a review of [decision].")).toBeInTheDocument();
    expect(screen.getByText("The request is complete.")).toBeInTheDocument();
  });
});
