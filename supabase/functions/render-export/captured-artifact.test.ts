// deno-lint-ignore no-import-prefix
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  artifactBytes,
  capturedExportCompletionMatches,
  capturedExportStoragePath,
  createCapturedPdfInspectionExpectation,
  inspectCapturedPdfArtifact,
  readBoundedResponseBytes,
  reconcileCapturedExportCompletion,
  requestRenderedPdf,
  sha256Hex,
  validateRenderServiceContract,
} from "./captured-artifact.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";

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

  assertEquals(result, null);
  assertEquals(aborted, true);
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
  assertEquals(rendered?.bytes.byteLength, 135);
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
