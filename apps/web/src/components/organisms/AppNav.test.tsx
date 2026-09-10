import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppNav } from "./AppNav";

const navigation = vi.hoisted(() => ({ pathname: "/plans" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

describe("AppNav", () => {
  beforeEach(() => { navigation.pathname = "/plans"; });

  async function openCreate() {
    const summary = screen.getByText("Create").closest("summary")!;
    await userEvent.click(summary);
    const menu = summary.closest("details")!;
    expect(menu.open).toBe(true);
    return { summary, menu };
  }

  it("dismisses Create on an outside pointer without consuming the outside action", async () => {
    const outsideAction = vi.fn();
    render(<><AppNav /><button onClick={outsideAction}>Choose a file</button></>);
    const { menu } = await openCreate();
    await userEvent.click(screen.getByRole("button", { name: "Choose a file" }));
    expect(menu.open).toBe(false);
    expect(outsideAction).toHaveBeenCalledOnce();
  });

  it("dismisses on Escape and returns focus to Create", async () => {
    render(<AppNav />);
    const { summary, menu } = await openCreate();
    screen.getByRole("link", { name: "Document" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(menu.open).toBe(false);
    expect(summary).toHaveFocus();
  });

  it("dismisses when keyboard focus leaves Create", async () => {
    render(<><AppNav /><button>Outside</button></>);
    const { menu } = await openCreate();
    screen.getByRole("button", { name: "Outside" }).focus();
    expect(menu.open).toBe(false);
  });

  it("keeps Create open for pointer and focus inside, and toggles closed on its trigger", async () => {
    render(<AppNav />);
    const { summary, menu } = await openCreate();
    const link = screen.getByRole("link", { name: "Document" });
    fireEvent.pointerDown(link);
    link.focus();
    expect(menu.open).toBe(true);
    await userEvent.click(summary);
    expect(menu.open).toBe(false);
  });

  it("closes when a Create destination is selected even on the same pathname", async () => {
    navigation.pathname = "/workspace";
    const onClose = vi.fn();
    render(<AppNav onClose={onClose} />);
    const { menu } = await openCreate();
    const link = screen.getByRole("link", { name: "Upload to Master Workspace" });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(menu.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a route change while the navigation remains mounted", async () => {
    const { rerender } = render(<AppNav />);
    const { menu } = await openCreate();
    navigation.pathname = "/roles";
    rerender(<AppNav />);
    expect(menu.open).toBe(false);
  });

  it("does not reopen a stale Create panel when the mobile drawer reopens", async () => {
    const { rerender } = render(<AppNav mobileOpen />);
    const { menu } = await openCreate();
    rerender(<AppNav mobileOpen={false} />);
    rerender(<AppNav mobileOpen />);
    expect(menu.open).toBe(false);
  });

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
