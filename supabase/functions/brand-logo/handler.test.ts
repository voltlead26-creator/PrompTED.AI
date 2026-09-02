// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import type { AuthContext } from "../_shared/auth-guard.ts";
import { prepareBrandKitOperation } from "../../../packages/shared/src/brand-kit-operation.ts";
import {
  type BrandLogoClaimInput,
  type BrandLogoClaimReceipt,
  type BrandLogoDependencies,
  handleBrandLogo,
} from "./handler.ts";

const OWNER_ID = "b6000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "b7000000-0000-4000-8000-000000000001";
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

class MemoryBrandLogoDependencies implements BrandLogoDependencies {
  readonly events: string[] = [];
  readonly objects = new Map<string, Uint8Array>();
  claimCalls = 0;
  uploadCalls = 0;
  completeCalls = 0;
  markReconciliationCalls = 0;
  resolveReconciliationCalls = 0;
  removeFails = false;
  oldPaths: string[] = [];
  state: BrandLogoClaimReceipt["state"] = "accepted";
  observedContentSha256: string | null = null;
  observedByteLength: number | null = null;
  reconciliationEvidenceSha256: string | null = null;
  terminal: Record<string, unknown> | null = null;

  claim(input: BrandLogoClaimInput): Promise<BrandLogoClaimReceipt> {
    this.events.push("claim");
    this.claimCalls += 1;
    const extension = input.mediaType === "image/jpeg"
      ? "jpg"
      : input.mediaType?.split("/")[1] ?? null;
    const newPath = input.action === "replace"
      ? `brand-kits/${input.businessId}/logos/${input.operationId}.${extension}`
      : null;
    return Promise.resolve({
      outcome: this.state === "completed"
        ? "completed"
        : this.state === "failed"
        ? "failed"
        : this.state === "cancelled"
        ? "cancelled"
        : this.state === "accepted"
        ? "accepted"
        : "resumed",
      operation_id: input.operationId,
      state: this.state,
      claim_token: "b8000000-0000-4000-8000-000000000001",
      publish_dispatch_token: "b8000000-0000-4000-8000-000000000002",
      delete_dispatch_token: "b8000000-0000-4000-8000-000000000003",
      business_id: input.businessId,
      action: input.action,
      expected_revision: input.expectedRevision,
      new_storage_path: newPath,
      new_content_sha256: input.contentSha256,
      new_byte_length: input.byteLength,
      new_media_type: input.mediaType,
      old_storage_paths: [...this.oldPaths],
      reconciliation_code: this.state === "reconciliation_required" ||
          this.state === "failed" || this.state === "cancelled"
        ? "storage_bytes_mismatch"
        : null,
      observed_content_sha256: this.observedContentSha256,
      observed_byte_length: this.observedByteLength,
      reconciliation_evidence_sha256: this.reconciliationEvidenceSha256,
      terminal_http_status: this.terminal
        ? this.state === "completed" ? 200 : 409
        : null,
      terminal_response: this.terminal,
    });
  }

  claimStorageDispatch(
    input: { kind: string },
  ): Promise<{ storage_permitted: boolean }> {
    this.events.push(`dispatch:${input.kind}`);
    return Promise.resolve({ storage_permitted: true });
  }

  completeStorageDispatch(input: { kind: string }): Promise<void> {
    this.events.push(`dispatch-complete:${input.kind}`);
    return Promise.resolve();
  }

  publish(
    input: { path: string; bytes: Uint8Array; upsert: false },
  ): Promise<"uploaded" | "exists"> {
    this.events.push("publish");
    this.uploadCalls += 1;
    if (this.objects.has(input.path)) return Promise.resolve("exists");
    this.objects.set(input.path, Uint8Array.from(input.bytes));
    assertEquals(input.upsert, false);
    return Promise.resolve("uploaded");
  }

  read(path: string): Promise<Uint8Array | null> {
    this.events.push(`read:${path}`);
    const bytes = this.objects.get(path);
    return Promise.resolve(bytes ? Uint8Array.from(bytes) : null);
  }

  remove(paths: string[]): Promise<void> {
    this.events.push("remove");
    if (this.removeFails) {
      return Promise.reject(new Error("synthetic remove failure"));
    }
    for (const path of paths) this.objects.delete(path);
    return Promise.resolve();
  }

  recordVerified(): Promise<void> {
    this.events.push("record-verified");
    return Promise.resolve();
  }

  activate(): Promise<void> {
    this.events.push("activate");
    return Promise.resolve();
  }

  markReconciliation(input: {
    observedContentSha256: string | null;
    observedByteLength: number | null;
    reconciliationEvidenceSha256: string;
  }): Promise<void> {
    this.events.push("mark-reconciliation");
    this.markReconciliationCalls += 1;
    this.state = "reconciliation_required";
    this.observedContentSha256 = input.observedContentSha256;
    this.observedByteLength = input.observedByteLength;
    this.reconciliationEvidenceSha256 = input.reconciliationEvidenceSha256;
    return Promise.resolve();
  }

  resolveReconciliation(): Promise<Record<string, unknown>> {
    this.events.push("resolve-reconciliation");
    this.resolveReconciliationCalls += 1;
    this.state = "failed";
    this.terminal = {
      error: {
        code: "BRAND_LOGO_STORAGE_CONFLICT",
        message: "This logo operation conflicts with retained Storage bytes.",
        retryable: false,
      },
    };
    return Promise.resolve(this.terminal);
  }

  complete(
    input: { operationId: string; action: string },
  ): Promise<Record<string, unknown>> {
    this.events.push("complete");
    this.completeCalls += 1;
    this.state = "completed";
    this.terminal = {
      outcome: "completed",
      operation_id: input.operationId,
      brand_kit: {
        business_id: BUSINESS_ID,
        revision: input.action === "replace" ? 1 : 2,
        logo_url: input.action === "remove"
          ? null
          : `https://project.test/logo/${input.operationId}`,
        logo_status: "ready",
      },
    };
    return Promise.resolve(this.terminal);
  }

  publicUrl(path: string): string {
    return `https://project.test/storage/v1/object/public/assets/${path}`;
  }
}

async function admitted(
  action: "keep" | "replace" | "remove",
  bytes: Uint8Array | null = action === "replace" ? PNG_1X1 : null,
  mediaType = "image/png",
): Promise<{ request: Request; auth: AuthContext }> {
  const prepared = await prepareBrandKitOperation({
    ownerUserId: OWNER_ID,
    businessId: BUSINESS_ID,
    expectedRevision: action === "remove" ? 1 : 0,
    logoAction: action,
    primaryColour: "#dc5430",
    secondaryColour: null,
    footerText: "Trusted footer",
    file: bytes ? { bytes, mediaType } : null,
  });
  const form = new FormData();
  form.append("operation_id", prepared.operationId);
  form.append("binding_sha256", prepared.bindingSha256);
  form.append("business_id", prepared.businessId);
  form.append("expected_revision", String(prepared.expectedRevision));
  form.append("logo_action", prepared.logoAction);
  form.append("primary_colour", prepared.primaryColour);
  form.append("secondary_colour", prepared.secondaryColour ?? "");
  form.append("footer_text", prepared.footerText ?? "");
  if (bytes) {
    const retained = new Uint8Array(bytes.byteLength);
    retained.set(bytes);
    form.append(
      "file",
      new File([retained.buffer], "ignored-name.bin", { type: mediaType }),
    );
  }
  return {
    request: new Request("https://example.test/functions/v1/brand-logo", {
      method: "POST",
      headers: { "x-idempotency-key": prepared.operationId },
    }),
    auth: {
      userId: OWNER_ID,
      isAnonymous: false,
      plan: "free",
      monthlyDocumentCap: 3,
      admin: {} as AuthContext["admin"],
      body: null,
      multipartBody: form,
      generationRequestId: prepared.operationId,
    },
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("brand logo rejects byte/MIME confusion before claiming durable or Storage work", async () => {
  const dependencies = new MemoryBrandLogoDependencies();
  const input = await admitted(
    "replace",
    new TextEncoder().encode("<svg>unsafe-logo</svg>"),
  );
  const response = await handleBrandLogo(
    input.request,
    input.auth,
    dependencies,
  );
  assertEquals(response.status, 400);
  assertEquals(dependencies.claimCalls, 0);
  assertEquals(dependencies.uploadCalls, 0);
  assertEquals((await bodyOf(response)).error, {
    code: "BRAND_LOGO_MEDIA_UNSUPPORTED",
    message: "Choose a valid PNG, JPG or WebP logo.",
    retryable: false,
  });
});

Deno.test("brand replacement publishes one immutable key and completes only after old-key deletion", async () => {
  const dependencies = new MemoryBrandLogoDependencies();
  const oldPath = `brand-kits/${BUSINESS_ID}/logo.png`;
  dependencies.oldPaths = [oldPath];
  dependencies.objects.set(oldPath, PNG_1X1);
  const input = await admitted("replace");
  const response = await handleBrandLogo(
    input.request,
    input.auth,
    dependencies,
  );
  assertEquals(response.status, 200);
  assertEquals(dependencies.uploadCalls, 1);
  assertEquals(dependencies.objects.has(oldPath), false);
  assertEquals(dependencies.completeCalls, 1);
  const published = [...dependencies.objects.keys()][0]!;
  assertMatch(
    published,
    new RegExp(`^brand-kits/${BUSINESS_ID}/logos/[0-9a-f-]+[.]png$`),
  );
  assertEquals(
    dependencies.events.indexOf("activate") <
      dependencies.events.indexOf("remove"),
    true,
  );
  assertEquals(dependencies.events.at(-1), "complete");

  const replay = await handleBrandLogo(input.request, input.auth, dependencies);
  assertEquals(replay.status, 200);
  assertEquals(dependencies.uploadCalls, 1);
  assertEquals(dependencies.completeCalls, 1);
});

Deno.test("brand replacement refuses an existing immutable key with different bytes", async () => {
  const dependencies = new MemoryBrandLogoDependencies();
  const input = await admitted("replace");
  const operationId = input.auth.generationRequestId!;
  dependencies.objects.set(
    `brand-kits/${BUSINESS_ID}/logos/${operationId}.png`,
    new Uint8Array([1, 2, 3]),
  );
  const response = await handleBrandLogo(
    input.request,
    input.auth,
    dependencies,
  );
  assertEquals(response.status, 409);
  assertEquals((await bodyOf(response)).error, {
    code: "BRAND_LOGO_STORAGE_CONFLICT",
    message: "This logo operation conflicts with retained Storage bytes.",
    retryable: false,
  });
  assertEquals(dependencies.completeCalls, 0);
  assertEquals(dependencies.markReconciliationCalls, 1);
  assertEquals(dependencies.resolveReconciliationCalls, 1);
  assertEquals(dependencies.state, "failed");
  assertEquals(dependencies.objects.size, 0);
  assertEquals(
    dependencies.events.indexOf("mark-reconciliation") <
      dependencies.events.indexOf("remove"),
    true,
  );

  const replay = await handleBrandLogo(input.request, input.auth, dependencies);
  assertEquals(replay.status, 409);
  assertEquals((await bodyOf(replay)).error, {
    code: "BRAND_LOGO_STORAGE_CONFLICT",
    message: "This logo operation conflicts with retained Storage bytes.",
    retryable: false,
  });
  assertEquals(dependencies.uploadCalls, 1);
  assertEquals(dependencies.markReconciliationCalls, 1);
  assertEquals(dependencies.resolveReconciliationCalls, 1);
});

Deno.test("brand mismatch resumes exact cleanup without republishing after deletion uncertainty", async () => {
  const dependencies = new MemoryBrandLogoDependencies();
  const input = await admitted("replace");
  const operationId = input.auth.generationRequestId!;
  const retainedPath = `brand-kits/${BUSINESS_ID}/logos/${operationId}.png`;
  dependencies.objects.set(retainedPath, new Uint8Array([1, 2, 3]));
  dependencies.removeFails = true;

  const first = await handleBrandLogo(input.request, input.auth, dependencies);
  assertEquals(first.status, 503);
  assertEquals(dependencies.state, "reconciliation_required");
  assertEquals(dependencies.markReconciliationCalls, 1);
  assertEquals(dependencies.resolveReconciliationCalls, 0);
  assertEquals(dependencies.uploadCalls, 1);
  assertEquals(dependencies.objects.has(retainedPath), true);

  dependencies.removeFails = false;
  const replay = await handleBrandLogo(input.request, input.auth, dependencies);
  assertEquals(replay.status, 409);
  assertEquals((await bodyOf(replay)).error, {
    code: "BRAND_LOGO_STORAGE_CONFLICT",
    message: "This logo operation conflicts with retained Storage bytes.",
    retryable: false,
  });
  assertEquals(dependencies.objects.has(retainedPath), false);
  assertEquals(dependencies.uploadCalls, 1);
  assertEquals(dependencies.markReconciliationCalls, 1);
  assertEquals(dependencies.resolveReconciliationCalls, 1);
  assertEquals(dependencies.state, "failed");
});

Deno.test("brand remove never clears the pointer when deletion acknowledgement is uncertain", async () => {
  const dependencies = new MemoryBrandLogoDependencies();
  const oldPath =
    `brand-kits/${BUSINESS_ID}/logos/b5000000-0000-8000-8000-000000000001.png`;
  dependencies.oldPaths = [oldPath];
  dependencies.objects.set(oldPath, PNG_1X1);
  dependencies.removeFails = true;
  const input = await admitted("remove");
  const response = await handleBrandLogo(
    input.request,
    input.auth,
    dependencies,
  );
  assertEquals(response.status, 503);
  assertEquals(dependencies.completeCalls, 0);
  assertEquals(dependencies.objects.has(oldPath), true);

  dependencies.removeFails = false;
  const replay = await handleBrandLogo(input.request, input.auth, dependencies);
  assertEquals(replay.status, 200);
  assertEquals(dependencies.objects.has(oldPath), false);
  assertEquals(dependencies.completeCalls, 1);
});

Deno.test("brand keep updates the revision without any Storage dispatch", async () => {
  const dependencies = new MemoryBrandLogoDependencies();
  const input = await admitted("keep");
  const response = await handleBrandLogo(
    input.request,
    input.auth,
    dependencies,
  );
  assertEquals(response.status, 200);
  assertEquals(dependencies.uploadCalls, 0);
  assertEquals(dependencies.events, ["claim", "complete"]);
});
