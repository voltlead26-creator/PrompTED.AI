import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  requestGroundedResearch,
  ResearchGroundingError,
} from "../_shared/research-grounding.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      req.headers.get("origin"),
    );
  }

  const origin = req.headers.get("origin");
  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  try {
    const body = auth.body ?? {};
    const query = String(body.query || "").trim().slice(0, 2_000);
    if (!query) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_QUERY",
            message: "A research query is required.",
          },
        },
        400,
        origin,
      );
    }
    const categories = Array.isArray(body.categories)
      ? body.categories.join(", ")
      : "general";
    const timezone = String(body.timezone || "Australia/Melbourne");
    const locale = String(body.locale || "en-AU");

    const result = await requestGroundedResearch({
      systemPrompt:
        "You are TED's approved live-source research helper. Return only current claims that are supported by the web-search sources consulted for this response. Every claim must cite one or more exact source URLs in source_urls. Do not guess or ask the user to paste public source material.",
      messages: [
        {
          role: "user",
          content:
            `Query: ${query}\nCategories: ${categories}\nLocale: ${locale}\nTimezone: ${timezone}\nReturn the best current source context for an assistant answer.`,
        },
      ],
      maxTokens: 1200,
      signal: req.signal,
    });
    return jsonResponse(
      {
        text: result.text,
        claims: result.claims,
        sources: result.sources,
      },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof ResearchGroundingError) {
      return jsonResponse(USER_SAFE_ERROR, 502, origin);
    }
    const message = error instanceof Error ? error.message : "unknown";
    return jsonResponse(
      USER_SAFE_ERROR,
      /abort|timeout/i.test(message) ? 504 : 500,
      origin,
    );
  }
});
