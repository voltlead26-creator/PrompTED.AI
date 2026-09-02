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
    const response = await handleRevenueCatWebhook(request(lifecycle(type)), {
      secret: SECRET,
      persistence: store,
    });

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
    { secret: SECRET, persistence: store },
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
    { secret: SECRET, persistence: store },
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
    { secret: SECRET, persistence: store },
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
      event_timestamp_ms: 1_800_000_000_200,
      transferred_from: ["$RCAnonymousID:source", SOURCE_USER_ID],
      transferred_to: ["$RCAnonymousID:destination", DESTINATION_USER_ID],
    }),
    { secret: SECRET, persistence: store },
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
      event_timestamp_ms: 1_800_000_000_300,
      transferred_from: [SOURCE_USER_ID],
      transferred_to: ["$RCAnonymousID:destination"],
    }),
    { secret: SECRET, persistence: store },
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
    { secret: SECRET, persistence: store },
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
    const response = await handleRevenueCatWebhook(request(invalidEvent), {
      secret: SECRET,
      persistence: store,
    });
    assertEquals(response.status, 400);
    assertEquals(store.events, []);
  }
});

Deno.test("RevenueCat webhook rejects an unknown API version", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL"), `Bearer ${SECRET}`, "2.0"),
    { secret: SECRET, persistence: store },
  );

  assertEquals(response.status, 400);
  assertEquals(store.events, []);
});

Deno.test("RevenueCat webhook returns 503 when the atomic RPC fails", async () => {
  const store = persistence({ error: new Error("audit unavailable") });
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL")),
    {
      secret: SECRET,
      persistence: store,
    },
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
    {
      secret: SECRET,
      persistence: store,
    },
  );

  assertEquals(response.status, 409);
  assertEquals(await response.text(), "Conflicting event");
});

Deno.test("RevenueCat webhook fails closed when the RPC returns no receipt", async () => {
  const store = persistence({ data: null });
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL")),
    {
      secret: SECRET,
      persistence: store,
    },
  );

  assertEquals(response.status, 503);
});

Deno.test("RevenueCat webhook rejects an invalid user identity before persistence", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request({ ...lifecycle("RENEWAL"), app_user_id: "not-a-user-id" }),
    { secret: SECRET, persistence: store },
  );

  assertEquals(response.status, 400);
  assertEquals(store.events, []);
});

Deno.test("RevenueCat webhook rejects the wrong bearer secret", async () => {
  const store = persistence();
  const response = await handleRevenueCatWebhook(
    request(lifecycle("RENEWAL"), "Bearer wrong-secret"),
    { secret: SECRET, persistence: store },
  );

  assertEquals(response.status, 401);
  assertEquals(store.events, []);
});
