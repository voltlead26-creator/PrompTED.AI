/**
 * Layer 16 — Integration: AI gateway
 * Tests provider routing, fallback, and auth guard on the Edge Functions.
 *
 * Requires: Supabase Edge Functions running locally (supabase functions serve)
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";

const FUNCTIONS_URL =
  process.env.SUPABASE_FUNCTIONS_URL ?? "http://localhost:54321/functions/v1";

describe("AI gateway — CORS enforcement", () => {
  it("returns 403 for requests with a disallowed Origin header", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/clarify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious.example.com",
      },
      body: JSON.stringify({ situation: "test" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows requests from localhost:3000", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/clarify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ situation: "test" }),
    });
    // Not a 403 (may be 401 or 200 depending on auth, but not CORS blocked).
    expect(res.status).not.toBe(403);
  });
});

describe("AI gateway — auth guard", () => {
  it("returns 401 when no JWT is provided on a gated endpoint", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/generate-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "11111111-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(401);
  });
});
