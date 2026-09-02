// deno-lint-ignore-file no-import-prefix
import { assert } from "jsr:@std/assert@1";

Deno.test("captured export admits Storage after inspection and before upload, then seals the receipt", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const renderClaim = source.indexOf('"claim_user_external_egress"');
  const renderCall = source.indexOf("renderResult = await renderPdf(");
  const renderComplete = source.indexOf('"complete_user_external_egress"');
  const capturedBranch = source.indexOf("let capturedExportId");
  const inspect = source.indexOf("inspectCapturedPdfArtifact(", capturedBranch);
  const claim = source.indexOf('"claim_user_storage_dispatch"', inspect);
  const upload = source.indexOf(
    "await requestCapturedExportStorageObject({",
    claim,
  );
  const storedRead = source.indexOf(
    "await requestCapturedExportStorageObject({",
    upload + 1,
  );
  const storedInspect = source.indexOf(
    "await inspectStoredCapturedPdfArtifact(",
    storedRead,
  );
  const recovery = source.indexOf(
    '"record_captured_export_storage_recovery"',
    storedInspect,
  );
  const complete = source.indexOf(
    '"complete_user_storage_dispatch"',
    recovery,
  );
  const operationComplete = source.indexOf(
    "reconcileCapturedExportCompletion(",
    complete,
  );
  assert(renderClaim >= 0);
  assert(renderCall > renderClaim);
  assert(renderComplete > renderCall);
  assert(capturedBranch > renderComplete);
  assert(inspect >= 0);
  assert(claim > inspect);
  assert(upload > claim);
  assert(storedRead > upload);
  assert(storedInspect > storedRead);
  assert(recovery > storedInspect);
  assert(complete > recovery);
  assert(operationComplete > complete);
  assert(source.includes("ACCOUNT_DELETION_FENCED"));
  assert(source.includes("CAPTURED_EXPORT_STORAGE_DISPATCH_UNRESOLVED"));
  assert(source.includes("CAPTURED_EXPORT_STORAGE_ACK_UNRESOLVED"));
  assert(source.includes("const storageDispatchToken = crypto.randomUUID()"));
  assert(source.includes("p_dispatch_token: storageDispatchToken"));
  assert(!source.includes("p_dispatch_token: exportId"));
  assert(source.includes("CAPTURED_EXPORT_RENDER_PROCESSING"));
  assert(source.includes("CAPTURED_EXPORT_RENDER_RECONCILIATION_REQUIRED"));
  assert(source.includes("auth.generationRequestId ?? htmlSha256"));
  assert(
    source.includes(
      "brand_snapshot_version: capturedBrandSnapshot.snapshotVersion",
    ),
  );
  const durableStorageSequence = source.slice(upload, complete);
  assert(durableStorageSequence.includes('method: "POST"'));
  assert(durableStorageSequence.includes('method: "GET"'));
  assert(durableStorageSequence.includes("capturedInspectionExpectation"));
  assert(
    durableStorageSequence.includes(
      '"record_captured_export_storage_recovery"',
    ),
  );
  assert(
    (durableStorageSequence.match(/method: "POST"/g) ?? []).length === 1,
  );
  assert(!source.includes('.from("captured-exports")\n        .upload('));
});

Deno.test("captured Storage recovery replays the retained object without rendering or uploading", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const receipt = source.indexOf('"get_captured_document_export_receipt"');
  const recovery = source.indexOf(
    'if (replayReceipt.state === "storage_recovery")',
    receipt,
  );
  const storedRead = source.indexOf(
    "await requestCapturedExportStorageObject({",
    recovery,
  );
  const storedInspect = source.indexOf(
    "await inspectStoredCapturedPdfArtifact(",
    storedRead,
  );
  const storageComplete = source.indexOf(
    '"complete_user_storage_dispatch"',
    storedInspect,
  );
  const operationComplete = source.indexOf(
    "reconcileCapturedExportCompletion(",
    storageComplete,
  );
  const replayResponse = source.indexOf(
    "return new Response(ownedBuffer(storedBytes)",
    operationComplete,
  );
  const firstRendererDispatch = source.indexOf(
    "renderResult = await renderPdf(",
    receipt,
  );

  assert(receipt >= 0);
  assert(recovery > receipt);
  assert(storedRead > recovery);
  assert(storedInspect > storedRead);
  assert(storageComplete > storedInspect);
  assert(operationComplete > storageComplete);
  assert(replayResponse > operationComplete);
  assert(firstRendererDispatch > replayResponse);
  const recoveryBranch = source.slice(recovery, replayResponse);
  assert(recoveryBranch.includes('method: "GET"'));
  assert(!recoveryBranch.includes('method: "POST"'));
  assert(!recoveryBranch.includes("renderPdf("));
});

Deno.test("completed captured export replays exact stored bytes before any renderer or Storage write", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const receipt = source.indexOf('"get_captured_document_export_receipt"');
  const completed = source.indexOf(
    'if (replayReceipt.state === "completed")',
    receipt,
  );
  const download = source.indexOf(
    "await requestCapturedExportStorageObject({",
    completed,
  );
  const inspect = source.indexOf(
    "await inspectStoredCapturedPdfArtifact(",
    download,
  );
  const replayResponse = source.indexOf(
    "return new Response(ownedBuffer(storedBytes)",
    inspect,
  );
  const firstRendererDispatch = source.indexOf(
    "renderResult = await renderPdf(",
    receipt,
  );

  assert(receipt >= 0);
  assert(completed > receipt);
  assert(download > completed);
  assert(inspect > download);
  assert(replayResponse > inspect);
  assert(firstRendererDispatch > replayResponse);
  const replayBranch = source.slice(completed, replayResponse);
  assert(replayBranch.includes('method: "GET"'));
  assert(!replayBranch.includes('method: "POST"'));
  assert(!replayBranch.includes("renderPdf("));
  assert(!replayBranch.includes('.from("export_history")'));
  assert(source.includes("CAPTURED_EXPORT_RECONCILIATION_REQUIRED"));
});

Deno.test("captured export replay selects the immutable request-time brand snapshot", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/20260902016000_brand_logo_lifecycle.sql",
      import.meta.url,
    ),
  );
  const receiptStart = migration.indexOf(
    "create or replace function public.get_captured_document_export_receipt",
  );
  const receiptEnd = migration.indexOf(
    "revoke all on function private.resolve_export_business_id",
    receiptStart,
  );
  const receipt = migration.slice(receiptStart, receiptEnd);
  const receiptRead = source.indexOf('"get_captured_document_export_receipt"');
  const brandParse = source.indexOf(
    "capturedBrandSnapshot = parseAuthoritativeBrandSnapshot",
    receiptRead,
  );
  const renderer = source.indexOf(
    "renderResult = await renderPdf(",
    receiptRead,
  );

  assert(receiptStart >= 0);
  assert(receiptEnd > receiptStart);
  assert(
    (receipt.match(/'brand_snapshot', v_brand_snapshot/g) ?? []).length === 5,
  );
  assert(
    migration.includes("capture_captured_export_brand_snapshot_before_insert"),
  );
  assert(migration.includes("CAPTURED_EXPORT_BRAND_SNAPSHOT_IMMUTABLE"));
  assert(migration.includes("CAPTURED_EXPORT_BRAND_EVIDENCE_MISMATCH"));
  assert(brandParse > receiptRead);
  assert(renderer > brandParse);
  assert(!source.includes("body.brand_kit"));
});

Deno.test("persisted PDF receipt replays or recovers exact inspected bytes before renderer and immutable upload", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const binding = source.indexOf("createLegacyPdfExportBinding(");
  const receipt = source.indexOf('"claim_persisted_pdf_export"', binding);
  const replay = source.indexOf(
    'legacyReceipt.state === "completed" ||',
    receipt,
  );
  const download = source.indexOf(
    "await requestCapturedExportStorageObject({",
    replay,
  );
  const inspect = source.indexOf(
    "await inspectStoredCapturedPdfArtifact(",
    download,
  );
  const replayResponse = source.indexOf(
    "return legacyPdfResponse(",
    inspect,
  );
  const renderer = source.indexOf("renderResult = await renderPdf(", receipt);

  assert(binding >= 0);
  assert(receipt > binding);
  assert(replay > receipt);
  assert(download > replay);
  assert(inspect > download);
  assert(replayResponse > inspect);
  assert(renderer > replayResponse);
  const replayBranch = source.slice(replay, replayResponse);
  assert(replayBranch.includes('method: "GET"'));
  assert(!replayBranch.includes('method: "POST"'));
  assert(!replayBranch.includes("renderPdf("));
  assert(!replayBranch.includes('.from("export_history")'));
});

Deno.test("transient legacy Storage reads preserve the exact receipt while only authoritative absence reconciles", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const replay = source.indexOf(
    'legacyReceipt.state === "completed" ||',
  );
  const replayRead = source.indexOf('method: "GET"', replay);
  const retryable = source.indexOf(
    'code: "LEGACY_PDF_EXPORT_STORAGE_READ_UNAVAILABLE"',
    replayRead,
  );
  const absence = source.indexOf("if (storedBytes === null)", retryable);
  const reconcile = source.indexOf(
    'await markReconciliation("storage_object_unavailable")',
    absence,
  );
  assert(replay >= 0);
  assert(replayRead > replay);
  assert(retryable > replayRead);
  assert(absence > retryable);
  assert(reconcile > absence);
  assert(
    !source.slice(replayRead, retryable).includes(
      'markReconciliation("storage_object_unavailable")',
    ),
  );

  const exactSuccess = source.indexOf("const durableValidation");
  const storagePost = source.indexOf('method: "POST"', exactSuccess);
  const readback = source.indexOf('method: "GET"', storagePost);
  const readbackRetryable = source.indexOf(
    'code: "LEGACY_PDF_EXPORT_STORAGE_READ_UNAVAILABLE"',
    readback,
  );
  const authoritativeAbsence = source.indexOf(
    "if (persistedBytes === null)",
    readbackRetryable,
  );
  assert(storagePost > exactSuccess);
  assert(readback > storagePost);
  assert(readbackRetryable > readback);
  assert(authoritativeAbsence > readbackRetryable);
  const durableStorage = source.slice(storagePost, authoritativeAbsence);
  assert(!durableStorage.includes("signal: req.signal"));
  assert(!durableStorage.includes("markLegacyReconciliation("));
});

Deno.test("explicit legacy PDF records inspected evidence before one immutable upload and finalises history through one RPC", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const renderer = source.indexOf("renderResult = await renderPdf(");
  const inspect = source.indexOf("inspectCapturedPdfArtifact(", renderer);
  const evidence = source.indexOf(
    '"record_legacy_pdf_export_artifact"',
    inspect,
  );
  const storageClaim = source.indexOf(
    'p_dispatch_kind: "legacy-export"',
    evidence,
  );
  const storagePost = source.indexOf('method: "POST"', storageClaim);
  const storageComplete = source.indexOf(
    '"complete_user_storage_dispatch"',
    storagePost,
  );
  const finalise = source.indexOf(
    '"complete_legacy_pdf_export"',
    storageComplete,
  );

  assert(renderer >= 0);
  assert(inspect > renderer);
  assert(evidence > inspect);
  assert(storageClaim > evidence);
  assert(storagePost > storageClaim);
  assert(storageComplete > storagePost);
  assert(finalise > storageComplete);
  assert(source.includes('"mark_legacy_pdf_export_reconciliation"'));
  assert(source.includes('p_dispatch_kind: "legacy-export"'));
  assert(source.includes("legacyExactRequestId === null"));
  const exactSuccess = source.slice(
    source.indexOf("const durableValidation", inspect),
    source.indexOf("let capturedExportId"),
  );
  assert((exactSuccess.match(/method: "POST"/g) ?? []).length === 1);
  assert(
    (source.match(/renderResult = await renderPdf\(/g) ?? []).length === 1,
  );
  assert(!exactSuccess.includes('.from("export_history")'));
});

Deno.test("account deletion drains every deterministic legacy artifact and the database fence admits legacy dispatches", async () => {
  const accountDeletion = await Deno.readTextFile(
    new URL("../account-delete/deletion.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/20260901091000_ingest_upload_exact_replay.sql",
      import.meta.url,
    ),
  );
  assert(
    accountDeletion.includes(
      '{ bucket: "captured-exports", rootPrefix: userId, paths: [] }',
    ),
  );
  assert(migration.includes("'captured-export', 'legacy-export'"));
  assert(migration.includes("private.legacy_pdf_export_receipts"));
  assert(migration.includes("dispatch_record.lease_expires_at > v_now"));
});

Deno.test("legacy target wording and authoritative brand load through one ordered MVCC snapshot RPC", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/20260902016000_brand_logo_lifecycle.sql",
      import.meta.url,
    ),
  );
  assert((source.match(/"load_legacy_export_snapshot"/g) ?? []).length === 2);
  for (
    const table of [
      "documents",
      "sections",
      "ted_artifacts",
      "ted_artifact_blocks",
    ]
  ) {
    assert(!source.includes(`.from("${table}")`));
  }
  const snapshot = migration.slice(
    migration.indexOf(
      "create or replace function public.load_legacy_export_snapshot",
    ),
    migration.indexOf(
      "create or replace function public.get_captured_document_export_receipt",
    ),
  );
  assert(snapshot.includes("language sql"));
  assert(snapshot.includes("stable"));
  assert(snapshot.includes("set search_path = ''"));
  assert(
    snapshot.includes("order by section_record.order_index, section_record.id"),
  );
  assert(
    snapshot.includes("order by block_record.order_index, block_record.id"),
  );
  assert(snapshot.includes("document_record.user_id = p_user_id"));
  assert(snapshot.includes("artifact_record.user_id = p_user_id"));
  assert(
    snapshot.includes(
      "'brand_snapshot', private.current_export_brand_snapshot(",
    ),
  );
  assert(migration.includes("private.resolve_export_business_id("));
});

Deno.test("explicit legacy export identity is checked after authoritative cohort resolution and before rendering", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const bodyParse = source.indexOf(
    "const body = (auth.body ?? {}) as ExportBody",
  );
  const firstAuthoritativeRead = source.indexOf(
    '"load_legacy_export_snapshot"',
    bodyParse,
  );
  const identityCheck = source.indexOf(
    "validateLegacyExportRequestIdentity({",
    firstAuthoritativeRead,
  );
  const workflowGate = source.indexOf(
    "const unresolvedPlaceholders",
    identityCheck,
  );

  assert(bodyParse >= 0);
  assert(!source.includes("await req.json()"));
  assert(firstAuthoritativeRead > bodyParse);
  assert(identityCheck > firstAuthoritativeRead);
  assert(workflowGate > identityCheck);
  const guard = source.slice(identityCheck, workflowGate);
  assert(guard.includes("captured: capturedDocument !== null"));
  assert(!source.includes("hasCapturedRequestIdentity"));
  assert(guard.includes('req.headers.get("x-idempotency-key")'));
  assert(guard.includes('req.headers.get("x-request-id")'));
  assert(guard.includes("EXPORT_REQUEST_IDENTITY_MISMATCH"));
});

Deno.test("ambiguous renderer dispatch remains reconciliation-required and deletion-blocking", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const renderCall = source.indexOf(
    "renderResult = await renderPdf(",
  );
  const terminalClassification = source.indexOf(
    "const renderTerminalState",
    renderCall,
  );
  const durableCompletion = source.indexOf(
    "p_terminal_state: renderTerminalState",
    terminalClassification,
  );
  const failClosed = source.indexOf(
    'if (renderResult.state === "ambiguous_after_dispatch")',
    durableCompletion,
  );

  assert(renderCall >= 0);
  assert(terminalClassification > renderCall);
  assert(durableCompletion > terminalClassification);
  assert(failClosed > durableCompletion);
  const classification = source.slice(
    terminalClassification,
    durableCompletion,
  );
  assert(classification.includes('"reconciliation_required"'));
  assert(
    source.slice(failClosed).includes(
      "CAPTURED_EXPORT_RENDER_RECONCILIATION_REQUIRED",
    ),
  );
});

Deno.test("renderer admission carries the immutable database lease into the pre-fetch deadline gate", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/20260901091000_ingest_upload_exact_replay.sql",
      import.meta.url,
    ),
  );
  const claim = source.indexOf('"claim_user_external_egress"');
  const receiptDeadline = source.indexOf("receipt.lease_expires_at", claim);
  const render = source.indexOf("renderResult = await renderPdf(", claim);
  const carriedDeadline = source.indexOf(
    "leaseExpiresAt: renderDispatch.leaseExpiresAt",
    render,
  );

  assert(claim >= 0);
  assert(receiptDeadline > claim);
  assert(render > receiptDeadline);
  assert(carriedDeadline > render);
  assert(
    migration.includes(
      "'lease_expires_at', v_dispatch.lease_expires_at",
    ),
  );
});
