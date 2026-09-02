import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const functionRoot = new URL("..", import.meta.url);

async function source(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(`${name}/index.ts`, functionRoot));
}

function assertOrdered(
  content: string,
  first: string,
  second: string,
  message: string,
): void {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  assert(firstIndex >= 0, `missing first marker: ${first}`);
  assert(secondIndex >= 0, `missing second marker: ${second}`);
  assert(firstIndex < secondIndex, message);
}

Deno.test("all legacy allowance routes use atomic admission instead of the racy guard count", async () => {
  for (
    const route of [
      "generate-document",
      "generate-checklist",
      "generate-report",
      "generate-artifact",
    ]
  ) {
    const content = await source(route);
    assertStringIncludes(content, "guardRequest(req, { enforceCap: false })");
    assertStringIncludes(content, "await reserveDocumentAllowance");
    assertStringIncludes(content, "await settleDocumentAllowance");
    assertStringIncludes(content, "await releaseDocumentAllowance");
    assertStringIncludes(content, "reservation.replayResult");
    assertStringIncludes(content, 'contract_version: "allowance-result.1"');
    assertStringIncludes(content, `route_key: "${route}"`);
    assertEquals(
      content.includes("trackDocumentCreated"),
      false,
      `${route} must not retain fire-and-forget allowance settlement`,
    );
  }
});

Deno.test("report is auth-gated and fails before every unsafe multi-call side effect", async () => {
  const content = await source("generate-report");
  assertOrdered(
    content,
    "await guardRequest(req, { enforceCap: false })",
    "return jsonResponse(REPORT_DURABLE_CHECKPOINT_REQUIRED, 409, origin)",
    "report checkpoint gate must remain behind authentication",
  );
  for (
    const forbiddenBeforeGate of [
      "loadUserMemoryContext(auth.admin",
      "resolveAllowanceRequestIdentity(",
      "await reserveDocumentAllowance",
      "const result = await routeRequest",
    ]
  ) {
    assertOrdered(
      content,
      "return jsonResponse(REPORT_DURABLE_CHECKPOINT_REQUIRED, 409, origin)",
      forbiddenBeforeGate,
      `report gate must precede ${forbiddenBeforeGate}`,
    );
  }
  assertStringIncludes(content, 'code: "REPORT_DURABLE_CHECKPOINT_REQUIRED"');
  assertStringIncludes(content, "persistence_eligible: false");
  assertStringIncludes(content, "completion_eligible: false");
  assertStringIncludes(content, "retryable: false");
});

Deno.test("all four routes hold ambiguous outcomes and retain ordinary failure release", async () => {
  for (
    const route of [
      "generate-document",
      "generate-checklist",
      "generate-report",
      "generate-artifact",
    ]
  ) {
    const content = await source(route);
    assertStringIncludes(content, "isProviderReconciliationRequired");
    assertStringIncludes(content, "holdDocumentAllowanceForReconciliation");
    assertStringIncludes(content, "RECONCILIATION_REQUIRED_PAYLOAD");
    assertStringIncludes(content, "await releaseDocumentAllowance");
    assertStringIncludes(content, "releaseCode: req.signal.aborted");
  }
});

Deno.test("document checkpoints the complete event envelope before exposing final output", async () => {
  const content = await source("generate-document");
  assertOrdered(
    content,
    "reservation = await reserveDocumentAllowance",
    "designedTemplate = await designBespokeTemplate",
    "bespoke provider work must follow admission",
  );
  assertOrdered(
    content,
    "reservation = await reserveDocumentAllowance",
    "pipelineResult = await runDocumentPipeline",
    "document provider work must follow admission",
  );
  assertStringIncludes(content, "payload: { events: responseEvents }");
  assertOrdered(
    content,
    "await settleDocumentAllowance",
    "for (const event of responseEvents) controller.enqueue(sseEvent(event))",
    "final document output must not be user-visible before its envelope is settled",
  );
  assert(
    content.lastIndexOf("await settleDocumentAllowance") <
      content.lastIndexOf("controller.enqueue(sseDone())"),
    "newly generated stream completion must follow settlement",
  );
});

Deno.test("checklist JSON success follows settlement", async () => {
  const content = await source("generate-checklist");
  assertOrdered(
    content,
    "reservation = await reserveDocumentAllowance",
    "let result = await makeRequest(false)",
    "checklist provider work must follow admission",
  );
  assertStringIncludes(content, "payload: { body: normalised }");
  assertOrdered(
    content,
    "await settleDocumentAllowance",
    "return jsonResponse(normalised, 200, origin)",
    "checklist 200 must follow settlement",
  );
});

Deno.test("report buffers final sections until settlement", async () => {
  const content = await source("generate-report");
  assertOrdered(
    content,
    "reservation = await reserveDocumentAllowance",
    "const result = await routeRequest",
    "report provider work must follow admission",
  );
  assertStringIncludes(content, "payload: { events: completedSections }");
  assertOrdered(
    content,
    "await settleDocumentAllowance",
    "for (const section of completedSections)",
    "report sections must follow settlement",
  );
});

Deno.test("gated artifact checkpoints one immutable final envelope before exposure", async () => {
  const content = await source("generate-artifact");
  assertOrdered(
    content,
    "reservation = await reserveDocumentAllowance",
    "const artifact = await runTedArtifactPipeline",
    "artifact provider work must follow admission",
  );
  assertStringIncludes(content, "payload: { events: responseEvents }");
  assertOrdered(
    content,
    "await settleDocumentAllowance",
    "for (const event of responseEvents) controller.enqueue(sseEvent(event))",
    "artifact blocks and completion must not be exposed before settlement",
  );
});

Deno.test("artifact proves outcome ownership before rollout and downstream work", async () => {
  const content = await source("generate-artifact");
  const ownerProof = "outcomeId = await requireOwnedArtifactOutcome(";
  assertOrdered(
    content,
    "auth = await guardRequest(req, { enforceCap: false })",
    ownerProof,
    "artifact ownership proof must remain behind authentication",
  );
  assertOrdered(
    content,
    ownerProof,
    "error instanceof ArtifactOutcomeAuthorizationError",
    "artifact owner lookup failure must be handled explicitly",
  );
  for (
    const [marker, label] of [
      ["if (!rolloutEnabled(kind, outcomeId))", "rollout selection"],
      ["const memory = await loadUserMemoryContext(", "memory loading"],
      ["reservation = await reserveDocumentAllowance(", "allowance reservation"],
      ["if (reservation.replayResult)", "durable replay exposure"],
      ["const artifact = await runTedArtifactPipeline(", "provider-backed generation"],
    ] as const
  ) {
    assertOrdered(
      content,
      ownerProof,
      marker,
      `artifact ownership proof must precede ${label}`,
    );
  }
});
