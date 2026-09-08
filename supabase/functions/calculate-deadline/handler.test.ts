// deno-lint-ignore-file no-import-prefix -- Edge test imports use the repository's pinned lockfile.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleCalculateDeadlineRequest } from "./handler.ts";

const PROJECT = "https://deadline-synthetic.test";
const OWNER = "93000000-0000-4000-8000-000000000001";
const ROUTE = `${PROJECT}/functions/v1/calculate-deadline`;
const HOLIDAY = {
  date: "2026-03-09", name: "Synthetic national holiday", countryCode: "AU",
  nationalHoliday: true, subdivisionCodes: null, holidayTypes: ["Public"],
};

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function request(body: unknown = baseBody(), options: {
  signedIn?: boolean;
  signal?: AbortSignal;
  mime?: string;
  rawBody?: string;
  length?: number;
} = {}): Request {
  return new Request(ROUTE, {
    method: "POST",
    headers: {
      ...(options.signedIn === false ? {} : { authorization: "Bearer synthetic-user-token" }),
      "Content-Type": options.mime ?? "application/json",
      ...(options.length === undefined ? {} : { "Content-Length": String(options.length) }),
    },
    body: options.rawBody ?? JSON.stringify(body),
    signal: options.signal,
  });
}

function baseBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { startDate: "2026-03-06", businessDays: 2, request_id: "synthetic-deadline-1", ...extra };
}

interface Observations {
  calls: string[];
  rates: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  completions: Record<string, unknown>[];
  providerSignals: Array<AbortSignal | null | undefined>;
}

interface FixtureOptions {
  verified?: boolean;
  anonymous?: boolean;
  invalidToken?: boolean;
  rateAllowed?: boolean;
  rateUnavailable?: boolean;
  claimFailure?: "deletion" | "unavailable";
  failClaimAt?: number;
  claimOutcome?: "processing" | "completed" | "reconciliation_required";
  wrongClaimToken?: boolean;
  loseClaimAcks?: number;
  loseCompletionAcks?: number;
  malformedCompletion?: boolean;
  beforeClaimReply?: () => void;
  beforeCompletionReply?: () => void;
  provider?: typeof fetch;
}

// The actual handler, SDK auth.getUser, shared guard and holiday client run.
// Only the HTTP transport is controlled; no external services are contacted.
async function withTransport<T>(options: FixtureOptions, run: (observed: Observations) => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PROMPTED_DEPLOYMENT_ENV", "ALLOWED_ORIGINS"];
  const previous = names.map((name) => Deno.env.get(name));
  const values = [PROJECT, "synthetic-anon-key", "synthetic-service-key", "test", ""];
  names.forEach((name, index) => Deno.env.set(name, values[index]));
  const observed: Observations = { calls: [], rates: [], claims: [], completions: [], providerSignals: [] };
  const unexpected: string[] = [];
  const admittedTokens = new Set<unknown>();
  const completedResources = new Set<unknown>();
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://date.nager.at") {
      observed.calls.push("provider");
      observed.providerSignals.push(init?.signal);
      assertMatch(url.pathname, /^\/api\/v4\/Holidays\/[A-Z]{2}\/\d{4}$/);
      return options.provider ? options.provider(input, init) : Promise.resolve(Response.json([HOLIDAY]));
    }
    if (url.origin !== PROJECT) {
      unexpected.push(url.origin);
      return Promise.reject(new Error("Unexpected synthetic transport origin"));
    }
    if (url.pathname === "/auth/v1/user") {
      observed.calls.push("auth");
      return Promise.resolve(options.invalidToken
        ? Response.json({ code: "bad_jwt", message: "Synthetic invalid token" }, { status: 401 })
        : Response.json({
          id: OWNER, email: "synthetic-deadline@example.test", is_anonymous: options.anonymous === true,
          email_confirmed_at: options.verified === false ? null : "2026-09-01T00:00:00Z",
          identities: [{ provider: "email", user_id: OWNER }],
        }));
    }
    if (url.pathname === "/rest/v1/subscriptions") {
      observed.calls.push("subscriptions");
      return Promise.resolve(Response.json([]));
    }
    const payload = typeof init?.body === "string" ? record(JSON.parse(init.body)) : {};
    if (url.pathname === "/rest/v1/rpc/consume_rate_limit") {
      observed.calls.push("rate");
      observed.rates.push(payload);
      return Promise.resolve(options.rateUnavailable
        ? Response.json({ code: "P0001", message: "Synthetic private rate diagnostic" }, { status: 400 })
        : Response.json(options.rateAllowed !== false));
    }
    if (url.pathname === "/rest/v1/rpc/claim_user_external_egress") {
      observed.calls.push("claim");
      observed.claims.push(payload);
      options.beforeClaimReply?.();
      const claimFails = options.claimFailure !== undefined && observed.claims.length >= (options.failClaimAt ?? 1);
      const alreadyAdmitted = admittedTokens.has(payload.p_dispatch_token);
      if (!claimFails && options.claimOutcome === undefined) admittedTokens.add(payload.p_dispatch_token);
      if (claimFails || observed.claims.length <= (options.loseClaimAcks ?? 0)) {
        return Promise.resolve(Response.json({ code: "P0001", message: claimFails && options.claimFailure === "deletion" ? "ACCOUNT_DELETION_FENCED" : "Synthetic lost claim acknowledgement" }, { status: 400 }));
      }
      if (completedResources.has(payload.p_resource_sha256)) {
        return Promise.resolve(Response.json({ outcome: "completed", egress_permitted: false, dispatch_token: payload.p_dispatch_token }));
      }
      return Promise.resolve(Response.json({
        outcome: options.claimOutcome ?? (alreadyAdmitted ? "idempotent_replay" : "accepted"),
        egress_permitted: options.claimOutcome === undefined,
        dispatch_token: options.wrongClaimToken ? "93000000-0000-4000-8000-000000000099" : payload.p_dispatch_token,
        retry_after_seconds: 2,
      }));
    }
    if (url.pathname === "/rest/v1/rpc/complete_user_external_egress") {
      observed.calls.push("complete");
      observed.completions.push(payload);
      options.beforeCompletionReply?.();
      if (!options.malformedCompletion && payload.p_terminal_state === "completed") {
        completedResources.add(payload.p_resource_sha256);
      }
      if (observed.completions.length <= (options.loseCompletionAcks ?? 0)) {
        return Promise.resolve(Response.json({ code: "P0001", message: "Synthetic lost completion acknowledgement" }, { status: 400 }));
      }
      return Promise.resolve(Response.json({ outcome: "completed", terminal_state: options.malformedCompletion ? "wrong" : payload.p_terminal_state }));
    }
    unexpected.push(url.pathname);
    return Promise.reject(new Error("Unexpected synthetic transport path"));
  };
  try {
    return await run(observed);
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
    assertEquals(unexpected, [], "The fixture must not hide a missing transport handler");
  }
}

const expansionProvider: typeof fetch = (input) => {
  const year = new URL(input instanceof Request ? input.url : String(input)).pathname.split("/").at(-1);
  return Promise.resolve(Response.json(year === "2026" ? [{ ...HOLIDAY, date: "2026-12-31" }] : []));
};

Deno.test("deadline separately admits and settles each exact year reached by holiday expansion", async () => {
  await withTransport({ provider: expansionProvider }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ startDate: "2026-12-30", businessDays: 1 })));
    assertEquals(response.status, 200);
    const body = record(await response.json());
    assertEquals(record(body.data).deadline, "2027-01-01");
    assertEquals(observed.calls, ["auth", "rate", "subscriptions", "claim", "provider", "complete", "claim", "provider", "complete"]);
    assertEquals(observed.claims.length, 2);
    const [first, second] = observed.claims;
    assert(first && second);
    assertEquals(first.p_user_id, OWNER);
    assertEquals(second.p_user_id, OWNER);
    assert(first.p_resource_sha256 !== second.p_resource_sha256);
    assert(first.p_dispatch_token !== second.p_dispatch_token);
    assertEquals(observed.completions, [
      { ...first, p_terminal_state: "completed" }, { ...second, p_terminal_state: "completed" },
    ]);
  });
});

Deno.test("deadline honors an account-deletion fence before an expanded year is dispatched", async () => {
  await withTransport({ provider: expansionProvider, claimFailure: "deletion", failClaimAt: 2 }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ startDate: "2026-12-30", businessDays: 1 })));
    assertEquals(response.status, 409);
    assertEquals(await errorCode(response), "ACCOUNT_DELETION_IN_PROGRESS");
    assertEquals(observed.providerSignals.length, 1);
    assertEquals(observed.claims.length, 2);
    assertEquals(observed.completions.length, 1);
    const first = observed.claims[0];
    assert(first);
    assertEquals(observed.completions[0], { ...first, p_terminal_state: "completed" });
  });
});

Deno.test("deadline preserves uncertain year settlement alongside a known malformed sibling", async () => {
  await withTransport({ provider: (input) => {
    const year = new URL(input instanceof Request ? input.url : String(input)).pathname.split("/").at(-1);
    return year === "2026"
      ? Promise.resolve(Response.json([{ ...HOLIDAY, nationalHoliday: "false" }]))
      : Promise.reject(new TypeError("Synthetic second-year response lost"));
  } }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ startDate: "2026-12-31", businessDays: 1 })));
    assertEquals(response.status, 503);
    assertEquals(await errorCode(response), "EGRESS_RECONCILIATION_REQUIRED");
    assertEquals(observed.providerSignals.length, 2);
    assertEquals(observed.completions.length, 2);
    assertEquals(observed.completions.map((value) => value.p_terminal_state).sort(), ["completed", "reconciliation_required"]);
  });
});

Deno.test("deadline stops year expansion when cancellation arrives with the first completion receipt", async () => {
  const controller = new AbortController();
  await withTransport({ provider: expansionProvider, beforeCompletionReply: () => controller.abort() }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ startDate: "2026-12-30", businessDays: 1 }), { signal: controller.signal }));
    assertEquals(response.status === 200, false);
    assertEquals(observed.providerSignals.length, 1);
    assertEquals(observed.claims.length, 1);
    assertEquals(observed.completions.length, 1);
    const first = observed.claims[0];
    assert(first);
    assertEquals(observed.completions[0], { ...first, p_terminal_state: "completed" });
  });
});

Deno.test("deadline preserves completed year receipts when calendar expansion exceeds the supported terminal year", async () => {
  await withTransport({ provider: () => Promise.resolve(Response.json([29, 30, 31].map((day) => ({ ...HOLIDAY, date: `2200-12-${day}` })))) }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ startDate: "2200-12-28", businessDays: 1 })));
    assertEquals(response.status, 400);
    assertEquals(await errorCode(response), "DEADLINE_REQUEST_INVALID");
    assertEquals(observed.providerSignals.length, 1);
    assertEquals(observed.claims.length, 1);
    const claim = observed.claims[0];
    assert(claim);
    assertEquals(observed.completions, [{ ...claim, p_terminal_state: "completed" }]);
  });
});

Deno.test("deadline preserves twenty completed year receipts when the bounded calculation cannot find a working day", async () => {
  await withTransport({ provider: (input) => {
    const year = Number(new URL(input instanceof Request ? input.url : String(input)).pathname.split("/").at(-1));
    const cursor = new Date(`${year}-01-01T00:00:00Z`);
    const rows: Array<typeof HOLIDAY> = [];
    while (cursor.getUTCFullYear() === year) {
      rows.push({ ...HOLIDAY, date: cursor.toISOString().slice(0, 10) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return Promise.resolve(Response.json(rows));
  } }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ startDate: "2026-01-01", businessDays: 1 })));
    assertEquals(response.status, 400);
    assertEquals(await errorCode(response), "DEADLINE_REQUEST_INVALID");
    assertEquals(observed.providerSignals.length, 20);
    assertEquals(observed.claims.length, 20);
    assertEquals(observed.completions, observed.claims.map((claim) => ({ ...claim, p_terminal_state: "completed" })));
  });
});

Deno.test("deadline retains the shared body-only compatibility identity and does not redispatch its completed lookup", async () => {
  await withTransport({}, async (observed) => {
    const body = { startDate: "2026-03-06", businessDays: 2 };
    assertEquals((await handleCalculateDeadlineRequest(request(body))).status, 200);
    const replay = await handleCalculateDeadlineRequest(request(body));
    assertEquals(replay.status, 409);
    assertEquals(await errorCode(replay), "EGRESS_ALREADY_COMPLETED");
    assertEquals(observed.claims.length, 2);
    const [first, second] = observed.claims;
    assert(first && second);
    assertEquals(first.p_user_id, second.p_user_id);
    assertEquals(first.p_resource_sha256, second.p_resource_sha256);
    assert(first.p_dispatch_token !== second.p_dispatch_token);
    assertEquals(observed.providerSignals.length, 1);
    assertEquals(observed.completions.length, 1);
  });
});

async function errorCode(response: Response): Promise<string> {
  const body = record(await response.json());
  const error = record(body.error);
  assert(typeof error.code === "string");
  return error.code;
}

Deno.test("deadline retains its successful Australian response and private caching", async () => {
  await withTransport({}, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      data: { deadline: "2026-03-11", holidaysConsidered: [HOLIDAY], startDate: "2026-03-06", businessDays: 2, countryCode: "AU", subdivisionCode: null },
      source: "nager-date-v4",
    });
    assertEquals(observed.providerSignals.length, 1);
    assertMatch(response.headers.get("Cache-Control") ?? "", /private, no-store/);
  });
});

Deno.test("deadline verifies a confirmed owner and durable rate/egress admission before provider dispatch", async () => {
  await withTransport({}, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request());
    assertEquals(response.status, 200);
    assertEquals(observed.calls, ["auth", "rate", "subscriptions", "claim", "provider", "complete"]);
    assertEquals(observed.rates, [{ p_user_id: OWNER, p_operation: "calculate-deadline", p_limit: 60, p_window_seconds: 60 }]);
    assertEquals(observed.claims.length, 1);
    const claim = observed.claims[0];
    assert(claim);
    assertEquals(claim.p_user_id, OWNER);
    assert(typeof claim.p_resource_sha256 === "string");
    assertMatch(claim.p_resource_sha256, /^[0-9a-f]{64}$/);
    assert(typeof claim.p_dispatch_token === "string");
    assertMatch(claim.p_dispatch_token, /^[0-9a-f-]{36}$/);
    assertEquals(observed.completions, [{ ...claim, p_terminal_state: "completed" }]);
  });
});

for (const [label, options, expected] of [
  ["anonymous account", { anonymous: true }, "ANONYMOUS_USER"],
  ["unconfirmed account", { verified: false }, "UNVERIFIED_USER"],
  ["invalid account token", { invalidToken: true }, "INVALID_TOKEN"],
] satisfies Array<[string, FixtureOptions, string]>) {
  Deno.test("deadline rejects " + label + " before any provider or egress call", async () => {
    await withTransport(options, async (observed) => {
      const response = await handleCalculateDeadlineRequest(request());
      assertEquals(response.status, 401);
      assertEquals(await errorCode(response), expected);
      assertEquals(observed.claims.length, 0);
      assertEquals(observed.providerSignals.length, 0);
    });
  });
}

Deno.test("deadline rejects an unsigned request before parsing its body", async () => {
  await withTransport({}, async (observed) => {
    const req = request(baseBody(), { signedIn: false });
    const response = await handleCalculateDeadlineRequest(req);
    assertEquals(response.status, 401);
    assertEquals(await errorCode(response), "UNAUTHENTICATED");
    assertEquals(req.bodyUsed, false);
    assertEquals(observed.calls, []);
  });
});

Deno.test("deadline honors durable rate denial without consuming document allowance or dispatching", async () => {
  await withTransport({ rateAllowed: false }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request());
    assertEquals(response.status, 429);
    assertEquals(await errorCode(response), "RATE_LIMITED");
    assertEquals(observed.calls, ["auth", "rate"]);
  });
});

Deno.test("deadline fails closed when the durable rate check is unavailable", async () => {
  await withTransport({ rateUnavailable: true }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request());
    assertEquals(response.status >= 500, true);
    assertEquals(observed.providerSignals.length, 0);
    assert(!(await response.text()).includes("Synthetic private rate diagnostic"));
  });
});

for (const [label, extra] of [
  ["null country", { countryCode: null }],
  ["numeric country", { countryCode: 61 }],
  ["object country", { countryCode: { code: "AU" } }],
  ["null subdivision", { subdivisionCode: null }],
  ["numeric subdivision", { subdivisionCode: 3 }],
  ["array subdivision", { subdivisionCode: ["AU-VIC"] }],
  ["different-country subdivision", { subdivisionCode: "NZ-AUK" }],
  ["caller owner field", { user_id: "93000000-0000-4000-8000-000000000002" }],
] satisfies Array<[string, Record<string, unknown>]>) {
  Deno.test("deadline rejects " + label + " instead of silently changing jurisdiction", async () => {
    await withTransport({}, async (observed) => {
      const response = await handleCalculateDeadlineRequest(request(baseBody(extra)));
      assertEquals(response.status, 400);
      assertEquals(observed.claims.length, 0);
      assertEquals(observed.providerSignals.length, 0);
    });
  });
}

Deno.test("deadline preserves explicit Australian jurisdiction normalization", async () => {
  await withTransport({}, async () => {
    const response = await handleCalculateDeadlineRequest(request(baseBody({ countryCode: " au ", subdivisionCode: " au-vic " })));
    assertEquals(response.status, 200);
    const body = record(await response.json());
    assertEquals(record(body.data).countryCode, "AU");
    assertEquals(record(body.data).subdivisionCode, "AU-VIC");
  });
});

Deno.test("deadline rejects an oversized JSON envelope before its contents are read", async () => {
  await withTransport({}, async (observed) => {
    const req = request(baseBody(), { length: 1024 * 1024 + 1 });
    const response = await handleCalculateDeadlineRequest(req);
    assertEquals(response.status, 413);
    assertEquals(req.bodyUsed, false);
    assertEquals(observed.providerSignals.length, 0);
  });
});

Deno.test("deadline does not accept JSON disguised as text/plain", async () => {
  await withTransport({}, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody(), { mime: "text/plain" }));
    assertEquals(response.status, 400);
    assertEquals(observed.providerSignals.length, 0);
  });
});

Deno.test("deadline preserves malformed request and unsupported method rejection", async () => {
  await withTransport({}, async (observed) => {
    assertEquals((await handleCalculateDeadlineRequest(request({}, { rawBody: "{" }))).status, 400);
    assertEquals((await handleCalculateDeadlineRequest(new Request(ROUTE))).status, 405);
    assertEquals(observed.providerSignals.length, 0);
  });
});

for (const [label, options, status] of [
  ["account deletion fence", { claimFailure: "deletion" }, 409],
  ["unavailable admission", { claimFailure: "unavailable" }, 503],
  ["wrong dispatch token", { wrongClaimToken: true }, 503],
  ["in-flight replay", { claimOutcome: "processing" }, 409],
  ["completed replay", { claimOutcome: "completed" }, 409],
  ["uncertain replay", { claimOutcome: "reconciliation_required" }, 409],
] satisfies Array<[string, FixtureOptions, number]>) {
  Deno.test("deadline blocks " + label + " without dispatching the same lookup", async () => {
    await withTransport(options, async (observed) => {
      const response = await handleCalculateDeadlineRequest(request());
      assertEquals(response.status, status);
      assertEquals(observed.providerSignals.length, 0);
      assertEquals(observed.completions.length, 0);
    });
  });
}

Deno.test("deadline retries only the exact lost admission acknowledgement before one provider dispatch", async () => {
  await withTransport({ loseClaimAcks: 1 }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request());
    assertEquals(response.status, 200);
    assertEquals(observed.claims.length, 2);
    assertEquals(observed.claims[0], observed.claims[1]);
    assertEquals(observed.providerSignals.length, 1);
  });
});

Deno.test("deadline cancellation after an acknowledged claim completes that claim without dispatch", async () => {
  const controller = new AbortController();
  await withTransport({ beforeClaimReply: () => controller.abort() }, async (observed) => {
    const response = await handleCalculateDeadlineRequest(request(baseBody(), { signal: controller.signal }));
    assertEquals(response.status === 200, false);
    assertEquals(observed.providerSignals.length, 0);
    assertEquals(observed.completions.length, 1);
    const completion = observed.completions[0];
    assert(completion);
    assertEquals(completion.p_terminal_state, "completed");
  });
});

for (const [label, provider, terminal] of [
  ["known malformed response", () => Promise.resolve(Response.json([{ ...HOLIDAY, nationalHoliday: "false" }])), "completed"],
  ["uncertain transport failure", () => Promise.reject(new TypeError("Synthetic private provider diagnostic")), "reconciliation_required"],
] satisfies Array<[string, typeof fetch, string]>) {
  Deno.test("deadline reports " + label + " as an upstream failure with truthful egress settlement", async () => {
    await withTransport({ provider }, async (observed) => {
      const response = await handleCalculateDeadlineRequest(request());
      assertEquals(response.status, 503);
      assertEquals(observed.providerSignals.length, 1);
      assertEquals(observed.completions.length, 1);
      const completion = observed.completions[0];
      assert(completion);
      assertEquals(completion.p_terminal_state, terminal);
      assert(!(await response.text()).includes("Synthetic private provider diagnostic"));
    });
  });
}

for (const options of [{ loseCompletionAcks: 2 }, { malformedCompletion: true }] satisfies FixtureOptions[]) {
  Deno.test("deadline never publishes success without an exact completion acknowledgement " + JSON.stringify(options), async () => {
    await withTransport(options, async (observed) => {
      const response = await handleCalculateDeadlineRequest(request());
      assertEquals(response.status, 503);
      assertEquals(await errorCode(response), "EGRESS_RECONCILIATION_REQUIRED");
      assertEquals(observed.providerSignals.length, 1);
      assertEquals(observed.completions.length >= 1, true);
      if (observed.completions.length === 2) assertEquals(observed.completions[0], observed.completions[1]);
    });
  });
}
