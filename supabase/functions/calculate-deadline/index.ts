import {
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";
import {
  assertBusinessDays,
  calculateBusinessDeadline,
} from "../_shared/public-holidays.ts";

interface DeadlineRequest {
  startDate?: unknown;
  businessDays?: unknown;
  countryCode?: unknown;
  subdivisionCode?: unknown;
}

function parseRequest(body: unknown): {
  startDate: string;
  businessDays: number;
  countryCode: string;
  subdivisionCode?: string;
} {
  if (!body || typeof body !== "object") {
    throw new Error("A JSON request body is required.");
  }
  const input = body as DeadlineRequest;
  if (typeof input.startDate !== "string") {
    throw new Error("startDate is required.");
  }
  if (!Number.isInteger(input.businessDays)) {
    throw new Error("businessDays must be an integer.");
  }
  const businessDays = Number(input.businessDays);
  assertBusinessDays(businessDays);
  const countryCode = typeof input.countryCode === "string"
    ? input.countryCode.trim().toUpperCase()
    : "AU";
  const subdivisionCode = typeof input.subdivisionCode === "string"
    ? input.subdivisionCode.trim().toUpperCase()
    : undefined;

  return {
    startDate: input.startDate,
    businessDays,
    countryCode,
    subdivisionCode,
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
    const result = await calculateBusinessDeadline(input);
    return jsonResponse(
      {
        data: {
          ...result,
          startDate: input.startDate,
          businessDays: input.businessDays,
          countryCode: input.countryCode,
          subdivisionCode: input.subdivisionCode ?? null,
        },
        source: "nager-date-v4",
      },
      200,
      origin,
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Deadline calculation failed.";
    console.error("DEADLINE_CALCULATION_ERROR", { message });
    return jsonResponse(
      {
        error: {
          code: "DEADLINE_CALCULATION_FAILED",
          message,
        },
      },
      400,
      origin,
    );
  }
});
