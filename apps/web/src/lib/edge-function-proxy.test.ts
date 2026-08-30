import { afterEach, describe, expect, it, vi } from "vitest";
import { activeClientRouteMap, proxyEdgeFunctionRequest } from "./edge-function-proxy";

const ORIGINAL_ENV = { ...process.env };
const PREVIEW_REF = "abcdefghijklmnopqrst";

function configurePreview() {
  process.env.NEXT_PUBLIC_APP_ENV = "preview";
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PREVIEW_REF}.supabase.co`;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-value";
  process.env.NEXT_PUBLIC_PRODUCTION_SUPABASE_PROJECT_REF = "jjsykocqpjlekgsbylkd";
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("environment-scoped Edge Function proxy", () => {
  it("derives active browser routes from the deployment contract", () => {
    const routes = activeClientRouteMap({
      functions: {
        clarify: { status: "active", clientRoute: "/api/clarify" },
        dormant: { status: "dormant", clientRoute: "/api/dormant" },
        internal: { status: "active", clientRoute: null },
      },
    });

    expect([...routes]).toEqual([["/api/clarify", "clarify"]]);
  });

  it("forwards an allowed route to the selected environment without exposing cookies", async () => {
    configurePreview();
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("event: progress\n\n", {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Set-Cookie": "must-not-leak=true",
        },
      }),
    );
    const request = new Request("https://preview.example/api/document-operation?operation_id=op-1", {
      headers: {
        Authorization: "Bearer user-token",
        Cookie: "private-session=value",
        Origin: "https://preview.example",
      },
    });

    const response = await proxyEdgeFunctionRequest(
      request,
      ["document-operation"],
      upstream,
    );
    const forwarded = upstream.mock.calls[0]?.[0] as Request;

    expect(forwarded.url).toBe(
      `https://${PREVIEW_REF}.supabase.co/functions/v1/document-operation?operation_id=op-1`,
    );
    expect(forwarded.headers.get("authorization")).toBe("Bearer user-token");
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("does not call upstream for an unknown or dormant route", async () => {
    configurePreview();
    const upstream = vi.fn<typeof fetch>();
    const response = await proxyEdgeFunctionRequest(
      new Request("https://preview.example/api/openai-responses"),
      ["openai-responses"],
      upstream,
    );

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("fails closed before upstream when the environment binding is unsafe", async () => {
    configurePreview();
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://jjsykocqpjlekgsbylkd.supabase.co";
    const upstream = vi.fn<typeof fetch>();
    const response = await proxyEdgeFunctionRequest(
      new Request("https://preview.example/api/clarify"),
      ["clarify"],
      upstream,
    );

    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ENVIRONMENT_NOT_READY" },
    });
  });

  it("normalizes upstream network failures without leaking internals", async () => {
    configurePreview();
    const response = await proxyEdgeFunctionRequest(
      new Request("https://preview.example/api/clarify", { method: "POST", body: "{}" }),
      ["clarify"],
      vi.fn<typeof fetch>().mockRejectedValue(new Error("private upstream detail")),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private upstream detail");
  });
});
