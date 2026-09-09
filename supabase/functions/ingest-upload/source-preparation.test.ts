// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { AuthContext } from "../_shared/auth-guard.ts";
import { extractBoundedUploadWithSourceV3 } from "../_shared/upload-extraction.ts";
import { handleIngestUpload, type IngestDependencies } from "./handler.ts";

const owner = "71000000-0000-4000-8000-000000000001";
const claimToken = "73000000-0000-4000-8000-000000000001";
const policy = "upload-source-preparation.1";
const hash = async (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
    byte => byte.toString(16).padStart(2, "0")).join("");
};

async function fixture() {
  const filename = "source.md";
  const mime = "text/markdown";
  const bytes = new TextEncoder().encode("# Source\n\nA retained document with no AI dependency.\n");
  const source = await extractBoundedUploadWithSourceV3(bytes, filename, mime);
  const contentSha256 = await hash(bytes);
  const request = { contract: "ingest-upload.request.v2", processing_policy_version: policy,
    filename, mime, byte_length: bytes.length, content_sha256: contentSha256, situation_text: "" };
  const requestSha256 = await hash(JSON.stringify(request));
  const identity = await hash(JSON.stringify({ contract: "ingest-upload.identity.v2", user_id: owner, request }));
  const variant = ((parseInt(identity[16], 16) & 3) | 8).toString(16);
  const uploadId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-8${identity.slice(13, 16)}-${variant}${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
  const storagePath = `${owner}/${uploadId}/${filename}`;
  const checkpoint = { ...source, extractionContractVersion: "upload-extraction.3" as const,
    contentSha256, textSha256: await hash(source.text), contentByteLength: bytes.length,
    sourceManifestSha256: null, sourceDigestVersion: null };
  const response = { contract_version: policy, upload_id: uploadId, storage_path: storagePath,
    original_retained: true, classification_status: "not_requested", extracted_text: source.text,
    extraction_format: source.format, resource_policy_version: source.resourcePolicyVersion,
    extraction_text_sha256: checkpoint.textSha256, truncated: source.truncated };
  const calls = { provider: 0, advance: 0, completion: 0, legacySettlement: 0 };
  let terminal = false;
  let loseAcknowledgement = false;
  let tamperResponse = false;
  const store = {
    claim(input: Parameters<IngestDependencies["store"]["claim"]>[0]) {
      assertEquals(input.uploadId, uploadId);
      assertEquals(input.requestSha256, requestSha256);
      return Promise.resolve(terminal
        ? { outcome: "completed" as const, httpStatus: 200, response }
        : { outcome: "resumed" as const, stage: "storage_completed" as const, claimToken,
          extractionContractVersion: "upload-extraction.3" as const });
    },
    advance() { calls.advance++; return Promise.resolve(); },
    retainOriginal() { throw new Error("Original is already retained"); },
    readRetainedOriginal() { return Promise.resolve(bytes); },
    beginExtraction() { throw new Error("Checkpoint already exists"); },
    loadExtraction() { return Promise.resolve(checkpoint); },
    recordExtraction() { throw new Error("Checkpoint must stay immutable"); },
    settle() { calls.legacySettlement++; return Promise.resolve(); },
    async completeSource(input: { uploadId: string; userId: string; requestSha256: string; claimToken: string }) {
      assertEquals(input, { uploadId, userId: owner, requestSha256, claimToken });
      calls.completion++;
      terminal = true;
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("Lost completion acknowledgement"); }
      return tamperResponse ? { ...response, extracted_text: "Unrelated replacement",
        extraction_text_sha256: await hash("Unrelated replacement") } : response;
    },
  };
  const dependencies: IngestDependencies = {
    store, allowLegacyMissingIdentity: false, recordLegacyIdentityAdapter() {}, setRequestIdentity() {},
    extractText() { throw new Error("Checkpoint must be reused"); },
    classify() { calls.provider++; throw new Error("Provider intentionally unavailable"); },
  };
  const controller = new AbortController();
  const auth: AuthContext = { userId: owner, isAnonymous: false, plan: "business", monthlyDocumentCap: 1000,
    admin: createClient("https://example.invalid", "synthetic-service-role", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch() { throw new Error("No network is permitted in this fixture"); } },
    }), body: { filename, mime, content_base64: encodeBase64(bytes),
    upload_id: uploadId, request_id: uploadId, processing_policy_version: policy },
    multipartBody: null };
  const run = () => handleIngestUpload(new Request("https://example.invalid/ingest-upload", {
    method: "POST", headers: { "content-type": "application/json", "x-request-id": uploadId }, signal: controller.signal,
  }), auth, dependencies);
  return { run, calls, response, controller, auth, dependencies, loseAck: () => { loseAcknowledgement = true; },
    tamper: () => { tamperResponse = true; } };
}

Deno.test("source preparation completes the retained checkpoint without provider dispatch or legacy settlement", async () => {
  const f = await fixture();
  const response = await f.run();
  assertEquals(response.status, 200);
  assertEquals(await response.json(), f.response);
  assertEquals(f.calls, { provider: 0, advance: 0, completion: 1, legacySettlement: 0 });
});

Deno.test("source preparation replays a lost completion acknowledgement without another provider or completion", async () => {
  const f = await fixture(); f.loseAck();
  assertEquals((await f.run()).status, 503);
  const replay = await f.run();
  assertEquals(replay.status, 200);
  assertEquals(await replay.json(), f.response);
  assertEquals(f.calls, { provider: 0, advance: 0, completion: 1, legacySettlement: 0 });
});

Deno.test("source preparation rejects completion wording that differs from the verified checkpoint", async () => {
  const f = await fixture(); f.tamper();
  assertEquals((await f.run()).status, 503);
  assertEquals(f.calls.provider, 0);
  assertEquals(f.calls.advance, 0);
});

Deno.test("source preparation cancellation prevents terminal mutation", async () => {
  const f = await fixture(); f.controller.abort();
  const response = await f.run();
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "UPLOAD_EXTRACTION_CANCELLED");
  assertEquals(f.calls, { provider: 0, advance: 0, completion: 0, legacySettlement: 0 });
});

for (const invalid of [null, "", "upload-source-preparation.2", { version: policy }]) {
  Deno.test(`source preparation rejects unsupported processing policy ${JSON.stringify(invalid)}`, async () => {
    const f = await fixture();
    f.auth.body!.processing_policy_version = invalid;
    const response = await f.run();
    assertEquals(response.status, 400);
    assertEquals((await response.json()).error.code, "UPLOAD_PROCESSING_POLICY_INVALID");
    assertEquals(f.calls, { provider: 0, advance: 0, completion: 0, legacySettlement: 0 });
  });
}

Deno.test("source request cannot silently downgrade into legacy classification", async () => {
  const f = await fixture(); delete f.auth.body!.processing_policy_version;
  const response = await f.run();
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "UPLOAD_REQUEST_ID_PAYLOAD_MISMATCH");
  assertEquals(f.calls, { provider: 0, advance: 0, completion: 0, legacySettlement: 0 });
});

Deno.test("source preparation does not fall back to provider work when completion capability is absent", async () => {
  const f = await fixture(); delete f.dependencies.store.completeSource;
  const response = await f.run();
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "UPLOAD_SOURCE_PREPARATION_UNAVAILABLE");
  assertEquals(f.calls, { provider: 0, advance: 0, completion: 0, legacySettlement: 0 });
});
