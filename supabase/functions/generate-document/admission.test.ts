// deno-lint-ignore-file no-import-prefix -- Edge test dependencies use direct JSR specifiers pinned by the repository lockfile.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createHash } from "node:crypto";
import { createClient } from "jsr:@supabase/supabase-js@2";
import coreCatalogue from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Catalogue from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};
import { AuthError } from "../_shared/auth-guard.ts";
import { DIPS, selectProfile } from "../_shared/document-intelligence-profiles.ts";
import { designBespokeTemplate } from "../_shared/section-designer.ts";
import { allowanceRequestSha256 } from "../_shared/allowance-reservations.ts";
import type {
  AllowanceReplayRead,
  AllowanceReservation,
} from "../_shared/allowance-reservations.ts";
import type { DocumentPipelineInput } from "../_shared/document-pipeline.ts";
import { bindModelCallContext } from "../_shared/model-call-context.ts";
import {
  applyPreFill,
  type ResolvedTemplate,
  resolveTemplate,
} from "../_shared/template-engine.ts";
import {
  type GenerateDocumentDependencies,
  handleGenerateDocument,
} from "./handler.ts";

const OWNER = "71000000-0000-4000-8000-000000000001";
const REQUEST = "generation-admission.synthetic.1";
function requiredCatalogueTemplate<T extends { slug: string }>(
  templates: readonly T[],
  slug: string,
): T {
  const template = templates.find((item) => item.slug === slug);
  assert(template, `Positive catalogue fixture must exist: ${slug}`);
  return template;
}

const offer = requiredCatalogueTemplate(coreCatalogue, "offer-letter");
const complaint = requiredCatalogueTemplate(
  phase2Catalogue,
  "complaint-letter",
);
assertEquals(offer.id, "11111111-0000-4000-8000-000000000015");
assertEquals(offer.advice_boundary, "high-stakes");
assertEquals(offer.sections.map((section) => section.key), [
  "offer",
  "terms",
  "conditions",
  "acceptance",
]);
const offerSection = offer.sections.find((item) => item.key === "offer");
const termsSection = offer.sections.find((item) => item.key === "terms");
assert(offerSection && termsSection, "Required scoped fixtures must exist");

interface AdmissionCatalogueFixture {
  slug: string;
  domain: string;
  structure_type: string;
  advice_boundary: string;
  sections: Array<{
    key: string;
    name: string;
    is_required: boolean;
    description: string;
    vital?: string[];
    improver?: string[];
  }>;
}

function catalogueBody(
  template: AdmissionCatalogueFixture = offer,
): Record<string, unknown> {
  assert(template);
  return {
    template_id: template.slug,
    situation: "Synthetic employer offers a confirmed role and start date.",
    generation_request_id: REQUEST,
    design_bespoke: false,
    domain: template.domain,
    structure_type: template.structure_type,
    advice_boundary: template.advice_boundary,
    sections: template.sections.map((section) => ({
      key: section.key,
      label: section.name,
      required: section.is_required,
      hint: section.description,
      vital: section.vital,
      improver: section.improver,
    })),
  };
}

const serverDesign: ResolvedTemplate = {
  id: "bespoke",
  name: "Synthetic equipment handover",
  domain: "business",
  structureType: "structured_form",
  adviceBoundary: "light",
  sections: [
    {
      key: "equipment",
      label: "Equipment",
      required: true,
      vital: ["Asset ID"],
    },
    { key: "condition", label: "Condition", required: true },
    { key: "handover", label: "Handover", required: true },
  ],
};

function fixture(options: {
  replayEvents?: Array<Record<string, unknown>>;
  designedTemplate?: ResolvedTemplate | null;
  denyAuth?: boolean;
  previousRead?: AllowanceReplayRead;
  readError?: Error;
  persistPolicy?: boolean;
  pipelineFailures?: number;
  useRealDesigner?: boolean;
  onReserve?: () => void;
  onDesign?: () => void;
  rpc?: (name: string, args: Record<string, unknown>) => Record<string, unknown>;
} = {}) {
  let savedReservation: AllowanceReservation | undefined;
  let remainingPipelineFailures = options.pipelineFailures ?? 0;
  const calls = {
    auth: 0,
    read: [] as Array<
      Parameters<GenerateDocumentDependencies["readDocumentAllowanceReplay"]>[1]
    >,
    reserve: [] as Array<
      Parameters<GenerateDocumentDependencies["reserveDocumentAllowance"]>[1]
    >,
    settle: [] as Array<
      Parameters<GenerateDocumentDependencies["settleDocumentAllowance"]>[1]
    >,
    release: [] as Array<
      Parameters<GenerateDocumentDependencies["releaseDocumentAllowance"]>[1]
    >,
    design: [] as Array<
      Parameters<GenerateDocumentDependencies["designBespokeTemplate"]>[0]
    >,
    pipeline: [] as DocumentPipelineInput[],
    unexpectedHttp: [] as string[],
  };
  // The real SDK is used solely for the handler's best-effort log insert.
  // No auth, database, provider, or persistence acceptance is claimed here.
  const admin = createClient(
    "https://generation-admission.invalid",
    "synthetic-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch(input, init) {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          if (url.pathname.startsWith("/rest/v1/rpc/") && options.rpc) {
            assertEquals(init?.method, "POST");
            const args: unknown = JSON.parse(String(init?.body));
            assert(args && typeof args === "object" && !Array.isArray(args));
            return Promise.resolve(Response.json(options.rpc(url.pathname.slice("/rest/v1/rpc/".length), Object.fromEntries(Object.entries(args)))));
          }
          if (
            url.pathname === "/rest/v1/generation_logs" &&
            init?.method === "POST"
          ) {
            return Promise.resolve(new Response(null, { status: 201 }));
          }
          calls.unexpectedHttp.push(`${init?.method ?? "GET"} ${url.pathname}`);
          return Promise.reject(new Error("UNEXPECTED_TEST_HTTP"));
        },
      },
    },
  );
  const dependencies: GenerateDocumentDependencies = {
    async guardRequest(req, guardOptions) {
      calls.auth++;
      assertEquals(guardOptions, { enforceCap: false });
      if (options.denyAuth) {
        throw new AuthError(401, "UNAUTHENTICATED", {
          error: { code: "UNAUTHENTICATED", message: "Sign in." },
        });
      }
      const body: unknown = await req.json();
      assert(body && typeof body === "object" && !Array.isArray(body));
      bindModelCallContext(req.signal, { userId: OWNER, admin });
      return {
        userId: OWNER,
        isAnonymous: false,
        plan: "business",
        monthlyDocumentCap: 1000,
        admin,
        body: Object.fromEntries(Object.entries(body)),
        multipartBody: null,
      };
    },
    loadUserMemoryContext: () => Promise.resolve(""),
    resolveRetainedUploadContext: (_admin, _owner, _upload, inline) =>
      Promise.resolve(inline),
    readDocumentAllowanceReplay(_admin, params) {
      calls.read.push(params);
      if (options.readError) return Promise.reject(options.readError);
      if (options.previousRead) {
        return Promise.resolve(structuredClone(options.previousRead));
      }
      if (options.replayEvents) {
        return Promise.resolve({
          state: "settled",
          hasPriorProviderWork: true,
          reconciliationRequired: false,
          reservation: {
            reservationId: "72000000-0000-4000-8000-000000000001",
            requestId: params.requestId,
            routeKey: params.routeKey,
            expiresAt: "2026-09-09T00:00:00Z",
            replayResult: {
              contract_version: "allowance-result.1",
              route_key: "generate-document",
              transport: "sse",
              payload: { events: options.replayEvents },
            },
          },
        });
      }
      if (savedReservation && options.persistPolicy) {
        return Promise.resolve({
          state: "unsettled",
          reservation: structuredClone(savedReservation),
          hasPriorProviderWork: true,
          reconciliationRequired: false,
        });
      }
      return Promise.resolve({
        state: "absent",
        reservation: null,
        hasPriorProviderWork: false,
        reconciliationRequired: false,
      });
    },
    reserveDocumentAllowance(_admin, params) {
      calls.reserve.push(params);
      const reservation: AllowanceReservation = {
        reservationId: "72000000-0000-4000-8000-000000000001",
        executionClaimToken: "73000000-0000-4000-8000-000000000001",
        requestId: params.requestId,
        routeKey: params.routeKey,
        expiresAt: "2026-09-09T00:00:00Z",
        executionPolicy: params.executionPolicy
          ? {
            version: params.executionPolicy.version,
            sha256: params.executionPolicy.sha256,
          }
          : undefined,
      };
      if (options.replayEvents) {
        reservation.replayResult = {
          contract_version: "allowance-result.1",
          route_key: "generate-document",
          transport: "sse",
          payload: { events: options.replayEvents },
        };
      }
      savedReservation = structuredClone(reservation);
      options.onReserve?.();
      return Promise.resolve(reservation);
    },
    settleDocumentAllowance(_admin, params) {
      calls.settle.push(params);
      return Promise.resolve();
    },
    releaseDocumentAllowance(_admin, params) {
      calls.release.push(params);
      return Promise.resolve();
    },
    designBespokeTemplate(input) {
      calls.design.push(input);
      options.onDesign?.();
      if (options.useRealDesigner) return designBespokeTemplate(input);
      return Promise.resolve(
        options.designedTemplate === undefined
          ? serverDesign
          : options.designedTemplate,
      );
    },
    runDocumentPipeline(input) {
      calls.pipeline.push(input);
      if (remainingPipelineFailures > 0) {
        remainingPipelineFailures--;
        return Promise.reject(new Error("SYNTHETIC_PIPELINE_INTERRUPTED"));
      }
      return Promise.resolve({
        sections: input.template.sections.map((section) => ({
          key: section.key,
          label: section.label,
          content: `Synthetic reviewed wording for ${section.key}.`,
        })),
        missingInfo: [],
        unresolvedPlaceholders: [],
      });
    },
  };
  return {
    calls,
    async send(body: Record<string, unknown>, signal?: AbortSignal) {
      const response = await handleGenerateDocument(
        new Request(
          "https://generation-admission.invalid/functions/v1/generate-document",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
          },
        ),
        dependencies,
      );
      // Always consume the real handler stream, including on expected REDs,
      // so pipeline completion and its heartbeat cleanup are observed.
      const text = await response.text();
      assertEquals(calls.unexpectedHttp, []);
      return { response, text };
    },
  };
}

async function rejectedBeforeAllowance(
  body: Record<string, unknown>,
  code: string,
) {
  const test = fixture();
  const result = await test.send(body);
  assertEquals(
    result.response.status,
    400,
    "Invalid new policy must fail at admission",
  );
  assertEquals(JSON.parse(result.text).error.code, code);
  assertEquals(test.calls.auth, 1);
  assertEquals(
    test.calls.reserve.length,
    0,
    "Invalid input must not acquire allowance",
  );
  assertEquals(test.calls.design.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.settle.length, 0);
}

for (
  const [name, change] of [
    ["advice downgrade", { advice_boundary: "none" }],
    ["domain replacement", { domain: "general" }],
    ["structure replacement", { structure_type: "checklist" }],
  ] as const
) {
  Deno.test(`generate-document rejects catalogue ${name} before allowance or provider`, async () => {
    await rejectedBeforeAllowance(
      { ...catalogueBody(), ...change },
      "DOCUMENT_TEMPLATE_POLICY_MISMATCH",
    );
  });
}

for (
  const [name, sections] of [
    ["required downgrade", [{
      key: "offer",
      label: "The Offer",
      required: false,
    }]],
    ["invented key", [{ key: "invented", label: "The Offer", required: true }]],
    ["duplicate destination", [
      { key: "offer", label: "The Offer", required: true },
      { key: "offer", label: "Duplicate", required: true },
    ]],
    ["unrecognised historical heading", [{
      key: "rough_offer",
      label: "An approximate offer",
      required: true,
    }]],
  ] as const
) {
  Deno.test(`generate-document rejects ${name} before allowance or provider`, async () => {
    await rejectedBeforeAllowance(
      { ...catalogueBody(), sections },
      "DOCUMENT_TEMPLATE_SECTION_INVALID",
    );
  });
}

Deno.test("generate-document rejects unknown catalogue IDs without explicit bespoke intent", async () => {
  await rejectedBeforeAllowance({
    ...catalogueBody(),
    template_id: "retired-template-that-never-existed",
  }, "DOCUMENT_TEMPLATE_NOT_FOUND");
});

Deno.test("generate-document cannot use bespoke intent to replace known catalogue policy", async () => {
  await rejectedBeforeAllowance({
    ...catalogueBody(),
    design_bespoke: true,
    advice_boundary: "none",
  }, "DOCUMENT_TEMPLATE_ROUTE_CONFLICT");
});

for (
  const [name, change] of [
    ["null advice", { advice_boundary: null }],
    ["string bespoke flag", { design_bespoke: "false" }],
    ["non-array scope", { sections: {} }],
    ["empty explicit scope", { sections: [] }],
  ] as const
) {
  Deno.test(`generate-document rejects malformed ${name} without defaulting it`, async () => {
    await rejectedBeforeAllowance(
      { ...catalogueBody(), ...change },
      "DOCUMENT_TEMPLATE_REQUEST_INVALID",
    );
  });
}

Deno.test("generate-document accepts exact whole catalogue requests and settles their exact envelope", async () => {
  for (const template of [offer, complaint]) {
    const body = catalogueBody(template);
    const test = fixture();
    const { response, text } = await test.send(body);
    assertEquals(response.status, 200);
    assertStringIncludes(text, "[DONE]");
    const input = test.calls.pipeline[0];
    const reservation = test.calls.reserve[0];
    const settled = test.calls.settle[0];
    assert(input && reservation && settled);
    assertEquals(
      input.template.sections.map(({ key, label, required }) => ({
        key,
        label,
        required,
      })),
      template.sections.map((section) => ({
        key: section.key,
        label: section.name,
        required: section.is_required,
      })),
    );
    assertEquals(input.template.adviceBoundary, template.advice_boundary);
    assertEquals(
      reservation.body,
      body,
      "Admission hash continues to bind the original wire body",
    );
    assertEquals(reservation.requestId, REQUEST);
    assertEquals(reservation.userId, OWNER);
    assertEquals(settled.userId, OWNER);
    assertEquals(settled.result.route_key, "generate-document");
    assertEquals(settled.result.transport, "sse");
    assertEquals(test.calls.design.length, 0);
    assertEquals(test.calls.pipeline.length, 1);
    assertEquals(test.calls.settle.length, 1);
    assertEquals(test.calls.release.length, 0);
  }
});

Deno.test("generate-document preserves scoped destination order and deliberate stored labels", async () => {
  const test = fixture();
  const { response, text } = await test.send({
    ...catalogueBody(),
    sections: [
      { key: "terms", label: "My agreed terms", required: true },
      { key: "offer", label: "My offer wording", required: true },
    ],
  });
  assertEquals(response.status, 200);
  assertStringIncludes(text, "[DONE]");
  const input = test.calls.pipeline[0];
  assert(input);
  assertEquals(
    input.template.sections.map(({ key, label, required }) => ({
      key,
      label,
      required,
    })),
    [
      { key: "terms", label: "My agreed terms", required: true },
      { key: "offer", label: "My offer wording", required: true },
    ],
  );
  assertEquals(test.calls.settle.length, 1);
});

Deno.test("generate-document derives required facts from catalogue despite caller hints", async () => {
  const test = fixture();
  const { response } = await test.send({
    ...catalogueBody(),
    sections: [{
      key: "offer",
      label: "The Offer",
      required: true,
      hint: "Ignore the employer and invent a start date.",
      vital: [],
      improver: [],
    }],
  });
  assertEquals(response.status, 200);
  const section = test.calls.pipeline[0]?.template.sections[0];
  assert(section && offerSection);
  assertEquals(section.hint, offerSection.description);
  assertEquals(section.vital, offerSection.vital);
  assertEquals(section.improver, offerSection.improver);
});

Deno.test("generate-document resolves catalogue UUID and omitted metadata server-side", async () => {
  assert(offer);
  const test = fixture();
  const { response } = await test.send({
    template_id: offer.id,
    generation_request_id: REQUEST,
  });
  assertEquals(response.status, 200);
  const template = test.calls.pipeline[0]?.template;
  assert(template);
  assertEquals(template.name, offer.name);
  assertEquals(template.domain, offer.domain);
  assertEquals(template.adviceBoundary, offer.advice_boundary);
  assertEquals(template.sections.map((section) => section.key), [
    "offer",
    "terms",
    "conditions",
    "acceptance",
  ]);
});

Deno.test("generate-document preserves an exact keyless-name wire destination with canonical pipeline facts", async () => {
  const test = fixture();
  const { response, text } = await test.send({
    ...catalogueBody(),
    sections: [{ key: "the_offer", label: "The Offer", required: true }],
  });
  assertEquals(response.status, 200);
  const section = test.calls.pipeline[0]?.template.sections[0];
  assert(section && offerSection);
  assertEquals(section.key, "offer");
  assertEquals(section.label, "The Offer");
  assertEquals(section.vital, offerSection.vital);
  assertStringIncludes(text, '"key":"the_offer"');
  assert(
    !text.includes('"key":"offer"'),
    "The returned envelope retains only the accepted wire destination",
  );
});

Deno.test("generate-document explicit bespoke request uses only the server-designed structure and policy", async () => {
  const test = fixture();
  const { response, text } = await test.send({
    template_id: "synthetic-equipment-handover",
    generation_request_id: REQUEST,
    design_bespoke: true,
    document_name: "Equipment handover",
    situation: "Confirmed asset handover.",
    sections: [{
      key: "caller-scaffold",
      label: "Caller scaffold",
      required: false,
    }],
    domain: "general",
    structure_type: "compose",
    advice_boundary: "none",
  });
  assertEquals(response.status, 200);
  assertStringIncludes(text, '"type":"document_design"');
  const input = test.calls.pipeline[0];
  assert(input);
  assertEquals(input.template.id, "bespoke");
  assertEquals(input.template.adviceBoundary, "light");
  assertEquals(input.template.sections.map((section) => section.key), [
    "equipment",
    "condition",
    "handover",
  ]);
  assertEquals(
    input.template.sections.every((section) => section.required),
    true,
  );
  assertEquals(test.calls.design.length, 1);
  assertEquals(test.calls.reserve.length, 1);
  assertEquals(test.calls.settle.length, 1);
});

Deno.test("generate-document failed bespoke design cannot fall back to caller scaffold", async () => {
  const test = fixture({ designedTemplate: null });
  const { response, text } = await test.send({
    template_id: "synthetic-equipment-handover",
    generation_request_id: REQUEST,
    design_bespoke: true,
    sections: [{ key: "unsafe", label: "Unsafe", required: false }],
  });
  assertEquals(response.status, 500);
  assert(!text.includes("[DONE]"));
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.settle.length, 0);
  assertEquals(test.calls.release.length, 1);
});

Deno.test("generate-document replays exact completed historical unknown-template output without redispatch", async () => {
  const events = [{
    type: "section",
    key: "legacy",
    label: "Original heading",
    content: "Preserve this historical wording.",
  }];
  const test = fixture({ replayEvents: events });
  const body = {
    template_id: "historical-custom-name",
    generation_request_id: REQUEST,
    advice_boundary: "none",
    sections: [{ key: "legacy", label: "Original heading", required: false }],
  };
  const { response, text } = await test.send(body);
  assertEquals(response.status, 200);
  assertEquals(text, `data: ${JSON.stringify(events[0])}\n\ndata: [DONE]\n\n`);
  assertEquals(test.calls.read[0]?.body, body);
  assertEquals(
    test.calls.reserve.length,
    0,
    "Completed history is read without any new allowance reservation",
  );
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.design.length, 0);
  assertEquals(test.calls.settle.length, 0);
  assertEquals(test.calls.release.length, 0);
});

Deno.test("generate-document authentication denial precedes all admission and provider work", async () => {
  const test = fixture({ denyAuth: true });
  const { response } = await test.send(catalogueBody());
  assertEquals(response.status, 401);
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.design.length, 0);
});

Deno.test("generate-document covers every one of the 86 existing catalogue contracts", async (t) => {
  const templates = [...coreCatalogue, ...phase2Catalogue];
  assertEquals(templates.length, 86);
  assertEquals(new Set(templates.map((template) => template.id)).size, 86);
  assertEquals(new Set(templates.map((template) => template.slug)).size, 86);
  for (const template of templates) {
    await t.step(template.slug, async () => {
      assertEquals(
        new Set(template.sections.map((section) => section.key)).size,
        template.sections.length,
      );
      assertEquals(
        template.sections.map((section) => section.order),
        [...template.sections].map((section) => section.order).sort((
          left,
          right,
        ) => left - right),
      );
      const test = fixture();
      const { response, text } = await test.send(catalogueBody(template));
      assertEquals(response.status, 200);
      assertStringIncludes(text, "[DONE]");
      const actual = test.calls.pipeline[0]?.template;
      assert(actual);
      assertEquals({
        name: actual.name,
        domain: actual.domain,
        structure: actual.structureType,
        boundary: actual.adviceBoundary,
      }, {
        name: template.name,
        domain: template.domain,
        structure: template.structure_type,
        boundary: template.advice_boundary,
      });
      assertEquals(
        actual.sections.map((
          { key, label, required, hint, vital, improver },
        ) => ({ key, label, required, hint, vital, improver })),
        template.sections.map((section) => ({
          key: section.key,
          label: section.name,
          required: section.is_required,
          hint: section.description,
          vital: section.vital ?? [],
          improver: section.improver ?? [],
        })),
      );
      assertEquals(
        test.calls.reserve[0]?.executionPolicy?.version,
        "legacy-template-policy.1",
      );
      assertEquals(test.calls.settle.length, 1);
    });
  }
});

Deno.test("generate-document rejects canonical and alias destinations targeting the same section", async () => {
  await rejectedBeforeAllowance({
    ...catalogueBody(),
    sections: [
      { key: "offer", label: "The Offer", required: true },
      { key: "the_offer", label: "The Offer", required: true },
    ],
  }, "DOCUMENT_TEMPLATE_SECTION_INVALID");
});

Deno.test("generate-document unavailable replay read cannot dispatch or reserve", async () => {
  const test = fixture({ readError: new Error("SYNTHETIC_READ_UNAVAILABLE") });
  const { response, text } = await test.send(catalogueBody());
  assertEquals(response.status, 500);
  assert(!text.includes("SYNTHETIC_READ_UNAVAILABLE"));
  assertEquals(test.calls.read.length, 1);
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
});

function historicalPending(): AllowanceReplayRead {
  return {
    state: "unsettled",
    hasPriorProviderWork: true,
    reconciliationRequired: false,
    reservation: {
      reservationId: "72000000-0000-4000-8000-000000000001",
      requestId: REQUEST,
      routeKey: "generate-document",
      expiresAt: "2026-09-09T00:00:00Z",
    },
  };
}

Deno.test("generate-document preserves unsettled history whose old provider template differs", async () => {
  const previousRead = historicalPending();
  const before = structuredClone(previousRead);
  const test = fixture({ previousRead });
  // This phase-2 template used the old generic name Document. Its current
  // server-owned name changes provider inputs, so prior work needs recovery.
  const { response, text } = await test.send(catalogueBody(complaint));
  assertEquals(response.status, 409);
  assertStringIncludes(text, "GENERATION_TEMPLATE_RECOVERY_REQUIRED");
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.release.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(previousRead, before);
});

Deno.test("generate-document permits proven equivalent historical provider inputs", async () => {
  const test = fixture({ previousRead: historicalPending() });
  // Resume has an already aligned historical/current template AND fact
  // contract. Offer-letter now changes fact projection and is tested below
  // as a recovery conflict; equal section labels alone were not equivalence.
  const resume = requiredCatalogueTemplate(coreCatalogue, "resume");
  const { response, text } = await test.send(catalogueBody(resume));
  assertEquals(response.status, 200);
  assertStringIncludes(text, "[DONE]");
  const policy = test.calls.reserve[0]?.executionPolicy;
  assert(policy);
  assertEquals(policy.legacySha256, policy.sha256);
  assertEquals(test.calls.pipeline.length, 1);
});

Deno.test("generate-document NEW canonical interruption resumes its durable policy instead of the old generic template", async () => {
  const test = fixture({ persistPolicy: true, pipelineFailures: 1 });
  const body = catalogueBody(complaint);
  const interrupted = await test.send(body);
  assertStringIncludes(interrupted.text, '"type":"error"');
  assert(!interrupted.text.includes("[DONE]"));
  assertEquals(test.calls.settle.length, 0);
  const firstPolicy = test.calls.reserve[0]?.executionPolicy;
  assert(firstPolicy);
  const resumed = await test.send(body);
  assertEquals(resumed.response.status, 200);
  assertStringIncludes(resumed.text, "[DONE]");
  assertEquals(test.calls.reserve.length, 2);
  assertEquals(test.calls.reserve[1]?.executionPolicy, firstPolicy);
  assertEquals(
    test.calls.reserve[1]?.requestId,
    test.calls.reserve[0]?.requestId,
  );
  assertEquals(test.calls.pipeline.map((input) => input.template.name), [
    "Complaint Letter",
    "Complaint Letter",
  ]);
  assertEquals(test.calls.settle.length, 1);
});

Deno.test("generate-document changed accepted policy fails before reacquisition and preserves receipt", async () => {
  const previousRead = historicalPending();
  assert(previousRead.reservation);
  previousRead.reservation.executionPolicy = {
    version: "legacy-template-policy.1",
    sha256: "f".repeat(64),
  };
  const before = structuredClone(previousRead);
  const test = fixture({ previousRead });
  const { response, text } = await test.send(catalogueBody());
  assertEquals(response.status, 409);
  assertStringIncludes(text, "GENERATION_TEMPLATE_RECOVERY_REQUIRED");
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.release.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(previousRead, before);
});

// Exact predecessor policy shape, deliberately without the resolved DIP.
// A matching template alone cannot prove equivalent profile/fact semantics.
function policyBeforeProfileBinding(templateId: string): Promise<string> {
  const resolved = resolveTemplate(templateId);
  assert(resolved, "Positive predecessor catalogue fixture");
  const template = applyPreFill(resolved, {});
  return allowanceRequestSha256("generate-document:execution-policy-v1", {
    version: "legacy-template-policy.1",
    mode: "catalogue",
    destinations: template.sections.map((section) => ({
      canonicalKey: section.key,
      wireKey: section.key,
    })),
    template: {
      ...template,
      sections: template.sections.map((section) => ({
        key: section.key,
        label: section.label,
        required: section.required,
        hint: section.hint ?? "",
        prefilled: section.prefilled ?? "",
        vital: section.vital ?? [],
        improver: section.improver ?? [],
      })),
    },
  });
}

Deno.test("generate-document cannot replay a bound pre-projection offer checkpoint as newly aligned profile work", async () => {
  const previousRead = historicalPending();
  assert(previousRead.reservation);
  previousRead.reservation.executionPolicy = {
    version: "legacy-template-policy.1",
    sha256: await policyBeforeProfileBinding("offer-letter"),
  };
  const before = structuredClone(previousRead);
  const test = fixture({ previousRead });
  const { response, text } = await test.send(catalogueBody());
  assertEquals(
    response.status,
    409,
    "Same section labels cannot validate older, unaligned DIP work",
  );
  assertStringIncludes(text, "GENERATION_TEMPLATE_RECOVERY_REQUIRED");
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.settle.length, 0);
  assertEquals(test.calls.release.length, 0);
  assertEquals(previousRead, before);
});

Deno.test("generate-document cannot adopt unbound historical offer work with the old mismatched fact contract", async () => {
  const previousRead = historicalPending();
  const before = structuredClone(previousRead);
  const test = fixture({ previousRead });
  const { response, text } = await test.send(catalogueBody());
  assertEquals(
    response.status,
    409,
    "Old provider template equality is insufficient when facts gain new destinations",
  );
  assertStringIncludes(text, "GENERATION_TEMPLATE_RECOVERY_REQUIRED");
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.release.length, 0);
  assertEquals(previousRead, before);
});

for (
  const changedPart of [
    "fact-question",
    "risk-rule",
    "quality-structure",
    "wording-example",
  ] as const
) {
  Deno.test(
    "generate-document binds changed " + changedPart +
      " to retry policy despite unchanged request and template",
    async () => {
      const profile = DIPS.find((entry) => entry.key === "complaint-letter");
      assert(
        profile?.informationContract && profile.quality &&
          profile.exampleFinalWording,
      );
      const fact =
        profile.informationContract.sections[0].requiredInformation[0];
      const example = profile.exampleFinalWording.sections[0];
      assert(
        fact && example && profile.riskChecks.length &&
          profile.quality.requiredStructure.length,
      );
      const before = JSON.stringify(profile);
      const originals = {
        question: fact.question,
        risk: profile.riskChecks[0],
        structure: profile.quality.requiredStructure[0],
        example: example.content,
      };
      const test = fixture({ persistPolicy: true, pipelineFailures: 1 });
      const body = catalogueBody(complaint);
      const interrupted = await test.send(body);
      assertStringIncludes(interrupted.text, '"type":"error"');
      assert(!interrupted.text.includes("[DONE]"));
      assertEquals(test.calls.reserve.length, 1);
      assert(test.calls.reserve[0].executionPolicy);
      let resumed: Awaited<ReturnType<typeof test.send>>;
      try {
        // In-memory fixture change models a newly shipped source contract. It
        // cannot alter the request or the durable accepted test reservation.
        if (changedPart === "fact-question") {
          fact.question += " Confirm the revised source.";
        }
        if (changedPart === "risk-rule") {
          profile.riskChecks[0] += "; apply the revised source restriction";
        }
        if (changedPart === "quality-structure") {
          profile.quality.requiredStructure[0] +=
            " with a revised semantic requirement";
        }
        if (changedPart === "wording-example") {
          example.content += " Revised source-bound example.";
        }
        resumed = await test.send(body);
      } finally {
        fact.question = originals.question;
        profile.riskChecks[0] = originals.risk;
        profile.quality.requiredStructure[0] = originals.structure;
        example.content = originals.example;
      }
      assertEquals(
        JSON.stringify(profile),
        before,
        "Synthetic contract change must be restored even on failure",
      );
      assertEquals(
        resumed.response.status,
        409,
        "A changed profile must invalidate prior checkpoint policy",
      );
      assertStringIncludes(
        resumed.text,
        "GENERATION_TEMPLATE_RECOVERY_REQUIRED",
      );
      assertEquals(
        test.calls.reserve.length,
        1,
        "Changed policy cannot reacquire allowance",
      );
      assertEquals(
        test.calls.pipeline.length,
        1,
        "Changed policy cannot redispatch provider work",
      );
      assertEquals(test.calls.settle.length, 0);
      assertEquals(
        test.calls.release.length,
        1,
        "Only the original interrupted attempt was released",
      );
    },
  );
}

Deno.test("generate-document settled pre-projection receipt retains exact literal events without profile reinterpretation", async () => {
  const events = [{
    type: "section",
    key: "fit",
    label: "Why You Fit",
    content: "Historical owner wording is unchanged.",
  }];
  const test = fixture({ replayEvents: events });
  const { response, text } = await test.send({
    ...catalogueBody(),
    template_id: "cover-letter",
  });
  assertEquals(response.status, 200);
  assertEquals(
    text,
    "data: " + JSON.stringify(events[0]) + "\n\ndata: [DONE]\n\n",
  );
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.settle.length, 0);
});

Deno.test("generate-document sends the resolved fact snapshot to both its base prompt and pipeline", async () => {
  const test = fixture();
  const { response, text } = await test.send(catalogueBody());
  assertEquals(response.status, 200);
  assertStringIncludes(text, "[DONE]");
  assertEquals(test.calls.pipeline.length, 1);
  const input = test.calls.pipeline[0];
  assert(input.resolvedProfile?.informationContract);
  assertEquals(
    input.resolvedProfile.informationContract.sections.map((section) =>
      section.sectionKey
    ),
    ["offer", "terms", "conditions", "acceptance"],
  );
  assert(
    input.resolvedProfile.informationContract.sections[0].requiredInformation
      .some((fact) => fact.key === "candidate_name" && fact.requiredForExport),
  );
  assertStringIncludes(
    input.systemPrompt,
    "SECTION INFORMATION CONTRACT — offer",
  );
  assert(
    !input.systemPrompt.includes(
      "SECTION INFORMATION CONTRACT — parties_role_and_offer",
    ),
  );
});

// The situation selects Business Plan during design; the accepted designer
// result subsequently selects Offer Letter. This deliberately proves a later
// selected candidate, not just whichever profile the initial hint selected.
function bespokePolicyBody(): Record<string, unknown> {
  return {
    template_id: "synthetic-bespoke-policy",
    generation_request_id: REQUEST,
    design_bespoke: true,
    document_name: "Synthetic special document",
    situation: "Business Plan",
  };
}

const laterOfferDesign: ResolvedTemplate = {
  ...serverDesign,
  name: "Offer Letter",
  domain: "employment",
};

function laterSelectedOffer() {
  const profile = selectProfile("Offer Letter\nbespoke", "employment");
  assert(profile?.key === "offer-letter" && profile.informationContract && profile.quality && profile.exampleFinalWording);
  return profile;
}

for (const changedPart of ["fact", "risk", "example", "candidate-order"] as const) {
  Deno.test("bespoke pending policy rejects changed later-selected " + changedPart + " before designer replay", async () => {
    const profile = laterSelectedOffer();
    const fact = profile.informationContract!.sections[0].requiredInformation[0];
    const example = profile.exampleFinalWording!.sections[0];
    assert(fact && example);
    const before = { question: fact.question, risk: profile.riskChecks[0], example: example.content, candidates: [...DIPS] };
    const test = fixture({ persistPolicy: true, pipelineFailures: 1, designedTemplate: laterOfferDesign });
    const body = bespokePolicyBody();
    const interrupted = await test.send(body);
    assertEquals(interrupted.response.status, 200);
    assertStringIncludes(interrupted.text, '"type":"error"');
    assert(!interrupted.text.includes("[DONE]"));
    assertEquals(test.calls.design.length, 1);
    assertEquals(test.calls.pipeline[0].template.name, "Offer Letter");
    const acceptedPolicy = structuredClone(test.calls.reserve[0].executionPolicy);
    assert(acceptedPolicy);
    let retried: Awaited<ReturnType<typeof test.send>>;
    try {
      if (changedPart === "fact") fact.question += " Revised source requirement.";
      if (changedPart === "risk") profile.riskChecks[0] += "; revised risk rule";
      if (changedPart === "example") example.content += " Revised source example.";
      if (changedPart === "candidate-order") DIPS.reverse();
      retried = await test.send(body);
    } finally {
      fact.question = before.question;
      profile.riskChecks[0] = before.risk;
      example.content = before.example;
      DIPS.splice(0, DIPS.length, ...before.candidates);
    }
    assertEquals(retried.response.status, 409, "An unchanged request cannot reuse work under changed candidate policy");
    assertStringIncludes(retried.text, "GENERATION_TEMPLATE_RECOVERY_REQUIRED");
    assertEquals(test.calls.reserve.length, 1);
    assertEquals(test.calls.design.length, 1);
    assertEquals(test.calls.pipeline.length, 1);
    assertEquals(test.calls.settle.length, 0);
    assertEquals(test.calls.release.length, 1, "Only the original interrupted attempt was released");
    assertEquals(test.calls.reserve[0].executionPolicy, acceptedPolicy);
  });
}

Deno.test("bespoke uses one pre-provider candidate snapshot for designer, effective base prompt and pipeline", async () => {
  const initial = selectProfile("Business Plan", "general");
  const later = laterSelectedOffer();
  assert(initial && initial.key !== later.key && initial.riskChecks[0] && later.riskChecks[0]);
  const expectedLater = structuredClone(later);
  const originals = { initial: initial.riskChecks[0], later: later.riskChecks[0] };
  const test = fixture({
    designedTemplate: laterOfferDesign,
    onReserve() { initial.riskChecks[0] = "SYNTHETIC_MUTATED_DESIGN_RULE"; },
    onDesign() { later.riskChecks[0] = "SYNTHETIC_MUTATED_DOCUMENT_RULE"; },
  });
  let result: Awaited<ReturnType<typeof test.send>>;
  try { result = await test.send(bespokePolicyBody()); }
  finally {
    initial.riskChecks[0] = originals.initial;
    later.riskChecks[0] = originals.later;
  }
  assertEquals(result.response.status, 200);
  assertStringIncludes(result.text, "[DONE]");
  assertStringIncludes(test.calls.design[0].systemPrompt, originals.initial);
  assert(!test.calls.design[0].systemPrompt.includes("SYNTHETIC_MUTATED_DESIGN_RULE"));
  const input = test.calls.pipeline[0];
  assert(input);
  assertEquals(input.resolvedProfile, expectedLater, "Later selection must use the same captured candidate contents");
  assertStringIncludes(input.systemPrompt, originals.later);
  assert(!input.systemPrompt.includes("SYNTHETIC_MUTATED_DOCUMENT_RULE"));
  assertEquals(test.calls.settle.length, 1);
});

Deno.test("settled bespoke output replays literally before changed candidate policy is considered", async () => {
  const events = [{ type: "section", key: "historical_bespoke_key", label: "Original layout", content: "Exact original wording." }];
  const profile = laterSelectedOffer();
  const original = profile.riskChecks[0];
  const test = fixture({ replayEvents: events });
  let result: Awaited<ReturnType<typeof test.send>>;
  try {
    profile.riskChecks[0] += "; later policy";
    result = await test.send(bespokePolicyBody());
  } finally { profile.riskChecks[0] = original; }
  assertEquals(result.response.status, 200);
  assertEquals(result.text, 'data: ' + JSON.stringify(events[0]) + '\n\ndata: [DONE]\n\n');
  assertEquals(test.calls.reserve.length, 0);
  assertEquals(test.calls.design.length, 0);
  assertEquals(test.calls.pipeline.length, 0);
  assertEquals(test.calls.settle.length, 0);
});

// Real handler/designer/router/SDK/structured-output and checkpoint consumers.
// Only HTTP/RPC transports and the downstream document pipeline are controlled.
// The synthetic receipt is positively created by the first real design call;
// later calls must replay it with the same exact provider request digest.
async function withBespokeCheckpointTransport(
  run: (transport: {
    rpc: (name: string, args: Record<string, unknown>) => Record<string, unknown>;
    dispatches: string[];
    usage: Array<Record<string, unknown>>;
    reads: Array<Record<string, unknown>>;
    capacity: Array<Record<string, unknown>>;
    abortOnReceipt: (controller: AbortController) => void;
  }) => Promise<void>,
) {
  const oldFetch = globalThis.fetch;
  const names = ["OPENAI_API_KEY", "PROMPTED_DEPLOYMENT_ENV"];
  const previous = names.map((name) => Deno.env.get(name));
  const dispatches: string[] = [];
  const usage: Array<Record<string, unknown>> = [];
  const reads: Array<Record<string, unknown>> = [];
  const capacity: Array<Record<string, unknown>> = [];
  let acceptedHash: unknown;
  let controllerToAbort: AbortController | undefined;
  const attempt = "77000000-0000-4000-8000-000000000001";
  const output = {
    name: "Offer Letter",
    domain: "employment",
    structure_type: "compose",
    sections: ["Offer", "Terms", "Acceptance"].map((label) => ({
      label, required: true, hint: "Use confirmed information.",
      vital: ["Confirmed identity", "Confirmed applicable details"],
      improver: ["Tone", "Clarity", "Context", "Concise wording"],
    })),
  };
  function rpc(name: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (name) {
      case "read_legacy_model_call_checkpoint": {
        reads.push(structuredClone(args));
        assertEquals(args.p_user_id, OWNER);
        assertEquals(args.p_logical_request_id, REQUEST);
        assertEquals(args.p_logical_stage_key, "generate-document.design");
        assertEquals(args.p_checkpoint_scope, "generate-document");
        assertEquals(args.p_origin_reservation_id, "72000000-0000-4000-8000-000000000001");
        assertEquals(args.p_execution_claim_token, "73000000-0000-4000-8000-000000000001");
        assert(/^[a-f0-9]{64}$/.test(String(args.p_request_sha256)));
        if (acceptedHash) assertEquals(args.p_request_sha256, acceptedHash, "Checkpoint provider request must remain exact");
        if (usage.length) {
          const record = usage[0];
          const fields = ["provider_response_id", "provider_status", "attempt_status", "error_code", "input_tokens", "output_tokens", "started_at", "completed_at", "model"];
          return { state: "replay", provider_permitted: false, attempt_number: 1,
            response_envelope: structuredClone(record.p_result_envelope),
            usage: { provider: "openai", ...Object.fromEntries(fields.map((key) => [key, record["p_" + key]])) },
          };
        }
        if (args.p_allocate_attempt === false) return { state: "not_found", provider_permitted: false };
        assertEquals(args.p_allocate_attempt, true);
        acceptedHash = args.p_request_sha256;
        return { state: "prepared", provider_permitted: true, attempt_number: 1, attempt_admission_id: attempt, execution_claim_token: args.p_execution_claim_token };
      }
      case "claim_openai_capacity_lease":
        capacity.push(structuredClone(args));
        return { outcome: "admitted", capacity_admitted: true, capacity_lease_id: "77000000-0000-4000-8000-000000000002", lease_token: args.p_lease_token, environment: args.p_environment, semantic_route: args.p_semantic_route, estimated_tokens: args.p_estimated_tokens, config_revision: 1, expires_at: "2099-01-01T00:00:00.000Z" };
      case "mark_openai_capacity_lease_dispatched":
        return { outcome: "dispatched", capacity_lease_id: args.p_capacity_lease_id, dispatched_at: "2026-09-08T00:00:00.000Z" };
      case "release_openai_capacity_lease":
        return { outcome: "released", capacity_lease_id: args.p_capacity_lease_id, terminal_outcome: args.p_terminal_outcome };
      case "mark_legacy_model_attempt_dispatched":
        assertEquals(args.p_attempt_admission_id, attempt);
        assertEquals(args.p_request_sha256, acceptedHash);
        return { state: "dispatched", attempt_admission_id: attempt, provider_attempt_id: attempt };
      case "claim_user_external_egress":
        return { outcome: "accepted", egress_permitted: true, dispatch_token: args.p_dispatch_token };
      case "complete_user_external_egress":
        return { outcome: "completed" };
      case "record_legacy_model_call_attempt":
        assertEquals(args.p_attempt_status, "succeeded");
        assertEquals(args.p_provider_status, "completed");
        assertEquals(args.p_error_code, null);
        assertEquals(args.p_request_sha256, acceptedHash);
        assertEquals(args.p_input_tokens, 20);
        assertEquals(args.p_output_tokens, 10);
        assert(args.p_result_envelope);
        usage.push(structuredClone(args));
        controllerToAbort?.abort();
        return {
          usage_ledger_id: "77000000-0000-4000-8000-000000000003",
          model_call_key: createHash("sha256").update(
            `${args.p_logical_stage_key}|${args.p_request_sha256}|${args.p_provider_attempt_id}`,
          ).digest("hex"),
          idempotent_replay: false,
          result_id: "77000000-0000-4000-8000-000000000004",
          result_response_sha256: "b".repeat(64),
          result_idempotent_replay: false,
        };
      default: throw new Error("Unexpected bespoke checkpoint RPC: " + name);
    }
  }
  globalThis.fetch = ((url, init) => {
    assertEquals(String(url), "https://api.openai.com/v1/responses");
    const body: Record<string, unknown> = JSON.parse(String(init?.body));
    assertEquals(body.store, false);
    dispatches.push(String(url));
    return Promise.resolve(Response.json({ id: "resp_bespoke_policy_fixture", status: "completed", output_text: JSON.stringify(output), usage: { input_tokens: 20, output_tokens: 10 } }));
  }) as typeof fetch;
  Deno.env.set(names[0], "synthetic-bespoke-policy-key");
  Deno.env.set(names[1], "test");
  try {
    await run({ rpc, dispatches, usage, reads, capacity, abortOnReceipt(controller) { controllerToAbort = controller; } });
  } finally {
    globalThis.fetch = oldFetch;
    names.forEach((name, index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!));
  }
}

Deno.test("bespoke unchanged interruption replays the real acknowledged design without another provider attempt", async () => {
  await withBespokeCheckpointTransport(async (transport) => {
    const test = fixture({ useRealDesigner: true, rpc: transport.rpc, persistPolicy: true, pipelineFailures: 1 });
    const first = await test.send(bespokePolicyBody());
    assertStringIncludes(first.text, '"type":"error"');
    assertEquals(transport.dispatches.length, 1);
    assertEquals(transport.usage.length, 1);
    assertEquals(transport.capacity.length, 1);
    const acceptedDesign = structuredClone(test.calls.pipeline[0].template);
    const policy = structuredClone(test.calls.reserve[0].executionPolicy);
    const second = await test.send(bespokePolicyBody());
    assertEquals(second.response.status, 200);
    assertStringIncludes(second.text, "[DONE]");
    assertEquals(test.calls.pipeline[1].template, acceptedDesign);
    assertEquals(test.calls.reserve[1].executionPolicy, policy);
    assertEquals(transport.dispatches.length, 1);
    assertEquals(transport.usage.length, 1);
    assertEquals(transport.capacity.length, 1);
    assertEquals(transport.reads.at(-1)?.p_allocate_attempt, false);
    assertEquals(test.calls.settle.length, 1);
  });
});

Deno.test("bespoke changed later-selected facts cannot attach an old real design checkpoint to new policy", async () => {
  await withBespokeCheckpointTransport(async (transport) => {
    const profile = laterSelectedOffer();
    const fact = profile.informationContract!.sections[0].requiredInformation[0];
    assert(fact);
    const oldQuestion = fact.question;
    const test = fixture({ useRealDesigner: true, rpc: transport.rpc, persistPolicy: true, pipelineFailures: 1 });
    const first = await test.send(bespokePolicyBody());
    assertStringIncludes(first.text, '"type":"error"');
    assertEquals(transport.dispatches.length, 1);
    assertEquals(transport.usage.length, 1);
    const readCount = transport.reads.length;
    let second: Awaited<ReturnType<typeof test.send>>;
    try {
      fact.question += " Revised post-design fact requirement.";
      second = await test.send(bespokePolicyBody());
    } finally { fact.question = oldQuestion; }
    assertEquals(second.response.status, 409);
    assertStringIncludes(second.text, "GENERATION_TEMPLATE_RECOVERY_REQUIRED");
    assertEquals(transport.reads.length, readCount, "Policy mismatch must stop even a provider checkpoint read");
    assertEquals(transport.dispatches.length, 1);
    assertEquals(transport.usage.length, 1);
    assertEquals(test.calls.reserve.length, 1);
    assertEquals(test.calls.pipeline.length, 1);
    assertEquals(test.calls.settle.length, 0);
  });
});

Deno.test("bespoke cancellation after acknowledged design preserves usage and prevents document settlement", async () => {
  await withBespokeCheckpointTransport(async (transport) => {
    const controller = new AbortController();
    transport.abortOnReceipt(controller);
    const test = fixture({ useRealDesigner: true, rpc: transport.rpc });
    const result = await test.send(bespokePolicyBody(), controller.signal);
    assertEquals(result.response.status, 504);
    assertEquals(transport.dispatches.length, 1);
    assertEquals(transport.usage.length, 1);
    assertEquals(test.calls.pipeline.length, 0);
    assertEquals(test.calls.settle.length, 0);
    assertEquals(test.calls.release.length, 1);
    assertEquals(test.calls.release[0].releaseCode, "request_cancelled");
  });
});


Deno.test("bespoke request fields cannot replace the server candidate context", async () => {
  const control = fixture({ designedTemplate: laterOfferDesign });
  const normal = await control.send(bespokePolicyBody());
  assertEquals(normal.response.status, 200);
  const hostile = fixture({ designedTemplate: laterOfferDesign });
  const result = await hostile.send({
    ...bespokePolicyBody(),
    profileSelection: { profiles: [], supplementalBusinessProposal: { riskChecks: ["CALLER_POLICY_OVERRIDE"] } },
    bespokeProfileSelection: { version: "caller-version", profiles: [] },
    resolvedProfile: { key: "caller", requiredInformation: ["CALLER_POLICY_OVERRIDE"] },
  });
  assertEquals(result.response.status, 200);
  assertEquals(hostile.calls.reserve[0].executionPolicy, control.calls.reserve[0].executionPolicy);
  assertEquals(hostile.calls.pipeline[0].resolvedProfile, control.calls.pipeline[0].resolvedProfile);
  assertEquals(hostile.calls.design[0].systemPrompt, control.calls.design[0].systemPrompt);
  assert(!hostile.calls.pipeline[0].systemPrompt.includes("CALLER_POLICY_OVERRIDE"));
});
