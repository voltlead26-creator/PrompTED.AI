// deno-lint-ignore no-import-prefix
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  artifactBytes,
  capturedExportCompletionMatches,
  capturedExportStoragePath,
  classifyCapturedExportReceipt,
  classifyLegacyPdfExportReceipt,
  createCapturedPdfInspectionExpectation,
  createLegacyPdfExportBinding,
  createLegacyPdfExportInputIdentity,
  inspectCapturedPdfArtifact,
  inspectStoredCapturedPdfArtifact,
  legacyPdfExportStoragePath,
  readBoundedResponseBytes,
  reconcileCapturedExportCompletion,
  requestCapturedExportStorageObject,
  requestRenderedPdf,
  restoreLegacyPdfExportBinding,
  sha256Hex,
  validateLegacyExportRequestIdentity,
  validateRenderServiceContract,
} from "./captured-artifact.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const LEGACY_REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const BRAND_EXPECTATION = {
  snapshotVersion: "prompted.export-brand-snapshot.v1" as const,
  snapshotSha256: "1".repeat(64),
  brandPresent: true,
  logoStoragePath:
    "brand-kits/88888888-8888-4888-8888-888888888888/logos/99999999-9999-8999-8999-999999999999.png",
  logoContentSha256: "2".repeat(64),
  logoMediaType: "image/png" as const,
  logoByteLength: 128,
  footerSha256: "3".repeat(64),
  primaryColour: "#123456",
  secondaryColour: "#abcdef",
  brandEvidenceSha256: "4".repeat(64),
};

Deno.test("marker-only PDF checks are transport evidence, not inspection", async () => {
  const valid = artifactBytes(`%PDF-1.7\n${"x".repeat(120)}\n%%EOF`);
  const expectation = await createCapturedPdfInspectionExpectation(
    "Example",
    [{ name: "Summary", content: "Verified content", order_index: 0 }],
  );
  const inspection = await inspectCapturedPdfArtifact(
    valid,
    new Headers(),
    expectation,
  );

  assertEquals(inspection.passed, false);
  assertEquals(inspection.artifactInspected, false);
  assertEquals(inspection.validationResult.checks.transport_envelope, true);
  assertEquals(inspection.validationResult.checks.renderer_structural, false);
});

Deno.test("captured PDF inspection requires exact structural, content, order, and artifact evidence", async () => {
  const bytes = artifactBytes(`%PDF-1.7\n${"x".repeat(120)}\n%%EOF`);
  const expectation = await createCapturedPdfInspectionExpectation(
    "Example",
    [
      { name: "First", content: "One", order_index: 0 },
      { name: "Second", content: "Two", order_index: 1 },
    ],
  );
  const artifactSha256 = await sha256Hex(bytes);
  const headers = new Headers({
    "x-prompted-inspection-version": "prompted.rendered-pdf.v1",
    "x-prompted-inspection-status": "passed",
    "x-prompted-pdf-structure": "passed",
    "x-prompted-content-sha256": expectation.contentSha256,
    "x-prompted-section-order-sha256": expectation.sectionOrderSha256,
    "x-prompted-artifact-sha256": artifactSha256,
  });

  const inspection = await inspectCapturedPdfArtifact(
    bytes,
    headers,
    expectation,
  );
  assertEquals(inspection.passed, true);
  assertEquals(inspection.artifactInspected, true);
  assertEquals(inspection.artifactSha256, artifactSha256);

  headers.set("x-prompted-section-order-sha256", "0".repeat(64));
  const mismatched = await inspectCapturedPdfArtifact(
    bytes,
    headers,
    expectation,
  );
  assertEquals(mismatched.passed, false);
  assertEquals(mismatched.artifactInspected, false);
});

Deno.test("captured PDF inspection v2 requires artifact-bound exact brand evidence", async () => {
  const bytes = artifactBytes(`%PDF-1.7\n${"b".repeat(120)}\n%%EOF`);
  const expectation = await createCapturedPdfInspectionExpectation(
    "Branded example",
    [{ name: "Summary", content: "Verified content", order_index: 0 }],
    BRAND_EXPECTATION,
  );
  const artifactSha256 = await sha256Hex(bytes);
  const headers = new Headers({
    "x-prompted-inspection-version": "prompted.rendered-pdf.v2",
    "x-prompted-inspection-status": "passed",
    "x-prompted-pdf-structure": "passed",
    "x-prompted-content-sha256": expectation.contentSha256,
    "x-prompted-section-order-sha256": expectation.sectionOrderSha256,
    "x-prompted-artifact-sha256": artifactSha256,
    "x-prompted-brand-snapshot-sha256": BRAND_EXPECTATION.snapshotSha256,
    "x-prompted-brand-evidence-sha256": BRAND_EXPECTATION.brandEvidenceSha256,
    "x-prompted-brand-logo-sha256": BRAND_EXPECTATION.logoContentSha256,
    "x-prompted-brand-footer-sha256": BRAND_EXPECTATION.footerSha256,
    "x-prompted-brand-primary-colour": BRAND_EXPECTATION.primaryColour,
    "x-prompted-brand-secondary-colour": BRAND_EXPECTATION.secondaryColour,
    "x-prompted-brand-snapshot-status": "passed",
    "x-prompted-brand-logo-status": "passed",
    "x-prompted-brand-footer-status": "passed",
    "x-prompted-brand-colours-status": "passed",
  });

  const inspected = await inspectCapturedPdfArtifact(
    bytes,
    headers,
    expectation,
  );
  assertEquals(inspected.passed, true);
  assertEquals(inspected.validationResult.artifact_sha256, artifactSha256);
  assertEquals(
    inspected.validationResult.brand_evidence_sha256,
    BRAND_EXPECTATION.brandEvidenceSha256,
  );
  assertEquals(inspected.validationResult.checks.brand_logo_matches, true);

  headers.delete("x-prompted-brand-logo-status");
  const missingLogoProof = await inspectCapturedPdfArtifact(
    bytes,
    headers,
    expectation,
  );
  assertEquals(missingLogoProof.passed, false);
  assertEquals(
    missingLogoProof.validationResult.checks.brand_logo_matches,
    false,
  );
});

Deno.test("captured storage recovery receipt is complete, exact, and rejects partial evidence", async () => {
  const expected = {
    exportId: EXPORT_ID,
    operationId: USER_ID,
    storagePath: `${USER_ID}/${EXPORT_ID}/document.pdf`,
    inspectionExpectation: await createCapturedPdfInspectionExpectation(
      "Example",
      [{ name: "Summary", content: "Verified", order_index: 0 }],
      BRAND_EXPECTATION,
    ),
  };
  const bytes = artifactBytes(`%PDF-1.7\n${"r".repeat(120)}\n%%EOF`);
  const artifactSha256 = await sha256Hex(bytes);
  const validation = (await inspectCapturedPdfArtifact(
    bytes,
    new Headers({
      "x-prompted-inspection-version": "prompted.rendered-pdf.v2",
      "x-prompted-inspection-status": "passed",
      "x-prompted-pdf-structure": "passed",
      "x-prompted-content-sha256": expected.inspectionExpectation.contentSha256,
      "x-prompted-section-order-sha256":
        expected.inspectionExpectation.sectionOrderSha256,
      "x-prompted-artifact-sha256": artifactSha256,
      "x-prompted-brand-snapshot-sha256": BRAND_EXPECTATION.snapshotSha256,
      "x-prompted-brand-evidence-sha256": BRAND_EXPECTATION.brandEvidenceSha256,
      "x-prompted-brand-logo-sha256": BRAND_EXPECTATION.logoContentSha256,
      "x-prompted-brand-footer-sha256": BRAND_EXPECTATION.footerSha256,
      "x-prompted-brand-primary-colour": BRAND_EXPECTATION.primaryColour,
      "x-prompted-brand-secondary-colour": BRAND_EXPECTATION.secondaryColour,
      "x-prompted-brand-snapshot-status": "passed",
      "x-prompted-brand-logo-status": "passed",
      "x-prompted-brand-footer-status": "passed",
      "x-prompted-brand-colours-status": "passed",
    }),
    expected.inspectionExpectation,
  )).validationResult;
  const receipt = classifyCapturedExportReceipt({
    outcome: "storage_recovery",
    export_id: EXPORT_ID,
    operation_id: USER_ID,
    storage_path: expected.storagePath,
    artifact_sha256: artifactSha256,
    artifact_byte_length: bytes.byteLength,
    renderer_version: "render-export.pdf.4",
    artifact_validation_result: {
      ...validation,
      content_type: "application/pdf",
    },
    expected_operation_revision: 7,
    storage_state: "dispatched",
    storage_dispatch_token: "55555555-5555-4555-8555-555555555555",
  }, expected);
  assertEquals(receipt.state, "storage_recovery");
  if (receipt.state === "storage_recovery") {
    assertEquals(receipt.expectedOperationRevision, 7);
    assertEquals(receipt.artifactByteLength, bytes.byteLength);
  }

  assertThrows(
    () =>
      classifyCapturedExportReceipt({
        outcome: "storage_recovery",
        export_id: EXPORT_ID,
        operation_id: USER_ID,
        storage_path: expected.storagePath,
        artifact_sha256: artifactSha256,
        artifact_byte_length: bytes.byteLength,
        renderer_version: "render-export.pdf.4",
        artifact_validation_result: {
          ...validation,
          content_type: "application/pdf",
        },
        expected_operation_revision: 7,
        storage_state: "dispatched",
        storage_dispatch_token: null,
      }, expected),
    Error,
    "CAPTURED_EXPORT_RECEIPT_INVALID",
  );
});

Deno.test("render service contract permits only the explicit approved public HTTPS origin", () => {
  assertEquals(
    validateRenderServiceContract({
      serviceUrl: "https://renderer.prompted.ai/v1/pdf",
      allowedOrigin: "https://renderer.prompted.ai",
      timeoutMs: "15000",
      maxResponseBytes: "1048576",
    }),
    {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 15000,
      maxResponseBytes: 1048576,
    },
  );

  for (
    const [serviceUrl, allowedOrigin] of [
      ["http://renderer.prompted.ai/v1/pdf", "http://renderer.prompted.ai"],
      [
        "https://user:pass@renderer.prompted.ai/v1/pdf",
        "https://renderer.prompted.ai",
      ],
      ["https://localhost/v1/pdf", "https://localhost"],
      ["https://127.0.0.1/v1/pdf", "https://127.0.0.1"],
      ["https://[::1]/v1/pdf", "https://[::1]"],
      ["https://renderer.prompted.ai/v1/pdf", "https://other.prompted.ai"],
      [
        "https://renderer.prompted.ai/v1/pdf?token=secret",
        "https://renderer.prompted.ai",
      ],
      [
        "https://renderer.prompted.ai/v1/pdf",
        "https://renderer.prompted.ai/path",
      ],
    ]
  ) {
    assertThrows(
      () => validateRenderServiceContract({ serviceUrl, allowedOrigin }),
      Error,
      "RENDER_SERVICE_CONFIGURATION_INVALID",
    );
  }
});

Deno.test("renderer response reads are bounded by header and streamed bytes", async () => {
  const withinLimit = await readBoundedResponseBytes(
    new Response(new Uint8Array([1, 2, 3])),
    3,
  );
  assertEquals([...withinLimit], [1, 2, 3]);

  await assertRejects(
    () =>
      readBoundedResponseBytes(
        new Response(new Uint8Array(5), {
          headers: { "content-length": "5" },
        }),
        4,
      ),
    Error,
    "RENDER_SERVICE_RESPONSE_TOO_LARGE",
  );

  await assertRejects(
    () =>
      readBoundedResponseBytes(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.enqueue(new Uint8Array([4, 5]));
              controller.close();
            },
          }),
        ),
        4,
      ),
    Error,
    "RENDER_SERVICE_RESPONSE_TOO_LARGE",
  );
});

Deno.test("renderer request aborts within its configured timeout", async () => {
  let aborted = false;
  const result = await requestRenderedPdf(
    {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 5,
      maxResponseBytes: 1024,
    },
    { html: "<p>Example</p>" },
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  );

  assertEquals(result, { state: "ambiguous_after_dispatch" });
  assertEquals(aborted, true);
});

Deno.test("a suspended renderer claimant cannot start after its durable lease window", async () => {
  const nowMs = Date.parse("2026-09-01T00:00:00.000Z");
  const contract = {
    endpoint: "https://renderer.prompted.ai/v1/pdf",
    origin: "https://renderer.prompted.ai",
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
  };
  let fetchCalls = 0;
  const fetcher = () => {
    fetchCalls += 1;
    return Promise.resolve(new Response("rejected", { status: 422 }));
  };

  const stale = await requestRenderedPdf(
    contract,
    { html: "<p>Deleted account content</p>" },
    fetcher,
    {
      leaseExpiresAt: new Date(nowMs + 30_999).toISOString(),
      now: () => nowMs,
    },
  );
  assertEquals(stale, { state: "definitive_terminal_failure" });
  assertEquals(fetchCalls, 0);

  const withinLease = await requestRenderedPdf(
    contract,
    { html: "<p>Authorized content</p>" },
    fetcher,
    {
      leaseExpiresAt: new Date(nowMs + 31_000).toISOString(),
      now: () => nowMs,
    },
  );
  assertEquals(withinLease, { state: "definitive_terminal_failure" });
  assertEquals(fetchCalls, 1);
});

Deno.test("definitive renderer rejection is distinct from dispatch ambiguity", async () => {
  const result = await requestRenderedPdf(
    {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 1000,
      maxResponseBytes: 1024,
    },
    { html: "<p>Example</p>" },
    () => Promise.resolve(new Response("rejected", { status: 422 })),
  );

  assertEquals(result, { state: "definitive_terminal_failure" });
});

Deno.test("renderer requests refuse redirects away from the approved endpoint", async () => {
  let observedRedirect: RequestRedirect | undefined;
  const rendered = await requestRenderedPdf(
    {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 1000,
      maxResponseBytes: 1024,
    },
    { html: "<p>Example</p>" },
    (_input, init) => {
      observedRedirect = init?.redirect;
      return Promise.resolve(
        new Response(`%PDF-1.7\n${"x".repeat(120)}\n%%EOF`, {
          headers: { "content-type": "application/pdf" },
        }),
      );
    },
  );

  assertEquals(observedRedirect, "error");
  assertEquals(rendered.state, "success");
  if (rendered.state !== "success") throw new Error("expected PDF success");
  assertEquals(rendered.bytes.byteLength, 135);
});

Deno.test("captured completion reconciliation accepts only the exact created artifact", () => {
  const expected = {
    exportId: EXPORT_ID,
    operationId: USER_ID,
    storagePath: `${USER_ID}/${EXPORT_ID}/document.pdf`,
    artifactSha256: "a".repeat(64),
    rendererVersion: "render-export.pdf.2",
  };
  const created = {
    export_id: EXPORT_ID,
    operation_id: USER_ID,
    status: "created",
    storage_path: expected.storagePath,
    artifact_sha256: expected.artifactSha256,
    renderer_version: expected.rendererVersion,
    artifact_validation_result: {
      passed: true,
      artifact_inspected: true,
      byte_length: 140,
    },
  };

  assertEquals(capturedExportCompletionMatches(created, expected), true);
  assertEquals(
    capturedExportCompletionMatches(
      { ...created, artifact_sha256: "b".repeat(64) },
      expected,
    ),
    false,
  );
});

Deno.test("lost completion responses are reconciled before artifact cleanup is considered", async () => {
  const expected = {
    exportId: EXPORT_ID,
    operationId: USER_ID,
    storagePath: `${USER_ID}/${EXPORT_ID}/document.pdf`,
    artifactSha256: "a".repeat(64),
    rendererVersion: "render-export.pdf.2",
  };
  let attempts = 0;
  const reconciled = await reconcileCapturedExportCompletion(() => {
    attempts += 1;
    if (attempts === 1) {
      return Promise.resolve({ data: null, error: new Error("lost") });
    }
    return Promise.resolve({
      data: {
        export_id: EXPORT_ID,
        operation_id: USER_ID,
        status: "created",
        storage_path: expected.storagePath,
        artifact_sha256: expected.artifactSha256,
        renderer_version: expected.rendererVersion,
        artifact_validation_result: {
          passed: true,
          artifact_inspected: true,
          byte_length: 140,
        },
      },
      error: null,
    });
  }, expected);
  assertEquals(reconciled, { completed: true, attempts: 2 });

  const ambiguous = await reconcileCapturedExportCompletion(
    () => Promise.resolve({ data: null, error: new Error("still unknown") }),
    expected,
  );
  assertEquals(ambiguous, { completed: false, attempts: 2 });
});

Deno.test("captured artifact hashing is deterministic SHA-256", async () => {
  assertEquals(
    await sha256Hex(artifactBytes("PrompTED")),
    "ec2451372df74d4181c7980331502bed2f050b22f21bfe3bc56aaf40460cca4a",
  );
});

Deno.test("captured storage identity is owner and export scoped", async () => {
  assertEquals(
    capturedExportStoragePath(USER_ID, EXPORT_ID, "document.pdf"),
    `${USER_ID}/${EXPORT_ID}/document.pdf`,
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        capturedExportStoragePath(USER_ID, EXPORT_ID, "../document.pdf")
      ),
    Error,
    "CAPTURED_EXPORT_STORAGE_IDENTITY_INVALID",
  );
});

Deno.test("explicit legacy export identity binds the body to both UUID headers", () => {
  const requestId = "33333333-3333-4333-8333-333333333333";
  assertEquals(
    validateLegacyExportRequestIdentity({
      captured: false,
      bodyRequestId: requestId,
      idempotencyHeader: requestId,
      requestHeader: requestId,
    }),
    true,
  );
  assertEquals(
    validateLegacyExportRequestIdentity({
      captured: false,
      bodyRequestId: requestId,
      idempotencyHeader: requestId,
      requestHeader: USER_ID,
    }),
    false,
  );
  assertEquals(
    validateLegacyExportRequestIdentity({
      captured: false,
      bodyRequestId: requestId,
      idempotencyHeader: requestId,
      requestHeader: null,
    }),
    false,
  );
  assertEquals(
    validateLegacyExportRequestIdentity({
      captured: false,
      bodyRequestId: undefined,
      idempotencyHeader: null,
      requestHeader: null,
    }),
    true,
  );
  assertEquals(
    validateLegacyExportRequestIdentity({
      captured: true,
      bodyRequestId: undefined,
      idempotencyHeader: null,
      requestHeader: null,
    }),
    true,
  );
});

Deno.test("captured receipt states distinguish completed, processing, reconciliation, and first dispatch", () => {
  const expected = {
    exportId: EXPORT_ID,
    operationId: USER_ID,
    storagePath: USER_ID + "/" + EXPORT_ID + "/document.pdf",
  };
  assertEquals(
    classifyCapturedExportReceipt({
      outcome: "requested",
      export_id: EXPORT_ID,
      operation_id: USER_ID,
    }, expected),
    { state: "requested" },
  );
  assertEquals(
    classifyCapturedExportReceipt({
      outcome: "processing",
      export_id: EXPORT_ID,
      operation_id: USER_ID,
      retry_after_seconds: 2,
    }, expected),
    { state: "processing", retryAfterSeconds: 2 },
  );
  assertEquals(
    classifyCapturedExportReceipt({
      outcome: "reconciliation_required",
      export_id: EXPORT_ID,
      operation_id: USER_ID,
    }, expected),
    { state: "reconciliation_required" },
  );

  const completed = classifyCapturedExportReceipt({
    outcome: "completed",
    export_id: EXPORT_ID,
    operation_id: USER_ID,
    status: "created",
    storage_path: expected.storagePath,
    artifact_sha256: "a".repeat(64),
    renderer_version: "render-export.pdf.2",
    artifact_validation_result: {
      passed: true,
      artifact_inspected: true,
      byte_length: 140,
    },
  }, expected);
  assertEquals(completed.state, "completed");

  assertThrows(
    () =>
      classifyCapturedExportReceipt({
        outcome: "completed",
        export_id: EXPORT_ID,
        operation_id: USER_ID,
        status: "created",
        storage_path: USER_ID + "/" + EXPORT_ID + "/other.pdf",
        artifact_sha256: "a".repeat(64),
        renderer_version: "render-export.pdf.2",
        artifact_validation_result: {
          passed: true,
          artifact_inspected: true,
          byte_length: 140,
        },
      }, expected),
    Error,
    "CAPTURED_EXPORT_RECEIPT_INVALID",
  );
});

Deno.test("completed captured receipt replays only exact stored bytes after hash and PDF evidence inspection", async () => {
  const bytes = artifactBytes("%PDF-1.7\n" + "x".repeat(120) + "\n%%EOF");
  const expectation = await createCapturedPdfInspectionExpectation(
    "Example",
    [{ name: "Summary", content: "Verified content", order_index: 0 }],
  );
  const artifactSha256 = await sha256Hex(bytes);
  const inspected = await inspectCapturedPdfArtifact(
    bytes,
    new Headers({
      "x-prompted-inspection-version": expectation.version,
      "x-prompted-inspection-status": "passed",
      "x-prompted-pdf-structure": "passed",
      "x-prompted-content-sha256": expectation.contentSha256,
      "x-prompted-section-order-sha256": expectation.sectionOrderSha256,
      "x-prompted-artifact-sha256": artifactSha256,
    }),
    expectation,
  );

  const replayInspection = await inspectStoredCapturedPdfArtifact(
    bytes,
    artifactSha256,
    inspected.validationResult,
    expectation,
  );
  assertEquals(replayInspection.passed, true);
  assertEquals(replayInspection.artifactInspected, true);

  const changed = artifactBytes("%PDF-1.7\n" + "y".repeat(120) + "\n%%EOF");
  const rejected = await inspectStoredCapturedPdfArtifact(
    changed,
    artifactSha256,
    inspected.validationResult,
    expectation,
  );
  assertEquals(rejected.passed, false);
  assertEquals(rejected.artifactInspected, false);
});

Deno.test("legacy PDF binding covers owner, request, target revision, exact input, HTML, renderer policy, and deterministic object", async () => {
  const renderContract = {
    endpoint: "https://renderer.prompted.ai/v1/pdf",
    origin: "https://renderer.prompted.ai",
    timeoutMs: 15_000,
    maxResponseBytes: 1_048_576,
  };
  const brandKit = {
    id: "77777777-7777-4777-8777-777777777777",
    business_id: "88888888-8888-4888-8888-888888888888",
    logo_url:
      "https://project.test/storage/v1/object/public/assets/brand-kits/88888888-8888-4888-8888-888888888888/logos/99999999-9999-8999-8999-999999999999.png",
    primary_colour: "#dc5430",
    secondary_colour: "#efe5d4",
    footer_text: "Authoritative footer",
    revision: 4,
    logo_operation_id: "99999999-9999-8999-8999-999999999999",
    logo_storage_path:
      "brand-kits/88888888-8888-4888-8888-888888888888/logos/99999999-9999-8999-8999-999999999999.png",
    logo_content_sha256: "a".repeat(64),
    logo_media_type: "image/png" as const,
    logo_byte_length: 1024,
    logo_status: "ready" as const,
    updated_at: "2026-09-02T00:00:00.000Z",
  };
  const input = {
    ownerUserId: USER_ID,
    requestId: LEGACY_REQUEST_ID,
    target: {
      kind: "document" as const,
      id: EXPORT_ID,
      currentRevision: 7,
      approvedRevision: 7,
    },
    title: "Exact legacy export",
    sections: [{
      name: "Summary",
      content: "Approved content",
      order_index: 0,
    }],
    brandKit,
    lede: null,
    html: "<html><body>Approved content</body></html>",
    filename: "exact-legacy-export.pdf",
    renderContract,
  };
  const binding = await createLegacyPdfExportBinding(input);

  assertEquals(
    binding.storagePath,
    `${USER_ID}/${LEGACY_REQUEST_ID}/legacy.pdf`,
  );
  assertEquals(binding.bindingVersion, "prompted.legacy-pdf-export.v2");
  assertEquals(binding.format, "pdf");
  for (
    const digest of [
      binding.bindingSha256,
      binding.targetIdentitySha256,
      binding.inputSha256,
      binding.htmlSha256,
      binding.rendererPolicySha256,
      binding.rendererResourceSha256,
      binding.storagePathSha256,
    ]
  ) {
    assertEquals(digest.length, 64);
  }

  const exactReplay = await createLegacyPdfExportBinding(input);
  assertEquals(exactReplay, binding);
  const deliberateNewExport = await createLegacyPdfExportBinding({
    ...input,
    requestId: "44444444-4444-4444-8444-444444444444",
  });
  assertEquals(
    deliberateNewExport.bindingSha256 === binding.bindingSha256,
    false,
  );
  assertEquals(deliberateNewExport.storagePath === binding.storagePath, false);
  const changedRevision = await createLegacyPdfExportBinding({
    ...input,
    target: { ...input.target, currentRevision: 8, approvedRevision: null },
  });
  assertEquals(changedRevision.bindingSha256 === binding.bindingSha256, false);

  const changedBrandRevision = await createLegacyPdfExportBinding({
    ...input,
    brandKit: { ...brandKit, revision: brandKit.revision + 1 },
  });
  assertEquals(changedBrandRevision.inputSha256 === binding.inputSha256, false);
  assertEquals(
    changedBrandRevision.bindingSha256 === binding.bindingSha256,
    false,
  );

  const nextLogoOperation = "aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa";
  const changedLogoIdentity = await createLegacyPdfExportBinding({
    ...input,
    brandKit: {
      ...brandKit,
      logo_url:
        `https://project.test/storage/v1/object/public/assets/brand-kits/${brandKit.business_id}/logos/${nextLogoOperation}.png`,
      logo_operation_id: nextLogoOperation,
      logo_storage_path:
        `brand-kits/${brandKit.business_id}/logos/${nextLogoOperation}.png`,
      logo_content_sha256: "b".repeat(64),
    },
  });
  assertEquals(changedLogoIdentity.inputSha256 === binding.inputSha256, false);
  assertEquals(
    changedLogoIdentity.bindingSha256 === binding.bindingSha256,
    false,
  );
});

Deno.test("legacy PDF receipt distinguishes requested, processing, recovery, completed, reconciliation, and UUID conflict", async () => {
  const binding = await createLegacyPdfExportBinding({
    ownerUserId: USER_ID,
    requestId: LEGACY_REQUEST_ID,
    target: {
      kind: "artifact",
      id: EXPORT_ID,
      currentRevision: 3,
      approvedRevision: 3,
    },
    title: "Artifact",
    sections: [{ name: "Result", content: "Approved", order_index: 0 }],
    brandKit: null,
    lede: null,
    html: "<html>Approved</html>",
    filename: "artifact.pdf",
    renderContract: {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 15_000,
      maxResponseBytes: 1_048_576,
    },
  });
  const expected = {
    requestId: LEGACY_REQUEST_ID,
    bindingSha256: binding.bindingSha256,
    storagePath: legacyPdfExportStoragePath(USER_ID, LEGACY_REQUEST_ID),
  };
  assertEquals(
    classifyLegacyPdfExportReceipt({
      outcome: "requested",
      request_id: LEGACY_REQUEST_ID,
      binding_sha256: binding.bindingSha256,
    }, expected),
    { state: "requested" },
  );
  assertEquals(
    classifyLegacyPdfExportReceipt({
      outcome: "processing",
      request_id: LEGACY_REQUEST_ID,
      binding_sha256: binding.bindingSha256,
      retry_after_seconds: 2,
    }, expected),
    { state: "processing", retryAfterSeconds: 2 },
  );
  assertEquals(
    classifyLegacyPdfExportReceipt({
      outcome: "reconciliation_required",
      request_id: LEGACY_REQUEST_ID,
      binding_sha256: binding.bindingSha256,
    }, expected),
    { state: "reconciliation_required" },
  );

  const validation = {
    passed: true,
    artifact_inspected: true,
    inspection_contract: "prompted.rendered-pdf.v1",
    content_type: "application/pdf",
    byte_length: 140,
    content_sha256: "a".repeat(64),
    section_order_sha256: "b".repeat(64),
    checks: {
      transport_envelope: true,
      inspection_version: true,
      renderer_status: true,
      renderer_structural: true,
      content_matches: true,
      section_order_matches: true,
      artifact_hash_matches: true,
    },
  };
  const recovery = classifyLegacyPdfExportReceipt({
    outcome: "storage_recovery",
    request_id: LEGACY_REQUEST_ID,
    binding_sha256: binding.bindingSha256,
    storage_path: expected.storagePath,
    artifact_sha256: "c".repeat(64),
    artifact_byte_length: 140,
    renderer_version: "render-export.pdf.3",
    artifact_validation_result: validation,
    storage_state: "dispatched",
    storage_dispatch_token: "55555555-5555-4555-8555-555555555555",
  }, expected);
  assertEquals(recovery.state, "storage_recovery");
  const completed = classifyLegacyPdfExportReceipt({
    outcome: "completed",
    request_id: LEGACY_REQUEST_ID,
    binding_sha256: binding.bindingSha256,
    storage_path: expected.storagePath,
    artifact_sha256: "c".repeat(64),
    artifact_byte_length: 140,
    renderer_version: "render-export.pdf.3",
    artifact_validation_result: validation,
    history_id: "66666666-6666-4666-8666-666666666666",
  }, expected);
  assertEquals(completed.state, "completed");

  assertThrows(
    () =>
      classifyLegacyPdfExportReceipt({
        outcome: "completed",
        request_id: LEGACY_REQUEST_ID,
        binding_sha256: binding.bindingSha256,
        storage_path: expected.storagePath,
        artifact_sha256: "c".repeat(64),
        artifact_byte_length: 140,
        renderer_version: "render-export.pdf.2",
        artifact_validation_result: validation,
        history_id: "66666666-6666-4666-8666-666666666666",
      }, expected),
    Error,
    "LEGACY_PDF_EXPORT_RECEIPT_INVALID",
  );
  assertThrows(
    () =>
      classifyLegacyPdfExportReceipt({
        outcome: "completed",
        request_id: LEGACY_REQUEST_ID,
        binding_sha256: binding.bindingSha256,
        storage_path: expected.storagePath,
        artifact_sha256: "c".repeat(64),
        artifact_byte_length: 140,
        renderer_version: "render-export.pdf.3",
        artifact_validation_result: {
          ...validation,
          content_type: "text/html",
        },
        history_id: "66666666-6666-4666-8666-666666666666",
      }, expected),
    Error,
    "LEGACY_PDF_EXPORT_RECEIPT_INVALID",
  );

  assertThrows(
    () =>
      classifyLegacyPdfExportReceipt({
        outcome: "completed",
        request_id: LEGACY_REQUEST_ID,
        binding_sha256: "f".repeat(64),
        storage_path: expected.storagePath,
        artifact_sha256: "c".repeat(64),
        artifact_byte_length: 140,
        renderer_version: "render-export.pdf.3",
        artifact_validation_result: validation,
        history_id: "66666666-6666-4666-8666-666666666666",
      }, expected),
    Error,
    "LEGACY_PDF_EXPORT_RECEIPT_CONFLICT",
  );
});

Deno.test("lost explicit legacy response replays the identical stored PDF only after receipt and content reinspection", async () => {
  const binding = await createLegacyPdfExportBinding({
    ownerUserId: USER_ID,
    requestId: LEGACY_REQUEST_ID,
    target: {
      kind: "document",
      id: EXPORT_ID,
      currentRevision: 12,
      approvedRevision: 12,
    },
    title: "Replay exactly",
    sections: [{
      name: "Decision",
      content: "Approved exact text",
      order_index: 0,
    }],
    brandKit: null,
    lede: null,
    html: "<html>Approved exact text</html>",
    filename: "replay-exactly.pdf",
    renderContract: {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 15_000,
      maxResponseBytes: 1_048_576,
    },
  });
  const bytes = artifactBytes("%PDF-1.7\n" + "r".repeat(140) + "\n%%EOF");
  const artifactSha256 = await sha256Hex(bytes);
  const firstInspection = await inspectCapturedPdfArtifact(
    bytes,
    new Headers({
      "x-prompted-inspection-version": binding.inspectionExpectation.version,
      "x-prompted-inspection-status": "passed",
      "x-prompted-pdf-structure": "passed",
      "x-prompted-content-sha256": binding.inspectionExpectation.contentSha256,
      "x-prompted-section-order-sha256":
        binding.inspectionExpectation.sectionOrderSha256,
      "x-prompted-artifact-sha256": artifactSha256,
    }),
    binding.inspectionExpectation,
  );
  const receipt = classifyLegacyPdfExportReceipt({
    outcome: "completed",
    request_id: LEGACY_REQUEST_ID,
    binding_sha256: binding.bindingSha256,
    storage_path: binding.storagePath,
    artifact_sha256: artifactSha256,
    artifact_byte_length: bytes.byteLength,
    renderer_version: binding.rendererVersion,
    artifact_validation_result: {
      ...firstInspection.validationResult,
      content_type: "application/pdf",
    },
    history_id: "66666666-6666-4666-8666-666666666666",
  }, {
    requestId: LEGACY_REQUEST_ID,
    bindingSha256: binding.bindingSha256,
    storagePath: binding.storagePath,
  });
  if (receipt.state !== "completed") {
    throw new Error("expected completed legacy receipt");
  }
  const replayInspection = await inspectStoredCapturedPdfArtifact(
    bytes,
    receipt.artifactSha256,
    receipt.artifactValidationResult,
    binding.inspectionExpectation,
  );
  assertEquals(replayInspection.passed, true);
  assertEquals(replayInspection.artifactInspected, true);
  assertEquals(await sha256Hex(bytes), receipt.artifactSha256);
  assertEquals(
    Array.from(bytes),
    Array.from(artifactBytes(
      "%PDF-1.7\n" + "r".repeat(140) + "\n%%EOF",
    )),
  );
});

Deno.test("completed legacy retry restores its historical renderer binding without current renderer configuration", async () => {
  const common = {
    ownerUserId: USER_ID,
    requestId: LEGACY_REQUEST_ID,
    target: {
      kind: "document" as const,
      id: EXPORT_ID,
      currentRevision: 9,
      approvedRevision: 9,
    },
    title: "Historical policy",
    sections: [{ name: "Summary", content: "Exact", order_index: 0 }],
    brandKit: null,
    lede: null,
    html: "<html>Exact</html>",
    filename: "historical-policy.pdf",
  };
  const original = await createLegacyPdfExportBinding({
    ...common,
    renderContract: {
      endpoint: "https://renderer.prompted.ai/v1/pdf",
      origin: "https://renderer.prompted.ai",
      timeoutMs: 15_000,
      maxResponseBytes: 1_048_576,
    },
  });
  const inputIdentity = await createLegacyPdfExportInputIdentity(common);
  const restored = await restoreLegacyPdfExportBinding({
    outcome: "found",
    request_id: LEGACY_REQUEST_ID,
    binding: {
      ...Object.fromEntries(
        Object.entries({
          binding_version: original.bindingVersion,
          binding_sha256: original.bindingSha256,
          target_kind: original.targetKind,
          target_id: original.targetId,
          target_revision: original.targetRevision,
          approved_revision: original.approvedRevision,
          target_identity_sha256: original.targetIdentitySha256,
          format: original.format,
          input_sha256: original.inputSha256,
          html_sha256: original.htmlSha256,
          renderer_policy_sha256: original.rendererPolicySha256,
          renderer_resource_sha256: original.rendererResourceSha256,
          storage_path: original.storagePath,
          storage_path_sha256: original.storagePathSha256,
          filename: original.filename,
        }),
      ),
    },
  }, inputIdentity);
  assertEquals(restored?.bindingSha256, original.bindingSha256);
  assertEquals(restored?.rendererPolicySha256, original.rendererPolicySha256);

  await assertRejects(
    () =>
      restoreLegacyPdfExportBinding({
        outcome: "found",
        request_id: LEGACY_REQUEST_ID,
        binding: {
          binding_version: original.bindingVersion,
          binding_sha256: original.bindingSha256,
          target_kind: original.targetKind,
          target_id: original.targetId,
          target_revision: original.targetRevision,
          approved_revision: original.approvedRevision,
          target_identity_sha256: original.targetIdentitySha256,
          format: original.format,
          input_sha256: "f".repeat(64),
          html_sha256: original.htmlSha256,
          renderer_policy_sha256: original.rendererPolicySha256,
          renderer_resource_sha256: original.rendererResourceSha256,
          storage_path: original.storagePath,
          storage_path_sha256: original.storagePathSha256,
          filename: original.filename,
        },
      }, inputIdentity),
    Error,
    "LEGACY_PDF_EXPORT_BINDING_CONFLICT",
  );
});

Deno.test("legacy Storage read distinguishes authoritative absence from a retryable transport failure", async () => {
  const request = {
    baseUrl: "https://project.supabase.co",
    serviceRoleKey: "synthetic-service-role",
    bucket: "captured-exports" as const,
    path: legacyPdfExportStoragePath(USER_ID, LEGACY_REQUEST_ID),
    method: "GET" as const,
    timeoutMs: 5_000,
    maximumResponseBytes: 1_048_576,
  };
  const absent = await requestCapturedExportStorageObject(
    request,
    () => Promise.resolve(new Response(null, { status: 404 })),
  );
  assertEquals(absent, null);

  let attempts = 0;
  const transientThenExact = () => {
    attempts += 1;
    return Promise.resolve(
      attempts === 1
        ? new Response(null, { status: 503 })
        : new Response("exact stored bytes", {
          status: 200,
          headers: { "Content-Length": "18" },
        }),
    );
  };
  await assertRejects(
    () => requestCapturedExportStorageObject(request, transientThenExact),
    Error,
    "PRIVATE_STORAGE_REQUEST_FAILED",
  );
  const recovered = await requestCapturedExportStorageObject(
    request,
    transientThenExact,
  );
  assertEquals(new TextDecoder().decode(recovered!), "exact stored bytes");
  assertEquals(attempts, 2);
});

Deno.test("captured-export Storage requests abort the underlying fetch below the 120 second lease", async () => {
  let observedAbort = false;
  await assertRejects(
    () =>
      requestCapturedExportStorageObject(
        {
          baseUrl: "https://project.supabase.co",
          serviceRoleKey: "synthetic-service-role",
          bucket: "captured-exports",
          path: USER_ID + "/" + EXPORT_ID + "/document.pdf",
          method: "POST",
          bytes: artifactBytes("stored"),
          contentType: "application/pdf",
          timeoutMs: 5,
          maximumResponseBytes: 0,
        },
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              observedAbort = true;
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }),
      ),
    DOMException,
    "aborted",
  );
  assertEquals(observedAbort, true);
});
