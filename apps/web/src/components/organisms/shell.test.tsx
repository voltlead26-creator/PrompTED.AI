import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";

const navigationMock = vi.hoisted(() => ({
  pathname: "/home",
  router: { refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMock.pathname,
  useRouter: () => navigationMock.router,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    [key: string]: unknown;
  }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

import { AppNav } from "./AppNav";
import { TopBar } from "./TopBar";
import { AuthProvider } from "@/components/providers/AuthProvider";

function WithAuth({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AppNav", () => {
  beforeEach(() => {
    navigationMock.pathname = "/home";
  });

  it("renders a navigation landmark", () => {
    render(<AppNav />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
  });

  it("renders all seven protected destinations", () => {
    render(<AppNav />);
    for (const label of [
      "Home",
      "Master Workspace",
      "My Work",
      "Checklists / Action Plans",
      "Find a Job",
      "Profile",
      "Settings",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeDefined();
    }
  });

  it("marks the active protected route with aria-current='page'", () => {
    navigationMock.pathname = "/settings/profile";
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBeNull();
  });

  it("maps outcome editor routes back to Master Workspace", () => {
    navigationMock.pathname = "/outcomes/outcome-1";
    render(<AppNav />);
    expect(
      screen.getByRole("link", { name: "Master Workspace" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("closes the mobile drawer when a destination is selected", () => {
    const onClose = vi.fn();
    render(<AppNav mobileOpen onClose={onClose} />);
    expect(fireEvent.click(screen.getByRole("link", { name: "Profile" }))).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(<AppNav mobileOpen />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("TopBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMock.pathname = "/home";
  });

  it("renders the logo link", async () => {
    render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );
    expect(await screen.findByRole("link", { name: /PrompTED.*home/i })).toBeDefined();
  });

  it("replaces the app wordmark with the current protected page title away from home", async () => {
    navigationMock.pathname = "/workspace";
    render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );

    expect(await screen.findByText("Master Workspace")).toBeDefined();
    expect(screen.queryByText("AI for the rest of us")).toBeNull();
  });

  it("uses Master Workspace for outcome editor routes", async () => {
    navigationMock.pathname = "/outcomes/outcome-1";
    render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );

    expect(await screen.findByText("Master Workspace")).toBeDefined();
  });

  it("uses My Work for the combined library", async () => {
    navigationMock.pathname = "/library";
    render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );

    expect(await screen.findByText("My Work")).toBeDefined();
  });

  it("distinguishes Profile from Settings", async () => {
    navigationMock.pathname = "/settings/profile";
    const { rerender } = render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );
    expect(await screen.findByText("Profile")).toBeDefined();

    navigationMock.pathname = "/settings";
    rerender(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );
    expect(await screen.findByText("Settings")).toBeDefined();
  });

  it("exposes the mobile menu control and reports its state", async () => {
    const onMenuToggle = vi.fn();
    render(
      <WithAuth>
        <TopBar mobileNavOpen onMenuToggle={onMenuToggle} />
      </WithAuth>,
    );
    const menu = await screen.findByRole("button", { name: /Close main menu/i });
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menu);
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps appearance controls out of the compact header", async () => {
    render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );
    await screen.findByRole("link", { name: /Sign in/i });
    expect(screen.queryByRole("button", { name: /Switch to .* mode/i })).toBeNull();
  });

  it("renders Sign in when unauthenticated", async () => {
    render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );
    expect(await screen.findByRole("link", { name: /Sign in/i })).toBeDefined();
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(
      <WithAuth>
        <TopBar />
      </WithAuth>,
    );
    await screen.findByRole("link", { name: /Sign in/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
