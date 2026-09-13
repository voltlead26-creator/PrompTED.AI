// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assertEquals, assertObjectMatch } from "jsr:@std/assert@1";
import {
  handleRevenueCatWebhook,
  type NormalizedRevenueCatEvent,
  type RevenueCatPersistence,
} from "./handler.ts";

const USER_ID = "81000000-0000-4000-8000-000000000001";
const SOURCE_USER_ID = "81000000-0000-4000-8000-000000000002";
const DESTINATION_USER_ID = "81000000-0000-4000-8000-000000000003";
const SECRET = "synthetic-webhook-secret";
const APP_ID = "app-synthetic-web-billing";
const SCOPED_SOURCE = { app_id: APP_ID, environment: "PRODUCTION" };
const SOURCE_POLICY = JSON.stringify({
  environment: "PRODUCTION",
  appIds: [APP_ID],
});

function configuredDependencies(
  store: RevenueCatPersistence,
  sourcePolicy: string | undefined = SOURCE_POLICY,
) {
  // Keep this inferred structural dependency compatible with the existing
  // handler while the test-first source-policy boundary is introduced.
  return { secret: SECRET, persistence: store, sourcePolicy };
}

function request(
  event: Record<string, unknown>,
  authorization = `Bearer ${SECRET}`,
  apiVersion = "1.0",
): Request {
  return new Request(
    "https://example.invalid/functions/v1/webhooks-revenuecat",
    {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({ api_version: apiVersion, event }),
    },
  );
}

function persistence(options: {
  data?: unknown;
  error?: unknown;
  throws?: boolean;
} = {}): RevenueCatPersistence & { events: NormalizedRevenueCatEvent[] } {
  const events: NormalizedRevenueCatEvent[] = [];
  return {
    events,
    applyEvent(event) {
      events.push(event);
      if (options.throws) throw new Error("database unavailable");
      return Promise.resolve({
        data: "data" in options ? options.data : {
          outcome: "applied",
          eventId: event.id,
          stateApplied: true,
        },
        error: options.error ?? null,
      });
    },
  };
}

function lifecycle(type: string, id = `evt-${type.toLowerCase()}`) {
  return {
    type,
    id,
    ...SCOPED_SOURCE,
    event_timestamp_ms: 1_800_000_000_000,
    app_user_id: USER_ID,
    entitlement_ids: ["pro"],
    expiration_at_ms: 1_900_000_000_000,
    purchased_at_ms: 1_700_000_000_000,
    period_type: "NORMAL",
    product_id: "prompted.pro.monthly",
  };
}

for (
  const type of [
    "INITIAL_PURCHASE",
    "RENEWAL",
    "CANCELLATION",
    "BILLING_ISSUE",
    "EXPIRATION",
  ]
) {
  Deno.test(`RevenueCat webhook normalizes ${type} into one RPC call`, async () => {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request(lifecycle(type)),
      configuredDependencies(store),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "OK");
    assertEquals(store.events.length, 1);
    assertObjectMatch(store.events[0]!, {
      api_version: "1.0",
      id: `evt-${type.toLowerCase()}`,
      type,
      event_timestamp_ms: 1_800_000_000_000,
      app_user_id: USER_ID,
      entitlement_ids: ["pro"],
      expiration_at_ms: 1_900_000_000_000,
    });
  });
}

Deno.test("RevenueCat webhook preserves pending-product evidence for PRODUCT_CHANGE", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({
      ...lifecycle("PRODUCT_CHANGE"),
      new_product_id: "prompted.premium.annual",
    }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(store.events[0]!, {
    type: "PRODUCT_CHANGE",
    product_id: "prompted.pro.monthly",
    new_product_id: "prompted.premium.annual",
  });
});

Deno.test("RevenueCat webhook records the deprecated alias event without inventing state", async () => {
  const store = persistence({
    data: { outcome: "recorded", eventId: "evt-alias", stateApplied: false },
  });
  const response = await handleRevenueCatWebhook(
    request({
      type: "SUBSCRIBER_ALIAS",
      id: "evt-alias",
      event_timestamp_ms: 1_800_000_000_100,
      app_user_id: USER_ID,
      aliases: ["$RCAnonymousID:synthetic", USER_ID],
    }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(store.events[0]!, {
    type: "SUBSCRIBER_ALIAS",
    app_user_id: USER_ID,
    aliases: ["$RCAnonymousID:synthetic", USER_ID],
  });
});

Deno.test("RevenueCat webhook durably acknowledges the dashboard TEST event", async () => {
  const store = persistence({
    data: { outcome: "recorded", eventId: "evt-test", stateApplied: false },
  });
  const response = await handleRevenueCatWebhook(
    request({
      type: "TEST",
      id: "evt-test",
      event_timestamp_ms: 1_800_000_000_150,
      app_user_id: "synthetic-dashboard-customer",
    }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 200);
  assertEquals(store.events, [{
    api_version: "1.0",
    id: "evt-test",
    type: "TEST",
    event_timestamp_ms: 1_800_000_000_150,
  }]);
});

Deno.test("RevenueCat webhook maps a transfer to local UUID identities only", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({
      type: "TRANSFER",
      id: "evt-transfer",
      ...SCOPED_SOURCE,
      event_timestamp_ms: 1_800_000_000_200,
      transferred_from: ["$RCAnonymousID:source", SOURCE_USER_ID],
      transferred_to: ["$RCAnonymousID:destination", DESTINATION_USER_ID],
    }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 200);
  assertEquals(store.events, [{
    api_version: "1.0",
    id: "evt-transfer",
    type: "TRANSFER",
    event_timestamp_ms: 1_800_000_000_200,
    transferred_from_user_ids: [SOURCE_USER_ID],
    transferred_to_user_id: DESTINATION_USER_ID,
  }]);
});

Deno.test("RevenueCat webhook fails closed for a transfer without one mapped destination", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({
      type: "TRANSFER",
      id: "evt-unmapped-transfer",
      ...SCOPED_SOURCE,
      event_timestamp_ms: 1_800_000_000_300,
      transferred_from: [SOURCE_USER_ID],
      transferred_to: ["$RCAnonymousID:destination"],
    }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 400);
  assertEquals(store.events, []);
});

Deno.test("RevenueCat webhook rejects an unknown event without persistence", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({
      type: "FUTURE_ENTITLEMENT_EVENT",
      id: "evt-unhandled",
      event_timestamp_ms: 1_800_000_000_400,
    }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 422);
  assertEquals(await response.text(), "Unsupported event");
  assertEquals(store.events, []);
});

Deno.test("RevenueCat webhook requires the canonical event id and event timestamp", async () => {
  for (
    const invalidEvent of [
      { ...lifecycle("RENEWAL"), id: undefined },
      { ...lifecycle("RENEWAL"), event_timestamp_ms: undefined },
      { ...lifecycle("RENEWAL"), event_timestamp_ms: 1.5 },
      { ...lifecycle("PRODUCT_CHANGE"), new_product_id: 42 },
    ]
  ) {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request(invalidEvent),
      configuredDependencies(store),
    );
    assertEquals(response.status, 400);
    assertEquals(store.events, []);
  }
});

Deno.test("RevenueCat webhook rejects an unknown API version", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL"), `Bearer ${SECRET}`, "2.0"),
    configuredDependencies(store),
  );

  assertEquals(response.status, 400);
  assertEquals(store.events, []);
});

Deno.test("RevenueCat webhook returns 503 when the atomic RPC fails", async () => {
  const store = persistence({ error: new Error("audit unavailable") });
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL")),
    configuredDependencies(store),
  );

  assertEquals(response.status, 503);
  assertEquals(await response.text(), "Persistence unavailable");
  assertEquals(store.events.length, 1);
});

Deno.test("RevenueCat webhook maps an event-id collision to a retryable conflict", async () => {
  const store = persistence({
    error: { message: "REVENUECAT_EVENT_ID_CONFLICT:evt-renewal" },
  });
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL")),
    configuredDependencies(store),
  );

  assertEquals(response.status, 409);
  assertEquals(await response.text(), "Conflicting event");
});

Deno.test("RevenueCat webhook fails closed when the RPC returns no receipt", async () => {
  const store = persistence({ data: null });
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL")),
    configuredDependencies(store),
  );

  assertEquals(response.status, 503);
});

const renewalReceipt = {
  outcome: "applied",
  eventId: "evt-renewal",
  stateApplied: true,
};

async function expectPersistenceReceipt(
  data: unknown,
  expectedStatus: 200 | 503,
  event: Record<string, unknown> = lifecycle("RENEWAL"),
) {
  const store = persistence({ data });
  const response = await handleRevenueCatWebhook(
    request(event),
    configuredDependencies(store),
  );

  // Reach the persistence boundary once: a parser rejection or a hidden retry
  // must not satisfy a malformed-receipt regression.
  assertEquals(store.events.length, 1);
  assertEquals(store.events[0]!.id, event.id);
  assertEquals(store.events[0]!.type, event.type);
  assertEquals(response.status, expectedStatus);
  assertEquals(
    await response.text(),
    expectedStatus === 200 ? "OK" : "Persistence unavailable",
  );
}

const invalidReceipts: Array<{ name: string; data: unknown }> = [
  { name: "missing identity and application state", data: { outcome: "applied" } },
  {
    name: "missing event identity",
    data: { outcome: "applied", stateApplied: true },
  },
  {
    name: "missing application state",
    data: { outcome: "applied", eventId: "evt-renewal" },
  },
  ...[
    ["null event identity", null],
    ["numeric event identity", 42],
    ["empty event identity", ""],
    ["different event identity", "evt-other-customer-renewal"],
    ["case-changed event identity", "EVT-RENEWAL"],
    ["padded event identity", " evt-renewal "],
    ["newline-suffixed event identity", "evt-renewal\n"],
  ].map(([name, eventId]) => ({
    name: String(name),
    data: { ...renewalReceipt, eventId },
  })),
  ...[
    ["null application state", null],
    ["string true application state", "true"],
    ["string false application state", "false"],
    ["numeric true application state", 1],
    ["numeric false application state", 0],
    ["object application state", {}],
  ].map(([name, stateApplied]) => ({
    name: String(name),
    data: { ...renewalReceipt, stateApplied },
  })),
  {
    name: "applied disposition without an applied state",
    data: { ...renewalReceipt, stateApplied: false },
  },
  {
    name: "duplicate disposition claiming another state application",
    data: { ...renewalReceipt, outcome: "duplicate" },
  },
  {
    name: "stale disposition claiming a state application",
    data: { ...renewalReceipt, outcome: "stale" },
  },
  { name: "undefined receipt", data: undefined },
  { name: "array receipt", data: [renewalReceipt] },
  { name: "serialized receipt", data: JSON.stringify(renewalReceipt) },
  {
    name: "missing disposition",
    data: { eventId: "evt-renewal", stateApplied: true },
  },
  { name: "unknown disposition", data: { ...renewalReceipt, outcome: "accepted" } },
];

for (const { name, data } of invalidReceipts) {
  Deno.test(`RevenueCat webhook rejects ${name} in its persistence receipt`, async () => {
    await expectPersistenceReceipt(data, 503);
  });
}

const receiptEventCases: Array<{
  event: Record<string, unknown>;
  auditOnly: boolean;
}> = [
  { event: lifecycle("RENEWAL"), auditOnly: false },
  {
    event: {
      type: "TRANSFER",
      id: "evt-transfer-receipt",
      ...SCOPED_SOURCE,
      event_timestamp_ms: 1_800_000_000_200,
      transferred_from: [SOURCE_USER_ID],
      transferred_to: [DESTINATION_USER_ID],
    },
    auditOnly: false,
  },
  {
    event: {
      type: "TEST",
      id: "evt-test-receipt",
      event_timestamp_ms: 1_800_000_000_200,
    },
    auditOnly: true,
  },
  {
    event: {
      type: "SUBSCRIBER_ALIAS",
      id: "evt-alias-receipt",
      event_timestamp_ms: 1_800_000_000_200,
      app_user_id: USER_ID,
      aliases: ["$RCAnonymousID:synthetic"],
    },
    auditOnly: true,
  },
];

for (const { event, auditOnly } of receiptEventCases) {
  for (const outcome of ["applied", "duplicate", "stale", "recorded"]) {
    // SQL applies lifecycle/transfer state or records a stale delivery; TEST
    // and SUBSCRIBER_ALIAS only record provenance. Every type may be replayed.
    const valid = outcome === "duplicate" ||
      (auditOnly ? outcome === "recorded" : outcome !== "recorded");
    Deno.test(`RevenueCat webhook ${valid ? "accepts" : "rejects"} ${outcome} receipt for ${event.type}`, async () => {
      await expectPersistenceReceipt({
        outcome,
        eventId: event.id,
        stateApplied: outcome === "applied",
      }, valid ? 200 : 503, event);
    });
  }
}

Deno.test("RevenueCat webhook rejects a recorded audit receipt claiming state application", async () => {
  const event = receiptEventCases[2]!.event;
  await expectPersistenceReceipt({
    outcome: "recorded",
    eventId: event.id,
    stateApplied: true,
  }, 503, event);
});

Deno.test("RevenueCat webhook preserves the exact case-sensitive submitted event identity", async () => {
  const event = lifecycle("RENEWAL", "Evt-Mixed.Case_Identity:1");
  await expectPersistenceReceipt({
    outcome: "applied",
    eventId: event.id,
    stateApplied: true,
  }, 200, event);
});

Deno.test("RevenueCat webhook acknowledges a duplicate with no new state application after an applied delivery", async () => {
  const events: NormalizedRevenueCatEvent[] = [];
  const store: RevenueCatPersistence = {
    applyEvent(event) {
      events.push(event);
      // The SQL duplicate branch returns false even if its immutable original
      // receipt records state_applied=true. It reports this delivery's effect.
      return Promise.resolve({
        data: {
          outcome: events.length === 1 ? "applied" : "duplicate",
          eventId: event.id,
          stateApplied: events.length === 1,
        },
        error: null,
      });
    },
  };
  for (let delivery = 0; delivery < 2; delivery++) {
    const response = await handleRevenueCatWebhook(
      request(lifecycle("RENEWAL")),
      configuredDependencies(store),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "OK");
  }
  assertEquals(events.length, 2);
  assertEquals(events[0], events[1]);
});

Deno.test("RevenueCat webhook rejects an invalid user identity before persistence", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({ ...lifecycle("RENEWAL"), app_user_id: "not-a-user-id" }),
    configuredDependencies(store),
  );

  assertEquals(response.status, 400);
  assertEquals(store.events, []);
});

for (
  const { name: suffixName, suffix } of [
    { name: "LF", suffix: "\n" },
    { name: "CR", suffix: "\r" },
    { name: "CRLF", suffix: "\r\n" },
    { name: "line separator", suffix: "\u2028" },
    { name: "paragraph separator", suffix: "\u2029" },
  ]
) {
  const invalidIdentifierEvents: Array<{
    name: string;
    event: Record<string, unknown>;
  }> = [
    {
      name: "event id",
      event: lifecycle("RENEWAL", `evt-identifier${suffix}`),
    },
    {
      name: "lifecycle user id",
      event: { ...lifecycle("RENEWAL"), app_user_id: USER_ID + suffix },
    },
    {
      name: "alias user id",
      event: {
        type: "SUBSCRIBER_ALIAS",
        id: "evt-alias-identifier",
        event_timestamp_ms: 1_800_000_000_200,
        app_user_id: USER_ID + suffix,
        aliases: ["$RCAnonymousID:synthetic"],
      },
    },
    {
      name: "transfer source id",
      event: {
        type: "TRANSFER",
        id: "evt-transfer-source-identifier",
        ...SCOPED_SOURCE,
        event_timestamp_ms: 1_800_000_000_200,
        transferred_from: [SOURCE_USER_ID + suffix],
        transferred_to: [DESTINATION_USER_ID],
      },
    },
    {
      name: "transfer destination id",
      event: {
        type: "TRANSFER",
        id: "evt-transfer-destination-identifier",
        ...SCOPED_SOURCE,
        event_timestamp_ms: 1_800_000_000_200,
        transferred_from: [SOURCE_USER_ID],
        transferred_to: [DESTINATION_USER_ID + suffix],
      },
    },
  ];
  for (const { name, event } of invalidIdentifierEvents) {
    Deno.test(`RevenueCat webhook rejects ${name} ending in ${suffixName} before persistence`, async () => {
      const store = persistence();
      const response = await handleRevenueCatWebhook(
        request(event),
        configuredDependencies(store),
      );
      assertEquals(store.events, []);
      assertEquals(response.status, 400);
      assertEquals(await response.text(), "Invalid event");
    });
  }
}

Deno.test("RevenueCat webhook rejects event IDs beyond the 160-character boundary without trimming", async () => {
  for (const id of ["A".repeat(161), "A".repeat(160) + "\n"]) {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request(lifecycle("RENEWAL", id)),
      configuredDependencies(store),
    );
    assertEquals(store.events, []);
    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid event");
  }
});

Deno.test("RevenueCat webhook preserves valid event identifier characters, case and length boundaries", async () => {
  for (const id of ["a", "0", "A.b_C:d-9", "A".repeat(160)]) {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request(lifecycle("RENEWAL", id)),
      configuredDependencies(store),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "OK");
    assertEquals(store.events.length, 1);
    assertEquals(store.events[0]!.id, id);
  }
});

Deno.test("RevenueCat webhook preserves all allowed UUID versions and variants without changing case", async () => {
  for (const version of "12345678") {
    for (const variant of "89ab") {
      const userId = `a1bC23dE-1234-${version}AbC-${variant}def-0123456789aB`;
      const store = persistence();
      const response = await handleRevenueCatWebhook(
        request({ ...lifecycle("RENEWAL"), app_user_id: userId }),
        configuredDependencies(store),
      );
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "OK");
      assertEquals(store.events.length, 1);
      assertEquals(store.events[0]!.app_user_id, userId);
    }
  }
});

Deno.test("RevenueCat webhook preserves a valid uppercase alias user identity", async () => {
  const userId = "A1BC23DE-1234-8ABC-BDEF-0123456789AB";
  const store = persistence({
    data: {
      outcome: "recorded",
      eventId: "evt-uppercase-alias",
      stateApplied: false,
    },
  });
  const response = await handleRevenueCatWebhook(request({
    type: "SUBSCRIBER_ALIAS",
    id: "evt-uppercase-alias",
    event_timestamp_ms: 1_800_000_000_200,
    app_user_id: userId,
    aliases: ["$RCAnonymousID:synthetic"],
  }), configuredDependencies(store));
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "OK");
  assertEquals(store.events.length, 1);
  assertEquals(store.events[0]!.app_user_id, userId);
});

Deno.test("RevenueCat webhook preserves valid mixed-case transfer identities and ignores anonymous aliases", async () => {
  const source = "a1bC23dE-1234-1AbC-9def-0123456789aB";
  const destination = "F1ED23CB-5678-8ABC-BDEF-0123456789AB";
  const store = persistence();
  const response = await handleRevenueCatWebhook(request({
    type: "TRANSFER",
    id: "evt-transfer-case",
    ...SCOPED_SOURCE,
    event_timestamp_ms: 1_800_000_000_200,
    transferred_from: ["$RCAnonymousID:source", source],
    transferred_to: ["$RCAnonymousID:destination", destination],
  }), configuredDependencies(store));
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "OK");
  assertEquals(store.events.length, 1);
  assertEquals(store.events[0]!.transferred_from_user_ids, [source]);
  assertEquals(store.events[0]!.transferred_to_user_id, destination);
});

Deno.test("RevenueCat webhook rejects the wrong bearer secret", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL"), "Bearer wrong-secret"),
    configuredDependencies(store),
  );

  assertEquals(response.status, 401);
  assertEquals(store.events, []);
});

const mutatingEventTypes = [
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "CANCELLATION",
  "BILLING_ISSUE",
  "EXPIRATION",
  "TRANSFER",
];

function mutatingEvent(type: string): Record<string, unknown> {
  if (type !== "TRANSFER") return lifecycle(type);
  return {
    type,
    id: "evt-transfer-scope",
    ...SCOPED_SOURCE,
    event_timestamp_ms: 1_800_000_000_000,
    transferred_from: ["$RCAnonymousID:source", SOURCE_USER_ID],
    transferred_to: ["$RCAnonymousID:destination", DESTINATION_USER_ID],
  };
}

function expectedMutation(type: string): NormalizedRevenueCatEvent {
  if (type === "TRANSFER") {
    return {
      api_version: "1.0",
      type,
      id: "evt-transfer-scope",
      event_timestamp_ms: 1_800_000_000_000,
      transferred_from_user_ids: [SOURCE_USER_ID],
      transferred_to_user_id: DESTINATION_USER_ID,
    };
  }
  return {
    api_version: "1.0",
    type,
    id: `evt-${type.toLowerCase()}`,
    event_timestamp_ms: 1_800_000_000_000,
    app_user_id: USER_ID,
    entitlement_ids: ["pro"],
    expiration_at_ms: 1_900_000_000_000,
    purchased_at_ms: 1_700_000_000_000,
    period_type: "NORMAL",
    product_id: "prompted.pro.monthly",
  };
}

for (const type of mutatingEventTypes) {
  Deno.test(`RevenueCat scoped ${type} keeps its exact historical normalized payload`, async () => {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request(mutatingEvent(type)),
      configuredDependencies(store),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "OK");
    // SQL hashes this complete normalized object. App/environment are admission
    // metadata and must not become new keys in historical replay payloads.
    assertEquals(store.events, [expectedMutation(type)]);
  });

  Deno.test(`RevenueCat ${type} requires explicit server source configuration before persistence`, async () => {
    const store = persistence();
    const dependencies = { secret: SECRET, persistence: store };
    const response = await handleRevenueCatWebhook(
      request(mutatingEvent(type)),
      dependencies,
    );
    assertEquals(store.events, []);
    assertEquals(response.status, 503);
    assertEquals(await response.text(), "Service unavailable");
  });

  for (
    const { name, source } of [
      { name: "missing app", source: { app_id: undefined } },
      { name: "wrong app", source: { app_id: "app-other-project" } },
      { name: "missing environment", source: { environment: undefined } },
      { name: "sandbox environment", source: { environment: "SANDBOX" } },
      {
        name: "unscoped delivery",
        source: { app_id: undefined, environment: undefined },
      },
    ]
  ) {
    Deno.test(`RevenueCat ${type} rejects ${name} before any persistence call`, async () => {
      const store = persistence();
      const response = await handleRevenueCatWebhook(
        request({ ...mutatingEvent(type), ...source }),
        configuredDependencies(store),
      );
      assertEquals(store.events, []);
      assertEquals(response.status, 403);
      assertEquals(await response.text(), "Event source not allowed");
    });
  }
}

for (
  const { name, source } of [
    { name: "null app", source: { app_id: null } },
    { name: "array app", source: { app_id: [APP_ID] } },
    { name: "object app", source: { app_id: { id: APP_ID } } },
    { name: "numeric app", source: { app_id: 42 } },
    { name: "case-changed app", source: { app_id: APP_ID.toUpperCase() } },
    { name: "padded app", source: { app_id: ` ${APP_ID} ` } },
    { name: "newline-suffixed app", source: { app_id: `${APP_ID}\n` } },
    { name: "null environment", source: { environment: null } },
    { name: "array environment", source: { environment: ["PRODUCTION"] } },
    { name: "object environment", source: { environment: { production: true } } },
    { name: "lowercase environment", source: { environment: "production" } },
    { name: "padded environment", source: { environment: " PRODUCTION " } },
    { name: "newline environment", source: { environment: "PRODUCTION\n" } },
  ]
) {
  Deno.test(`RevenueCat refuses to coerce ${name} into an authorized source`, async () => {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request({ ...lifecycle("RENEWAL"), ...source }),
      configuredDependencies(store),
    );
    assertEquals(store.events, []);
    assertEquals(response.status, 403);
    assertEquals(await response.text(), "Event source not allowed");
  });
}

const invalidSourcePolicies = [
  { name: "empty configuration", value: "" },
  { name: "whitespace configuration", value: " \n " },
  { name: "invalid JSON", value: "{not-json" },
  ...[
    { name: "null policy", value: null },
    { name: "array policy", value: [] },
    { name: "string policy", value: "PRODUCTION" },
    { name: "missing environment", value: { appIds: [APP_ID] } },
    { name: "missing app allowlist", value: { environment: "PRODUCTION" } },
    {
      name: "unknown environment",
      value: { environment: "STAGING", appIds: [APP_ID] },
    },
    {
      name: "lowercase environment",
      value: { environment: "production", appIds: [APP_ID] },
    },
    {
      name: "padded environment",
      value: { environment: "PRODUCTION ", appIds: [APP_ID] },
    },
    {
      name: "both environments",
      value: { environment: ["PRODUCTION", "SANDBOX"], appIds: [APP_ID] },
    },
    {
      name: "extra configuration keys",
      value: { environment: "PRODUCTION", appIds: [APP_ID], fallback: "SANDBOX" },
    },
    ...[
      { name: "empty app allowlist", appIds: [] },
      { name: "null app allowlist", appIds: null },
      { name: "string app allowlist", appIds: APP_ID },
      { name: "numeric app entry", appIds: [APP_ID, 42] },
      { name: "null app entry", appIds: [APP_ID, null] },
      { name: "empty app entry", appIds: [APP_ID, ""] },
      { name: "padded app entry", appIds: [APP_ID, ` ${APP_ID}`] },
      { name: "internal app whitespace", appIds: [APP_ID, "app other"] },
      { name: "newline app suffix", appIds: [APP_ID, `${APP_ID}\n`] },
      { name: "Unicode app whitespace", appIds: [APP_ID, "app\u2028other"] },
      { name: "app control character", appIds: [APP_ID, "app\u0000other"] },
      { name: "duplicate app entries", appIds: [APP_ID, APP_ID] },
      { name: "overlong app entry", appIds: [APP_ID, "a".repeat(201)] },
      {
        name: "too many app entries",
        appIds: [
          APP_ID,
          ...Array.from({ length: 100 }, (_, index) => `app-other-${index}`),
        ],
      },
    ].map(({ name, appIds }) => ({
      name,
      value: { environment: "PRODUCTION", appIds },
    })),
  ].map(({ name, value }) => ({ name, value: JSON.stringify(value) })),
];

for (const { name, value } of invalidSourcePolicies) {
  Deno.test(`RevenueCat fails unavailable for ${name} without applying an event`, async () => {
    const store = persistence();
    const dependencies = configuredDependencies(store, value);
    const response = await handleRevenueCatWebhook(
      request(lifecycle("RENEWAL")),
      dependencies,
    );
    assertEquals(store.events, []);
    assertEquals(response.status, 503);
    assertEquals(await response.text(), "Service unavailable");
  });
}

Deno.test("RevenueCat admits each explicitly configured app without assuming an app-ID prefix", async () => {
  const appIds = ["a", "opaque.Web:billing_2", "a".repeat(200)];
  const policy = JSON.stringify({ environment: "PRODUCTION", appIds });
  for (const appId of appIds) {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request({ ...lifecycle("RENEWAL"), app_id: appId }),
      configuredDependencies(store, policy),
    );
    assertEquals(response.status, 200);
    assertEquals(store.events, [expectedMutation("RENEWAL")]);
  }
});

Deno.test("RevenueCat admits the exact 100-entry allowlist boundary", async () => {
  const appIds = Array.from({ length: 100 }, (_, index) => `app-${index}`);
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({ ...lifecycle("RENEWAL"), app_id: appIds[99] }),
    configuredDependencies(
      store,
      JSON.stringify({ environment: "PRODUCTION", appIds }),
    ),
  );
  assertEquals(response.status, 200);
  assertEquals(store.events, [expectedMutation("RENEWAL")]);
});

Deno.test("RevenueCat treats configured app IDs as exact values rather than wildcard patterns", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL")),
    configuredDependencies(
      store,
      JSON.stringify({ environment: "PRODUCTION", appIds: ["*"] }),
    ),
  );
  assertEquals(store.events, []);
  assertEquals(response.status, 403);
  assertEquals(await response.text(), "Event source not allowed");
});

Deno.test("RevenueCat sandbox receiver admits only its explicitly configured environment", async () => {
  const policy = JSON.stringify({ environment: "SANDBOX", appIds: [APP_ID] });
  const sandboxStore = persistence();
  const sandboxResponse = await handleRevenueCatWebhook(
    request({ ...mutatingEvent("TRANSFER"), environment: "SANDBOX" }),
    configuredDependencies(sandboxStore, policy),
  );
  assertEquals(sandboxResponse.status, 200);
  assertEquals(sandboxStore.events, [expectedMutation("TRANSFER")]);

  const productionStore = persistence();
  const productionResponse = await handleRevenueCatWebhook(
    request(mutatingEvent("TRANSFER")),
    configuredDependencies(productionStore, policy),
  );
  assertEquals(productionStore.events, []);
  assertEquals(productionResponse.status, 403);
  assertEquals(await productionResponse.text(), "Event source not allowed");
});

Deno.test("RevenueCat source admission uses the exact app and environment without inventing store policy", async () => {
  for (const storeValue of [undefined, "RC_BILLING", "APP_STORE", "TEST_STORE"]) {
    const store = persistence();
    const response = await handleRevenueCatWebhook(
      request({ ...lifecycle("RENEWAL"), store: storeValue }),
      configuredDependencies(store),
    );
    assertEquals(response.status, 200);
    assertEquals(store.events, [expectedMutation("RENEWAL")]);
  }
});

Deno.test("RevenueCat rejects an out-of-scope redelivery before consulting duplicate receipts", async () => {
  const store = persistence({
    data: { outcome: "duplicate", eventId: "evt-renewal", stateApplied: false },
  });
  const response = await handleRevenueCatWebhook(
    request({ ...lifecycle("RENEWAL"), environment: "SANDBOX" }),
    configuredDependencies(store),
  );
  assertEquals(store.events, []);
  assertEquals(response.status, 403);
  assertEquals(await response.text(), "Event source not allowed");
});

for (const type of ["TEST", "SUBSCRIBER_ALIAS"]) {
  const event = {
    type,
    id: `evt-audit-scope-${type.toLowerCase()}`,
    event_timestamp_ms: 1_800_000_000_000,
    app_user_id: USER_ID,
    aliases: ["$RCAnonymousID:audit"],
    app_id: null,
    environment: ["SANDBOX", "PRODUCTION"],
  };
  const expected: NormalizedRevenueCatEvent = {
    api_version: "1.0",
    type,
    id: event.id,
    event_timestamp_ms: 1_800_000_000_000,
    ...(type === "SUBSCRIBER_ALIAS"
      ? { app_user_id: USER_ID, aliases: ["$RCAnonymousID:audit"] }
      : {}),
  };
  for (const sourcePolicy of [undefined, "{invalid-source-policy"]) {
    for (const outcome of ["recorded", "duplicate"]) {
      Deno.test(`RevenueCat audit-only ${type} keeps ${outcome} behavior with ${sourcePolicy === undefined ? "missing" : "invalid"} source policy`, async () => {
        const store = persistence({
          data: { outcome, eventId: event.id, stateApplied: false },
        });
        const dependencies = { secret: SECRET, persistence: store, sourcePolicy };
        const response = await handleRevenueCatWebhook(
          request(event),
          dependencies,
        );
        assertEquals(response.status, 200);
        assertEquals(await response.text(), "OK");
        assertEquals(store.events, [expected]);
      });
    }
  }

  Deno.test(`RevenueCat audit-only ${type} still requires a valid bearer without source policy`, async () => {
    const store = persistence();
    const dependencies = { secret: SECRET, persistence: store };
    const response = await handleRevenueCatWebhook(
      request(event, "Bearer wrong-secret"),
      dependencies,
    );
    assertEquals(store.events, []);
    assertEquals(response.status, 401);
    assertEquals(await response.text(), "Unauthorized");
  });

  Deno.test(`RevenueCat audit-only ${type} still rejects a receipt claiming state application without source policy`, async () => {
    const store = persistence({
      data: { outcome: "recorded", eventId: event.id, stateApplied: true },
    });
    const dependencies = { secret: SECRET, persistence: store };
    const response = await handleRevenueCatWebhook(request(event), dependencies);
    assertEquals(store.events, [expected]);
    assertEquals(response.status, 503);
    assertEquals(await response.text(), "Persistence unavailable");
  });
}

Deno.test("RevenueCat authentication failure takes precedence over invalid source configuration", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL"), "Bearer wrong-secret"),
    configuredDependencies(store, "{invalid-source-policy"),
  );
  assertEquals(store.events, []);
  assertEquals(response.status, 401);
  assertEquals(await response.text(), "Unauthorized");
});
