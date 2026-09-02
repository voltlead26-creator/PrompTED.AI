import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/api", () => ({
  ensureApiConfigured: () => {
    events.push("api-configured");
  },
}));

function Passthrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

vi.mock("./QueryClientProvider", () => ({ QueryClientProvider: Passthrough }));
vi.mock("./AuthProvider", () => ({
  AuthProvider: Passthrough,
  useAuth: () => ({
    guestMigrationStatus: "idle",
    guestMigrationResult: null,
    retryGuestMigration: vi.fn(),
    confirmGuestMigration: vi.fn(),
    discardGuestMigration: vi.fn(),
  }),
}));
vi.mock("@/components/organisms/GuestMigrationNotice", () => ({
  GuestMigrationNotice: () => null,
}));
vi.mock("./MonitoringProvider", () => ({ MonitoringProvider: Passthrough }));
vi.mock("./ThemeProvider", () => ({ ThemeProvider: Passthrough }));
vi.mock("./TextSizeProvider", () => ({ TextSizeProvider: Passthrough }));
vi.mock("@/components/atoms/Toast", () => ({ ToastProvider: Passthrough }));

import { Providers } from "./index";

describe("Providers", () => {
  it("configures authenticated API access before a direct-route child renders", () => {
    function DirectRouteChild() {
      events.push("child-rendered");
      return <p>Direct route</p>;
    }

    render(
      <Providers>
        <DirectRouteChild />
      </Providers>,
    );

    expect(events).toEqual(["api-configured", "child-rendered"]);
  });
});
