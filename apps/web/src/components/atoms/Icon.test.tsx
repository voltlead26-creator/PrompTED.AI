import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";

describe("Icon critical symbol fallbacks", () => {
  it.each(["bookmark", "bookmark-filled"])(
    "renders a recognisable %s instead of the question-mark fallback",
    (name) => {
      const { container } = render(<Icon name={name} />);
      const paths = container.querySelectorAll("svg path");
      expect(paths).toHaveLength(1);
      expect(paths[0]).toHaveAttribute("d", "M6 3h12v18l-6-4-6 4Z");
      expect(container.querySelector("svg")).toHaveAttribute(
        "fill",
        name === "bookmark-filled" ? "currentColor" : "none",
      );
    },
  );

  it("renders a visible multiplication symbol for close controls", () => {
    render(<Icon name="x" label="Close preview" />);
    expect(screen.getByRole("img", { name: "Close preview" })).toHaveTextContent("×");
  });

  it("renders a visible plus symbol for upload controls", () => {
    render(<Icon name="plus" label="Upload document" />);
    expect(screen.getByRole("img", { name: "Upload document" })).toHaveTextContent("+");
  });

  it.each(["menu-2", "home", "file-pencil", "settings", "chevron-right"])(
    "renders the %s icon without relying on an external icon font",
    (name) => {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
      expect(container.querySelector("i.ti")).not.toBeInTheDocument();
    },
  );
});
