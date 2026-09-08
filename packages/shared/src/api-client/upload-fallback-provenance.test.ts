import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureApiClient, ingestUpload } from "./index";
const owner = "11111111-1111-4111-8111-111111111111";
const policy = { provider: "ollama", model: "gpt-oss:20b", modelDigest: "a".repeat(64), configurationVersion: "local.1" };
beforeEach(() => configureApiClient({ baseUrl: "https://upload.test/api", getToken: () => `header.${btoa(JSON.stringify({ sub: owner }))}.signature` }));
afterEach(() => { vi.unstubAllGlobals(); configureApiClient({ baseUrl: "/api" }); });
it.each([policy, { ...policy, modelDigest: "invalid" }, { ...policy, extra: true }, { ...policy, provider: "openai" }])("validates returned fallback provenance at the upload boundary: %j", async (credit_fallback) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const form = await new Request(url, init).formData();
    return Response.json({
      upload_id: form.get("upload_id"), original_retained: true, extracted_text: "Synthetic source", classification_status: "completed", credit_fallback,
      confirm_payload: { filename: "source.txt", summary: "A synthetic document.", document_type: "document", structure: [{ title: "Source", items: ["Synthetic source"] }], char_count: 16, truncated: false },
    });
  }));
  const result = ingestUpload(new File(["Synthetic source"], "source.txt", { type: "text/plain" }), "", {
    expectedUserId: owner, principalEpoch: 1, signal: new AbortController().signal, assertCurrent() {},
  });
  if (credit_fallback === policy) expect((await result).credit_fallback).toEqual(policy);
  else await expect(result).rejects.toThrow("UPLOAD_RESPONSE_INVALID");
});
