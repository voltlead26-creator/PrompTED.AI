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

export type Plan = "free" | "pro" | "premium" | "business";

export interface AuthContext {
  userId: string;
  /** @deprecated always false; anonymous access was removed. Kept to avoid a wider type-churn diff. */
  isAnonymous: boolean;
  plan: Plan;
  /** Admin client for privileged reads (usage ledger, subscriptions). */
  admin: SupabaseClient;
  /** Sanitised JSON request body. Multipart requests retain their original body. */
  body: Record<string, unknown> | null;
  /** Stable request id used to deduplicate post-success model-call ledger rows. */
  generationRequestId?: string;
}

// ----- plan caps (documents per month) -----

const PLAN_CAPS: Record<Plan, number> = {
  free: 3,
  pro: 20,
  premium: 40,
  business: Number.MAX_SAFE_INTEGER, // fair-use; hard ceiling in env
};

function planCap(plan: Plan): number {
  if (plan === "business") {
    return Number(Deno.env.get("BUSINESS_PLAN_MONTHLY_CAP") || 1000);
  }
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

async function monthlyUsage(admin: SupabaseClient, userId: string): Promise<number> {
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
  enforceCap?: boolean;
}

const TEXT_FIELD_LIMITS: Record<string, number> = {
  conversation_context: 30_000,
  upload_context: 30_000,
};

const BASE64_FIELDS = new Set(["content_base64", "file_base64", "data_base64"]);

function sanitiseValue(value: unknown, field: string): unknown {
  if (typeof value === "string") {
    if (BASE64_FIELDS.has(field)) {
      const encoded = value.replace(/^data:[^,]*,/, "");
      validateFileSize(Math.ceil(encoded.length * 0.75));
      return value;
    }
    return sanitiseText(value, { strip: true, field, max: TEXT_FIELD_LIMITS[field] });
  }
  if (typeof value === "number" && /(?:file_)?size(?:_bytes)?$/i.test(field)) {
    validateFileSize(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitiseValue(item, `${field}[${index}]`));
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

async function sanitiseRequestBody(
  req: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const form = await req.clone().formData();
    for (const [key, value] of form.entries()) {
      if (value instanceof File) validateFileSize(value.size);
      else sanitiseText(value, { strip: true, field: key });
    }
    return null;
  }
  if (!contentType.includes("application/json")) return null;
  const parsed = await req.clone().json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InputError("INVALID_TYPE", "Request body must be a JSON object.");
  }
  return sanitiseValue(parsed, "body") as Record<string, unknown>;
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
  const enforceCap =
    typeof opts === "object" && opts !== null ? opts.enforceCap !== false : true;
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
      error: { code: "INVALID_TOKEN", message: "Your session has expired. Please sign in again." },
    });
  }

  if (user.is_anonymous === true || !Array.isArray(user.identities) || user.identities.length === 0) {
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

  const admin = adminClient();
  const operation = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ??
    "edge-function";
  try {
    await checkRateLimit(admin, user.id, { operation });
  } catch (rateError) {
    if (rateError instanceof RateLimitError) {
      throw new AuthError(429, "RATE_LIMITED", rateError.payload);
    }
    throw rateError;
  }

  let body: Record<string, unknown> | null;
  try {
    body = await sanitiseRequestBody(req);
  } catch (inputError) {
    if (inputError instanceof InputError) {
      throw inputAuthError(inputError, req.headers.get("origin"));
    }
    throw inputError;
  }

  const plan = await loadPlan(admin, user.id);

  if (enforceCap) {
    const used = await monthlyUsage(admin, user.id);
    const cap = planCap(plan);
    if (used >= cap) {
      throw new AuthError(402, "over_cap", PAYWALL_PAYLOAD(plan));
    }
  }

  const generationRequestId = sanitiseText(
    String(body?.generation_request_id ?? body?.request_id ?? ""),
    { max: 200, field: "generation_request_id" },
  ).trim() || undefined;

  bindModelCallContext(req.signal, {
    userId: user.id,
    admin,
    generationRequestId,
  });

  return {
    userId: user.id,
    isAnonymous: false,
    plan,
    admin,
    body,
    generationRequestId,
  };
}
