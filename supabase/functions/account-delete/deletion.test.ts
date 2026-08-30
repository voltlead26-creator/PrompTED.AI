import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  accountDeletionAuditId,
  type AccountDeletionGateway,
  type AccountDeletionProgress,
  deleteAccountData,
  type QueryResult,
} from "./deletion.ts";
import type { StorageEntry, StorageListOptions } from "./assets.ts";

const userId = "81000000-0000-4000-8000-000000000001";
const businessId = "82000000-0000-4000-8000-000000000001";

function ok<T>(data: T): QueryResult<T> {
  return { data, error: null };
}

interface GatewayFixture {
  ownedBusinesses?: QueryResult<Array<{ id: unknown }>>;
  ownedBusinessSequence?: Array<QueryResult<Array<{ id: unknown }>>>;
  otherMemberships?: QueryResult<
    Array<{ business_id: unknown; user_id: unknown }>
  >;
  otherMembershipSequence?: Array<
    QueryResult<Array<{ business_id: unknown; user_id: unknown }>>
  >;
  objects?: Record<string, StorageEntry[]>;
  listErrorAt?: string;
  removeErrorAt?: string;
  auditError?: unknown;
  deleteErrors?: unknown[];
}

function gateway(fixture: GatewayFixture = {}) {
  const calls: string[] = [];
  const removed: string[] = [];
  const auditIds: string[] = [];
  const objects = new Map(
    Object.entries(fixture.objects ?? {}).map((
      [key, value],
    ) => [key, [...value]]),
  );
  let deleteAttempt = 0;
  let businessLookup = 0;
  let membershipLookup = 0;

  const implementation: AccountDeletionGateway = {
    async loadOwnedBusinesses(requestedUserId) {
      calls.push(`businesses:${requestedUserId}`);
      const result = fixture.ownedBusinessSequence?.[businessLookup] ??
        fixture.ownedBusinesses ?? ok([{ id: businessId }]);
      businessLookup += 1;
      return result;
    },
    async loadOtherMemberships(businessIds, requestedUserId) {
      calls.push(`memberships:${businessIds.join(",")}:${requestedUserId}`);
      const result = fixture.otherMembershipSequence?.[membershipLookup] ??
        fixture.otherMemberships ?? ok([]);
      membershipLookup += 1;
      return result;
    },
    async listStorage(bucket, prefix, options: StorageListOptions) {
      calls.push(`list:${bucket}:${prefix}:${options.offset}`);
      if (`${bucket}:${prefix}` === fixture.listErrorAt) {
        return { data: null, error: new Error("list failed") };
      }
      const entries = objects.get(`${bucket}:${prefix}`) ?? [];
      return {
        data: entries.slice(options.offset, options.offset + options.limit),
        error: null,
      };
    },
    async removeStorage(bucket, paths) {
      calls.push(`remove:${bucket}:${paths.join(",")}`);
      if (bucket === fixture.removeErrorAt) {
        return { error: new Error("remove failed") };
      }
      for (const path of paths) {
        removed.push(`${bucket}:${path}`);
        const slash = path.lastIndexOf("/");
        const key = `${bucket}:${path.slice(0, slash)}`;
        objects.set(
          key,
          (objects.get(key) ?? []).filter((entry) =>
            entry.name !== path.slice(slash + 1)
          ),
        );
      }
      return { error: null };
    },
    async upsertDeletionAudit(record) {
      calls.push("audit");
      auditIds.push(record.id);
      return { error: fixture.auditError ?? null };
    },
    async deleteAuthUser(requestedUserId) {
      calls.push(`delete:${requestedUserId}`);
      const error = fixture.deleteErrors?.[deleteAttempt] ?? null;
      deleteAttempt += 1;
      return { error };
    },
  };

  return { implementation, calls, removed, auditIds, objects };
}

function assertState(
  result: { deletion: AccountDeletionProgress },
  state: AccountDeletionProgress["state"],
) {
  assertEquals(result.deletion.state, state);
}

Deno.test("owned businesses with another member block before any destructive action", async () => {
  const fixture = gateway({
    otherMemberships: ok([{
      business_id: businessId,
      user_id: "another-user",
    }]),
    objects: {
      [`assets:brand-kits/${businessId}`]: [{ id: "logo", name: "logo.png" }],
    },
  });

  const result = await deleteAccountData(userId, fixture.implementation);

  assert(!result.ok);
  assertEquals(result.code, "BUSINESS_TRANSFER_REQUIRED");
  assertEquals(result.status, 409);
  assertState(result, "not_started");
  assertEquals(fixture.calls, [
    `businesses:${userId}`,
    `memberships:${businessId}:${userId}`,
  ]);
  assertEquals(fixture.removed, []);
});

Deno.test("query and list failures fail closed before deletion", async () => {
  const queryFailure = gateway({
    ownedBusinesses: { data: null, error: new Error("query failed") },
  });
  const queryResult = await deleteAccountData(
    userId,
    queryFailure.implementation,
  );
  assert(!queryResult.ok);
  assertEquals(queryResult.code, "DELETION_PREFLIGHT_FAILED");
  assertState(queryResult, "not_started");
  assertEquals(queryFailure.calls, [`businesses:${userId}`]);

  const listFailure = gateway({
    listErrorAt: `assets:brand-kits/${businessId}`,
  });
  const listResult = await deleteAccountData(
    userId,
    listFailure.implementation,
  );
  assert(!listResult.ok);
  assertEquals(listResult.code, "DELETION_PREFLIGHT_FAILED");
  assertState(listResult, "not_started");
  assertEquals(
    listFailure.calls.some((call) => call.startsWith("remove:")),
    false,
  );
  assertEquals(listFailure.calls.includes(`delete:${userId}`), false);
});

Deno.test("a changed owned-business scope blocks before the first mutation", async () => {
  const newBusinessId = "82000000-0000-4000-8000-000000000002";
  const fixture = gateway({
    ownedBusinessSequence: [
      ok([{ id: businessId }]),
      ok([{ id: businessId }, { id: newBusinessId }]),
    ],
    objects: {
      [`assets:brand-kits/${businessId}`]: [{ id: "logo", name: "logo.png" }],
    },
  });

  const result = await deleteAccountData(userId, fixture.implementation);

  assert(!result.ok);
  assertEquals(result.code, "DELETION_PREFLIGHT_FAILED");
  assertState(result, "not_started");
  assertEquals(fixture.calls.some((call) => call.startsWith("remove:")), false);
  assertEquals(fixture.calls.includes(`delete:${userId}`), false);
});

Deno.test("deletion removes every owned brand object and only the authenticated user's originals", async () => {
  const foreignBusinessId = "82000000-0000-4000-8000-000000000099";
  const fixture = gateway({
    objects: {
      [`assets:brand-kits/${businessId}`]: [
        { id: "png", name: "logo.png" },
        { id: "svg", name: "logo.svg" },
        { id: "webp", name: "orphan.webp" },
      ],
      [`assets:brand-kits/${foreignBusinessId}`]: [{
        id: "foreign-logo",
        name: "logo.png",
      }],
      [`original-documents:${userId}`]: [
        { id: "resume", name: "resume.pdf" },
        { id: null, name: "nested" },
      ],
      [`original-documents:${userId}/nested`]: [{
        id: "letter",
        name: "letter.docx",
      }],
      "original-documents:another-user": [{
        id: "foreign",
        name: "private.pdf",
      }],
    },
  });

  const result = await deleteAccountData(userId, fixture.implementation);

  assertEquals(result.ok, true);
  assertState(result, "complete");
  assertEquals(result.deletion.storage_objects_removed, 5);
  assertEquals(fixture.removed.sort(), [
    `assets:brand-kits/${businessId}/logo.png`,
    `assets:brand-kits/${businessId}/logo.svg`,
    `assets:brand-kits/${businessId}/orphan.webp`,
    `original-documents:${userId}/nested/letter.docx`,
    `original-documents:${userId}/resume.pdf`,
  ]);
  assertEquals(
    fixture.calls.some((call) => call.includes("another-user")),
    false,
  );
  assertEquals(
    fixture.calls.some((call) => call.includes(foreignBusinessId)),
    false,
  );
  assertEquals(fixture.calls.at(-1), `delete:${userId}`);
});

Deno.test("a remove error stops the cascade and reports an indeterminate deletion state", async () => {
  const fixture = gateway({
    removeErrorAt: "assets",
    objects: {
      [`assets:brand-kits/${businessId}`]: [{ id: "logo", name: "logo.png" }],
    },
  });

  const result = await deleteAccountData(userId, fixture.implementation);

  assert(!result.ok);
  assertEquals(result.code, "STORAGE_DELETION_FAILED");
  assertState(result, "indeterminate");
  assertEquals(fixture.calls.includes("audit"), false);
  assertEquals(fixture.calls.includes(`delete:${userId}`), false);
});

Deno.test("a later auth failure reports confirmed partial deletion and retry removes no object twice", async () => {
  const fixture = gateway({
    deleteErrors: [new Error("auth unavailable"), null],
    objects: {
      [`assets:brand-kits/${businessId}`]: [{
        id: "old-logo",
        name: "logo.gif",
      }],
      [`original-documents:${userId}`]: [{ id: "upload", name: "resume.pdf" }],
    },
  });

  const first = await deleteAccountData(userId, fixture.implementation);
  assert(!first.ok);
  assertEquals(first.code, "AUTH_DELETION_FAILED");
  assertState(first, "partial");
  assertEquals(first.deletion.storage_objects_removed, 2);

  const second = await deleteAccountData(userId, fixture.implementation);
  assertEquals(second.ok, true);
  assertState(second, "complete");
  assertEquals(fixture.removed.length, 2);
  assertEquals(fixture.auditIds.length, 2);
  assertEquals(fixture.auditIds[0], fixture.auditIds[1]);
});

Deno.test("a member added during deletion blocks the auth cascade and reports partial deletion", async () => {
  const fixture = gateway({
    otherMembershipSequence: [
      ok([]),
      ok([]),
      ok([{ business_id: businessId, user_id: "another-user" }]),
    ],
    objects: {
      [`assets:brand-kits/${businessId}`]: [{ id: "logo", name: "logo.png" }],
    },
  });

  const result = await deleteAccountData(userId, fixture.implementation);

  assert(!result.ok);
  assertEquals(result.code, "BUSINESS_TRANSFER_REQUIRED");
  assertState(result, "partial");
  assertEquals(result.deletion.storage_objects_removed, 1);
  assertEquals(fixture.calls.includes("audit"), false);
  assertEquals(fixture.calls.includes(`delete:${userId}`), false);
});

Deno.test("an audit failure after storage removal reports partial deletion", async () => {
  const fixture = gateway({
    auditError: new Error("audit unavailable"),
    objects: {
      [`original-documents:${userId}`]: [{ id: "resume", name: "resume.pdf" }],
    },
  });

  const result = await deleteAccountData(userId, fixture.implementation);

  assert(!result.ok);
  assertEquals(result.code, "AUDIT_RECORD_FAILED");
  assertState(result, "partial");
  assertEquals(fixture.calls.includes(`delete:${userId}`), false);
});

Deno.test("account deletion audit identity is stable per user without reusing the user id", async () => {
  const first = await accountDeletionAuditId(userId);
  assertEquals(first, await accountDeletionAuditId(userId));
  assertNotEquals(first, userId);
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(first),
  );
});
