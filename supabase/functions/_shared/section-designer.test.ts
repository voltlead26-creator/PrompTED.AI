// deno-lint-ignore-file no-import-prefix -- Edge test imports use the repository's pinned lockfile.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { bindModelCallContext } from "./model-call-context.ts";
import { OpenAIAdapterError } from "./provider-router.ts";
import { designBespokeTemplate } from "./section-designer.ts";
import { isProviderReconciliationRequired } from "./allowance-reservations.ts";

function validDesign() {
  return {
    name: "Synthetic equipment handover",
    domain: "business",
    structure_type: "compose",
    sections: ["Equipment identity", "Condition and evidence", "Next action"]
      .map(
        (label, index) => ({
          label,
          required: index !== 2,
          hint: "Describe the confirmed handover information.",
          vital: ["Confirmed equipment identifier", "Confirmed handover facts"],
          improver: ["Audience", "Tone", "Context", "Concise wording"],
        }),
      ),
  };
}

// Real designer, router, request contract and terminal accounting; only the
// external HTTP and database transports are controlled. No provider is called.
async function observeDesign(
  output: unknown,
  options: {
    networkFailure?: boolean;
    aborted?: boolean;
    egressUncertain?: boolean;
    abortWithEgressUncertainty?: boolean;
  } = {},
) {
  const oldFetch = globalThis.fetch;
  const names = ["OPENAI_API_KEY", "PROMPTED_DEPLOYMENT_ENV"];
  const previous = names.map((name) => Deno.env.get(name));
  const controller = new AbortController();
  const dispatches: string[] = [];
  const attempts: Array<Record<string, unknown>> = [];
  const capacityOutcomes: unknown[] = [];
  bindModelCallContext(controller.signal, {
    userId: "76000000-0000-4000-8000-000000000001",
    generationRequestId: "synthetic-bespoke-validation",
    admin: {
      rpc(name: string, args: Record<string, unknown>) {
        let data: Record<string, unknown>;
        switch (name) {
          case "claim_openai_capacity_lease":
            data = {
              outcome: "admitted",
              capacity_admitted: true,
              capacity_lease_id: crypto.randomUUID(),
              lease_token: args.p_lease_token,
              environment: args.p_environment,
              semantic_route: args.p_semantic_route,
              estimated_tokens: args.p_estimated_tokens,
              config_revision: 1,
              expires_at: "2099-01-01T00:00:00.000Z",
            };
            break;
          case "mark_openai_capacity_lease_dispatched":
            data = {
              outcome: "dispatched",
              capacity_lease_id: args.p_capacity_lease_id,
              dispatched_at: "2026-09-08T00:00:00.000Z",
            };
            break;
          case "release_openai_capacity_lease":
            capacityOutcomes.push(args.p_terminal_outcome);
            data = {
              outcome: "released",
              capacity_lease_id: args.p_capacity_lease_id,
              terminal_outcome: args.p_terminal_outcome,
            };
            break;
          case "claim_user_external_egress":
            if (options.abortWithEgressUncertainty) controller.abort();
            data = options.egressUncertain
              ? {
                outcome: "reconciliation_required",
                egress_permitted: false,
              }
              : {
                outcome: "accepted",
                egress_permitted: true,
                dispatch_token: args.p_dispatch_token,
              };
            break;
          case "complete_user_external_egress":
            data = { outcome: "completed" };
            break;
          case "record_legacy_model_call_attempt":
            attempts.push(args);
            data = {
              usage_ledger_id: "76000000-0000-4000-8000-000000000002",
              model_call_key: createHash("sha256").update(
                `${args.p_logical_stage_key}|${args.p_request_sha256}|${args.p_provider_attempt_id}`,
              ).digest("hex"),
              idempotent_replay: false,
              result_id: null,
              result_response_sha256: null,
              result_idempotent_replay: null,
            };
            break;
          default:
            throw new Error("Unexpected synthetic RPC: " + name);
        }
        return Promise.resolve({ data, error: null });
      },
    } as unknown as SupabaseClient,
  });
  globalThis.fetch = ((url, init) => {
    assertEquals(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    assertEquals(body.store, false);
    assertEquals(body.text.format.name, "prompted_bespoke_section_design");
    dispatches.push(String(url));
    if (options.networkFailure) {
      return Promise.reject(new TypeError("Synthetic lost response"));
    }
    return Promise.resolve(
      Response.json({
        id: "resp_synthetic_bespoke",
        status: "completed",
        output_text: JSON.stringify(output),
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    );
  }) as typeof fetch;
  Deno.env.set(names[0], "synthetic-designer-key");
  Deno.env.set(names[1], "test");
  if (options.aborted) controller.abort();
  try {
    let result: Awaited<ReturnType<typeof designBespokeTemplate>> = null;
    let failure: unknown;
    try {
      result = await designBespokeTemplate({
        documentName: "Equipment handover",
        situation: "The owner wants a handover record using confirmed facts.",
        systemPrompt: "Use only the supplied confirmed information.",
        signal: controller.signal,
      });
    } catch (error) {
      failure = error;
    }
    if (options.aborted) {
      assertEquals(
        dispatches.length,
        0,
        "Already cancelled work cannot dispatch HTTP",
      );
      if (failure) throw failure;
      return result;
    }
    assertEquals(
      dispatches.length,
      options.egressUncertain ? 0 : 1,
      "Uncertain dispatch permission cannot initiate provider HTTP",
    );
    assertEquals(
      attempts.length,
      1,
      "The actual router must acknowledge one terminal stage",
    );
    assertEquals(
      attempts[0].p_attempt_status,
      options.networkFailure || options.egressUncertain
        ? "unknown"
        : "succeeded",
    );
    assertEquals(
      attempts[0].p_provider_status,
      options.networkFailure || options.egressUncertain
        ? "ambiguous"
        : "completed",
    );
    assertEquals(attempts[0].p_logical_stage_key, "generate-document.design");
    assertEquals(capacityOutcomes, [
      options.networkFailure || options.egressUncertain
        ? "reconciliation_required"
        : "completed",
    ]);
    if (options.egressUncertain) {
      assert(failure instanceof OpenAIAdapterError);
      assertEquals(failure.code, "OPENAI_PROVIDER_RECONCILIATION_REQUIRED");
      return result;
    }
    if (failure) throw failure;
    return result;
  } finally {
    globalThis.fetch = oldFetch;
    names.forEach((name, index) =>
      previous[index] === undefined
        ? Deno.env.delete(name)
        : Deno.env.set(name, previous[index]!)
    );
  }
}

Deno.test("bespoke design preserves a valid exact server structure and optional section", async () => {
  const result = await observeDesign(validDesign());
  assert(result);
  assertEquals(result.sections.map(({ key }) => key), [
    "equipment_identity",
    "condition_and_evidence",
    "next_action",
  ]);
  assertEquals(result.sections.map(({ required }) => required), [
    true,
    true,
    false,
  ]);
  assertEquals(
    result.sections.map(({ vital }) => vital),
    validDesign().sections.map(({ vital }) => vital),
  );
});

const invalidDesigns: Array<
  [string, (value: ReturnType<typeof validDesign>) => unknown]
> = [
  ["duplicate derived section identity", (value) => {
    value.sections[1].label = "Equipment: identity";
    return value;
  }],
  ["derived section key exceeding the browser contract", (value) => {
    value.sections[0].label = "a".repeat(81);
    return value;
  }],
  [
    "excess sections that would be silently discarded",
    (value) => ({
      ...value,
      sections: Array.from(
        { length: 10 },
        (_, index) => ({ ...value.sections[0], label: "Section " + index }),
      ),
    }),
  ],
  [
    "malformed section that would be silently discarded",
    (value) => ({ ...value, sections: [...value.sections, null] }),
  ],
  [
    "non-boolean required flag",
    (value) => ({
      ...value,
      sections: value.sections.map((section) => ({
        ...section,
        required: "false",
      })),
    }),
  ],
  ["missing required vital facts", (value) => {
    value.sections[0].vital = [];
    return value;
  }],
  [
    "mixed criteria that would be filtered",
    (value) => ({
      ...value,
      sections: value.sections.map((section) => ({
        ...section,
        vital: ["Identifier", 42, "Date"],
      })),
    }),
  ],
  ["oversized fact that would be truncated", (value) => {
    value.sections[0].vital[0] = "x".repeat(201);
    return value;
  }],
  [
    "unknown domain that would downgrade to general",
    (value) => ({ ...value, domain: "unsupported-domain" }),
  ],
  [
    "unknown structure that would downgrade to compose",
    (value) => ({ ...value, structure_type: "unknown" }),
  ],
  [
    "whitespace name that would be replaced",
    (value) => ({ ...value, name: "   " }),
  ],
  ["hidden provider policy", (value) => ({ ...value, adviceBoundary: "none" })],
];
for (const [reason, mutate] of invalidDesigns) {
  Deno.test("bespoke design rejects " + reason, async () => {
    assertEquals(await observeDesign(mutate(validDesign())), null);
  });
}

Deno.test("bespoke design preserves provider uncertainty for durable caller reconciliation", async () => {
  const error = await assertRejects(
    () => observeDesign(validDesign(), { networkFailure: true }),
    OpenAIAdapterError,
  );
  assertEquals(error.code, "OPENAI_PROVIDER_RECONCILIATION_REQUIRED");
});

Deno.test("bespoke design preserves pre-dispatch cancellation instead of a null design", async () => {
  const error = await assertRejects(
    () => observeDesign(validDesign(), { aborted: true }),
    DOMException,
  );
  assertEquals(error.name, "AbortError");
});

Deno.test("uncertain dispatch permission remains an unknown durable attempt with no provider HTTP", async () => {
  assertEquals(
    await observeDesign(validDesign(), { egressUncertain: true }),
    null,
  );
});

Deno.test("cancellation cannot relabel unresolved dispatch permission as a safe cancelled attempt", async () => {
  assertEquals(
    await observeDesign(validDesign(), {
      egressUncertain: true,
      abortWithEgressUncertainty: true,
    }),
    null,
  );
});

for (
  const code of [
    "OPENAI_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED",
    "OPENAI_CAPACITY_ADMISSION_RECONCILIATION_REQUIRED",
    "OPENAI_CAPACITY_RELEASE_RECONCILIATION_REQUIRED",
    "OLLAMA_PROVIDER_RECONCILIATION_REQUIRED",
  ]
) {
  Deno.test("allowance recovery recognises the router's exact " + code, () => {
    assertEquals(
      isProviderReconciliationRequired(
        new OpenAIAdapterError(code, 503, false),
      ),
      true,
    );
  });
}

Deno.test("allowance recovery does not trust arbitrary reconciliation-like strings", () => {
  for (
    const code of [
      "RECONCILIATION_REQUIRED",
      "UNTRUSTED_RECONCILIATION_REQUIRED",
      "OPENAI_AWAITING_CAPACITY",
      "OPENAI_CANCELLED",
    ]
  ) {
    assertEquals(isProviderReconciliationRequired({ code }), false);
  }
});
