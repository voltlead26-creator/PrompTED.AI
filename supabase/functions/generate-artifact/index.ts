import { handleOptions, jsonResponse, corsHeaders } from "../_shared/cors.ts";
import { guardRequest, AuthError } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { runTedArtifactPipeline, type ArtifactKind } from "../_shared/ted-artifact-pipeline.ts";
import { sseEvent, sseDone, SSE_HEADERS } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import { inheritModelCallContext } from "../_shared/model-call-context.ts";

const KINDS = new Set(["document", "action_plan", "checklist", "report", "recommendation", "research_brief", "job_match"]);

function rolloutEnabled(kind: string, outcomeId: string): boolean {
  const enabled = (Deno.env.get("TED_PIPELINE_V2_WORKFLOWS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!enabled.includes(kind) && !enabled.includes("all")) return false;
  const percent = Math.max(0, Math.min(100, Number(Deno.env.get("TED_PIPELINE_V2_ROLLOUT_PERCENT") ?? "0")));
  let hash = 0;
  for (const char of outcomeId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 100 < percent;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return jsonResponse({ error: { message: "Method not allowed" } }, 405, origin);

  let auth;
  try { auth = await guardRequest(req, { enforceCap: true }); }
  catch (error) {
    if (error instanceof AuthError) return jsonResponse(error.payload, error.status, origin);
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  const body = auth.body;
  const kind = String(body?.kind ?? "");
  const requestId = String(body?.request_id ?? "").slice(0, 160).trim();
  const situation = String(body?.situation ?? "").slice(0, 30000).trim();
  const outcomeId = String(body?.outcome_id ?? "").trim();
  if (!KINDS.has(kind) || !situation || !outcomeId || !requestId) {
    return jsonResponse({ error: { message: "request_id, kind, outcome_id and situation are required" } }, 400, origin);
  }
  if (!rolloutEnabled(kind, outcomeId)) {
    return jsonResponse({ error: { code: "TED_V2_DISABLED", message: "This workflow is using the current stable pipeline." } }, 404, origin);
  }

  const memory = await loadUserMemoryContext(auth.admin, auth.userId);
  const stream = new ReadableStream({
    async start(controller) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 120_000);
      controller.enqueue(sseEvent({ type: "status", stage: "context" }));
      const heartbeat = setInterval(() => controller.enqueue(sseEvent({ type: "status", stage: "working" })), 15_000);
      try {
        const pipelineSignal = AbortSignal.any([req.signal, timeout.signal]);
        inheritModelCallContext(req.signal, pipelineSignal);
        const artifact = await runTedArtifactPipeline({
          artifactId: crypto.randomUUID(), requestId, outcomeId, userId: auth.userId,
          kind: kind as ArtifactKind, templateId: String(body?.template_id ?? "") || undefined,
          situation,
          context: [body?.conversation_context, body?.upload_context, body?.extracted_text, memory].filter(Boolean).join("\n\n").slice(0, 60000),
          locale: String(body?.locale ?? "en-AU"), timezone: String(body?.timezone ?? "Australia/Melbourne"),
          signal: pipelineSignal,
          onStage: (stage) => controller.enqueue(sseEvent({ type: "status", stage })),
        });
        for (const block of artifact.blocks) controller.enqueue(sseEvent({ type: "block", block }));
        controller.enqueue(sseEvent({ type: "quality", status: "passed" }));
        controller.enqueue(sseEvent({ type: "complete", artifact }));
        controller.enqueue(sseDone());
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        controller.enqueue(sseEvent({ type: "error", code: message.startsWith("ARTIFACT_QUALITY_FAILED") ? "QUALITY_FAILED" : "TED_ERROR", retryable: true }));
      } finally {
        clearTimeout(timer); clearInterval(heartbeat); controller.close();
      }
    },
  });
  return new Response(stream, { headers: { ...corsHeaders(origin), ...SSE_HEADERS } });
});
