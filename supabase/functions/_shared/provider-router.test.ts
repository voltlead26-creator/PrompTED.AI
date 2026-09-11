// Edge tests retain the repository's existing lockfile-pinned JSR imports.
// deno-lint-ignore no-import-prefix
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  buildOpenAIRequestBody,
  isRetryableProviderStatus,
  OpenAIAdapterError,
  resolveOpenAIRoute,
  routeRequest as routeRequestImpl,
} from "./provider-router.ts";
import {
  bindModelCallContext as bindModelCallContextImpl,
  setModelCallCheckpointContext,
} from "./model-call-context.ts";
// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { ProviderRequest } from "./provider-router.ts";
import { isProviderReconciliationRequired } from "./allowance-reservations.ts";
import {
  legacyAuditSourceSha256,
  legacyAuditTargetSha256,
  legacyAuditTextSha256,
} from "./document-audit-binding.ts";
import { qualityAuditOutputSchema } from "./document-output-contracts.ts";

// These fixtures model the existing SQL write/read contracts. The receipt
// field is read reflectively until the tests-first production type is added.
const AUDIT_OWNER = "22222222-2222-4222-8222-222222222222";
const AUDIT_ORIGIN = "33333333-3333-4333-8333-333333333333";
const AUDIT_USAGE = "44444444-4444-4444-8444-444444444444";
const AUDIT_ADMISSION = "55555555-5555-4555-8555-555555555555";
const AUDIT_CLAIM = "66666666-6666-4666-8666-666666666666";
const AUDIT_RESULT_SHA = "c".repeat(64);
const AUDIT_BINDING_SHA = "d".repeat(64);

async function documentAuditFixtureInput() {
  const sources: [string, string, string, string, string] = ["I was charged $10 twice.", "", "", "", ""];
  const sections = [{ key: "opening", label: "Opening", content: sources[0] }];
  const contentSha256 = await legacyAuditTextSha256(sections[0].content);
  const binding = {
    version: "legacy-document-audit-binding.1" as const,
    digest_version: "legacy-document-audit-digests.1" as const,
    validator_version: "legacy-wording-assessment.1" as const,
    unit_policy_version: "legacy-factual-units.2" as const,
    review_kind: "quality" as const, round: 0,
    output_schema_name: "prompted_document_quality_audit" as const,
    output_schema_version: "document-quality-audit.1" as const,
    evidence_mode: "verbatim" as const,
    source_sha256: await legacyAuditSourceSha256(sources),
    execution_policy_version: "legacy-template-policy.1" as const,
    execution_policy_sha256: "b".repeat(64),
    target_sha256: await legacyAuditTargetSha256(sections),
    sections: [{ key: "opening", label: "Opening", content_sha256: contentSha256 }],
    units: [{ id: "opening#1", section_key: "opening", content_sha256: contentSha256 }],
  };
  return { binding, sources };
}

async function auditFixtureSha(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function validAccountingReceipt(
  args: Record<string, unknown>,
  error: unknown = null,
): Promise<{ data: Record<string, unknown>; error: unknown }> {
  const modelCallKey = await auditFixtureSha(
    String(args.p_logical_stage_key) + "|" + String(args.p_request_sha256) + "|" +
      String(args.p_provider_attempt_id),
  );
  return { data: {
    usage_ledger_id: "11111111-1111-4111-8111-111111111111",
    model_call_key: modelCallKey, idempotent_replay: false,
    result_id: args.p_result_envelope ? "33333333-3333-4333-8333-333333333333" : null,
    result_response_sha256: args.p_result_envelope ? "c".repeat(64) : null,
    result_idempotent_replay: args.p_result_envelope ? false : null,
  }, error };
}

function auditReceiptFixture(options: {
  checkpoint?: boolean;
  text?: string;
  documentAudit?: Awaited<ReturnType<typeof documentAuditFixtureInput>>;
  historicalProbe?: boolean;
} = {}) {
  const controller = new AbortController();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const providerBodies: Record<string, unknown>[] = [];
  const providerBodyTexts: string[] = [];
  let checkpoint: Record<string, unknown> | undefined;
  let readMode: "normal" | "after-capacity" = "normal";
  let loseWriteAcks = false;
  let loseEgressAcks = false;
  let beforeRead: ((args: Record<string, unknown>) => void) | undefined;
  let beforeWrite: (() => void) | undefined;
  let beforeRelease: (() => void) | undefined;
  let retainedWrite: Record<string, unknown> | undefined;
  const storedBinding = options.documentAudit ? structuredClone(options.documentAudit.binding) : undefined;
  let mapAuditWrapper: ((value: Record<string, unknown>) => void) | undefined;
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args: structuredClone(args) });
      if (name === "claim_openai_capacity_lease") {
        return { data: {
          capacity_admitted: true, outcome: "admitted",
          capacity_lease_id: "77777777-7777-4777-8777-777777777777",
          lease_token: args.p_lease_token, environment: "test",
          semantic_route: args.p_semantic_route, estimated_tokens: args.p_estimated_tokens,
          config_revision: 1, expires_at: "2099-01-01T00:00:00.000Z",
        }, error: null };
      }
      if (name === "mark_openai_capacity_lease_dispatched") {
        return { data: { outcome: "dispatched", capacity_lease_id: args.p_capacity_lease_id,
          dispatched_at: "2026-09-01T00:00:00.000Z" }, error: null };
      }
      if (name === "release_openai_capacity_lease") {
        beforeRelease?.();
        return { data: { outcome: "released", capacity_lease_id: args.p_capacity_lease_id,
          terminal_outcome: args.p_terminal_outcome }, error: null };
      }
      if (name === "claim_user_external_egress") {
        return { data: { outcome: "accepted", egress_permitted: true,
          dispatch_token: args.p_dispatch_token }, error: null };
      }
      if (name === "complete_user_external_egress") {
        return loseEgressAcks
          ? { data: null, error: new TypeError("synthetic lost egress ACK") }
          : { data: { outcome: "completed", terminal_state: args.p_terminal_state }, error: null };
      }
      if (name === "read_legacy_model_call_checkpoint" || name === "read_legacy_document_audit_checkpoint_v1") {
        beforeRead?.(args);
        const state = checkpoint && (readMode === "normal" || args.p_allocate_attempt === true)
          ? structuredClone(checkpoint)
          : args.p_allocate_attempt === false && !options.historicalProbe
            ? { state: "not_found", provider_permitted: false }
            : { state: "prepared", provider_permitted: true, attempt_number: 1,
              attempt_admission_id: AUDIT_ADMISSION, execution_claim_token: AUDIT_CLAIM };
        if (name === "read_legacy_model_call_checkpoint") return { data: state, error: null };
        assert(storedBinding, "Only explicitly bound fixtures may call the audit wrapper.");
        const wrapper: Record<string, unknown> = {
          contract_version: "legacy-document-audit-checkpoint.1",
          checkpoint: state,
          audit_binding: state.state === "not_found" || (options.historicalProbe && args.p_allocate_attempt === false)
            ? null : structuredClone(storedBinding),
          audit_binding_sha256: state.state === "not_found" || (options.historicalProbe && args.p_allocate_attempt === false)
            ? null : AUDIT_BINDING_SHA,
        };
        mapAuditWrapper?.(wrapper);
        return { data: wrapper, error: null };
      }
      if (name === "mark_legacy_model_attempt_dispatched") {
        return { data: { state: "dispatched", attempt_admission_id: AUDIT_ADMISSION,
          provider_attempt_id: AUDIT_ADMISSION }, error: null };
      }
      if (name !== "record_legacy_model_call_attempt") {
        throw new Error("Unexpected receipt fixture RPC: " + name);
      }
      beforeWrite?.();
      retainedWrite = structuredClone(args);
      const modelCallKey = await auditFixtureSha(
        String(args.p_logical_stage_key) + "|" + String(args.p_request_sha256) + "|" +
          String(args.p_provider_attempt_id),
      );
      if (args.p_result_envelope) {
        checkpoint = {
          state: "replay", provider_permitted: false, attempt_number: args.p_attempt_number,
          result_version: "legacy-provider-result.1", response_sha256: AUDIT_RESULT_SHA,
          response_envelope: args.p_result_envelope,
          usage: {
            usage_ledger_id: AUDIT_USAGE,
            provider_attempt_id: args.p_provider_attempt_id,
            provider_response_id: args.p_provider_response_id,
            provider_status: args.p_provider_status, attempt_status: args.p_attempt_status,
            error_code: args.p_error_code, input_tokens: args.p_input_tokens,
            output_tokens: args.p_output_tokens, started_at: args.p_started_at,
            completed_at: args.p_completed_at, model: args.p_model,
            routing_version: args.p_routing_version, semantic_route: args.p_semantic_route,
            reasoning_effort: args.p_reasoning_effort,
          },
        };
      }
      return loseWriteAcks
        ? { data: null, error: new TypeError("synthetic lost terminal ACK") }
        : { data: {
          usage_ledger_id: AUDIT_USAGE, model_call_key: modelCallKey,
          idempotent_replay: calls.filter((call) => call.name === name).length > 1,
          result_id: args.p_result_envelope ? "88888888-8888-4888-8888-888888888888" : null,
          result_response_sha256: args.p_result_envelope ? AUDIT_RESULT_SHA : null,
          result_idempotent_replay: args.p_result_envelope
            ? calls.filter((call) => call.name === name).length > 1 : null,
        }, error: null };
    },
  } as unknown as SupabaseClient;
  const bind = (logicalRequestId = "audit-receipt-request") => bindModelCallContextImpl(
    controller.signal,
    { userId: AUDIT_OWNER, admin, generationRequestId: logicalRequestId,
      ...(options.checkpoint === false ? {} : { checkpoint: {
        scope: "generate-document", originReservationId: AUDIT_ORIGIN,
        executionClaimToken: AUDIT_CLAIM,
      } }) },
  );
  bind();
  const request = {
    task: "review", logicalStageKey: "generate-document.audit:wording",
    systemPrompt: "Review only these synthetic supported facts.",
    messages: [{ role: "user" as const, content: "Synthetic wording for receipt tests." }],
    requireJson: true, requireLegacyCheckpointReceipt: true, signal: controller.signal,
    ...(options.documentAudit ? {
      task: "edit", logicalStageKey: "generate-document.quality:round-0",
      outputSchema: qualityAuditOutputSchema(["opening"]),
      legacyAuditBinding: options.documentAudit.binding,
      legacyAuditSources: options.documentAudit.sources,
    } : {}),
  };
  const transport: typeof fetch = (_input, init) => {
    const bodyText = String(init?.body);
    providerBodyTexts.push(bodyText);
    providerBodies.push(JSON.parse(bodyText));
    return Promise.resolve(Response.json({
      id: "resp_audit_receipt", status: "completed",
      output_text: options.text ?? (options.documentAudit ? '{"decision":"approve","issues":[]}' : '{"decision":"approve"}'),
      usage: { input_tokens: 7, output_tokens: 4 },
    }));
  };
  return {
    controller, calls, providerBodies, providerBodyTexts, request, transport, bind,
    invoke: (input: ProviderRequest = request) => routeRequestImpl(input),
    get retainedWrite() { return retainedWrite; },
    get checkpoint() { return checkpoint; },
    set readMode(value: "normal" | "after-capacity") { readMode = value; },
    set loseWriteAcks(value: boolean) { loseWriteAcks = value; },
    set loseEgressAcks(value: boolean) { loseEgressAcks = value; },
    set beforeRead(value: ((args: Record<string, unknown>) => void) | undefined) { beforeRead = value; },
    set beforeWrite(value: (() => void) | undefined) { beforeWrite = value; },
    set beforeRelease(value: (() => void) | undefined) { beforeRelease = value; },
    set mapAuditWrapper(value: ((wrapper: Record<string, unknown>) => void) | undefined) { mapAuditWrapper = value; },
  };
}

async function withAuditReceiptFixture(
  fixture: ReturnType<typeof auditReceiptFixture>,
  run: () => Promise<void>,
): Promise<void> {
  await withEnvironment({ OPENAI_API_KEY: "synthetic-receipt-key" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fixture.transport;
    try { await run(); } finally { globalThis.fetch = originalFetch; }
  });
}

function auditReceipt(response: Awaited<ReturnType<typeof routeRequestImpl>>): Record<string, unknown> {
  const receipt: unknown = Reflect.get(response, "legacyCheckpointReceipt");
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt),
    "Opted-in success must carry a validated durable legacy checkpoint receipt.");
  return receipt as Record<string, unknown>;
}

for (const lostAcknowledgements of [false, true]) {
  Deno.test("document audit binding is retained by fresh/readback and replay with lost ACK=" + lostAcknowledgements, async () => {
    const accepted = await documentAuditFixtureInput();
    const fixture = auditReceiptFixture({ documentAudit: accepted, text: '{"decision":"approve","issues":[]}' });
    fixture.loseWriteAcks = lostAcknowledgements;
    await withAuditReceiptFixture(fixture, async () => {
      const first = await fixture.invoke();
      const second = await fixture.invoke();
      assertEquals(first.structured, { decision: "approve", issues: [] });
      assertEquals(second.structured, first.structured);
      assertEquals(auditReceipt(first).legacyAuditBindingSha256, AUDIT_BINDING_SHA);
      assertEquals(auditReceipt(second), auditReceipt(first));
      assertEquals(auditReceipt(first).providerAttemptId, AUDIT_ADMISSION);
      assertEquals(fixture.providerBodies.length, 1);
      const reads = fixture.calls.filter((call) => call.name.startsWith("read_legacy_"));
      assertEquals(reads.map((call) => call.name),
        Array.from({ length: lostAcknowledgements ? 4 : 3 }, () => "read_legacy_document_audit_checkpoint_v1"));
      for (const call of reads) {
        assertEquals(Object.keys(call.args).sort(), [
          "p_allocate_attempt", "p_audit_binding", "p_checkpoint_scope", "p_execution_claim_token",
          "p_logical_request_id", "p_logical_stage_key", "p_max_attempts", "p_origin_reservation_id",
          "p_request_sha256", "p_source_snapshot", "p_user_id", "p_with_fallback",
        ].sort());
        assertEquals(call.args.p_audit_binding, accepted.binding);
        assertEquals(call.args.p_source_snapshot, accepted.sources);
        assertEquals(call.args.p_with_fallback, false);
      }
      assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length,
        lostAcknowledgements ? 2 : 1);
      assertEquals(fixture.retainedWrite?.p_request_sha256,
        await auditFixtureSha(fixture.providerBodyTexts[0]),
        "Audit metadata must not change the existing provider request hash.");
      assertEquals(Object.hasOwn(fixture.providerBodies[0], "legacyAuditBinding"), false);
      assertEquals(Object.hasOwn(fixture.providerBodies[0], "legacyAuditSources"), false);
      assertEquals(Object.hasOwn(fixture.retainedWrite ?? {}, "p_audit_binding"), false);
    });
  });
}

for (const invalid of ["missing-binding", "missing-sources", "missing-receipt-opt-in", "wrong-schema", "wrong-stage", "changed-source"] as const) {
  Deno.test("document audit rejects " + invalid + " before checkpoint, capacity or provider work", async () => {
    const fixture = auditReceiptFixture({ documentAudit: await documentAuditFixtureInput() });
    const request = { ...fixture.request };
    if (invalid === "missing-binding") Reflect.deleteProperty(request, "legacyAuditBinding");
    if (invalid === "missing-sources") Reflect.deleteProperty(request, "legacyAuditSources");
    if (invalid === "missing-receipt-opt-in") request.requireLegacyCheckpointReceipt = false;
    if (invalid === "wrong-schema") Reflect.set(request, "outputSchema", strictSchema);
    if (invalid === "wrong-stage") request.logicalStageKey = "generate-document.quality:round-1";
    if (invalid === "changed-source") Reflect.set(request, "legacyAuditSources", ["Different facts.", "", "", "", ""]);
    await withAuditReceiptFixture(fixture, async () => {
      await assertRejects(() => fixture.invoke(request), OpenAIAdapterError, "OPENAI_AUDIT_BINDING_INVALID");
      assertEquals(fixture.calls, []);
      assertEquals(fixture.providerBodies, []);
    });
  });
}

Deno.test("document audit owns metadata and all five sources before a held checkpoint read", async () => {
  const mutable = await documentAuditFixtureInput();
  const accepted = structuredClone(mutable);
  const fixture = auditReceiptFixture({ documentAudit: mutable });
  fixture.beforeRead = () => {
    mutable.sources[0] = "Later caller facts.";
    mutable.binding.source_sha256 = "e".repeat(64);
    mutable.binding.sections[0].content_sha256 = "f".repeat(64);
    mutable.binding.units[0].content_sha256 = "a".repeat(64);
  };
  await withAuditReceiptFixture(fixture, async () => {
    const result = await fixture.invoke();
    const reads = fixture.calls.filter((call) => call.name.startsWith("read_legacy_"));
    assertEquals(reads.length, 2);
    for (const call of reads) {
      assertEquals(call.args.p_audit_binding, accepted.binding);
      assertEquals(call.args.p_source_snapshot, accepted.sources);
    }
    assertEquals(auditReceipt(result).legacyAuditBindingSha256, AUDIT_BINDING_SHA);
    assertEquals(fixture.providerBodies.length, 1);
  });
});

for (const malformed of ["missing-prepared-binding", "invalid-digest", "extra-wrapper-key"] as const) {
  Deno.test("document audit rejects " + malformed + " without provider dispatch", async () => {
    const fixture = auditReceiptFixture({ documentAudit: await documentAuditFixtureInput() });
    fixture.mapAuditWrapper = (wrapper) => {
      const checkpoint = wrapper.checkpoint as Record<string, unknown>;
      if (checkpoint.state !== "prepared") return;
      if (malformed === "missing-prepared-binding") {
        wrapper.audit_binding = null;
        wrapper.audit_binding_sha256 = null;
      } else if (malformed === "invalid-digest") wrapper.audit_binding_sha256 = "invalid";
      else wrapper.unreviewed = true;
    };
    await withAuditReceiptFixture(fixture, async () => {
      await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_AUDIT_CHECKPOINT_MALFORMED");
      assertEquals(fixture.providerBodies, []);
      assertEquals(fixture.calls.filter((call) => call.name === "mark_legacy_model_attempt_dispatched").length, 0);
      assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length, 0);
    });
  });
}

for (const afterCapacity of [false, true]) {
  Deno.test("document audit rejects stored binding mismatch on replay after capacity=" + afterCapacity, async () => {
    const fixture = auditReceiptFixture({ documentAudit: await documentAuditFixtureInput() });
    await withAuditReceiptFixture(fixture, async () => {
      assertEquals((await fixture.invoke()).structured, { decision: "approve", issues: [] });
      fixture.calls.length = 0;
      fixture.readMode = afterCapacity ? "after-capacity" : "normal";
      fixture.mapAuditWrapper = (wrapper) => {
        if ((wrapper.checkpoint as Record<string, unknown>).state !== "replay") return;
        const binding = structuredClone(wrapper.audit_binding) as Record<string, unknown>;
        binding.execution_policy_sha256 = "e".repeat(64);
        wrapper.audit_binding = binding;
      };
      await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_AUDIT_CHECKPOINT_CONFLICT");
      assertEquals(fixture.providerBodies.length, 1);
      assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length, 0);
      assertEquals(fixture.calls.filter((call) => call.name === "release_openai_capacity_lease").length,
        afterCapacity ? 1 : 0);
    });
  });
}

Deno.test("document audit missing replay binding cannot qualify an old literal checkpoint", async () => {
  const fixture = auditReceiptFixture({ documentAudit: await documentAuditFixtureInput() });
  await withAuditReceiptFixture(fixture, async () => {
    assertEquals((await fixture.invoke()).structured, { decision: "approve", issues: [] });
    fixture.mapAuditWrapper = (wrapper) => {
      if ((wrapper.checkpoint as Record<string, unknown>).state === "replay") {
        wrapper.audit_binding = null;
        wrapper.audit_binding_sha256 = null;
      }
    };
    await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_AUDIT_CHECKPOINT_MALFORMED");
    assertEquals(fixture.providerBodies.length, 1);
  });
});

Deno.test("document audit binding does not turn malformed completed output into successful evidence", async () => {
  const fixture = auditReceiptFixture({ documentAudit: await documentAuditFixtureInput(), text: "{incomplete" });
  await withAuditReceiptFixture(fixture, async () => {
    await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_INVALID_STRUCTURED_OUTPUT");
    assertEquals(fixture.retainedWrite?.p_provider_status, "completed");
    assertEquals(fixture.retainedWrite?.p_attempt_status, "failed");
    assertEquals(fixture.retainedWrite?.p_error_code, "OPENAI_INVALID_STRUCTURED_OUTPUT");
    assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length, 1);
    assertEquals(fixture.providerBodies.length, 1);
  });
});

for (const mismatch of [false, true]) {
  Deno.test("undispatched historical audit probe requires bound allocation before dispatch with mismatch=" + mismatch, async () => {
    const fixture = auditReceiptFixture({ documentAudit: await documentAuditFixtureInput(), historicalProbe: true });
    if (mismatch) fixture.mapAuditWrapper = (wrapper) => {
      if (wrapper.audit_binding) {
        const binding = structuredClone(wrapper.audit_binding) as Record<string, unknown>;
        binding.target_sha256 = "e".repeat(64);
        wrapper.audit_binding = binding;
      }
    };
    await withAuditReceiptFixture(fixture, async () => {
      if (mismatch) {
        await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_AUDIT_CHECKPOINT_CONFLICT");
        assertEquals(fixture.providerBodies, []);
        assertEquals(fixture.calls.filter((call) => call.name === "mark_legacy_model_attempt_dispatched").length, 0);
      } else {
        const result = await fixture.invoke();
        assertEquals(result.structured, { decision: "approve", issues: [] });
        assertEquals(auditReceipt(result).legacyAuditBindingSha256, AUDIT_BINDING_SHA);
        assertEquals(fixture.providerBodies.length, 1);
      }
      const reads = fixture.calls.filter((call) => call.name === "read_legacy_document_audit_checkpoint_v1");
      assertEquals(reads.map((call) => call.args.p_allocate_attempt), [false, true]);
    });
  });
}

Deno.test("audit receipt opt-in rejects usage-only context before capacity or provider work", async () => {
  const fixture = auditReceiptFixture({ checkpoint: false });
  await withAuditReceiptFixture(fixture, async () => {
    await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "MODEL_CALL_CHECKPOINT_CONTEXT_MISSING");
    assertEquals(fixture.calls, []);
    assertEquals(fixture.providerBodies, []);
  });
});

Deno.test("audit receipt opt-in requires a structured output contract before dispatch", async () => {
  const fixture = auditReceiptFixture();
  await withAuditReceiptFixture(fixture, async () => {
    const request = { ...fixture.request, requireJson: false };
    await assertRejects(() => fixture.invoke(request), OpenAIAdapterError, "OPENAI_CHECKPOINT_OUTPUT_CONTRACT_REQUIRED");
    assertEquals(fixture.calls, []);
    assertEquals(fixture.providerBodies, []);
  });
});

Deno.test("audit receipt opt-in cannot use a captured lifecycle as legacy evidence", async () => {
  const fixture = auditReceiptFixture();
  const lifecycle: string[] = [];
  await withAuditReceiptFixture(fixture, async () => {
    const request = { ...fixture.request, attemptLifecycle: {
      prepare() { lifecycle.push("prepare"); return Promise.resolve({ attemptNumber: 1, clientRequestId: "captured-positive-control" }); },
      complete() { lifecycle.push("complete"); return Promise.resolve(); },
    } };
    await assertRejects(() => fixture.invoke(request), OpenAIAdapterError, "OPENAI_CHECKPOINT_LIFECYCLE_CONFLICT");
    assertEquals(lifecycle, []);
    assertEquals(fixture.calls, []);
    assertEquals(fixture.providerBodies, []);
  });
});

for (const lostAcknowledgements of [false, true]) {
  Deno.test("audit receipt fresh/readback and replay identity agrees with lost ACK=" + lostAcknowledgements, async () => {
    const fixture = auditReceiptFixture();
    fixture.loseWriteAcks = lostAcknowledgements;
    await withAuditReceiptFixture(fixture, async () => {
      const first = await fixture.invoke();
      const replay = await fixture.invoke();
      assertEquals(first.structured, { decision: "approve" });
      assertEquals(replay.structured, first.structured);
      assertEquals(fixture.providerBodies.length, 1);
      const receipt = auditReceipt(first);
      assertEquals(auditReceipt(replay), receipt);
      assertEquals(receipt.version, "terminal-model-attempt-receipt.1");
      assertEquals(receipt.kind, "checkpoint");
      assertEquals(receipt.userId, AUDIT_OWNER);
      assertEquals(receipt.logicalRequestId, "audit-receipt-request");
      assertEquals(receipt.checkpointScope, "generate-document");
      assertEquals(receipt.authorityReservationId, AUDIT_ORIGIN);
      assertEquals(receipt.logicalStageKey, fixture.request.logicalStageKey);
      assertEquals(receipt.requestSha256, fixture.retainedWrite?.p_request_sha256);
      assertEquals(receipt.providerAttemptId, AUDIT_ADMISSION);
      assertEquals(receipt.usageLedgerId, AUDIT_USAGE);
      assertEquals(receipt.resultResponseSha256, AUDIT_RESULT_SHA);
      assertEquals(receipt.attemptStatus, "succeeded");
      assertEquals(receipt.providerStatus, "completed");
      assertEquals(receipt.errorCode, null);
      assertEquals(receipt.modelCallKey, await auditFixtureSha(
        fixture.request.logicalStageKey + "|" + String(fixture.retainedWrite?.p_request_sha256) + "|" + AUDIT_ADMISSION,
      ));
      assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length,
        lostAcknowledgements ? 2 : 1);
      assertEquals(fixture.calls.filter((call) => call.name === "claim_openai_capacity_lease").length, 1);
      for (const body of fixture.providerBodies) {
        assertEquals(Object.hasOwn(body, "requireLegacyCheckpointReceipt"), false);
        assertEquals(Object.hasOwn(body, "legacyCheckpointReceipt"), false);
      }
    });
  });
}

for (const afterCapacity of [false, true]) {
  Deno.test("audit receipt replay cancellation fences publication after capacity=" + afterCapacity, async () => {
    const fixture = auditReceiptFixture();
    await withAuditReceiptFixture(fixture, async () => {
      const first = await fixture.invoke();
      assertEquals(first.structured, { decision: "approve" });
      fixture.calls.length = 0;
      if (afterCapacity) {
        fixture.readMode = "after-capacity";
        fixture.beforeRelease = () => fixture.controller.abort();
      } else fixture.controller.abort();
      await assertRejects(() => fixture.invoke(), DOMException, "abort");
      assertEquals(fixture.providerBodies.length, 1);
      assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length, 0);
      assertEquals(fixture.calls.filter((call) => call.name === "release_openai_capacity_lease").length,
        afterCapacity ? 1 : 0);
    });
  });
}

Deno.test("audit receipt fresh success is not published after cancellation during capacity release", async () => {
  const fixture = auditReceiptFixture();
  fixture.beforeRelease = () => fixture.controller.abort();
  await withAuditReceiptFixture(fixture, async () => {
    await assertRejects(() => fixture.invoke(), DOMException, "abort");
    assertEquals(fixture.providerBodies.length, 1);
    assertEquals(fixture.retainedWrite?.p_attempt_status, "succeeded");
    assertEquals(fixture.calls.filter((call) => call.name === "record_legacy_model_call_attempt").length, 1);
  });
});

Deno.test("audit receipt replay does not publish after cancellation during its checkpoint read", async () => {
  const fixture = auditReceiptFixture();
  await withAuditReceiptFixture(fixture, async () => {
    assertEquals((await fixture.invoke()).structured, { decision: "approve" });
    fixture.calls.length = 0;
    fixture.beforeRead = () => fixture.controller.abort();
    await assertRejects(() => fixture.invoke(), DOMException, "abort");
    assertEquals(fixture.providerBodies.length, 1);
    assertEquals(fixture.calls.map((call) => call.name), ["read_legacy_model_call_checkpoint"]);
  });
});

Deno.test("audit receipt requirement is captured before a checkpoint read can mutate its request", async () => {
  const fixture = auditReceiptFixture();
  await withAuditReceiptFixture(fixture, async () => {
    assertEquals((await fixture.invoke()).structured, { decision: "approve" });
    fixture.beforeRead = () => { fixture.request.requireLegacyCheckpointReceipt = false; };
    const replay = await fixture.invoke();
    assertEquals(fixture.request.requireLegacyCheckpointReceipt, false);
    assertEquals(auditReceipt(replay).kind, "checkpoint");
    assertEquals(fixture.providerBodies.length, 1);
  });
});

Deno.test("audit receipt request hash identifies the exact strict schema sent after a held checkpoint read", async () => {
  const fixture = auditReceiptFixture();
  await withAuditReceiptFixture(fixture, async () => {
    const schema = structuredClone(strictSchema);
    const request = { ...fixture.request, outputSchema: schema };
    const expectedBody = structuredClone(buildOpenAIRequestBody(request));
    const acceptedRoute = resolveOpenAIRoute(request.task);
    fixture.beforeRead = () => {
      schema.schema.properties.decision.enum.splice(0, 2, "changed-after-hash");
      request.messages[0].content = "Changed caller text after the accepted hash.";
    };
    const response = await fixture.invoke(request);
    assertEquals(response.structured, { decision: "approve" });
    assertEquals(fixture.providerBodies.length, 1);
    const sentBody = fixture.providerBodies[0];
    assertEquals(sentBody, expectedBody);
    const wireBody = fixture.providerBodyTexts[0];
    assert(typeof wireBody === "string");
    // Existing checkpoint identity hashes the actual JSON.stringify wire
    // representation; sorting keys here would invent a different contract.
    const sentIdentityText = acceptedRoute.creditFallback
      ? JSON.stringify({ request: sentBody, creditFallback: acceptedRoute.creditFallback })
      : wireBody;
    assertEquals(fixture.retainedWrite?.p_request_sha256,
      await auditFixtureSha(sentIdentityText),
      "Checkpoint request identity must hash the actual provider schema and wording.");
    assertEquals(auditReceipt(response).requestSha256, fixture.retainedWrite?.p_request_sha256);
  });
});

Deno.test("audit receipt owns its accepted route before a held checkpoint read can mutate caller policy", async () => {
  const fixture = auditReceiptFixture();
  await withAuditReceiptFixture(fixture, async () => {
    const schema = structuredClone(strictSchema);
    const acceptedRoute = {
      ...resolveOpenAIRoute(fixture.request.task),
      structuredOutputSchemaVersion: schema.name,
    };
    const originalRoute = structuredClone(acceptedRoute);
    const request = { ...fixture.request, outputSchema: schema, routeSnapshot: acceptedRoute };
    const originalBody = structuredClone(buildOpenAIRequestBody(request));
    fixture.beforeRead = () => {
      acceptedRoute.model = "changed-after-checkpoint-admission";
      acceptedRoute.reasoningEffort = originalRoute.reasoningEffort === "low" ? "high" : "low";
    };
    const response = await fixture.invoke(request);
    assertEquals(response.structured, { decision: "approve" });
    assertEquals(fixture.providerBodies, [originalBody]);
    assertEquals(fixture.retainedWrite?.p_model, originalRoute.model,
      "Durable usage must retain the model actually sent to the provider.");
    assertEquals(fixture.retainedWrite?.p_reasoning_effort, originalRoute.reasoningEffort);
    assertEquals(response.routeSnapshot, originalRoute);
    const envelope: unknown = fixture.checkpoint?.response_envelope;
    assert(envelope && typeof envelope === "object" && !Array.isArray(envelope));
    assertEquals(Reflect.get(envelope, "route_snapshot"), originalRoute);
    assertEquals(auditReceipt(response).kind, "checkpoint");
  });
});

Deno.test("audit receipt missing egress ACK retains reconciliation priority over cancellation", async () => {
  const fixture = auditReceiptFixture();
  fixture.loseEgressAcks = true;
  fixture.beforeWrite = () => fixture.controller.abort();
  await withAuditReceiptFixture(fixture, async () => {
    const error = await assertRejects(() => fixture.invoke(), OpenAIAdapterError,
      "OPENAI_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED");
    assertEquals(isProviderReconciliationRequired(error), true);
    assertEquals(fixture.providerBodies.length, 1);
    assertEquals(fixture.calls.filter((call) => call.name === "complete_user_external_egress").length, 2);
  });
});

for (const cancelled of [false, true]) {
  Deno.test("ordinary legacy completion ACK uncertainty requires reconciliation with cancellation=" + cancelled, async () => {
    const fixture = auditReceiptFixture();
    fixture.loseEgressAcks = true;
    if (cancelled) fixture.beforeWrite = () => fixture.controller.abort();
    await withAuditReceiptFixture(fixture, async () => {
      const request = { ...fixture.request, requireLegacyCheckpointReceipt: false };
      const error = await assertRejects(() => fixture.invoke(request), OpenAIAdapterError,
        "OPENAI_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED");
      assertEquals(isProviderReconciliationRequired(error), true);
      assertEquals(fixture.providerBodies.length, 1);
      assertEquals(fixture.retainedWrite?.p_attempt_status, "succeeded");
      assertEquals(fixture.calls.filter((call) => call.name === "complete_user_external_egress").length, 2);
      const release = fixture.calls.find((call) => call.name === "release_openai_capacity_lease");
      assertEquals(release?.args.p_terminal_outcome, "reconciliation_required");
    });
  });
}

for (const boundary of ["read", "prepare", "write"] as const) {
  Deno.test("audit receipt rejects trusted request-context replacement during " + boundary, async () => {
    const fixture = auditReceiptFixture();
    if (boundary === "read") fixture.beforeRead = () => fixture.bind("another-request");
    else if (boundary === "prepare") fixture.beforeRead = (args) => {
      if (args.p_allocate_attempt === true) fixture.bind("another-request");
    };
    else fixture.beforeWrite = () => fixture.bind("another-request");
    await withAuditReceiptFixture(fixture, async () => {
      await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "MODEL_CALL_CHECKPOINT_IDENTITY_CHANGED");
      if (boundary !== "write") assertEquals(fixture.providerBodies.length, 0);
      else assertEquals(fixture.providerBodies.length, 1);
    });
  });
}

Deno.test("malformed completed structured output cannot publish audit evidence or redispatch on replay", async () => {
  const fixture = auditReceiptFixture({ text: "not valid JSON" });
  await withAuditReceiptFixture(fixture, async () => {
    await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_INVALID_STRUCTURED_OUTPUT");
    await assertRejects(() => fixture.invoke(), OpenAIAdapterError, "OPENAI_INVALID_STRUCTURED_OUTPUT");
    assertEquals(fixture.providerBodies.length, 1);
    assertEquals(fixture.retainedWrite?.p_attempt_status, "failed");
  });
});

Deno.test("ordinary legacy and captured success omit internal checkpoint receipt by default", async () => {
  const fixture = auditReceiptFixture();
  await withAuditReceiptFixture(fixture, async () => {
    const request = { ...fixture.request, requireLegacyCheckpointReceipt: false };
    const legacy = await fixture.invoke(request);
    assertEquals(legacy.structured, { decision: "approve" });
    assertEquals(Object.hasOwn(legacy, "legacyCheckpointReceipt"), false);
    const lifecycle: string[] = [];
    const captured = await fixture.invoke({ ...request, attemptLifecycle: {
      prepare() { lifecycle.push("prepare"); return Promise.resolve({ attemptNumber: 1, clientRequestId: "captured-positive-control" }); },
      complete() { lifecycle.push("complete"); return Promise.resolve(); },
    } });
    assertEquals(captured.structured, legacy.structured);
    assertEquals(Object.hasOwn(captured, "legacyCheckpointReceipt"), false);
    assertEquals(lifecycle, ["prepare", "complete"]);
  });
});

// Candidate model defaults are deliberately available only when the caller
// explicitly identifies this process as a test environment.
Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");

const strictSchema = {
  name: "prompted_test_result",
  schema: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["approve", "reject"] },
    },
    required: ["decision"],
    additionalProperties: false,
  },
};

const hostedRouteEnvironment = {
  OPENAI_FAST_MODEL: "hosted-fast",
  OPENAI_DEEP_MODEL: "hosted-deep",
  OPENAI_RESEARCH_MODEL: "hosted-research",
  OPENAI_REVIEW_MODEL: "hosted-review",
  OPENAI_ROUTING_VERSION: "routing.hosted.test.1",
};

function bindModelCallContext(
  signal: AbortSignal,
  context: Parameters<typeof bindModelCallContextImpl>[1],
): void {
  const admin = new Proxy(context.admin as object, {
    get(target, property, receiver) {
      if (property !== "rpc") return Reflect.get(target, property, receiver);
      return (name: string, args: Record<string, unknown>) => {
        if (name === "claim_openai_capacity_lease") {
          return Promise.resolve({
            data: {
              contract_version: "openai-capacity-lease.v1",
              capacity_admitted: true,
              outcome: "admitted",
              capacity_lease_id: "10000000-0000-4000-8000-000000000001",
              lease_token: args.p_lease_token,
              environment: "test",
              semantic_route: args.p_semantic_route,
              estimated_tokens: args.p_estimated_tokens,
              config_revision: 1,
              expires_at: "2099-01-01T00:00:00.000Z",
              retry_after_seconds: 5,
            },
            error: null,
          });
        }
        if (name === "release_openai_capacity_lease") {
          return Promise.resolve({
            data: {
              contract_version: "openai-capacity-lease.v1",
              outcome: "released",
              capacity_lease_id: args.p_capacity_lease_id,
              terminal_outcome: args.p_terminal_outcome,
            },
            error: null,
          });
        }
        if (name === "mark_openai_capacity_lease_dispatched") {
          return Promise.resolve({
            data: {
              contract_version: "openai-capacity-lease.v1",
              outcome: "dispatched",
              capacity_lease_id: args.p_capacity_lease_id,
              dispatched_at: "2026-09-01T00:00:00.000Z",
              expires_at: "2099-01-01T00:00:00.000Z",
            },
            error: null,
          });
        }
        const externalEgressCalls = Reflect.get(
          target,
          "__externalEgressCalls",
        );
        if (
          Array.isArray(externalEgressCalls) &&
          ["claim_user_external_egress", "complete_user_external_egress"]
            .includes(name)
        ) {
          externalEgressCalls.push({ name, ...args });
        }
        if (name === "claim_user_external_egress") {
          return Promise.resolve({
            data: {
              outcome: "accepted",
              egress_permitted: true,
              dispatch_token: args.p_dispatch_token,
            },
            error: null,
          });
        }
        if (name === "complete_user_external_egress") {
          return Promise.resolve({
            data: { outcome: "completed" },
            error: null,
          });
        }
        const rpc = Reflect.get(target, "rpc", receiver) as (
          name: string,
          args: Record<string, unknown>,
        ) => unknown;
        return rpc.call(target, name, args);
      };
    },
  }) as SupabaseClient;
  bindModelCallContextImpl(signal, { ...context, admin });
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map(
    Object.keys(values).map((name) => [name, Deno.env.get(name)]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

function meteredSignal(
  rpcCalls: Array<Record<string, unknown>> = [],
  rpcError: unknown = null,
  externalEgressCalls?: Array<Record<string, unknown>>,
): AbortController {
  const controller = new AbortController();
  const admin = {
    ...(externalEgressCalls
      ? { __externalEgressCalls: externalEgressCalls }
      : {}),
    rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, ...params });
      if (name === "claim_user_external_egress") {
        return Promise.resolve({
          data: {
            outcome: "accepted",
            egress_permitted: true,
            dispatch_token: params.p_dispatch_token,
          },
          error: null,
        });
      }
      if (name === "complete_user_external_egress") {
        return Promise.resolve({ data: { outcome: "completed" }, error: null });
      }
      return validAccountingReceipt(params, rpcError);
    },
  } as unknown as SupabaseClient;
  bindModelCallContext(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    generationRequestId: "test-logical-request",
    admin,
  });
  return controller;
}

function routeRequest(
  request: Parameters<typeof routeRequestImpl>[0],
): ReturnType<typeof routeRequestImpl> {
  if (request.signal) return routeRequestImpl(request);
  const controller = meteredSignal();
  return routeRequestImpl({ ...request, signal: controller.signal });
}

function legacyRequest(
  request: Parameters<typeof routeRequest>[0],
  rpcCalls: Array<Record<string, unknown>> = [],
): ReturnType<typeof routeRequest> {
  const controller = meteredSignal(rpcCalls);
  return routeRequestImpl({
    ...request,
    logicalStageKey: request.logicalStageKey ?? "provider-router.test",
    signal: controller.signal,
  });
}

Deno.test("OpenAI exhausted credit is distinct from transient rate limiting", async () => {
  await withEnvironment({
    OPENAI_API_KEY: "synthetic-key",
    OPENAI_RETRY_BASE_MS: "0",
  }, async () => {
    const originalFetch = globalThis.fetch;
    let dispatches = 0;
    globalThis.fetch = (() => {
      dispatches += 1;
      return Promise.resolve(
        Response.json({ error: { code: "credit_balance_exhausted" } }, {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      );
    }) as typeof fetch;
    try {
      const error = await assertRejects(
        () =>
          legacyRequest({
            task: "recommend",
            systemPrompt: "Classify a synthetic document.",
            messages: [{ role: "user", content: "Meeting agenda" }],
          }),
        OpenAIAdapterError,
        "OPENAI_CREDIT_EXHAUSTED",
      );
      assertEquals(error.retryable, false);
      assertEquals(dispatches, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("semantic tasks resolve to the four approved OpenAI routes", () => {
  assertEquals(resolveOpenAIRoute("intent").semanticRoute, "fast");
  assertEquals(resolveOpenAIRoute("clarify").model, "gpt-5.6-luna");
  assertEquals(resolveOpenAIRoute("document").semanticRoute, "deep");
  assertEquals(resolveOpenAIRoute("proofread").semanticRoute, "deep");
  assertEquals(resolveOpenAIRoute("document").reasoningEffort, "medium");
  assertEquals(resolveOpenAIRoute("research").semanticRoute, "research");
  assertEquals(resolveOpenAIRoute("job_match").semanticRoute, "research");
  assertEquals(resolveOpenAIRoute("review").semanticRoute, "review");
  assertEquals(resolveOpenAIRoute("review").reasoningEffort, "high");
  assertThrows(
    () => resolveOpenAIRoute("client-selected-model"),
    OpenAIAdapterError,
    "OPENAI_UNKNOWN_TASK",
  );
});

Deno.test(
  "background processing stays disabled until its durable contract is activated",
  () => {
    assertThrows(
      () =>
        buildOpenAIRequestBody({
          task: "document",
          systemPrompt: "Draft",
          messages: [{ role: "user", content: "Synthetic input" }],
          background: true,
        }),
      OpenAIAdapterError,
      "OPENAI_BACKGROUND_NOT_ACTIVATED",
    );
  },
);

Deno.test("route configuration uses only the versioned OpenAI environment contract", () => {
  Deno.env.set("OPENAI_FAST_MODEL", "approved-fast");
  Deno.env.set("OPENAI_ROUTING_VERSION", "routing.test.7");
  try {
    assertEquals(resolveOpenAIRoute("recommend"), {
      provider: "openai",
      semanticRoute: "fast",
      model: "approved-fast",
      reasoningEffort: "low",
      routingVersion: "routing.test.7",
      structuredOutputSchemaVersion: "text.compatibility.v1",
      allowedTools: [],
      timeoutMs: 30_000,
      maxAttempts: 2,
      background: false,
      store: false,
      fallback: null,
    });
  } finally {
    Deno.env.delete("OPENAI_FAST_MODEL");
    Deno.env.delete("OPENAI_ROUTING_VERSION");
  }
});

Deno.test("candidate routes remain defaults only for local and test fixtures", async () => {
  for (const environment of ["local", "test"]) {
    await withEnvironment(
      {
        PROMPTED_DEPLOYMENT_ENV: environment,
        OPENAI_FAST_MODEL: undefined,
        OPENAI_DEEP_MODEL: undefined,
        OPENAI_RESEARCH_MODEL: undefined,
        OPENAI_REVIEW_MODEL: undefined,
        OPENAI_ROUTING_VERSION: undefined,
      },
      () => {
        assertEquals(resolveOpenAIRoute("intent").model, "gpt-5.6-luna");
        assertEquals(resolveOpenAIRoute("document").model, "gpt-5.6-sol");
        assertEquals(resolveOpenAIRoute("research").model, "gpt-5.6-terra");
        assertEquals(resolveOpenAIRoute("review").model, "gpt-5.6-sol");
      },
    );
  }
});

Deno.test("missing and unknown deployment environments fail before routing", async () => {
  for (const environment of [undefined, "", "development", "prod", "typo"]) {
    await withEnvironment(
      { PROMPTED_DEPLOYMENT_ENV: environment },
      () => {
        const error = assertThrows(
          () => resolveOpenAIRoute("intent"),
          OpenAIAdapterError,
          "OPENAI_DEPLOYMENT_ENV_INVALID",
        );
        assertEquals(error.code, "OPENAI_DEPLOYMENT_ENV_INVALID");
        assertEquals(error.status, 503);
        assertEquals(error.retryable, false);
      },
    );
  }
});

Deno.test("every hosted environment requires the complete frozen routing contract", async () => {
  for (const environment of ["production", "staging", "preview"]) {
    for (const missingName of Object.keys(hostedRouteEnvironment)) {
      await withEnvironment(
        {
          PROMPTED_DEPLOYMENT_ENV: environment,
          ...hostedRouteEnvironment,
          [missingName]: undefined,
        },
        () => {
          const error = assertThrows(
            () => resolveOpenAIRoute("intent"),
            OpenAIAdapterError,
            "OPENAI_HOSTED_ROUTING_CONFIG_MISSING",
          );
          assertEquals(error.code, "OPENAI_HOSTED_ROUTING_CONFIG_MISSING");
          assertEquals(error.status, 503);
          assertEquals(error.retryable, false);
        },
      );
    }
  }
});

Deno.test("hosted routing rejects malformed model and version values before a provider call", async () => {
  for (
    const [name, value] of [
      ["OPENAI_FAST_MODEL", "https://attacker.example/model"],
      ["OPENAI_DEEP_MODEL", "contains spaces"],
      ["OPENAI_RESEARCH_MODEL", "../model"],
      ["OPENAI_REVIEW_MODEL", "UPPERCASE"],
      ["OPENAI_ROUTING_VERSION", "x".repeat(101)],
    ]
  ) {
    await withEnvironment(
      {
        PROMPTED_DEPLOYMENT_ENV: "production",
        ...hostedRouteEnvironment,
        [name]: value,
      },
      () => {
        const error = assertThrows(
          () => resolveOpenAIRoute("intent"),
          OpenAIAdapterError,
          "OPENAI_HOSTED_ROUTING_CONFIG_INVALID",
        );
        assertEquals(error.code, "OPENAI_HOSTED_ROUTING_CONFIG_INVALID");
        assertEquals(error.status, 503);
        assertEquals(error.retryable, false);
      },
    );
  }
});

Deno.test("captured machine output uses strict Structured Outputs and store false", () => {
  const body = buildOpenAIRequestBody({
    task: "document",
    systemPrompt: "Stable non-personal instructions",
    messages: [{ role: "user", content: "Synthetic input" }],
    outputSchema: strictSchema,
  });

  assertEquals(body.model, "gpt-5.6-sol");
  assertEquals(body.store, false);
  assertEquals(body.reasoning, { effort: "medium" });
  assertEquals(body.text, {
    format: {
      type: "json_schema",
      name: "prompted_test_result",
      schema: strictSchema.schema,
      strict: true,
    },
  });
  assertEquals(body.instructions, "Stable non-personal instructions");
  assert(
    !("metadata" in body),
    "document content must not be copied into metadata",
  );
});

Deno.test("web search is available only on the approved research route", () => {
  const research = buildOpenAIRequestBody({
    task: "research",
    systemPrompt: "Research",
    messages: [{ role: "user", content: "Synthetic public fact" }],
    webSearch: true,
  });
  assertEquals(research.tools, [{ type: "web_search" }]);
  assertEquals(research.include, ["web_search_call.action.sources"]);

  assertThrows(
    () =>
      buildOpenAIRequestBody({
        task: "document",
        systemPrompt: "Draft",
        messages: [{ role: "user", content: "No web tool" }],
        webSearch: true,
      }),
    OpenAIAdapterError,
    "OPENAI_TOOL_NOT_ALLOWED",
  );
});

Deno.test("automatic retry is bounded to explicit pre-acceptance responses", () => {
  for (const status of [425, 429]) {
    assert(isRetryableProviderStatus(status), `${status} should retry`);
  }
  for (
    const status of [400, 401, 403, 404, 408, 409, 422, 500, 502, 503, 504]
  ) {
    assert(!isRetryableProviderStatus(status), `${status} should not retry`);
  }
});

Deno.test("capacity denial persists no provider attempt and exposes a bounded retry", async () => {
  const originalFetch = globalThis.fetch;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let fetchCalls = 0;
  let prepareCalls = 0;
  const controller = new AbortController();
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "claim_openai_capacity_lease") {
        return Promise.resolve({
          data: {
            contract_version: "openai-capacity-lease.v1",
            capacity_admitted: false,
            outcome: "awaiting_capacity",
            retry_after_seconds: 7,
          },
          error: null,
        });
      }
      throw new Error(`unexpected RPC after capacity denial: ${name}`);
    },
  } as unknown as SupabaseClient;
  bindModelCallContextImpl(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    admin,
  });
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        routeRequestImpl({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          signal: controller.signal,
          attemptLifecycle: {
            prepare() {
              prepareCalls += 1;
              return Promise.resolve({
                attemptNumber: 1,
                clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              });
            },
            complete() {
              throw new Error("capacity denial must not complete an attempt");
            },
          },
        }),
      OpenAIAdapterError,
      "OPENAI_AWAITING_CAPACITY",
    );
    assertEquals(error.status, 429);
    assertEquals(error.retryable, true);
    assertEquals(error.retryAfterSeconds, 7);
    assertEquals(prepareCalls, 0);
    assertEquals(fetchCalls, 0);
    assertEquals(
      rpcCalls.map((call) => call.name),
      ["claim_openai_capacity_lease"],
    );
    assertEquals(rpcCalls[0]?.args.p_semantic_route, "deep");
    assert(Number(rpcCalls[0]?.args.p_estimated_tokens) > 2_400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("a request above the measured route ceiling fails without retry or provider work", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const controller = new AbortController();
  bindModelCallContextImpl(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    admin: {
      rpc(name: string) {
        if (name !== "claim_openai_capacity_lease") {
          throw new Error(
            `unexpected RPC after oversized capacity denial: ${name}`,
          );
        }
        return Promise.resolve({
          data: {
            contract_version: "openai-capacity-lease.v1",
            capacity_admitted: false,
            outcome: "capacity_request_too_large",
            denial_reason: "estimated_tokens_exceed_route_limit",
            retryable: false,
          },
          error: null,
        });
      },
    } as unknown as SupabaseClient,
  });
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        routeRequestImpl({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          signal: controller.signal,
        }),
      OpenAIAdapterError,
      "OPENAI_CAPACITY_REQUEST_TOO_LARGE",
    );
    assertEquals(error.status, 503);
    assertEquals(error.retryable, false);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("an unresolved capacity release blocks success after terminal persistence", async () => {
  const originalFetch = globalThis.fetch;
  const rpcCalls: string[] = [];
  let fetchCalls = 0;
  let completionCalls = 0;
  const controller = new AbortController();
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(name);
      if (name === "claim_openai_capacity_lease") {
        return Promise.resolve({
          data: {
            contract_version: "openai-capacity-lease.v1",
            capacity_admitted: true,
            outcome: "admitted",
            capacity_lease_id: "10000000-0000-4000-8000-000000000001",
            lease_token: args.p_lease_token,
            environment: "test",
            semantic_route: args.p_semantic_route,
            estimated_tokens: args.p_estimated_tokens,
            config_revision: 1,
            expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        });
      }
      if (name === "claim_user_external_egress") {
        return Promise.resolve({
          data: {
            outcome: "accepted",
            egress_permitted: true,
            dispatch_token: args.p_dispatch_token,
          },
          error: null,
        });
      }
      if (name === "complete_user_external_egress") {
        return Promise.resolve({ data: { outcome: "completed" }, error: null });
      }
      if (name === "mark_openai_capacity_lease_dispatched") {
        return Promise.resolve({
          data: {
            contract_version: "openai-capacity-lease.v1",
            outcome: "dispatched",
            capacity_lease_id: args.p_capacity_lease_id,
            dispatched_at: "2026-09-01T00:00:00.000Z",
            expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        });
      }
      if (name === "release_openai_capacity_lease") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST000", message: "synthetic lost release ack" },
        });
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
  } as unknown as SupabaseClient;
  bindModelCallContextImpl(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    admin,
  });
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      Response.json({
        id: "resp_capacity_release",
        status: "completed",
        output_text: "durable synthetic result",
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    );
  }) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        routeRequestImpl({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          signal: controller.signal,
          attemptLifecycle: {
            prepare() {
              return Promise.resolve({
                attemptNumber: 1,
                clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              });
            },
            complete() {
              completionCalls += 1;
              return Promise.resolve();
            },
          },
        }),
      OpenAIAdapterError,
      "OPENAI_CAPACITY_RELEASE_RECONCILIATION_REQUIRED",
    );
    assertEquals(error.status, 503);
    assertEquals(error.retryable, false);
    assertEquals(fetchCalls, 1);
    assertEquals(completionCalls, 1);
    assertEquals(
      rpcCalls.filter((name) => name === "release_openai_capacity_lease")
        .length,
      2,
    );
    assertEquals(rpcCalls.slice(0, 3), [
      "claim_openai_capacity_lease",
      "mark_openai_capacity_lease_dispatched",
      "claim_user_external_egress",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("the OpenAI adapter retries one transient failure without changing route", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const requests: Array<Record<string, unknown>> = [];
  const logs: unknown[][] = [];
  const rpcCalls: Array<Record<string, unknown>> = [];
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_RETRY_BASE_MS", "0");

  globalThis.fetch = ((_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) {
      return Promise.resolve(
        new Response("private upstream diagnostic", { status: 425 }),
      );
    }
    return Promise.resolve(
      Response.json({
        id: "resp_test",
        status: "completed",
        output_text: '{"decision":"approve"}',
        usage: { input_tokens: 11, output_tokens: 3 },
      }),
    );
  }) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    const response = await legacyRequest(
      {
        task: "intent",
        systemPrompt: "system",
        messages: [{ role: "user", content: "hello" }],
        outputSchema: strictSchema,
      },
      rpcCalls,
    );
    assertEquals(response.structured, { decision: "approve" });
    assertEquals(response.routeSnapshot.semanticRoute, "fast");
    assertEquals(
      response.routeSnapshot.structuredOutputSchemaVersion,
      "prompted_test_result",
    );
    assertEquals(response.routeSnapshot.allowedTools, []);
    assertEquals(response.sources, []);
    assertEquals(
      response.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        errorCode: attempt.errorCode,
        responseId: attempt.responseId,
      })),
      [
        {
          attemptNumber: 1,
          status: "failed",
          errorCode: "OPENAI_UPSTREAM_ERROR",
          responseId: "",
        },
        {
          attemptNumber: 2,
          status: "succeeded",
          errorCode: null,
          responseId: "resp_test",
        },
      ],
    );
    assertEquals(requests.length, 2);
    assertEquals(rpcCalls.length, 2);
    assertEquals(
      rpcCalls.map((call) => call.p_attempt_status),
      ["failed", "succeeded"],
    );
    assertEquals(
      rpcCalls.map((call) => call.p_provider_status),
      ["http_425", "completed"],
    );
    assertEquals(requests[0].model, requests[1].model);
    assert(!JSON.stringify(logs).includes("private upstream diagnostic"));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_RETRY_BASE_MS");
  }
});

Deno.test("an upstream 429 honours Retry-After without rapid redispatch", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const rpcCalls: Array<Record<string, unknown>> = [];
  let fetchCalls = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_RETRY_BASE_MS", "0");

  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      new Response("private upstream diagnostic", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
  }) as typeof fetch;
  console.error = () => {};

  try {
    const error = await assertRejects(
      () =>
        legacyRequest(
          {
            task: "intent",
            systemPrompt: "system",
            messages: [{ role: "user", content: "hello" }],
            outputSchema: strictSchema,
          },
          rpcCalls,
        ),
      OpenAIAdapterError,
      "OPENAI_AWAITING_CAPACITY",
    );
    assertEquals(error.code, "OPENAI_AWAITING_CAPACITY");
    assertEquals(error.status, 429);
    assertEquals(error.retryable, true);
    assertEquals(error.retryAfterSeconds, 60);
    assertEquals(error.attempts.length, 1);
    assertEquals(fetchCalls, 1);
    assertEquals(rpcCalls.length, 1);
    assertEquals(rpcCalls[0]?.p_provider_status, "http_429");
    assertEquals(rpcCalls[0]?.p_error_code, "OPENAI_UPSTREAM_ERROR");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_RETRY_BASE_MS");
  }
});

Deno.test("a retry cannot exceed the accepted route's total runtime budget", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let fetchCalls = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_RETRY_BASE_MS", "2000");

  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 425 }));
  }) as typeof fetch;
  console.error = () => {};

  try {
    const acceptedRoute = {
      ...resolveOpenAIRoute("document"),
      structuredOutputSchemaVersion: "prompted_test_result",
      timeoutMs: 1_000,
    };
    const error = await assertRejects(
      () =>
        legacyRequest({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          outputSchema: strictSchema,
          routeSnapshot: acceptedRoute,
        }),
      OpenAIAdapterError,
      "OPENAI_ROUTE_BUDGET_EXHAUSTED",
    );

    assertEquals(error.code, "OPENAI_ROUTE_BUDGET_EXHAUSTED");
    assertEquals(error.retryable, true);
    assertEquals(error.attempts.length, 1);
    assertEquals(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_RETRY_BASE_MS");
  }
});

Deno.test("an ambiguous upstream failure is not redispatched", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_RETRY_BASE_MS", "0");
  console.error = () => {};

  try {
    for (const status of [408, 500, 503]) {
      let fetchCalls = 0;
      const lifecycleEvents: string[] = [];
      globalThis.fetch = (() => {
        fetchCalls += 1;
        return Promise.resolve(new Response(null, { status }));
      }) as typeof fetch;

      let captured: OpenAIAdapterError | null = null;
      try {
        await routeRequest({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          outputSchema: strictSchema,
          attemptLifecycle: {
            prepare() {
              lifecycleEvents.push("prepared");
              return Promise.resolve({
                attemptNumber: 1,
                clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              });
            },
            complete() {
              lifecycleEvents.push("completed");
              return Promise.resolve();
            },
          },
        });
      } catch (error) {
        if (error instanceof OpenAIAdapterError) captured = error;
      }

      assert(captured);
      assertEquals(captured.code, "OPENAI_PROVIDER_RECONCILIATION_REQUIRED");
      assertEquals(captured.retryable, false);
      assertEquals(fetchCalls, 1);
      assertEquals(lifecycleEvents, ["prepared", "completed"]);
      assertEquals(captured.attempts.length, 1);
      assertEquals(captured.attempts[0]?.providerStatus, "ambiguous");
      assertEquals(
        captured.attempts[0]?.errorCode,
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_RETRY_BASE_MS");
  }
});

Deno.test(
  "captured routing executes the immutable accepted model and durable attempt identity",
  async () => {
    const originalFetch = globalThis.fetch;
    const events: string[] = [];
    const requestBodies: Array<Record<string, unknown>> = [];
    let clientRequestId = "";
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    Deno.env.set("OPENAI_DEEP_MODEL", "changed-after-acceptance");

    globalThis.fetch = ((_url, init) => {
      events.push("fetch");
      requestBodies.push(JSON.parse(String(init?.body)));
      clientRequestId = new Headers(init?.headers).get("X-Client-Request-Id") ??
        "";
      return Promise.resolve(
        Response.json({
          id: "resp_accepted_route",
          status: "completed",
          output_text: '{"decision":"approve"}',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      );
    }) as typeof fetch;

    try {
      const acceptedRoute = {
        ...resolveOpenAIRoute("document"),
        model: "accepted-deep",
        routingVersion: "routing.accepted.1",
        structuredOutputSchemaVersion: "prompted_test_result",
        maxAttempts: 1 as const,
      };
      const response = await legacyRequest({
        task: "document",
        systemPrompt: "system",
        messages: [{ role: "user", content: "synthetic" }],
        outputSchema: strictSchema,
        routeSnapshot: acceptedRoute,
        attemptLifecycle: {
          prepare(input) {
            events.push(`prepare:${input.localAttemptNumber}`);
            assertEquals(input.routeSnapshot, acceptedRoute);
            assertEquals(input.requestSha256.length, 64);
            return Promise.resolve({
              attemptNumber: 1,
              clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            });
          },
          complete(input) {
            events.push(`complete:${input.attempt.attemptNumber}`);
            assertEquals(input.structuredOutput, { decision: "approve" });
            return Promise.resolve();
          },
        },
      });

      assertEquals(events, ["prepare:1", "fetch", "complete:1"]);
      assertEquals(response.attempts[0]?.attemptNumber, 1);
      assertEquals(response.routeSnapshot, acceptedRoute);
      assertEquals(requestBodies[0]?.model, "accepted-deep");
      assertEquals(clientRequestId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
      Deno.env.delete("OPENAI_DEEP_MODEL");
    }
  },
);

Deno.test("a durable attempt beyond the accepted maximum is never dispatched", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() => {
    events.push("fetch");
    return Promise.resolve(
      Response.json({
        id: "must-not-dispatch",
        status: "completed",
        output_text: '{"decision":"approve"}',
      }),
    );
  }) as typeof fetch;

  try {
    const acceptedRoute = {
      ...resolveOpenAIRoute("document"),
      structuredOutputSchemaVersion: "prompted_test_result",
    };
    const error = await assertRejects(
      () =>
        routeRequest({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          outputSchema: strictSchema,
          routeSnapshot: acceptedRoute,
          attemptLifecycle: {
            prepare() {
              events.push("prepare");
              return Promise.resolve({
                attemptNumber: 3,
                clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              });
            },
            complete(input) {
              events.push(
                `complete:${input.attempt.attemptNumber}:${input.attempt.errorCode}`,
              );
              return Promise.resolve();
            },
          },
        }),
      OpenAIAdapterError,
      "OPENAI_ATTEMPT_LIMIT_EXCEEDED",
    );

    assertEquals(error.code, "OPENAI_ATTEMPT_LIMIT_EXCEEDED");
    assertEquals(error.retryable, false);
    assertEquals(error.attempts.length, 1);
    assertEquals(events, [
      "prepare",
      "complete:3:OPENAI_ATTEMPT_LIMIT_EXCEEDED",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("a database cumulative-attempt rejection cannot cross provider dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        legacyRequest({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          attemptLifecycle: {
            prepare() {
              return Promise.reject(
                Object.assign(new Error("durable attempt budget exhausted"), {
                  code: "CAPTURED_PROVIDER_ATTEMPT_LIMIT_EXCEEDED",
                }),
              );
            },
            complete() {
              throw new Error("a rejected preparation is never completed");
            },
          },
        }),
      OpenAIAdapterError,
      "OPENAI_ACCEPTED_ATTEMPT_BUDGET_EXHAUSTED",
    );
    assertEquals(error.status, 409);
    assertEquals(error.retryable, false);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("an accepted route cannot bypass incomplete hosted activation", async () => {
  const acceptedRoute = await withEnvironment({
    PROMPTED_DEPLOYMENT_ENV: "local",
  }, () => ({
    ...resolveOpenAIRoute("document"),
    structuredOutputSchemaVersion: "prompted_test_result",
    maxAttempts: 1 as const,
  }));

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");

  try {
    await withEnvironment(
      {
        PROMPTED_DEPLOYMENT_ENV: "preview",
        ...hostedRouteEnvironment,
        OPENAI_REVIEW_MODEL: undefined,
      },
      async () => {
        const error = await assertRejects(
          () =>
            routeRequest({
              task: "document",
              systemPrompt: "system",
              messages: [{ role: "user", content: "synthetic" }],
              outputSchema: strictSchema,
              routeSnapshot: acceptedRoute,
            }),
          OpenAIAdapterError,
          "OPENAI_HOSTED_ROUTING_CONFIG_MISSING",
        );
        assertEquals(error.code, "OPENAI_HOSTED_ROUTING_CONFIG_MISSING");
      },
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("an invalid accepted route fails before provider dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    await assertRejects(
      () =>
        routeRequest({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          outputSchema: strictSchema,
          routeSnapshot: {
            ...resolveOpenAIRoute("document"),
            structuredOutputSchemaVersion: "different-schema",
          },
        }),
      OpenAIAdapterError,
      "OPENAI_ACCEPTED_ROUTE_INVALID",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("research sources are HTTPS-normalized and stably de-duplicated", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        id: "resp_research_sources",
        status: "completed",
        output_text: "Grounded summary",
        output: [
          {
            type: "web_search_call",
            action: {
              sources: [
                {
                  id: "source-one",
                  title: "Primary source",
                  url: "https://Example.com/fact#fragment",
                },
                {
                  id: "duplicate",
                  title: "Duplicate",
                  url: "https://example.com/fact",
                },
                {
                  id: "insecure",
                  title: "Insecure",
                  url: "http://example.com/not-allowed",
                },
                {
                  title: "Second source",
                  url: "https://example.org/report?q=1",
                },
              ],
            },
          },
        ],
      }),
    )) as typeof fetch;

  try {
    const response = await legacyRequest({
      task: "research",
      systemPrompt: "research",
      messages: [{ role: "user", content: "synthetic public question" }],
      webSearch: true,
    });
    assertEquals(response.sources, [
      {
        id: "source-one",
        title: "Primary source",
        url: "https://example.com/fact",
        type: "web",
      },
      {
        id: "https://example.org/report?q=1",
        title: "Second source",
        url: "https://example.org/report?q=1",
        type: "web",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("invalid structured output fails closed without logging model text", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: unknown[][] = [];
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        id: "resp_invalid",
        status: "completed",
        output_text: "private malformed output",
      }),
    )) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    let captured: OpenAIAdapterError | null = null;
    try {
      await legacyRequest({
        task: "intent",
        systemPrompt: "system",
        messages: [{ role: "user", content: "hello" }],
        outputSchema: strictSchema,
      });
    } catch (error) {
      if (error instanceof OpenAIAdapterError) captured = error;
    }
    assert(captured);
    assertEquals(captured.code, "OPENAI_INVALID_STRUCTURED_OUTPUT");
    assertEquals(captured.attempts.length, 1);
    assertEquals(captured.attempts[0]?.status, "failed");
    assertEquals(captured.attempts[0]?.responseId, "resp_invalid");
    assert(!JSON.stringify(logs).includes("private malformed output"));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test(
  "provider-completed malformed JSON is checkpointed once and exact retry performs no fetch",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    let fetchCalls = 0;
    let recordCalls = 0;
    let recordedAttemptId = "";
    let checkpoint: Record<string, unknown> | null = null;
    const admissionId = "66666666-6666-4666-8666-666666666666";
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(
        Response.json({
          id: "resp_checkpoint_invalid",
          status: "completed",
          output_text: "not-json",
          usage: { input_tokens: 9, output_tokens: 2 },
        }),
      );
    }) as typeof fetch;
    const admin = {
      rpc(name: string, args: Record<string, unknown>) {
        if (name === "read_legacy_model_call_checkpoint") {
          if (checkpoint) {
            return Promise.resolve({ data: checkpoint, error: null });
          }
          return Promise.resolve({
            data: {
              state: "prepared",
              provider_permitted: true,
              attempt_number: 1,
              attempt_admission_id: admissionId,
              execution_claim_token: args.p_execution_claim_token,
            },
            error: null,
          });
        }
        if (name === "mark_legacy_model_attempt_dispatched") {
          return Promise.resolve({
            data: {
              state: "dispatched",
              attempt_admission_id: admissionId,
              provider_attempt_id: admissionId,
            },
            error: null,
          });
        }
        recordCalls += 1;
        recordedAttemptId = String(args.p_provider_attempt_id ?? "");
        checkpoint = {
          state: "replay",
          provider_permitted: false,
          attempt_number: 1,
          response_sha256: "c".repeat(64),
          response_envelope: args.p_result_envelope,
          usage: {
            provider_attempt_id: args.p_provider_attempt_id,
            provider_response_id: args.p_provider_response_id,
            provider_status: args.p_provider_status,
            attempt_status: args.p_attempt_status,
            error_code: args.p_error_code,
            input_tokens: args.p_input_tokens,
            output_tokens: args.p_output_tokens,
            started_at: args.p_started_at,
            completed_at: args.p_completed_at,
            model: args.p_model,
            routing_version: args.p_routing_version,
            semantic_route: args.p_semantic_route,
            reasoning_effort: args.p_reasoning_effort,
          },
        };
        return validAccountingReceipt(args);
      },
    } as unknown as SupabaseClient;
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "checkpoint-invalid",
      admin,
    });
    setModelCallCheckpointContext(controller.signal, {
      scope: "generate-document",
      originReservationId: "44444444-4444-4444-8444-444444444444",
      executionClaimToken: "55555555-5555-4555-8555-555555555555",
    });
    const invoke = () =>
      routeRequest({
        task: "document",
        logicalStageKey: "generate-document.section:summary:draft",
        systemPrompt: "system",
        messages: [{ role: "user", content: "synthetic" }],
        outputSchema: strictSchema,
        signal: controller.signal,
      });
    try {
      await assertRejects(
        invoke,
        OpenAIAdapterError,
        "OPENAI_INVALID_STRUCTURED_OUTPUT",
      );
      await assertRejects(
        invoke,
        OpenAIAdapterError,
        "OPENAI_INVALID_STRUCTURED_OUTPUT",
      );
      assertEquals(fetchCalls, 1);
      assertEquals(recordCalls, 1);
      assertEquals(recordedAttemptId, admissionId);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test(
  "checkpoint replay uses deep canonical equality for reordered nested JSON keys",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    let fetchCalls = 0;
    let savedEnvelope: Record<string, unknown> | null = null;
    const admissionId = "66666666-6666-4666-8666-666666666667";
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(
        Response.json({
          id: "resp_reordered_checkpoint",
          status: "completed",
          output_text: '{"outer":{"alpha":1,"beta":2}}',
          usage: { input_tokens: 4, output_tokens: 3 },
        }),
      );
    }) as typeof fetch;
    const admin = {
      rpc(name: string, args: Record<string, unknown>) {
        if (name === "record_legacy_model_call_attempt") {
          savedEnvelope = args.p_result_envelope as Record<string, unknown>;
          return validAccountingReceipt(args);
        }
        if (name === "mark_legacy_model_attempt_dispatched") {
          return Promise.resolve({
            data: {
              state: "dispatched",
              attempt_admission_id: admissionId,
              provider_attempt_id: admissionId,
            },
            error: null,
          });
        }
        if (!savedEnvelope) {
          return Promise.resolve({
            data: {
              state: "prepared",
              provider_permitted: true,
              attempt_number: 1,
              attempt_admission_id: admissionId,
              execution_claim_token: args.p_execution_claim_token,
            },
            error: null,
          });
        }
        const route = savedEnvelope.route_snapshot as Record<string, unknown>;
        return Promise.resolve({
          data: {
            state: "replay",
            provider_permitted: false,
            attempt_number: 1,
            response_envelope: {
              route_snapshot: {
                fallback: route.fallback,
                store: route.store,
                background: route.background,
                maxAttempts: route.maxAttempts,
                timeoutMs: route.timeoutMs,
                allowedTools: route.allowedTools,
                structuredOutputSchemaVersion:
                  route.structuredOutputSchemaVersion,
                routingVersion: route.routingVersion,
                reasoningEffort: route.reasoningEffort,
                model: route.model,
                semanticRoute: route.semanticRoute,
                provider: route.provider,
              },
              sources: [],
              structured: { outer: { beta: 2, alpha: 1 } },
              text: '{"outer":{"alpha":1,"beta":2}}',
              version: "legacy-provider-result.1",
            },
            usage: {
              provider_response_id: "resp_reordered_checkpoint",
              provider_status: "completed",
              attempt_status: "succeeded",
              error_code: null,
              input_tokens: 4,
              output_tokens: 3,
              started_at: "2026-09-01T00:00:00.000Z",
              completed_at: "2026-09-01T00:00:01.000Z",
            },
          },
          error: null,
        });
      },
    } as unknown as SupabaseClient;
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "reordered-checkpoint",
      admin,
    });
    setModelCallCheckpointContext(controller.signal, {
      scope: "generate-document",
      originReservationId: "44444444-4444-4444-8444-444444444444",
      executionClaimToken: "55555555-5555-4555-8555-555555555555",
    });
    const invoke = () =>
      routeRequest({
        task: "document",
        logicalStageKey: "generate-document.section:summary:draft",
        systemPrompt: "system",
        messages: [{ role: "user", content: "synthetic" }],
        requireJson: true,
        signal: controller.signal,
      });
    try {
      assertEquals((await invoke()).structured, {
        outer: { alpha: 1, beta: 2 },
      });
      Deno.env.delete("OPENAI_API_KEY");
      assertEquals((await invoke()).structured, {
        outer: { alpha: 1, beta: 2 },
      });
      assertEquals(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test("durable checkpoint attempt limit survives a new invocation", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_RETRY_BASE_MS", "0");
  let fetchCalls = 0;
  let admitted = 0;
  const admissionIds = [
    "66666666-6666-4666-8666-666666666668",
    "66666666-6666-4666-8666-666666666669",
  ];
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 429 }));
  }) as typeof fetch;
  console.error = () => {};
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "read_legacy_model_call_checkpoint") {
        if (args.p_allocate_attempt === false) {
          return Promise.resolve({
            data: admitted >= 2
              ? {
                state: "attempt_limit",
                provider_permitted: false,
                attempt_number: 3,
              }
              : {
                state: "not_found",
                provider_permitted: false,
                next_attempt_number: admitted + 1,
              },
            error: null,
          });
        }
        admitted += 1;
        return Promise.resolve({
          data: admitted <= 2
            ? {
              state: "prepared",
              provider_permitted: true,
              attempt_number: admitted,
              attempt_admission_id: admissionIds[admitted - 1],
              execution_claim_token: args.p_execution_claim_token,
            }
            : {
              state: "attempt_limit",
              provider_permitted: false,
              attempt_number: 3,
            },
          error: null,
        });
      }
      if (name === "mark_legacy_model_attempt_dispatched") {
        return Promise.resolve({
          data: {
            state: "dispatched",
            attempt_admission_id: args.p_attempt_admission_id,
            provider_attempt_id: args.p_attempt_admission_id,
          },
          error: null,
        });
      }
      return validAccountingReceipt(args);
    },
  } as unknown as SupabaseClient;
  const controller = new AbortController();
  bindModelCallContext(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    generationRequestId: "checkpoint-attempt-limit",
    admin,
  });
  setModelCallCheckpointContext(controller.signal, {
    scope: "generate-checklist",
    originReservationId: "44444444-4444-4444-8444-444444444444",
    executionClaimToken: "55555555-5555-4555-8555-555555555555",
  });
  const invoke = () =>
    routeRequest({
      task: "checklist",
      logicalStageKey: "generate-checklist.primary",
      systemPrompt: "system",
      messages: [{ role: "user", content: "synthetic" }],
      signal: controller.signal,
    });
  try {
    await assertRejects(invoke, OpenAIAdapterError, "OPENAI_UPSTREAM_ERROR");
    const error = await assertRejects(
      invoke,
      OpenAIAdapterError,
      "OPENAI_STAGE_ATTEMPT_LIMIT",
    );
    assertEquals(error.retryable, false);
    assertEquals(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_RETRY_BASE_MS");
  }
});

Deno.test("a lost durable dispatch acknowledgement fails before provider fetch", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  let fetchCalls = 0;
  let dispatchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      Response.json({
        id: "must-not-fetch-without-dispatch-ack",
        status: "completed",
        output_text: "unsafe",
      }),
    );
  }) as typeof fetch;
  const admissionId = "66666666-6666-4666-8666-666666666670";
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "read_legacy_model_call_checkpoint") {
        return Promise.resolve({
          data: {
            state: "prepared",
            provider_permitted: true,
            attempt_number: 1,
            attempt_admission_id: admissionId,
            execution_claim_token: args.p_execution_claim_token,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_model_attempt_dispatched") {
        dispatchCalls += 1;
        return Promise.resolve({
          data: null,
          error: new TypeError("lost ack"),
        });
      }
      throw new Error("synthetic terminal accounting acknowledgement loss");
    },
  } as unknown as SupabaseClient;
  const controller = new AbortController();
  bindModelCallContext(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    generationRequestId: "dispatch-ack-lost",
    admin,
  });
  setModelCallCheckpointContext(controller.signal, {
    scope: "generate-document",
    originReservationId: "44444444-4444-4444-8444-444444444444",
    executionClaimToken: "55555555-5555-4555-8555-555555555555",
  });
  try {
    const error = await assertRejects(
      () =>
        routeRequest({
          task: "document",
          logicalStageKey: "generate-document.intent",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          signal: controller.signal,
        }),
      OpenAIAdapterError,
      "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED",
    );
    assertEquals(error.retryable, false);
    assertEquals(dispatchCalls, 2);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("concurrent exact workers cannot dispatch one admission twice", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  let fetchCalls = 0;
  let dispatchToken: unknown;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      Response.json({
        id: "resp_single_dispatch",
        status: "completed",
        output_text: "one result",
        usage: { input_tokens: 2, output_tokens: 2 },
      }),
    );
  }) as typeof fetch;
  const admissionId = "66666666-6666-4666-8666-666666666671";
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "read_legacy_model_call_checkpoint") {
        return Promise.resolve({
          data: {
            state: "prepared",
            provider_permitted: true,
            attempt_number: 1,
            attempt_admission_id: admissionId,
            execution_claim_token: args.p_execution_claim_token,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_model_attempt_dispatched") {
        if (dispatchToken === undefined) {
          dispatchToken = args.p_dispatch_token;
        } else if (dispatchToken !== args.p_dispatch_token) {
          return Promise.resolve({
            data: null,
            error: { message: "LEGACY_MODEL_ATTEMPT_ALREADY_DISPATCHED" },
          });
        }
        return Promise.resolve({
          data: {
            state: "dispatched",
            attempt_admission_id: admissionId,
            provider_attempt_id: admissionId,
          },
          error: null,
        });
      }
      return validAccountingReceipt(args);
    },
  } as unknown as SupabaseClient;
  const invoke = () => {
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "concurrent-single-dispatch",
      admin,
    });
    setModelCallCheckpointContext(controller.signal, {
      scope: "generate-checklist",
      originReservationId: "44444444-4444-4444-8444-444444444444",
      executionClaimToken: "55555555-5555-4555-8555-555555555555",
    });
    return routeRequest({
      task: "checklist",
      logicalStageKey: "generate-checklist.primary",
      systemPrompt: "system",
      messages: [{ role: "user", content: "synthetic" }],
      signal: controller.signal,
    });
  };
  try {
    const results = await Promise.allSettled([invoke(), invoke()]);
    assertEquals(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assertEquals(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    assertEquals(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test(
  "historical provider completion without a result checkpoint never redispatches",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(
        Response.json({
          id: "must-not-dispatch",
          status: "completed",
          output_text: "unsafe duplicate",
        }),
      );
    }) as typeof fetch;
    const admin = {
      rpc(name: string) {
        if (name !== "read_legacy_model_call_checkpoint") {
          throw new Error("accounting write must not run");
        }
        return Promise.resolve({
          data: {
            state: "completed_result_unavailable",
            provider_permitted: false,
          },
          error: null,
        });
      },
    } as unknown as SupabaseClient;
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "historical-completed-stage",
      admin,
    });
    setModelCallCheckpointContext(controller.signal, {
      scope: "generate-document",
      originReservationId: "44444444-4444-4444-8444-444444444444",
      executionClaimToken: "55555555-5555-4555-8555-555555555555",
    });
    try {
      const error = await assertRejects(
        () =>
          routeRequest({
            task: "document",
            logicalStageKey: "generate-document.intent",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            signal: controller.signal,
          }),
        OpenAIAdapterError,
        "OPENAI_COMPLETED_RESULT_UNAVAILABLE",
      );
      assertEquals(error.retryable, false);
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test("generic guarded checkpoint replays one immutable provider result", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  let fetchCalls = 0;
  let checkpoint: Record<string, unknown> | undefined;
  const admissionId = "66666666-6666-4666-8666-666666666672";
  const claimToken = "55555555-5555-4555-8555-555555555556";
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      Response.json({
        id: "resp_generic_checkpoint",
        status: "completed",
        output_text: "durable clarification",
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    );
  }) as typeof fetch;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "read_legacy_model_call_checkpoint") {
        return Promise.resolve({
          data: checkpoint ?? {
            state: "prepared",
            provider_permitted: true,
            attempt_number: 1,
            attempt_admission_id: admissionId,
            execution_claim_token: claimToken,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_model_attempt_dispatched") {
        return Promise.resolve({
          data: {
            state: "dispatched",
            attempt_admission_id: admissionId,
            provider_attempt_id: admissionId,
          },
          error: null,
        });
      }
      checkpoint = {
        state: "replay",
        provider_permitted: false,
        attempt_number: 1,
        response_envelope: args.p_result_envelope,
        usage: {
          provider_attempt_id: args.p_provider_attempt_id,
          provider_response_id: args.p_provider_response_id,
          provider_status: args.p_provider_status,
          attempt_status: args.p_attempt_status,
          error_code: args.p_error_code,
          input_tokens: args.p_input_tokens,
          output_tokens: args.p_output_tokens,
          started_at: args.p_started_at,
          completed_at: args.p_completed_at,
          model: args.p_model,
          routing_version: args.p_routing_version,
          semantic_route: args.p_semantic_route,
          reasoning_effort: args.p_reasoning_effort,
        },
      };
      return validAccountingReceipt(args);
    },
  } as unknown as SupabaseClient;
  const invoke = () => {
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "generic-checkpoint-request",
      admin,
      checkpoint: { scope: "clarify" },
    });
    return routeRequest({
      task: "clarify",
      logicalStageKey: "clarify.primary",
      systemPrompt: "system",
      messages: [{ role: "user", content: "synthetic" }],
      signal: controller.signal,
    });
  };
  try {
    const first = await invoke();
    Deno.env.delete("OPENAI_API_KEY");
    const replay = await invoke();
    assertEquals(first.text, "durable clarification");
    assertEquals(replay.text, first.text);
    assertEquals(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("durable terminal errors replay the retained code status and retryability", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.delete("OPENAI_API_KEY");
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("terminal replay must not fetch");
  }) as typeof fetch;
  const admin = {
    rpc(name: string) {
      if (name !== "read_legacy_model_call_checkpoint") {
        throw new Error("terminal replay must not write");
      }
      return Promise.resolve({
        data: {
          state: "terminal_error",
          provider_permitted: false,
          attempt_number: 2,
          usage: {
            attempt_status: "failed",
            provider_status: "http_429",
            error_code: "OPENAI_UPSTREAM_ERROR",
          },
        },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  const controller = new AbortController();
  bindModelCallContext(controller.signal, {
    userId: "22222222-2222-4222-8222-222222222222",
    generationRequestId: "generic-terminal-request",
    admin,
    checkpoint: { scope: "clarify" },
  });
  try {
    const error = await assertRejects(
      () =>
        routeRequest({
          task: "clarify",
          logicalStageKey: "clarify.primary",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          signal: controller.signal,
        }),
      OpenAIAdapterError,
      "OPENAI_UPSTREAM_ERROR",
    );
    assertEquals(error.status, 429);
    assertEquals(error.retryable, true);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test(
  "a successful non-captured result fails closed when terminal accounting cannot persist",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          id: "resp_unmetered",
          status: "completed",
          output_text: "complete result",
          usage: { input_tokens: 7, output_tokens: 4 },
        }),
      )) as typeof fetch;
    const rpcCalls: Array<Record<string, unknown>> = [];
    const externalEgressCalls: Array<Record<string, unknown>> = [];
    const controller = meteredSignal(
      rpcCalls,
      {
        message: "synthetic write failure",
      },
      externalEgressCalls,
    );

    try {
      const error = await assertRejects(
        () =>
          routeRequest({
            task: "document",
            logicalStageKey: "provider-router.persistence-failure",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            signal: controller.signal,
          }),
        OpenAIAdapterError,
        "OPENAI_MODEL_CALL_METERING_FAILED",
      );
      assertEquals(error.attempts[0]?.responseId, "resp_unmetered");
      assertEquals(error.attempts[0]?.inputTokens, 7);
      assertEquals(error.attempts[0]?.outputTokens, 4);
      assertEquals(
        externalEgressCalls.some(
          (call) =>
            call.name === "complete_user_external_egress" &&
            call.p_terminal_state === "reconciliation_required",
        ),
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test(
  "captured lifecycle persistence failure seals common egress as reconciliation-required",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          id: "resp_captured_persistence_failure",
          status: "completed",
          output_text: "complete result",
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      )) as typeof fetch;
    const externalEgressCalls: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    const admin = {
      __externalEgressCalls: externalEgressCalls,
      rpc() {
        throw new Error("captured accounting must remain lifecycle-owned");
      },
    } as unknown as SupabaseClient;
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "captured-persistence-failure",
      admin,
    });

    try {
      await assertRejects(
        () =>
          routeRequest({
            task: "document",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            signal: controller.signal,
            attemptLifecycle: {
              prepare: () =>
                Promise.resolve({
                  attemptNumber: 1,
                  clientRequestId: "captured-provider-attempt-1",
                }),
              complete: () =>
                Promise.reject(new Error("durable completion lost")),
            },
          }),
        OpenAIAdapterError,
        "OPENAI_ATTEMPT_LIFECYCLE_FAILED",
      );
      assertEquals(
        externalEgressCalls.some(
          (call) =>
            call.name === "complete_user_external_egress" &&
            call.p_terminal_state === "reconciliation_required",
        ),
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test("pre-dispatch caller cancellation is terminally recorded as cancelled", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  const rpcCalls: Array<Record<string, unknown>> = [];
  const controller = meteredSignal(rpcCalls);
  globalThis.fetch =
    ((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      })) as typeof fetch;

  try {
    const pending = routeRequest({
      task: "document",
      logicalStageKey: "provider-router.cancelled",
      systemPrompt: "system",
      messages: [{ role: "user", content: "synthetic" }],
      signal: controller.signal,
    });
    controller.abort();
    await assertRejects(() => pending, DOMException);
    assertEquals(rpcCalls.length, 1);
    assertEquals(rpcCalls[0]?.p_attempt_status, "cancelled");
    assertEquals(rpcCalls[0]?.p_provider_status, "cancelled");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("post-dispatch caller cancellation is unknown and cannot redispatch", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  const rpcCalls: Array<Record<string, unknown>> = [];
  const controller = meteredSignal(rpcCalls);
  let fetchCalls = 0;
  let markDispatched!: () => void;
  const dispatched = new Promise<void>((resolve) => (markDispatched = resolve));
  globalThis.fetch = ((_url, init) => {
    fetchCalls += 1;
    markDispatched();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof fetch;

  try {
    const pending = routeRequest({
      task: "document",
      logicalStageKey: "provider-router.post-dispatch-cancel",
      systemPrompt: "system",
      messages: [{ role: "user", content: "synthetic" }],
      signal: controller.signal,
    });
    await dispatched;
    controller.abort();
    const error = await assertRejects(
      () => pending,
      OpenAIAdapterError,
      "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
    );
    assertEquals(error.retryable, false);
    assertEquals(fetchCalls, 1);
    assertEquals(rpcCalls.length, 1);
    assertEquals(rpcCalls[0]?.p_attempt_status, "unknown");
    assertEquals(rpcCalls[0]?.p_provider_status, "ambiguous");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test(
  "captured post-dispatch cancellation reconciles the prepared attempt before failing",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "captured-cancellation",
      admin: {
        rpc: () => Promise.resolve({ data: null, error: null }),
      } as unknown as SupabaseClient,
    });
    const completions: Array<Record<string, unknown>> = [];
    let markDispatched!: () => void;
    const dispatched = new Promise<void>((
      resolve,
    ) => (markDispatched = resolve));
    globalThis.fetch = ((_url, init) => {
      markDispatched();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    }) as typeof fetch;

    try {
      const pending = routeRequest({
        task: "document",
        systemPrompt: "system",
        messages: [{ role: "user", content: "synthetic" }],
        signal: controller.signal,
        attemptLifecycle: {
          prepare: () =>
            Promise.resolve({
              attemptNumber: 1,
              clientRequestId: "captured-one",
            }),
          complete: (input) => {
            completions.push(input as unknown as Record<string, unknown>);
            return Promise.resolve();
          },
        },
      });
      await dispatched;
      controller.abort();
      await assertRejects(
        () => pending,
        OpenAIAdapterError,
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
      );
      assertEquals(completions.length, 1);
      const attempt = completions[0]?.attempt as Record<string, unknown>;
      assertEquals(attempt.status, "failed");
      assertEquals(attempt.providerStatus, "ambiguous");
      assertEquals(
        attempt.errorCode,
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
      );
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test(
  "ambiguous non-captured outcome records one unknown attempt without redispatch",
  async () => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    const rpcCalls: Array<Record<string, unknown>> = [];
    let fetchCalls = 0;
    console.error = () => {};
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response(null, { status: 503 }));
    }) as typeof fetch;
    try {
      const error = await assertRejects(
        () =>
          legacyRequest(
            {
              task: "document",
              logicalStageKey: "provider-router.ambiguous",
              systemPrompt: "system",
              messages: [{ role: "user", content: "synthetic" }],
            },
            rpcCalls,
          ),
        OpenAIAdapterError,
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
      );
      assertEquals(error.attempts[0]?.providerStatus, "ambiguous");
      assertEquals(fetchCalls, 1);
      assertEquals(rpcCalls.length, 1);
      assertEquals(rpcCalls[0]?.p_attempt_status, "unknown");
      assertEquals(
        rpcCalls[0]?.p_error_code,
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
      );
      assertEquals(rpcCalls[0]?.p_provider_status, "ambiguous");
      assertEquals(rpcCalls[0]?.p_provider_response_id, "");
      assertEquals(rpcCalls[0]?.p_input_tokens, 0);
      assertEquals(rpcCalls[0]?.p_output_tokens, 0);
      assertEquals(
        String(rpcCalls[0]?.p_provider_attempt_id).startsWith(
          "client:prompted-",
        ),
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test(
  "unresolved accounting acknowledgement returns a nonredispatch reconciliation state",
  async () => {
    const originalFetch = globalThis.fetch;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    let fetchCalls = 0;
    let rpcCalls = 0;
    let readCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(
        Response.json({
          id: "resp_accounting_unresolved",
          status: "completed",
          output_text: "durable result",
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      );
    }) as typeof fetch;
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      limit() {
        return this;
      },
      maybeSingle() {
        readCalls += 1;
        return Promise.resolve({ data: null, error: null });
      },
    };
    const admin = {
      rpc() {
        rpcCalls += 1;
        return Promise.resolve({
          data: null,
          error: { code: "PGRST000", message: "connection lost" },
        });
      },
      from() {
        return query;
      },
    } as unknown as SupabaseClient;
    const controller = new AbortController();
    bindModelCallContext(controller.signal, {
      userId: "22222222-2222-4222-8222-222222222222",
      generationRequestId: "accounting-unresolved",
      admin,
    });

    try {
      const error = await assertRejects(
        () =>
          routeRequest({
            task: "document",
            logicalStageKey: "provider-router.accounting-unresolved",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            signal: controller.signal,
          }),
        OpenAIAdapterError,
        "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED",
      );
      assertEquals(error.retryable, false);
      assertEquals(fetchCalls, 1);
      assertEquals(rpcCalls, 2);
      assertEquals(readCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test(
  "non-captured requests require bound user context and a stable stage before dispatch",
  async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response(null, { status: 500 }));
    }) as typeof fetch;
    try {
      const unbound = await assertRejects(
        () =>
          routeRequest({
            task: "document",
            logicalStageKey: "provider-router.unbound",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            signal: new AbortController().signal,
          }),
        OpenAIAdapterError,
        "MODEL_CALL_CONTEXT_MISSING",
      );
      assertEquals(unbound.code, "MODEL_CALL_CONTEXT_MISSING");

      const controller = meteredSignal();
      const unstaged = await assertRejects(
        () =>
          routeRequest({
            task: "document",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            signal: controller.signal,
          }),
        OpenAIAdapterError,
        "MODEL_CALL_STAGE_INVALID",
      );
      assertEquals(unstaged.code, "MODEL_CALL_STAGE_INVALID");
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENAI_API_KEY");
    }
  },
);

Deno.test(
  "proofread and job-match call sites use their approved deep and research tasks",
  async () => {
    const proofreadSource = await Deno.readTextFile(
      new URL("../proofread-document/index.ts", import.meta.url),
    );
    const jobMatchSource = await Deno.readTextFile(
      new URL("../job-match/index.ts", import.meta.url),
    );
    assert(proofreadSource.includes('task: "proofread"'));
    assert(
      proofreadSource.includes('logicalStageKey: "proofread-document.primary"'),
    );
    assert(jobMatchSource.includes('task: "job_match"'));
    assert(
      jobMatchSource.includes(
        'logicalStageKey: strict ? "job-match.repair" : "job-match.primary"',
      ),
    );
    assert(
      !jobMatchSource.includes("webSearch:"),
      "vacancy matching remains external-tool-free",
    );
  },
);

const ollamaTestEnvironment = {
  PROMPTED_DEPLOYMENT_ENV: "test",
  OPENAI_API_KEY: "synthetic-openai-key",
  OPENAI_RETRY_BASE_MS: "0",
  OLLAMA_CREDIT_FALLBACK_ENABLED: "true",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "gpt-oss:20b",
  OLLAMA_MODEL_DIGEST: "a".repeat(64),
  OLLAMA_CONFIGURATION_VERSION: "ollama-test.1",
};

Deno.test("credit fallback persists the primary rejection before one admitted Ollama attempt", async () => {
  await withEnvironment(ollamaTestEnvironment, async () => {
    const originalFetch = globalThis.fetch;
    const events: string[] = [];
    const retained: Array<
      Parameters<
        NonNullable<
          Parameters<typeof routeRequest>[0]["attemptLifecycle"]
        >["complete"]
      >[0]
    > = [];
    globalThis.fetch = ((url, init) => {
      const path = new URL(String(url)).pathname;
      events.push(path);
      if (path === "/v1/responses") {
        return Promise.resolve(
          Response.json({ error: { code: "insufficient_quota" } }, {
            status: 429,
          }),
        );
      }
      assertEquals(new Headers(init?.headers).has("Authorization"), false);
      if (path === "/api/tags") {
        return Promise.resolve(
          Response.json({
            models: [{ name: "gpt-oss:20b", digest: "a".repeat(64) }],
          }),
        );
      }
      assertEquals(path, "/api/chat");
      return Promise.resolve(
        Response.json({
          model: "gpt-oss:20b",
          done: true,
          done_reason: "stop",
          message: { role: "assistant", content: '{"decision":"approve"}' },
          prompt_eval_count: 17,
          eval_count: 9,
        }),
      );
    }) as typeof fetch;
    try {
      const result = await routeRequest({
        task: "recommend",
        systemPrompt: "Synthetic classification",
        messages: [{ role: "user", content: "Meeting agenda" }],
        outputSchema: strictSchema,
        attemptLifecycle: {
          prepare(input) {
            events.push(`prepare:${input.localAttemptNumber}`);
            const primary = retained[0]?.attempt;
            return Promise.resolve({
              attemptNumber: input.localAttemptNumber,
              clientRequestId: `synthetic-${input.localAttemptNumber}`,
              ...(primary?.errorCode === "OPENAI_CREDIT_EXHAUSTED"
                ? { execution: input.routeSnapshot.creditFallback }
                : {}),
            });
          },
          complete(input) {
            retained.push(input);
            events.push(`persist:${input.attempt.attemptNumber}`);
            return Promise.resolve();
          },
        },
      });
      assertEquals(events, [
        "prepare:1",
        "/v1/responses",
        "persist:1",
        "prepare:2",
        "/api/tags",
        "/api/chat",
        "/api/tags",
        "persist:2",
      ]);
      assertEquals(result._provider, "ollama");
      assertEquals(result.execution?.model, "gpt-oss:20b");
      assertEquals(result.routeSnapshot.provider, "openai");
      assertEquals(result.inputTokens, 17);
      assertEquals(result.outputTokens, 9);
      assertEquals(retained[0].attempt.errorCode, "OPENAI_CREDIT_EXHAUSTED");
      assertEquals(retained[0].attempt.inputTokens, 0);
      assertEquals(retained[1].attempt.execution, result.execution);
      assertEquals(retained[1].structuredOutput, { decision: "approve" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("fallback cannot dispatch when the primary rejection was not persisted or admission is missing", async () => {
  for (const persistenceFails of [true, false]) {
    await withEnvironment(ollamaTestEnvironment, async () => {
      const originalFetch = globalThis.fetch;
      let dispatches = 0;
      globalThis.fetch = (() => {
        dispatches++;
        return Promise.resolve(
          Response.json({ error: { code: "insufficient_quota" } }, {
            status: 429,
          }),
        );
      }) as typeof fetch;
      try {
        await assertRejects(() =>
          routeRequest({
            task: "recommend",
            systemPrompt: "Synthetic",
            messages: [{ role: "user", content: "Synthetic" }],
            attemptLifecycle: {
              prepare(input) {
                return Promise.resolve({
                  attemptNumber: input.localAttemptNumber,
                  clientRequestId: `synthetic-${input.localAttemptNumber}`,
                });
              },
              complete() {
                return persistenceFails
                  ? Promise.reject(new Error("synthetic persistence failure"))
                  : Promise.resolve();
              },
            },
          })
        );
        assertEquals(dispatches, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

Deno.test("a resumed admitted fallback uses Ollama without an OpenAI key or redispatch", async () => {
  await withEnvironment(
    { ...ollamaTestEnvironment, OPENAI_API_KEY: undefined },
    async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = ((url) => {
        calls++;
        assertEquals(new URL(String(url)).hostname, "127.0.0.1");
        return Promise.resolve(
          String(url).endsWith("/api/tags")
            ? Response.json({
              models: [{ name: "gpt-oss:20b", digest: "a".repeat(64) }],
            })
            : Response.json({
              model: "gpt-oss:20b",
              done: true,
              done_reason: "stop",
              message: { role: "assistant", content: '{"decision":"approve"}' },
              prompt_eval_count: 10,
              eval_count: 5,
            }),
        );
      }) as typeof fetch;
      try {
        const result = await routeRequest({
          task: "recommend",
          systemPrompt: "Synthetic",
          messages: [{ role: "user", content: "Synthetic" }],
          outputSchema: strictSchema,
          attemptLifecycle: {
            prepare(input) {
              return Promise.resolve({
                attemptNumber: 2,
                clientRequestId: "resumed-attempt",
                execution: input.routeSnapshot.creditFallback,
              });
            },
            complete() {
              return Promise.resolve();
            },
          },
        });
        assertEquals(result._provider, "ollama");
        assertEquals(result.attempts[0].attemptNumber, 2);
        assertEquals(calls, 3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

Deno.test("cumulative failure denial stops a new router invocation before provider or capacity work", async () => {
  let reads = 0;
  const admin = { rpc(name: string, args: Record<string, unknown>) {
    assertEquals(name, "read_legacy_model_call_checkpoint");
    assertEquals(args.p_allocate_attempt, false); reads += 1;
    return Promise.resolve({ data: { state: "attempt_limit", provider_permitted: false,
      reason: "operation_failure_budget_exhausted", error_code: "GENERATION_ATTEMPT_LIMIT_REACHED" }, error: null });
  } } as unknown as SupabaseClient;
  const controller = new AbortController();
  bindModelCallContextImpl(controller.signal, { userId: AUDIT_OWNER, generationRequestId: "cumulative-budget", admin,
    checkpoint: { scope: "generate-checklist", originReservationId: AUDIT_ORIGIN, executionClaimToken: AUDIT_CLAIM } });
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => { fetches += 1; return Promise.reject(new Error("Unexpected provider fetch")); };
  try {
    for (let invocation = 0; invocation < 2; invocation += 1) {
      const error = await assertRejects(() => routeRequest({ task: "checklist",
        logicalStageKey: "generate-checklist.primary", systemPrompt: "system",
        messages: [{ role: "user", content: "Synthetic budget test" }], signal: controller.signal }), OpenAIAdapterError);
      assertEquals(error.code, "GENERATION_ATTEMPT_LIMIT_REACHED");
      assertEquals(error.retryable, false);
    }
    assertEquals(reads, 2); assertEquals(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});
