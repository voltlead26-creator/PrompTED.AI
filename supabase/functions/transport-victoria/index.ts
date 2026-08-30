import {
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";
import { ptvClientFromEnv } from "../_shared/ptv-client.ts";

type TransportAction =
  | "search"
  | "departures"
  | "nearby"
  | "disruptions"
  | "route-types";

interface TransportRequest {
  action: TransportAction;
  searchTerm?: string;
  routeType?: number;
  stopId?: number;
  latitude?: number;
  longitude?: number;
  maxDistance?: number;
  maxResults?: number;
  dateUtc?: string;
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function parseRequest(body: unknown): TransportRequest {
  if (!body || typeof body !== "object") throw new Error("A JSON request body is required.");
  const input = body as Record<string, unknown>;
  const action = input.action;
  const allowed: TransportAction[] = [
    "search",
    "departures",
    "nearby",
    "disruptions",
    "route-types",
  ];
  if (typeof action !== "string" || !allowed.includes(action as TransportAction)) {
    throw new Error("Unsupported transport action.");
  }

  return {
    action: action as TransportAction,
    searchTerm: typeof input.searchTerm === "string" ? input.searchTerm.trim() : undefined,
    routeType: integerInRange(input.routeType, 0, 6),
    stopId: integerInRange(input.stopId, 1, Number.MAX_SAFE_INTEGER),
    latitude: finiteNumber(input.latitude, "latitude"),
    longitude: finiteNumber(input.longitude, "longitude"),
    maxDistance: finiteNumber(input.maxDistance, "maxDistance"),
    maxResults: integerInRange(input.maxResults, 1, 50),
    dateUtc: typeof input.dateUtc === "string" ? input.dateUtc : undefined,
  };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const forbidden = rejectForbiddenOrigin(req);
  if (forbidden) return forbidden;

  const origin = req.headers.get("origin");
  if (req.method !== "POST") {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
      405,
      origin,
    );
  }

  try {
    const input = parseRequest(await req.json());
    const ptv = ptvClientFromEnv();
    let data: unknown;

    switch (input.action) {
      case "route-types":
        data = await ptv.get("/v3/route_types");
        break;

      case "search": {
        if (!input.searchTerm || input.searchTerm.length < 2) {
          throw new Error("searchTerm must contain at least two characters.");
        }
        data = await ptv.get(
          `/v3/search/${encodeURIComponent(input.searchTerm)}`,
          {
            route_types: input.routeType,
            latitude: input.latitude,
            longitude: input.longitude,
            max_distance: input.maxDistance,
            include_outlets: false,
            match_stop_by_suburb: true,
          },
        );
        break;
      }

      case "nearby": {
        if (input.latitude === undefined || input.longitude === undefined) {
          throw new Error("latitude and longitude are required.");
        }
        data = await ptv.get(
          `/v3/stops/location/${input.latitude},${input.longitude}`,
          {
            route_types: input.routeType,
            max_distance: input.maxDistance ?? 1500,
            max_results: input.maxResults ?? 10,
          },
        );
        break;
      }

      case "departures": {
        if (input.routeType === undefined || input.stopId === undefined) {
          throw new Error("routeType and stopId are required.");
        }
        data = await ptv.get(
          `/v3/departures/route_type/${input.routeType}/stop/${input.stopId}`,
          {
            date_utc: input.dateUtc,
            max_results: input.maxResults ?? 10,
            include_cancelled: true,
          },
        );
        break;
      }

      case "disruptions":
        data = input.routeType === undefined
          ? await ptv.get("/v3/disruptions")
          : await ptv.get(`/v3/disruptions/route_type/${input.routeType}`);
        break;
    }

    return jsonResponse({ data, source: "ptv-v3" }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transport lookup failed.";
    const configurationFailure = message.includes("credentials are not configured");
    console.error("TRANSPORT_VICTORIA_ERROR", { message });
    return jsonResponse(
      {
        error: {
          code: configurationFailure ? "TRANSPORT_NOT_CONFIGURED" : "TRANSPORT_LOOKUP_FAILED",
          message: configurationFailure
            ? "Public transport information is temporarily unavailable."
            : message,
        },
      },
      configurationFailure ? 503 : 400,
      origin,
    );
  }
});
