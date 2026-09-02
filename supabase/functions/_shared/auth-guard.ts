// =====================================================
// PrompTED — Auth Guard
// JWT validation + plan check + usage cap check.
// FR-012 (anonymous browsing) has been retired: every request now requires a signed-in, confirmed account. Only
// gated operations (save, generate, export) require auth.
// =====================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkRateLimit, RateLimitError } from "./rate-limiter.ts";
import {
  InputError,
  inputErrorResponse,
  sanitiseText,
  validateFileSize,
} from "./input-sanitiser.ts";
import { bindModelCallContext } from "./model-call-context.ts";
import { MAX_UPLOAD_BYTES } from "./upload-extraction-contract.ts";
import { BRAND_LOGO_MAX_BYTES } from "../../../packages/shared/src/brand-kit-operation.ts";

export type Plan = "free" | "pro" | "premium" | "business";

export interface AuthContext {
  userId: string;
  /** @deprecated always false; anonymous access was removed. Kept to avoid a wider type-churn diff. */
  isAnonymous: boolean;
  plan: Plan;
  /** Frozen plan ceiling passed to the atomic allowance reservation RPC. */
  monthlyDocumentCap: number;
  /** Admin client for privileged reads (usage ledger, subscriptions). */
  admin: SupabaseClient;
  /** Sanitised JSON request body. Multipart requests retain their original body. */
  body: Record<string, unknown> | null;
  /** Parsed, bounded, sanitised multipart body for the one upload route. */
  multipartBody: FormData | null;
  /** Stable request id used to deduplicate post-success model-call ledger rows. */
  generationRequestId?: string;
}

// ----- plan caps (documents per month) -----

const PLAN_CAPS: Record<Plan, number> = {
  free: 3,
  pro: 20,
  premium: 40,
  // Keep one reviewed authority shared with the captured-operation database
  // trigger. Environment overrides would admit different counts through the
  // legacy and captured paths for the same user and billing period.
  business: 1000,
};

export function planCap(plan: Plan): number {
  return PLAN_CAPS[plan];
}

// ----- Supabase clients -----

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

function userClient(token: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("Supabase env vars not configured");
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

// ----- plan lookup -----

async function loadPlan(admin: SupabaseClient, userId: string): Promise<Plan> {
  const { data } = await admin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return "free";
  const plan = String(data.plan ?? "free") as Plan;
  return (["free", "pro", "premium", "business"] as Plan[]).includes(plan)
    ? plan
    : "free";
}

// ----- usage check -----

async function monthlyUsage(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const { count } = await admin
    .from("usage_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", "document_created")
    .gte("created_at", start.toISOString());

  return count ?? 0;
}

// ----- public interface -----

export class AuthError extends Error {
  constructor(
    public readonly status: 400 | 401 | 402 | 413 | 429,
    public readonly code: string,
    public readonly payload: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const PAYWALL_PAYLOAD = (plan: Plan) => ({
  error: {
    code: "PAYWALL",
    message:
      "You've reached your document limit for this month. Upgrade to keep going.",
    paywall_trigger: true,
    current_plan: plan,
    plan_required: plan === "free" ? "pro" : "premium",
  },
});

export interface GuardOptions {
  /**
   * When true (default), reject with 402 PAYWALL once the user's monthly
   * document cap is reached. The cap meters NEW DOCUMENT CREATION ONLY —
   * uploads, section edits, regenerates, explains, exports and chat must
   * pass { enforceCap: false }. A capped user must always be able to read,
   * repair and export documents they already created; anything else charges
   * a credit for a broken document and blocks the fix behind an upgrade.
   */
  enforceCap?: boolean | ((body: Record<string, unknown> | null) => boolean);
  /** Optional durable rate-limit bucket for multiplexed Edge Function paths. */
  rateLimitOperation?: string | ((body: Record<string, unknown> | null) => string);
  /** Optional bucket ceiling; defaults to the shared limiter policy. */
  rateLimitLimit?: number;
  /** Optional bucket window; defaults to the shared limiter policy. */
  rateLimitWindowSeconds?: number;
}

const TEXT_FIELD_LIMITS: Record<string, number> = {
  conversation_context: 30_000,
  upload_context: 30_000,
};

const BASE64_FIELDS = new Set(["content_base64", "file_base64", "data_base64"]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CHECKPOINT_SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_INGEST_JSON_ENVELOPE_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) +
  64 * 1024;
const DEFAULT_JSON_ENVELOPE_BYTES = 1024 * 1024;
const JSON_MAX_DEPTH = 32;
const JSON_MAX_KEYS = 5_000;
const JSON_MAX_ARRAY_ITEMS = 5_000;
const JSON_MAX_NODES = 20_000;

interface MultipartPolicy {
  maxEnvelopeBytes: number;
  maxFileBytes: number;
  maxParts: number;
  fileRequired: boolean;
  sizeMessage: string;
  textFields: Readonly<Record<string, { max: number; strip: boolean }>>;
}

const MULTIPART_POLICIES: Readonly<Record<string, MultipartPolicy>> = {
  "ingest-upload": {
    maxEnvelopeBytes: MAX_UPLOAD_BYTES + 64 * 1024,
    maxFileBytes: MAX_UPLOAD_BYTES,
    maxParts: 5,
    fileRequired: true,
    sizeMessage: "The upload request exceeds the 8 MB file limit.",
    textFields: {
      situation_text: { max: 30_000, strip: true },
      upload_id: { max: 160, strip: true },
      request_id: { max: 160, strip: true },
    },
  },
  "brand-logo": {
    maxEnvelopeBytes: BRAND_LOGO_MAX_BYTES + 64 * 1024,
    maxFileBytes: BRAND_LOGO_MAX_BYTES,
    maxParts: 9,
    fileRequired: false,
    sizeMessage: "The brand-logo request exceeds the 5 MB file limit.",
    textFields: {
      operation_id: { max: 36, strip: false },
      binding_sha256: { max: 64, strip: false },
      business_id: { max: 36, strip: false },
      expected_revision: { max: 20, strip: false },
      logo_action: { max: 10, strip: false },
      primary_colour: { max: 7, strip: false },
      secondary_colour: { max: 7, strip: false },
      footer_text: { max: 200, strip: false },
    },
  },
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${
    Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")
  }}`;
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

async function resolveGenerationRequestId(
  req: Request,
  userId: string,
  body: Record<string, unknown> | null,
): Promise<string | undefined> {
  const generationIdentity = sanitiseText(
    String(body?.generation_request_id ?? ""),
    { max: 160, field: "generation_request_id" },
  ).trim();
  const requestIdentity = sanitiseText(
    String(body?.request_id ?? ""),
    { max: 160, field: "request_id" },
  ).trim();
  if (
    generationIdentity && requestIdentity &&
    generationIdentity !== requestIdentity
  ) {
    throw new AuthError(400, "request_identity_conflict", {
      error: {
        code: "REQUEST_IDENTITY_CONFLICT",
        message: "The request identities do not match each other.",
      },
    });
  }
  const bodyIdentity = generationIdentity || requestIdentity;
  const headerIdentity = sanitiseText(
    req.headers.get("x-idempotency-key") ?? "",
    { max: 160, field: "x-idempotency-key" },
  ).trim();
  if (bodyIdentity && headerIdentity && bodyIdentity !== headerIdentity) {
    throw new AuthError(400, "request_identity_conflict", {
      error: {
        code: "REQUEST_IDENTITY_CONFLICT",
        message: "The request identity does not match the request body.",
      },
    });
  }
  const explicit = bodyIdentity || headerIdentity;
  if (explicit) {
    if (!REQUEST_ID_PATTERN.test(explicit)) {
      throw new AuthError(400, "request_identity_invalid", {
        error: {
          code: "REQUEST_IDENTITY_INVALID",
          message: "The request identity is invalid.",
        },
      });
    }
    return explicit;
  }
  if (!body) return undefined;

  // Expand/contract adapter for older JSON clients. An exact body replay is
  // deliberately the same logical request; current clients send an explicit
  // UUID so an intentional fresh attempt remains distinguishable.
  const route = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ??
    "edge-function";
  const digest = await sha256(`${userId}|${route}|${canonicalJson(body)}`);
  return `compat-${digest}`;
}

function sanitiseValue(value: unknown, field: string): unknown {
  if (typeof value === "string") {
    if (BASE64_FIELDS.has(field)) {
      const encoded = value.replace(/^data:[^,]*,/, "");
      validateFileSize(Math.ceil(encoded.length * 0.75));
      return value;
    }
    return sanitiseText(value, {
      strip: true,
      field,
      max: TEXT_FIELD_LIMITS[field],
    });
  }
  if (typeof value === "number" && /(?:file_)?size(?:_bytes)?$/i.test(field)) {
    validateFileSize(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitiseValue(item, `${field}[${index}]`)
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitiseValue(item, key),
      ]),
    );
  }
  return value;
}

async function boundedMultipartBody(
  req: Request,
  policy: MultipartPolicy,
): Promise<ArrayBuffer> {
  const contentLength = req.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > policy.maxEnvelopeBytes)
  ) {
    throw new InputError(
      "MULTIPART_TOO_LARGE",
      policy.sizeMessage,
      413,
    );
  }
  if (!req.body) {
    throw new InputError("MULTIPART_INVALID", "The upload form is missing.");
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > policy.maxEnvelopeBytes) {
        await reader.cancel("MULTIPART_TOO_LARGE");
        throw new InputError(
          "MULTIPART_TOO_LARGE",
          policy.sizeMessage,
          413,
        );
      }
      chunks.push(Uint8Array.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

function validateJsonStructure(value: unknown): void {
  let nodes = 0;
  let keys = 0;
  let arrayItems = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > JSON_MAX_NODES || current.depth > JSON_MAX_DEPTH) {
      throw new InputError(
        "JSON_STRUCTURE_LIMIT",
        "The JSON request is too deeply nested or complex.",
      );
    }
    if (Array.isArray(current.value)) {
      arrayItems += current.value.length;
      if (arrayItems > JSON_MAX_ARRAY_ITEMS) {
        throw new InputError(
          "JSON_STRUCTURE_LIMIT",
          "The JSON request contains too many array items.",
        );
      }
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
    } else if (current.value && typeof current.value === "object") {
      const entries = Object.entries(current.value as Record<string, unknown>);
      keys += entries.length;
      if (keys > JSON_MAX_KEYS) {
        throw new InputError(
          "JSON_STRUCTURE_LIMIT",
          "The JSON request contains too many object fields.",
        );
      }
      for (const [key, item] of entries) {
        if (key.length > 200) {
          throw new InputError(
            "JSON_STRUCTURE_LIMIT",
            "The JSON request contains an invalid field name.",
          );
        }
        stack.push({ value: item, depth: current.depth + 1 });
      }
    }
  }
}

async function boundedJsonBody(req: Request, maxEnvelopeBytes: number): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > maxEnvelopeBytes)
  ) {
    throw new InputError(
      "JSON_TOO_LARGE",
      "The JSON request exceeds the allowed size.",
      413,
    );
  }
  if (!req.body) {
    throw new InputError("INVALID_TYPE", "Request body must be a JSON object.");
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxEnvelopeBytes) {
        await reader.cancel("JSON_TOO_LARGE");
        throw new InputError(
          "JSON_TOO_LARGE",
          "The JSON request exceeds the allowed size.",
          413,
        );
      }
      chunks.push(Uint8Array.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InputError("INVALID_TYPE", "Request body must be valid JSON.");
  }
  validateJsonStructure(parsed);
  return parsed;
}

async function sanitiseMultipartRequest(
  req: Request,
  route: string,
): Promise<FormData> {
  const policy = MULTIPART_POLICIES[route];
  if (!policy) {
    throw new InputError(
      "MULTIPART_ROUTE_INVALID",
      "This route does not accept multipart form data.",
    );
  }
  const bytes = await boundedMultipartBody(req, policy);
  let form: FormData;
  try {
    form = await new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: bytes,
    }).formData();
  } catch {
    throw new InputError(
      "MULTIPART_INVALID",
      "The upload form is malformed.",
    );
  }

  const sanitised = new FormData();
  const seen = new Set<string>();
  let partCount = 0;
  for (const [key, value] of form.entries()) {
    partCount += 1;
    if (partCount > policy.maxParts) {
      throw new InputError(
        "MULTIPART_PART_LIMIT",
        "The upload form contains too many parts.",
      );
    }
    if ((key !== "file" && !(key in policy.textFields)) || seen.has(key)) {
      throw new InputError(
        "MULTIPART_FIELD_INVALID",
        `The upload form field ${key} is not allowed or is duplicated.`,
      );
    }
    seen.add(key);
    if (key === "file") {
      if (!(value instanceof File)) {
        throw new InputError("INVALID_TYPE", "file must be a file.");
      }
      if (value.size > policy.maxFileBytes) {
        throw new InputError(
          "FILE_TOO_LARGE",
          policy.sizeMessage,
          413,
        );
      }
      if (!value.name || value.name.length > 300 || value.type.length > 200) {
        throw new InputError(
          "UPLOAD_METADATA_INVALID",
          "The upload file metadata is invalid.",
        );
      }
      sanitised.append(key, value, value.name);
      continue;
    }
    if (value instanceof File) {
      throw new InputError("INVALID_TYPE", `${key} must be text.`);
    }
    const textPolicy = policy.textFields[key]!;
    sanitised.append(
      key,
      sanitiseText(value, {
        strip: textPolicy.strip,
        field: key,
        max: textPolicy.max,
      }),
    );
  }
  if (policy.fileRequired && !seen.has("file")) {
    throw new InputError("UPLOAD_FILE_REQUIRED", "file is required.");
  }
  return sanitised;
}

async function sanitiseRequestBody(
  req: Request,
): Promise<{
  body: Record<string, unknown> | null;
  multipartBody: FormData | null;
}> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  const route = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ??
    "";
  if (contentType.includes("multipart/form-data")) {
    return {
      body: null,
      multipartBody: await sanitiseMultipartRequest(req, route),
    };
  }
  if (!contentType.includes("application/json")) {
    return { body: null, multipartBody: null };
  }
  const parsed = await boundedJsonBody(
    req,
    route === "ingest-upload" ? MAX_INGEST_JSON_ENVELOPE_BYTES : DEFAULT_JSON_ENVELOPE_BYTES,
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InputError("INVALID_TYPE", "Request body must be a JSON object.");
  }
  return {
    body: sanitiseValue(parsed, "body") as Record<string, unknown>,
    multipartBody: null,
  };
}

function inputAuthError(error: InputError, origin: string | null): AuthError {
  const response = inputErrorResponse(error, origin);
  return new AuthError(response.status as 400 | 413, error.code, {
    error: { code: error.code, message: error.message },
  });
}

/**
 * Validate auth and, for document-creating operations, check the usage cap.
 * Every request requires a signed-in, confirmed account (FR-012 retired).
 *
 * Backwards compatibility: older call sites passed a boolean second argument
 * (the retired `requireAuth` flag). A boolean is ignored — auth is always
 * required — and the cap defaults to enforced, matching prior behaviour.
 */
export async function guardRequest(
  req: Request,
  opts?: GuardOptions | boolean,
): Promise<AuthContext> {
  const configuredOptions = typeof opts === "object" && opts !== null
    ? opts
    : {};
  // Anonymous access has been removed entirely: every request must carry a
  // valid, confirmed-account token, and every user — no exceptions — is
  // subject to the monthly usage cap. There is no unauthenticated or
  // no-cap code path left to fall through to.
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    throw new AuthError(401, "unauthenticated", {
      error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    });
  }

  const client = userClient(token);
  const { data: { user }, error } = await client.auth.getUser();

  if (error || !user) {
    throw new AuthError(401, "invalid_token", {
      error: {
        code: "INVALID_TOKEN",
        message: "Your session has expired. Please sign in again.",
      },
    });
  }

  if (
    user.is_anonymous === true || !Array.isArray(user.identities) ||
    user.identities.length === 0
  ) {
    throw new AuthError(401, "anonymous_user", {
      error: { code: "ANONYMOUS_USER", message: "Sign in to use TED." },
    });
  }

  if (!user.email_confirmed_at && !user.phone_confirmed_at) {
    throw new AuthError(401, "unverified_user", {
      error: {
        code: "UNVERIFIED_USER",
        message: "Confirm your account before using TED.",
      },
    });
  }

  let body: Record<string, unknown> | null;
  let multipartBody: FormData | null;
  try {
    ({ body, multipartBody } = await sanitiseRequestBody(req));
  } catch (inputError) {
    if (inputError instanceof InputError) {
      throw inputAuthError(inputError, req.headers.get("origin"));
    }
    throw inputError;
  }

  const configuredOperation = typeof configuredOptions.rateLimitOperation === "function"
    ? configuredOptions.rateLimitOperation(body)
    : configuredOptions.rateLimitOperation;
  const operation = configuredOperation?.trim() ||
    new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ||
    "edge-function";
  const enforceCap = typeof configuredOptions.enforceCap === "function"
    ? configuredOptions.enforceCap(body)
    : configuredOptions.enforceCap !== false;
  const admin = adminClient();
  try {
    await checkRateLimit(admin, user.id, {
      operation,
      limit: configuredOptions.rateLimitLimit,
      windowSeconds: configuredOptions.rateLimitWindowSeconds,
    });
  } catch (rateError) {
    if (rateError instanceof RateLimitError) {
      throw new AuthError(429, "RATE_LIMITED", rateError.payload);
    }
    throw rateError;
  }

  const plan = await loadPlan(admin, user.id);
  const monthlyDocumentCap = planCap(plan);

  if (enforceCap) {
    const used = await monthlyUsage(admin, user.id);
    if (used >= monthlyDocumentCap) {
      throw new AuthError(402, "over_cap", PAYWALL_PAYLOAD(plan));
    }
  }

  const generationRequestId = await resolveGenerationRequestId(
    req,
    user.id,
    body,
  );
  const checkpointScope = new URL(req.url).pathname.split("/").filter(Boolean)
    .at(-1)?.toLowerCase() ?? "";
  if (!CHECKPOINT_SCOPE_PATTERN.test(checkpointScope)) {
    throw new AuthError(400, "request_route_invalid", {
      error: {
        code: "REQUEST_ROUTE_INVALID",
        message: "The request route cannot be admitted safely.",
      },
    });
  }

  bindModelCallContext(req.signal, {
    userId: user.id,
    admin,
    generationRequestId,
    checkpoint: { scope: checkpointScope },
  });

  return {
    userId: user.id,
    isAnonymous: false,
    plan,
    monthlyDocumentCap,
    admin,
    body,
    multipartBody,
    generationRequestId,
  };
}
