import { describe, expect, it } from "vitest";
import { safeInternalReturnPath, signInHref } from "./auth-return";

describe("safeInternalReturnPath", () => {
  it("keeps an internal document route with query and hash", () => {
    expect(safeInternalReturnPath("/outcomes/outcome-1?section=work#editor")).toBe(
      "/outcomes/outcome-1?section=work#editor",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "home",
    "//example.com/workspace",
    "https://example.com/workspace",
    "/\\example.com/workspace",
    "/workspace\nnext",
  ])("falls back for an unsafe return value: %s", (value) => {
    expect(safeInternalReturnPath(value)).toBe("/home");
  });

  it("supports an explicit internal fallback", () => {
    expect(safeInternalReturnPath("https://example.com", "/workspace")).toBe("/workspace");
  });
});

describe("signInHref", () => {
  it("encodes the interrupted route", () => {
    expect(signInHref("/outcomes/outcome-1?section=work")).toBe(
      "/sign-in?next=%2Foutcomes%2Foutcome-1%3Fsection%3Dwork",
    );
  });
});
