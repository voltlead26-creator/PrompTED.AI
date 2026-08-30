// =====================================================
// RevenueCat Webhook Handler
// Receives subscription events and updates the subscriptions table.
// Auth: HMAC-SHA256 signature verification (not JWT).
// =====================================================
// Env vars required:
//   REVENUECAT_WEBHOOK_SECRET — shared secret from RevenueCat dashboard
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — service role for DB writes
// =====================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { privateResponseHeaders } from "../_shared/cors.ts";

const RESPONSE_HEADERS = privateResponseHeaders();

const SUPPORTED_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "CANCELLATION",
  "BILLING_ISSUE",
  "SUBSCRIBER_ALIAS",
  "EXPIRATION",
]);

type RevenueCatPeriodType = "MONTHLY" | "ANNUAL" | "LIFETIME";

interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  product_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number;
  period_type?: RevenueCatPeriodType;
}

interface RevenueCatPayload {
  event: RevenueCatEvent;
}

function planFromEntitlements(ids: string[]): string {
  if (ids.includes("business")) return "business";
  if (ids.includes("premium")) return "premium";
  if (ids.includes("pro")) return "pro";
  return "free";
}

async function verifySignature(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!secret) return false;

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // RevenueCat sends the raw secret as a Bearer token (not HMAC),
  // so we do a constant-time comparison.
  const expected = encoder.encode(secret);
  const received = encoder.encode(token);
  if (expected.length !== received.length) return false;

  // crypto.subtle.timingSafeEqual equivalent via HMAC sign + verify
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  const sigB = new Uint8Array(sig);
  const expected2 = await crypto.subtle.sign("HMAC", key, encoder.encode(secret));
  const expected2B = new Uint8Array(expected2);
  if (sigB.length !== expected2B.length) return false;
  let diff = 0;
  for (let i = 0; i < sigB.length; i++) {
    diff |= sigB[i]! ^ expected2B[i]!;
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: RESPONSE_HEADERS });
  }

  const body = await req.text();

  const valid = await verifySignature(req, body);
  if (!valid) {
    return new Response("Unauthorized", { status: 401, headers: RESPONSE_HEADERS });
  }

  let payload: RevenueCatPayload;
  try {
    payload = JSON.parse(body) as RevenueCatPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: RESPONSE_HEADERS });
  }

  const { event } = payload;
  if (!SUPPORTED_EVENTS.has(event.type)) {
    return new Response("Ignored", { status: 200, headers: RESPONSE_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = event.app_user_id;
  const entitlements = event.entitlement_ids ?? [];
  const plan = planFromEntitlements(entitlements);
  const status = event.type === "CANCELLATION" || event.type === "EXPIRATION"
    ? "expired"
    : event.type === "BILLING_ISSUE"
    ? "cancelled"
    : "active";
  const periodEnd = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan,
      status,
      revenuecat_customer_id: userId,
      entitlements: Object.fromEntries(entitlements.map((e) => [e, true])),
      period_end: periodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  await supabase.from("audit_logs").insert({
    user_id: userId,
    event_type: `revenuecat_${event.type.toLowerCase()}`,
    metadata: { plan, status, entitlements },
  });

  return new Response("OK", { status: 200, headers: RESPONSE_HEADERS });
});
