import deploymentContract from "../../../../supabase/deployment-contract.json";
import { getPublicSupabaseConfig } from "@/lib/supabase/public-config";

interface DeploymentFunctionEntry {
  clientRoute?: string | null;
  status?: string;
}

interface DeploymentContract {
  functions?: Record<string, DeploymentFunctionEntry>;
}

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "apikey",
  "authorization",
  "content-type",
  "origin",
  "user-agent",
  "x-client-info",
  "x-correlation-id",
  "x-idempotency-key",
  "x-request-id",
  "x-revenuecat-signature",
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  "content-disposition",
  "content-language",
  "content-type",
  "retry-after",
  "x-correlation-id",
  "x-request-id",
]);

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, Cookie",
};

export function activeClientRouteMap(
  contract: DeploymentContract = deploymentContract,
): ReadonlyMap<string, string> {
  const routes = new Map<string, string>();
  for (const [functionName, entry] of Object.entries(contract.functions ?? {})) {
    if (entry.status !== "active" || !entry.clientRoute) continue;
    if (!entry.clientRoute.startsWith("/api/") || routes.has(entry.clientRoute)) {
      throw new Error("The deployment contract contains an invalid or duplicate client route.");
    }
    routes.set(entry.clientRoute, functionName);
  }
  return routes;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        retryable: status >= 500,
        safe_next_action:
          status >= 500
            ? "Check the selected environment and try again."
            : "Return to the workspace and choose a supported action.",
      },
    },
    { status, headers: PRIVATE_RESPONSE_HEADERS },
  );
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers(PRIVATE_RESPONSE_HEADERS);
  for (const [name, value] of upstream.headers) {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

type StreamingRequestInit = RequestInit & { duplex: "half" };

export async function proxyEdgeFunctionRequest(
  request: Request,
  segments: readonly string[],
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const route = `/api/${segments.join("/")}`;
  const functionName = activeClientRouteMap().get(route);
  if (!functionName || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(functionName)) {
    return jsonError(404, "API_ROUTE_NOT_FOUND", "This application action is not available.");
  }

  let config;
  try {
    config = getPublicSupabaseConfig();
  } catch {
    return jsonError(
      503,
      "ENVIRONMENT_NOT_READY",
      "This application environment is not safely connected yet.",
    );
  }

  const incomingUrl = new URL(request.url);
  const target = new URL(`/functions/v1/${functionName}`, config.url);
  target.search = incomingUrl.search;
  const method = request.method.toUpperCase();
  const init: StreamingRequestInit = {
    body: method === "GET" || method === "HEAD" ? null : request.body,
    duplex: "half",
    headers: requestHeaders(request),
    method,
    redirect: "manual",
    signal: request.signal,
  };

  try {
    const upstream = await fetchImplementation(new Request(target, init));
    return new Response(method === "HEAD" ? null : upstream.body, {
      headers: responseHeaders(upstream),
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch {
    return jsonError(
      502,
      "APPLICATION_SERVICE_UNAVAILABLE",
      "The application service could not be reached safely.",
    );
  }
}
