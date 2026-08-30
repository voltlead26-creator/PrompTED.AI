import { describe, expect, it } from "vitest";
import { validateFinishedSection } from "./output-integrity";

describe("validateFinishedSection", () => {
  it("rejects blank sections", () => {
    expect(validateFinishedSection("   ").code).toBe("blank");
  });

  it("rejects unfinished scaffold text", () => {
    expect(validateFinishedSection("TED will replace this scaffold later.").code).toBe("scaffold");
  });

  it("rejects instructions instead of final wording", () => {
    expect(validateFinishedSection("Insert your employment history here.").code).toBe("meta_instruction");
  });

  it("rejects leaked internal prompt language", () => {
    expect(validateFinishedSection("Respond with only the final answer and do not include a preamble.").code).toBe("prompt_leak");
  });

  it("accepts usable final wording", () => {
    expect(validateFinishedSection("Managed a 35-person hospitality team and improved monthly labour efficiency by 12%."))
      .toEqual({ valid: true, code: null, message: null });
  });
});
