import { describe, expect, it } from "vitest";
import { fallbackIntentAfterTimeout } from "./useInterpretIntent";

describe("fallbackIntentAfterTimeout", () => {
  it("keeps the first turn in the mandatory clarification checkpoint", () => {
    const result = fallbackIntentAfterTimeout({
      situation: "Please prepare a complaint letter structure for an electricity bill dispute.",
      phase: "start",
    });

    expect(result.intentClear).toBe(false);
    expect(result.question).toContain("Here’s what I understand");
    expect(result.recommendation).toBeNull();
  });

  it("fails closed instead of guessing a template after a continuation timeout", () => {
    const result = fallbackIntentAfterTimeout({
      situation: "Please prepare a complaint letter structure for an electricity bill dispute.",
      answer: "Yes, that's accurate",
      phase: "continue",
    });

    expect(result.intentClear).toBe(false);
    expect(result.question).toContain("couldn't safely confirm");
    expect(result.recommendation).toBeNull();
  });
});
