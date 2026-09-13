import { beforeEach, describe, expect, it, vi } from "vitest";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";
import { captureOwnerDispatch, recordBrowserPrincipal } from "@/lib/browser-principal-state";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: withOwnerSupabaseMock,
}));

import {
  fetchActionItems,
  fetchRoleOutcomes,
  fetchSavedRoles,
  recordRoleOutcome,
  roleOutcomeLocalDate,
  saveRole,
  setActionItemStatus,
} from "./saved-roles";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const ROLE_ID = "a2000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "a3000000-0000-4000-8000-000000000001";
const ITEM_ID = "a4000000-0000-4000-8000-000000000001";
const TOKEN_1 = "a5000000-0000-4000-8000-000000000001";
const TOKEN_2 = "a5000000-0000-4000-8000-000000000002";

const actionItem = {
  id: ITEM_ID,
  label: "Review the role",
  description: null,
  status: "done" as const,
  sort_order: 0,
  mutation_token: TOKEN_2,
};

const actionItemRow = { ...actionItem, user_id: USER_ID, saved_role_id: ROLE_ID };

function installActionItemsResponse(data: unknown) {
  const order = vi.fn().mockResolvedValue({ data, error: null });
  const query = { eq: vi.fn((_column: string, _value: string) => query), order };
  const select = vi.fn((_columns: string) => query);
  const from = vi.fn((_table: string) => ({ select }));
  installClient({ from });
  return { from, select, eq: query.eq, order };
}

function eventStore({ loseAcknowledgement = true, loseFirstRead = true } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  let loseAck = loseAcknowledgement;
  let loseRead = loseFirstRead;
  const inserts: Record<string, unknown>[] = [];
  installClient({ from: () => ({
    insert: (payload: Record<string, unknown>) => {
      inserts.push(payload);
      const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
      const exists = rows.has(id);
      if (!exists) rows.set(id, { ...payload, id });
      return { select: () => ({ single: async () => {
        if (loseAck) { loseAck = false; throw new Error("Lost acknowledgement"); }
        return exists ? { data: null, error: { code: "23505" } } : { data: rows.get(id), error: null };
      } }) };
    },
    select: () => {
      const filters: Record<string, string> = {};
      const query = {
        eq: (key: string, value: string) => { filters[key] = value; return query; },
        maybeSingle: async () => {
          if (loseRead) { loseRead = false; return { data: null, error: new Error("Read unavailable") }; }
          return { data: [...rows.values()].find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null };
        },
      };
      return query;
    },
  }) });
  return { rows, inserts };
}

function installClient(client: unknown) {
  withOwnerSupabaseMock.mockImplementation(
    async (...args: unknown[]) => {
      const operation = args[1];
      if (typeof operation !== "function") {
        throw new Error(`OWNER_TEST_OPERATION_INVALID:${args.length}:${args.map((value) => typeof value).join(",")}`);
      }
      return await operation(client);
    },
  );
}

describe("saved-role owner commands", () => {
  beforeEach(() => {
    withOwnerSupabaseMock.mockReset();
  });

  it("regression: retries an acknowledged-lost event with one row and one immutable event identity", async () => {
    const store = eventStore();
    const command = { eventId: OUTCOME_ID, userId: USER_ID, savedRoleId: ROLE_ID,
      stage: "applied" as const, note: " Submitted ", occurredAt: "2026-09-13" };
    const lease = testOwnerDispatchLease(USER_ID);
    await expect(recordRoleOutcome(command, lease)).rejects.toThrow();
    await expect(recordRoleOutcome(command, lease)).resolves.toMatchObject({ id: OUTCOME_ID, note: "Submitted", occurred_at: "2026-09-13" });
    expect(store.rows.size).toBe(1);
    expect(store.inserts.map(row => row.id)).toEqual([OUTCOME_ID, OUTCOME_ID]);
  });

  it("regression: rejects conflicting retry payloads without changing the stored event", async () => {
    const store = eventStore();
    const command = { eventId: OUTCOME_ID, userId: USER_ID, savedRoleId: ROLE_ID,
      stage: "applied" as const, note: "Original", occurredAt: "2026-09-13" };
    const lease = testOwnerDispatchLease(USER_ID);
    await expect(recordRoleOutcome(command, lease)).rejects.toThrow();
    await expect(recordRoleOutcome({ ...command, note: "Changed" }, lease)).rejects.toThrow("ROLE_OUTCOME_REPLAY_CONFLICT");
    expect(store.rows.size).toBe(1);
    expect(store.rows.get(OUTCOME_ID)?.note).toBe("Original");
  });

  it.each([null, {}, [{ id: OUTCOME_ID, stage: "applied", note: null, occurred_at: "2026-02-30" }]])(
    "regression: rejects malformed or unbound outcome history instead of presenting saved truth: %j", async data => {
      const query = { eq: vi.fn(() => query), order: vi.fn().mockResolvedValue({ data, error: null }) };
      installClient({ from: () => ({ select: () => query }) });
      await expect(fetchRoleOutcomes(ROLE_ID, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_OUTCOME_HISTORY_INVALID");
    },
  );

  it("rejects explicit owner mismatches before opening an owner transport", async () => {
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(saveRole({ userId: "different-user", roleTitle: "Builder" }, lease))
      .rejects.toThrow("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
    await expect(fetchSavedRoles("different-user", lease))
      .rejects.toThrow("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
    await expect(recordRoleOutcome({
      eventId: OUTCOME_ID,
      userId: "different-user",
      savedRoleId: ROLE_ID,
      stage: "applied",
      occurredAt: "2026-09-13",
    }, lease)).rejects.toThrow("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");

    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });

  it("saves and seeds through one atomic RPC under the exact lease", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ROLE_ID, error: null });
    installClient({ rpc });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(saveRole({
      userId: USER_ID,
      roleTitle: " Building Manager ",
      companyName: "Example Co",
      matchPercentage: 91,
      contactSourceStatus: "official",
    }, lease)).resolves.toBe(ROLE_ID);

    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(rpc).toHaveBeenCalledWith("save_own_role_with_default_actions", {
      p_role_title: " Building Manager ",
      p_company_name: "Example Co",
      p_location: null,
      p_match_percentage: 91,
      p_job_url: null,
      p_source_label: null,
      p_contact_email: null,
      p_contact_source_status: "official",
    });
  });

  it.each([
    ["database error", { data: null, error: new Error("save failed") }],
    ["missing identifier", { data: null, error: null }],
    ["malformed identifier", { data: "not-a-uuid", error: null }],
  ])("rejects an unconfirmed save result: %s", async (_label, result) => {
    installClient({ rpc: vi.fn().mockResolvedValue(result) });

    await expect(saveRole({ userId: USER_ID, roleTitle: "Builder" }, testOwnerDispatchLease(USER_ID)))
      .rejects.toThrow();
  });

  it("returns the exact authoritative inserted outcome and propagates insert errors", async () => {
    const row = {
      id: OUTCOME_ID,
      user_id: USER_ID,
      saved_role_id: ROLE_ID,
      stage: "applied",
      note: "Submitted",
      occurred_at: "2026-09-02",
    };
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const query = { eq: vi.fn(() => query), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    installClient({ from: vi.fn(() => ({ insert, select: () => query })) });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(recordRoleOutcome({
      eventId: OUTCOME_ID,
      userId: USER_ID,
      savedRoleId: ROLE_ID,
      stage: "applied",
      note: " Submitted ",
      occurredAt: "2026-09-02",
    }, lease)).resolves.toEqual({ id: OUTCOME_ID, stage: "applied", note: "Submitted", occurred_at: "2026-09-02" });
    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: USER_ID,
      saved_role_id: ROLE_ID,
      note: "Submitted",
    }));

    single.mockResolvedValueOnce({ data: null, error: new Error("insert failed") });
    await expect(recordRoleOutcome({
      eventId: OUTCOME_ID,
      userId: USER_ID,
      savedRoleId: ROLE_ID,
      stage: "applied",
      occurredAt: "2026-09-13",
    }, lease)).rejects.toThrow("ROLE_OUTCOME_SAVE_UNCONFIRMED");
  });

  it("uses the exact lease for saved-role, outcome, and action reads", async () => {
    const lease = testOwnerDispatchLease(USER_ID);
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = { eq: vi.fn(() => query), order };
    const eq = query.eq;
    const select = vi.fn(() => ({ eq }));
    installClient({ from: vi.fn(() => ({ select })) });

    await expect(fetchSavedRoles(USER_ID, lease)).resolves.toEqual([]);
    await expect(fetchRoleOutcomes(ROLE_ID, lease)).resolves.toEqual([]);
    await expect(fetchActionItems(ROLE_ID, lease)).resolves.toEqual([]);

    expect(withOwnerSupabaseMock.mock.calls).toHaveLength(3);
    for (const [actualLease] of withOwnerSupabaseMock.mock.calls) {
      expect(actualLease).toBe(lease);
    }
  });

  it("propagates read failures instead of presenting empty authoritative state", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: new Error("read failed") });
    const query = { eq: vi.fn(() => query), order };
    installClient({
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(fetchSavedRoles(USER_ID, lease)).rejects.toThrow("read failed");
    await expect(fetchRoleOutcomes(ROLE_ID, lease)).rejects.toThrow("read failed");
    await expect(fetchActionItems(ROLE_ID, lease)).rejects.toThrow("read failed");
  });

  describe("action-item list response boundary", () => {
    it("reads the exact owner and role, accepting an empty list as authoritative", async () => {
      const query = installActionItemsResponse([]);
      const lease = testOwnerDispatchLease(USER_ID);

      await expect(fetchActionItems(ROLE_ID, lease)).resolves.toEqual([]);

      expect(withOwnerSupabaseMock).toHaveBeenCalledTimes(1);
      expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
      expect(query.from).toHaveBeenCalledExactlyOnceWith("role_action_items");
      expect(query.select).toHaveBeenCalledTimes(1);
      expect(query.select.mock.calls[0]?.[0].split(",").sort()).toEqual([
        "id", "user_id", "saved_role_id", "label", "description", "status", "sort_order", "mutation_token",
      ].sort());
      expect(query.eq.mock.calls).toHaveLength(2);
      expect(query.eq).toHaveBeenCalledWith("saved_role_id", ROLE_ID);
      expect(query.eq).toHaveBeenCalledWith("user_id", USER_ID);
      expect(query.order).toHaveBeenCalledExactlyOnceWith("sort_order", { ascending: true });
    });

    it("projects only public action fields while tolerating additive database fields", async () => {
      const row = Object.freeze({
        ...actionItemRow,
        created_at: "2026-09-13T00:00:00.000000Z",
        future_metadata: { schema_version: 2 },
      });
      installActionItemsResponse([row]);

      await expect(fetchActionItems(ROLE_ID, testOwnerDispatchLease(USER_ID)))
        .resolves.toEqual([actionItem]);
    });

    it("preserves SQL-valid historical wording, nullability, int4 limits, ties and UUID values", async () => {
      const historicalItems = [
        { ...actionItem, id: "a4000000-0000-4000-8000-000000000003", label: "", description: null,
          status: "pending", sort_order: -2147483648, mutation_token: TOKEN_1 },
        { ...actionItem, id: "a4000000-0000-4000-8000-000000000002", label: " \t ", description: "",
          status: "done", sort_order: -3 },
        { ...actionItem, id: "00000000-0000-0000-0000-000000000001", label: "Duplicate label", description: " \n ",
          status: "skipped", sort_order: 0, mutation_token: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        { ...actionItem, id: "ffffffff-ffff-ffff-ffff-ffffffffffff", label: "Duplicate label", description: " Keep café\nsecond line ",
          status: "pending", sort_order: 0, mutation_token: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        { ...actionItem, label: "  Historical wording\n", description: "  ",
          status: "done", sort_order: 2147483647, mutation_token: TOKEN_1 },
      ];
      installActionItemsResponse(historicalItems.map(item => ({ ...item, user_id: USER_ID, saved_role_id: ROLE_ID })));

      await expect(fetchActionItems(ROLE_ID, testOwnerDispatchLease(USER_ID)))
        .resolves.toEqual(historicalItems);
    });

    it.each([
      ["uppercase UUID", ROLE_ID.toUpperCase(), ROLE_ID],
      ["SQL UUID without an RFC version", "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000001"],
    ])("canonicalises a valid %s lookup without restricting historical UUID versions", async (_label, lookup, canonicalRoleId) => {
      const query = installActionItemsResponse([{ ...actionItemRow, saved_role_id: canonicalRoleId }]);

      await expect(fetchActionItems(lookup, testOwnerDispatchLease(USER_ID))).resolves.toEqual([actionItem]);
      expect(query.eq).toHaveBeenCalledWith("saved_role_id", canonicalRoleId);
    });

    it.each([
      ["null list", null],
      ["absent list", undefined],
      ["object list", {}],
      ["text list", "[]"],
      ["null row", [null]],
      ["array row", [[]]],
      ["text row", ["action"]],
    ])("rejects a malformed %s after the actual list read", async (_label, data) => {
      const query = installActionItemsResponse(data);
      const lease = testOwnerDispatchLease(USER_ID);

      await expect(fetchActionItems(ROLE_ID, lease)).rejects.toThrow("ROLE_ACTION_ITEMS_INVALID");

      expect(withOwnerSupabaseMock).toHaveBeenCalledTimes(1);
      expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
      expect(query.order).toHaveBeenCalledTimes(1);
    });

    it.each(["id", "user_id", "saved_role_id", "label", "description", "status", "sort_order", "mutation_token"])(
      "rejects an action row missing the selected %s field", async field => {
        const row: Record<string, unknown> = { ...actionItemRow };
        delete row[field];
        const query = installActionItemsResponse([row]);

        await expect(fetchActionItems(ROLE_ID, testOwnerDispatchLease(USER_ID)))
          .rejects.toThrow("ROLE_ACTION_ITEMS_INVALID");
        expect(query.order).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      { name: "malformed item ID", change: { id: "not-a-uuid" } },
      { name: "noncanonical item ID", change: { id: ITEM_ID.toUpperCase() } },
      { name: "foreign owner", change: { user_id: ITEM_ID } },
      { name: "noncanonical owner", change: { user_id: USER_ID.toUpperCase() } },
      { name: "different saved role", change: { saved_role_id: ITEM_ID } },
      { name: "noncanonical saved role", change: { saved_role_id: ROLE_ID.toUpperCase() } },
      { name: "null label", change: { label: null } },
      { name: "object label", change: { label: { text: "Review the role" } } },
      { name: "undefined description", change: { description: undefined } },
      { name: "numeric description", change: { description: 0 } },
      { name: "unknown status", change: { status: "completed" } },
      { name: "null status", change: { status: null } },
      { name: "numeric text order", change: { sort_order: "0" } },
      { name: "fractional order", change: { sort_order: 0.5 } },
      { name: "order below int4", change: { sort_order: -2147483649 } },
      { name: "order above int4", change: { sort_order: 2147483648 } },
      { name: "NaN order", change: { sort_order: Number.NaN } },
      { name: "infinite order", change: { sort_order: Number.POSITIVE_INFINITY } },
      { name: "null token", change: { mutation_token: null } },
      { name: "malformed token", change: { mutation_token: "not-a-uuid" } },
      { name: "noncanonical token", change: { mutation_token: TOKEN_2.toUpperCase() } },
    ])("rejects a malformed or unbound action row: $name", async ({ change }) => {
      const query = installActionItemsResponse([{ ...actionItemRow, ...change }]);

      await expect(fetchActionItems(ROLE_ID, testOwnerDispatchLease(USER_ID)))
        .rejects.toThrow("ROLE_ACTION_ITEMS_INVALID");
      expect(query.order).toHaveBeenCalledTimes(1);
    });

    it("rejects duplicate item identities even when their revisions and wording differ", async () => {
      installActionItemsResponse([
        actionItemRow,
        { ...actionItemRow, label: "A conflicting version", status: "pending", mutation_token: TOKEN_1 },
      ]);

      await expect(fetchActionItems(ROLE_ID, testOwnerDispatchLease(USER_ID)))
        .rejects.toThrow("ROLE_ACTION_ITEMS_INVALID");
    });

    it("rejects a partially valid list instead of silently dropping the malformed row", async () => {
      installActionItemsResponse([actionItemRow, null]);

      await expect(fetchActionItems(ROLE_ID, testOwnerDispatchLease(USER_ID)))
        .rejects.toThrow("ROLE_ACTION_ITEMS_INVALID");
    });

    it.each(["", "not-a-uuid", ` ${ROLE_ID}`, `${ROLE_ID} `, ROLE_ID.replaceAll("-", ""), `{${ROLE_ID}}`])(
      "rejects an invalid role lookup without opening a transport: %j", async roleId => {
        installActionItemsResponse([]);
        await expect(fetchActionItems(roleId, testOwnerDispatchLease(USER_ID)))
          .rejects.toThrow("ROLE_ACTION_ROLE_INVALID");
        expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
      },
    );
  });

  it("uses the local civil date on both sides of midnight instead of the UTC date", () => {
    expect(roleOutcomeLocalDate(new Date(2026, 8, 13, 0, 5))).toBe("2026-09-13");
    expect(roleOutcomeLocalDate(new Date(2026, 8, 13, 23, 55))).toBe("2026-09-13");
  });

  it.each([
    ["Australia/Melbourne", "2026-09-12T14:05:00Z", "2026-09-13"],
    ["America/Los_Angeles", "2026-09-13T06:55:00Z", "2026-09-12"],
  ])("uses calendar fields for %s even when UTC has a different date", (timeZone, instant, expected) => {
    const date = new Date(instant);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date).map(part => [part.type, part.value]));
    vi.spyOn(date, "getFullYear").mockReturnValue(Number(parts.year));
    vi.spyOn(date, "getMonth").mockReturnValue(Number(parts.month) - 1);
    vi.spyOn(date, "getDate").mockReturnValue(Number(parts.day));
    expect(date.toISOString().slice(0, 10)).not.toBe(expected);
    expect(roleOutcomeLocalDate(date)).toBe(expected);
  });

  it("recovers a lost acknowledgement in the same call when exact readback succeeds", async () => {
    const store = eventStore({ loseFirstRead: false });
    await expect(recordRoleOutcome({ eventId: OUTCOME_ID, userId: USER_ID, savedRoleId: ROLE_ID,
      stage: "applied", occurredAt: "2026-09-13" }, testOwnerDispatchLease(USER_ID)))
      .resolves.toMatchObject({ id: OUTCOME_ID, occurred_at: "2026-09-13" });
    expect(store.rows.size).toBe(1);
    expect(store.inserts).toHaveLength(1);
  });

  it("does not reconcile under a retired owner epoch after A to B to A", async () => {
    recordBrowserPrincipal(USER_ID);
    const lease = captureOwnerDispatch(USER_ID);
    const read = vi.fn();
    installClient({ from: () => ({
      insert: () => ({ select: () => ({ single: async () => {
        recordBrowserPrincipal(ITEM_ID); recordBrowserPrincipal(USER_ID);
        throw new Error("Acknowledgement lost during account transition");
      } }) }),
      select: read,
    }) });
    try {
      await expect(recordRoleOutcome({ eventId: OUTCOME_ID, userId: USER_ID, savedRoleId: ROLE_ID,
        stage: "applied", occurredAt: "2026-09-13" }, lease)).rejects.toThrow("signed-in account changed");
      expect(read).not.toHaveBeenCalled();
    } finally { recordBrowserPrincipal(undefined); }
  });

  it("compares canonical UUIDs after PostgreSQL lowercases valid uppercase inputs", async () => {
    const store = eventStore({ loseAcknowledgement: false, loseFirstRead: false });
    await expect(recordRoleOutcome({ eventId: OUTCOME_ID.toUpperCase(), userId: USER_ID.toUpperCase(), savedRoleId: ROLE_ID.toUpperCase(),
      stage: "applied", occurredAt: "2026-09-13" }, testOwnerDispatchLease(USER_ID)))
      .resolves.toMatchObject({ id: OUTCOME_ID });
    expect(store.inserts[0]).toMatchObject({ id: OUTCOME_ID, user_id: USER_ID, saved_role_id: ROLE_ID });
  });

  it.each([
    {}, { user_id: "other-owner" }, { saved_role_id: ITEM_ID }, { occurred_at: "2026-02-30" }, { stage: "invented" },
  ])("validates each complete history row with boundary variation %j", async change => {
    const row = { id: OUTCOME_ID, user_id: USER_ID, saved_role_id: ROLE_ID, stage: "applied", note: null, occurred_at: "2026-09-13", ...change };
    const query = { eq: vi.fn(() => query), order: vi.fn().mockResolvedValue({ data: [row], error: null }) };
    installClient({ from: () => ({ select: () => query }) });
    const result = fetchRoleOutcomes(ROLE_ID, testOwnerDispatchLease(USER_ID));
    if (Object.keys(change).length) await expect(result).rejects.toThrow("ROLE_OUTCOME_HISTORY_INVALID");
    else await expect(result).resolves.toEqual([{ id: OUTCOME_ID, stage: "applied", note: null, occurred_at: "2026-09-13" }]);
    query.order.mockResolvedValueOnce({ data: [row, row], error: null });
    await expect(fetchRoleOutcomes(ROLE_ID, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_OUTCOME_HISTORY_INVALID");
  });

  it.each([{}, { id: ITEM_ID }, { user_id: ITEM_ID }, { stage: "hired" }, { note: "Wrong" }, { occurred_at: "2026-09-14" }])(
    "recovers malformed or mismatched insert acknowledgements only through exact readback: %j", async change => {
      const row = { id: OUTCOME_ID, user_id: USER_ID, saved_role_id: ROLE_ID, stage: "applied", note: null, occurred_at: "2026-09-13" };
      const query = { eq: vi.fn(() => query), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
      installClient({ from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: Object.keys(change).length ? { ...row, ...change } : {}, error: null }) }) }),
        select: () => query,
      }) });
      const command = { eventId: OUTCOME_ID, userId: USER_ID, savedRoleId: ROLE_ID, stage: "applied" as const, occurredAt: "2026-09-13" };
      await expect(recordRoleOutcome(command, testOwnerDispatchLease(USER_ID))).resolves.toMatchObject({ id: OUTCOME_ID, stage: "applied", note: null });
      expect(query.maybeSingle).toHaveBeenCalledTimes(1);
      query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      await expect(recordRoleOutcome(command, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_OUTCOME_SAVE_UNCONFIRMED");
    },
  );

  it.each(["2026-02-30", "2026-13-01", "today", "0000-01-01"])("rejects an invalid event date: %s", async occurredAt => {
    await expect(recordRoleOutcome({ eventId: OUTCOME_ID, userId: USER_ID, savedRoleId: ROLE_ID,
      stage: "applied", occurredAt }, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_OUTCOME_COMMAND_INVALID");
    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });

  it.each([
    ["committed", 1],
    ["revision_conflict", 0],
  ] as const)("validates an authoritative %s action-item receipt", async (status, affectedRows) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status, affected_rows: affectedRows, item: actionItem },
      error: null,
    });
    installClient({ rpc });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(setActionItemStatus({
      id: ITEM_ID,
      expectedMutationToken: TOKEN_1,
      status: "done",
    }, lease)).resolves.toEqual({ status, affectedRows, item: actionItem });
    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(rpc).toHaveBeenCalledWith("update_own_role_action_item", {
      p_item_id: ITEM_ID,
      p_expected_mutation_token: TOKEN_1,
      p_status: "done",
    });
  });

  describe.each([
    ["committed", 1],
    ["revision_conflict", 0],
  ] as const)("historical labels in %s action-item receipts", (status, affectedRows) => {
    it.each([
      ["empty", ""],
      ["whitespace", " \t\n "],
    ])("accepts a SQL-valid %s label without changing its saved wording", async (_label, label) => {
      const item = { ...actionItem, label, status: status === "committed" ? "done" : "skipped" };
      const rpc = vi.fn().mockResolvedValue({ data: { status, affected_rows: affectedRows, item }, error: null });
      installClient({ rpc });
      const lease = testOwnerDispatchLease(USER_ID);

      await expect(setActionItemStatus({
        id: ITEM_ID,
        expectedMutationToken: TOKEN_1,
        status: "done",
      }, lease)).resolves.toEqual({ status, affectedRows, item });

      expect(withOwnerSupabaseMock).toHaveBeenCalledTimes(1);
      expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
      expect(rpc).toHaveBeenCalledExactlyOnceWith("update_own_role_action_item", {
        p_item_id: ITEM_ID,
        p_expected_mutation_token: TOKEN_1,
        p_status: "done",
      });
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["number", 0],
      ["object", { text: "Review the role" }],
    ])("still rejects a nonstring %s label after the RPC response", async (_label, label) => {
      const item = { ...actionItem, label };
      const rpc = vi.fn().mockResolvedValue({ data: { status, affected_rows: affectedRows, item }, error: null });
      installClient({ rpc });

      await expect(setActionItemStatus({
        id: ITEM_ID,
        expectedMutationToken: TOKEN_1,
        status: "done",
      }, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_ACTION_STATUS_INVALID");

      expect(rpc).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ["zero-row success", { status: "committed", affected_rows: 0, item: actionItem }],
    ["unchanged token", {
      status: "committed",
      affected_rows: 1,
      item: { ...actionItem, mutation_token: TOKEN_1 },
    }],
    ["wrong requested status", {
      status: "committed",
      affected_rows: 1,
      item: { ...actionItem, status: "pending" },
    }],
    ["partial row", {
      status: "revision_conflict",
      affected_rows: 0,
      item: { id: ITEM_ID, mutation_token: TOKEN_2 },
    }],
  ])("rejects a malformed action-item receipt: %s", async (_label, data) => {
    installClient({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });

    await expect(setActionItemStatus({
      id: ITEM_ID,
      expectedMutationToken: TOKEN_1,
      status: "done",
    }, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_ACTION_STATUS_INVALID");
  });
});
