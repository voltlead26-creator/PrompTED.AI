import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Probe() {
  const { theme, themeMode, setThemeMode } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="mode">{themeMode}</span>
      <button onClick={() => setThemeMode("light")}>Light</button>
      <button onClick={() => setThemeMode("dark")}>Dark</button>
      <button onClick={() => setThemeMode("system")}>System</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("defaults to system mode following the OS preference", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("system");
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("switching to dark persists the choice and applies it to the document", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("switching back to system clears the stored override", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(localStorage.getItem("theme")).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(localStorage.getItem("theme")).toBeNull();
    expect(screen.getByTestId("mode")).toHaveTextContent("system");
  });
});
