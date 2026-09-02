// =====================================================
// PrompTED — edit-section (streaming)
// Produces a reviewable TED suggestion. Legacy document sections enter a
// revision/hash-bound durable operation before provider work; the browser
// applies that persisted suggestion separately through an authenticated CAS.
// Captured documents retain their existing captured-section CAS on apply.
// =====================================================

import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  type AuthContext,
  AuthError,
  guardRequest,
} from "../_shared/auth-guard.ts";
import {
  OpenAIAdapterError,
  type ProviderResponse,
  routeRequest,
  USER_SAFE_ERROR,
} from "../_shared/provider-router.ts";
import { buildSystemPrompt } from "../_shared/prompt-builder.ts";
import { renderDocumentIntelligenceContract } from "../_shared/document-intelligence.ts";
import { SSE_HEADERS, sseDone, sseEvent } from "../_shared/orchestration.ts";
import {
  DocumentOutputContractError,
  EDIT_SECTION_OUTPUT_SCHEMA,
  validateEditSectionOutput,
} from "../_shared/document-output-contracts.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";

type EditAction =
  | "improve"
  | "shorten"
  | "expand"
  | "change_tone"
  | "add_detail";

interface EditBody {
  action?: EditAction;
  /** Sanitised display input. Durable edits reload authoritative content. */
  content?: string;
  selection?: string;
  instruction?: string;
  domain?: string;
  clari?: Record<string, unknown>;
  generation_request_id?: string;
  operation_id?: string;
  document_id?: string;
  section_id?: string;
  expected_section_revision?: number;
  accepted_content_sha256?: string;
}

interface PreparedLegacyEdit {
  state:
    | "accepted"
    | "provider_dispatched"
    | "ready"
    | "stale"
    | "applied"
    | "discarded"
    | "cancelled"
    | "terminal_failure"
    | "reconciliation_required";
  operation_id: string;
  accepted_section_revision: number;
  accepted_content_sha256: string;
  authoritative_content?: string | null;
  suggested_content?: string | null;
  result_sha256?: string | null;
  applied_candidate_content?: string | null;
  applied_candidate_sha256?: string | null;
  changes?: string[] | null;
  terminal_code?: string | null;
  idempotent_replay: boolean;
}

interface CompletedLegacyEdit {
  state: "ready";
  operation_id: string;
  result_sha256: string;
  idempotent_replay: boolean;
}

interface DispatchedLegacyEdit {
  state: "provider_dispatched";
  operation_id: string;
  idempotent_replay: boolean;
}

type LegacyTerminalState =
  | "cancelled"
  | "terminal_failure"
  | "reconciliation_required";

interface SettledLegacyEdit {
  state: LegacyTerminalState;
  operation_id: string;
  terminal_code: string;
  idempotent_replay: boolean;
}

interface EditDependencies {
  guard: typeof guardRequest;
  route: typeof routeRequest;
  loadMemory: typeof loadUserMemoryContext;
}

const DEFAULT_DEPENDENCIES: EditDependencies = {
  guard: guardRequest,
  route: routeRequest,
  loadMemory: loadUserMemoryContext,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const ACTION_INSTRUCTION: Record<EditAction, string> = {
  improve:
    "Improve the clarity, flow, and impact of the text without changing its meaning.",
  shorten:
    "Make the text more concise. Remove redundancy while keeping every key point.",
  expand:
    "Expand the text with relevant detail and supporting points. Do not pad with filler.",
  change_tone:
    "Rewrite the text in the requested tone while preserving all facts and intent.",
  add_detail:
    "Add concrete, specific detail to the text. Do not invent facts the user has not implied.",
};

class DurableEditError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 500 | 503,
  ) {
    super(code);
    this.name = "DurableEditError";
  }
}

function isEditAction(value: unknown): value is EditAction {
  return value === "improve" || value === "shorten" || value === "expand" ||
    value === "change_tone" || value === "add_detail";
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalise(item)]),
    );
  }
  return value;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function plainTextFromStoredContent(content: string): string {
  return content
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function suggestionToSectionHtml(value: string): string {
  return value.trim().split(/\n{2,}/)
    .map((paragraph) =>
      `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`
    )
    .join("");
}

/**
 * Durable selection edits are accepted only when the selected plain text has
 * one exact representation in the persisted HTML body. Ambiguous, entity-
 * encoded, or cross-markup selections fail closed instead of guessing where a
 * provider suggestion belongs.
 */
export function buildPersistedApplyCandidate(
  authoritativeContent: string,
  selection: string,
  revised: string,
): string {
  if (!selection) return suggestionToSectionHtml(revised);
  const first = authoritativeContent.indexOf(selection);
  const second = first < 0
    ? -1
    : authoritativeContent.indexOf(selection, first + selection.length);
  if (first < 0 || second >= 0) {
    throw new DurableEditError(
      "LEGACY_SECTION_EDIT_SELECTION_AMBIGUOUS",
      409,
    );
  }
  const replacement = escapeHtml(revised.trim()).replaceAll("\n", "<br>");
  return authoritativeContent.slice(0, first) + replacement +
    authoritativeContent.slice(first + selection.length);
}

function rpcCode(error: { message?: string; code?: string } | null): string {
  return error?.message?.match(/\b([A-Z][A-Z0-9_]{3,})\b/)?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "LEGACY_SECTION_EDIT_FAILED");
}

function durableError(code: string): DurableEditError {
  if (code.endsWith("_NOT_FOUND")) return new DurableEditError(code, 404);
  if (code.endsWith("_INPUT_INVALID")) return new DurableEditError(code, 400);
  if (
    code.includes("STALE") || code.includes("CONFLICT") ||
    code.includes("NOT_READY") || code.includes("STATE_INVALID") ||
    code === "CAPTURED_SECTION_EDIT_RPC_REQUIRED"
  ) {
    return new DurableEditError(code, 409);
  }
  return new DurableEditError(code, 500);
}

async function rpcValue<T>(
  auth: AuthContext,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await auth.admin.rpc(name, args);
  if (error || !data) throw durableError(rpcCode(error));
  return data as T;
}

function hasDurableBinding(body: EditBody): boolean {
  return [
    body.operation_id,
    body.document_id,
    body.section_id,
    body.expected_section_revision,
    body.accepted_content_sha256,
  ].some((value) => value !== undefined);
}

async function prepareLegacyEdit(
  auth: AuthContext,
  body: EditBody,
  action: EditAction,
  selection: string,
  instruction: string,
): Promise<{ prepared: PreparedLegacyEdit; requestSha256: string }> {
  const operationId = String(body.operation_id ?? "");
  const documentId = String(body.document_id ?? "");
  const sectionId = String(body.section_id ?? "");
  const expectedRevision = Number(body.expected_section_revision);
  const acceptedHash = String(body.accepted_content_sha256 ?? "");
  if (
    !UUID_PATTERN.test(operationId) || !UUID_PATTERN.test(documentId) ||
    !UUID_PATTERN.test(sectionId) || !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 || !SHA256_PATTERN.test(acceptedHash) ||
    body.generation_request_id !== operationId
  ) {
    throw new DurableEditError("LEGACY_SECTION_EDIT_BINDING_INVALID", 400);
  }

  const requestMetadata = {
    contract_version: "legacy-section-edit.1",
    action,
    scope: selection ? "selection" : "section",
    selection_sha256: selection ? await sha256(selection) : null,
    selection_length: selection.length,
    instruction_sha256: instruction ? await sha256(instruction) : null,
    instruction_length: instruction.length,
    domain: body.domain ? String(body.domain).slice(0, 80) : null,
    clari_sha256: body.clari
      ? await sha256(JSON.stringify(canonicalise(body.clari)))
      : null,
  };
  const requestSha256 = await sha256(
    JSON.stringify(canonicalise(requestMetadata)),
  );
  const prepared = await rpcValue<PreparedLegacyEdit>(
    auth,
    "prepare_legacy_section_edit",
    {
      p_user_id: auth.userId,
      p_operation_id: operationId,
      p_document_id: documentId,
      p_section_id: sectionId,
      p_expected_section_revision: expectedRevision,
      p_accepted_content_sha256: acceptedHash,
      p_request_sha256: requestSha256,
      p_request_metadata: requestMetadata,
    },
  );
  return { prepared, requestSha256 };
}

async function markLegacyEditDispatched(
  auth: AuthContext,
  operationId: string,
  requestSha256: string,
): Promise<DispatchedLegacyEdit> {
  return await rpcValue<DispatchedLegacyEdit>(
    auth,
    "mark_legacy_section_edit_dispatched",
    {
      p_user_id: auth.userId,
      p_operation_id: operationId,
      p_request_sha256: requestSha256,
    },
  );
}

async function settleLegacyEdit(
  auth: AuthContext,
  operationId: string,
  requestSha256: string,
  state: LegacyTerminalState,
  code: string,
): Promise<SettledLegacyEdit> {
  return await rpcValue<SettledLegacyEdit>(auth, "settle_legacy_section_edit", {
    p_user_id: auth.userId,
    p_operation_id: operationId,
    p_request_sha256: requestSha256,
    p_terminal_state: state,
    p_terminal_code: code,
  });
}

function publicTerminalCode(state: LegacyTerminalState): string {
  switch (state) {
    case "cancelled":
      return "LEGACY_SECTION_EDIT_CANCELLED";
    case "terminal_failure":
      return "LEGACY_SECTION_EDIT_TERMINAL_FAILURE";
    case "reconciliation_required":
      return "LEGACY_SECTION_EDIT_RECONCILIATION_REQUIRED";
  }
}

function settledTerminalResponse(
  settled: SettledLegacyEdit,
  origin: string | null,
  message: string,
  status: number,
): Response {
  return jsonResponse(
    {
      error: {
        code: publicTerminalCode(settled.state),
        message,
        retryable: false,
      },
      detail_code: settled.terminal_code,
      terminal_state: settled.state,
      idempotent_replay: settled.idempotent_replay,
    },
    status,
    origin,
  );
}

function terminalStateForError(error: unknown): {
  state: Exclude<LegacyTerminalState, "cancelled">;
  code: string;
} {
  if (
    error instanceof OpenAIAdapterError &&
    error.code.includes("RECONCILIATION_REQUIRED")
  ) {
    return { state: "reconciliation_required", code: error.code };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      state: "reconciliation_required",
      code: "LEGACY_SECTION_EDIT_PROVIDER_OUTCOME_AMBIGUOUS",
    };
  }
  return {
    state: "terminal_failure",
    code:
      error instanceof DurableEditError || error instanceof OpenAIAdapterError
        ? error.code
        : "LEGACY_SECTION_EDIT_PROVIDER_FAILED",
  };
}

function streamText(
  controller: ReadableStreamDefaultController<Uint8Array>,
  text: string,
): void {
  for (const token of text.match(/\S+\s*/g) ?? [text]) {
    controller.enqueue(sseEvent({ type: "delta", text: token }));
  }
}

function hasWeakEditOutput(value: string): boolean {
  if (!value.trim()) return true;
  return /\b(this section will|the user should|consider including|insert|replace this scaffold|draft scaffold|no matching sections|here you would)\b/i
    .test(value);
}

function persistedEditStream(prepared: PreparedLegacyEdit): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEvent({
        type: "operation",
        operation_id: prepared.operation_id,
        accepted_section_revision: prepared.accepted_section_revision,
        accepted_content_sha256: prepared.accepted_content_sha256,
        idempotent_replay: true,
      }));
      streamText(controller, String(prepared.suggested_content));
      if ((prepared.changes?.length ?? 0) > 0) {
        controller.enqueue(
          sseEvent({ type: "changes", changes: prepared.changes }),
        );
      }
      controller.enqueue(sseEvent({
        type: "result",
        operation_id: prepared.operation_id,
        accepted_section_revision: prepared.accepted_section_revision,
        result_sha256: prepared.result_sha256,
        applied_candidate_content: prepared.applied_candidate_content,
        applied_candidate_sha256: prepared.applied_candidate_sha256,
        state: "ready",
        idempotent_replay: true,
      }));
      controller.enqueue(sseDone());
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

function persistedTerminalStream(prepared: PreparedLegacyEdit): Response {
  const state = prepared.state as LegacyTerminalState;
  const code = publicTerminalCode(state);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEvent({
        type: "operation",
        operation_id: prepared.operation_id,
        accepted_section_revision: prepared.accepted_section_revision,
        accepted_content_sha256: prepared.accepted_content_sha256,
        idempotent_replay: true,
      }));
      controller.enqueue(sseEvent({
        type: "error",
        error: {
          code,
          message: state === "cancelled"
            ? "That TED edit was cancelled. Start a new edit when you're ready."
            : state === "reconciliation_required"
            ? "TED cannot safely confirm the provider outcome. Start a new edit; your document was not changed."
            : "TED could not complete that edit. Start a new edit; your document was not changed.",
          retryable: false,
        },
        detail_code: prepared.terminal_code ?? code,
        terminal_state: state,
        idempotent_replay: true,
      }));
      controller.enqueue(sseDone());
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

function durableErrorResponse(
  error: DurableEditError,
  origin: string | null,
): Response {
  const retryable = error.code.includes("STALE") ||
    error.code === "LEGACY_SECTION_EDIT_IN_PROGRESS" ||
    error.code === "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED";
  const message = error.code === "LEGACY_SECTION_EDIT_IN_PROGRESS"
    ? "TED is still finishing that saved edit. Retry shortly to resume the same operation."
    : error.code === "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED"
    ? "TED couldn't confirm the edit outcome. Retry the same edit to recover its durable state."
    : error.code.includes("STALE")
    ? "This section changed before TED could prepare the suggestion. Wait for saving to finish, then try again."
    : "TED couldn't safely prepare that edit. Refresh the section and try again.";
  return jsonResponse(
    {
      error: {
        code: error.code,
        message,
        retryable,
      },
    },
    error.status,
    origin,
  );
}

export async function handleEditSection(
  req: Request,
  dependencies: EditDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
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
    auth = await dependencies.guard(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  const body = auth.body as EditBody | null;
  if (!body || !isEditAction(body.action)) {
    return jsonResponse(
      { error: { message: "Unknown edit action" } },
      400,
      origin,
    );
  }
  const action = body.action;
  const selection = body.selection
    ? String(body.selection).slice(0, 20000)
    : "";
  const instruction = String(body.instruction ?? "").slice(0, 500).trim();

  let prepared: PreparedLegacyEdit | null = null;
  let requestSha256: string | null = null;
  let fullContent = String(body.content ?? "").slice(0, 20000);
  if (hasDurableBinding(body)) {
    try {
      const durable = await prepareLegacyEdit(
        auth,
        body,
        action,
        selection,
        instruction,
      );
      prepared = durable.prepared;
      requestSha256 = durable.requestSha256;
    } catch (error) {
      return error instanceof DurableEditError
        ? durableErrorResponse(error, origin)
        : jsonResponse(USER_SAFE_ERROR, 500, origin);
    }
    if (prepared.state === "ready") {
      if (
        !prepared.suggested_content || !prepared.result_sha256 ||
        !prepared.applied_candidate_content ||
        !prepared.applied_candidate_sha256
      ) {
        return jsonResponse(USER_SAFE_ERROR, 500, origin);
      }
      const response = persistedEditStream(prepared);
      return new Response(response.body, {
        status: response.status,
        headers: { ...corsHeaders(origin), ...SSE_HEADERS },
      });
    }
    if (prepared.state === "stale") {
      return durableErrorResponse(
        new DurableEditError("LEGACY_SECTION_EDIT_STALE", 409),
        origin,
      );
    }
    if (
      prepared.state === "cancelled" ||
      prepared.state === "terminal_failure" ||
      prepared.state === "reconciliation_required"
    ) {
      const response = persistedTerminalStream(prepared);
      return new Response(response.body, {
        status: response.status,
        headers: { ...corsHeaders(origin), ...SSE_HEADERS },
      });
    }
    if (prepared.state === "provider_dispatched") {
      return durableErrorResponse(
        new DurableEditError("LEGACY_SECTION_EDIT_IN_PROGRESS", 409),
        origin,
      );
    }
    if (
      prepared.state !== "accepted" ||
      prepared.authoritative_content === null ||
      prepared.authoritative_content === undefined
    ) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_SECTION_EDIT_ALREADY_FINAL",
            message: "That TED suggestion is already finalised.",
            retryable: false,
          },
        },
        409,
        origin,
      );
    }
    fullContent = plainTextFromStoredContent(prepared.authoritative_content);
  }

  const target = selection || fullContent;
  if (!target.trim()) {
    if (prepared && requestSha256) {
      try {
        const settled = await settleLegacyEdit(
          auth,
          prepared.operation_id,
          requestSha256,
          "terminal_failure",
          "LEGACY_SECTION_EDIT_EMPTY_SOURCE",
        );
        return settledTerminalResponse(
          settled,
          origin,
          "This section has no saved wording for TED to edit. Add wording, save it, then start a new edit.",
          400,
        );
      } catch {
        return durableErrorResponse(
          new DurableEditError(
            "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED",
            503,
          ),
          origin,
        );
      }
    }
    return jsonResponse({ error: { message: "Nothing to edit" } }, 400, origin);
  }
  if (selection && prepared) {
    const authoritative = prepared.authoritative_content ?? "";
    const first = authoritative.indexOf(selection);
    const duplicate = first >= 0 &&
      authoritative.indexOf(selection, first + selection.length) >= 0;
    if (first >= 0 && !duplicate) {
      // The deterministic persisted patch is safe to construct after the
      // provider returns its replacement.
    } else if (requestSha256) {
      const detailCode = duplicate
        ? "LEGACY_SECTION_EDIT_SELECTION_AMBIGUOUS"
        : "LEGACY_SECTION_EDIT_SELECTION_STALE";
      try {
        const settled = await settleLegacyEdit(
          auth,
          prepared.operation_id,
          requestSha256,
          "terminal_failure",
          detailCode,
        );
        return settledTerminalResponse(
          settled,
          origin,
          duplicate
            ? "That selection appears more than once in the saved section. Select one unique passage, then start a new edit."
            : "That selection no longer matches the saved section. Select the current wording, then start a new edit.",
          409,
        );
      } catch {
        return durableErrorResponse(
          new DurableEditError(
            "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED",
            503,
          ),
          origin,
        );
      }
    }
  }

  let memory = "";
  try {
    memory = await dependencies.loadMemory(auth.admin, auth.userId);
  } catch {
    if (prepared && requestSha256) {
      try {
        const settled = await settleLegacyEdit(
          auth,
          prepared.operation_id,
          requestSha256,
          "terminal_failure",
          "LEGACY_SECTION_EDIT_CONTEXT_UNAVAILABLE",
        );
        return settledTerminalResponse(
          settled,
          origin,
          "TED could not prepare that edit. Start a new edit; your document was not changed.",
          503,
        );
      } catch {
        return durableErrorResponse(
          new DurableEditError(
            "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED",
            503,
          ),
          origin,
        );
      }
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }
  const intelligenceContract = renderDocumentIntelligenceContract({
    task: "edit",
    domain: body.domain,
    profileHint: [fullContent, instruction].filter(Boolean).join(" ").slice(
      0,
      3000,
    ),
  });
  const systemPrompt = buildSystemPrompt({
    task: "edit",
    domain: body.domain as never,
    clari: body.clari as never,
    extra: [intelligenceContract, ACTION_INSTRUCTION[action], memory]
      .filter(Boolean)
      .join("\n\n"),
  });
  const userContent = [
    selection
      ? "Edit only the SELECTED text below. Return the revised selection only — do not return the surrounding text."
      : "Edit the text below.",
    instruction && `Additional instruction: ${instruction}`,
    selection ? `Surrounding context:\n${fullContent}` : "",
    `Text to edit:\n${target}`,
  ].filter(Boolean).join("\n\n");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (prepared && requestSha256) {
          if (req.signal.aborted) {
            const settled = await settleLegacyEdit(
              auth,
              prepared.operation_id,
              requestSha256,
              "cancelled",
              "LEGACY_SECTION_EDIT_CANCELLED_BEFORE_DISPATCH",
            );
            controller.enqueue(sseEvent({
              type: "error",
              error: {
                code: publicTerminalCode(settled.state),
                message:
                  "That TED edit was cancelled before provider work began.",
                retryable: false,
              },
              detail_code: settled.terminal_code,
              terminal_state: settled.state,
              idempotent_replay: settled.idempotent_replay,
            }));
            controller.enqueue(sseDone());
            return;
          }
          const dispatch = await markLegacyEditDispatched(
            auth,
            prepared.operation_id,
            requestSha256,
          );
          if (dispatch.idempotent_replay) {
            controller.enqueue(sseEvent({
              type: "error",
              error: {
                code: "LEGACY_SECTION_EDIT_IN_PROGRESS",
                message:
                  "TED is still finishing that saved edit. Try again shortly.",
                retryable: true,
              },
              detail_code: "LEGACY_SECTION_EDIT_IN_PROGRESS",
            }));
            controller.enqueue(sseDone());
            return;
          }
        }
        const result: ProviderResponse = await dependencies.route({
          task: "edit",
          logicalStageKey: "edit-section.primary",
          systemPrompt,
          messages: [{ role: "user", content: userContent }],
          maxTokens: 2200,
          outputSchema: EDIT_SECTION_OUTPUT_SCHEMA,
          signal: req.signal,
        });
        let validatedOutput;
        try {
          validatedOutput = validateEditSectionOutput(result.structured);
        } catch (error) {
          if (error instanceof DocumentOutputContractError) {
            throw new DurableEditError(
              "LEGACY_SECTION_EDIT_RESULT_INVALID",
              500,
            );
          }
          throw error;
        }
        const { content: revisedRaw, changes } = validatedOutput;
        const revised = revisedRaw.trim();
        if (hasWeakEditOutput(revised)) {
          throw new DurableEditError("LEGACY_SECTION_EDIT_RESULT_INVALID", 500);
        }

        let completion: CompletedLegacyEdit | null = null;
        let appliedCandidate: string | null = null;
        let appliedCandidateSha256: string | null = null;
        if (prepared && requestSha256) {
          appliedCandidate = buildPersistedApplyCandidate(
            prepared.authoritative_content ?? "",
            selection,
            revised,
          );
          appliedCandidateSha256 = await sha256(appliedCandidate);
          completion = await rpcValue<CompletedLegacyEdit>(
            auth,
            "complete_legacy_section_edit",
            {
              p_user_id: auth.userId,
              p_operation_id: prepared.operation_id,
              p_request_sha256: requestSha256,
              p_suggested_content: revised,
              p_applied_candidate_content: appliedCandidate,
              p_changes: changes,
              p_result_metadata: {
                contract_version: "legacy-section-edit-result.1",
                provider: result._provider,
                provider_response_id: result.responseId,
                provider_status: result.status,
                route_snapshot: result.routeSnapshot,
                input_tokens: result.inputTokens,
                output_tokens: result.outputTokens,
                attempt_count: result.attempts.length,
              },
            },
          );
          controller.enqueue(sseEvent({
            type: "operation",
            operation_id: prepared.operation_id,
            accepted_section_revision: prepared.accepted_section_revision,
            accepted_content_sha256: prepared.accepted_content_sha256,
            idempotent_replay: prepared.idempotent_replay,
          }));
        }

        streamText(controller, revised);
        if (changes.length > 0) {
          controller.enqueue(sseEvent({ type: "changes", changes }));
        }
        if (prepared && completion) {
          controller.enqueue(sseEvent({
            type: "result",
            operation_id: completion.operation_id,
            accepted_section_revision: prepared.accepted_section_revision,
            result_sha256: completion.result_sha256,
            applied_candidate_content: appliedCandidate,
            applied_candidate_sha256: appliedCandidateSha256,
            state: completion.state,
            idempotent_replay: completion.idempotent_replay,
          }));
        }
        controller.enqueue(sseDone());
      } catch (err) {
        if (prepared && requestSha256) {
          const terminal = terminalStateForError(err);
          try {
            const settled = await settleLegacyEdit(
              auth,
              prepared.operation_id,
              requestSha256,
              terminal.state,
              terminal.code,
            );
            controller.enqueue(sseEvent({
              type: "error",
              error: {
                code: publicTerminalCode(settled.state),
                message: settled.state === "reconciliation_required"
                  ? "TED cannot safely confirm the provider outcome. Start a new edit; your document was not changed."
                  : "TED could not complete that edit. Start a new edit; your document was not changed.",
                retryable: false,
              },
              detail_code: settled.terminal_code,
              terminal_state: settled.state,
              idempotent_replay: settled.idempotent_replay,
            }));
          } catch {
            controller.enqueue(sseEvent({
              type: "error",
              error: {
                code: "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED",
                message:
                  "TED couldn't confirm the edit outcome. Retry the same edit to recover its durable state.",
                retryable: true,
              },
              detail_code: "LEGACY_SECTION_EDIT_SETTLEMENT_UNCONFIRMED",
            }));
          }
        } else {
          const message = err instanceof Error ? err.message : "unknown";
          controller.enqueue(sseEvent({
            type: "error",
            ...USER_SAFE_ERROR,
            detail_code: /abort/i.test(message) ? "aborted" : "failed",
          }));
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

if (import.meta.main) Deno.serve((req) => handleEditSection(req));
