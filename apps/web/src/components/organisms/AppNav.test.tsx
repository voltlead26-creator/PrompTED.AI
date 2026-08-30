import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppNav } from "./AppNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/plans",
}));

describe("AppNav", () => {
  it("exposes all seven protected destinations in the approved order", () => {
    render(<AppNav />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const primaryLinks = within(nav).getAllByRole("link").slice(0, 7);

    expect(primaryLinks.map((link) => link.textContent?.trim())).toEqual([
      "Home",
      "Master Workspace",
      "My Work",
      "Checklists / Action Plans",
      "Find a Job",
      "Profile",
      "Settings",
    ]);
    expect(primaryLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/home",
      "/workspace",
      "/library",
      "/plans",
      "/roles",
      "/settings/profile",
      "/settings",
    ]);
  });

  it("marks the current protected route active", () => {
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "Checklists / Action Plans" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("clips wide destination links to the collapsed desktop rail", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/components/organisms/AppNav.module.css", "utf8");
    document.head.append(style);

    const navRule = Array.from(style.sheet?.cssRules ?? []).find(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".nav",
    );
    expect(navRule?.style.overflow).toBe("hidden");

    const openCreateRule = Array.from(style.sheet?.cssRules ?? []).find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === ".nav:has(.createMenu[open])",
    );
    expect(openCreateRule?.style.overflow).toBe("visible");

    style.remove();
  });

  it("keeps creation secondary to the seven protected destinations", () => {
    render(<AppNav />);
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Document" })).toHaveAttribute("href", "/create");
    expect(screen.getByRole("link", { name: "Checklist / Action Plan" })).toHaveAttribute(
      "href",
      "/plans?create=ted",
    );
    expect(screen.getByRole("link", { name: "Upload to Master Workspace" })).toHaveAttribute(
      "href",
      "/workspace",
    );
  });
});
