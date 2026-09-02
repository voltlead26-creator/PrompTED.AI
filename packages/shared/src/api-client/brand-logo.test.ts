import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ApiRequestContext,
  configureApiClient,
  saveBrandKitOperation,
} from "./index";

const USER_ID = "b6000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "b7000000-0000-4000-8000-000000000001";

function token(): string {
  const payload = btoa(JSON.stringify({ sub: USER_ID }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

function requestContext(signal = new AbortController().signal): ApiRequestContext {
  return {
    expectedUserId: USER_ID,
    principalEpoch: 1,
    signal,
    assertCurrent: () => {
      if (signal.aborted) throw signal.reason;
    },
  };
}

function brandKit(operationId: string) {
  return {
    id: "ba000000-0000-4000-8000-000000000001",
    business_id: BUSINESS_ID,
    logo_url: `https://project.test/storage/v1/object/public/assets/brand-kits/${BUSINESS_ID}/logos/${operationId}.png`,
    primary_colour: "#dc5430",
    secondary_colour: null,
    footer_text: "Trusted footer",
    revision: 1,
    logo_operation_id: operationId,
    logo_storage_path: `brand-kits/${BUSINESS_ID}/logos/${operationId}.png`,
    logo_content_sha256: "a".repeat(64),
    logo_media_type: "image/png",
    logo_byte_length: 4,
    logo_status: "ready",
    updated_at: "2026-09-02T00:00:00.000Z",
  };
}

beforeEach(() => {
  configureApiClient({ baseUrl: "/api", getToken: () => token() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureApiClient({ baseUrl: "/api" });
});

describe("brand-logo API client", () => {
  it("replays one lost response with the same deterministic operation and exact multipart binding", async () => {
    const attempts: Array<{ headers: Headers; form: FormData }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      attempts.push({ headers: new Headers(init?.headers), form });
      if (attempts.length === 1) throw new TypeError("response lost");
      const operationId = String(form.get("operation_id"));
      const kit = brandKit(operationId);
      const retained = new Uint8Array(await (form.get("file") as File).arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", retained));
      kit.logo_content_sha256 = Array.from(digest)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return new Response(JSON.stringify({
        outcome: "completed",
        operation_id: operationId,
        brand_kit: kit,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const file = new File([new Uint8Array([1, 2, 3, 4])], "logo.png", {
      type: "image/png",
    });
    const result = await saveBrandKitOperation({
      businessId: BUSINESS_ID,
      expectedRevision: 0,
      logoAction: "replace",
      primaryColour: "#DC5430",
      secondaryColour: null,
      footerText: " Trusted footer ",
      file,
    }, requestContext());

    expect(attempts).toHaveLength(2);
    expect(result.business_id).toBe(BUSINESS_ID);
    expect(result.revision).toBe(1);
    const identities = attempts.map(({ headers, form }) => ({
      operation: form.get("operation_id"),
      binding: form.get("binding_sha256"),
      header: headers.get("x-idempotency-key"),
      request: headers.get("x-request-id"),
      file: form.get("file"),
    }));
    expect(identities[1]!.operation).toBe(identities[0]!.operation);
    expect(identities[1]!.binding).toBe(identities[0]!.binding);
    expect(identities[0]!.header).toBe(identities[0]!.operation);
    expect(identities[0]!.request).toBe(identities[0]!.operation);
    expect(identities[0]!.file).toBeInstanceOf(File);
    expect(attempts[0]!.headers.get("content-type")).toBeNull();
  });

  it("rejects an oversized logo before token resolution or network access", async () => {
    const getToken = vi.fn(() => token());
    configureApiClient({ baseUrl: "/api", getToken });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveBrandKitOperation({
      businessId: BUSINESS_ID,
      expectedRevision: 0,
      logoAction: "replace",
      primaryColour: "#dc5430",
      secondaryColour: null,
      footerText: null,
      file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], "logo.png", {
        type: "image/png",
      }),
    }, requestContext())).rejects.toMatchObject({
      code: "BRAND_LOGO_FILE_SIZE_INVALID",
    } satisfies Partial<ApiError>);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a successful HTTP response that does not match the requested revision", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const operationId = String((init?.body as FormData).get("operation_id"));
      const kit = brandKit(operationId);
      kit.revision = 9;
      kit.logo_content_sha256 = "a".repeat(64);
      return new Response(JSON.stringify({
        outcome: "completed",
        operation_id: operationId,
        brand_kit: kit,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await expect(saveBrandKitOperation({
      businessId: BUSINESS_ID,
      expectedRevision: 0,
      logoAction: "keep",
      primaryColour: "#dc5430",
      secondaryColour: null,
      footerText: null,
      file: null,
    }, requestContext())).rejects.toMatchObject({
      status: 502,
      code: "BRAND_KIT_RESPONSE_INVALID",
    } satisfies Partial<ApiError>);
  });
});
