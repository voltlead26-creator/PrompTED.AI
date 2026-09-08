// deno-lint-ignore-file no-import-prefix -- Match the repository's pinned Edge test transport seam.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHash } from "node:crypto";
import coreCatalogue from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Catalogue from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};
import compatibility from "../../../docs/architecture/document-section-key-compatibility.proposed.json" with {
  type: "json",
};
import { DIPS } from "./document-intelligence-profiles.ts";
import {
  DocumentProfileProjectionError,
  resolveDocumentProfilePolicy,
} from "./document-profile-projection.ts";
import { buildSystemPrompt } from "./prompt-builder.ts";
import { parseDocumentPlaceholderTokens } from "./document-placeholder-policy.ts";
import type { RequiredInformationDefinition } from "./document-placeholder-policy.ts";
import { runDocumentPipeline } from "./document-pipeline.ts";
import { bindModelCallContext } from "./model-call-context.ts";
import { type ResolvedTemplate, resolveTemplate } from "./template-engine.ts";

// Independent exact destinations reviewed against ADR-001. These fixtures
// project fact metadata onto CURRENT sections; they never redistribute prose.
// Explicit exceptions: sender identity belongs to required email introduction;
// promotion proof is a shared dependency; future-only sections stay inactive.
const CURRENT_GROUPS: Record<string, Record<string, readonly string[]>> = {
  "business-email": {
    subject: ["subject_and_greeting"],
    body: ["message"],
    action: ["call_to_action"],
  },
  "cover-letter": {
    opening: ["sender_and_date", "recipient_and_salutation", "opening"],
    fit: ["evidence_of_fit"],
    motivation: ["employer_motivation"],
    closing: ["closing_and_signature"],
  },
  "education-cover-letter": {
    intro: ["recipient_and_application", "opening"],
    suitability: ["fit_and_evidence", "motivation_and_fit"],
    close: ["closing"],
  },
  "induction-manual": {
    welcome: ["welcome_and_context"],
    how_we_work: ["how_work_is_performed"],
    policies: ["policies_and_safety"],
    contacts: ["systems_contacts_and_first_period"],
  },
  "interview-prep-questions": {
    about_you: [
      "opening_and_motivation_questions",
      "behavioural_questions",
      "difficult_question_preparation",
    ],
    role_specific: [
      "role_and_evidence_map",
      "role_specific_questions",
      "final_preparation_checklist",
    ],
    your_questions: ["questions_to_ask_interviewer"],
  },
  "interview-script": {
    intro: ["opening_introduction", "why_this_role"],
    stories: [
      "strength_and_capability_answers",
      "star_evidence_stories",
      "role_specific_answers",
    ],
    tricky: ["difficult_question_answers"],
  },
  "job-follow-up-email": {
    thanks: ["subject_line", "greeting", "event_reference", "sign_off"],
    value: ["continued_interest_and_value"],
    next: ["next_step"],
  },
  "job-search-checklist": {
    items: [
      "objective_and_cadence",
      "setup_and_evidence_preparation",
      "role_discovery",
      "role_screening",
      "tailoring_and_submission",
      "tracking_and_follow_up",
      "interview_preparation",
      "weekly_review",
    ],
  },
  "offer-letter": {
    offer: ["parties_role_and_offer"],
    terms: ["confirmed_key_terms"],
    conditions: ["conditions"],
    acceptance: ["acceptance"],
  },
  "onboarding-checklist": {
    items: [
      "pre_start_tasks",
      "first_day_tasks",
      "first_week_tasks",
      "role_training_and_access",
      "owner_due_status_and_evidence",
    ],
  },
  "pay-rise-request": {
    case: ["conversation_context", "case_for_review"],
    ask: ["compensation_request"],
    script: ["conversation_script", "close_and_next_step"],
  },
  "personal-statement": {
    motivation: ["purpose_and_target", "motivation"],
    background: ["preparation_and_evidence", "program_fit"],
    goals: ["future_direction"],
  },
  "promotion-case": {
    impact: ["readiness_evidence", "capability_match"],
    readiness: ["capability_match", "development_and_gaps"],
    proposal: ["target_promotion", "request_and_next_step"],
  },
  "reference-request": {
    ask: ["recipient_and_relationship", "request_and_opt_out", "signoff"],
    details: ["request_purpose", "helpful_context"],
  },
  "resignation-letter": {
    notice: ["notice"],
    appreciation: ["appreciation"],
    transition: ["handover"],
    close: ["close"],
  },
  sop: {
    overview: ["purpose_scope_prerequisites"],
    steps: ["procedure_steps_and_controls"],
    roles: ["roles_records_and_review"],
  },
  "terms-of-employment": {
    parties: ["parties_and_role"],
    pay: ["pay_hours_and_location"],
    obligations: ["duties_policies_and_obligations"],
    ending: ["leave_and_ending_employment"],
  },
  "workplace-policy": {
    purpose: ["purpose_and_scope"],
    policy: ["policy_statements"],
    responsibilities: ["roles_and_responsibilities"],
    breach: ["breaches_and_review"],
  },
};

const catalogue = [...coreCatalogue, ...phase2Catalogue];

function sourceProfile(slug: string) {
  const profile = DIPS.find((candidate) => candidate.key === slug);
  assert(profile?.informationContract, "Positive authored contract: " + slug);
  return { profile, contract: profile.informationContract };
}

function expectedFacts(
  slug: string,
  key: string,
): RequiredInformationDefinition[] {
  const { contract } = sourceProfile(slug);
  const group = CURRENT_GROUPS[slug]?.[key] ?? [key];
  return group.flatMap((sourceKey) => {
    const section = contract.sections.find((candidate) =>
      candidate.sectionKey === sourceKey
    );
    assert(section, "Positive source section: " + slug + "." + sourceKey);
    return section.requiredInformation;
  });
}

function contractBlocks(
  prompt: string,
): Array<{ key: string; lines: string[] }> {
  const result: Array<{ key: string; lines: string[] }> = [];
  let current: { key: string; lines: string[] } | undefined;
  for (const line of prompt.split("\n")) {
    if (line.startsWith("SECTION INFORMATION CONTRACT — ")) {
      current = {
        key: line.slice("SECTION INFORMATION CONTRACT — ".length),
        lines: [],
      };
      result.push(current);
    } else if (line.startsWith("- information_key=")) {
      assert(current, "Fact metadata must have an explicit section identity");
      current.lines.push(line);
    } else if (line.startsWith("- optional facts:")) current = undefined;
  }
  return result;
}

// Exercises real pipeline, provider request construction, output validation,
// router and accounting. A completed, acknowledged planner response deliberately
// fails its section-set contract. This proves accepted intent and prevents any
// concurrent writers from starting; it is not a completed-document claim.
async function observeIntent(
  template: ResolvedTemplate,
  facts: Record<string, RequiredInformationDefinition[]>,
) {
  const oldFetch = globalThis.fetch;
  const env = {
    OPENAI_API_KEY: "synthetic-catalogue-key",
    PROMPTED_DEPLOYMENT_ENV: "test",
  };
  const previous = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const controller = new AbortController();
  const prompts: string[] = [];
  let reachedPlanner = false;
  let failure: unknown;
  const dispatches: string[] = [];
  const acknowledgedStages: string[] = [];
  bindModelCallContext(controller.signal, {
    userId: "75000000-0000-4000-8000-000000000001",
    generationRequestId: "catalogue-profile." + template.id,
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
            assertEquals(args.p_attempt_status, "succeeded");
            assertEquals(args.p_provider_status, "completed");
            assertEquals(args.p_error_code, null);
            assertEquals(
              args.p_result_envelope,
              null,
              "This fixture has no durable checkpoint context",
            );
            assertEquals(args.p_input_tokens, 20);
            assertEquals(args.p_output_tokens, 10);
            assert(
              ["generate-document.intent", "generate-document.plan"].includes(
                String(args.p_logical_stage_key),
              ),
            );
            acknowledgedStages.push(String(args.p_logical_stage_key));
            data = {
              usage_ledger_id: "75000000-0000-4000-8000-000000000002",
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
    const schema = body.text?.format?.name;
    dispatches.push(schema);
    const prompt = body.input.map((message: { content: string }) =>
      message.content
    ).join("\n");
    if (schema === "prompted_document_section_plan") {
      reachedPlanner = true;
      return Promise.resolve(Response.json({
        id: "resp_catalogue_profile_plan",
        status: "completed",
        output_text: JSON.stringify({ section_context: [] }),
        usage: { input_tokens: 20, output_tokens: 10 },
      }));
    }
    assertEquals(schema, "prompted_document_intent_brief");
    prompts.push(prompt);
    const output = {
      user_goal: "Prepare a document from confirmed facts.",
      primary_outcome: "Review the document.",
      audience: "Synthetic reviewer",
      author_perspective: "Owner",
      tone: ["professional"],
      required_content: ["Current catalogue sections"],
      prohibited_content: ["Invented facts"],
      known_facts: [],
      safe_assumptions: [],
      missing_critical_information: [],
      section_readiness: template.sections.map(({ key }) => ({
        key,
        ready: facts[key].length === 0,
        missing_information: facts[key].map((fact) => fact.label),
        missing_information_keys: facts[key].map((fact) => fact.key),
      })),
      confidence: 1,
    };
    return Promise.resolve(
      Response.json({
        id: "resp_catalogue_profile_intent",
        status: "completed",
        output_text: JSON.stringify(output),
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    );
  }) as typeof fetch;
  for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
  try {
    try {
      await runDocumentPipeline({
        template,
        situation: "Synthetic facts remain missing.",
        conversationContext:
          "The owner asks for a document but has not confirmed the requested personal or business facts.",
        uploadContext: "",
        extractedText: "",
        memoryContext: "",
        systemPrompt: "Use only confirmed source facts.",
        signal: controller.signal,
      });
    } catch (error) {
      failure = error;
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
  assertEquals(
    prompts.length,
    1,
    "Exactly one controlled intent response must be observed",
  );
  if (reachedPlanner) {
    assert(
      failure instanceof Error && "code" in failure,
      "The real plan validator must reject the acknowledged synthetic plan",
    );
    assertEquals(
      failure.code,
      "DOCUMENT_PLAN_OUTPUT_INVALID",
      "Reconciliation, cancellation or transport failure is not this acceptance seam",
    );
    assertEquals(dispatches, [
      "prompted_document_intent_brief",
      "prompted_document_section_plan",
    ]);
    assertEquals(acknowledgedStages, [
      "generate-document.intent",
      "generate-document.plan",
    ]);
  }
  return { prompt: prompts[0], reachedPlanner, failure, dispatches };
}

function assertFactMetadata(
  lines: string[],
  facts: RequiredInformationDefinition[],
) {
  assertEquals(
    lines.map((line) => line.slice("- information_key=".length).split(";")[0]),
    facts.map((fact) => fact.key),
  );
  for (const [index, fact] of facts.entries()) {
    const line = lines[index];
    for (
      const value of [
        "label=" + fact.label,
        "fact_type=" + fact.factType,
        "placeholder_label=" + fact.placeholderLabel,
        "question=" + fact.question,
        "automatic_fallback=" + (fact.automaticFallback ?? "<none>"),
        "required_for_export=" + fact.requiredForExport,
        "shared_resolution_key=" + (fact.sharedResolutionKey ?? "<none>"),
      ]
    ) assertStringIncludes(line, value);
    for (const choice of fact.neutralReplacementOptions) {
      assertStringIncludes(line, choice.id + " => " + choice.value);
      assertStringIncludes(line, choice.suitability);
      assertStringIncludes(
        line,
        "clears_export_warning=" + choice.clearsExportWarning,
      );
      assertStringIncludes(
        line,
        "regenerate_surrounding_wording=" + choice.regenerateSurroundingWording,
      );
    }
  }
}

Deno.test("catalogue projection retains the exact existing 18-conflict compatibility inventory", () => {
  assertEquals(
    Object.keys(CURRENT_GROUPS).sort(),
    compatibility.templates.map((entry) => entry.templateId).sort(),
  );
  assertEquals(Object.keys(CURRENT_GROUPS).length, 18);
  for (const decision of compatibility.templates) {
    const template = catalogue.find((entry) =>
      entry.slug === decision.templateId
    );
    assert(template);
    const { contract } = sourceProfile(template.slug);
    assertEquals(
      template.sections.map((section) => section.key),
      decision.catalogueSectionKeys,
    );
    assertEquals(
      contract.sections.map((section) => section.sectionKey),
      decision.profileSectionKeys,
    );
    assertEquals(
      Object.keys(CURRENT_GROUPS[template.slug]),
      decision.catalogueSectionKeys,
    );
  }
});

Deno.test("all 86 real catalogue pipelines admit exact section facts and render current ordered contracts", async (t) => {
  assertEquals(catalogue.length, 86);
  const before = JSON.stringify(DIPS);
  for (const entry of catalogue) {
    await t.step(entry.slug, async () => {
      const template = resolveTemplate(entry.slug);
      assert(template, "Positive canonical template: " + entry.slug);
      const facts = Object.fromEntries(
        template.sections.map((
          { key },
        ) => [key, expectedFacts(entry.slug, key)]),
      );
      const observed = await observeIntent(template, facts);
      assert(
        observed.reachedPlanner,
        entry.slug +
          " must accept its authored missing-information keys before planner dispatch; actual failure: " +
          String(observed.failure),
      );
      assertEquals(observed.dispatches, [
        "prompted_document_intent_brief",
        "prompted_document_section_plan",
      ]);
      const blocks = contractBlocks(observed.prompt);
      assertEquals(
        blocks.map((block) => block.key),
        template.sections.map((section) => section.key),
      );
      for (const block of blocks) {
        assertFactMetadata(block.lines, facts[block.key]);
      }
      assertEquals(
        JSON.stringify(DIPS),
        before,
        "Authored history and its source metadata must remain unchanged",
      );
    });
  }
});

Deno.test("follow-up sender identity remains required in thanks while next stays optional", async () => {
  const template = resolveTemplate("job-follow-up-email");
  assert(template);
  assertEquals(
    template.sections.find((section) => section.key === "thanks")?.required,
    true,
  );
  assertEquals(
    template.sections.find((section) => section.key === "next")?.required,
    false,
  );
  const facts = Object.fromEntries(
    template.sections.map(({ key }) => [key, expectedFacts(template.id, key)]),
  );
  const sender = facts.thanks.find((fact) => fact.key === "candidate_name");
  assert(sender?.requiredForExport, "Positive sender-identity requirement");
  const observed = await observeIntent(template, facts);
  const blocks = contractBlocks(observed.prompt);
  const thanks = blocks.find((block) => block.key === "thanks");
  assert(thanks, "Current required introduction must carry sender metadata");
  assertFactMetadata(thanks.lines, facts.thanks);
  assertEquals(blocks.some((block) => block.key === "sign_off"), false);
});

Deno.test("promotion proof reaches both existing sections with the same source resolution identity", async () => {
  const template = resolveTemplate("promotion-case");
  assert(template);
  const facts = Object.fromEntries(
    template.sections.map(({ key }) => [key, expectedFacts(template.id, key)]),
  );
  for (const key of ["promotion_requirements", "capability_evidence"]) {
    const left = facts.impact.find((fact) => fact.key === key);
    const right = facts.readiness.find((fact) => fact.key === key);
    assert(left?.sharedResolutionKey && right?.sharedResolutionKey);
    assertEquals(
      left,
      right,
      "Two dependencies must retain one source fact, question and resolution key",
    );
  }
  const observed = await observeIntent(template, facts);
  const blocks = contractBlocks(observed.prompt);
  for (const key of ["impact", "readiness"]) {
    const block = blocks.find((block) => block.key === key);
    assert(block, "Keep current promotion section: " + key);
    assertFactMetadata(block.lines, facts[key]);
  }
});

Deno.test("generic employment terms do not activate future jurisdiction-controlled acknowledgement", async () => {
  const decision = compatibility.templates.find((entry) =>
    entry.templateId === "terms-of-employment"
  );
  const future = decision?.mappings.find((mapping) =>
    mapping.profileKeys.includes("acknowledgement")
  );
  assert(future && "newSectionPolicy" in future);
  assertEquals(
    future.newSectionPolicy?.requiredness,
    "jurisdiction_controlled",
  );
  const template = resolveTemplate("terms-of-employment");
  assert(template);
  const facts = Object.fromEntries(
    template.sections.map(({ key }) => [key, expectedFacts(template.id, key)]),
  );
  const observed = await observeIntent(template, facts);
  const blocks = contractBlocks(observed.prompt);
  assertEquals(blocks.map((block) => block.key), [
    "parties",
    "pay",
    "obligations",
    "ending",
  ]);
  assert(
    !blocks.flatMap((block) => block.lines).some((line) =>
      line.includes("information_key=acceptance_method")
    ),
  );
  assertEquals(template.sections.map((section) => section.required), [
    true,
    true,
    true,
    true,
  ]);
});

Deno.test("scoped offer repair admits the mapped party facts without changing its section identity", async () => {
  const full = resolveTemplate("offer-letter");
  assert(full);
  const template = {
    ...full,
    sections: full.sections.filter((section) => section.key === "offer"),
  };
  assertEquals(template.sections.length, 1);
  const before = JSON.stringify(full);
  const facts = { offer: expectedFacts(full.id, "offer") };
  assert(
    facts.offer.some((fact) =>
      fact.key === "candidate_name" && fact.requiredForExport
    ),
  );
  const observed = await observeIntent(template, facts);
  assert(
    observed.reachedPlanner,
    "Scoped repair must accept exact mapped identity facts: " +
      String(observed.failure),
  );
  const offer = contractBlocks(observed.prompt).find((block) =>
    block.key === "offer"
  );
  assert(offer);
  assertFactMetadata(offer.lines, facts.offer);
  assertEquals(
    JSON.stringify(full),
    before,
    "The sibling source template remains untouched",
  );
});

Deno.test("projected base prompt uses the bound snapshot while undefined and null remain distinct", () => {
  const template = resolveTemplate("offer-letter");
  assert(template);
  const policy = resolveDocumentProfilePolicy(template);
  assert(policy.profile);
  const before = JSON.stringify(DIPS);
  const options = { task: "document", profileHint: "offer-letter" };
  const raw = buildSystemPrompt(options);
  assertStringIncludes(
    raw,
    "SECTION INFORMATION CONTRACT — parties_role_and_offer",
  );
  const projected = buildSystemPrompt({
    ...options,
    resolvedProfile: policy.profile,
  });
  assertEquals(contractBlocks(projected).map((block) => block.key), [
    "offer",
    "terms",
    "conditions",
    "acceptance",
  ]);
  assert(
    !projected.includes(
      "SECTION INFORMATION CONTRACT — parties_role_and_offer",
    ),
  );
  assertEquals(
    contractBlocks(buildSystemPrompt({ ...options, resolvedProfile: null })),
    [],
  );
  assertEquals(JSON.stringify(DIPS), before);
});

Deno.test("all 18 projections preserve authored facts and only rebase synthetic example tokens", () => {
  const before = JSON.stringify(DIPS);
  for (const [slug, groups] of Object.entries(CURRENT_GROUPS)) {
    const template = resolveTemplate(slug);
    assert(template);
    const policy = resolveDocumentProfilePolicy(template);
    assert(policy.profile?.informationContract && policy.sourceProfile);
    assertEquals(policy.sourceProfile, sourceProfile(slug).profile);
    assertEquals(
      policy.sectionBindings,
      Object.entries(groups).map(([sectionKey, sourceSectionKeys]) => ({
        sectionKey,
        sourceSectionKeys,
      })),
    );
    const sourceExampleKeys =
      policy.sourceProfile.exampleFinalWording?.sections.map((section) =>
        section.key
      ) ?? [];
    const expectedExampleKeys = Object.entries(groups).filter((
      [, sourceKeys],
    ) => sourceKeys.some((key) => sourceExampleKeys.includes(key))).map((
      [key],
    ) => key);
    assertEquals(
      policy.profile.exampleFinalWording?.sections.map((section) =>
        section.key
      ),
      expectedExampleKeys,
    );
    for (const section of policy.profile.exampleFinalWording?.sections ?? []) {
      const contract = policy.profile.informationContract.sections.find((
        item,
      ) => item.sectionKey === section.key);
      assert(contract);
      for (const token of parseDocumentPlaceholderTokens(section.content)) {
        assert(token.id.startsWith(`${policy.profile.key}.${section.key}.`));
        const key = token.id.slice(
          `${policy.profile.key}.${section.key}.`.length,
        );
        assert(contract.requiredInformation.some((fact) => fact.key === key));
      }
    }
  }
  assertEquals(
    JSON.stringify(DIPS),
    before,
    "Authored examples, review dates and provenance are immutable",
  );
});

Deno.test("projection rejects authored section drift and colliding fact identities", () => {
  const template = resolveTemplate("cover-letter");
  assert(template);
  const { contract } = sourceProfile("cover-letter");
  const source = contract.sections[0];
  assert(source);
  const originalKey = source.sectionKey;
  try {
    source.sectionKey = "unexpected_authored_section";
    assertThrows(
      () => resolveDocumentProfilePolicy(template),
      DocumentProfileProjectionError,
    );
  } finally {
    source.sectionKey = originalKey;
  }
  const first = contract.sections.find((section) =>
    section.sectionKey === "sender_and_date"
  );
  const second = contract.sections.find((section) =>
    section.sectionKey === "recipient_and_salutation"
  );
  assert(first?.requiredInformation[0] && second?.requiredInformation[0]);
  const originalFact = second.requiredInformation[0].key;
  try {
    second.requiredInformation[0].key = first.requiredInformation[0].key;
    assertThrows(
      () => resolveDocumentProfilePolicy(template),
      DocumentProfileProjectionError,
    );
  } finally {
    second.requiredInformation[0].key = originalFact;
  }
});

Deno.test("projection keeps an admitted scope order and asks only its mapped facts", () => {
  const full = resolveTemplate("offer-letter");
  assert(full);
  const terms = full.sections.find((section) => section.key === "terms");
  const offer = full.sections.find((section) => section.key === "offer");
  assert(terms && offer);
  const before = JSON.stringify(full);
  const scope = { ...full, sections: [terms, offer] };
  const policy = resolveDocumentProfilePolicy(scope);
  assert(policy.profile?.informationContract);
  assertEquals(policy.sectionBindings.map((binding) => binding.sectionKey), [
    "terms",
    "offer",
  ]);
  assertEquals(
    policy.profile.informationContract.sections.map((section) =>
      section.sectionKey
    ),
    ["terms", "offer"],
  );
  const facts = ["terms", "offer"].flatMap((key) =>
    expectedFacts("offer-letter", key)
  );
  assertEquals(policy.profile.requiredInformation, [
    ...new Set(facts.map((fact) => fact.label)),
  ]);
  assertEquals(policy.profile.clarificationQuestions, [
    ...new Set(facts.map((fact) => fact.question)),
  ]);
  assertStringIncludes(
    policy.profile.quality?.requiredStructure.join("\n") ?? "",
    "do not request facts for, recreate, assess completeness of, or rewrite unselected sections",
  );
  assertEquals(JSON.stringify(full), before);
});
