// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { AuthContext } from "../_shared/auth-guard.ts";
import { extractBoundedUploadWithSource } from "../_shared/upload-extraction.ts";
import type { IsolatedSourceUploadExtractionResult } from "../_shared/upload-extraction-client.ts";
import {
  createUploadIngestStore,
  deriveUploadRequestIdentity,
  handleIngestUpload,
  type IngestDependencies,
  type IngestExtractionCheckpoint,
} from "./handler.ts";

const owner = "71000000-0000-4000-8000-000000000001";
const token = "73000000-0000-4000-8000-000000000001";

Deno.test("v3 production admission requests its exact version and preserves historical resume receipts", async () => {
  const input = {
    uploadId: "72000000-0000-8000-8000-000000000001",
    userId: owner,
    storagePath: `${owner}/source.txt`,
    filename: "source.txt",
    mime: "text/plain",
    byteLength: 6,
    requestSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
  };
  for (const outcome of ["accepted", "resumed"] as const) {
    for (
      const version of [
        undefined,
        "upload-extraction.1",
        "upload-extraction.2",
        "upload-extraction.3",
      ]
    ) {
      const receipt = {
        outcome,
        stage: "prepared",
        claim_token: token,
        ...(version === undefined
          ? {}
          : { extraction_contract_version: version }),
      };
      const context = {
        userId: owner,
        admin: {
          rpc(name: string, args: Record<string, unknown>) {
            assertEquals(name, "claim_upload_ingest");
            assertEquals(
              args.p_extraction_contract_version,
              "upload-extraction.3",
            );
            assertEquals(Object.keys(args).length, 9);
            assertEquals(args.p_upload_id, input.uploadId);
            assertEquals(args.p_request_sha256, input.requestSha256);
            return Promise.resolve({ data: receipt, error: null });
          },
        },
      } as unknown as AuthContext;
      const run = () => createUploadIngestStore(context).claim(input);
      if (outcome === "accepted" && version !== "upload-extraction.3") {
        await assertRejects(run, Error, "UPLOAD_CLAIM_INVALID");
      } else {
        assertEquals(await run(), {
          outcome,
          stage: "prepared",
          claimToken: token,
          ...(version === "upload-extraction.2" ||
              version === "upload-extraction.3"
            ? { extractionContractVersion: version }
            : {}),
        });
      }
    }
  }
});
const opaqueDigest = "b".repeat(64); // Synthetic DB-issued identity, deliberately not an archive/JSON hash.
const mime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

async function fixture(
  { checkpoint = false, providerDispatched = false, lostAck = false } = {},
) {
  const bytes = await Deno.readFile(
    new URL(
      "../extract-upload/fixtures/source-preservation.docx",
      import.meta.url,
    ),
  );
  const parsed = await extractBoundedUploadWithSource(
    bytes,
    "source.docx",
    mime,
  );
  assert(parsed.format === "docx");
  const identity = await deriveUploadRequestIdentity({
    userId: owner,
    filename: "source.docx",
    mime,
    bytes,
    situationText: "",
  });
  const producer: IsolatedSourceUploadExtractionResult = {
    ...parsed,
    contentSha256: identity.contentSha256,
    contentByteLength: bytes.length,
    extractionContractVersion: "upload-extraction.2",
  };
  const textSha = await digest(parsed.text);
  const raw = {
    content_sha256: identity.contentSha256,
    text_sha256: textSha,
    text: parsed.text,
    format: "docx",
    truncated: false,
    resource_policy_version: "upload-resource-policy.1",
    extraction_contract_version: "upload-extraction.2",
    content_byte_length: bytes.length,
    source_manifest: structuredClone(parsed.sourceManifest),
    source_manifest_sha256: opaqueDigest,
    source_digest_version: "upload-source-manifest-jsonb.1",
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const state = {
    saved: checkpoint ? structuredClone(raw) as Record<string, unknown> : null,
    stage: providerDispatched ? "provider_dispatched" : "storage_completed",
    token,
    response: null as Record<string, unknown> | null,
    lostAck,
    settlementLostAcks: 0,
    requestIdentities: [] as { signal: AbortSignal; requestId: string }[],
    extractionCalls: 0,
    readHook: null as
      | null
      | ((
        value: Record<string, unknown> | null,
      ) => Promise<Record<string, unknown> | null>),
    candidate: producer,
    adopted: [] as IngestExtractionCheckpoint[],
  };
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args: structuredClone(args) });
      if (name === "claim_upload_ingest") {
        assertEquals(Object.keys(args).length, 9);
        assertEquals(args.p_extraction_contract_version, "upload-extraction.3"); // Stored v2 receipt still selects the v2 reader.
        return {
          error: null,
          data: state.response
            ? {
              outcome: "completed",
              response: state.response,
              http_status: 200,
            }
            : {
              outcome: "resumed",
              stage: state.stage,
              claim_token: state.token,
              extraction_contract_version: "upload-extraction.2",
            },
        };
      }
      if (
        args.p_claim_token !== state.token || args.p_user_id !== owner ||
        args.p_upload_id !== identity.uploadId
      ) {
        return {
          error: { message: "synthetic identity conflict" },
          data: null,
        };
      }
      if (name === "get_upload_extraction_checkpoint") {
        if (state.response) return { error: null, data: null };
        const value = structuredClone(state.saved);
        return {
          error: null,
          data: state.readHook ? await state.readHook(value) : value,
        };
      }
      if (name === "begin_upload_extraction_attempt") {
        return {
          error: null,
          data: {
            outcome: state.saved ? "checkpoint_exists" : "accepted",
            attempt_for_claim: 1,
            total_attempts: 1,
            retry_after_seconds: 120,
          },
        };
      }
      if (name === "record_upload_extraction_snapshot") {
        assertEquals(Object.keys(args).length, 12);
        assertEquals(args.p_source_manifest, producer.sourceManifest);
        assertEquals(args.p_extraction_contract_version, "upload-extraction.2");
        assertEquals(Object.hasOwn(args, "p_source_manifest_sha256"), false);
        state.saved = {
          ...structuredClone(raw),
          text: args.p_extracted_text,
          text_sha256: args.p_extracted_text_sha256,
        };
        return state.lostAck
          ? { error: { message: "synthetic lost ACK" }, data: null }
          : { error: null, data: { outcome: "recorded" } };
      }
      if (name === "advance_upload_ingest") {
        assert(state.saved);
        assertEquals(args.p_expected_stage, "storage_completed");
        assertEquals(args.p_next_stage, "provider_dispatched");
        const outcome = state.stage === "provider_dispatched"
          ? "idempotent_replay"
          : "advanced";
        state.stage = "provider_dispatched";
        return { error: null, data: { outcome, stage: state.stage } };
      }
      if (name === "settle_upload_ingest") {
        const alreadySettled = state.response !== null;
        if (args.p_ingest_status === "completed") {
          if (state.response) assertEquals(args.p_response, state.response);
          state.response = args
            .p_response as Record<string, unknown>;
          if (state.settlementLostAcks > 0) {
            state.settlementLostAcks--;
            return {
              error: { message: "Synthetic lost settlement acknowledgement" },
              data: null,
            };
          }
        }
        return {
          error: null,
          data: { outcome: alreadySettled ? "idempotent_replay" : "settled" },
        };
      }
      throw new Error(`Unexpected fixture RPC: ${name}`);
    },
  } as unknown as AuthContext["admin"];
  const context = {
    userId: owner,
    isAnonymous: false,
    admin,
    body: null,
    multipartBody: null,
  } as AuthContext;
  const store = createUploadIngestStore(context);
  const load = store.loadExtraction.bind(store);
  store.loadExtraction = async (input) => {
    const checkpoint = await load(input);
    if (checkpoint) state.adopted.push(checkpoint);
    return checkpoint;
  };
  const classifiers: Parameters<IngestDependencies["classify"]>[0][] = [];
  const deps: IngestDependencies = {
    store,
    allowLegacyMissingIdentity: false,
    recordLegacyIdentityAdapter() {
      throw new Error("No legacy identity expected");
    },
    setRequestIdentity(signal, requestId) {
      state.requestIdentities.push({ signal, requestId });
    },
    extractText(input) {
      state.extractionCalls++;
      assertEquals(input.extractionContractVersion, "upload-extraction.2");
      assert("expectedContentSha256" in input);
      assertEquals(input.expectedContentSha256, identity.contentSha256);
      assertEquals(input.expectedByteLength, bytes.length);
      return Promise.resolve(state.candidate);
    },
    classify(request) {
      assertEquals(
        state.requestIdentities.at(-1)?.requestId,
        identity.uploadId,
      );
      assert(state.requestIdentities.at(-1)?.signal === request.signal);
      assertEquals(request.logicalStageKey, "ingest-upload.classify");
      classifiers.push(request);
      return Promise.resolve({
        text: "",
        structured: {
          document_type: "Imported document",
          purpose: "A synthetic classification.",
          sections: [{ title: "Document", items: [parsed.text] }],
        },
      });
    },
  };
  const controller = new AbortController();
  async function run() {
    const form = new FormData();
    form.append(
      "file",
      new File([Uint8Array.from(bytes)], "source.docx", { type: mime }),
    );
    form.append("upload_id", identity.uploadId);
    const req = new Request(
      "https://example.invalid/functions/v1/ingest-upload",
      {
        method: "POST",
        body: form,
        signal: controller.signal,
        headers: {
          "x-idempotency-key": identity.uploadId,
          "x-request-id": identity.uploadId,
        },
      },
    );
    return await handleIngestUpload(req, {
      ...context,
      multipartBody: await req.formData(),
    }, deps);
  }
  const readInput = {
    uploadId: identity.uploadId,
    userId: owner,
    requestSha256: identity.requestSha256,
    claimToken: token,
    extractionContractVersion: "upload-extraction.2" as const,
    expectedContentSha256: identity.contentSha256,
    expectedByteLength: bytes.length,
    signal: controller.signal,
  };
  return {
    run,
    state,
    calls,
    classifiers,
    store,
    readInput,
    raw,
    producer,
    controller,
    dependencies: deps,
    identity,
  };
}

for (const lostAck of [false, true]) {
  Deno.test(`v2 ingest adopts a real DOCX manifest through the RPC adapter; lost ACK=${lostAck}`, async () => {
    const f = await fixture({ lostAck });
    const response = await f.run();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(f.state.extractionCalls, 1);
    assertEquals(f.classifiers.length, 1);
    const adopted = f.state.adopted.at(-1);
    assert(adopted && "sourceManifestSha256" in adopted);
    assertEquals(adopted.sourceManifestSha256, opaqueDigest);
    assertEquals(adopted.sourceDigestVersion, "upload-source-manifest-jsonb.1");
    assertEquals(adopted.sourceManifest, f.producer.sourceManifest);
    assert(Object.isFrozen(adopted));
    assertEquals(await f.store.loadExtraction(f.readInput), null);
    const publicData = JSON.stringify([
      body,
      f.classifiers,
      f.calls.filter((c) => c.name === "settle_upload_ingest"),
    ]);
    for (
      const privateValue of [
        opaqueDigest,
        f.producer.contentSha256,
        "source_manifest",
        "sourceManifest",
        "docx-source-manifest.1",
      ]
    ) {
      assertEquals(publicData.includes(privateValue), false);
    }
    assertEquals(await (await f.run()).json(), body);
    assertEquals(f.classifiers.length, 1);
    assertEquals(f.state.extractionCalls, 1);
  });
  Deno.test(`v2 ingest rejects changed source nodes with unchanged text/archive/roster; lost ACK=${lostAck}`, async () => {
    const f = await fixture({ lostAck });
    f.state.readHook = (value) => {
      if (value) {
        const source = value
          .source_manifest as typeof f.producer.sourceManifest;
        assert(source);
        value.source_manifest = {
          ...source,
          mainPart: {
            ...source.mainPart,
            source: {
              ...source.mainPart.source,
              nodes: source.mainPart.source.nodes.map((node) => ({
                ...node,
                text: "Different source wording",
              })),
            },
          },
        };
      }
      return Promise.resolve(value);
    };
    const response = await f.run();
    assertEquals(response.status, 409);
    assertEquals(
      (await response.json()).error.code,
      "UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT",
    );
    assertEquals(f.classifiers.length, 0);
    assertEquals(
      f.calls.filter((c) => c.name === "advance_upload_ingest").length,
      0,
    );
  });
  for (const missing of [false, true]) {
    Deno.test(`v2 ingest keeps unresolved readback retryable; lost ACK=${lostAck}, missing=${missing}`, async () => {
      const f = await fixture({ lostAck });
      f.state.readHook = (value) => {
        if (value && !missing) {
          throw new Error("synthetic unavailable checkpoint");
        }
        return Promise.resolve(null);
      };
      const response = await f.run();
      assertEquals(response.status, 503);
      assertEquals((await response.json()).retryable, true);
      assertEquals(f.classifiers.length, 0);
      assertEquals(
        f.calls.filter((c) => c.name === "settle_upload_ingest").length,
        0,
      );
    });
  }
}

for (
  const [label, mutate] of [
    ["missing digest", (value: Record<string, unknown>) => {
      delete value.source_manifest_sha256;
    }],
    ["array digest", (value: Record<string, unknown>) => {
      value.source_manifest_sha256 = [opaqueDigest];
    }],
    ["digest version", (value: Record<string, unknown>) => {
      value.source_digest_version = "office-part-roster-json.1";
    }],
    ["missing manifest", (value: Record<string, unknown>) => {
      value.source_manifest = null;
    }],
    ["archive length", (value: Record<string, unknown>) => {
      value.content_byte_length = 1;
    }],
    ["version downgrade", (value: Record<string, unknown>) => {
      value.extraction_contract_version = "upload-extraction.1";
    }],
    ["text digest", (value: Record<string, unknown>) => {
      value.text_sha256 = opaqueDigest;
    }],
    ["extra private field", (value: Record<string, unknown>) => {
      value.unexpected = true;
    }],
  ] as const
) {
  Deno.test(`v2 ingest rejects malformed durable ${label}`, async () => {
    const f = await fixture({ checkpoint: true });
    assert(f.state.saved);
    mutate(f.state.saved);
    const response = await f.run();
    assertEquals(response.status, 503);
    assertEquals(
      (await response.json()).error.code,
      "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
    );
    assertEquals(f.state.extractionCalls, 0);
    assertEquals(f.classifiers.length, 0);
    assertEquals(f.calls.map((c) => c.name), [
      "claim_upload_ingest",
      "get_upload_extraction_checkpoint",
    ]);
  });
}

for (const providerDispatched of [false, true]) {
  for (const interrupted of ["none", "cancel", "claim rotation"]) {
    Deno.test(`v2 ingest fences readback before provider work: ${providerDispatched}/${interrupted}`, async () => {
      const f = await fixture({ checkpoint: true, providerDispatched });
      f.state.readHook = (value) => {
        if (interrupted === "cancel") f.controller.abort();
        if (interrupted === "claim rotation") {
          f.state.token = "73000000-0000-4000-8000-000000000099";
        }
        return Promise.resolve(value);
      };
      const response = await f.run();
      assertEquals(response.status, interrupted === "none" ? 200 : 503);
      assertEquals(f.classifiers.length, interrupted === "none" ? 1 : 0);
      assertEquals(f.state.extractionCalls, 0);
      if (interrupted === "none") {
        assertEquals(
          f.calls.filter((c) => c.name === "advance_upload_ingest").length,
          1,
        );
      }
    });
  }
}

Deno.test("v2 source comparison ignores JSON object key order, preserving array order and opaque digest", async () => {
  const f = await fixture();
  function reordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reordered);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).reverse().map((
          [key, item],
        ) => [key, reordered(item)]),
      );
    }
    return value;
  }
  f.state.readHook = (value) =>
    Promise.resolve(reordered(value) as Record<string, unknown> | null);
  assertEquals((await f.run()).status, 200);
  assertEquals(f.classifiers.length, 1);
});

Deno.test("v1 recording keeps exactly ten RPC arguments with no source fields", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const context = {
    admin: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data: { outcome: "recorded" }, error: null });
      },
    },
  } as unknown as AuthContext;
  await createUploadIngestStore(context).recordExtraction({
    uploadId: "72000000-0000-4000-8000-000000000001",
    userId: owner,
    requestSha256: "a".repeat(64),
    claimToken: token,
    extraction: {
      text: "Legacy wording",
      contentSha256: "c".repeat(64),
      format: "text",
      resourcePolicyVersion: "upload-resource-policy.1",
      truncated: false,
    },
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "record_upload_extraction_snapshot");
  assertEquals(
    Object.keys(calls[0].args).sort(),
    [
      "p_upload_id",
      "p_user_id",
      "p_request_sha256",
      "p_claim_token",
      "p_content_sha256",
      "p_extracted_text_sha256",
      "p_extracted_text",
      "p_format",
      "p_truncated",
      "p_policy_version",
    ].sort(),
  );
});

for (const format of ["text", "pdf", "xlsx"] as const) {
  for (
    const sourceState of [
      "null",
      "missing",
      "array",
      "digest",
      "v1 shape",
    ] as const
  ) {
    Deno.test(`v2 ${format} checkpoint requires explicit null source triplet: ${sourceState}`, async () => {
      const raw: Record<string, unknown> = {
        content_sha256: "c".repeat(64),
        text_sha256: await digest("Synthetic wording"),
        text: "Synthetic wording",
        format,
        truncated: false,
        resource_policy_version: "upload-resource-policy.1",
        extraction_contract_version: "upload-extraction.2",
        content_byte_length: 123,
        source_manifest: null,
        source_manifest_sha256: null,
        source_digest_version: null,
      };
      if (sourceState === "missing") delete raw.source_manifest;
      if (sourceState === "array") raw.source_manifest = [];
      if (sourceState === "digest") raw.source_manifest_sha256 = opaqueDigest;
      if (sourceState === "v1 shape") {
        for (
          const key of [
            "extraction_contract_version",
            "content_byte_length",
            "source_manifest",
            "source_manifest_sha256",
            "source_digest_version",
          ]
        ) delete raw[key];
      }
      const context = {
        admin: {
          rpc() {
            return Promise.resolve({ data: raw, error: null });
          },
        },
      } as unknown as AuthContext;
      const input = {
        uploadId: "72000000-0000-4000-8000-000000000001",
        userId: owner,
        requestSha256: "a".repeat(64),
        claimToken: token,
        extractionContractVersion: "upload-extraction.2" as const,
        expectedContentSha256: "c".repeat(64),
        expectedByteLength: 123,
      };
      if (sourceState === "null") {
        const checkpoint = await createUploadIngestStore(context)
          .loadExtraction(input);
        assert(checkpoint?.extractionContractVersion === "upload-extraction.2");
        assertEquals(checkpoint.sourceManifest, null);
        assertEquals(checkpoint.sourceManifestSha256, null);
        assertEquals(checkpoint.sourceDigestVersion, null);
      } else {
        let rejected = false;
        try {
          await createUploadIngestStore(context).loadExtraction(input);
        } catch {
          rejected = true;
        }
        assert(rejected, "Malformed or downgraded checkpoint must be rejected");
      }
    });
  }
}

Deno.test("v1 checkpoint reader rejects the v2 source shape rather than discarding source identity", async () => {
  const f = await fixture({ checkpoint: true });
  const {
    extractionContractVersion: _version,
    expectedContentSha256: _sha,
    expectedByteLength: _length,
    ...legacyInput
  } = f.readInput;
  let rejected = false;
  try {
    await f.store.loadExtraction(legacyInput);
  } catch {
    rejected = true;
  }
  assert(rejected);
});

// These caller tests complement the real provider-receipt SQL checks. The
// injected adapter is a controlled response boundary, not provider execution.
for (const lostSettlementAcks of [0, 1, 2]) {
  Deno.test(`v2 DOCX preserves actual fallback provenance and the same receipt; lost settlement ACK=${lostSettlementAcks}`, async () => {
    const f = await fixture();
    const execution = {
      provider: "ollama" as const,
      model: "gpt-oss:20b",
      modelDigest: "a".repeat(64),
      configurationVersion: "upload-fallback-test.1",
    };
    const classify = f.dependencies.classify;
    f.dependencies.classify = async (request) => ({
      ...await classify(request),
      execution,
    });
    f.state.settlementLostAcks = lostSettlementAcks;
    const first = await f.run();
    const firstBody = await first.json();
    assertEquals(first.status, lostSettlementAcks === 2 ? 503 : 200);
    if (lostSettlementAcks === 2) {
      assertEquals(firstBody.error.code, "UPLOAD_SETTLEMENT_FAILED");
      assertEquals(Object.hasOwn(firstBody, "confirm_payload"), false);
    }
    const committed = structuredClone(f.state.response);
    assert(committed);
    if (lostSettlementAcks < 2) assertEquals(firstBody, committed);
    assertEquals(committed.credit_fallback, execution);
    assertEquals(committed.extracted_text, f.producer.text);
    const checkpoint = structuredClone(f.state.saved);
    const settlements = f.calls.filter((call) =>
      call.name === "settle_upload_ingest"
    );
    assertEquals(settlements.length, lostSettlementAcks ? 2 : 1);
    for (const call of settlements) {
      assertEquals(call.args, settlements[0].args);
    }
    assertEquals(settlements[0].args.p_response, committed);
    const payload = settlements[0].args.p_extracted_payload as Record<
      string,
      unknown
    >;
    assertEquals(payload.credit_fallback, execution);
    assertEquals(settlements[0].args.p_upload_id, f.identity.uploadId);
    assertEquals(
      settlements[0].args.p_request_sha256,
      f.identity.requestSha256,
    );
    assertEquals(settlements[0].args.p_claim_token, token);
    const publicData = JSON.stringify([committed, payload, f.classifiers]);
    for (
      const privateField of [
        "source_manifest",
        "sourceManifest",
        opaqueDigest,
        f.raw.content_sha256,
      ]
    ) {
      assertEquals(publicData.includes(privateField), false);
    }
    const replay = await f.run();
    assertEquals(replay.status, 200);
    assertEquals(await replay.json(), committed);
    assertEquals(f.state.saved, checkpoint);
    assertEquals(f.state.extractionCalls, 1);
    assertEquals(f.classifiers.length, 1);
    assertEquals(
      f.calls.filter((call) => call.name === "settle_upload_ingest").length,
      lostSettlementAcks ? 2 : 1,
    );
    assertEquals(
      f.calls.filter((call) =>
        call.name === "record_upload_extraction_snapshot"
      ).length,
      1,
    );
  });
}

for (
  const malformed of [null, {
    provider: "ollama",
    model: "gpt-oss:20b",
    modelDigest: "a".repeat(64),
    configurationVersion: "upload-fallback-test.1",
    extra: "untrusted",
  }]
) {
  Deno.test(`v2 DOCX rejects malformed execution provenance ${malformed === null ? "null" : "extra key"}`, async () => {
    const f = await fixture();
    const classify = f.dependencies.classify;
    // Deserialize hostile boundary data: static provider types cannot validate it.
    f.dependencies.classify = async (request) => ({
      ...await classify(request),
      execution: JSON.parse(JSON.stringify(malformed)),
    });
    const response = await f.run();
    const body = await response.json();
    assertEquals(response.status, 502);
    assertEquals(body.error.code, "UPLOAD_CLASSIFICATION_FAILED");
    assertEquals(body.original_retained, true);
    assertEquals(Object.hasOwn(body, "credit_fallback"), false);
    assertEquals(Object.hasOwn(body, "confirm_payload"), false);
    assertEquals(f.classifiers.length, 1);
    assertEquals(f.state.response, null);
    assertEquals(f.state.saved?.source_manifest, f.raw.source_manifest);
    const settlements = f.calls.filter((call) =>
      call.name === "settle_upload_ingest"
    );
    assertEquals(settlements.length, 1);
    assertEquals(settlements[0].args.p_ingest_status, "failed");
    assertEquals(
      Object.hasOwn(
        settlements[0].args.p_extracted_payload as object,
        "credit_fallback",
      ),
      false,
    );
  });
}

Deno.test("v2 DOCX without fallback retains the established public key sets", async () => {
  const f = await fixture();
  const response = await f.run();
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(
    Object.keys(body).sort(),
    [
      "upload_id",
      "extracted_text",
      "original_retained",
      "storage_path",
      "classification_status",
      "extraction_format",
      "resource_policy_version",
      "confirm_payload",
    ].sort(),
  );
  const settled = f.calls.find((call) => call.name === "settle_upload_ingest")!;
  assertEquals(
    Object.keys(settled.args.p_extracted_payload as object).sort(),
    [
      "truncated",
      "original_retained",
      "classification_status",
      "extraction_format",
      "resource_policy_version",
    ].sort(),
  );
});
