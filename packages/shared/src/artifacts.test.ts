import { describe, expect, it } from "vitest";
import { isActiveTedArtifactKind, validateTedActionStep } from "./artifacts";

const completeStep = {
  title: "Prepare the request",
  objective: "Create a complete request ready to submit.",
  instructions: ["Write your full name, reference number and requested outcome in the included wording."],
  required_inputs: ["Reference number"],
  included_materials: [{ label: "Request wording", content: "I request a review of [decision] because [reason]." }],
  dependencies: [],
  timing: { relative_timing: "Within 28 days", rationale: "This preserves the stated review window." },
  completion_criteria: ["The request contains the reference number, reasons and requested outcome."],
  cautions: [],
};

describe("validateTedActionStep", () => {
  it("accepts a complete self-contained step", () => {
    expect(validateTedActionStep("prepare", completeStep)).toEqual([]);
  });

  it("rejects a step that delegates required content to a website", () => {
    expect(validateTedActionStep("prepare", {
      ...completeStep,
      instructions: ["Visit the website to find out what information to include."],
    })).toContainEqual(expect.objectContaining({ code: "external_content_dependency" }));
  });

  it("requires reference summaries", () => {
    expect(validateTedActionStep("prepare", completeStep, [{
      label: "Official guidance",
      url: "https://example.gov.test/guidance",
      publisher: "Example Government",
      retrieved_at: "2026-07-18",
      supports: "",
      summary: "",
    }])).toContainEqual(expect.objectContaining({ code: "missing_reference_summary" }));
  });
});

describe("supporting artifact authority", () => {
  it("keeps historical document provenance readable but blocks it for new artifacts", () => {
    expect(isActiveTedArtifactKind("document")).toBe(false);
    expect(isActiveTedArtifactKind("checklist")).toBe(true);
    expect(isActiveTedArtifactKind("research_brief")).toBe(true);
  });
});
