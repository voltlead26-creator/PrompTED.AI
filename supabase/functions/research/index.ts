// =====================================================
// PrompTED — Research Function
// Grounded web search for document content.
// Extends the existing live-source function with auth-guard.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt } from "../_shared/prompt-builder.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import {
  requestGroundedResearch,
  ResearchGroundingError,
} from "../_shared/research-grounding.ts";

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

  // Research is callable for authenticated users only (avoids scraping abuse).
  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  try {
    const body = auth.body ?? {};
    const query = String(body.query ?? "").slice(0, 2000).trim();
    if (!query) {
      return jsonResponse(
        { error: { message: "query is required" } },
        400,
        origin,
      );
    }

    const locale = String(body.locale ?? "en-AU");
    const timezone = String(body.timezone ?? "Australia/Melbourne");
    const categories = Array.isArray(body.categories)
      ? (body.categories as string[]).join(", ")
      : "general";

    const memory = await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "research",
      extra: [
        memory,
        `Return concise, source-grounded context only.
Include source names or URLs when available.
Do not ask the user to paste public source material.
If you cannot find a reliable current source, say so clearly rather than guessing.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const result = await requestGroundedResearch({
      systemPrompt,
      messages: [
        {
          role: "user",
          content:
            `Query: ${query}\nCategories: ${categories}\nLocale: ${locale}\nTimezone: ${timezone}\nReturn the best current source context for this query.`,
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
        route: {
          semantic_route: result.routeSnapshot.semanticRoute,
          routing_version: result.routeSnapshot.routingVersion,
          model: result.routeSnapshot.model,
        },
      },
      200,
      origin,
    );
  } catch (err) {
    if (err instanceof ResearchGroundingError) {
      return jsonResponse(USER_SAFE_ERROR, 502, origin);
    }
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
