import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  type ArtifactKind,
  runTedArtifactPipeline,
} from "../_shared/ted-artifact-pipeline.ts";
import { SSE_HEADERS, sseDone, sseEvent } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import { inheritModelCallContext } from "../_shared/model-call-context.ts";
import {
  type AllowanceReservation,
  AllowanceReservationError,
  holdDocumentAllowanceForReconciliation,
  isProviderReconciliationRequired,
  RECONCILIATION_REQUIRED_PAYLOAD,
  releaseDocumentAllowance,
  requireAllowanceRequestId,
  reserveDocumentAllowance,
  settleDocumentAllowance,
} from "../_shared/allowance-reservations.ts";
import {
  artifactOutcomeAuthorizationUnavailable,
  ArtifactOutcomeAuthorizationError,
  requireOwnedArtifactOutcome,
} from "./owner-authorization.ts";

const KINDS = new Set([
  "document",
  "action_plan",
  "checklist",
  "report",
  "recommendation",
  "research_brief",
  "job_match",
]);

function rolloutEnabled(kind: string, outcomeId: string): boolean {
  const enabled = (Deno.env.get("TED_PIPELINE_V2_WORKFLOWS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (!enabled.includes(kind) && !enabled.includes("all")) return false;
  const percent = Math.max(
    0,
    Math.min(
      100,
      Number(Deno.env.get("TED_PIPELINE_V2_ROLLOUT_PERCENT") ?? "0"),
    ),
  );
  let hash = 0;
  for (const char of outcomeId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 100 < percent;
}

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

  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  const body = auth.body;
  const kind = String(body?.kind ?? "");
  let requestId: string;
  try {
    requestId = requireAllowanceRequestId(body?.request_id);
  } catch (error) {
    if (error instanceof AllowanceReservationError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }
  const situation = String(body?.situation ?? "").slice(0, 30000).trim();
  let outcomeId = String(body?.outcome_id ?? "").trim();
  if (!KINDS.has(kind) || !situation || !outcomeId || !requestId) {
    return jsonResponse(
      {
        error: {
          message: "request_id, kind, outcome_id and situation are required",
        },
      },
      400,
      origin,
    );
  }
  try {
    outcomeId = await requireOwnedArtifactOutcome(
      auth.admin,
      auth.userId,
      outcomeId,
    );
  } catch (error) {
    const failure = error instanceof ArtifactOutcomeAuthorizationError
      ? error
      : artifactOutcomeAuthorizationUnavailable();
    return jsonResponse(failure.payload, failure.status, origin);
  }
  if (!rolloutEnabled(kind, outcomeId)) {
    return jsonResponse(
      {
        error: {
          code: "TED_V2_DISABLED",
          message: "This workflow is using the current stable pipeline.",
        },
      },
      404,
      origin,
    );
  }

  const memory = await loadUserMemoryContext(auth.admin, auth.userId);
  let reservation: AllowanceReservation;
  try {
    reservation = await reserveDocumentAllowance(auth.admin, {
      userId: auth.userId,
      requestId,
      routeKey: "generate-artifact",
      body: auth.body ?? {},
      plan: auth.plan,
      monthlyCap: auth.monthlyDocumentCap,
      ttlSeconds: 7200,
    });
  } catch (error) {
    if (error instanceof AllowanceReservationError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }
  if (reservation.replayResult) {
    const events = reservation.replayResult.payload.events;
    if (
      reservation.replayResult.transport !== "sse" || !Array.isArray(events)
    ) return jsonResponse(USER_SAFE_ERROR, 500, origin);
    const replay = new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(sseEvent(event));
        controller.enqueue(sseDone());
        controller.close();
      },
    });
    return new Response(replay, {
      headers: { ...corsHeaders(origin), ...SSE_HEADERS },
    });
  }
  const stream = new ReadableStream({
    async start(controller) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 120_000);
      controller.enqueue(sseEvent({ type: "status", stage: "context" }));
      const heartbeat = setInterval(
        () =>
          controller.enqueue(sseEvent({ type: "status", stage: "working" })),
        15_000,
      );
      let settlementStarted = false;
      try {
        const pipelineSignal = AbortSignal.any([req.signal, timeout.signal]);
        inheritModelCallContext(req.signal, pipelineSignal);
        const artifact = await runTedArtifactPipeline({
          artifactId: crypto.randomUUID(),
          requestId,
          outcomeId,
          userId: auth.userId,
          kind: kind as ArtifactKind,
          templateId: String(body?.template_id ?? "") || undefined,
          situation,
          context: [
            body?.conversation_context,
            body?.upload_context,
            body?.extracted_text,
            memory,
          ].filter(Boolean).join("\n\n").slice(0, 60000),
          locale: String(body?.locale ?? "en-AU"),
          timezone: String(body?.timezone ?? "Australia/Melbourne"),
          signal: pipelineSignal,
          onStage: (stage) =>
            controller.enqueue(sseEvent({ type: "status", stage })),
        });
        const responseEvents: Array<Record<string, unknown>> = [
          ...artifact.blocks.map((block) => ({ type: "block", block })),
          { type: "quality", status: "passed" },
          { type: "complete", artifact },
        ];
        settlementStarted = true;
        await settleDocumentAllowance(auth.admin, {
          userId: auth.userId,
          reservation,
          task: "artifact",
          result: {
            contract_version: "allowance-result.1",
            route_key: "generate-artifact",
            transport: "sse",
            payload: { events: responseEvents },
          },
        });
        for (const event of responseEvents) controller.enqueue(sseEvent(event));
        controller.enqueue(sseDone());
      } catch (error) {
        const reconciliationRequired = isProviderReconciliationRequired(error);
        if (!settlementStarted && reconciliationRequired) {
          try {
            await holdDocumentAllowanceForReconciliation(auth.admin, {
              userId: auth.userId,
              reservation,
            });
            controller.enqueue(sseEvent({
              type: "error",
              ...RECONCILIATION_REQUIRED_PAYLOAD.error,
              http_status: 409,
            }));
          } catch {
            controller.enqueue(sseEvent({ type: "error", ...USER_SAFE_ERROR }));
          }
        } else if (!settlementStarted) {
          await releaseDocumentAllowance(auth.admin, {
            userId: auth.userId,
            reservation,
            releaseCode: req.signal.aborted || timeout.signal.aborted
              ? "request_cancelled"
              : "provider_failed",
          });
        }
        const message = error instanceof Error ? error.message : "unknown";
        if (!reconciliationRequired) {
          controller.enqueue(
            sseEvent({
              type: "error",
              code: message.startsWith("ARTIFACT_QUALITY_FAILED")
                ? "QUALITY_FAILED"
                : "TED_ERROR",
              retryable: true,
            }),
          );
        }
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders(origin), ...SSE_HEADERS },
  });
});
