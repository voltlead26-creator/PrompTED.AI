import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const { configureApiClient, captureOwnerAccessToken } = vi.hoisted(() => ({
  configureApiClient: vi.fn(),
  captureOwnerAccessToken: vi.fn(),
}));

vi.mock("@prompted/shared/api-client", () => ({ configureApiClient }));
vi.mock("@/lib/supabase/owner-client", () => ({ captureOwnerAccessToken }));

async function configuredClient() {
  const { ensureApiConfigured } = await import("./api");
  ensureApiConfigured();
  return configureApiClient.mock.calls[0]?.[0] as {
    baseUrl: string;
    getToken: typeof captureOwnerAccessToken;
  };
}

describe("ensureApiConfigured", () => {
  beforeEach(() => {
    vi.resetModules();
    configureApiClient.mockReset();
    captureOwnerAccessToken.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always uses the stable same-origin gateway", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://untrusted.example/functions");

    const configured = await configuredClient();

    expect(configured.baseUrl).toBe("/api");
  });

  it("delegates token capture with the exact immutable owner lease", async () => {
    const lease = testOwnerDispatchLease("user-1");
    captureOwnerAccessToken.mockResolvedValue("owner-bound-token");

    const configured = await configuredClient();

    await expect(configured.getToken(lease)).resolves.toBe("owner-bound-token");
    expect(captureOwnerAccessToken).toHaveBeenCalledWith(lease);
  });

  it("configures the shared client only once", async () => {
    const { ensureApiConfigured } = await import("./api");

    ensureApiConfigured();
    ensureApiConfigured();

    expect(configureApiClient).toHaveBeenCalledTimes(1);
  });
});
