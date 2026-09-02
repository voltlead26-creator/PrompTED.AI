// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertObjectMatch,
  assertRejects,
} from "jsr:@std/assert@1";
import type { AuthContext } from "../_shared/auth-guard.ts";
import {
  IsolatedUploadExtractionError,
  type IsolatedUploadExtractionResult,
} from "../_shared/upload-extraction-client.ts";
import { PrivateStorageObjectError } from "../_shared/private-storage-object.ts";
import {
  deriveUploadRequestIdentity,
  handleIngestUpload as handleGuardedIngestUpload,
  type IngestClaim,
  type IngestClaimInput,
  type IngestDependencies,
  type IngestSettlement,
  type IngestStore,
  requestPrivateStorageObject,
} from "./handler.ts";

const OWNER_ID = "71000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "71000000-0000-4000-8000-000000000002";
const UPLOAD_ID = "72000000-0000-4000-8000-000000000001";

interface StoredUpload extends IngestClaimInput {
  ingestStatus:
    | "processing"
    | "completed"
    | "failed"
    | "reconciliation_required";
  stage:
    | "prepared"
    | "storage_dispatched"
    | "storage_completed"
    | "provider_dispatched";
  claimToken: string;
  httpStatus?: number;
  response?: Record<string, unknown>;
}

class MemoryIngestStore implements IngestStore {
  readonly uploads = new Map<string, StoredUpload>();
  readonly retained = new Map<string, Uint8Array>();
  readonly extractions = new Map<string, IsolatedUploadExtractionResult>();
  readonly events: string[] = [];
  claimCalls = 0;
  retainCalls = 0;
  settleCalls = 0;
  advanceCalls = 0;
  extractionAttemptCalls = 0;
  extractionRecordCalls = 0;
  resumeProcessingOnClaim = false;

  claim(input: IngestClaimInput): Promise<IngestClaim> {
    this.events.push("claim");
    this.claimCalls += 1;
    const existing = this.uploads.get(input.uploadId);
    if (!existing) {
      this.uploads.set(input.uploadId, {
        ...input,
        ingestStatus: "processing",
        stage: "prepared",
        claimToken: "73000000-0000-4000-8000-000000000001",
      });
      return Promise.resolve({
        outcome: "accepted",
        stage: "prepared",
        claimToken: "73000000-0000-4000-8000-000000000001",
      });
    }
    if (
      existing.userId !== input.userId ||
      existing.requestSha256 !== input.requestSha256 ||
      existing.contentSha256 !== input.contentSha256 ||
      existing.filename !== input.filename ||
      existing.mime !== input.mime ||
      existing.byteLength !== input.byteLength
    ) {
      return Promise.resolve({ outcome: "conflict" });
    }
    if (existing.ingestStatus === "processing") {
      if (this.resumeProcessingOnClaim) {
        existing.claimToken = "73000000-0000-4000-8000-000000000002";
        return Promise.resolve({
          outcome: "resumed",
          stage: existing.stage,
          claimToken: existing.claimToken,
        });
      }
      return Promise.resolve({ outcome: "processing", stage: existing.stage });
    }
    return Promise.resolve({
      outcome: existing.ingestStatus,
      httpStatus: existing.httpStatus,
      response: existing.response,
    });
  }

  advance(input: Parameters<IngestStore["advance"]>[0]): Promise<void> {
    this.advanceCalls += 1;
    this.events.push(`advance:${input.nextStage}`);
    const stored = this.uploads.get(input.uploadId);
    if (
      !stored || stored.claimToken !== input.claimToken ||
      stored.stage !== input.expectedStage
    ) throw new Error("synthetic advance conflict");
    stored.stage = input.nextStage;
    return Promise.resolve();
  }

  retainOriginal(
    input: Parameters<IngestStore["retainOriginal"]>[0],
  ): Promise<void> {
    this.events.push("retain");
    this.retainCalls += 1;
    this.retained.set(input.storagePath, Uint8Array.from(input.bytes));
    return Promise.resolve();
  }

  readRetainedOriginal(
    input: Parameters<IngestStore["readRetainedOriginal"]>[0],
  ): Promise<Uint8Array> {
    this.events.push("read-retained");
    const retained = this.retained.get(input.storagePath);
    if (!retained) {
      return Promise.reject(new Error("synthetic missing retained"));
    }
    return Promise.resolve(Uint8Array.from(retained));
  }

  beginExtraction(
    input: Parameters<IngestStore["beginExtraction"]>[0],
  ): Promise<Awaited<ReturnType<IngestStore["beginExtraction"]>>> {
    this.events.push("begin-extraction");
    this.extractionAttemptCalls += 1;
    const stored = this.uploads.get(input.uploadId);
    if (
      !stored || stored.userId !== input.userId ||
      stored.requestSha256 !== input.requestSha256 ||
      stored.claimToken !== input.claimToken ||
      stored.stage !== "storage_completed"
    ) return Promise.reject(new Error("synthetic extraction attempt conflict"));
    return Promise.resolve({
      outcome: this.extractions.has(input.uploadId)
        ? "checkpoint_exists"
        : "accepted",
      attemptForClaim: this.extractionAttemptCalls,
      totalAttempts: this.extractionAttemptCalls,
      retryAfterSeconds: this.extractions.has(input.uploadId) ? 0 : 120,
    });
  }

  loadExtraction(
    input: Parameters<IngestStore["loadExtraction"]>[0],
  ): Promise<IsolatedUploadExtractionResult | null> {
    this.events.push("load-extraction");
    const stored = this.uploads.get(input.uploadId);
    if (
      !stored || stored.userId !== input.userId ||
      stored.requestSha256 !== input.requestSha256 ||
      stored.claimToken !== input.claimToken ||
      !["storage_completed", "provider_dispatched"].includes(stored.stage)
    ) return Promise.reject(new Error("synthetic extraction read conflict"));
    return Promise.resolve(
      structuredClone(this.extractions.get(input.uploadId) ?? null),
    );
  }

  recordExtraction(
    input: Parameters<IngestStore["recordExtraction"]>[0],
  ): Promise<void> {
    this.events.push("record-extraction");
    this.extractionRecordCalls += 1;
    const stored = this.uploads.get(input.uploadId);
    if (
      !stored || stored.userId !== input.userId ||
      stored.requestSha256 !== input.requestSha256 ||
      stored.claimToken !== input.claimToken ||
      stored.stage !== "storage_completed"
    ) return Promise.reject(new Error("synthetic extraction write conflict"));
    const existing = this.extractions.get(input.uploadId);
    if (
      existing && JSON.stringify(existing) !== JSON.stringify(input.extraction)
    ) {
      return Promise.reject(
        new Error("synthetic immutable extraction conflict"),
      );
    }
    this.extractions.set(input.uploadId, structuredClone(input.extraction));
    return Promise.resolve();
  }

  settle(input: IngestSettlement): Promise<void> {
    this.events.push("settle");
    this.settleCalls += 1;
    const stored = this.uploads.get(input.uploadId);
    if (
      !stored || stored.userId !== input.userId ||
      stored.claimToken !== input.claimToken
    ) {
      throw new Error("synthetic missing upload");
    }
    stored.ingestStatus = input.ingestStatus;
    stored.httpStatus = input.httpStatus;
    stored.response = structuredClone(input.response);
    return Promise.resolve();
  }
}

function auth(userId = OWNER_ID): AuthContext {
  return {
    userId,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin: {} as AuthContext["admin"],
    body: null,
    multipartBody: null,
    generationRequestId: UPLOAD_ID,
  };
}

async function handleIngestUpload(
  req: Request,
  context: AuthContext,
  dependencies: IngestDependencies,
): Promise<Response> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  const multipartBody = contentType.includes("multipart/form-data")
    ? await req.formData()
    : null;
  let body = context.body;
  if (contentType.includes("application/json")) {
    const parsed: unknown = await req.clone().json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  }
  return await handleGuardedIngestUpload(
    req,
    { ...context, body, multipartBody },
    dependencies,
  );
}

async function uploadRequest({
  uploadId,
  userId = OWNER_ID,
  filename = "resume.txt",
  content = "Reliable source text",
  situation = "Tailor this resume",
  headerIdentity = true,
  fieldIdentity = true,
  requestIdentity = false,
  requestHeaderIdentity = true,
}: {
  uploadId?: string;
  userId?: string;
  filename?: string;
  content?: string;
  situation?: string;
  headerIdentity?: boolean;
  fieldIdentity?: boolean;
  requestIdentity?: boolean;
  requestHeaderIdentity?: boolean;
} = {}): Promise<Request> {
  const bytes = new TextEncoder().encode(content);
  const identity = await deriveUploadRequestIdentity({
    userId,
    filename,
    mime: "text/plain",
    bytes,
    situationText: situation,
  });
  const requestId = uploadId ?? identity.uploadId;
  const form = new FormData();
  form.append("file", new File([content], filename, { type: "text/plain" }));
  if (situation) form.append("situation_text", situation);
  if (fieldIdentity) form.append("upload_id", requestId);
  if (requestIdentity) form.append("request_id", requestId);
  const headers = new Headers();
  if (headerIdentity) headers.set("x-idempotency-key", requestId);
  if (requestHeaderIdentity) headers.set("x-request-id", requestId);
  return new Request("https://example.invalid/functions/v1/ingest-upload", {
    method: "POST",
    headers,
    body: form,
  });
}

async function jsonUploadRequest(
  { conflict = false }: { conflict?: boolean } = {},
) {
  const content = "Reliable JSON source text";
  const bytes = new TextEncoder().encode(content);
  const identity = await deriveUploadRequestIdentity({
    userId: OWNER_ID,
    filename: "resume.txt",
    mime: "text/plain",
    bytes,
    situationText: "Tailor this resume",
  });
  const headers = new Headers({
    "content-type": "application/json",
    "x-idempotency-key": identity.uploadId,
    "x-request-id": identity.uploadId,
  });
  return new Request("https://example.invalid/functions/v1/ingest-upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      upload_id: identity.uploadId,
      request_id: conflict ? OTHER_OWNER_ID : identity.uploadId,
      filename: "resume.txt",
      mime: "text/plain",
      content_base64: btoa(content),
      situation_text: "Tailor this resume",
    }),
  });
}

function dependencies(store: IngestStore): IngestDependencies & {
  extractCalls: number;
  classifyCalls: number;
  identities: string[];
  events: string[];
  legacyAdapterCalls: number;
} {
  const dependency = {
    store,
    extractCalls: 0,
    classifyCalls: 0,
    identities: [] as string[],
    allowLegacyMissingIdentity: true,
    legacyAdapterCalls: 0,
    events: "events" in store && Array.isArray(store.events)
      ? (store.events as string[])
      : [],
    recordLegacyIdentityAdapter() {
      dependency.legacyAdapterCalls += 1;
    },
    setRequestIdentity(_signal: AbortSignal, requestId: string) {
      dependency.identities.push(requestId);
      dependency.events.push("identity");
    },
    extractText(input: Parameters<IngestDependencies["extractText"]>[0]) {
      dependency.extractCalls += 1;
      dependency.events.push("extract");
      const memoryStore = store as Partial<MemoryIngestStore>;
      const stored = memoryStore.uploads?.get(input.uploadId);
      const retained = stored
        ? memoryStore.retained?.get(stored.storagePath)
        : undefined;
      if (!stored || !retained) {
        return Promise.reject(new Error("synthetic retained source missing"));
      }
      return Promise.resolve({
        text: new TextDecoder().decode(retained),
        format: "text" as const,
        truncated: false,
        resourcePolicyVersion: "upload-resource-policy.1" as const,
        contentSha256: stored.contentSha256,
      });
    },
    classify(request: Parameters<IngestDependencies["classify"]>[0]) {
      dependency.classifyCalls += 1;
      dependency.events.push("classify");
      if (
        request.outputSchema?.name !== "prompted_ingest_classification" ||
        request.outputSchema.schema.additionalProperties !== false
      ) throw new Error("strict classification schema missing");
      const structured = {
        document_type: "resume",
        purpose: "A retained synthetic summary.",
        sections: [{ title: "Experience", items: ["Reliable work"] }],
      };
      return Promise.resolve({
        text: JSON.stringify(structured),
        structured,
      });
    },
  };
  return dependency;
}

Deno.test(
  "ingest-upload UUIDv8 identity is stable, NFKC-canonical, user-scoped, and payload-sensitive",
  async () => {
    const base = {
      userId: OWNER_ID,
      filename: "Ｒesume.txt",
      mime: "TEXT/PLAIN",
      bytes: new TextEncoder().encode("Reliable source text"),
      situationText: "Cafe\u0301 role",
    };
    const first = await deriveUploadRequestIdentity(base);
    const exact = await deriveUploadRequestIdentity(base);
    const canonical = await deriveUploadRequestIdentity({
      ...base,
      filename: "Resume.txt",
      mime: "text/plain",
      situationText: "Café role",
    });
    const changedPayload = await deriveUploadRequestIdentity({
      ...base,
      bytes: new TextEncoder().encode("Changed source text"),
    });
    const changedSituation = await deriveUploadRequestIdentity({
      ...base,
      situationText: "Different outcome",
    });
    const otherOwner = await deriveUploadRequestIdentity({
      ...base,
      userId: OTHER_OWNER_ID,
    });

    assertEquals(exact, first);
    assertEquals(canonical, first);
    assertEquals(first.uploadId.slice(14, 15), "8");
    assertEquals(
      ["8", "9", "a", "b"].includes(first.uploadId.slice(19, 20)),
      true,
    );
    assertEquals(changedPayload.uploadId === first.uploadId, false);
    assertEquals(changedSituation.uploadId === first.uploadId, false);
    assertEquals(otherOwner.uploadId === first.uploadId, false);
  },
);

Deno.test(
  "ingest-upload exact replay returns the retained response without a second extraction, object upload, or model call",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);

    const first = await handleIngestUpload(await uploadRequest(), auth(), deps);
    const firstBody = await first.json();
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );
    const replayBody = await replay.json();
    const uploadId = String(firstBody.upload_id);

    assertEquals(first.status, 200);
    assertEquals(replay.status, 200);
    assertEquals(replayBody, firstBody);
    assertObjectMatch(firstBody, {
      extracted_text: "Reliable source text",
      classification_status: "completed",
    });
    assertEquals(/^.{14}8.{21}$/.test(uploadId), true);
    assertEquals(store.uploads.size, 1);
    const retained = store.uploads.get(uploadId)!;
    assertEquals(retained.requestSha256.length, 64);
    assertEquals(retained.contentSha256.length, 64);
    assertEquals(store.claimCalls, 2);
    assertEquals(store.retainCalls, 1);
    assertEquals(store.settleCalls, 1);
    assertEquals(store.advanceCalls, 3);
    assertEquals(deps.extractCalls, 1);
    assertEquals(deps.classifyCalls, 1);
    assertEquals(deps.identities, [uploadId, uploadId]);
    assertEquals(store.events, [
      "identity",
      "claim",
      "advance:storage_dispatched",
      "retain",
      "advance:storage_completed",
      "load-extraction",
      "begin-extraction",
      "extract",
      "record-extraction",
      "advance:provider_dispatched",
      "classify",
      "settle",
      "identity",
      "claim",
    ]);
  },
);

Deno.test("JSON uploads bind both body and both header identity carriers", async () => {
  const store = new MemoryIngestStore();
  const deps = dependencies(store);
  const response = await handleIngestUpload(
    await jsonUploadRequest(),
    auth(),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals(store.claimCalls, 1);
  const conflict = await handleIngestUpload(
    await jsonUploadRequest({ conflict: true }),
    auth(),
    dependencies(new MemoryIngestStore()),
  );
  const body = await conflict.json();
  assertEquals(conflict.status, 409);
  assertEquals(
    (body.error as { code: string }).code,
    "UPLOAD_REQUEST_ID_CONFLICT",
  );
});

Deno.test("JSON uploads fail closed when the request guard did not admit a body", async () => {
  const store = new MemoryIngestStore();
  const response = await handleGuardedIngestUpload(
    await jsonUploadRequest(),
    auth(),
    dependencies(store),
  );
  const body = await response.json();
  assertEquals(response.status, 400);
  assertEquals(
    (body.error as { code: string }).code,
    "UPLOAD_JSON_NOT_ADMITTED",
  );
  assertEquals(store.claimCalls, 0);
});

Deno.test("server upload identity matches the client 300/200 truncation boundary", async () => {
  const filename300 = `${"a".repeat(296)}.txt`;
  const filename301 = `${filename300}b`;
  const mime200 = `application/${"x".repeat(188)}`;
  const mime201 = `${mime200}y`;
  const fixture = {
    userId: "11111111-1111-4111-8111-111111111111",
    bytes: new TextEncoder().encode("boundary-fixture"),
    situationText: "Boundary situation",
  };
  const bounded = await deriveUploadRequestIdentity({
    ...fixture,
    filename: filename300,
    mime: mime200,
  });
  const truncated = await deriveUploadRequestIdentity({
    ...fixture,
    filename: filename301,
    mime: mime201,
  });
  assertEquals(bounded, truncated);
  assertEquals(bounded.uploadId, "13e6ff2f-5b5e-8db5-9ec7-1a8c555a0a22");
  assertEquals(
    bounded.contentSha256,
    "1e7d23b7dcf6ab45241d2fe4d2c45fedb7c3e8f2595656953ff1e127a6359219",
  );
  assertEquals(bounded.filename.length, 300);
  assertEquals(bounded.mime.length, 200);
});

Deno.test(
  "expired storage-dispatched replay proves the exact retained bytes and resumes without re-upload",
  async () => {
    const store = new MemoryIngestStore();
    store.resumeProcessingOnClaim = true;
    const bytes = new TextEncoder().encode("Reliable source text");
    const identity = await deriveUploadRequestIdentity({
      userId: OWNER_ID,
      filename: "resume.txt",
      mime: "text/plain",
      bytes,
      situationText: "Tailor this resume",
    });
    const storagePath = `${OWNER_ID}/${identity.uploadId}/resume.txt`;
    store.uploads.set(identity.uploadId, {
      uploadId: identity.uploadId,
      userId: OWNER_ID,
      storagePath,
      filename: identity.filename,
      mime: identity.mime,
      byteLength: bytes.byteLength,
      requestSha256: identity.requestSha256,
      contentSha256: identity.contentSha256,
      ingestStatus: "processing",
      stage: "storage_dispatched",
      claimToken: "73000000-0000-4000-8000-000000000001",
    });
    store.retained.set(storagePath, bytes);
    const deps = dependencies(store);

    const response = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.classification_status, "completed");
    assertEquals(store.retainCalls, 0);
    assertEquals(store.events.includes("read-retained"), true);
    assertEquals(store.advanceCalls, 2);
    assertEquals(deps.extractCalls, 1);
    assertEquals(deps.classifyCalls, 1);
  },
);

Deno.test(
  "ingest classification settles missing, extra, and malformed structured fields as an exact non-2xx replay",
  async () => {
    const cases: Array<Record<string, unknown> | undefined> = [
      {
        document_type: "resume",
        purpose: "Purpose",
        sections: [{ title: "Experience", items: [] }],
        extra: "not allowed",
      },
      { document_type: "resume", sections: [] },
      {
        document_type: "resume",
        purpose: "Purpose",
        sections: [{ title: "   ", items: ["Reliable work"] }],
      },
      {
        document_type: "resume",
        purpose: "   ",
        sections: [{ title: "Experience", items: ["Reliable work"] }],
      },
      undefined,
    ];
    for (const [index, structured] of cases.entries()) {
      const store = new MemoryIngestStore();
      const deps = dependencies(store);
      deps.classify = () => {
        deps.classifyCalls += 1;
        return Promise.resolve({ text: "provider-completed", structured });
      };
      const requestOptions = {
        content: `Reliable source text ${index}`,
        situation: `Tailor this resume ${index}`,
      };
      const first = await handleIngestUpload(
        await uploadRequest(requestOptions),
        auth(),
        deps,
      );
      const firstBody = await first.json();
      const replay = await handleIngestUpload(
        await uploadRequest(requestOptions),
        auth(),
        deps,
      );
      assertEquals(first.status, 502);
      assertEquals(replay.status, 502);
      assertEquals(await replay.json(), firstBody);
      assertEquals(firstBody.classification_status, "failed");
      assertEquals(
        (firstBody.error as { code: string }).code,
        "UPLOAD_CLASSIFICATION_FAILED",
      );
      assertEquals(deps.classifyCalls, 1);
      assertEquals(store.retainCalls, 1);
    }
  },
);

Deno.test(
  "ingest classification provider failure settles and exactly replays one stable non-2xx response",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    deps.classify = () => {
      deps.classifyCalls += 1;
      return Promise.reject(new Error("synthetic provider failure"));
    };

    const first = await handleIngestUpload(await uploadRequest(), auth(), deps);
    const firstBody = await first.json();
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );

    assertEquals(first.status, 502);
    assertEquals(replay.status, 502);
    assertEquals(await replay.json(), firstBody);
    assertEquals(firstBody.classification_status, "failed");
    assertEquals(
      (firstBody.error as { code: string }).code,
      "UPLOAD_CLASSIFICATION_FAILED",
    );
    assertEquals(firstBody.original_retained, true);
    assertEquals(deps.classifyCalls, 1);
    assertEquals(store.settleCalls, 1);
  },
);

Deno.test(
  "ingest-upload rejects a malformed supplied UUID before durable or provider work",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    const response = await handleIngestUpload(
      await uploadRequest({ uploadId: "not-a-uuid" }),
      auth(),
      deps,
    );
    const body = await response.json();

    assertEquals(response.status, 400);
    assertEquals(
      (body.error as { code: string }).code,
      "UPLOAD_REQUEST_ID_INVALID",
    );
    assertEquals(store.claimCalls, 0);
    assertEquals(store.retainCalls, 0);
    assertEquals(deps.extractCalls, 0);
    assertEquals(deps.classifyCalls, 0);
  },
);

Deno.test(
  "ingest-upload derives a UUIDv8 for legacy clients without identity carriers behind a removable adapter",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    const response = await handleIngestUpload(
      await uploadRequest({
        headerIdentity: false,
        requestHeaderIdentity: false,
        fieldIdentity: false,
      }),
      auth(),
      deps,
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(String(body.upload_id).slice(14, 15), "8");
    assertEquals(deps.legacyAdapterCalls, 1);

    const disabledStore = new MemoryIngestStore();
    const disabled = dependencies(disabledStore);
    disabled.allowLegacyMissingIdentity = false;
    const rejected = await handleIngestUpload(
      await uploadRequest({
        headerIdentity: false,
        requestHeaderIdentity: false,
        fieldIdentity: false,
      }),
      auth(),
      disabled,
    );
    assertEquals(rejected.status, 400);
    assertEquals(disabledStore.claimCalls, 0);
  },
);

Deno.test(
  "ingest-upload accepts canonical upload_id and bounded request_id alias carriers",
  async () => {
    for (
      const request of [
        await uploadRequest({
          headerIdentity: false,
          requestHeaderIdentity: false,
        }),
        await uploadRequest({
          headerIdentity: false,
          requestHeaderIdentity: false,
          fieldIdentity: false,
          requestIdentity: true,
        }),
      ]
    ) {
      const store = new MemoryIngestStore();
      const deps = dependencies(store);
      assertEquals(
        (await handleIngestUpload(request, auth(), deps)).status,
        200,
      );
      assertEquals(store.claimCalls, 1);
    }
  },
);

Deno.test(
  "ingest-upload fails closed when header and canonical multipart identities differ",
  async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["source"], "resume.txt", { type: "text/plain" }),
    );
    form.append("upload_id", UPLOAD_ID);
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    const response = await handleIngestUpload(
      new Request("https://example.invalid/functions/v1/ingest-upload", {
        method: "POST",
        headers: {
          "x-idempotency-key": "72000000-0000-4000-8000-000000000002",
        },
        body: form,
      }),
      auth(),
      deps,
    );

    assertEquals(response.status, 409);
    assertEquals(store.claimCalls, 0);
    assertEquals(deps.classifyCalls, 0);
  },
);

Deno.test(
  "ingest-upload rejects x-idempotency-key, x-request-id, upload_id, and request_id disagreement before claim",
  async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["source"], "resume.txt", { type: "text/plain" }),
    );
    form.append("upload_id", "72000000-0000-4000-8000-000000000003");
    form.append("request_id", "72000000-0000-4000-8000-000000000004");
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    const response = await handleIngestUpload(
      new Request("https://example.invalid/functions/v1/ingest-upload", {
        method: "POST",
        headers: {
          "x-idempotency-key": UPLOAD_ID,
          "x-request-id": "72000000-0000-4000-8000-000000000002",
        },
        body: form,
      }),
      auth(),
      deps,
    );

    assertEquals(response.status, 409);
    assertEquals(store.claimCalls, 0);
    assertEquals(store.retainCalls, 0);
    assertEquals(deps.extractCalls, 0);
    assertEquals(deps.classifyCalls, 0);
  },
);

Deno.test(
  "ingest-upload changed payload and cross-owner replay fail before object or provider work",
  async () => {
    const store = new MemoryIngestStore();
    const firstDeps = dependencies(store);
    const first = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      firstDeps,
    );
    const firstBody = await first.json();
    const firstUploadId = String(firstBody.upload_id);
    assertEquals(first.status, 200);

    for (
      const [request, context] of [
        [
          await uploadRequest({
            uploadId: firstUploadId,
            content: "Changed source text",
          }),
          auth(),
        ],
        [
          await uploadRequest({
            uploadId: firstUploadId,
            filename: "changed-name.txt",
          }),
          auth(),
        ],
        [
          await uploadRequest({
            uploadId: firstUploadId,
            situation: "Use this for a different outcome",
          }),
          auth(),
        ],
        [
          await uploadRequest({
            uploadId: firstUploadId,
            userId: OTHER_OWNER_ID,
          }),
          auth(OTHER_OWNER_ID),
        ],
      ] as const
    ) {
      const replayDeps = dependencies(store);
      const response = await handleIngestUpload(request, context, replayDeps);
      const body = await response.json();
      assertEquals(response.status, 409);
      assertEquals(
        (body.error as { code: string }).code,
        "UPLOAD_REQUEST_ID_PAYLOAD_MISMATCH",
      );
      assertEquals(replayDeps.extractCalls, 0);
      assertEquals(replayDeps.classifyCalls, 0);
      assertEquals(store.retainCalls, 1);
    }

    const otherDeps = dependencies(store);
    const other = await handleIngestUpload(
      await uploadRequest({ userId: OTHER_OWNER_ID }),
      auth(OTHER_OWNER_ID),
      otherDeps,
    );
    const otherBody = await other.json();
    assertEquals(other.status, 200);
    assertEquals(String(otherBody.upload_id) === firstUploadId, false);
    assertEquals(store.uploads.size, 2);
  },
);

Deno.test(
  "ingest-upload reconciliation is retained as 409 and never redispatches storage or classification",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    deps.classify = () => {
      deps.classifyCalls += 1;
      deps.events.push("classify");
      return Promise.reject({ code: "OPENAI_ACK_UNRESOLVED" });
    };

    const first = await handleIngestUpload(await uploadRequest(), auth(), deps);
    const firstBody = await first.json();
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );
    const replayBody = await replay.json();

    assertEquals(first.status, 409);
    assertEquals(replay.status, 409);
    assertEquals(replayBody, firstBody);
    assertEquals(
      (firstBody.error as { code: string }).code,
      "UPLOAD_CLASSIFICATION_RECONCILIATION_REQUIRED",
    );
    assertEquals(store.uploads.size, 1);
    assertEquals(store.retainCalls, 1);
    assertEquals(store.settleCalls, 1);
    assertEquals(deps.extractCalls, 1);
    assertEquals(deps.classifyCalls, 1);
  },
);

Deno.test(
  "ingest-upload keeps isolated extractor termination resumable without duplicate retention or provider work",
  async () => {
    const store = new MemoryIngestStore();
    const interrupted = dependencies(store);
    interrupted.extractText = () => {
      interrupted.extractCalls += 1;
      interrupted.events.push("extract");
      return Promise.reject(
        new IsolatedUploadExtractionError(
          503,
          "UPLOAD_EXTRACTION_UNAVAILABLE",
          "Synthetic isolated worker termination.",
          true,
        ),
      );
    };

    const first = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      interrupted,
    );
    const firstBody = await first.json();
    const uploadId = String(firstBody.upload_id);
    assertEquals(first.status, 503);
    assertEquals(first.headers.get("Retry-After"), "120");
    assertEquals(firstBody.classification_status, "processing");
    assertEquals(store.uploads.get(uploadId)?.stage, "storage_completed");
    assertEquals(store.settleCalls, 0);
    assertEquals(store.retainCalls, 1);
    assertEquals(interrupted.classifyCalls, 0);

    store.resumeProcessingOnClaim = true;
    const resumed = dependencies(store);
    const second = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      resumed,
    );
    assertEquals(second.status, 200);
    assertEquals(store.retainCalls, 1);
    assertEquals(store.settleCalls, 1);
    assertEquals(resumed.extractCalls, 1);
    assertEquals(resumed.classifyCalls, 1);
  },
);

Deno.test(
  "ingest-upload checkpoints extraction before provider dispatch",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    const response = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );

    assertEquals(response.status, 200);
    const recordIndex = store.events.indexOf("record-extraction");
    const dispatchIndex = store.events.indexOf("advance:provider_dispatched");
    const classifyIndex = store.events.indexOf("classify");
    assertEquals(recordIndex >= 0, true);
    assertEquals(recordIndex < dispatchIndex, true);
    assertEquals(dispatchIndex < classifyIndex, true);
    assertEquals(store.extractionAttemptCalls, 1);
    assertEquals(store.extractionRecordCalls, 1);
  },
);

Deno.test(
  "ingest-upload provider-dispatched replay uses the exact extraction checkpoint without reparsing",
  async () => {
    const store = new MemoryIngestStore();
    const interrupted = dependencies(store);
    interrupted.classify = () => {
      interrupted.classifyCalls += 1;
      interrupted.events.push("classify");
      return Promise.reject({ code: "OPENAI_MODEL_CALL_IN_PROGRESS" });
    };

    const first = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      interrupted,
    );
    const firstBody = await first.json();
    assertEquals(first.status, 409);
    assertEquals(
      firstBody.durable_stage ?? "provider_dispatched",
      "provider_dispatched",
    );
    assertEquals(store.extractions.size, 1);

    store.resumeProcessingOnClaim = true;
    const resumed = dependencies(store);
    const second = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      resumed,
    );
    assertEquals(second.status, 200);
    assertEquals(resumed.extractCalls, 0);
    assertEquals(resumed.classifyCalls, 1);
    assertEquals(store.extractionRecordCalls, 1);
  },
);

Deno.test(
  "ingest-upload terminally settles deterministic parser limits and exactly replays them",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    deps.extractText = () => {
      deps.extractCalls += 1;
      deps.events.push("extract");
      return Promise.reject(
        new IsolatedUploadExtractionError(
          413,
          "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
          "That Office file expands beyond the safe processing limit.",
          false,
        ),
      );
    };

    const first = await handleIngestUpload(await uploadRequest(), auth(), deps);
    const firstBody = await first.json();
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );
    assertEquals(first.status, 413);
    assertEquals(replay.status, 413);
    assertEquals(await replay.json(), firstBody);
    assertEquals(
      (firstBody.error as { code: string }).code,
      "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
    );
    assertEquals(store.settleCalls, 1);
    assertEquals(store.retainCalls, 1);
    assertEquals(deps.extractCalls, 1);
    assertEquals(deps.classifyCalls, 0);
  },
);

Deno.test(
  "ingest-upload retains the original before extraction failure and exactly replays the retained error",
  async () => {
    const store = new MemoryIngestStore();
    const deps = dependencies(store);
    deps.extractText = () => {
      deps.extractCalls += 1;
      deps.events.push("extract");
      return Promise.reject(
        new IsolatedUploadExtractionError(
          422,
          "UPLOAD_FORMAT_UNSUPPORTED",
          "That file type is not supported.",
          false,
        ),
      );
    };

    const first = await handleIngestUpload(await uploadRequest(), auth(), deps);
    const firstBody = await first.json();
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );
    const replayBody = await replay.json();

    assertEquals(first.status, 422);
    assertEquals(replay.status, 422);
    assertEquals(replayBody, firstBody);
    assertEquals(firstBody.original_retained, true);
    assertEquals(typeof firstBody.storage_path, "string");
    assertEquals(store.retainCalls, 1);
    assertEquals(store.settleCalls, 1);
    assertEquals(deps.extractCalls, 1);
    assertEquals(deps.classifyCalls, 0);
    assertEquals(store.events.slice(0, 9), [
      "identity",
      "claim",
      "advance:storage_dispatched",
      "retain",
      "advance:storage_completed",
      "load-extraction",
      "begin-extraction",
      "extract",
      "settle",
    ]);
  },
);

Deno.test(
  "ingest-upload preserves unknown Storage outcome as exact reconciliation evidence",
  async () => {
    const store = new MemoryIngestStore();
    store.retainOriginal = () => {
      store.events.push("retain");
      store.retainCalls += 1;
      return Promise.reject(new Error("synthetic response loss"));
    };
    const deps = dependencies(store);

    const first = await handleIngestUpload(await uploadRequest(), auth(), deps);
    const firstBody = await first.json();
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      deps,
    );
    const replayBody = await replay.json();

    assertEquals(first.status, 409);
    assertEquals(replay.status, 409);
    assertEquals(replayBody, firstBody);
    assertEquals(firstBody.original_retained, null);
    assertEquals(firstBody.storage_status, "unknown");
    assertEquals(typeof firstBody.storage_path, "string");
    assertEquals(store.retainCalls, 1);
    assertEquals(store.settleCalls, 1);
    assertEquals(deps.extractCalls, 0);
    assertEquals(deps.classifyCalls, 0);
  },
);

Deno.test(
  "ingest-upload returns 409 for an exact processing replay without downstream work",
  async () => {
    const store: IngestStore = {
      claim: () => Promise.resolve({ outcome: "processing" }),
      advance: () => Promise.reject(new Error("must not advance")),
      retainOriginal: () => Promise.reject(new Error("must not retain")),
      readRetainedOriginal: () => Promise.reject(new Error("must not read")),
      beginExtraction: () => Promise.reject(new Error("must not extract")),
      loadExtraction: () => Promise.reject(new Error("must not load")),
      recordExtraction: () => Promise.reject(new Error("must not record")),
      settle: () => Promise.reject(new Error("must not settle")),
    };
    const replayDeps = dependencies(store);
    const replay = await handleIngestUpload(
      await uploadRequest(),
      auth(),
      replayDeps,
    );
    const body = await replay.json();

    assertEquals(replay.status, 409);
    assertEquals((body.error as { code: string }).code, "UPLOAD_PROCESSING");
    assertEquals(replay.headers.get("Retry-After"), "120");
    assertEquals(body.retryable, true);
    assertEquals(body.retry_after_seconds, 120);
    assertEquals(replayDeps.extractCalls, 0);
    assertEquals(replayDeps.classifyCalls, 0);
  },
);

Deno.test(
  "original-document Storage requests abort the underlying fetch before the durable lease expires",
  async () => {
    let observedAbort = false;
    const failure = await assertRejects(
      () =>
        requestPrivateStorageObject(
          {
            baseUrl: "https://project.supabase.co",
            serviceRoleKey: "synthetic-service-role",
            bucket: "original-documents",
            path: `${OWNER_ID}/${UPLOAD_ID}/resume.txt`,
            method: "POST",
            bytes: new TextEncoder().encode("source"),
            contentType: "text/plain",
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
    );
    assertEquals(failure instanceof PrivateStorageObjectError, true);
    if (!(failure instanceof PrivateStorageObjectError)) {
      throw new Error("expected typed private Storage failure");
    }
    assertEquals(failure.kind, "retryable");
    assertEquals(failure.message, "PRIVATE_STORAGE_RETRYABLE");
    assertEquals(observedAbort, true);
  },
);
