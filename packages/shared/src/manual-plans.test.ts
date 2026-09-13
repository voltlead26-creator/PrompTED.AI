import { describe, expect, it } from "vitest";
import {
  parseManualPlanList,
  parseManualPlanRead,
  parseManualPlanRoutingMetadata,
  parseManualPlanSaveCommand,
  parseManualPlanSaveReceipt,
  parseManualPlanSnapshot,
  type ManualPlanItem,
  type ManualPlanList,
  type ManualPlanSaveCommand,
  type ManualPlanSaveReceipt,
  type ManualPlanSnapshot,
  type ManualPlanSummary,
} from "./manual-plans";

const OWNER = "a1000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "a1000000-0000-4000-8000-000000000002";
const OUTCOME = "a2000000-0000-4000-8000-000000000001";
const ARTIFACT = "a3000000-0000-4000-8000-000000000001";
const OPERATION = "a4000000-0000-4000-8000-000000000001";
const CREATED = "2026-09-13T01:02:03.000000Z";
const COMMITTED = "2026-09-13T01:02:03.123456Z";
const LATER = "2026-09-13T01:02:03.123457Z";
const LATEST = "2026-09-13T01:02:03.123458Z";

function item(overrides: Partial<ManualPlanItem> = {}): ManualPlanItem {
  return {
    id: "item:local-1",
    section: "",
    text: "",
    notes: "",
    due_date: null,
    done: false,
    ...overrides,
  };
}

function command(overrides: Partial<ManualPlanSaveCommand> = {}): ManualPlanSaveCommand {
  return {
    contract_version: "manual-plan-save.1",
    operation_id: OPERATION,
    plan_id: "plan:local-1",
    expected: null,
    title: "",
    items: [item()],
    ...overrides,
  };
}

function snapshot(overrides: Partial<ManualPlanSnapshot> = {}): ManualPlanSnapshot {
  return {
    contract_version: "manual-plan.1",
    owner_id: OWNER,
    plan_id: "plan:local-1",
    outcome_id: OUTCOME,
    artifact_id: ARTIFACT,
    revision: 1,
    created_at: CREATED,
    updated_at: COMMITTED,
    title: "",
    items: [item()],
    ...overrides,
  };
}

function receipt(overrides: Partial<ManualPlanSaveReceipt> = {}): ManualPlanSaveReceipt {
  return {
    contract_version: "manual-plan-save.1",
    owner_id: OWNER,
    operation_id: OPERATION,
    request_sha256: "ab".repeat(32),
    status: "saved",
    committed: {
      outcome_id: OUTCOME,
      artifact_id: ARTIFACT,
      revision: 1,
      updated_at: COMMITTED,
    },
    snapshot: snapshot(),
    ...overrides,
  };
}

function summary(overrides: Partial<ManualPlanSummary> = {}): ManualPlanSummary {
  return {
    owner_id: OWNER,
    plan_id: "plan:local-1",
    outcome_id: OUTCOME,
    artifact_id: ARTIFACT,
    title: "",
    revision: 1,
    updated_at: COMMITTED,
    item_count: 1,
    completed_count: 0,
    next_due_date: null,
    ...overrides,
  };
}

function list(overrides: Partial<ManualPlanList> = {}): ManualPlanList {
  return {
    contract_version: "manual-plan-list.1",
    owner_id: OWNER,
    items: [summary()],
    has_more: false,
    ...overrides,
  };
}

function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

describe("manual-plan save input", () => {
  it("preserves blank drafts, duplicate wording, local fallback IDs and exact ordered text", () => {
    const value = command({
      title: "  My plan\n",
      items: [
        item({ section: "  Prepare ", text: "same\nwording", notes: "\tKeep me  " }),
        item({ id: "item:local-2", text: "same\nwording", due_date: "2028-02-29", done: true }),
        item({ id: "item:blank" }),
      ],
    });
    const parsed = parseManualPlanSaveCommand(value);
    expect(parsed).toEqual(value);
    expect(parseManualPlanSaveCommand(command())).toEqual(command());
    expect(parsed).not.toBe(value);
    expect(parsed?.items).not.toBe(value.items);
    expect(parsed?.items[0]).not.toBe(value.items[0]);
  });

  it("requires exact command, version and item key rosters", () => {
    const expected = receipt().committed;
    const invalid: unknown[] = [
      null, [], {}, "{}",
      { ...command(), extra: true },
      without(command(), "expected"),
      { ...command(), expected: undefined },
      { ...command(), contract_version: "manual-plan-save.2" },
      { ...command(), expected: { ...expected, extra: true } },
      { ...command(), expected: without(expected, "updated_at") },
      { ...command(), items: [{ ...item(), extra: true }] },
      { ...command(), items: [without(item(), "due_date")] },
    ];
    for (const value of invalid) expect(parseManualPlanSaveCommand(value)).toBeNull();
  });

  it("rejects coercion, missing values, duplicate identities and invalid scalar fields", () => {
    const invalid: unknown[] = [
      command({ items: [] }),
      command({ items: [item(), item()] }),
      { ...command(), title: null },
      { ...command(), items: [item({ done: true }), { ...item({ id: "two" }), done: 1 }] },
      { ...command(), items: [{ ...item(), notes: undefined }] },
      { ...command(), items: [{ ...item(), text: 3 }] },
      { ...command(), items: [{ ...item(), section: null }] },
      { ...command(), items: [{ ...item(), due_date: "" }] },
      { ...command(), items: [{ ...item(), due_date: undefined }] },
      { ...command(), expected: { ...receipt().committed, revision: "1" } },
    ];
    for (const value of invalid) expect(parseManualPlanSaveCommand(value)).toBeNull();
  });

  it.each(["", " space", "a/b", "id\n", "id\r", "id\u2028", "é", "x".repeat(129)])(
    "rejects invalid plan and item ID %j", (id) => {
      expect(parseManualPlanSaveCommand(command({ plan_id: id }))).toBeNull();
      expect(parseManualPlanSaveCommand(command({ items: [item({ id })] }))).toBeNull();
    },
  );

  it.each(["a", "0", "old.item-1_2:3", "x".repeat(128)])(
    "retains valid existing plan and item ID %j", (id) => {
      const value = command({ plan_id: id, items: [item({ id })] });
      expect(parseManualPlanSaveCommand(value)).toEqual(value);
    },
  );

  it.each([OPERATION.toUpperCase(), `${OPERATION}\n`, "not-a-uuid", OPERATION.replaceAll("-", "")])(
    "requires a canonical lowercase operation UUID %j", (operation_id) => {
      expect(parseManualPlanSaveCommand(command({ operation_id }))).toBeNull();
    },
  );

  it("bounds Unicode characters without trimming, splitting or replacing them", () => {
    const value = command({
      title: "😀".repeat(500),
      items: [item({ section: "😀".repeat(500), text: "😀".repeat(20_000), notes: "😀".repeat(10_000) })],
    });
    expect(parseManualPlanSaveCommand(value)).toEqual(value);
    expect(parseManualPlanSaveCommand({ ...value, title: value.title + "x" })).toBeNull();
    for (const field of ["section", "text", "notes"] as const) {
      const first = value.items[0]!;
      expect(parseManualPlanSaveCommand({ ...value, items: [{ ...first, [field]: first[field] + "x" }] })).toBeNull();
    }
    for (const text of ["NUL\u0000", "unpaired\ud800", "unpaired\udfff"]) {
      expect(parseManualPlanSaveCommand(command({ title: text }))).toBeNull();
      for (const field of ["section", "text", "notes"] as const) {
        expect(parseManualPlanSaveCommand(command({ items: [item({ [field]: text })] }))).toBeNull();
      }
    }
  });

  it("allows exactly 200 items and bounds UTF-8 serialized bytes, including JSON escapes", () => {
    const items = Array.from({ length: 200 }, (_, index) => item({ id: `item-${index}` }));
    expect(parseManualPlanSaveCommand(command({ items }))).toEqual(command({ items }));
    expect(parseManualPlanSaveCommand(command({ items: [...items, item({ id: "extra" })] }))).toBeNull();
    const wide = command({ items: items.map((value) => ({ ...value, text: "😀".repeat(1_400) })) });
    const escaped = command({ items: items.map((value) => ({ ...value, text: "\n".repeat(3_000) })) });
    expect(new TextEncoder().encode(JSON.stringify(wide)).length).toBeGreaterThan(1024 * 1024);
    expect(new TextEncoder().encode(JSON.stringify(escaped)).length).toBeGreaterThan(1024 * 1024);
    expect(parseManualPlanSaveCommand(wide)).toBeNull();
    expect(parseManualPlanSaveCommand(escaped)).toBeNull();
  });

  it("rejects non-JSON records and sparse or decorated arrays without invoking accessors", () => {
    let reads = 0;
    const getter = Object.defineProperty(command(), "title", {
      enumerable: true,
      get() { reads++; return "unexpected"; },
    });
    const symbolKey = { ...command(), [Symbol("extra")]: true };
    const hidden = Object.defineProperty(command(), "hidden", { value: true });
    const sparse = new Array<ManualPlanItem>(1);
    const decorated = Object.assign([item()], { extra: true });
    const arrayGetter = Object.defineProperty([item()], "0", {
      enumerable: true,
      get() { reads++; return item(); },
    });
    for (const value of [
      getter, symbolKey, hidden, new Date(), Object.create(command()),
      command({ items: sparse }), command({ items: decorated }), command({ items: arrayGetter }),
    ]) expect(parseManualPlanSaveCommand(value)).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("manual-plan dates and revision tokens", () => {
  it.each(["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"])(
    "accepts real civil date %s", (due_date) => {
      const value = command({ items: [item({ due_date })] });
      expect(parseManualPlanSaveCommand(value)).toEqual(value);
    },
  );

  it.each(["0000-01-01", "1900-02-29", "2025-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-01", "2026-01-01\n", "2026-01-01T00:00:00Z"])(
    "rejects invalid civil date %j", (due_date) => {
      expect(parseManualPlanSaveCommand(command({ items: [item({ due_date })] }))).toBeNull();
    },
  );

  it.each(["2026-02-29T01:02:03.123456Z", "0000-01-01T01:02:03.123456Z", "2026-09-13T24:02:03.123456Z", "2026-09-13T01:60:03.123456Z", "2026-09-13T01:02:60.123456Z", "2026-09-13T01:02:03.123Z", "2026-09-13T01:02:03.1234567Z", "2026-09-13T01:02:03.123456+00:00", `${COMMITTED}\n`, "yesterday"])(
    "rejects noncanonical or invalid timestamp %j", (updated_at) => {
      expect(parseManualPlanSaveCommand(command({ expected: { ...receipt().committed, updated_at } }))).toBeNull();
      expect(parseManualPlanSnapshot(snapshot({ updated_at }), OWNER)).toBeNull();
      expect(parseManualPlanSnapshot(snapshot({ created_at: updated_at }), OWNER)).toBeNull();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid revision %s", (revision) => {
      expect(parseManualPlanSaveCommand(command({ expected: { ...receipt().committed, revision } }))).toBeNull();
      expect(parseManualPlanSnapshot(snapshot({ revision }), OWNER)).toBeNull();
    },
  );

  it("keeps exact microseconds and rejects snapshots older than their creation", () => {
    const value = command({ expected: receipt().committed });
    expect(parseManualPlanSaveCommand(value)?.expected?.updated_at).toBe(COMMITTED);
    expect(parseManualPlanSnapshot(snapshot({ created_at: LATER }), OWNER)).toBeNull();
    expect(parseManualPlanSnapshot(snapshot({ created_at: COMMITTED }), OWNER)).toEqual(snapshot({ created_at: COMMITTED }));
  });
});

describe("manual-plan owner-bound reads", () => {
  it("accepts only immutable manual routing identity, never editable recommendation copies", () => {
    const marker = { manual_plan: { contract_version: "manual-plan.1", plan_id: "plan:local-1" } };
    expect(parseManualPlanRoutingMetadata(marker)).toEqual({ plan_id: "plan:local-1" });
    for (const value of [
      null, {}, { manual_plan: null }, { ...marker, title: "competing content" },
      { manual_plan: { ...marker.manual_plan, title: "competing content" } },
      { manual_plan: { ...marker.manual_plan, contract_version: "manual-plan.2" } },
      { manual_plan: { ...marker.manual_plan, plan_id: "" } },
      { manual_plan: { ...marker.manual_plan, plan_id: "id\n" } },
      { manual_plan: without(marker.manual_plan, "plan_id") },
    ]) expect(parseManualPlanRoutingMetadata(value)).toBeNull();
  });

  it("distinguishes explicit absence from an empty persisted draft", () => {
    const absent = { contract_version: "manual-plan-read.1", owner_id: OWNER, plan: null };
    const present = { ...absent, plan: snapshot() };
    expect(parseManualPlanRead(absent, OWNER)).toEqual(absent);
    expect(parseManualPlanRead(present, OWNER)).toEqual(present);
    expect(parseManualPlanRead(without(absent, "plan"), OWNER)).toBeNull();
    expect(parseManualPlanRead({ ...absent, plan: undefined }, OWNER)).toBeNull();
    expect(parseManualPlanRead({ ...absent, extra: true }, OWNER)).toBeNull();
  });

  it("rejects foreign owners at each layer, including empty responses", () => {
    expect(parseManualPlanSnapshot(snapshot(), OTHER_OWNER)).toBeNull();
    expect(parseManualPlanSnapshot(snapshot({ owner_id: OWNER.toUpperCase() }), OWNER)).toBeNull();
    expect(parseManualPlanRead({ contract_version: "manual-plan-read.1", owner_id: OTHER_OWNER, plan: null }, OWNER)).toBeNull();
    expect(parseManualPlanRead({ contract_version: "manual-plan-read.1", owner_id: OWNER, plan: snapshot({ owner_id: OTHER_OWNER }) }, OWNER)).toBeNull();
    expect(parseManualPlanList(list({ owner_id: OTHER_OWNER, items: [] }), OWNER)).toBeNull();
    expect(parseManualPlanList(list({ items: [summary({ owner_id: OTHER_OWNER })] }), OWNER)).toBeNull();
    expect(parseManualPlanList(list({ owner_id: "bad", items: [] }), "bad")).toBeNull();
  });

  it("requires complete manual snapshots and list summaries", () => {
    for (const value of [
      { ...snapshot(), contract_version: "generated-plan.1" },
      { ...snapshot(), extra: true },
      without(snapshot(), "created_at"),
      snapshot({ items: [] }),
      snapshot({ items: [item(), item()] }),
      snapshot({ outcome_id: "bad" }),
      snapshot({ artifact_id: ARTIFACT.toUpperCase() }),
    ]) expect(parseManualPlanSnapshot(value, OWNER)).toBeNull();
    for (const value of [
      { ...list(), extra: true },
      { ...list(), contract_version: "manual-plan-list.2" },
      { ...list(), has_more: 1 },
      { ...list(), items: [{ ...summary(), extra: true }] },
      { ...list(), items: [without(summary(), "next_due_date")] },
      list({ items: [summary({ next_due_date: "" })] }),
      list({ items: [summary({ item_count: 0 })] }),
      list({ items: [summary({ item_count: 201 })] }),
      list({ items: [summary({ completed_count: -1 })] }),
      list({ items: [summary({ completed_count: 0.5 })] }),
      list({ items: [summary({ completed_count: 2 })] }),
      list({ items: [summary({ completed_count: 1, next_due_date: "2026-09-14" })] }),
    ]) expect(parseManualPlanList(value, OWNER)).toBeNull();
  });

  it("validates pagination, unique identities, and exact updated-at/artifact ordering", () => {
    const second = summary({ plan_id: "two", outcome_id: OTHER_OWNER, artifact_id: OPERATION });
    expect(parseManualPlanList(list({ items: [] }), OWNER)).toEqual(list({ items: [] }));
    expect(parseManualPlanList(list({ items: [], has_more: true }), OWNER)).toBeNull();
    const valid = list({ items: [summary(), second], has_more: true });
    expect(parseManualPlanList(valid, OWNER)).toEqual(valid);
    expect(parseManualPlanList(list({ items: [second, summary()] }), OWNER)).toBeNull();
    const newest = { ...second, updated_at: LATER };
    expect(parseManualPlanList(list({ items: [newest, summary()] }), OWNER)).not.toBeNull();
    expect(parseManualPlanList(list({ items: [summary(), newest] }), OWNER)).toBeNull();
    for (const identity of ["plan_id", "outcome_id", "artifact_id"] as const) {
      expect(parseManualPlanList(list({ items: [summary(), { ...second, [identity]: summary()[identity] }] }), OWNER)).toBeNull();
    }
    const fifty = Array.from({ length: 50 }, (_, index) => summary({
      plan_id: `plan-${index}`,
      outcome_id: `b2000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      artifact_id: `b3000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(parseManualPlanList(list({ items: fifty, has_more: true }), OWNER)).not.toBeNull();
    expect(parseManualPlanList(list({ items: [...fifty, second] }), OWNER)).toBeNull();
  });
});

describe("manual-plan save acknowledgements", () => {
  it.each(["saved", "replayed"] as const)("accepts exact %s content and identity", (status) => {
    const value = receipt({ status });
    expect(parseManualPlanSaveReceipt(value, OWNER, command())).toEqual(value);
    const submitted = command({
      expected: { ...value.committed, revision: 7 },
      title: "  Revised\n",
      items: [item({ text: "same" }), item({ id: "two", text: "same", done: true })],
    });
    const committed = { ...value.committed, revision: 8, updated_at: LATER };
    const updated = receipt({ status, committed, snapshot: snapshot({ ...committed, title: submitted.title, items: submitted.items }) });
    expect(parseManualPlanSaveReceipt(updated, OWNER, submitted)).toEqual(updated);
  });

  it("rejects foreign, malformed, mismatched and unbound receipts", () => {
    const base = receipt();
    const invalid: unknown[] = [
      null, [], { ...base, extra: true }, without(base, "committed"),
      { ...base, contract_version: "manual-plan-save.2" },
      { ...base, owner_id: OTHER_OWNER },
      { ...base, operation_id: OTHER_OWNER },
      { ...base, request_sha256: "ab".repeat(31) },
      { ...base, request_sha256: "AB".repeat(32) },
      { ...base, status: "ok" },
      { ...base, snapshot: snapshot({ owner_id: OTHER_OWNER }) },
      { ...base, snapshot: snapshot({ plan_id: "different-plan" }) },
      { ...base, committed: { ...base.committed, extra: true } },
      { ...base, committed: { ...base.committed, artifact_id: OPERATION } },
      { ...base, committed: { ...base.committed, outcome_id: OPERATION } },
      { ...base, committed: { ...base.committed, revision: 2 } },
      { ...base, committed: { ...base.committed, updated_at: LATER } },
      { ...base, snapshot: snapshot({ updated_at: LATER }) },
      { ...base, snapshot: snapshot({ created_at: LATER, updated_at: LATER }) },
    ];
    for (const value of invalid) expect(parseManualPlanSaveReceipt(value, OWNER, command())).toBeNull();
    expect(parseManualPlanSaveReceipt(base, OTHER_OWNER, command())).toBeNull();
    expect(parseManualPlanSaveReceipt(base, OWNER, { ...command(), title: "\u0000" })).toBeNull();
  });

  it("binds every accepted text, item field and array position to the exact command", () => {
    const submitted = command({ title: " exact ", items: [item({ text: "one" }), item({ id: "two", text: "two" })] });
    const current = snapshot({ title: submitted.title, items: submitted.items });
    const changes = [
      { ...current, title: "exact" },
      { ...current, items: [...current.items].reverse() },
      { ...current, items: current.items.slice(0, 1) },
      ...[
        { id: "different" }, { section: "different" }, { text: "different" },
        { notes: "different" }, { due_date: "2026-09-14" }, { done: true },
      ].map((change) => ({ ...current, items: [{ ...current.items[0]!, ...change }, current.items[1]!] })),
    ];
    for (const changed of changes) {
      for (const status of ["saved", "replayed"] as const) {
        expect(parseManualPlanSaveReceipt(receipt({ status, snapshot: changed }), OWNER, submitted)).toBeNull();
      }
    }
  });

  it("requires the exact next revision, target identities and a newer microsecond token", () => {
    const submitted = command({ expected: { ...receipt().committed, revision: 7 } });
    const committed = { ...receipt().committed, revision: 8, updated_at: LATER };
    const valid = receipt({ committed, snapshot: snapshot(committed) });
    expect(parseManualPlanSaveReceipt(valid, OWNER, submitted)).toEqual(valid);
    for (const version of [
      { ...committed, revision: 7 }, { ...committed, revision: 9 },
      { ...committed, updated_at: COMMITTED }, { ...committed, updated_at: CREATED },
      { ...committed, outcome_id: OPERATION }, { ...committed, artifact_id: OPERATION },
    ]) {
      expect(parseManualPlanSaveReceipt(receipt({ committed: version, snapshot: snapshot(version) }), OWNER, submitted)).toBeNull();
    }
    const overflow = command({ expected: { ...receipt().committed, revision: Number.MAX_SAFE_INTEGER } });
    expect(parseManualPlanSaveReceipt(valid, OWNER, overflow)).toBeNull();
  });

  it("returns newer content only as superseded and keeps the original committed identity", () => {
    const value = receipt({ status: "superseded", snapshot: snapshot({ revision: 2, updated_at: LATER, title: "Later edit", items: [item({ text: "new" })] }) });
    expect(parseManualPlanSaveReceipt(value, OWNER, command())).toEqual(value);
    for (const status of ["saved", "replayed"] as const) {
      expect(parseManualPlanSaveReceipt({ ...value, status }, OWNER, command())).toBeNull();
    }
    for (const current of [
      snapshot(), snapshot({ revision: 2 }),
      snapshot({ revision: 2, updated_at: CREATED }),
      snapshot({ revision: 2, updated_at: LATER, outcome_id: OPERATION }),
      snapshot({ revision: 2, updated_at: LATER, artifact_id: OPERATION }),
      snapshot({ revision: 2, updated_at: LATER, plan_id: "other" }),
    ]) expect(parseManualPlanSaveReceipt({ ...value, snapshot: current }, OWNER, command())).toBeNull();
  });

  it("accepts aggregate-only supersession at the same artifact revision without changed content", () => {
    const value = receipt({ status: "superseded", snapshot: snapshot({ updated_at: LATER }) });
    expect(parseManualPlanSaveReceipt(value, OWNER, command())).toEqual(value);
    expect(parseManualPlanSaveReceipt({ ...value, snapshot: snapshot({ updated_at: LATER, title: "changed" }) }, OWNER, command())).toBeNull();
    expect(parseManualPlanSaveReceipt({ ...value, snapshot: snapshot({ updated_at: LATER, items: [item({ done: true })] }) }, OWNER, command())).toBeNull();
    const submitted = command({ expected: { ...receipt().committed, revision: 7 } });
    const committed = { ...receipt().committed, revision: 8, updated_at: LATER };
    expect(parseManualPlanSaveReceipt(receipt({ status: "superseded", committed, snapshot: snapshot({ revision: 7, updated_at: LATEST }) }), OWNER, submitted)).toBeNull();
  });
});
