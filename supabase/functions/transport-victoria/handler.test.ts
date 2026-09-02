// deno-lint-ignore no-import-prefix -- repository test dependency is pinned by the Deno lockfile.
import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1";
import type { AuthContext } from "../_shared/auth-guard.ts";
import { AuthError } from "../_shared/auth-guard.ts";
import {
  type PtvClient,
  PtvConfigurationError,
  PtvDispatchError,
  type PtvQueryValue,
} from "../_shared/ptv-client.ts";
import {
  buildTransportDispatch,
  handleTransportVictoriaRequest,
  parseTransportRequest,
  PTV_LOCATION_PRECISION_POLICY,
  type TransportDependencies,
} from "./handler.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "20000000-0000-4000-8000-000000000001";

function request(body: Record<string, unknown>): Request {
  return new Request(
    "https://example.test/functions/v1/transport-victoria",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function auth(body: Record<string, unknown>): AuthContext {
  const generationRequestId = String(
    body.generation_request_id ?? body.request_id ?? "",
  );
  return {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin: {} as AuthContext["admin"],
    body,
    multipartBody: null,
    generationRequestId,
  };
}

function fakePtvClient(
  get: (
    path: string,
    query: Record<string, PtvQueryValue>,
  ) => Promise<unknown>,
): PtvClient {
  return { get } as unknown as PtvClient;
}

function baseBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    action: "departures",
    consent: { publicTransportLookup: true },
    request_id: "transport-request-1",
    routeType: 0,
    stopId: 1071,
    ...overrides,
  };
}

function admittedClaim(input: { dispatchToken: string }) {
  return Promise.resolve({
    data: {
      outcome: "accepted",
      egress_permitted: true,
      dispatch_token: input.dispatchToken,
    },
    error: null,
  });
}

function completed() {
  return Promise.resolve({
    data: { outcome: "completed", terminal_state: "completed" },
    error: null,
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("transport rejects unauthenticated requests before admission or PTV", async () => {
  let claimed = 0;
  let dispatched = 0;
  const response = await handleTransportVictoriaRequest(request(baseBody()), {
    guard: () =>
      Promise.reject(
        new AuthError(401, "unauthenticated", {
          error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
        }),
      ),
    claim: (_admin, input) => {
      claimed += 1;
      return admittedClaim(input);
    },
    createPtvClient: () =>
      fakePtvClient(() => {
        dispatched += 1;
        return Promise.resolve({});
      }),
  });
  assertEquals(response.status, 401);
  assertEquals(claimed, 0);
  assertEquals(dispatched, 0);
});

Deno.test("transport requires explicit lookup and location consent before admission", async () => {
  let claimed = 0;
  const withoutLookup = baseBody({ consent: {} });
  const first = await handleTransportVictoriaRequest(request(withoutLookup), {
    guard: () => Promise.resolve(auth(withoutLookup)),
    claim: (_admin, input) => {
      claimed += 1;
      return admittedClaim(input);
    },
  });
  assertEquals(first.status, 403);
  assertEquals(
    (await bodyOf(first)).error,
    {
      code: "TRANSPORT_CONSENT_REQUIRED",
      message: "Confirm the public transport lookup before sharing a query.",
      retryable: false,
    },
  );

  const withoutLocation = {
    action: "nearby",
    consent: { publicTransportLookup: true },
    request_id: "transport-request-location",
    latitude: -37.8136,
    longitude: 144.9631,
  };
  const second = await handleTransportVictoriaRequest(
    request(withoutLocation),
    {
      guard: () => Promise.resolve(auth(withoutLocation)),
      claim: (_admin, input) => {
        claimed += 1;
        return admittedClaim(input);
      },
    },
  );
  assertEquals(second.status, 403);
  assertEquals(claimed, 0);
});

Deno.test("transport minimizes precise coordinates before one admitted dispatch", async () => {
  const body = {
    action: "nearby",
    consent: { publicTransportLookup: true, preciseLocation: true },
    request_id: "transport-nearby-1",
    latitude: -37.813612,
    longitude: 144.963058,
    maxDistance: 1500,
    maxResults: 5,
  };
  const claims: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  const dispatches: Array<{
    path: string;
    query: Record<string, PtvQueryValue>;
  }> = [];
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    createDispatchToken: () => TOKEN,
    claim: (_admin, input) => {
      claims.push(input as unknown as Record<string, unknown>);
      return admittedClaim(input);
    },
    complete: (_admin, input) => {
      completions.push(input as unknown as Record<string, unknown>);
      return completed();
    },
    createPtvClient: () =>
      fakePtvClient((path, query) => {
        dispatches.push({ path, query });
        return Promise.resolve({ stops: [] });
      }),
  });

  assertEquals(response.status, 200);
  assertEquals(dispatches, [{
    path: "/v3/stops/location/-37.814,144.963",
    query: { route_types: undefined, max_distance: 1500, max_results: 5 },
  }]);
  assertEquals(claims.length, 1);
  assertEquals(claims[0].userId, USER_ID);
  assertEquals(claims[0].egressKind, "public-transport");
  assertEquals(claims[0].egressRoute, "ptv-nearby");
  assertEquals(claims[0].dispatchToken, TOKEN);
  assertMatch(String(claims[0].resourceSha256), /^[0-9a-f]{64}$/);
  assertEquals(completions[0].terminalState, "completed");
  const responseBody = await bodyOf(response);
  assertEquals(
    (responseBody.privacy as Record<string, unknown>).locationPrecision,
    PTV_LOCATION_PRECISION_POLICY,
  );
});

Deno.test("transport rejects excess action fields without admission", async () => {
  const body = baseBody({ documentBody: "private document text" });
  let claimed = 0;
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    claim: (_admin, input) => {
      claimed += 1;
      return admittedClaim(input);
    },
  });
  assertEquals(response.status, 400);
  assertEquals(
    ((await bodyOf(response)).error as Record<string, unknown>).code,
    "TRANSPORT_EXCESS_FIELDS",
  );
  assertEquals(claimed, 0);
});

Deno.test("transport preserves the safe missing-configuration contract before admission", async () => {
  const body = baseBody();
  let claimed = 0;
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    claim: (_admin, input) => {
      claimed += 1;
      return admittedClaim(input);
    },
    createPtvClient: () => {
      throw new PtvConfigurationError("secret detail");
    },
  });
  assertEquals(response.status, 503);
  assertEquals(claimed, 0);
  const responseBody = await bodyOf(response);
  assertEquals(
    (responseBody.error as Record<string, unknown>).code,
    "TRANSPORT_NOT_CONFIGURED",
  );
  assertEquals(JSON.stringify(responseBody).includes("secret detail"), false);
});

Deno.test("transport deletion fence and active replay block PTV dispatch", async () => {
  for (
    const fixture of [
      {
        claim: () =>
          Promise.resolve({
            data: null,
            error: { message: "ACCOUNT_DELETION_FENCED" },
          }),
        code: "ACCOUNT_DELETION_IN_PROGRESS",
      },
      {
        claim: (_admin: unknown, input: { dispatchToken: string }) =>
          Promise.resolve({
            data: {
              outcome: "processing",
              egress_permitted: false,
              dispatch_token: input.dispatchToken,
              retry_after_seconds: 2,
            },
            error: null,
          }),
        code: "EGRESS_ALREADY_PROCESSING",
      },
    ]
  ) {
    const body = baseBody();
    let dispatched = 0;
    const response = await handleTransportVictoriaRequest(request(body), {
      guard: () => Promise.resolve(auth(body)),
      createDispatchToken: () => TOKEN,
      claim: fixture.claim as TransportDependencies["claim"],
      createPtvClient: () =>
        fakePtvClient(() => {
          dispatched += 1;
          return Promise.resolve({});
        }),
    });
    assertEquals(response.status, 409);
    assertEquals(
      ((await bodyOf(response)).error as Record<string, unknown>).code,
      fixture.code,
    );
    assertEquals(dispatched, 0);
  }
});

Deno.test("transport cannot cross the deletion race while admission is unresolved", async () => {
  const body = baseBody();
  let dispatches = 0;
  let resolveClaim!: (value: {
    data: null;
    error: { message: string };
  }) => void;
  let markClaimStarted!: () => void;
  const claimStarted = new Promise<void>((resolve) => {
    markClaimStarted = resolve;
  });
  const responsePromise = handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    createDispatchToken: () => TOKEN,
    claim: () => {
      markClaimStarted();
      return new Promise((resolve) => {
        resolveClaim = resolve;
      });
    },
    createPtvClient: () =>
      fakePtvClient(() => {
        dispatches += 1;
        return Promise.resolve({});
      }),
  });
  await claimStarted;
  assertEquals(dispatches, 0);
  resolveClaim({ data: null, error: { message: "ACCOUNT_DELETION_FENCED" } });
  const response = await responsePromise;
  assertEquals(response.status, 409);
  assertEquals(dispatches, 0);
});

Deno.test("transport reuses one token for lost claim and completion acknowledgements", async () => {
  const body = baseBody();
  const claimTokens: string[] = [];
  const completionTokens: string[] = [];
  let claimAttempt = 0;
  let completionAttempt = 0;
  let dispatched = 0;
  let tokenCreations = 0;
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    createDispatchToken: () => {
      tokenCreations += 1;
      return TOKEN;
    },
    claim: (_admin, input) => {
      claimTokens.push(input.dispatchToken);
      claimAttempt += 1;
      return claimAttempt === 1
        ? Promise.reject(new Error("lost ack"))
        : Promise.resolve({
          data: {
            outcome: "idempotent_replay",
            egress_permitted: true,
            dispatch_token: input.dispatchToken,
          },
          error: null,
        });
    },
    complete: (_admin, input) => {
      completionTokens.push(input.dispatchToken);
      completionAttempt += 1;
      return completionAttempt === 1
        ? Promise.reject(new Error("lost ack"))
        : Promise.resolve({
          data: {
            outcome: "idempotent_replay",
            terminal_state: "completed",
          },
          error: null,
        });
    },
    createPtvClient: () =>
      fakePtvClient(() => {
        dispatched += 1;
        return Promise.resolve({ departures: [] });
      }),
  });
  assertEquals(response.status, 200);
  assertEquals(tokenCreations, 1);
  assertEquals(claimTokens, [TOKEN, TOKEN]);
  assertEquals(completionTokens, [TOKEN, TOKEN]);
  assertEquals(dispatched, 1);
});

Deno.test("transport rejects stale claim tokens and completed exact replays", async () => {
  for (
    const fixture of [
      {
        data: {
          outcome: "accepted",
          egress_permitted: true,
          dispatch_token: "30000000-0000-4000-8000-000000000001",
        },
        code: "EGRESS_ADMISSION_INVALID",
        status: 503,
      },
      {
        data: {
          outcome: "completed",
          egress_permitted: false,
          dispatch_token: TOKEN,
        },
        code: "EGRESS_ALREADY_COMPLETED",
        status: 409,
      },
    ]
  ) {
    const body = baseBody();
    let dispatched = 0;
    const response = await handleTransportVictoriaRequest(request(body), {
      guard: () => Promise.resolve(auth(body)),
      createDispatchToken: () => TOKEN,
      claim: () => Promise.resolve({ data: fixture.data, error: null }),
      createPtvClient: () =>
        fakePtvClient(() => {
          dispatched += 1;
          return Promise.resolve({});
        }),
    });
    assertEquals(response.status, fixture.status);
    assertEquals(
      ((await bodyOf(response)).error as Record<string, unknown>).code,
      fixture.code,
    );
    assertEquals(dispatched, 0);
  }
});

Deno.test("transport does not return fetched data when token-bound completion fails", async () => {
  const body = baseBody();
  let dispatches = 0;
  let completionAttempts = 0;
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    createDispatchToken: () => TOKEN,
    claim: (_admin, input) => admittedClaim(input),
    complete: () => {
      completionAttempts += 1;
      return Promise.resolve({
        data: null,
        error: { message: "USER_EXTERNAL_EGRESS_CONFLICT" },
      });
    },
    createPtvClient: () =>
      fakePtvClient(() => {
        dispatches += 1;
        return Promise.resolve({ private: "must not escape" });
      }),
  });
  assertEquals(response.status, 503);
  assertEquals(dispatches, 1);
  assertEquals(completionAttempts, 2);
  const responseBody = await bodyOf(response);
  assertEquals(
    (responseBody.error as Record<string, unknown>).code,
    "EGRESS_RECONCILIATION_REQUIRED",
  );
  assertEquals(JSON.stringify(responseBody).includes("must not escape"), false);
});

Deno.test("transport marks an ambiguous PTV dispatch for reconciliation", async () => {
  const body = baseBody();
  const terminalStates: string[] = [];
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    createDispatchToken: () => TOKEN,
    claim: (_admin, input) => admittedClaim(input),
    complete: (_admin, input) => {
      terminalStates.push(input.terminalState);
      return Promise.resolve({
        data: {
          outcome: "completed",
          terminal_state: input.terminalState,
        },
        error: null,
      });
    },
    createPtvClient: () =>
      fakePtvClient(() => Promise.reject(new Error("network outcome unknown"))),
  });
  assertEquals(response.status, 503);
  assertEquals(terminalStates, ["reconciliation_required"]);
  assertEquals(
    ((await bodyOf(response)).error as Record<string, unknown>).code,
    "EGRESS_RECONCILIATION_REQUIRED",
  );
});

Deno.test("transport completes a known terminal PTV response without leaking it", async () => {
  const body = baseBody();
  const terminalStates: string[] = [];
  const response = await handleTransportVictoriaRequest(request(body), {
    guard: () => Promise.resolve(auth(body)),
    createDispatchToken: () => TOKEN,
    claim: (_admin, input) => admittedClaim(input),
    complete: (_admin, input) => {
      terminalStates.push(input.terminalState);
      return Promise.resolve({
        data: {
          outcome: "completed",
          terminal_state: input.terminalState,
        },
        error: null,
      });
    },
    createPtvClient: () =>
      fakePtvClient(() =>
        Promise.reject(
          new PtvDispatchError("private upstream body", true),
        )
      ),
  });
  assertEquals(response.status, 503);
  assertEquals(terminalStates, ["completed"]);
  const responseBody = await bodyOf(response);
  assertEquals(
    (responseBody.error as Record<string, unknown>).code,
    "TRANSPORT_LOOKUP_UNAVAILABLE",
  );
  assertEquals(
    JSON.stringify(responseBody).includes("private upstream body"),
    false,
  );
});

Deno.test("transport canonical identity collides on exact replay and changes for a new request", async () => {
  const parsed = parseTransportRequest(baseBody());
  const first = await buildTransportDispatch(parsed, "transport-request-1");
  const exactReplay = await buildTransportDispatch(
    parsed,
    "transport-request-1",
  );
  const fresh = await buildTransportDispatch(parsed, "transport-request-2");
  assertEquals(
    first.resourceSha256,
    "3571987cda7943efb23d4883c89a89d43d7057a4de42208076f73cf1a1b46712",
  );
  assertEquals(first.resourceSha256, exactReplay.resourceSha256);
  assertNotEquals(first.resourceSha256, fresh.resourceSha256);
});
