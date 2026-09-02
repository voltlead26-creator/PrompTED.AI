// =====================================================
// PrompTED - ingest-upload
// Authenticated, exactly replayable upload extraction and classification.
// =====================================================

import {
  type AuthContext,
  AuthError,
  guardRequest,
} from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { handleIngestUpload } from "./handler.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  let auth: AuthContext;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(
      { error: { message: "Something went wrong." } },
      500,
      origin,
    );
  }

  return await handleIngestUpload(req, auth);
});
