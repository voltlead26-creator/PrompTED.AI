// PrompTED brand-logo lifecycle command.
// Authentication, bounded multipart parsing, and owner context are resolved
// before the durable handler can claim or mutate Storage.

import {
  type AuthContext,
  AuthError,
  guardRequest,
} from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { handleBrandLogo } from "./handler.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      origin,
    );
  }

  let auth: AuthContext;
  try {
    auth = await guardRequest(req, {
      enforceCap: false,
      rateLimitOperation: "brand-logo",
      rateLimitLimit: 20,
      rateLimitWindowSeconds: 60,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(
      { error: { code: "BRAND_LOGO_UNAVAILABLE", message: "Something went wrong." } },
      500,
      origin,
    );
  }
  return await handleBrandLogo(req, auth);
});
