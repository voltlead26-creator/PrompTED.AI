import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("combines conditional class names", () => {
    expect(cn("flex", false && "hidden", { "items-center": true })).toBe("flex items-center");
  });

  it("keeps the last conflicting Tailwind utility", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
