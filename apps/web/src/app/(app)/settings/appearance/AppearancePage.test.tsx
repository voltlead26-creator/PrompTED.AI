import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TextSizeProvider } from "@/components/providers/TextSizeProvider";
import AppearancePage from "./page";

function renderPage() {
  return render(
    <ThemeProvider>
      <TextSizeProvider>
        <AppearancePage />
      </TextSizeProvider>
    </ThemeProvider>,
  );
}

describe("AppearancePage", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-text-size");
  });

  it("renders theme and text size controls", () => {
    renderPage();
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Text size" })).toBeInTheDocument();
  });

  it("selecting Dark marks it checked and applies the attribute", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: /dark/i }));
    expect(screen.getByRole("radio", { name: /dark/i })).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("selecting Larger marks it checked and applies the attribute", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: /larger/i }));
    expect(screen.getByRole("radio", { name: /larger/i })).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
  });
});
