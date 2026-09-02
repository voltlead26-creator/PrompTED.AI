// =====================================================
// PrompTED — CORS
// Restricts browser origins to an exact environment-owned allow-list.
// Production has no implicit historical or localhost origins.
// =====================================================

const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
];

export function allowedOriginsForEnvironment(
  configured: string | undefined,
  environment: string | undefined,
): string[] {
  const configuredOrigins = (configured ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error("ALLOWED_ORIGINS contains an invalid URL.");
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(
          "ALLOWED_ORIGINS must contain exact HTTP(S) origins only.",
        );
      }
      return parsed.origin;
    });
  const deployment = (environment ?? "").trim().toLowerCase();
  const localOrigins = ["local", "development", "test"].includes(deployment)
    ? LOCAL_ORIGINS
    : [];
  return Array.from(new Set([...configuredOrigins, ...localOrigins]));
}

function getAllowedOrigins(): string[] {
  return allowedOriginsForEnvironment(
    Deno.env.get("ALLOWED_ORIGINS"),
    Deno.env.get("PROMPTED_DEPLOYMENT_ENV"),
  );
}

export function privateResponseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "Vary": "Authorization, Cookie, Origin",
  };
}

export function corsHeaders(origin: string | null): HeadersInit {
  const allowed = getAllowedOrigins();
  const headers: Record<string, string> = {
    ...privateResponseHeaders(),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-idempotency-key, x-request-id",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/**
 * Returns a 403 if the request's Origin header is present but not in the
 * allowed list. Requests without an Origin header (server-to-server, mobile)
 * are allowed through.
 */
export function rejectForbiddenOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null; // non-browser caller — allow
  const allowed = getAllowedOrigins();
  if (!allowed.includes(origin)) {
    return new Response(
      JSON.stringify({
        error: { code: "FORBIDDEN_ORIGIN", message: "Origin not allowed." },
      }),
      {
        status: 403,
        headers: {
          ...privateResponseHeaders(),
          "Content-Type": "application/json",
        },
      },
    );
  }
  return null;
}

export function handleOptions(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  const forbidden = rejectForbiddenOrigin(req);
  if (forbidden) return forbidden;
  const origin = req.headers.get("origin");
  return new Response("ok", { status: 200, headers: corsHeaders(origin) });
}

export function jsonResponse(
  body: unknown,
  status = 200,
  origin: string | null = null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
