// =====================================================
// PrompTED — Typed API Client
// Thin fetch wrappers around the orchestration Edge Functions.
// Configure once at app startup with the base URL + token getter.
// =====================================================

import type {
  Outcome,
  Document,
  Section,
  RecommendationPayload,
  Template,
  Bundle,
  Upload,
  ChecklistItem,
  Profile,
  BrandKit,
  CompanyProfile,
  ClariPreferences,
  Subscription,
  DocumentPlaceholderMetadata,
} from "../types/index";
import {
  coerceIntentResult,
  validateChecklist,
  validateExplainResult,
  type IntentResult,
  type ChecklistItemResult,
  type ExplainResult,
} from "../orchestration";
import type { TedArtifact, TedArtifactEvent, TedSupportingArtifactKind } from "../artifacts";

// ---- configuration ---------------------------------------------

export interface ApiClientConfig {
  /** Stable same-origin application API base. Browser code must use "/api". */
  baseUrl: string;
  /** Returns the current auth token, or null when anonymous. */
  getToken?: () => Promise<string | null> | string | null;
}

let config: ApiClientConfig = { baseUrl: "/api" };

export function configureApiClient(next: ApiClientConfig): void {
  config = next;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  return await authHeadersWithContentType(headers);
}

async function authHeadersWithContentType(
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  if (config.getToken) {
    const token = await config.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly payload: unknown,
  ) {
    super(code);
  }
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const request = async (url: string): Promise<T> => {
    const res = await fetch(url, {
      method: "POST",
      headers: await authHeadersWithContentType({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new ApiError(res.status, String(err?.code ?? "REQUEST_FAILED"), data);
    }
    return data as T;
  };

  return await request(`${config.baseUrl}/${path}`);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const request = async (url: string): Promise<T> => {
    const res = await fetch(url, {
      method: "GET",
      headers: await authHeaders(),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as Record<string, unknown>).error as
        | Record<string, unknown>
        | undefined;
      throw new ApiError(
        res.status,
        String(err?.code ?? "REQUEST_FAILED"),
        data,
      );
    }
    return data as T;
  };

  return await request(`${config.baseUrl}/${path}`);
}

// ---- durable captured document operation ----------------------

export interface CapturedDocumentOperationQuestion {
  input_key: string;
  label: string;
  question: string;
  why_needed: string;
  blocks_sections: string[];
  blocks_export: boolean;
  can_skip: boolean;
  skip_consequence: string;
}

export interface CapturedDocumentOperationStatus {
  contract_version?: string;
  operation_id: string;
  document_id: string;
  operation_revision: number;
  accepted_document_revision?: number;
  latest_document_revision?: number;
  document_revision?: number;
  status: string;
  safe_section_keys?: string[];
  blocked_section_keys?: string[];
  retryable: boolean;
  reconnect?: string;
  message?: string | null;
  safe_next_action?: string | null;
  correlation_id?: string;
  questions?: CapturedDocumentOperationQuestion[];
  idempotent_replay?: boolean;
}

export interface StartCapturedDocumentOperationInput {
  outcome_id: string;
  document_id: string;
  title: string;
  template_id: string;
  generation_request_id: string;
  input_revision: number;
  input_values: Record<string, unknown>;
  locale?: string;
  jurisdiction?: string;
}

/** Starts or resumes one immutable, idempotent operation through the server. */
export async function startCapturedDocumentOperation(
  input: StartCapturedDocumentOperationInput,
  signal?: AbortSignal,
): Promise<CapturedDocumentOperationStatus> {
  return postJson<CapturedDocumentOperationStatus>(
    "document-operation",
    input,
    signal,
  );
}

export interface ResumeCapturedDocumentOperationInput
  extends StartCapturedDocumentOperationInput {
  action: "resume";
  operation_id: string;
}

/** Resumes the exact accepted request; it never creates a second logical operation. */
export async function resumeCapturedDocumentOperation(
  input: ResumeCapturedDocumentOperationInput,
  signal?: AbortSignal,
): Promise<CapturedDocumentOperationStatus> {
  return postJson<CapturedDocumentOperationStatus>(
    "document-operation",
    input,
    signal,
  );
}

export interface CancelCapturedDocumentOperationResult {
  operation_id: string;
  operation_revision: number;
  status: "cancelled";
  idempotent_replay: boolean;
  reconnect: string;
  retryable: false;
}

/** Requests durable owner cancellation at one exact operation revision. */
export async function cancelCapturedDocumentOperation(
  input: {
    operation_id: string;
    expected_operation_revision: number;
    cancellation_code: "owner_cancelled";
  },
  signal?: AbortSignal,
): Promise<CancelCapturedDocumentOperationResult> {
  return postJson<CancelCapturedDocumentOperationResult>(
    "document-operation",
    { action: "cancel", ...input },
    signal,
  );
}

/** Reconnects to durable Supabase truth; provider streams are never authority. */
export async function getCapturedDocumentOperation(
  operationId: string,
  signal?: AbortSignal,
): Promise<CapturedDocumentOperationStatus> {
  return getJson<CapturedDocumentOperationStatus>(
    `document-operation?operation_id=${encodeURIComponent(operationId)}`,
    signal,
  );
}

// ---- interpret-intent ------------------------------------------

export interface InterpretIntentInput {
  situation_text: string;
  extracted_text?: string;
  clari?: Partial<ClariPreferences>;
}

export async function interpretIntent(
  input: InterpretIntentInput,
  signal?: AbortSignal,
): Promise<IntentResult> {
  const raw = await postJson<unknown>("interpret-intent", input, signal);
  return coerceIntentResult(raw);
}

// ---- clarify ---------------------------------------------------

export interface ClarifyTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ClarifyInput {
  domain?: string;
  situation?: string;
  /**
   * Full text extracted from any uploaded document. Sent separately from
   * `situation` so the Edge Function can give it its own (larger) length
   * budget instead of losing it to the per-turn history slice.
   */
  extracted_text?: string;
  history: ClarifyTurn[];
  answer: string;
  clari?: Partial<ClariPreferences>;
}

export async function clarify(input: ClarifyInput, signal?: AbortSignal): Promise<IntentResult> {
  const raw = await postJson<unknown>("clarify", input, signal);
  return coerceIntentResult(raw);
}

// ---- recommend -------------------------------------------------

export interface RecommendInput {
  domain?: string;
  situation: string;
  clari?: Partial<ClariPreferences>;
}

export async function recommend(
  input: RecommendInput,
  signal?: AbortSignal,
): Promise<IntentResult> {
  const raw = await postJson<unknown>("recommend", input, signal);
  return coerceIntentResult({ ...(raw as object), intent_clear: true, recommendation: raw });
}

// ---- job-match -------------------------------------------------

export interface JobMatchInput {
  situation: string;
  experience?: string;
  location?: string;
  /** Structured constraints, passed alongside (not instead of) situation
   * free text so they are guaranteed to reach the model rather than relying
   * on the text mention surviving truncation or being deprioritised. */
  work_type?: string;
  distance?: string;
  role_focus?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface FitBreakdown {
  skills_match?: number;
  experience_match?: number;
  work_style_fit?: number;
  location_fit?: "pass" | "fail" | "flag";
  career_alignment?: number;
}

export interface JobVacancy {
  title?: string;
  employer?: string;
  location?: string;
  source?: string;
  /** Immutable provider-tool source identity captured for this exact search. */
  source_id?: string;
  url?: string;
  pay?: string;
  closing?: string;
  why_fit?: string;
  fit_score?: number;
  fit_breakdown?: FitBreakdown;
  risk_flags?: string[];
  improve_before_applying?: string[];
}

export interface JobRoleIdea {
  role?: string;
  industry?: string;
  why_fit?: string;
  typical_pay?: string;
  demand?: string;
  how_fast?: string;
  first_steps?: string[];
  fit_score?: number;
  fit_breakdown?: FitBreakdown;
  evidence_to_show?: string[];
}

export interface JobMatchResult {
  need_more_context?: boolean;
  ask?: string;
  missing?: string[];
  urgency?: "high" | "normal";
  location_used?: string;
  summary?: string;
  listings?: JobVacancy[];
  role_ideas?: JobRoleIdea[];
  tips?: string[];
  data_as_of?: string;
  data_source?: "database" | "unavailable";
  live_search?: boolean;
  verified_count?: number;
  verified_sources?: Array<{
    id: string;
    title: string;
    url: string;
    type: "web";
  }>;
}

/** Find real, current job vacancies + role ideas for the user's situation and location. */
export async function jobMatch(
  input: JobMatchInput,
  signal?: AbortSignal,
): Promise<JobMatchResult> {
  return postJson<JobMatchResult>("job-match", input, signal);
}

// ---- proofread-document -----------------------------------------

export interface ProofreadItem {
  title: string;
  why: string;
  original_snippet: string;
  revised_snippet: string;
}

export interface ProofreadSectionResult {
  id: string;
  key: string;
  label: string;
  corrections: ProofreadItem[];
  improvements: ProofreadItem[];
}

export interface ProofreadInput {
  sections: Array<{ id: string; key?: string; label: string; content: string }>;
  domain?: string;
}

export async function proofreadDocument(
  input: ProofreadInput,
  signal?: AbortSignal,
): Promise<{ sections: ProofreadSectionResult[] }> {
  return postJson<{ sections: ProofreadSectionResult[] }>("proofread-document", input, signal);
}

// ---- generate-document (streaming) -----------------------------

export interface GenerateDocumentInput {
  template_id: string;
  situation?: string;
  profile?: Record<string, string | undefined>;
  extracted_text?: string;
  conversation_context?: string;
  upload_context?: string;
  upload_id?: string;
  sections?: Array<{
    key: string;
    label: string;
    required: boolean;
    hint?: string;
    vital?: string[];
    improver?: string[];
  }>;
  /**
   * Authoritative metadata from the canonical template catalog
   * (packages/shared/src/templates/templates.data.json). When provided, the
   * backend uses these instead of re-deriving them from template_id against
   * its own smaller fallback registry -- the catalog is the single source of
   * truth, not the backend's stub list.
   */
  domain?: string;
  structure_type?: "compose" | "structured_form" | "checklist";
  advice_boundary?: "none" | "light" | "high-stakes";
  /** True when no catalogue template matched: the backend designs a
   * situation-specific structure instead of the generic scaffold. */
  design_bespoke?: boolean;
  document_name?: string;
  /** Stable per intended generation; reused on retries so the backend
   * charges the document credit at most once. */
  generation_request_id?: string;
}

export interface DocumentDesignEvent {
  type: "document_design";
  name: string;
  sections: Array<{ key: string; label: string; required: boolean }>;
}

export interface MissingInfoEvent {
  type: "missing_info";
  sections: Array<{ key: string; label: string; missing: string[] }>;
}

export interface UnresolvedPlaceholdersEvent {
  type: "unresolved_placeholders";
  placeholders: DocumentPlaceholderMetadata[];
}

export interface DocumentSectionEvent {
  type: "section";
  key: string;
  label: string;
  content: string;
}

export interface DocumentDraftSectionEvent {
  type: "draft_section";
  key: string;
  label: string;
  content: string;
}

/**
 * Stream document sections as they generate. Calls `onSection` for each
 * section event. Resolves when the stream completes.
 */
export async function generateDocumentStream(
  input: GenerateDocumentInput,
  onSection: (event: DocumentSectionEvent) => void,
  signal?: AbortSignal,
  onDesign?: (event: DocumentDesignEvent) => void,
  onMissingInfo?: (event: MissingInfoEvent) => void,
  onUnresolvedPlaceholders?: (event: UnresolvedPlaceholdersEvent) => void,
  onDraftSection?: (event: DocumentDraftSectionEvent) => void,
): Promise<void> {
  const request = async (url: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(input),
      signal,
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new ApiError(res.status, String(err?.code ?? "STREAM_FAILED"), data);
    }
    return res;
  };

  const res = await request(`${config.baseUrl}/generate-document`);

  const body = res.body!;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.replace(/^data: /, "").trim();
      if (!line || line === "[DONE]") continue;
      try {
        const event = JSON.parse(line) as
          | DocumentSectionEvent
          | DocumentDraftSectionEvent
          | UnresolvedPlaceholdersEvent
          | { type: string; error?: { code?: string }; detail_code?: string };
        if (event.type === "section") {
          onSection(event as DocumentSectionEvent);
        } else if (event.type === "draft_section") {
          onDraftSection?.(event as DocumentDraftSectionEvent);
        } else if (event.type === "document_design") {
          onDesign?.(event as unknown as DocumentDesignEvent);
        } else if (event.type === "missing_info") {
          onMissingInfo?.(event as unknown as MissingInfoEvent);
        } else if (event.type === "unresolved_placeholders") {
          onUnresolvedPlaceholders?.(event as UnresolvedPlaceholdersEvent);
        } else if (event.type === "error") {
          throw new ApiError(
            502,
            String(event.error?.code ?? event.detail_code ?? "DOCUMENT_STREAM_FAILED"),
            event,
          );
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // Ignore malformed event lines.
      }
    }
  }
}

// ---- generate-checklist ----------------------------------------

export interface GenerateChecklistInput {
  situation: string;
  domain?: string;
  clari?: Partial<ClariPreferences>;
}

export async function generateChecklist(
  input: GenerateChecklistInput,
  signal?: AbortSignal,
): Promise<ChecklistItemResult[]> {
  const raw = await postJson<unknown>("generate-checklist", input, signal);
  return validateChecklist(raw);
}

// ---- generate-artifact (unified TED v2) ----------------------

export interface GenerateArtifactInput {
  request_id: string;
  outcome_id: string;
  kind: TedSupportingArtifactKind;
  template_id?: string;
  situation: string;
  conversation_context?: string;
  upload_context?: string;
  extracted_text?: string;
  locale?: string;
  timezone?: string;
}

export async function generateArtifactStream(
  input: GenerateArtifactInput,
  onEvent: (event: TedArtifactEvent) => void,
  signal?: AbortSignal,
): Promise<TedArtifact> {
  const res = await fetch(`${config.baseUrl}/generate-artifact`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, "ARTIFACT_STREAM_FAILED", data);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: TedArtifact | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.replace(/^data: /, "").trim();
      if (!line || line === "[DONE]") continue;
      const event = JSON.parse(line) as TedArtifactEvent;
      onEvent(event);
      if (event.type === "error") throw new ApiError(502, event.code, event);
      if (event.type === "complete") completed = event.artifact;
    }
  }
  if (!completed) throw new ApiError(502, "ARTIFACT_INCOMPLETE", {});
  return completed;
}

// ---- ingest-upload (Layer 5 placeholder) -----------------------

export interface UploadStructureSection {
  title: string;
  items: string[];
}

export interface IngestUploadConfirmPayload {
  /** TED's own-words summary of what the document is for (1-3 sentences). */
  summary?: string;
  /** Plain-words name for the kind of document, e.g. "training checklist". */
  document_type?: string;
  /** Mirror of the document's own headings and entries, in its own order. */
  structure?: UploadStructureSection[] | null;
  filename?: string;
  char_count?: number;
  context_char_count?: number;
  truncated?: boolean;
  context_excerpt_truncated?: boolean;
}

export interface IngestUploadOutput {
  upload_id: string;
  extracted_text: string;
  confirm_payload: IngestUploadConfirmPayload;
}

export async function ingestUpload(
  file: File,
  situationText = "",
  signal?: AbortSignal,
): Promise<IngestUploadOutput> {
  const form = new FormData();
  form.append("file", file);
  if (situationText.trim()) form.append("situation_text", situationText.trim());

  const headers: Record<string, string> = {};
  if (config.getToken) {
    const token = await config.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${config.baseUrl}/ingest-upload`, {
    method: "POST",
    headers,
    body: form,
    signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
    throw new ApiError(res.status, String(err?.code ?? "UPLOAD_FAILED"), data);
  }
  return data as IngestUploadOutput;
}

// ---- edit-section (streaming, Layer 9) -------------------------

export type EditAction = "improve" | "shorten" | "expand" | "change_tone" | "add_detail";

export interface EditSectionInput {
  action: EditAction;
  /** The current section content being edited. */
  content: string;
  /** Optional selected substring — only this is edited when present. */
  selection?: string;
  /** Optional steering, e.g. the target tone for "change_tone". */
  instruction?: string;
  domain?: string;
  clari?: Partial<ClariPreferences>;
}

export interface EditDeltaEvent {
  type: "delta";
  text: string;
}

export interface EditChangesEvent {
  type: "changes";
  changes: string[];
}

/**
 * Stream an "Edit with TED" revision. Calls `onDelta` for each text chunk as
 * it arrives so the editor can render the edit progressively, and `onChanges`
 * once with the plain-language list of what TED changed (sent after the
 * content deltas, before the stream closes). Resolves when the stream
 * completes; rejects (or surfaces an error event) on failure. Pass an
 * AbortSignal to support a Cancel button.
 */
export async function editSectionStream(
  input: EditSectionInput,
  onDelta: (text: string) => void,
  onChanges?: (changes: string[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/edit-section`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
    throw new ApiError(res.status, String(err?.code ?? "STREAM_FAILED"), data);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.replace(/^data: /, "").trim();
      if (!line || line === "[DONE]") continue;
      try {
        const event = JSON.parse(line) as
          EditDeltaEvent | EditChangesEvent | { type: string; code?: string };
        if (event.type === "delta") {
          onDelta((event as EditDeltaEvent).text);
        } else if (event.type === "changes") {
          onChanges?.((event as EditChangesEvent).changes);
        } else if (event.type === "error") {
          throw new ApiError(
            502,
            String((event as { code?: string }).code ?? "EDIT_FAILED"),
            event,
          );
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // Ignore malformed event lines.
      }
    }
  }
}

// ---- explain-section ------------------------------------------

export interface ExplainSectionInput {
  content: string;
  selection?: string;
  question?: string;
  section_name?: string;
  domain?: string;
  clari?: Partial<ClariPreferences>;
}

export type ExplainSectionOutput = ExplainResult;

export async function explainSection(
  input: ExplainSectionInput,
  signal?: AbortSignal,
): Promise<ExplainSectionOutput> {
  const raw = await postJson<unknown>("explain-section", input, signal);
  const parsed = validateExplainResult(raw);
  if (!parsed) {
    throw new ApiError(502, "EXPLAIN_FAILED", raw);
  }
  return parsed;
}

// ---- render-export (Layer 11) ----------------------------------

export type DocumentExportFormat = "pdf" | "word" | "excel";

export interface RenderExportInput {
  document_id?: string;
  artifact_id?: string;
  title: string;
  format: DocumentExportFormat;
  sections: Section[];
  brand_kit?: BrandKit | null;
  lede?: string;
  budget?: Record<string, number>;
  unresolved_placeholders?: DocumentPlaceholderMetadata[];
  placeholder_acknowledged?: boolean;
  captured_export_id?: string;
  captured_operation_id?: string;
  captured_expected_operation_revision?: number;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  approvedSections: number;
  capturedExportId: string | null;
}

/**
 * Render and download an export. The server re-validates the approval gate
 * and returns the artifact as a binary stream. Throws ApiError (code
 * "EXPORT_GATE") if a required section isn't approved.
 */
export async function renderExport(
  input: RenderExportInput,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const res = await fetch(`${config.baseUrl}/render-export`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
    throw new ApiError(res.status, String(err?.code ?? "EXPORT_FAILED"), data);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `${input.title || "document"}.pdf`;
  const approvedSections = Number(res.headers.get("X-Approved-Sections") ?? "0");
  const capturedExportId = res.headers.get("X-Captured-Export-Id");
  return { blob, filename, approvedSections, capturedExportId };
}

// ---- Re-exports of domain types --------------------------------

export type {
  Outcome,
  Document,
  Section,
  RecommendationPayload,
  Template,
  Bundle,
  Upload,
  ChecklistItem,
  Profile,
  BrandKit,
  CompanyProfile,
  ClariPreferences,
  Subscription,
};
