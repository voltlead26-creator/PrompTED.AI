// =====================================================
// PrompTED — generate-report
// Produces an analytical report from uploaded source material.
// Streams SSE so long reports arrive progressively.
// =====================================================

import { handleOptions, jsonResponse, corsHeaders } from "../_shared/cors.ts";
import { guardRequest, AuthError } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt, type Domain } from "../_shared/prompt-builder.ts";
import { trackDocumentCreated } from "../_shared/cost-tracker.ts";
import { sseEvent, sseDone, SSE_HEADERS } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";

interface ReportBody {
  situation?: string;
  domain?: Domain;
  extracted_text?: string;
}

const REPORT_SECTIONS = [
  { key: "summary", label: "Executive Summary" },
  { key: "findings", label: "Key Findings" },
  { key: "analysis", label: "Analysis" },
  { key: "recommendations", label: "Recommendations" },
];

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405, origin);
  }

  let auth;
  try {
    auth = await guardRequest(req, true);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(err.payload, err.status, origin);
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  let body: ReportBody;
  try {
    body = auth.body as unknown as ReportBody;
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, origin);
  }

  const extracted = String(body.extracted_text ?? "").slice(0, 40000).trim();
  if (!extracted) {
    return jsonResponse(
      { error: { message: "extracted_text is required for a report" } },
      400,
      origin,
    );
  }
  const situation = String(body.situation ?? "").slice(0, 20000).trim();

  const memory = await loadUserMemoryContext(auth.admin, auth.userId);
  const systemPrompt = buildSystemPrompt({
    task: "document",
    domain: body.domain,
    extra: `You are producing an analytical report grounded strictly in the supplied source material.
Do not fabricate figures or facts not present in the source.
Sections (use exactly these): ${REPORT_SECTIONS.map((s) => s.label).join(", ")}.

${memory}`.trim(),
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const section of REPORT_SECTIONS) {
          const userContent = [
            situation && `Context: ${situation}`,
            `Source material:\n${extracted}`,
            `Write the "${section.label}" section now, using only the source material. Return markdown only.`,
          ]
            .filter(Boolean)
            .join("\n\n");

          const result = await routeRequest({
            task: "document",
            systemPrompt,
            messages: [{ role: "user", content: userContent }],
            maxTokens: 1500,
            signal: req.signal,
          });

          controller.enqueue(
            sseEvent({
              type: "section",
              key: section.key,
              label: section.label,
              content: result.text,
            }),
          );
        }
        // Charge only after every section streamed successfully.
        if (auth.userId !== "anonymous") {
          trackDocumentCreated(auth.admin, {
            userId: auth.userId,
            task: "report",
            provider: "gateway",
            inputTokens: 0,
            outputTokens: 0,
          });
        }

        controller.enqueue(sseDone());
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        controller.enqueue(
          sseEvent({ type: "error", ...USER_SAFE_ERROR, detail_code: /abort/i.test(message) ? "aborted" : "failed" }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders(origin), ...SSE_HEADERS },
  });
});
