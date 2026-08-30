import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextSizeProvider, useTextSize } from "./TextSizeProvider";

function Probe() {
  const { textSize, setTextSize } = useTextSize();
  return (
    <div>
      <span data-testid="size">{textSize}</span>
      <button onClick={() => setTextSize("large")}>Large</button>
      <button onClick={() => setTextSize("larger")}>Larger</button>
      <button onClick={() => setTextSize("normal")}>Normal</button>
    </div>
  );
}

describe("TextSizeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("defaults to normal", () => {
    render(
      <TextSizeProvider>
        <Probe />
      </TextSizeProvider>,
    );
    expect(screen.getByTestId("size")).toHaveTextContent("normal");
  });

  it("switching size persists it and sets the attribute on <html>", () => {
    render(
      <TextSizeProvider>
        <Probe />
      </TextSizeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Larger" }));
    expect(screen.getByTestId("size")).toHaveTextContent("larger");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
    expect(localStorage.getItem("textSize")).toBe("larger");
  });

  it("reads a previously stored size on mount", () => {
    localStorage.setItem("textSize", "large");
    render(
      <TextSizeProvider>
        <Probe />
      </TextSizeProvider>,
    );
    expect(screen.getByTestId("size")).toHaveTextContent("large");
  });
});
