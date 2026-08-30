import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";

describe("Icon critical symbol fallbacks", () => {
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
