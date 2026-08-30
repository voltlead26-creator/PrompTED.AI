import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlansCreatePanel } from "./PlansCreatePanel";

describe("PlansCreatePanel", () => {
  it("offers TED, manual and template creation as first-class choices", () => {
    render(<PlansCreatePanel />);

    expect(screen.getByRole("link", { name: /Create with TED/i })).toHaveAttribute(
      "href",
      "/create?intent=checklist-action-plan",
    );
    expect(screen.getByRole("link", { name: /Create manually/i })).toHaveAttribute(
      "href",
      "/plans?create=manual",
    );
    expect(screen.getByRole("link", { name: /Start from template/i })).toHaveAttribute(
      "href",
      "/create?intent=plan-template",
    );
  });
});
