// =====================================================
// PrompTED — generate-report
// Produces an analytical report from uploaded source material.
// Streams SSE so long reports arrive progressively.
// =====================================================

import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt, type Domain } from "../_shared/prompt-builder.ts";
import { SSE_HEADERS, sseDone, sseEvent } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import {
  type AllowanceReservation,
  AllowanceReservationError,
  holdDocumentAllowanceForReconciliation,
  isProviderReconciliationRequired,
  RECONCILIATION_REQUIRED_PAYLOAD,
  releaseDocumentAllowance,
  reserveDocumentAllowance,
  resolveAllowanceRequestIdentity,
  settleDocumentAllowance,
} from "../_shared/allowance-reservations.ts";
import { setModelCallRequestIdentity } from "../_shared/model-call-context.ts";
import { handleGenerateReportGate } from "./gate-handler.ts";

interface ReportBody {
  situation?: string;
  domain?: Domain;
  extracted_text?: string;
  generation_request_id?: string;
}

const REPORT_SECTIONS = [
  { key: "summary", label: "Executive Summary" },
  { key: "findings", label: "Key Findings" },
  { key: "analysis", label: "Analysis" },
  { key: "recommendations", label: "Recommendations" },
];

export const REPORT_DURABLE_CHECKPOINT_REQUIRED = {
  error: {
    code: "REPORT_DURABLE_CHECKPOINT_REQUIRED",
    message:
      "Report generation is temporarily unavailable until every generated section can be durably recovered.",
    retryable: false,
  },
  persistence_eligible: false,
  completion_eligible: false,
} as const;

function durableReportGenerationEnabled(): boolean {
  // Deliberately source-gated. There is no environment override that can make
  // the unsafe dormant multi-call implementation reachable in a deployment.
  return false;
}

const forbiddenReportDownstream = async (): Promise<never> => {
  throw new Error("REPORT_GATE_DOWNSTREAM_FORBIDDEN");
};

Deno.serve((req) =>
  handleGenerateReportGate(req, {
    handleOptions,
    guardRequest,
    jsonResponse,
    gatePayload: REPORT_DURABLE_CHECKPOINT_REQUIRED,
    downstream: {
      readMemory: forbiddenReportDownstream,
      readDatabaseContent: forbiddenReportDownstream,
      reserveAllowance: forbiddenReportDownstream,
      callProvider: forbiddenReportDownstream,
    },
  })
);

// Retained only as reviewed evidence for the separately gated redesign. This
// function is never registered with Deno.serve and has no activation switch.
export async function dormantGenerateReport(req: Request): Promise<Response> {
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
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  // Four independent deep calls cannot yet be recovered section-by-section.
  // Keep the stable route authenticated but fail before memory, allowance, or
  // provider work until one-call strict output or durable sibling checkpoints
  // replace the dormant implementation below.
  if (!durableReportGenerationEnabled()) {
    return jsonResponse(REPORT_DURABLE_CHECKPOINT_REQUIRED, 409, origin);
  }

  let body: ReportBody;
  try {
    body = auth.body as unknown as ReportBody;
  } catch {
    return jsonResponse(
      { error: { message: "Invalid JSON body" } },
      400,
      origin,
    );
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

  let generationRequestId: string;
  try {
    generationRequestId = (await resolveAllowanceRequestIdentity(
      body.generation_request_id,
      {
        userId: auth.userId,
        routeKey: "generate-report",
        body: auth.body ?? {},
      },
    )).requestId;
    setModelCallRequestIdentity(req.signal, generationRequestId);
  } catch (err) {
    if (err instanceof AllowanceReservationError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  const memory = await loadUserMemoryContext(auth.admin, auth.userId);
  const systemPrompt = buildSystemPrompt({
    task: "document",
    domain: body.domain,
    extra:
      `You are producing an analytical report grounded strictly in the supplied source material.
Do not fabricate figures or facts not present in the source.
Sections (use exactly these): ${REPORT_SECTIONS.map((s) => s.label).join(", ")}.

${memory}`.trim(),
  });

  let reservation: AllowanceReservation;
  try {
    reservation = await reserveDocumentAllowance(auth.admin, {
      userId: auth.userId,
      requestId: generationRequestId,
      routeKey: "generate-report",
      body: auth.body ?? {},
      plan: auth.plan,
      monthlyCap: auth.monthlyDocumentCap,
      ttlSeconds: 7200,
    });
  } catch (err) {
    if (err instanceof AllowanceReservationError) {
      return jsonResponse(err.payload, err.status, origin);
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
      let settlementStarted = false;
      try {
        const completedSections: Array<{
          type: "section";
          key: string;
          label: string;
          content: string;
        }> = [];
        let inputTokens = 0;
        let outputTokens = 0;
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
            logicalStageKey: `generate-report.section:${section.key}`,
            systemPrompt,
            messages: [{ role: "user", content: userContent }],
            maxTokens: 1500,
            signal: req.signal,
          });

          inputTokens += result.inputTokens;
          outputTokens += result.outputTokens;
          completedSections.push({
            type: "section",
            key: section.key,
            label: section.label,
            content: result.text,
          });
        }

        settlementStarted = true;
        await settleDocumentAllowance(auth.admin, {
          userId: auth.userId,
          reservation,
          task: "report",
          inputTokens,
          outputTokens,
          result: {
            contract_version: "allowance-result.1",
            route_key: "generate-report",
            transport: "sse",
            payload: { events: completedSections },
          },
        });
        for (const section of completedSections) {
          controller.enqueue(sseEvent(section));
        }

        controller.enqueue(sseDone());
      } catch (err) {
        const reconciliationRequired = isProviderReconciliationRequired(err);
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
            releaseCode: req.signal.aborted
              ? "request_cancelled"
              : "provider_failed",
          });
        }
        const message = err instanceof Error ? err.message : "unknown";
        if (!reconciliationRequired) {
          controller.enqueue(
            sseEvent({
              type: "error",
              ...USER_SAFE_ERROR,
              detail_code: /abort/i.test(message) ? "aborted" : "failed",
            }),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders(origin), ...SSE_HEADERS },
  });
}
