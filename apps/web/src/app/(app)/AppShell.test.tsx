import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const navigation = vi.hoisted(() => ({ pathname: "/workspace" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: null, loading: false }) }));

describe("responsive app navigation", () => {
  let resize: (() => void) | undefined;
  let mobile = true;

  beforeEach(() => {
    navigation.pathname = "/workspace";
    mobile = true;
    resize = undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return mobile; },
      addEventListener: (_type: string, listener: () => void) => { resize = listener; },
      removeEventListener: () => { resize = undefined; },
    })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

  async function openMenu() {
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Open main menu" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Main menu" });
    const close = within(dialog).getAllByRole("button", { name: "Close navigation" })
      .find(button => button.tabIndex !== -1)!;
    return { user, trigger, dialog, close };
  }

  it("moves focus into the drawer and keeps both Tab directions inside", async () => {
    render(<AppShell><button>Document action</button></AppShell>);
    const { user, dialog, close } = await openMenu();
    expect(close).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    await user.tab({ shift: true });
    expect(within(dialog).getByText("Create").closest("summary")).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("dismisses Create first, then closes the drawer and restores focus and scroll", async () => {
    document.body.style.overflow = "clip";
    render(<AppShell><button>Document action</button></AppShell>);
    const { user, trigger, dialog } = await openMenu();
    expect(document.body.style.overflow).toBe("hidden");
    const summary = within(dialog).getByText("Create").closest("summary")!;
    await user.click(summary);
    within(dialog).getByRole("link", { name: /^Document$/ }).focus();
    await user.keyboard("{Escape}");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(dialog).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("clip");
    document.body.style.overflow = "";
  });

  it("includes the expanded Create destinations in the focus loop", async () => {
    render(<AppShell>Workspace</AppShell>);
    const { user, dialog, close } = await openMenu();
    await user.click(within(dialog).getByText("Create"));
    within(dialog).getByRole("link", { name: "Upload to Master Workspace" }).focus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("clears the mobile overlay on desktop resize without leaving content inert", async () => {
    render(<AppShell>Workspace</AppShell>);
    await openMenu();
    act(() => { mobile = false; resize?.(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    expect(screen.getByRole("link", { name: /^Master Workspace$/ })).toHaveFocus();
    act(() => { mobile = true; resize?.(); });
    expect(screen.getByRole("button", { name: "Open main menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes after a destination is selected and after a programmatic route change", async () => {
    const view = render(<AppShell>Workspace</AppShell>);
    const { dialog } = await openMenu();
    const destination = within(dialog).getByRole("link", { name: "My Work" });
    destination.addEventListener("click", event => event.preventDefault());
    fireEvent.click(destination);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openMenu();
    navigation.pathname = "/library";
    view.rerender(<AppShell>Library</AppShell>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
