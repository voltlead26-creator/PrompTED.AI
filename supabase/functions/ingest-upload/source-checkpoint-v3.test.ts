// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals } from "jsr:@std/assert@1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { AuthContext } from "../_shared/auth-guard.ts";
import { extractBoundedUploadWithSourceV3 } from "../_shared/upload-extraction.ts";
import { requestIsolatedUploadExtraction } from "../_shared/upload-extraction-client.ts";
import { readRtfText } from "../_shared/rtf-source.ts";
import { handleExtractUpload } from "../extract-upload/handler.ts";
import {
  createUploadIngestStore,
  deriveUploadRequestIdentity,
  handleIngestUpload,
  type IngestDependencies,
} from "./handler.ts";

const owner = "71000000-0000-4000-8000-000000000001";
const token = "73000000-0000-4000-8000-000000000001";
const opaqueDigest = "b".repeat(64);
const sha = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

async function fixture(
  {
    checkpoint = false,
    lostAck = false,
    variant = "rtf",
    literalPreview = false,
    emptyMimeTransport = "none",
    textSource = "",
  } = {},
) {
  const filename = variant === "docx"
    ? "source.docx"
    : variant === "text"
    ? "source.md"
    : "source.rtf";
  const mime = emptyMimeTransport !== "none"
    ? ""
    : variant === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : variant === "text"
    ? "text/markdown"
    : "application/rtf";
  const bytes = variant === "docx"
    ? await Deno.readFile(
      new URL(
        "../extract-upload/fixtures/source-preservation.docx",
        import.meta.url,
      ),
    )
    : new TextEncoder().encode(
      variant === "text"
        ? textSource || "  # Keep this heading  \n\nText with exact spaces.  "
        : "{\\rtf1\\ansi  Keep these words.  \\par Next paragraph.  }",
    );
  let parsed = await extractBoundedUploadWithSourceV3(bytes, filename, mime);
  if (literalPreview) {
    assert(parsed.format === "rtf");
    // The ordinary producer normalizes its preview before hashing. This
    // independently decoded, valid source-envelope fixture tests that ingest
    // cannot change any already accepted v3 wording after its hash is bound.
    const text = readRtfText(bytes).text;
    parsed = {
      ...parsed,
      text,
      sourceManifest: {
        ...parsed.sourceManifest,
        extractedTextSha256: await sha(text),
      },
    };
  }
  let requestMime = mime;
  if (emptyMimeTransport === "multipart") {
    const form = new FormData();
    form.append(
      "file",
      new File([Uint8Array.from(bytes)], filename, { type: mime }),
    );
    const wire = new Request("https://example.invalid/upload", {
      method: "POST",
      body: form,
    });
    const received = (await wire.formData()).get("file");
    assert(received instanceof File);
    assertEquals(received.type, "application/octet-stream");
    requestMime = received.type;
  }
  const identity = await deriveUploadRequestIdentity({
    userId: owner,
    filename,
    mime: requestMime,
    bytes,
    situationText: "",
  });
  const raw = {
    content_sha256: identity.contentSha256,
    text_sha256: await sha(parsed.text),
    text: parsed.text,
    format: parsed.format,
    truncated: parsed.truncated,
    resource_policy_version: parsed.resourcePolicyVersion,
    extraction_contract_version: "upload-extraction.3",
    content_byte_length: bytes.length,
    source_manifest: parsed.sourceManifest,
    source_manifest_sha256: parsed.sourceManifest ? opaqueDigest : null,
    source_digest_version: parsed.sourceManifest
      ? "upload-source-manifest-jsonb.1"
      : null,
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const classifiers: Parameters<IngestDependencies["classify"]>[0][] = [];
  const state = {
    saved: checkpoint ? structuredClone(raw) as Record<string, unknown> : null,
    response: null as Record<string, unknown> | null,
    settlementLostAcks: 0,
    requestIdentities: [] as { signal: AbortSignal; requestId: string }[],
    extractionCalls: 0,
    originalReads: 0,
    classifications: 0,
    readHook: null as
      | null
      | ((
        value: Record<string, unknown> | null,
      ) => Record<string, unknown> | null),
    stage: "storage_completed",
    claimVersion: "upload-extraction.3",
    advanceFailure: false,
  };
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      return Promise.resolve().then(() => {
        calls.push({ name, args: structuredClone(args) });
        if (name === "claim_upload_ingest") {
          assertEquals(Object.keys(args).length, 9);
          assertEquals(
            args.p_extraction_contract_version,
            "upload-extraction.3",
          );
          return {
            error: null,
            data: state.response
              ? {
                outcome: "completed",
                http_status: 200,
                response: state.response,
              }
              : {
                outcome: "resumed",
                stage: state.stage,
                claim_token: token,
                extraction_contract_version: state.claimVersion,
              },
          };
        }
        assertEquals(args.p_upload_id, identity.uploadId);
        assertEquals(args.p_user_id, owner);
        assertEquals(args.p_request_sha256, identity.requestSha256);
        assertEquals(args.p_claim_token, token);
        if (name === "get_upload_extraction_checkpoint") {
          const value = state.response ? null : structuredClone(state.saved);
          return {
            error: null,
            data: state.readHook ? state.readHook(value) : value,
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
          assertEquals(
            args.p_extraction_contract_version,
            "upload-extraction.3",
          );
          assertEquals(args.p_source_manifest, parsed.sourceManifest);
          assertEquals(Object.hasOwn(args, "p_source_manifest_sha256"), false);
          state.saved = {
            ...structuredClone(raw),
            text: args.p_extracted_text,
            text_sha256: args.p_extracted_text_sha256,
          };
          return lostAck
            ? {
              error: { message: "Synthetic lost application acknowledgement" },
              data: null,
            }
            : { error: null, data: { outcome: "recorded" } };
        }
        if (name === "advance_upload_ingest") {
          assert(state.saved);
          assertEquals(args.p_expected_stage, "storage_completed");
          assertEquals(args.p_next_stage, "provider_dispatched");
          if (state.advanceFailure) {
            return {
              error: { message: "Synthetic superseded claim" },
              data: null,
            };
          }
          const outcome = state.stage === "provider_dispatched"
            ? "idempotent_replay"
            : "advanced";
          state.stage = "provider_dispatched";
          return {
            error: null,
            data: { outcome, stage: state.stage },
          };
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
        throw new Error(`Unexpected RPC ${name}`);
      });
    },
  } as unknown as AuthContext["admin"];
  const auth = {
    userId: owner,
    isAnonymous: false,
    admin,
    body: null,
    multipartBody: null,
  } as AuthContext;
  const controller = new AbortController();
  const dependencies: IngestDependencies = {
    store: createUploadIngestStore(auth),
    allowLegacyMissingIdentity: false,
    recordLegacyIdentityAdapter() {
      throw new Error("Unexpected identity fallback");
    },
    setRequestIdentity(signal, requestId) {
      state.requestIdentities.push({ signal, requestId });
    },
    extractText(input) {
      state.extractionCalls++;
      assertEquals(input.extractionContractVersion, "upload-extraction.3");
      if (emptyMimeTransport !== "none") {
        const accepted = calls.find((c) =>
          c.name === "claim_upload_ingest"
        )!.args;
        assertEquals(accepted.p_file_type, requestMime || "rtf");
        return requestIsolatedUploadExtraction(input, {
          baseUrl: "http://127.0.0.1:54321",
          serviceRoleKey: "synthetic-service-role",
          timeoutMs: 1000,
        }, (url, init) =>
          handleExtractUpload(new Request(url, init), {
            serviceRoleKey: "synthetic-service-role",
            loadSnapshot: () =>
              Promise.resolve({
                uploadId: identity.uploadId,
                userId: owner,
                claimToken: token,
                requestSha256: identity.requestSha256,
                storagePath: String(accepted.p_storage_path),
                filename,
                fileType: String(accepted.p_file_type),
                byteLength: bytes.length,
                contentSha256: identity.contentSha256,
                stage: "storage_completed",
                extractionContractVersion: "upload-extraction.3",
              }),
            readOriginal: ({ storagePath, maximumBytes }) => {
              assertEquals(storagePath, accepted.p_storage_path);
              assertEquals(maximumBytes, bytes.length);
              state.originalReads++;
              return Promise.resolve(Uint8Array.from(bytes));
            },
            extract: () => {
              throw new Error("Unexpected legacy parser");
            },
            extractWithSourceV3: extractBoundedUploadWithSourceV3,
          }));
      }
      return requestIsolatedUploadExtraction(input, {
        baseUrl: "http://127.0.0.1:54321",
        serviceRoleKey: "synthetic-service-role",
        timeoutMs: 1000,
      }, () =>
        Promise.resolve(Response.json({
          upload_id: identity.uploadId,
          user_id: owner,
          request_sha256: identity.requestSha256,
          claim_token: token,
          content_sha256: identity.contentSha256,
          content_byte_length: bytes.length,
          extraction_contract_version: "upload-extraction.3",
          resource_policy_version: parsed.resourcePolicyVersion,
          text: parsed.text,
          format: parsed.format,
          truncated: parsed.truncated,
          source_manifest: parsed.sourceManifest,
        })));
    },
    classify(request) {
      assertEquals(
        state.requestIdentities.at(-1)?.requestId,
        identity.uploadId,
      );
      assert(state.requestIdentities.at(-1)?.signal === request.signal);
      assertEquals(request.logicalStageKey, "ingest-upload.classify");
      classifiers.push(request);
      state.classifications++;
      return Promise.resolve({
        text: "",
        structured: {
          document_type: "Imported document",
          purpose: "Synthetic classification.",
          sections: [{ title: "Document", items: ["Retained wording"] }],
        },
      });
    },
  };
  async function run() {
    if (emptyMimeTransport === "json") {
      const request = new Request("https://example.invalid/ingest-upload", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": identity.uploadId,
          "x-request-id": identity.uploadId,
        },
        body: JSON.stringify({
          upload_id: identity.uploadId,
          filename,
          mime,
          content_base64: encodeBase64(bytes),
        }),
      });
      return handleIngestUpload(request, {
        ...auth,
        body: await request.json(),
      }, dependencies);
    }
    const form = new FormData();
    form.append(
      "file",
      new File([Uint8Array.from(bytes)], filename, { type: mime }),
    );
    form.append("upload_id", identity.uploadId);
    const request = new Request("https://example.invalid/ingest-upload", {
      method: "POST",
      body: form,
      signal: controller.signal,
      headers: {
        "x-idempotency-key": identity.uploadId,
        "x-request-id": identity.uploadId,
      },
    });
    return handleIngestUpload(request, {
      ...auth,
      multipartBody: await request.formData(),
    }, dependencies);
  }
  return {
    run,
    calls,
    state,
    parsed,
    raw,
    controller,
    classifiers,
    dependencies,
    identity,
  };
}

for (const cutoff of [" ", "\n"]) {
  Deno.test(`v3 real producer and ingest retain whitespace at the preview cutoff ${JSON.stringify(cutoff)}`, async () => {
    const f = await fixture({
      variant: "text",
      textSource: "A".repeat(19_999) + cutoff + "B",
    });
    assertEquals(f.parsed.text, "A".repeat(19_999) + cutoff);
    assertEquals(f.parsed.truncated, true);
    const response = await f.run();
    const body = await response.json();
    assertEquals(response.status, 200, body.error?.code);
    assertEquals(body.extracted_text, f.parsed.text);
    assertEquals(body.confirm_payload.char_count, 20_000);
    assertEquals(body.confirm_payload.truncated, true);
    assertEquals(body.resource_policy_version, "upload-resource-policy.2");
    assertEquals(f.state.saved?.text_sha256, await sha(f.parsed.text));
    assertEquals(await (await f.run()).json(), body);
    assertEquals(f.state.classifications, 1);
    assertEquals(f.state.extractionCalls, 1);
  });
}

for (const transport of ["json", "multipart"]) {
  for (const lostAck of [false, true]) {
    Deno.test(`v3 empty-MIME ${transport} preserves its actual identity through private extraction; lost ACK=${lostAck}`, async () => {
      const f = await fixture({ emptyMimeTransport: transport, lostAck });
      const response = await f.run();
      const body = await response.json();
      assertEquals(response.status, 200, body.error?.code);
      assertEquals(body.extracted_text, f.parsed.text);
      const accepted = f.calls.find((c) =>
        c.name === "claim_upload_ingest"
      )!.args;
      assertEquals(
        accepted.p_file_type,
        transport === "json" ? "rtf" : "application/octet-stream",
      );
      assertEquals(accepted.p_request_sha256, f.identity.requestSha256);
      assertEquals(accepted.p_upload_id, f.identity.uploadId);
      assertEquals(f.state.originalReads, 1);
      assertEquals(f.state.extractionCalls, 1);
      assertEquals(f.state.classifications, 1);
      assertEquals(f.state.saved?.source_manifest, f.parsed.sourceManifest);
      assertEquals(await (await f.run()).json(), body);
      assertEquals(f.state.originalReads, 1);
      assertEquals(f.state.classifications, 1);
    });
  }
}

for (const variant of ["rtf", "docx", "text"]) {
  for (const checkpoint of [false, true]) {
    Deno.test(`v3 ingest preserves exact ${variant} source through ${checkpoint ? "checkpoint replay" : "real private client and RPC readback"}`, async () => {
      const f = await fixture({ variant, checkpoint });
      const response = await f.run();
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.extracted_text, f.parsed.text);
      assertEquals(body.resource_policy_version, "upload-resource-policy.2");
      assertEquals(body.extraction_format, f.parsed.format);
      assertEquals(f.state.extractionCalls, checkpoint ? 0 : 1);
      assertEquals(f.state.classifications, 1);
      assertEquals(f.state.saved?.text, f.parsed.text);
      const publicData = JSON.stringify([
        body,
        f.classifiers,
        f.calls.filter((c) => c.name === "settle_upload_ingest"),
      ]);
      for (
        const field of [
          "source_manifest",
          "sourceManifest",
          opaqueDigest,
          "rtf-source-manifest.1",
          "docx-source-manifest.1",
          "originalSha256",
          "extractedTextSha256",
          "rtf-format-preserving-editing-unverified",
          f.identity.contentSha256,
          f.raw.text_sha256,
        ]
      ) {
        assertEquals(publicData.includes(field), false);
      }
      assertEquals(await (await f.run()).json(), body);
      assertEquals(f.state.classifications, 1);
      assertEquals(
        await f.dependencies.store.loadExtraction({
          ...f.identity,
          userId: owner,
          claimToken: token,
          expectedContentSha256: f.identity.contentSha256,
          expectedByteLength: f.raw.content_byte_length,
          extractionContractVersion: "upload-extraction.3",
        }),
        null,
      );
    });
  }
}
Deno.test("v3 RTF accepted wording contains whitespace that must not be cleaned after validation", async () => {
  const f = await fixture({ lostAck: true, literalPreview: true });
  assertEquals(f.parsed.text, " Keep these words.  \nNext paragraph.  ");
  const response = await f.run();
  assertEquals(response.status, 200);
  assertEquals((await response.json()).extracted_text, f.parsed.text);
  assertEquals(f.state.classifications, 1);
  assertEquals(f.state.extractionCalls, 1);
});
for (
  const [label, patch] of [
    ["missing source", { source_manifest: null }],
    ["wrong original size", { content_byte_length: 1 }],
    ["wrong contract", { extraction_contract_version: "upload-extraction.2" }],
    ["wrong policy", { resource_policy_version: "upload-resource-policy.1" }],
    ["unsupported format", { format: "text" }],
    ["extra field", { unsafe: true }],
    ["missing source digest", { source_manifest_sha256: null }],
    ["wrong digest domain", { source_digest_version: "archive.1" }],
    ["changed wording", { text: "Changed" }],
  ] as const
) {
  Deno.test(`v3 ingest rejects ${label} checkpoint before classification`, async () => {
    const f = await fixture({ checkpoint: true });
    f.state.readHook = (value) => value ? { ...value, ...patch } : value;
    const response = await f.run();
    assertEquals(response.status, 503);
    assertEquals(
      (await response.json()).error.code,
      "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
    );
    assertEquals(f.state.classifications, 0);
    assertEquals(f.state.extractionCalls, 0);
    assertEquals(
      f.calls.filter((c) => c.name === "settle_upload_ingest").length,
      0,
    );
  });
}
Deno.test("v3 cancellation during source readback cannot dispatch or settle", async () => {
  const f = await fixture({ checkpoint: true });
  f.state.readHook = (value) => {
    f.controller.abort();
    return value;
  };
  const response = await f.run();
  assertEquals(response.status, 503);
  assertEquals(f.state.classifications, 0);
  assertEquals(
    f.calls.filter((c) =>
      c.name === "advance_upload_ingest" || c.name === "settle_upload_ingest"
    ).length,
    0,
  );
});
Deno.test("unrecognised accepted extraction version is not downgraded", async () => {
  const f = await fixture({ checkpoint: true });
  f.state.claimVersion = "upload-extraction.4";
  assertEquals((await f.run()).status, 503);
  assertEquals(f.state.classifications, 0);
  assertEquals(f.state.extractionCalls, 0);
});

for (const lostAck of [false, true]) {
  for (const failure of ["missing", "unavailable"] as const) {
    Deno.test(`v3 ingest keeps ${failure} readback retryable after record; lost ACK=${lostAck}`, async () => {
      const f = await fixture({ lostAck });
      f.state.readHook = (value) => {
        if (value && failure === "unavailable") {
          throw new Error("Synthetic read failure");
        }
        return null;
      };
      const response = await f.run();
      assertEquals(response.status, 503);
      assertEquals(response.headers.get("Retry-After"), "120");
      assertEquals(
        (await response.json()).error.code,
        "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
      );
      assertEquals(f.state.extractionCalls, 1);
      assert(
        f.state.saved,
        "The write succeeded before readback became unavailable",
      );
      assertEquals(f.state.classifications, 0);
      assertEquals(
        f.calls.filter((c) =>
          c.name === "advance_upload_ingest" ||
          c.name === "settle_upload_ingest"
        ).length,
        0,
      );
      f.state.readHook = null;
      assertEquals((await f.run()).status, 200);
      assertEquals(
        f.state.extractionCalls,
        1,
        "Recover the retained checkpoint instead of extracting again",
      );
      assertEquals(f.state.classifications, 1);
    });
  }
}

Deno.test("v3 conflicting but internally valid RTF readback requires reconciliation before classification", async () => {
  const f = await fixture();
  const changed = "Different retained wording";
  const digest = await sha(changed);
  assert(f.parsed.format === "rtf");
  const changedSource = {
    ...f.parsed.sourceManifest,
    extractedTextSha256: digest,
  };
  f.state.readHook = (value) =>
    value
      ? {
        ...value,
        text: changed,
        text_sha256: digest,
        source_manifest: changedSource,
      }
      : null;
  const response = await f.run();
  assertEquals(response.status, 409);
  assertEquals(
    (await response.json()).error.code,
    "UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT",
  );
  assertEquals(f.state.classifications, 0);
  assertEquals(
    f.calls.filter((c) => c.name === "advance_upload_ingest").length,
    0,
  );
  const settlements = f.calls.filter((c) => c.name === "settle_upload_ingest");
  assertEquals(settlements.length, 1);
  assertEquals(settlements[0].args.p_ingest_status, "reconciliation_required");
  assertEquals(settlements[0].args.p_extracted_text, null);
});

for (const interruption of ["none", "takeover", "cancel"] as const) {
  Deno.test(`v3 provider-stage resume replays the checkpoint lease fence: ${interruption}`, async () => {
    const f = await fixture({ checkpoint: true });
    f.state.stage = "provider_dispatched";
    f.state.readHook = (value) => {
      f.state.advanceFailure = interruption === "takeover";
      if (interruption === "cancel") f.controller.abort();
      return value;
    };
    const response = await f.run();
    assertEquals(response.status, interruption === "none" ? 200 : 503);
    assertEquals(f.state.extractionCalls, 0);
    assertEquals(f.state.classifications, interruption === "none" ? 1 : 0);
    assertEquals(
      f.calls.filter((c) => c.name === "advance_upload_ingest").length,
      // The existing RPC adapter retries an uncertain acknowledgement once.
      interruption === "cancel" ? 0 : interruption === "takeover" ? 2 : 1,
    );
    assertEquals(
      f.calls.filter((c) => c.name === "settle_upload_ingest").length,
      interruption === "none" ? 1 : 0,
    );
    if (interruption === "takeover") {
      assertEquals(
        (await response.json()).error.code,
        "UPLOAD_STAGE_ACK_UNRESOLVED",
      );
    }
  });
}

Deno.test("v3 provider-stage resume with no checkpoint reconciles without a fresh extraction", async () => {
  const f = await fixture();
  f.state.stage = "provider_dispatched";
  const response = await f.run();
  assertEquals(response.status, 409);
  assertEquals(
    (await response.json()).error.code,
    "UPLOAD_EXTRACTION_CHECKPOINT_MISSING",
  );
  assertEquals(f.state.extractionCalls, 0);
  assertEquals(f.state.classifications, 0);
});

Deno.test("v3 ingest owns candidate wording before asynchronous source hashing", async () => {
  const f = await fixture({ literalPreview: true });
  const candidate = {
    ...f.parsed,
    contentSha256: f.identity.contentSha256,
    contentByteLength: f.raw.content_byte_length,
    extractionContractVersion: "upload-extraction.3" as const,
  };
  const manifest = structuredClone(candidate.sourceManifest);
  let mutated = false;
  Object.defineProperty(candidate, "sourceManifest", {
    get() {
      queueMicrotask(() => {
        candidate.text = "Late mutable replacement";
        mutated = true;
      });
      return manifest;
    },
  });
  f.dependencies.extractText = () => Promise.resolve(candidate);
  const response = await f.run();
  assert(mutated, "Mutation ran while the source validator awaited its digest");
  assertEquals(response.status, 200);
  assertEquals((await response.json()).extracted_text, f.parsed.text);
  assertEquals(f.state.saved?.text, f.parsed.text);
  assertEquals(f.classifiers[0].messages[0].content, f.parsed.text);
});

Deno.test("v3 cancellation while a fresh candidate awaits its source hash cannot persist or classify", async () => {
  const f = await fixture();
  const candidate = {
    ...f.parsed,
    contentSha256: f.identity.contentSha256,
    contentByteLength: f.raw.content_byte_length,
    extractionContractVersion: "upload-extraction.3" as const,
  };
  const manifest = structuredClone(candidate.sourceManifest);
  let cancelled = false;
  Object.defineProperty(candidate, "sourceManifest", {
    get() {
      queueMicrotask(() => {
        f.controller.abort();
        cancelled = true;
      });
      return manifest;
    },
  });
  f.dependencies.extractText = () => Promise.resolve(candidate);
  const response = await f.run();
  assert(cancelled);
  assertEquals(response.status, 503);
  assertEquals(f.state.classifications, 0);
  assertEquals(f.state.saved, null);
  assertEquals(
    f.calls.filter((c) =>
      [
        "record_upload_extraction_snapshot",
        "advance_upload_ingest",
        "settle_upload_ingest",
      ].includes(c.name)
    ).length,
    0,
  );
});

// These caller tests complement the real provider-receipt SQL checks. The
// injected adapter is a controlled response boundary, not provider execution.
for (const lostSettlementAcks of [0, 1, 2]) {
  Deno.test(`v3 RTF preserves actual fallback provenance and the same receipt; lost settlement ACK=${lostSettlementAcks}`, async () => {
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
    assertEquals(committed.extracted_text, f.parsed.text);
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
  Deno.test(`v3 RTF rejects malformed execution provenance ${malformed === null ? "null" : "extra key"}`, async () => {
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

Deno.test("v3 RTF without fallback retains the established public key sets", async () => {
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
