/** Internal exact-wording commitments. This module owns no persistence or
 * provider policy. The existing reservation/admission records remain authority. */
export type LegacyAuditSources = readonly [
  string,
  string,
  string,
  string,
  string,
];

export interface LegacyAuditTargetSection {
  key: string;
  label: string;
  content: string;
}

export const LEGACY_AUDIT_DIGEST_VERSION = "legacy-document-audit-digests.1";
export const LEGACY_DOCUMENT_AUDIT_BINDING_VERSION =
  "legacy-document-audit-binding.1";

export interface LegacyDocumentAuditBinding {
  version: typeof LEGACY_DOCUMENT_AUDIT_BINDING_VERSION;
  digest_version: typeof LEGACY_AUDIT_DIGEST_VERSION;
  validator_version: "legacy-wording-assessment.1";
  unit_policy_version: "legacy-factual-units.2";
  review_kind: "quality" | "grounding";
  round: number;
  output_schema_name:
    | "prompted_document_quality_audit"
    | "prompted_document_grounding_audit";
  output_schema_version:
    | "document-quality-audit.1"
    | "document-grounding-audit.1";
  evidence_mode: "verbatim";
  source_sha256: string;
  execution_policy_version: "legacy-template-policy.1";
  execution_policy_sha256: string;
  target_sha256: string;
  sections: Array<{ key: string; label: string; content_sha256: string }>;
  units: Array<{ id: string; section_key: string; content_sha256: string }>;
}

const encoder = new TextEncoder();

function assertExactText(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("DOCUMENT_AUDIT_TEXT_INVALID");
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || (code >= 0xdc00 && code <= 0xdfff)) {
      throw new Error("DOCUMENT_AUDIT_TEXT_INVALID");
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("DOCUMENT_AUDIT_TEXT_INVALID");
      }
    }
  }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function legacyAuditTextSha256(value: string): Promise<string> {
  assertExactText(value);
  return await sha256(encoder.encode(value));
}

// L(s) = decimal UTF-8 byte length + ':' + exact UTF-8 bytes. Domain and
// item count are framed too. This never relies on JSON property order or
// PostgreSQL JSONB whitespace, and never normalises the committed wording.
function framedBytes(
  domain: string,
  count: number,
  values: readonly string[],
): Uint8Array<ArrayBuffer> {
  const frames = [domain, String(count), ...values].flatMap((value) => {
    assertExactText(value);
    const bytes = encoder.encode(value);
    return [encoder.encode(`${bytes.byteLength}:`), bytes];
  });
  const output = new Uint8Array(
    frames.reduce((length, frame) => length + frame.byteLength, 0),
  );
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.byteLength;
  }
  return output;
}

export function validateLegacyAuditSources(
  sources: unknown,
): LegacyAuditSources {
  const fail = (): never => {
    throw new Error("DOCUMENT_AUDIT_SOURCE_INVALID");
  };
  let remainingBytes = 1_048_576;
  const owned = denseDataArray(sources, 5, 5, fail).map((value) => {
    // A well-formed UTF-8 encoding cannot use fewer bytes than UTF-16 units.
    // Reject a clearly oversized field before scanning or encoding its bytes.
    if (typeof value !== "string") {
      throw new Error("DOCUMENT_AUDIT_TEXT_INVALID");
    }
    if (value.length > remainingBytes) fail();
    assertExactText(value);
    remainingBytes -= encoder.encode(value).byteLength;
    if (remainingBytes < 0) fail();
    return value;
  });
  return Object.freeze([owned[0], owned[1], owned[2], owned[3], owned[4]]);
}

export async function legacyAuditSourceSha256(
  sources: LegacyAuditSources,
): Promise<string> {
  const owned = validateLegacyAuditSources(sources);
  return await sha256(framedBytes("legacy-audit-source.1", 5, owned));
}

export async function legacyAuditTargetSha256(
  sections: readonly LegacyAuditTargetSection[],
): Promise<string> {
  const fail = (): never => {
    throw new Error("DOCUMENT_AUDIT_TARGET_INVALID");
  };
  const rows = denseDataArray(sections, 1, 128, fail);
  const values: string[] = [];
  const keys = new Set<string>();
  for (const entry of rows) {
    const row = exactObject(entry, ["key", "label", "content"], fail);
    const key = identifier(row.key, fail);
    if (keys.has(key)) fail();
    keys.add(key);
    const label = metadataText(row.label, 1_000, fail);
    assertExactText(row.content);
    values.push(key, label, row.content);
  }
  return await sha256(
    framedBytes("legacy-audit-target.1", rows.length, values),
  );
}

function invalidBinding(): never {
  throw new Error("DOCUMENT_AUDIT_BINDING_INVALID");
}

function denseDataArray(
  value: unknown,
  min: number,
  max: number,
  fail: () => never,
): unknown[] {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
  ) fail();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (
    !Number.isInteger(length) || length < min || length > max ||
    Reflect.ownKeys(value).length !== length + 1
  ) fail();
  const owned: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field)) fail();
    owned.push(field.value);
  }
  return owned;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  fail: () => never = invalidBinding,
): Record<string, unknown> {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((key) => !descriptors[key] || !("value" in descriptors[key]))
  ) fail();
  // Use only the checked descriptor values. Re-reading a caller's object can
  // invoke a Proxy get trap and substitute a different value after validation.
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function metadataText(
  value: unknown,
  maxLength: number,
  fail: () => never = invalidBinding,
): string {
  if (typeof value !== "string" || value.length > maxLength) fail();
  assertExactText(value);
  if (!value.trim()) fail();
  return value;
}

function identifier(
  value: unknown,
  fail: () => never = invalidBinding,
): string {
  const text = metadataText(value, 200, fail);
  if (text !== text.trim()) fail();
  return text;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalidBinding();
  }
  return value;
}

/** Closed server-created metadata, retained before reviewer dispatch. It is an
 * identity commitment, not a reviewer verdict or a claim of factual truth. */
export function validateLegacyDocumentAuditBinding(
  value: unknown,
  expectedStage?: string,
): LegacyDocumentAuditBinding {
  const input = exactObject(value, [
    "version",
    "digest_version",
    "validator_version",
    "unit_policy_version",
    "review_kind",
    "round",
    "output_schema_name",
    "output_schema_version",
    "evidence_mode",
    "source_sha256",
    "execution_policy_version",
    "execution_policy_sha256",
    "target_sha256",
    "sections",
    "units",
  ]);
  if (
    input.version !== LEGACY_DOCUMENT_AUDIT_BINDING_VERSION ||
    input.digest_version !== LEGACY_AUDIT_DIGEST_VERSION ||
    input.validator_version !== "legacy-wording-assessment.1" ||
    input.unit_policy_version !== "legacy-factual-units.2" ||
    (input.review_kind !== "quality" && input.review_kind !== "grounding") ||
    typeof input.round !== "number" || !Number.isInteger(input.round) ||
    input.round < 0 || input.round > 3 ||
    input.output_schema_name !==
      `prompted_document_${input.review_kind}_audit` ||
    input.output_schema_version !== `document-${input.review_kind}-audit.1` ||
    input.evidence_mode !== "verbatim" ||
    input.execution_policy_version !== "legacy-template-policy.1" ||
    (expectedStage !== undefined &&
      expectedStage !==
        `generate-document.${input.review_kind}:round-${input.round}`)
  ) {
    invalidBinding();
  }
  const sectionRows = denseDataArray(input.sections, 1, 128, invalidBinding);
  const unitRows = denseDataArray(
    input.units,
    input.review_kind === "grounding" ? 1 : 0,
    512,
    invalidBinding,
  );
  const sectionOrder = new Map<string, number>();
  const sections: LegacyDocumentAuditBinding["sections"] = [];
  for (const entry of sectionRows) {
    const row = exactObject(entry, ["key", "label", "content_sha256"]);
    const key = identifier(row.key);
    if (sectionOrder.has(key)) invalidBinding();
    sectionOrder.set(key, sections.length);
    sections.push(
      Object.freeze({
        key,
        label: metadataText(row.label, 1_000),
        content_sha256: digest(row.content_sha256),
      }),
    );
  }
  const units: LegacyDocumentAuditBinding["units"] = [];
  const ordinal = new Map<string, number>();
  let previousSection = -1;
  for (const entry of unitRows) {
    const row = exactObject(entry, ["id", "section_key", "content_sha256"]);
    const sectionKey = identifier(row.section_key);
    const sectionIndex = sectionOrder.get(sectionKey);
    const unitNumber = (ordinal.get(sectionKey) ?? 0) + 1;
    if (
      sectionIndex === undefined || sectionIndex < previousSection ||
      identifier(row.id) !== `${sectionKey}#${unitNumber}`
    ) invalidBinding();
    previousSection = sectionIndex;
    ordinal.set(sectionKey, unitNumber);
    units.push(
      Object.freeze({
        id: row.id as string,
        section_key: sectionKey,
        content_sha256: digest(row.content_sha256),
      }),
    );
  }
  const owned: LegacyDocumentAuditBinding = {
    version: LEGACY_DOCUMENT_AUDIT_BINDING_VERSION,
    digest_version: LEGACY_AUDIT_DIGEST_VERSION,
    validator_version: "legacy-wording-assessment.1",
    unit_policy_version: "legacy-factual-units.2",
    review_kind: input.review_kind,
    round: input.round,
    output_schema_name: input.review_kind === "quality"
      ? "prompted_document_quality_audit"
      : "prompted_document_grounding_audit",
    output_schema_version: input.review_kind === "quality"
      ? "document-quality-audit.1"
      : "document-grounding-audit.1",
    evidence_mode: "verbatim",
    source_sha256: digest(input.source_sha256),
    execution_policy_version: "legacy-template-policy.1",
    execution_policy_sha256: digest(input.execution_policy_sha256),
    target_sha256: digest(input.target_sha256),
    sections,
    units,
  };
  // The closed field/row limits put valid payloads below this ceiling in
  // both compact JSON and PostgreSQL JSONB text, including six-byte escaped
  // control characters. Variable text is at most 2,150,400 encoded bytes;
  // fixed field names/hashes/separators keep the full object below four MiB.
  if (encoder.encode(JSON.stringify(owned)).byteLength > 4_194_304) {
    invalidBinding();
  }
  Object.freeze(sections);
  Object.freeze(units);
  return Object.freeze(owned);
}
