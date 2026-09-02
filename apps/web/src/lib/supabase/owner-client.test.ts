import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureOwnerDispatch,
  recordBrowserPrincipal,
} from "@/lib/browser-principal-state";

const { createDataClient, createSessionClient, getSession, refreshSession } = vi.hoisted(
  () => ({
    createDataClient: vi.fn(),
    createSessionClient: vi.fn(),
    getSession: vi.fn(),
    refreshSession: vi.fn(),
  }),
);

vi.mock("@supabase/supabase-js", () => ({ createClient: createDataClient }));
vi.mock("./client", () => ({ createClient: createSessionClient }));
vi.mock("./public-config", () => ({
  getPublicSupabaseConfig: () => ({
    url: "https://project.supabase.co",
    anonKey: "public-anon-key",
  }),
}));

import { captureOwnerAccessToken, withOwnerSupabase } from "./owner-client";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function accessToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${payload}.signature`;
}

function session(subject = USER_A, lifetimeSeconds = 3600) {
  return {
    access_token: accessToken(subject),
    expires_at: Math.floor(Date.now() / 1000) + lifetimeSeconds,
    user: { id: subject },
  };
}

describe("owner-scoped Supabase transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordBrowserPrincipal(USER_A);
    createSessionClient.mockReturnValue({
      auth: { getSession, refreshSession },
    });
    getSession.mockResolvedValue({ data: { session: session() }, error: null });
    createDataClient.mockReturnValue({ rpc: vi.fn() });
  });

  afterEach(() => {
    recordBrowserPrincipal(undefined);
    vi.unstubAllGlobals();
  });

  it("captures only a token whose session and JWT subject match the lease", async () => {
    const lease = captureOwnerDispatch(USER_A);

    await expect(captureOwnerAccessToken(lease)).resolves.toBe(accessToken(USER_A));
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("fails closed near expiry without mutating the persistent Auth singleton", async () => {
    getSession.mockResolvedValue({ data: { session: session(USER_A, 1) }, error: null });
    const lease = captureOwnerDispatch(USER_A);

    await expect(captureOwnerAccessToken(lease)).rejects.toMatchObject({
      code: "OWNER_DISPATCH_STALE",
    });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("rejects a result from an A session read after the browser changes to B", async () => {
    let resolveSession!: (value: unknown) => void;
    getSession.mockReturnValue(new Promise((resolve) => {
      resolveSession = resolve;
    }));
    const lease = captureOwnerDispatch(USER_A);
    const pending = captureOwnerAccessToken(lease);

    recordBrowserPrincipal(USER_B);
    resolveSession({ data: { session: session(USER_A) }, error: null });

    await expect(pending).rejects.toMatchObject({ code: "OWNER_DISPATCH_STALE" });
    expect(createDataClient).not.toHaveBeenCalled();
  });

  it("constructs one non-persistent client with the exact captured bearer", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
    createDataClient.mockReturnValue({ rpc });
    const lease = captureOwnerDispatch(USER_A);

    await expect(
      withOwnerSupabase(lease, async (client) =>
        await client.rpc("owner_operation"),
      ),
    ).resolves.toEqual({ data: "ok", error: null });

    const options = createDataClient.mock.calls[0]?.[2];
    expect(options).toEqual(expect.objectContaining({
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: expect.objectContaining({
        headers: { Authorization: `Bearer ${accessToken(USER_A)}` },
        fetch: expect.any(Function),
      }),
      accessToken: expect.any(Function),
    }));
    await expect(options.accessToken()).resolves.toBe(accessToken(USER_A));
  });

  it("refuses owner-bound requests sent to another origin", async () => {
    const lease = captureOwnerDispatch(USER_A);
    await withOwnerSupabase(lease, async () => undefined);
    const ownerFetch = createDataClient.mock.calls[0]?.[2]?.global?.fetch as typeof fetch;

    await expect(ownerFetch("https://example.com/rest/v1/outcomes", {
      headers: { Authorization: `Bearer ${accessToken(USER_A)}` },
    })).rejects.toThrow("OWNER_SUPABASE_ORIGIN_MISMATCH");
  });

  it("combines caller cancellation without requiring AbortSignal.any", async () => {
    const originalAny = AbortSignal.any;
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: undefined,
    });
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", transport);

    try {
      const lease = captureOwnerDispatch(USER_A);
      await withOwnerSupabase(lease, async () => undefined);
      const ownerFetch = createDataClient.mock.calls[0]?.[2]?.global?.fetch as typeof fetch;
      const callerController = new AbortController();

      await ownerFetch("https://project.supabase.co/rest/v1/outcomes", {
        headers: { Authorization: `Bearer ${accessToken(USER_A)}` },
        signal: callerController.signal,
      });

      const combined = transport.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(combined).not.toBe(callerController.signal);
      expect(combined).not.toBe(lease.signal);
      expect(combined.aborted).toBe(false);

      callerController.abort(new Error("caller cancelled"));
      expect(combined.aborted).toBe(true);
      expect(combined.reason).toEqual(new Error("caller cancelled"));
    } finally {
      Object.defineProperty(AbortSignal, "any", {
        configurable: true,
        value: originalAny,
      });
    }
  });
});
