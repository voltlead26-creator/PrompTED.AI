// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix -- match the existing metered provider test seam.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type DocumentPipelineInput, runDocumentPipeline } from "./document-pipeline.ts";
import { createHash } from "node:crypto";
import { bindModelCallContext, setModelCallCheckpointContext } from "./model-call-context.ts";
import { isProviderReconciliationRequired } from "./allowance-reservations.ts";
import type { QualityAuditIssue } from "./document-output-contracts.ts";
import { buildSystemPrompt } from "./prompt-builder.ts";
import { resolveTemplate } from "./template-engine.ts";
import { resolveDocumentProfilePolicy } from "./document-profile-projection.ts";
import { createDocumentPlaceholderToken } from "./document-placeholder-policy.ts";

const originalWording = "I was charged $10 twice.";
const siblingWording = "Please review the duplicate charge.";
const inventedWording =
  "The company admitted criminal fraud and owes me $5,000,000.";
const template = {
  id: "synthetic-final-audit",
  name: "Synthetic wording fixture",
  domain: "synthetic",
  structureType: "compose" as const,
  adviceBoundary: "none" as const,
  sections: [
    { key: "issue", label: "Issue", required: true },
    { key: "request", label: "Request", required: true },
  ],
};

type Options = {
  initial?: string;
  replacement?: string;
  sibling?: string;
  unsupportedText?: string;
  evidenceQuote?: string;
  finalGrounding?:
    | "unsupported"
    | "malformed"
    | "abort"
    | "approve"
    | "unverifiable";
  unverifiableInitial?: boolean;
  finalQuality?: "approve" | "reject" | "malformed" | "uncertain";
  abortOnFinalReceipt?: boolean;
  onProviderRequest?: (schema: string | undefined, body: Record<string, unknown>) => void;
  sectionTokenDemand?: number;
  groundingTokenDemand?: number;
  missingInformation?: Record<string, string[]>;
  auditBindingResponse?: "missing" | "malformed" | "changed";
  deniedRepair?: { stage: string; code: string; message: string };
  qualityIssuesByRound?: QualityAuditIssue[][];
  assessmentPolicy?: {
    version: "legacy-wording-assessment.1";
    executionPolicySha256: string;
  };
};

const textSha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const framedSha256 = (domain: string, count: number, values: string[]) => {
  const hash = createHash("sha256");
  for (const value of [domain, String(count), ...values]) {
    const bytes = new TextEncoder().encode(value);
    hash.update(`${bytes.byteLength}:`).update(bytes);
  }
  return hash.digest("hex");
};
const assessmentPolicy = {
  version: "legacy-wording-assessment.1" as const,
  executionPolicySha256: "d".repeat(64),
};

async function withPipeline(
  options: Options,
  check: (fixture: {
    run: () => ReturnType<typeof runDocumentPipeline>;
    cancel: () => void;
    input: DocumentPipelineInput;
    prompts: string[];
    groundingDrafts: string[];
    qualityDrafts: string[];
    stages: string[];
    writes: string[];
    persistedCalls: Array<{ arguments: Record<string, unknown>; receipt: Record<string, unknown> }>;
    auditedReads: Array<Record<string, unknown>>;
  }) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const environment = {
    OPENAI_API_KEY: "synthetic-test-key",
    PROMPTED_DEPLOYMENT_ENV: "test",
  };
  const previous = new Map(
    Object.keys(environment).map((name) => [name, Deno.env.get(name)]),
  );
  const controller = new AbortController();
  const stages: string[] = [];
  const groundingDrafts: string[] = [];
  const qualityDrafts: string[] = [];
  const writes: string[] = [];
  const prompts: string[] = [];
  const persistedCalls: Array<{ arguments: Record<string, unknown>; receipt: Record<string, unknown> }> = [];
  const auditedReads: Array<Record<string, unknown>> = [];
  const admissions = new Map<string, string>();
  const admittedReviewSchemas = new Map<string, Array<Record<string, unknown>>>();
  let issueWrites = 0;
  let responses = 0;
  bindModelCallContext(controller.signal, {
    userId: "33333333-3333-4333-8333-333333333333",
    generationRequestId: "synthetic-final-audit-request",
    admin: {
      rpc(name: string, args: Record<string, unknown>) {
        let data: Record<string, unknown>;
        switch (name) {
          case "read_legacy_model_call_checkpoint":
          case "read_legacy_document_audit_checkpoint_v1": {
            assert(options.assessmentPolicy, "Only the checkpoint fixture may read durable attempts");
            assertEquals(args.p_user_id, "33333333-3333-4333-8333-333333333333");
            assertEquals(args.p_checkpoint_scope, "generate-document");
            assertEquals(args.p_origin_reservation_id, "55555555-5555-4555-8555-555555555555");
            assertEquals(args.p_logical_request_id, "synthetic-final-audit-request");
            if (args.p_allocate_attempt === false) {
              data = { state: "not_found", provider_permitted: false };
            } else {
              assertEquals(args.p_allocate_attempt, true);
              const admissionId = crypto.randomUUID();
              admissions.set(String(args.p_logical_stage_key), admissionId);
              data = { state: "prepared", provider_permitted: true, attempt_number: 1,
                attempt_admission_id: admissionId, execution_claim_token: args.p_execution_claim_token };
            }
            if (name === "read_legacy_document_audit_checkpoint_v1") {
              auditedReads.push(structuredClone(args));
              const prepared = args.p_allocate_attempt === true;
              const binding = prepared ? structuredClone(args.p_audit_binding) : null;
              if (prepared) {
                assert(binding && typeof binding === "object");
                const schema = String(Reflect.get(binding, "output_schema_name"));
                const pending = admittedReviewSchemas.get(schema) ?? [];
                pending.push(structuredClone(args));
                admittedReviewSchemas.set(schema, pending);
              }
              data = {
                contract_version: "legacy-document-audit-checkpoint.1",
                checkpoint: data,
                audit_binding: binding,
                audit_binding_sha256: prepared
                  ? textSha256(`synthetic-db-audit-binding:${args.p_logical_stage_key}`) : null,
              };
              if (prepared && options.auditBindingResponse === "missing") data.audit_binding_sha256 = null;
              if (prepared && options.auditBindingResponse === "malformed") data.audit_binding_sha256 = "not-a-digest";
              if (prepared && options.auditBindingResponse === "changed") {
                assert(binding && typeof binding === "object");
                Reflect.set(binding, "target_sha256", "f".repeat(64));
              }
            }
            break;
          }
          case "mark_legacy_model_attempt_dispatched":
            assertEquals(args.p_attempt_admission_id, admissions.get(String(args.p_logical_stage_key)));
            if (options.deniedRepair && args.p_logical_stage_key === options.deniedRepair.stage) {
              return Promise.resolve({ data: null, error: {
                code: options.deniedRepair.code, message: options.deniedRepair.message,
              } });
            }
            data = { state: "dispatched", attempt_admission_id: args.p_attempt_admission_id,
              provider_attempt_id: args.p_attempt_admission_id };
            break;
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
              dispatched_at: "2026-09-01T00:00:00.000Z",
            };
            break;
          case "release_openai_capacity_lease":
            data = {
              outcome: "released",
              capacity_lease_id: args.p_capacity_lease_id,
              terminal_outcome: args.p_terminal_outcome,
            };
            break;
          case "claim_user_external_egress":
            data = {
              outcome: "accepted",
              egress_permitted: true,
              dispatch_token: args.p_dispatch_token,
            };
            break;
          case "complete_user_external_egress":
            data = { outcome: "completed" };
            break;
          case "record_legacy_model_call_attempt":
            stages.push(String(args.p_logical_stage_key));
            if (
              options.abortOnFinalReceipt &&
              args.p_logical_stage_key === "generate-document.quality:round-3"
            ) {
              controller.abort();
            }
            data = {
              usage_ledger_id: crypto.randomUUID(),
              model_call_key: textSha256(`${args.p_logical_stage_key}|${args.p_request_sha256}|${args.p_provider_attempt_id}`),
              idempotent_replay: false,
              result_id: args.p_result_envelope ? crypto.randomUUID() : null,
              // Opaque synthetic database receipt, not a JavaScript recreation
              // of the PostgreSQL JSONB serialization/hash algorithm.
              result_response_sha256: args.p_result_envelope
                ? textSha256(`synthetic-database-result:${args.p_logical_stage_key}:${args.p_request_sha256}`) : null,
              result_idempotent_replay: args.p_result_envelope ? false : null,
            };
            persistedCalls.push({ arguments: structuredClone(args), receipt: structuredClone(data) });
            break;
          default:
            throw new Error("Unexpected synthetic RPC: " + name);
        }
        return Promise.resolve({ data, error: null });
      },
    } as unknown as SupabaseClient,
  });

  if (options.assessmentPolicy) {
    setModelCallCheckpointContext(controller.signal, {
      scope: "generate-document",
      originReservationId: "55555555-5555-4555-8555-555555555555",
      executionClaimToken: "66666666-6666-4666-8666-666666666666",
    });
  }

  // Exercise the production pipeline, strict contracts, router and accounting
  // calls; only HTTP and database transport are controlled. No network permission.
  globalThis.fetch = ((url, init) => {
    assertEquals(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    assertEquals(body.store, false);
    const prompt = body.input.map((message: { content: string }) =>
      message.content
    ).join("\n");
    const schema = body.text?.format?.name;
    prompts.push(prompt);
    if (options.assessmentPolicy && (schema === "prompted_document_quality_audit" ||
      schema === "prompted_document_grounding_audit")) {
      const admission = admittedReviewSchemas.get(schema)?.shift();
      assert(admission, "Reviewer dispatch must follow its actual audited preparation");
      const binding = admission.p_audit_binding as Record<string, unknown>;
      const rows = (schema === "prompted_document_quality_audit" ? binding.sections : binding.units) as
        Array<Record<string, unknown>>;
      const expectedRoster = rows.map((row) => schema === "prompted_document_quality_audit" ? row.key : row.id);
      const itemSchema = schema === "prompted_document_quality_audit"
        ? body.text.format.schema.properties.issues.items.properties.section_key.anyOf[0]
        : body.text.format.schema.properties.units.items.properties.unit_id;
      assertEquals(itemSchema.enum, expectedRoster);
    }
    options.onProviderRequest?.(schema, body);
    const tokenDemand = schema === undefined ? options.sectionTokenDemand
      : schema === "prompted_document_grounding_audit" ? options.groundingTokenDemand : undefined;
    if (tokenDemand && body.max_output_tokens < tokenDemand) {
      return Promise.resolve(Response.json({
        id: "resp_synthetic_incomplete_" + ++responses,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: "Partial checklist; remaining actions were not generated",
        usage: { input_tokens: 20, output_tokens: body.max_output_tokens },
      }));
    }
    let output: unknown;
    switch (schema) {
      case "prompted_document_intent_brief":
        output = {
          user_goal: "Resolve a duplicate charge.",
          primary_outcome: "Request a review.",
          audience: "Customer service",
          author_perspective: "Customer",
          tone: ["professional"],
          required_content: ["Issue", "Request"],
          prohibited_content: ["Unsupported allegations"],
          known_facts: [originalWording],
          safe_assumptions: [],
          missing_critical_information: [],
          section_readiness: input.template.sections.map(({ key }) => ({
            key,
            ready: !options.missingInformation?.[key]?.length,
            missing_information: options.missingInformation?.[key] ?? [],
            missing_information_keys: options.missingInformation?.[key] ?? [],
          })),
          confidence: 1,
        };
        break;
      case "prompted_document_section_plan":
        output = {
          section_context: input.template.sections.map(({ key, label }) => ({
            key,
            relevant_content: originalWording,
            display_label: label,
          })),
        };
        break;
      case "prompted_document_grounding_audit": {
        groundingDrafts.push(prompt.split("DRAFT UNITS:\n")[1]);
        const isFinal = groundingDrafts.length > 1;
        if (isFinal && options.finalGrounding === "abort") {
          controller.abort();
          return Promise.reject(new DOMException("Cancelled", "AbortError"));
        }
        if (isFinal && options.finalGrounding === "malformed") {
          output = { units: [] };
          break;
        }
        const units = groundingDrafts.at(-1)!.split("\n");
        output = {
          units: units.map((unit) => {
            const id = unit.slice(0, unit.indexOf(": "));
            const text = unit.slice(unit.indexOf(": ") + 2);
            const unsupported = (isFinal && id.startsWith("issue#") &&
              options.finalGrounding === "unsupported") ||
              Boolean(options.unsupportedText && text.includes(options.unsupportedText));
            return {
              unit_id: id,
              classification: unsupported
                ? "unsupported"
                : id.startsWith("request#") ||
                    options.finalGrounding === "approve"
                ? "convention"
                : "supported",
              evidence_quotes: unsupported || id.startsWith("request#") ||
                  options.finalGrounding === "approve"
                ? []
                : (isFinal && options.finalGrounding === "unverifiable") ||
                    options.unverifiableInitial
                ? ["This quotation was never supplied by the user."]
                : [options.evidenceQuote ?? originalWording],
              unsupported_fragments: unsupported ? [text] : [],
            };
          }),
        };
        break;
      }
      case "prompted_document_quality_audit":
        qualityDrafts.push(prompt.split("Complete draft:\n")[1]);
        if (options.qualityIssuesByRound) {
          const issues = options.qualityIssuesByRound[qualityDrafts.length - 1] ?? [];
          output = { decision: issues.length ? "changes_required" : "approve",
            issues: issues.map((issue) => ({ ...issue, section_key: issue.section_key ?? null })) };
          break;
        }
        if (qualityDrafts.length > 1 && options.finalQuality === "uncertain") {
          return Promise.reject(
            new TypeError("Synthetic provider connection lost"),
          );
        }
        if (qualityDrafts.length > 1 && options.finalQuality === "malformed") {
          output = { decision: "approve", issues: "not an issue array" };
          break;
        }
        output = qualityDrafts.length > 1 && options.finalQuality === "reject"
          ? {
            decision: "changes_required",
            issues: [{
              severity: "high",
              category: "instruction_leakage",
              section_key: "issue",
              finding: "Replacement is a writing instruction.",
              required_correction: "Return final wording.",
            }],
          }
          : { decision: "approve", issues: [] };
        break;
      case undefined: {
        const isIssue = prompt.includes('section titled "Issue"');
        assert(isIssue || prompt.includes('section titled "Request"'));
        output = isIssue
          ? ++issueWrites === 1
            ? options.initial ?? originalWording + " TODO"
            : options.replacement ?? inventedWording
          : options.sibling ?? siblingWording;
        writes.push(String(output));
        break;
      }
      default:
        throw new Error("Unexpected synthetic schema: " + schema);
    }
    return Promise.resolve(Response.json({
      id: "resp_synthetic_final_audit_" + ++responses,
      status: "completed",
      output_text: typeof output === "string" ? output : JSON.stringify(output),
      usage: { input_tokens: 20, output_tokens: 10 },
    }));
  }) as typeof fetch;
  for (const [name, value] of Object.entries(environment)) {
    Deno.env.set(name, value);
  }
  const input: DocumentPipelineInput = {
    template: structuredClone(template),
    situation: originalWording,
    conversationContext: "",
    uploadContext: "",
    extractedText: "",
    memoryContext: "",
    systemPrompt: "Write only from the synthetic confirmed facts.",
    signal: controller.signal,
    ...(options.assessmentPolicy ? { assessmentPolicy: options.assessmentPolicy } : {}),
  };
  try {
    await check({
      run: () => runDocumentPipeline(input),
      cancel: () => controller.abort(),
      input,
      prompts,
      groundingDrafts,
      qualityDrafts,
      stages,
      writes,
      persistedCalls,
      auditedReads,
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("final rewrite rejects invented material claims while preserving the supported sibling", async () => {
  await withPipeline({ finalGrounding: "unsupported" }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections[1].content, siblingWording);
    assert(
      !result.sections[0].content.includes("$5,000,000"),
      "An unaudited final rewrite must never become accepted document wording.",
    );
    assertEquals(result.unresolvedPlaceholders.map((item) => item.sectionKey), [
      "issue",
    ]);
    assert(fixture.groundingDrafts.at(-1)!.includes(inventedWording));
    assert(fixture.qualityDrafts.at(-1)!.includes(inventedWording));
    assertEquals(fixture.writes.length, 3);
    assertEquals(
      fixture.stages.filter((stage) =>
        stage === "generate-document.grounding:round-3"
      ).length,
      1,
    );
    assertEquals(
      fixture.stages.filter((stage) =>
        stage === "generate-document.quality:round-3"
      ).length,
      1,
    );
  });
});

Deno.test("supported final rewrite is returned exactly as audited without another writer call", async () => {
  await withPipeline({ replacement: originalWording }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections.map(({ content }) => content), [
      originalWording,
      siblingWording,
    ]);
    assertEquals(result.unresolvedPlaceholders, []);
    assertEquals(fixture.groundingDrafts.length, 2);
    assertEquals(JSON.parse(fixture.qualityDrafts.at(-1)!), result.sections);
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("checklist sections have bounded room for reasoning and complete action wording", async () => {
  await withPipeline({ initial: originalWording, sectionTokenDemand: 3200 }, async (fixture) => {
    fixture.input.template.structureType = "checklist";
    fixture.input.template.sections.splice(1);
    const result = await fixture.run();
    assertEquals(result.sections.map(section => section.content), [originalWording]);
    assertEquals(result.unresolvedPlaceholders, []);
    assertEquals(fixture.writes.length, 1);
  });
});

Deno.test("checklist output exceeding its finite budget still fails before audit or success", async () => {
  await withPipeline({ initial: originalWording, sectionTokenDemand: 5000 }, async (fixture) => {
    fixture.input.template.structureType = "checklist";
    fixture.input.template.sections.splice(1);
    await assertRejects(fixture.run, Error, "OPENAI_INCOMPLETE_RESPONSE");
    assertEquals(fixture.qualityDrafts.length, 0);
    assertEquals(fixture.groundingDrafts.length, 0);
  });
});

Deno.test("writer requests the plain text format consumed by preview and export", async () => {
  const writers: Record<string, unknown>[] = [];
  await withPipeline({ initial: originalWording + " TODO", replacement: originalWording,
    onProviderRequest: (schema, body) => {
    if (schema !== undefined) return;
    writers.push(structuredClone(body));
  } }, async (fixture) => {
    fixture.input.systemPrompt = buildSystemPrompt({ task: "document", domain: "personal" });
    await fixture.run();
    assertEquals(writers.length, 3, "Initial sections and the cleanup repair use the same format");
    for (const body of writers) {
      assertEquals(body.max_output_tokens, 2600, "Non-checklist sections retain their existing budget");
      assert(/plain text/i.test(String(body.instructions)),
        "The provider must receive the actual consumer format");
      assert(!/Return (?:only ready-to-use|clean, export-ready) markdown/i.test(JSON.stringify(body)),
        "A writer instruction must not contradict the profile and plain-text renderer");
    }
  });
});

Deno.test("writer and quality review preserve source authority over model-derived instructions", async () => {
  const requests: Array<{ schema: string | undefined; body: Record<string, unknown> }> = [];
  await withPipeline({ onProviderRequest: (schema, body) => {
    if (schema === undefined || schema === "prompted_document_quality_audit") {
      requests.push({ schema, body: structuredClone(body) });
    }
  } }, async (fixture) => {
    await fixture.run();
    assert(requests.some(request => request.schema === "prompted_document_quality_audit"));
    assert(requests.some(request => request.schema === undefined));
    for (const { body } of requests) {
      const prompt = JSON.stringify(body);
      assert(!/approved outcome brief/i.test(prompt),
        "A generated brief has no user approval and cannot supply missing facts or intent");
      assert(/model-derived planning brief/i.test(prompt));
      assert(/unknown ownership does not mean unassigned/i.test(prompt),
        "Writer and reviewer must not convert an unknown owner into a factual assignment state");
    }
  });
});

Deno.test("missing declared tokens are repaired before the final integrity boundary", async () => {
  const resume = resolveTemplate("resume")!;
  const profile = resolveDocumentProfilePolicy(resume)!.profile;
  assert(profile?.informationContract);
  const item = profile.informationContract!.sections.find(section => section.sectionKey === "experience")!
    .requiredInformation.find(item => item.key === "employment_dates")!;
  const token = createDocumentPlaceholderToken("resume.experience.employment_dates", item.placeholderLabel);
  await withPipeline({ initial: originalWording, replacement: originalWording + "\n" + token,
    finalGrounding: "approve", missingInformation: { experience: [item.key] } }, async fixture => {
    fixture.input.resolvedProfile = profile;
    fixture.input.template.sections[0].key = "experience";
    const result = await fixture.run();
    assertEquals(result.sections[0].content, originalWording + "\n" + token);
    assertEquals(result.unresolvedPlaceholders.map(item => item.id), ["resume.experience.employment_dates"]);
    assertEquals(fixture.writes.filter(text => text === siblingWording).length, 1,
      "A missing marker must not regenerate the passing sibling");
    assertEquals(fixture.groundingDrafts.length, 2, "The replacement must receive a fresh factual audit");
  });
});

Deno.test("unrepaired missing tokens isolate the section and retain exact audit evidence", async () => {
  const profile = resolveDocumentProfilePolicy(resolveTemplate("resume")!)!.profile;
  assert(profile?.informationContract);
  await withPipeline({ initial: originalWording, replacement: originalWording,
    finalGrounding: "approve", assessmentPolicy,
    missingInformation: { experience: ["employment_dates"] } }, async fixture => {
    fixture.input.resolvedProfile = profile;
    fixture.input.template.sections[0].key = "experience";
    const result = await fixture.run();
    assertEquals(result.sections[1].content, siblingWording);
    assertEquals(result.unresolvedPlaceholders.map(item => item.id), ["resume.experience.section_content"]);
    assert(result.sections[0].content.includes("resume.experience.section_content"));
    assert(result.wordingAssessment?.review.quality.deterministicIssues.some(issue =>
      issue.section_key === "experience" && issue.finding.includes("employment_dates")));
    assertEquals(result.wordingAssessment?.sections[0].requiredFacts, "blocked");
    assertEquals(result.wordingAssessment?.sections[1].disposition, "assessed_generated");
  });
});

Deno.test("invented placeholder identities cannot escape the declared resolution roster", async () => {
  const profile = resolveDocumentProfilePolicy(resolveTemplate("resume")!)!.profile;
  assert(profile?.informationContract);
  const item = profile.informationContract.sections.find(section => section.sectionKey === "experience")!
    .requiredInformation.find(item => item.key === "employment_dates")!;
  const token = createDocumentPlaceholderToken("resume.experience.employment_dates", item.placeholderLabel);
  const valid = originalWording + "\n" + token;
  const invented = "{{TED_PLACEHOLDER:resume.experience.earlier.role_title:earlier role title}}";
  await withPipeline({ initial: valid + "\n" + invented, replacement: valid,
    finalGrounding: "approve", missingInformation: { experience: [item.key] } }, async fixture => {
    fixture.input.resolvedProfile = profile;
    fixture.input.template.sections[0].key = "experience";
    const result = await fixture.run();
    assertEquals(result.sections[0].content, valid);
    assertEquals(result.unresolvedPlaceholders.length, 1);
    assertEquals(fixture.groundingDrafts.length, 2);
  });
});

Deno.test("both reviewers receive only the resolved section's exact neutral fallback", async () => {
  const profile = resolveDocumentProfilePolicy(resolveTemplate("resume")!)!.profile;
  assert(profile?.informationContract);
  const expected = profile.informationContract.sections.find(section => section.sectionKey === "referees")!
    .requiredInformation.find(item => item.automaticFallback)!;
  const contracts: Array<Record<string, unknown>> = [];
  await withPipeline({ initial: originalWording, onProviderRequest: (schema, body) => {
    if (schema !== "prompted_document_grounding_audit" && schema !== "prompted_document_quality_audit") return;
    const contract = String(body.instructions).split("APPLICATION RESOLUTION CONTRACT — supplied by the resolved template, not user facts:\n")[1];
    assert(contract, "Factual and quality review need the same canonical missing-fact policy");
    contracts.push(JSON.parse(contract.split("\n")[0]));
    assert(contract.includes("It is not evidence for any added claim"));
  } }, async fixture => {
    fixture.input.resolvedProfile = profile;
    fixture.input.template.sections[1].key = "referees";
    await fixture.run();
    assertEquals(contracts.length, 2);
    for (const contract of contracts) {
      assertEquals(contract.automatic_fallbacks, [{ section_key: "referees",
        information_key: expected.key, text: expected.automaticFallback!.trim() }]);
      assertEquals(contract.declared_tokens, []);
    }
  });
});

Deno.test("factual review can return the complete roster for a longer document", async () => {
  const initial = Array.from({ length: 100 }, () => originalWording).join("\n");
  await withPipeline({ initial, groundingTokenDemand: 6000 }, async (fixture) => {
    fixture.input.template.sections.splice(1);
    const result = await fixture.run();
    assertEquals(result.sections[0].content, initial);
    assertEquals(result.unresolvedPlaceholders, []);
    assertEquals(fixture.groundingDrafts[0].split("\n").length, 100,
      "Every factual unit must still be reviewed; do not truncate the roster to fit the budget");
  });
});

Deno.test("oversized factual review remains a failure instead of partial approval", async () => {
  const initial = Array.from({ length: 400 }, () => originalWording).join("\n");
  await withPipeline({ initial, groundingTokenDemand: 20000 }, async (fixture) => {
    fixture.input.template.sections.splice(1);
    await assertRejects(fixture.run, Error, "OPENAI_INCOMPLETE_RESPONSE");
    assertEquals(fixture.writes.length, 1, "Incomplete review does not authorise a rewrite");
  });
});

Deno.test("unchanged audited wording does not dispatch another audit or repair", async () => {
  await withPipeline({ initial: originalWording }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections[0].content, originalWording);
    assertEquals(fixture.groundingDrafts.length, 1);
    assertEquals(fixture.qualityDrafts.length, 1);
    assertEquals(fixture.writes.length, 2);
  });
});

Deno.test("regression: later document-level review preserves the factual repair and passing sibling", async () => {
  await withPipeline({ initial: inventedWording, replacement: originalWording,
    unsupportedText: inventedWording,
    qualityIssuesByRound: [[], [{ severity: "high", category: "structure",
      finding: "Check the complete document section order.",
      required_correction: "Use the admitted order without changing factual wording." }], []],
  }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections.map((section) => section.content), [originalWording, siblingWording]);
    assertEquals(result.unresolvedPlaceholders, []);
    assertEquals(fixture.writes.length, 3,
      "Only the initial two sections and the named factual correction may reach a writer");
    assertEquals(fixture.groundingDrafts.length, 3,
      "Document-level findings still require a fresh audit, not silent approval");
    const repairPrompt = fixture.prompts.filter((prompt) => prompt.includes('section titled "Issue"')).at(-1)!;
    assert(repairPrompt.includes(JSON.stringify({ key: "issue", label: "Issue", content: inventedWording })),
      "The named repair needs its exact prior draft as reference, separate from source evidence");
  });
});

Deno.test("factual repair receives the exact rejected clause, not only generic correction wording", async () => {
  const unsupported = "Status: Not started.";
  await withPipeline({ initial: `${originalWording} ${unsupported}`,
    replacement: originalWording, unsupportedText: unsupported,
  }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections.map(section => section.content), [originalWording, siblingWording]);
    const repair = fixture.prompts.filter(prompt => prompt.includes('section titled "Issue"')).at(-1)!;
    const corrections = repair.split("Required audit corrections:\n")[1]?.split("\n\n")[0] ?? "";
    assert(corrections.includes("Source grounding failed for: Status: Not started."),
      "The writer must receive the finding that identifies the rejected factual clause");
    assert(corrections.includes("Remove only the unsupported factual clause"));
    assertEquals(fixture.writes.length, 3, "The passing sibling is not rewritten");
  });
});

Deno.test("regression: final cleanup receives the current section wording as reference", async () => {
  const initial = originalWording + " TODO";
  await withPipeline({ initial, replacement: originalWording }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections[0].content, originalWording);
    const repairPrompt = fixture.prompts.filter((prompt) => prompt.includes('section titled "Issue"')).at(-1)!;
    assert(repairPrompt.includes(JSON.stringify({ key: "issue", label: "Issue", content: initial })),
      "Cleanup must preserve the current section baseline while removing the flagged content");
  });
});

Deno.test("unresolved document-level factual review retains the existing explicit safety fallback", async () => {
  const issue: QualityAuditIssue = { severity: "high", category: "fact",
    finding: "The complete document contains unsupported assertions.",
    required_correction: "Remove unsupported assertions." };
  await withPipeline({ initial: originalWording, replacement: originalWording,
    qualityIssuesByRound: [[issue], [issue], [issue]],
  }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.unresolvedPlaceholders.map((placeholder) => placeholder.sectionKey),
      ["issue", "request"]);
    assert(result.sections.every((section) => section.content.includes("TED_PLACEHOLDER")),
      "A factual safety failure must never be silently approved");
    assertEquals(fixture.writes.length, 2,
      "An unresolved whole-document finding cannot consume section repair attempts");
    assertEquals(fixture.qualityDrafts.length, 3);
    assertEquals(fixture.groundingDrafts.length, 3);
    for (const draft of fixture.qualityDrafts) {
      assertEquals(JSON.parse(draft).map((section: { content: string }) => section.content),
        [originalWording, siblingWording]);
    }
  });
});

Deno.test("bounded editorial review preserves source-supported wording and admitted order", async () => {
  const issue: QualityAuditIssue = { severity: "high", category: "structure",
    finding: "Prefer another conventional section order.",
    required_correction: "Consider a different order." };
  await withPipeline({ initial: originalWording, replacement: originalWording,
    qualityIssuesByRound: [[issue], [issue], [issue]],
  }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections.map((section) => section.key), ["issue", "request"]);
    assertEquals(result.sections.map((section) => section.content), [originalWording, siblingWording]);
    assertEquals(fixture.writes.length, 2);
    assertEquals(fixture.qualityDrafts.length, 3);
    assertEquals(result.unresolvedPlaceholders, []);
  });
});

Deno.test("durable repair denial isolates only the affected section and retains the final audit", async () => {
  await withPipeline({ initial: inventedWording, replacement: inventedWording,
    unsupportedText: inventedWording, assessmentPolicy,
    deniedRepair: { stage: "generate-document.section:issue:repair-2",
      code: "PGB02", message: "GENERATION_REPAIR_LIMIT_REACHED" },
  }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections[1].content, siblingWording);
    assert(!result.sections[0].content.includes(inventedWording));
    assertEquals(result.unresolvedPlaceholders.map(item => item.sectionKey), ["issue"]);
    assertEquals(fixture.writes.length, 3, "Two initial sections and only one issue repair may reach the provider");
    assertEquals(JSON.parse(fixture.qualityDrafts.at(-1)!), result.sections);
    const denied = fixture.persistedCalls.filter(call =>
      call.arguments.p_logical_stage_key === "generate-document.section:issue:repair-2");
    assertEquals(denied.length, 1);
    assertEquals(denied[0].arguments.p_provider_status, "rejected_before_provider");
    assertEquals(denied[0].arguments.p_error_code, "GENERATION_REPAIR_LIMIT_REACHED");
    assertEquals(denied[0].arguments.p_input_tokens, 0);
    assertEquals(denied[0].arguments.p_output_tokens, 0);
  });
});

Deno.test("an ambiguous repair dispatch is never downgraded to a needs-input section", async () => {
  await withPipeline({ initial: inventedWording, replacement: inventedWording,
    unsupportedText: inventedWording, assessmentPolicy,
    deniedRepair: { stage: "generate-document.section:issue:repair-2",
      code: "P0001", message: "GENERATION_REPAIR_LIMIT_REACHED" },
  }, async (fixture) => {
    const error = await assertRejects(fixture.run);
    assert(isProviderReconciliationRequired(error));
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("checkpoint-enabled pipeline fixture records routed audit envelopes before assessment assertions", async () => {
  await withPipeline({ initial: originalWording, assessmentPolicy }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(result.sections.map((section) => section.content), [originalWording, siblingWording]);
    const audits = fixture.persistedCalls.filter((call) =>
      /^generate-document\.(quality|grounding):round-0$/.test(String(call.arguments.p_logical_stage_key)));
    assertEquals(audits.length, 2);
    for (const call of audits) {
      assertEquals(call.arguments.p_attempt_status, "succeeded");
      assertEquals(call.arguments.p_checkpoint_scope, "generate-document");
      assert(call.arguments.p_result_envelope, "The fixture must actually record a completed provider envelope");
      assertEquals(call.receipt.model_call_key, textSha256(
        `${call.arguments.p_logical_stage_key}|${call.arguments.p_request_sha256}|${call.arguments.p_provider_attempt_id}`));
    }
  });
});

for (const finalCleanup of [false, true]) {
  Deno.test(`paired audits bind their actual inputs before dispatch${finalCleanup ? " including final cleanup" : ""}`, async () => {
    await withPipeline({
      initial: finalCleanup ? originalWording + " TODO" : originalWording,
      replacement: originalWording,
      assessmentPolicy,
    }, async (fixture) => {
      const result = await fixture.run();
      const prepared = fixture.auditedReads.filter((call) => call.p_allocate_attempt === true);
      const expectedRounds = finalCleanup ? [0, 3] : [0];
      assertEquals(prepared.length, expectedRounds.length * 2,
        "Every actual reviewer must accept its exact audit binding before provider dispatch");
      for (const [index, round] of expectedRounds.entries()) {
        const target = JSON.parse(fixture.qualityDrafts[index]) as Array<{ key: string; label: string; content: string }>;
        const units = fixture.groundingDrafts[index].split("\n").map((line) => {
          const boundary = line.indexOf(": ");
          const id = line.slice(0, boundary);
          return { id, section_key: id.slice(0, id.lastIndexOf("#")),
            content_sha256: textSha256(line.slice(boundary + 2)) };
        });
        for (const kind of ["quality", "grounding"]) {
          const stage = `generate-document.${kind}:round-${round}`;
          const call = prepared.find((entry) => entry.p_logical_stage_key === stage);
          assert(call, `Missing pre-dispatch binding for ${stage}`);
          assertEquals(call.p_source_snapshot, [originalWording, "", "", "", ""]);
          assertEquals(call.p_audit_binding, {
            version: "legacy-document-audit-binding.1",
            digest_version: "legacy-document-audit-digests.1",
            validator_version: "legacy-wording-assessment.1",
            unit_policy_version: "legacy-factual-units.2",
            review_kind: kind, round,
            output_schema_name: `prompted_document_${kind}_audit`,
            output_schema_version: `document-${kind}-audit.1`,
            evidence_mode: "verbatim",
            source_sha256: framedSha256("legacy-audit-source.1", 5, [originalWording, "", "", "", ""]),
            execution_policy_version: "legacy-template-policy.1",
            execution_policy_sha256: assessmentPolicy.executionPolicySha256,
            target_sha256: framedSha256("legacy-audit-target.1", target.length,
              target.flatMap((section) => [section.key, section.label, section.content])),
            sections: target.map((section) => ({ key: section.key, label: section.label,
              content_sha256: textSha256(section.content) })),
            units,
          });
        }
      }
      const assessment = requiredWordingAssessment(result);
      const review = assessment.review as Record<string, unknown>;
      const finalRound = expectedRounds.at(-1)!;
      for (const kind of ["quality", "grounding"]) {
        const evidence = review[kind] as Record<string, unknown>;
        const receipt = evidence.receipt as Record<string, unknown>;
        const stage = `generate-document.${kind}:round-${finalRound}`;
        assertEquals(evidence.binding, prepared.find((entry) => entry.p_logical_stage_key === stage)!.p_audit_binding);
        assertEquals(receipt.legacyAuditBindingSha256, textSha256(`synthetic-db-audit-binding:${stage}`));
      }
    });
  });
}

for (const auditBindingResponse of ["missing", "malformed", "changed"] as const) {
  Deno.test(`pipeline refuses ${auditBindingResponse} admitted review binding before reviewer dispatch`, async () => {
    await withPipeline({ initial: originalWording, assessmentPolicy, auditBindingResponse }, async (fixture) => {
      const failure = await assertRejects(fixture.run);
      assert(failure instanceof Error && /AUDIT_(CHECKPOINT|RECEIPT)/.test(failure.message));
      assertEquals(fixture.qualityDrafts.length, 0);
      assertEquals(fixture.groundingDrafts.length, 0);
    });
  });
}

Deno.test("cancellation during audit commitments prevents both reviewer admissions", async () => {
  const nativeDigest = crypto.subtle.digest;
  let cancelledAtTarget = false;
  try {
    await withPipeline({ initial: originalWording, assessmentPolicy }, async (fixture) => {
      crypto.subtle.digest = async function(algorithm, data) {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
        const result = await nativeDigest.call(this, algorithm, data);
        if (new TextDecoder().decode(bytes).includes("legacy-audit-target.1")) {
          cancelledAtTarget = true;
          fixture.cancel();
        }
        return result;
      };
      await assertRejects(fixture.run, DOMException, "aborted");
      assert(cancelledAtTarget);
      assert(fixture.writes.length > 0, "The real writer path must reach the audit boundary");
      assertEquals(fixture.auditedReads, []);
      assertEquals(fixture.qualityDrafts, []);
      assertEquals(fixture.groundingDrafts, []);
    });
  } finally {
    crypto.subtle.digest = nativeDigest;
  }
});

Deno.test("an oversized factual roster fails before either paired reviewer starts", async () => {
  await withPipeline({ initial: Array(513).fill(originalWording).join(" "), assessmentPolicy }, async (fixture) => {
    await assertRejects(fixture.run, Error, "DOCUMENT_AUDIT_BINDING_INVALID");
    assert(fixture.writes.length > 0);
    assertEquals(fixture.auditedReads, []);
    assertEquals(fixture.qualityDrafts, []);
    assertEquals(fixture.groundingDrafts, []);
  });
});

Deno.test("source budget fails before the pipeline spends any provider attempt", async () => {
  await withPipeline({ initial: originalWording, assessmentPolicy }, async (fixture) => {
    fixture.input.situation = "😀".repeat(262_145);
    await assertRejects(fixture.run, Error, "DOCUMENT_AUDIT_SOURCE_INVALID");
    assertEquals(fixture.prompts, []);
    assertEquals(fixture.persistedCalls, []);
    assertEquals(fixture.auditedReads, []);
  });
});

function requiredWordingAssessment(result: unknown): Record<string, unknown> {
  assert(result && typeof result === "object");
  const assessment: unknown = Reflect.get(result, "wordingAssessment");
  assert(assessment && typeof assessment === "object" && !Array.isArray(assessment),
    "The exact final wording needs an explicit assessment, not discarded audit success");
  return assessment as Record<string, unknown>;
}

for (const [label, options, expectedRound] of [
  ["unchanged reviewed wording", { initial: originalWording }, 0],
  ["the exact final cleanup replacement", { replacement: originalWording }, 3],
] as const) {
  Deno.test(`durable wording assessment binds ${label} to both actual final audit receipts`, async () => {
    await withPipeline({ ...options, assessmentPolicy }, async (fixture) => {
      const result = await fixture.run();
      const assessment = requiredWordingAssessment(result);
      assertEquals(assessment.contractVersion, assessmentPolicy.version);
      assertEquals(assessment.executionPolicySha256, assessmentPolicy.executionPolicySha256);
      assertEquals(assessment.digestContractVersion, "legacy-document-audit-digests.1");
      assertEquals(assessment.sourceSha256, framedSha256("legacy-audit-source.1", 5,
        [originalWording, "", "", "", ""]));
      const review = assessment.review as Record<string, unknown>;
      assert(review && typeof review === "object");
      assertEquals(review.round, expectedRound);
      assertEquals(assessment.compositionMatchesReview, true);
      assertEquals(assessment.finalTargetSha256, review.targetSha256);
      const reviewedSections = JSON.parse(fixture.qualityDrafts.at(-1)!) as
        Array<{ key: string; label: string; content: string }>;
      assertEquals(review.targetSha256, framedSha256("legacy-audit-target.1", reviewedSections.length,
        reviewedSections.flatMap((section) => [section.key, section.label, section.content])));
      for (const kind of ["quality", "grounding"]) {
        const recorded = fixture.persistedCalls.filter((call) =>
          call.arguments.p_logical_stage_key === `generate-document.${kind}:round-${expectedRound}`);
        assertEquals(recorded.length, 1);
        const evidence = review[kind] as Record<string, unknown>;
        const receipt = evidence?.receipt as Record<string, unknown>;
        assert(receipt && typeof receipt === "object");
        assertEquals(receipt.kind, "checkpoint");
        assertEquals(receipt.usageLedgerId, recorded[0].receipt.usage_ledger_id);
        assertEquals(receipt.modelCallKey, recorded[0].receipt.model_call_key);
        assertEquals(receipt.resultResponseSha256, recorded[0].receipt.result_response_sha256);
        assertEquals(receipt.requestSha256, recorded[0].arguments.p_request_sha256);
        assertEquals(receipt.logicalStageKey, `generate-document.${kind}:round-${expectedRound}`);
        assertEquals(receipt.attemptStatus, "succeeded");
        assertEquals(receipt.errorCode, null);
      }
      const assessed = assessment.sections as Array<Record<string, unknown>>;
      assertEquals(assessed.map((section) => section.key), result.sections.map((section) => section.key));
      for (const [index, section] of assessed.entries()) {
        assertEquals(section.contentSha256, textSha256(result.sections[index].content));
        assertEquals(section.disposition, "assessed_generated");
      }
      const grounding = review.grounding as Record<string, unknown>;
      const units = grounding.units as Array<Record<string, unknown>>;
      assertEquals(units.map((unit) => unit.id), ["issue#1", "request#1"]);
      assertEquals(units.map((unit) => unit.sectionKey), ["issue", "request"]);
      assertEquals(units.map((unit) => unit.contentSha256),
        result.sections.map((section) => textSha256(section.content)));
    });
  });
}

Deno.test("failed final factual review cannot relabel its deterministic replacement as assessed generated prose", async () => {
  await withPipeline({ finalGrounding: "unsupported", assessmentPolicy }, async (fixture) => {
    const result = await fixture.run();
    assert(!result.sections[0].content.includes("$5,000,000"));
    assertEquals(result.sections[1].content, siblingWording);
    const assessment = requiredWordingAssessment(result);
    assertEquals(assessment.compositionMatchesReview, false,
      "Safe section support cannot transfer a whole-document review to a changed sibling");
    const sections = assessment.sections as Array<Record<string, unknown>>;
    assertEquals(sections[0].disposition, "review_blocked");
    assertEquals(sections[0].contentSha256, textSha256(result.sections[0].content));
    assertEquals(sections[0].reviewedContentSha256, textSha256(inventedWording));
    assertEquals(sections[1].disposition, "assessed_generated");
    assertEquals(sections[1].contentSha256, textSha256(siblingWording));
  });
});

Deno.test("assessment owns source and policy inputs before provider awaits without freezing the caller", async () => {
  const mutablePolicy = { ...assessmentPolicy };
  let callerInput: DocumentPipelineInput | undefined;
  let mutated = false;
  await withPipeline({ initial: originalWording, assessmentPolicy: mutablePolicy,
    onProviderRequest(schema) {
      if (schema !== "prompted_document_intent_brief") return;
      assert(callerInput);
      callerInput.situation = inventedWording;
      callerInput.conversationContext = "Injected source after admission.";
      callerInput.systemPrompt = "Replace accepted policy after admission.";
      callerInput.template.sections[0].label = "Changed outside accepted request";
      mutablePolicy.executionPolicySha256 = "f".repeat(64);
      mutated = true;
    },
  }, async (fixture) => {
    callerInput = fixture.input;
    const result = await fixture.run();
    assert(mutated);
    assertEquals(fixture.input.situation, inventedWording, "The caller remains independently mutable");
    assertEquals(result.sections[0].label, "Issue");
    const assessment = requiredWordingAssessment(result);
    assertEquals(assessment.executionPolicySha256, assessmentPolicy.executionPolicySha256);
    assertEquals(assessment.sourceSha256, framedSha256("legacy-audit-source.1", 5,
      [originalWording, "", "", "", ""]));
    assert(fixture.prompts.every((prompt) => !prompt.includes("after admission") &&
      !prompt.includes("Changed outside accepted request") && !prompt.includes(inventedWording)));
    assert(Object.isFrozen(assessment));
    assert(Object.isFrozen(assessment.review));
    const retainedDigest = (assessment.sections as Array<Record<string, unknown>>)[0].contentSha256;
    const ownerEdit = { ...result.sections[0], content: "A later owner edit is different wording." };
    assert(retainedDigest !== textSha256(ownerEdit.content),
      "An edit cannot silently replace the wording bound to the frozen assessment");
  });
});

Deno.test("assessment rejects a quote that normalization would erase into universal source support", async () => {
  await withPipeline({ initial: originalWording, replacement: originalWording,
    assessmentPolicy, evidenceQuote: "⚑" }, async (fixture) => {
    await assertRejects(() => fixture.run(), Error, "DOCUMENT_FACTUAL_REVIEW_INCOMPLETE");
    assert(fixture.persistedCalls.some((call) =>
      String(call.arguments.p_logical_stage_key).startsWith("generate-document.grounding:")));
  });
});

Deno.test("mixed-script wording cannot inherit support from its English sentence while omitting another claim", async () => {
  const unsupportedClaim = "私は医師です。";
  const mixed = `Thank you.\n${unsupportedClaim}`;
  await withPipeline({ initial: mixed, replacement: mixed, unsupportedText: unsupportedClaim,
    assessmentPolicy }, async (fixture) => {
    const result = await fixture.run();
    assert(fixture.groundingDrafts.some((units) => units.includes(unsupportedClaim)),
      "The actual grounding request must include the non-Latin claim");
    assert(!result.sections[0].content.includes(unsupportedClaim));
    assertEquals(result.sections[1].content, siblingWording);
    const assessment = requiredWordingAssessment(result);
    assertEquals((assessment.sections as Array<Record<string, unknown>>)[0].disposition, "review_blocked");
  });
});

Deno.test("retained draft preview references cannot change final wording while its assessment hashes resolve", async () => {
  const nativeDigest = crypto.subtle.digest;
  let hashesOfIssue = 0;
  let changed = false;
  let draftReference: { content: string } | undefined;
  crypto.subtle.digest = async function(algorithm, data) {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    const isIssue = new TextDecoder().decode(bytes) === originalWording;
    const hash = await nativeDigest.call(this, algorithm, data);
    if (isIssue && ++hashesOfIssue === 3) {
      assert(draftReference, "The actual draft callback must run before the race");
      draftReference.content = inventedWording;
      changed = true;
    }
    return hash;
  };
  try {
    await withPipeline({ initial: originalWording, assessmentPolicy }, async (fixture) => {
      fixture.input.onDraftSection = (section) => {
        if (section.key === "issue") draftReference = section;
      };
      const result = await fixture.run();
      assert(changed, "The retained preview reference must be mutated during final digest work");
      assertEquals(result.sections[0].content, originalWording);
      const assessment = requiredWordingAssessment(result);
      const section = (assessment.sections as Array<Record<string, unknown>>)[0];
      assertEquals(section.contentSha256, textSha256(result.sections[0].content));
      assertEquals(section.disposition, "assessed_generated");
    });
  } finally {
    crypto.subtle.digest = nativeDigest;
  }
});

Deno.test("both final reviewers receive the upload and saved source facts included in the assessment digest", async () => {
  await withPipeline({ initial: originalWording, assessmentPolicy }, async (fixture) => {
    fixture.input.uploadContext = "Synthetic owned upload confirms transaction ABC.";
    fixture.input.memoryContext = "Synthetic confirmed profile identifies customer Taylor.";
    await fixture.run();
    const reviewers = fixture.prompts.filter((prompt) => prompt.includes("DRAFT UNITS:") ||
      prompt.includes("Complete draft:"));
    assertEquals(reviewers.length, 2);
    for (const prompt of reviewers) {
      assert(prompt.includes(fixture.input.uploadContext), "A reviewer must receive the upload facts it is asked to check");
      assert(prompt.includes(fixture.input.memoryContext), "A reviewer must receive the saved facts it is asked to check");
    }
  });
});

Deno.test("heading-only output cannot acquire a grounding receipt or an assessed generated disposition", async () => {
  await withPipeline({ initial: "Issue", replacement: "Issue", sibling: "Request", assessmentPolicy }, async (fixture) => {
    await assertRejects(() => fixture.run(), Error, "DOCUMENT_AUDIT_RECEIPT_REQUIRED");
    assertEquals(fixture.groundingDrafts, [], "No provider audit can be invented for an empty unit set");
    assert(fixture.qualityDrafts.length > 0, "The nonempty positive review transport must actually run");
  });
});

for (const invalid of ["malformed", "unverifiable"] as const) {
  Deno.test(`durable wording assessment rejects ${invalid} final grounding instead of carrying an earlier verdict`, async () => {
    await withPipeline({ replacement: originalWording, finalGrounding: invalid, assessmentPolicy }, async (fixture) => {
      await assertRejects(() => fixture.run());
      assert(fixture.stages.includes("generate-document.grounding:round-3"));
      assert(fixture.stages.includes("generate-document.quality:round-3"), "The sibling review must be joined");
    });
  });
}

Deno.test("malformed internal assessment policy rejects before any model or accounting dispatch", async () => {
  await withPipeline({ initial: originalWording, assessmentPolicy: {
    ...assessmentPolicy, executionPolicySha256: "not-a-policy-digest",
  } }, async (fixture) => {
    await assertRejects(() => fixture.run(), Error, "DOCUMENT_ASSESSMENT_POLICY_INVALID");
    assertEquals(fixture.persistedCalls, []);
    assertEquals(fixture.writes, []);
  });
});

Deno.test("ordinary pipeline response retains its existing public result shape without audit opt-in", async () => {
  await withPipeline({ initial: originalWording }, async (fixture) => {
    const result = await fixture.run();
    assertEquals(Object.keys(result).sort(), ["missingInfo", "sections", "unresolvedPlaceholders"]);
    assertEquals(fixture.auditedReads, []);
  });
});

Deno.test("residual stripping must audit the stripped wording and still reject invented amounts", async () => {
  await withPipeline({
    replacement: inventedWording + " TODO",
    finalGrounding: "approve",
  }, async (fixture) => {
    const result = await fixture.run();
    assert(!result.sections[0].content.includes("$5,000,000"));
    assertEquals(result.sections[1].content, siblingWording);
    assert(fixture.groundingDrafts.at(-1)!.includes(inventedWording));
    assert(!fixture.groundingDrafts.at(-1)!.includes("TODO"));
  });
});

Deno.test("malformed final grounding cannot fall back to an earlier approval", async () => {
  await withPipeline({
    replacement: originalWording,
    finalGrounding: "malformed",
  }, async (fixture) => {
    await assertRejects(
      fixture.run,
      Error,
      "DOCUMENT_GROUNDING_OUTPUT_INVALID",
    );
  });
});

Deno.test("cancellation during final grounding rejects instead of returning the rewritten document", async () => {
  await withPipeline({
    replacement: originalWording,
    finalGrounding: "abort",
  }, async (fixture) => {
    const failure = await assertRejects(
      fixture.run,
      Error,
      "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
    );
    assert(
      isProviderReconciliationRequired(failure),
      "In-flight cancellation must preserve the handler's reservation hold.",
    );
    assertEquals(fixture.groundingDrafts.length, 2);
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("reviewer uncertainty takes precedence over a malformed sibling review for allowance reconciliation", async () => {
  await withPipeline({
    replacement: originalWording,
    finalGrounding: "malformed",
    finalQuality: "uncertain",
  }, async (fixture) => {
    const failure = await assertRejects(
      fixture.run,
      Error,
      "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
    );
    assert(isProviderReconciliationRequired(failure));
    assertEquals(fixture.groundingDrafts.length, 2);
    assertEquals(fixture.qualityDrafts.length, 2);
  });
});

Deno.test("final grounding rejects a fabricated criminal admission without relying on numeric checks", async () => {
  await withPipeline({
    replacement: "The company admitted criminal fraud.",
    finalGrounding: "unsupported",
  }, async (fixture) => {
    const result = await fixture.run();
    assert(!result.sections[0].content.includes("criminal fraud"));
    assertEquals(result.sections[1].content, siblingWording);
    assertEquals(result.unresolvedPlaceholders.map((item) => item.sectionKey), [
      "issue",
    ]);
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("unverifiable final grounding is a review failure, not approval or a request for missing facts", async () => {
  await withPipeline({
    replacement: originalWording,
    finalGrounding: "unverifiable",
  }, async (fixture) => {
    await assertRejects(
      fixture.run,
      Error,
      "DOCUMENT_FACTUAL_REVIEW_INCOMPLETE",
    );
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("exhausted initial grounding retries cannot promote an unverifiable audit into approval", async () => {
  await withPipeline({
    initial: originalWording,
    unverifiableInitial: true,
  }, async (fixture) => {
    await assertRejects(
      fixture.run,
      Error,
      "DOCUMENT_FACTUAL_REVIEW_INCOMPLETE",
    );
    assertEquals(fixture.writes.length, 2);
    assertEquals(fixture.groundingDrafts.length, 3);
  });
});

Deno.test("final quality rejection isolates the replacement without changing its safe sibling", async () => {
  await withPipeline({
    replacement: originalWording,
    finalQuality: "reject",
  }, async (fixture) => {
    const result = await fixture.run();
    assert(result.sections[0].content.includes("TED_PLACEHOLDER"));
    assertEquals(result.sections[1].content, siblingWording);
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("malformed final quality review cannot reuse an earlier approval", async () => {
  await withPipeline({
    replacement: originalWording,
    finalQuality: "malformed",
  }, async (fixture) => {
    await assertRejects(fixture.run, Error, "DOCUMENT_QUALITY_OUTPUT_INVALID");
    assertEquals(fixture.writes.length, 3);
  });
});

Deno.test("cancellation while recording the final reviewer result fences successful return", async () => {
  await withPipeline({
    replacement: originalWording,
    abortOnFinalReceipt: true,
  }, async (fixture) => {
    await assertRejects(fixture.run, DOMException, "signal has been aborted");
    assertEquals(fixture.groundingDrafts.length, 2);
    assertEquals(fixture.qualityDrafts.length, 2);
  });
});
