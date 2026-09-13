/** The owner-scoped manual-plan RPC wire contract; device recovery is separate. */
export interface ManualPlanItem {
  id: string;
  section: string;
  text: string;
  notes: string;
  due_date: string | null;
  done: boolean;
}

export interface ManualPlanVersion {
  outcome_id: string;
  artifact_id: string;
  revision: number;
  updated_at: string;
}

export interface ManualPlanSaveCommand {
  contract_version: "manual-plan-save.1";
  operation_id: string;
  plan_id: string;
  expected: ManualPlanVersion | null;
  title: string;
  items: ManualPlanItem[];
}

export interface ManualPlanSnapshot extends ManualPlanVersion {
  contract_version: "manual-plan.1";
  owner_id: string;
  plan_id: string;
  created_at: string;
  title: string;
  items: ManualPlanItem[];
}

export interface ManualPlanSaveReceipt {
  contract_version: "manual-plan-save.1";
  owner_id: string;
  operation_id: string;
  request_sha256: string;
  status: "saved" | "replayed" | "superseded";
  committed: ManualPlanVersion;
  snapshot: ManualPlanSnapshot;
}

export interface ManualPlanRead {
  contract_version: "manual-plan-read.1";
  owner_id: string;
  plan: ManualPlanSnapshot | null;
}

export interface ManualPlanSummary extends ManualPlanVersion {
  owner_id: string;
  plan_id: string;
  title: string;
  item_count: number;
  completed_count: number;
  next_due_date: string | null;
}

export interface ManualPlanList {
  contract_version: "manual-plan-list.1";
  owner_id: string;
  items: ManualPlanSummary[];
  has_more: boolean;
}

export const MANUAL_PLAN_MAX_COMMAND_BYTES = 1024 * 1024;
const MAX_ITEMS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CIVIL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const VERSION_KEYS = ["outcome_id", "artifact_id", "revision", "updated_at"];
const ITEM_KEYS = ["id", "section", "text", "notes", "due_date", "done"];
const COMMAND_KEYS = ["contract_version", "operation_id", "plan_id", "expected", "title", "items"];
const SNAPSHOT_KEYS = ["contract_version", "owner_id", "plan_id", ...VERSION_KEYS, "created_at", "title", "items"];
const RECEIPT_KEYS = ["contract_version", "owner_id", "operation_id", "request_sha256", "status", "committed", "snapshot"];
const SUMMARY_KEYS = ["owner_id", "plan_id", ...VERSION_KEYS, "title", "item_count", "completed_count", "next_due_date"];

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property?.enumerable === true && "value" in property;
  });
}

function denseArray(value: unknown, minimum: number, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype && prototype !== null) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (property?.enumerable !== true || !("value" in property)) return false;
  }
  return true;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID.test(value);
}

/** Existing device IDs are deliberately allowed; they need not be UUIDs. */
export function isManualPlanId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 &&
    /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9._:-]/.test(value);
}

/** Routing metadata is immutable identity only; editable content comes from the RPC. */
export function parseManualPlanRoutingMetadata(value: unknown): { plan_id: string } | null {
  if (!exactRecord(value, ["manual_plan"]) ||
    !exactRecord(value.manual_plan, ["contract_version", "plan_id"]) ||
    value.manual_plan.contract_version !== "manual-plan.1" ||
    !isManualPlanId(value.manual_plan.plan_id)) return null;
  return { plan_id: value.manual_plan.plan_id };
}

function boundedText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string" || value.length > maximum * 2) return false;
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    // PostgreSQL text cannot retain NUL or unpaired UTF-16 surrogates.
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff) || ++length > maximum) return false;
  }
  return true;
}

export function isManualPlanCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10 || !CIVIL_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function timestamp(value: unknown): value is string {
  // The RPC emits UTC with six fractional digits. Preserve these CAS bytes;
  // lexicographic comparison then retains microseconds without Date rounding.
  return typeof value === "string" && value.length === 27 && TIMESTAMP.test(value) &&
    isManualPlanCivilDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function parseVersion(value: unknown): ManualPlanVersion | null {
  if (!exactRecord(value, VERSION_KEYS) || !uuid(value.outcome_id) || !uuid(value.artifact_id) ||
    !integer(value.revision, 1, Number.MAX_SAFE_INTEGER) || !timestamp(value.updated_at)) return null;
  return {
    outcome_id: value.outcome_id,
    artifact_id: value.artifact_id,
    revision: value.revision,
    updated_at: value.updated_at,
  };
}

function parseItem(value: unknown): ManualPlanItem | null {
  if (!exactRecord(value, ITEM_KEYS) || !isManualPlanId(value.id) ||
    !boundedText(value.section, 500) || !boundedText(value.text, 20_000) || !boundedText(value.notes, 10_000) ||
    !(value.due_date === null || isManualPlanCivilDate(value.due_date)) || typeof value.done !== "boolean") return null;
  return {
    id: value.id,
    section: value.section,
    text: value.text,
    notes: value.notes,
    due_date: value.due_date,
    done: value.done,
  };
}

function parseItems(value: unknown): ManualPlanItem[] | null {
  if (!denseArray(value, 1, MAX_ITEMS)) return null;
  const items: ManualPlanItem[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    const parsed = parseItem(candidate);
    if (!parsed || identities.has(parsed.id)) return null;
    identities.add(parsed.id);
    items.push(parsed);
  }
  return items;
}

export function parseManualPlanSaveCommand(value: unknown): ManualPlanSaveCommand | null {
  if (!exactRecord(value, COMMAND_KEYS) || value.contract_version !== "manual-plan-save.1" ||
    !uuid(value.operation_id) || !isManualPlanId(value.plan_id) || !boundedText(value.title, 500)) return null;
  const expected = value.expected === null ? null : parseVersion(value.expected);
  const items = parseItems(value.items);
  if ((value.expected !== null && expected === null) || items === null) return null;
  const command: ManualPlanSaveCommand = {
    contract_version: "manual-plan-save.1",
    operation_id: value.operation_id,
    plan_id: value.plan_id,
    expected,
    title: value.title,
    items,
  };
  // This client precheck includes UTF-8 and JSON escapes. The server independently
  // bounds jsonb text, whose serialization overhead can differ from JSON.stringify.
  if (new TextEncoder().encode(JSON.stringify(command)).byteLength > MANUAL_PLAN_MAX_COMMAND_BYTES) return null;
  return command;
}

export function parseManualPlanSnapshot(value: unknown, ownerId: string): ManualPlanSnapshot | null {
  if (!uuid(ownerId) || !exactRecord(value, SNAPSHOT_KEYS) || value.contract_version !== "manual-plan.1" ||
    value.owner_id !== ownerId || !isManualPlanId(value.plan_id) || !uuid(value.outcome_id) || !uuid(value.artifact_id) ||
    !integer(value.revision, 1, Number.MAX_SAFE_INTEGER) || !timestamp(value.created_at) ||
    !timestamp(value.updated_at) || value.updated_at < value.created_at || !boundedText(value.title, 500)) return null;
  const items = parseItems(value.items);
  if (items === null) return null;
  return {
    contract_version: "manual-plan.1",
    owner_id: ownerId,
    plan_id: value.plan_id,
    outcome_id: value.outcome_id,
    artifact_id: value.artifact_id,
    revision: value.revision,
    created_at: value.created_at,
    updated_at: value.updated_at,
    title: value.title,
    items,
  };
}

export function parseManualPlanRead(value: unknown, ownerId: string): ManualPlanRead | null {
  if (!uuid(ownerId) || !exactRecord(value, ["contract_version", "owner_id", "plan"]) ||
    value.contract_version !== "manual-plan-read.1" || value.owner_id !== ownerId) return null;
  const plan = value.plan === null ? null : parseManualPlanSnapshot(value.plan, ownerId);
  if (value.plan !== null && plan === null) return null;
  return { contract_version: "manual-plan-read.1", owner_id: ownerId, plan };
}

function parseSummary(value: unknown, ownerId: string): ManualPlanSummary | null {
  if (!exactRecord(value, SUMMARY_KEYS) || value.owner_id !== ownerId || !isManualPlanId(value.plan_id) ||
    !uuid(value.outcome_id) || !uuid(value.artifact_id) || !integer(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !timestamp(value.updated_at) || !boundedText(value.title, 500) || !integer(value.item_count, 1, MAX_ITEMS) ||
    !integer(value.completed_count, 0, value.item_count) ||
    !(value.next_due_date === null || isManualPlanCivilDate(value.next_due_date)) ||
    (value.completed_count === value.item_count && value.next_due_date !== null)) return null;
  return {
    owner_id: ownerId,
    plan_id: value.plan_id,
    outcome_id: value.outcome_id,
    artifact_id: value.artifact_id,
    revision: value.revision,
    updated_at: value.updated_at,
    title: value.title,
    item_count: value.item_count,
    completed_count: value.completed_count,
    next_due_date: value.next_due_date,
  };
}

export function parseManualPlanList(value: unknown, ownerId: string): ManualPlanList | null {
  if (!uuid(ownerId) || !exactRecord(value, ["contract_version", "owner_id", "items", "has_more"]) ||
    value.contract_version !== "manual-plan-list.1" || value.owner_id !== ownerId ||
    typeof value.has_more !== "boolean" || !denseArray(value.items, 0, 50) ||
    (value.has_more && value.items.length === 0)) return null;
  const items: ManualPlanSummary[] = [];
  const planIds = new Set<string>();
  const outcomeIds = new Set<string>();
  const artifactIds = new Set<string>();
  for (const candidate of value.items) {
    const parsed = parseSummary(candidate, ownerId);
    if (!parsed || planIds.has(parsed.plan_id) || outcomeIds.has(parsed.outcome_id) || artifactIds.has(parsed.artifact_id)) return null;
    const previous = items.at(-1);
    if (previous && (previous.updated_at < parsed.updated_at ||
      (previous.updated_at === parsed.updated_at && previous.artifact_id >= parsed.artifact_id))) return null;
    planIds.add(parsed.plan_id);
    outcomeIds.add(parsed.outcome_id);
    artifactIds.add(parsed.artifact_id);
    items.push(parsed);
  }
  return { contract_version: "manual-plan-list.1", owner_id: ownerId, items, has_more: value.has_more };
}

function sameContent(snapshot: ManualPlanSnapshot, command: ManualPlanSaveCommand): boolean {
  return snapshot.title === command.title && snapshot.items.length === command.items.length &&
    snapshot.items.every((item, index) => {
      const expected = command.items[index]!;
      return item.id === expected.id && item.section === expected.section && item.text === expected.text &&
        item.notes === expected.notes && item.due_date === expected.due_date && item.done === expected.done;
    });
}

export function parseManualPlanSaveReceipt(
  value: unknown,
  ownerId: string,
  command: ManualPlanSaveCommand,
): ManualPlanSaveReceipt | null {
  const submitted = parseManualPlanSaveCommand(command);
  if (!submitted || !uuid(ownerId) || !exactRecord(value, RECEIPT_KEYS) ||
    value.contract_version !== "manual-plan-save.1" || value.owner_id !== ownerId ||
    value.operation_id !== submitted.operation_id || typeof value.request_sha256 !== "string" ||
    value.request_sha256.length !== 64 || !/^[0-9a-f]{64}$/.test(value.request_sha256) ||
    (value.status !== "saved" && value.status !== "replayed" && value.status !== "superseded")) return null;
  const committed = parseVersion(value.committed);
  const snapshot = parseManualPlanSnapshot(value.snapshot, ownerId);
  if (!committed || !snapshot || snapshot.plan_id !== submitted.plan_id ||
    committed.outcome_id !== snapshot.outcome_id || committed.artifact_id !== snapshot.artifact_id ||
    committed.updated_at < snapshot.created_at) return null;
  const nextRevision = submitted.expected === null ? 1 : submitted.expected.revision + 1;
  if (!Number.isSafeInteger(nextRevision) || committed.revision !== nextRevision) return null;
  if (submitted.expected && (committed.outcome_id !== submitted.expected.outcome_id ||
    committed.artifact_id !== submitted.expected.artifact_id || committed.updated_at <= submitted.expected.updated_at)) return null;
  if (value.status === "superseded") {
    if (snapshot.revision < committed.revision || snapshot.updated_at <= committed.updated_at) return null;
    // Metadata can advance the aggregate token without changing artifact content.
    if (snapshot.revision === committed.revision && !sameContent(snapshot, submitted)) return null;
  } else if (snapshot.revision !== committed.revision || snapshot.updated_at !== committed.updated_at ||
    !sameContent(snapshot, submitted)) return null;
  return {
    contract_version: "manual-plan-save.1",
    owner_id: ownerId,
    operation_id: submitted.operation_id,
    request_sha256: value.request_sha256,
    status: value.status,
    committed,
    snapshot,
  };
}
