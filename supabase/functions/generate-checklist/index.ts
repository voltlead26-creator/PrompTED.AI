// =====================================================
// PrompTED — generate-checklist
// Produces a sectioned interactive checklist/action plan.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  buildSystemPrompt,
  type ClariPrefs,
  type Domain,
} from "../_shared/prompt-builder.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import {
  CHECKLIST_OUTPUT_SCHEMA,
  validateChecklistOutput,
} from "../_shared/model-output-contracts.ts";
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
import {
  setModelCallCheckpointContext,
  setModelCallRequestIdentity,
} from "../_shared/model-call-context.ts";

interface ChecklistBody {
  situation?: string;
  domain?: Domain;
  clari?: ClariPrefs;
  generation_request_id?: string;
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
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  let reservation: AllowanceReservation | null = null;
  let settlementStarted = false;
  try {
    const body = auth.body as unknown as ChecklistBody;
    const situation = String(body.situation ?? "").slice(0, 30000).trim();
    if (!situation) {
      return jsonResponse(
        { error: { message: "situation is required" } },
        400,
        origin,
      );
    }

    const identity = await resolveAllowanceRequestIdentity(
      body.generation_request_id,
      {
        userId: auth.userId,
        routeKey: "generate-checklist",
        body: auth.body ?? {},
      },
    );
    const generationRequestId = identity.requestId;
    setModelCallRequestIdentity(req.signal, generationRequestId);
    reservation = await reserveDocumentAllowance(auth.admin, {
      userId: auth.userId,
      requestId: generationRequestId,
      routeKey: "generate-checklist",
      body: auth.body ?? {},
      plan: auth.plan,
      monthlyCap: auth.monthlyDocumentCap,
      ttlSeconds: 1800,
    });
    if (reservation.replayResult) {
      const body = reservation.replayResult.payload.body;
      if (
        reservation.replayResult.transport !== "json" ||
        !body || typeof body !== "object" || Array.isArray(body)
      ) {
        throw new AllowanceReservationError(
          500,
          "ALLOWANCE_PERSISTENCE_FAILED",
          {
            error: {
              code: "ALLOWANCE_PERSISTENCE_FAILED",
              message: "The saved result could not be replayed safely.",
            },
          },
        );
      }
      return jsonResponse(body, 200, origin);
    }
    setModelCallCheckpointContext(req.signal, {
      scope: "generate-checklist",
      originReservationId: reservation.reservationId,
      executionClaimToken: reservation.executionClaimToken!,
    });
    const memory = await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "checklist",
      domain: body.domain,
      clari: body.clari,
      profileHint: situation,
      extra:
        `${memory}\n\nThis is the finished interactive in-app version, not a static document. Organise the result into 3 to 7 practical sections such as Prep, First steps, Daily actions, Weekly actions, Follow-up or Completion, choosing labels that fit the user's goal. Produce at least 8 useful items in total unless the task genuinely requires fewer. Every item must include section, text, due_date and reason. Proposed tasks and routines are allowed; never invent personal facts. Return only JSON in this shape: {"items":[{"section":"Prep","text":"...","due_date":null,"reason":"..."}]}.`,
    });

    const makeRequest = (retry = false) =>
      routeRequest({
        task: "checklist",
        logicalStageKey: retry
          ? "generate-checklist.repair"
          : "generate-checklist.primary",
        outputSchema: CHECKLIST_OUTPUT_SCHEMA,
        systemPrompt,
        messages: [{
          role: "user",
          content: retry
            ? `Situation: ${situation}\n\nYour previous response was empty or unusable. Return ONLY valid JSON containing at least 8 concrete, actionable items divided across 3 to 7 named sections. Do not return an empty items array.`
            : `Situation: ${situation}`,
        }],
        maxTokens: 3500,
        signal: req.signal,
      });

    let result = await makeRequest(false);
    let normalised: ReturnType<typeof validateChecklistOutput> | null = null;
    try {
      normalised = validateChecklistOutput(result.structured);
    } catch {
      result = await makeRequest(true);
      try {
        normalised = validateChecklistOutput(result.structured);
      } catch {
        normalised = null;
      }
    }

    if (!normalised) {
      await releaseDocumentAllowance(auth.admin, {
        userId: auth.userId,
        reservation,
        releaseCode: "provider_failed",
      });
      reservation = null;
      return jsonResponse(
        {
          error: {
            code: "EMPTY_CHECKLIST",
            message: "TED did not return usable checklist items.",
          },
        },
        502,
        origin,
      );
    }

    settlementStarted = true;
    await settleDocumentAllowance(auth.admin, {
      userId: auth.userId,
      reservation,
      task: "checklist",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      result: {
        contract_version: "allowance-result.1",
        route_key: "generate-checklist",
        transport: "json",
        payload: { body: normalised },
      },
    });

    return jsonResponse(normalised, 200, origin);
  } catch (err) {
    if (err instanceof AllowanceReservationError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    if (
      reservation && !settlementStarted &&
      isProviderReconciliationRequired(err)
    ) {
      try {
        await holdDocumentAllowanceForReconciliation(auth.admin, {
          userId: auth.userId,
          reservation,
        });
      } catch {
        return jsonResponse(USER_SAFE_ERROR, 500, origin);
      }
      return jsonResponse(RECONCILIATION_REQUIRED_PAYLOAD, 409, origin);
    }
    if (reservation && !settlementStarted) {
      await releaseDocumentAllowance(auth.admin, {
        userId: auth.userId,
        reservation,
        releaseCode: req.signal.aborted
          ? "request_cancelled"
          : "provider_failed",
      });
    }
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
