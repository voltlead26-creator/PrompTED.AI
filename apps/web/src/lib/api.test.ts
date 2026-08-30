import { beforeEach, describe, expect, it, vi } from "vitest";

const { configureApiClient, createClient, getSession, refreshSession } =
  vi.hoisted(() => ({
    configureApiClient: vi.fn(),
    createClient: vi.fn(),
    getSession: vi.fn(),
    refreshSession: vi.fn(),
  }));

vi.mock("@prompted/shared/api-client", () => ({ configureApiClient }));
vi.mock("@/lib/supabase/client", () => ({ createClient }));

async function getConfiguredToken(): Promise<() => Promise<string | null>> {
  const { ensureApiConfigured } = await import("./api");
  ensureApiConfigured();
  const configured = configureApiClient.mock.calls[0]?.[0] as {
    getToken: () => Promise<string | null>;
  };
  return configured.getToken;
}

describe("ensureApiConfigured", () => {
  beforeEach(() => {
    vi.resetModules();
    configureApiClient.mockReset();
    createClient.mockReset();
    getSession.mockReset();
    refreshSession.mockReset();
    createClient.mockReturnValue({
      auth: { getSession, refreshSession },
    });
  });

  it("returns the cached access token directly when it is not near expiry", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "fresh-access-token",
          refresh_token: "refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });

    const getToken = await getConfiguredToken();

    await expect(getToken()).resolves.toBe("fresh-access-token");
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes a session that is expired or about to expire before returning a token", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "stale-access-token",
          refresh_token: "refresh-token",
          expires_at: Math.floor(Date.now() / 1000) - 5,
        },
      },
      error: null,
    });
    refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "fresh-access-token",
          refresh_token: "next-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
        user: { id: "user-1" },
      },
      error: null,
    });

    const getToken = await getConfiguredToken();

    await expect(getToken()).resolves.toBe("fresh-access-token");
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no session at all", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    const getToken = await getConfiguredToken();

    await expect(getToken()).resolves.toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("returns null when refreshing an expiring session fails", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "stale-access-token",
          refresh_token: "refresh-token",
          expires_at: Math.floor(Date.now() / 1000) - 5,
        },
      },
      error: null,
    });
    refreshSession.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error("refresh token already used"),
    });

    const getToken = await getConfiguredToken();

    await expect(getToken()).resolves.toBeNull();
  });
});
