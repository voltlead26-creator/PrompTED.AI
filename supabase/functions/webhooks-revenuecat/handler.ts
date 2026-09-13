import { privateResponseHeaders } from "../_shared/cors.ts";

const RESPONSE_HEADERS = privateResponseHeaders();
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_REVENUECAT_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_IDENTIFIER_COUNT = 100;
const MAX_IDENTIFIER_LENGTH = 200;

const LIFECYCLE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "CANCELLATION",
  "BILLING_ISSUE",
  "EXPIRATION",
]);
const AUDIT_ONLY_EVENTS = new Set(["SUBSCRIBER_ALIAS", "TEST"]);
const TRANSFER_EVENTS = new Set(["TRANSFER"]);
const SUPPORTED_EVENTS = new Set([
  ...LIFECYCLE_EVENTS,
  ...AUDIT_ONLY_EVENTS,
  ...TRANSFER_EVENTS,
]);

export interface NormalizedRevenueCatEvent {
  api_version: "1.0";
  id: string;
  type: string;
  event_timestamp_ms: number;
  app_user_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  purchased_at_ms?: number;
  period_type?: string;
  product_id?: string;
  new_product_id?: string;
  cancel_reason?: string;
  aliases?: string[];
  transferred_from_user_ids?: string[];
  transferred_to_user_id?: string;
}

export interface RevenueCatPersistenceResult {
  data: unknown;
  error: unknown | null;
}

export interface RevenueCatPersistence {
  applyEvent(
    event: NormalizedRevenueCatEvent,
  ): Promise<RevenueCatPersistenceResult>;
}

export interface RevenueCatWebhookDependencies {
  secret: string | undefined;
  /** Exact receiver environment and app allowlist, supplied by server configuration. */
  sourcePolicy?: string;
  persistence: RevenueCatPersistence;
}

interface RevenueCatSourcePolicy {
  environment: "PRODUCTION" | "SANDBOX";
  appIds: string[];
}

function parseSourcePolicy(value: unknown): RevenueCatSourcePolicy | null {
  if (typeof value !== "string" || value.length > 32_768) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    (record.environment !== "PRODUCTION" && record.environment !== "SANDBOX") ||
    !Array.isArray(record.appIds) || record.appIds.length === 0 ||
    record.appIds.length > MAX_IDENTIFIER_COUNT
  ) return null;
  const appIds: string[] = [];
  for (const appId of record.appIds) {
    if (
      typeof appId !== "string" || appId.length === 0 ||
      appId.length > MAX_IDENTIFIER_LENGTH ||
      /\s/.test(appId) || appIds.includes(appId)
    ) return null;
    for (const character of appId) {
      const code = character.charCodeAt(0);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return null;
    }
    appIds.push(appId);
  }
  return { environment: record.environment, appIds };
}

function response(body: string, status: number): Response {
  return new Response(body, { status, headers: RESPONSE_HEADERS });
}

async function bearerMatches(req: Request, secret: string): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const received = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(token)),
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(secret)),
  );
  if (received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received[index]! ^ expected[index]!;
  }
  return difference === 0;
}

function parseTimestamp(
  value: unknown,
  { nullable = false }: { nullable?: boolean } = {},
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
    value > MAX_REVENUECAT_TIMESTAMP_MS
  ) {
    return undefined;
  }
  return value;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 &&
      value.length <= MAX_IDENTIFIER_LENGTH
    ? value
    : undefined;
}

function parseStringArray(
  value: unknown,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_IDENTIFIER_COUNT) return null;
  const strings = value.filter((entry): entry is string =>
    typeof entry === "string" && entry.length > 0 &&
    entry.length <= MAX_IDENTIFIER_LENGTH
  );
  if (
    strings.length !== value.length || (!allowEmpty && strings.length === 0)
  ) {
    return null;
  }
  return [...new Set(strings)];
}

function parseCommonEvent(
  apiVersion: unknown,
  rawEvent: unknown,
):
  | { record: Record<string, unknown>; common: NormalizedRevenueCatEvent }
  | null {
  if (apiVersion !== "1.0") return null;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }
  const record = rawEvent as Record<string, unknown>;
  if (
    typeof record.type !== "string" || !SUPPORTED_EVENTS.has(record.type) ||
    typeof record.id !== "string" || !EVENT_ID_PATTERN.test(record.id)
  ) {
    return null;
  }
  const eventTimestamp = parseTimestamp(record.event_timestamp_ms);
  if (eventTimestamp === undefined || eventTimestamp === null) return null;
  return {
    record,
    common: {
      api_version: "1.0",
      id: record.id,
      type: record.type,
      event_timestamp_ms: eventTimestamp,
    },
  };
}

function parseLifecycleEvent(
  record: Record<string, unknown>,
  common: NormalizedRevenueCatEvent,
): NormalizedRevenueCatEvent | null {
  if (
    typeof record.app_user_id !== "string" ||
    !USER_ID_PATTERN.test(record.app_user_id)
  ) {
    return null;
  }
  const entitlements = record.entitlement_ids === undefined ||
      record.entitlement_ids === null
    ? []
    : parseStringArray(record.entitlement_ids);
  if (!entitlements) return null;

  const expiration = parseTimestamp(record.expiration_at_ms, {
    nullable: true,
  });
  const graceExpiration = parseTimestamp(record.grace_period_expiration_at_ms, {
    nullable: true,
  });
  const purchased = parseTimestamp(record.purchased_at_ms);
  if (
    (record.expiration_at_ms !== undefined && expiration === undefined) ||
    (record.grace_period_expiration_at_ms !== undefined &&
      graceExpiration === undefined) ||
    (record.purchased_at_ms !== undefined && purchased === undefined)
  ) {
    return null;
  }

  const event: NormalizedRevenueCatEvent = {
    ...common,
    app_user_id: record.app_user_id,
    entitlement_ids: entitlements,
  };
  if (expiration !== undefined) event.expiration_at_ms = expiration;
  if (graceExpiration !== undefined) {
    event.grace_period_expiration_at_ms = graceExpiration;
  }
  if (typeof purchased === "number") event.purchased_at_ms = purchased;
  for (
    const key of [
      "period_type",
      "product_id",
      "new_product_id",
      "cancel_reason",
    ] as const
  ) {
    const rawValue = record[key];
    if (rawValue === undefined || rawValue === null) continue;
    const value = parseOptionalString(rawValue);
    if (value === undefined) return null;
    event[key] = value;
  }
  return event;
}

function parseAliasEvent(
  record: Record<string, unknown>,
  common: NormalizedRevenueCatEvent,
): NormalizedRevenueCatEvent | null {
  if (common.type === "TEST") {
    // RevenueCat dashboard tests use purchase-like synthetic data, but their
    // subscriber identity is not application state and need not map locally.
    return common;
  }
  if (
    typeof record.app_user_id !== "string" ||
    !USER_ID_PATTERN.test(record.app_user_id)
  ) {
    return null;
  }
  const aliases = parseStringArray(record.aliases, { allowEmpty: false });
  if (!aliases) return null;
  return { ...common, app_user_id: record.app_user_id, aliases };
}

function parseTransferEvent(
  record: Record<string, unknown>,
  common: NormalizedRevenueCatEvent,
): NormalizedRevenueCatEvent | null {
  const transferredFrom = parseStringArray(record.transferred_from, {
    allowEmpty: false,
  });
  const transferredTo = parseStringArray(record.transferred_to, {
    allowEmpty: false,
  });
  if (!transferredFrom || !transferredTo) return null;

  // RevenueCat arrays may contain anonymous aliases. PrompTED can mutate only
  // identities that map to its Supabase UUID users. One local destination is
  // required; multiple mapped sources are merged transactionally by the RPC.
  const mappedSources = transferredFrom.filter((value) =>
    USER_ID_PATTERN.test(value)
  );
  const mappedDestinations = transferredTo.filter((value) =>
    USER_ID_PATTERN.test(value)
  );
  if (mappedSources.length < 1 || mappedDestinations.length !== 1) return null;
  const destination = mappedDestinations[0]!;
  if (mappedSources.includes(destination)) return null;
  return {
    ...common,
    transferred_from_user_ids: [...new Set(mappedSources)].sort(),
    transferred_to_user_id: destination,
  };
}

function parseEvent(payload: unknown):
  | {
    kind: "supported";
    event: NormalizedRevenueCatEvent;
    source: { appId: unknown; environment: unknown };
  }
  | { kind: "unsupported" }
  | { kind: "invalid" } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "invalid" };
  }
  const payloadRecord = payload as Record<string, unknown>;
  const rawEvent = payloadRecord.event;
  const rawType = rawEvent && typeof rawEvent === "object" &&
      !Array.isArray(rawEvent)
    ? (rawEvent as Record<string, unknown>).type
    : undefined;
  if (typeof rawType === "string" && !SUPPORTED_EVENTS.has(rawType)) {
    return { kind: "unsupported" };
  }
  const parsed = parseCommonEvent(payloadRecord.api_version, rawEvent);
  if (!parsed) return { kind: "invalid" };

  let event: NormalizedRevenueCatEvent | null;
  if (LIFECYCLE_EVENTS.has(parsed.common.type)) {
    event = parseLifecycleEvent(parsed.record, parsed.common);
  } else if (AUDIT_ONLY_EVENTS.has(parsed.common.type)) {
    event = parseAliasEvent(parsed.record, parsed.common);
  } else {
    event = parseTransferEvent(parsed.record, parsed.common);
  }
  return event
    ? {
      kind: "supported",
      event,
      source: {
        appId: parsed.record.app_id,
        environment: parsed.record.environment,
      },
    }
    : { kind: "invalid" };
}

function persistenceErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  return typeof record.message === "string" ? record.message : "";
}

function isValidPersistenceResult(
  value: unknown,
  expectedEventId: string,
  expectedEventType: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (
    receipt.eventId !== expectedEventId ||
    typeof receipt.stateApplied !== "boolean"
  ) return false;

  // The atomic RPC reports this delivery's effect. A duplicate never applies
  // state again, even when its original immutable receipt records an application.
  if (receipt.outcome === "duplicate") return receipt.stateApplied === false;
  if (AUDIT_ONLY_EVENTS.has(expectedEventType)) {
    return receipt.outcome === "recorded" && receipt.stateApplied === false;
  }
  return (receipt.outcome === "applied" && receipt.stateApplied === true) ||
    (receipt.outcome === "stale" && receipt.stateApplied === false);
}

export async function handleRevenueCatWebhook(
  req: Request,
  dependencies: RevenueCatWebhookDependencies,
): Promise<Response> {
  if (req.method !== "POST") return response("Method not allowed", 405);
  if (!dependencies.secret) return response("Service unavailable", 503);
  if (!(await bearerMatches(req, dependencies.secret))) {
    return response("Unauthorized", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return response("Invalid JSON", 400);
  }
  const parsed = parseEvent(payload);
  if (parsed.kind === "unsupported") return response("Unsupported event", 422);
  if (parsed.kind === "invalid") return response("Invalid event", 400);

  const { id: expectedEventId, type: expectedEventType } = parsed.event;
  if (!AUDIT_ONLY_EVENTS.has(expectedEventType)) {
    const policy = parseSourcePolicy(dependencies.sourcePolicy);
    if (!policy) return response("Service unavailable", 503);
    if (
      parsed.source.environment !== policy.environment ||
      typeof parsed.source.appId !== "string" ||
      !policy.appIds.includes(parsed.source.appId)
    ) return response("Event source not allowed", 403);
  }
  // Source admission also applies to duplicate deliveries and transfers.
  // Keep it outside the immutable normalized payload used by existing RPC hashes.
  try {
    const result = await dependencies.persistence.applyEvent(parsed.event);
    if (result.error) {
      const message = persistenceErrorMessage(result.error);
      if (message.includes("REVENUECAT_EVENT_ID_CONFLICT")) {
        return response("Conflicting event", 409);
      }
      if (
        message.includes("REVENUECAT_EVENT_UNMAPPED") ||
        message.includes("REVENUECAT_USER_UNMAPPED") ||
        message.includes("REVENUECAT_TRANSFER_SOURCE_NOT_FOUND") ||
        message.includes("REVENUECAT_SUBSCRIPTION_STATE_MISSING")
      ) {
        return response("Unmapped event", 422);
      }
      return response("Persistence unavailable", 503);
    }
    if (
      !isValidPersistenceResult(result.data, expectedEventId, expectedEventType)
    ) {
      return response("Persistence unavailable", 503);
    }
  } catch {
    return response("Persistence unavailable", 503);
  }

  return response("OK", 200);
}
