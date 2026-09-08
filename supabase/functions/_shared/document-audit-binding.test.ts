import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  throws,
} from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  type LegacyAuditSources,
  legacyAuditSourceSha256,
  type LegacyAuditTargetSection,
  legacyAuditTargetSha256,
  legacyAuditTextSha256,
  validateLegacyAuditSources,
  validateLegacyDocumentAuditBinding,
} from "./document-audit-binding.ts";
import vectors from "./document-audit-digest.fixtures.json" with {
  type: "json",
};

for (const vector of vectors.fixtures) {
  Deno.test(`versioned audit digests match the independent UTF-8 ${vector.name} vector`, async () => {
    const sources: LegacyAuditSources = [
      vector.sources[0],
      vector.sources[1],
      vector.sources[2],
      vector.sources[3],
      vector.sources[4],
    ];
    deepStrictEqual(
      await legacyAuditSourceSha256(sources),
      vector.sourceSha256,
    );
    deepStrictEqual(
      await legacyAuditTargetSha256(vector.sections),
      vector.targetSha256,
    );
  });
}

function auditBinding(kind: "quality" | "grounding" = "quality") {
  const vector = vectors.fixtures.find((entry) => entry.name === "complaint")!;
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return {
    version: "legacy-document-audit-binding.1",
    digest_version: vectors.digestVersion,
    validator_version: "legacy-wording-assessment.1",
    unit_policy_version: "legacy-factual-units.2",
    review_kind: kind,
    round: 0,
    output_schema_name: `prompted_document_${kind}_audit`,
    output_schema_version: `document-${kind}-audit.1`,
    evidence_mode: "verbatim",
    source_sha256: vector.sourceSha256,
    execution_policy_version: "legacy-template-policy.1",
    execution_policy_sha256: "b".repeat(64),
    target_sha256: vector.targetSha256,
    sections: vector.sections.map((section) => ({
      key: section.key,
      label: section.label,
      content_sha256: sha(section.content),
    })),
    units: vector.sections.map((section) => ({
      id: `${section.key}#1`,
      section_key: section.key,
      content_sha256: sha(section.content),
    })),
  };
}

for (const kind of ["quality", "grounding"] as const) {
  Deno.test(`${kind} audit metadata is a closed owned pre-dispatch commitment`, () => {
    const input = auditBinding(kind);
    const expected = structuredClone(input);
    const accepted = validateLegacyDocumentAuditBinding(
      input,
      `generate-document.${kind}:round-0`,
    );
    deepStrictEqual(accepted, expected);
    input.sections[0].label = "Mutated after validation";
    input.units[0].content_sha256 = "f".repeat(64);
    deepStrictEqual(accepted, expected);
    ok(
      Object.isFrozen(accepted) && Object.isFrozen(accepted.sections) &&
        Object.isFrozen(accepted.sections[0]),
    );
    ok(Object.isFrozen(accepted.units) && Object.isFrozen(accepted.units[0]));
  });
}

const invalidFields: Record<string, unknown> = {
  version: "unknown",
  digest_version: "unknown",
  validator_version: "unknown",
  unit_policy_version: "unknown",
  review_kind: "writing",
  round: 4,
  output_schema_name: "other",
  output_schema_version: "other",
  evidence_mode: "typographic",
  source_sha256: "A".repeat(64),
  execution_policy_version: "owner-defined",
  execution_policy_sha256: "short",
  target_sha256: 123,
  sections: null,
  units: null,
};
for (const [field, invalid] of Object.entries(invalidFields)) {
  Deno.test(`audit metadata rejects a malformed or missing ${field}`, () => {
    throws(
      () =>
        validateLegacyDocumentAuditBinding({
          ...auditBinding(),
          [field]: invalid,
        }),
      /DOCUMENT_AUDIT_BINDING_INVALID/,
    );
    const missing: Record<string, unknown> = auditBinding();
    delete missing[field];
    throws(
      () => validateLegacyDocumentAuditBinding(missing),
      /DOCUMENT_AUDIT_BINDING_INVALID/,
    );
  });
}

Deno.test("audit metadata rejects unknown fields, invalid ordinals and scope or schema mismatches", () => {
  throws(
    () =>
      validateLegacyDocumentAuditBinding({ ...auditBinding(), extra: true }),
    /DOCUMENT_AUDIT_BINDING_INVALID/,
  );
  throws(
    () =>
      validateLegacyDocumentAuditBinding(
        auditBinding(),
        "generate-document.grounding:round-0",
      ),
    /DOCUMENT_AUDIT_BINDING_INVALID/,
  );
  throws(
    () => validateLegacyDocumentAuditBinding({ ...auditBinding(), round: 1.5 }),
    /DOCUMENT_AUDIT_BINDING_INVALID/,
  );
  for (
    const mutate of [
      (input: ReturnType<typeof auditBinding>) =>
        input.sections.push(input.sections[0]),
      (input: ReturnType<typeof auditBinding>) => input.units.reverse(),
      (input: ReturnType<typeof auditBinding>) => input.units[0].id = "issue#2",
      (input: ReturnType<typeof auditBinding>) =>
        input.units[0].section_key = "outside-scope",
    ]
  ) {
    const input = auditBinding();
    mutate(input);
    throws(
      () => validateLegacyDocumentAuditBinding(input),
      /DOCUMENT_AUDIT_BINDING_INVALID/,
    );
  }
  throws(
    () =>
      validateLegacyDocumentAuditBinding({
        ...auditBinding("grounding"),
        units: [],
      }),
    /DOCUMENT_AUDIT_BINDING_INVALID/,
  );
  deepStrictEqual(
    validateLegacyDocumentAuditBinding({ ...auditBinding(), units: [] }).units,
    [],
  );
});

Deno.test("audit metadata rejects accessors without executing them and rejects unsafe text", () => {
  const input = auditBinding();
  let invoked = false;
  Object.defineProperty(input, "source_sha256", {
    enumerable: true,
    get() {
      invoked = true;
      return "a".repeat(64);
    },
  });
  throws(
    () => validateLegacyDocumentAuditBinding(input),
    /DOCUMENT_AUDIT_BINDING_INVALID/,
  );
  deepStrictEqual(invoked, false);
  const unsafe = auditBinding();
  unsafe.sections[0].label = "\ud800";
  throws(
    () => validateLegacyDocumentAuditBinding(unsafe),
    /DOCUMENT_AUDIT_TEXT_INVALID/,
  );
});

Deno.test("source snapshots own five exact UTF-8 fields and enforce a byte budget", () => {
  const sources = ["first", "", "", "", ""];
  const accepted = validateLegacyAuditSources(sources);
  sources[0] = "changed";
  deepStrictEqual(accepted, ["first", "", "", "", ""]);
  ok(Object.isFrozen(accepted));
  for (
    const input of [[], ["", "", "", ""], ["", "", "", "", 1], new Array(5), [
      "😀".repeat(262_145),
      "",
      "",
      "",
      "",
    ]]
  ) {
    throws(
      () => validateLegacyAuditSources(input),
      /DOCUMENT_AUDIT_(SOURCE|TEXT)_INVALID/,
    );
  }
});

Deno.test("audit framing preserves field boundaries, row order, Unicode form and line endings", async () => {
  notStrictEqual(
    await legacyAuditSourceSha256(["ab", "c", "", "", ""]),
    await legacyAuditSourceSha256(["a", "bc", "", "", ""]),
  );
  notStrictEqual(
    await legacyAuditSourceSha256(["Café", "", "", "", ""]),
    await legacyAuditSourceSha256(["Cafe\u0301", "", "", "", ""]),
  );
  notStrictEqual(
    await legacyAuditSourceSha256(["line\r\nend", "", "", "", ""]),
    await legacyAuditSourceSha256(["line\nend", "", "", "", ""]),
  );
  const sections = vectors.fixtures[1].sections;
  notStrictEqual(
    await legacyAuditTargetSha256(sections),
    await legacyAuditTargetSha256([...sections].reverse()),
  );
});

for (
  const [label, invalid] of [["NUL", "unsafe\u0000text"], [
    "unpaired high surrogate",
    "\ud800",
  ], ["unpaired low surrogate", "\udfff"]]
) {
  Deno.test(`audit commitments reject ${label} before lossy UTF-8 conversion`, async () => {
    await rejects(
      () => legacyAuditTextSha256(invalid),
      /DOCUMENT_AUDIT_TEXT_INVALID/,
    );
    await rejects(
      () => legacyAuditSourceSha256([invalid, "", "", "", ""]),
      /DOCUMENT_AUDIT_TEXT_INVALID/,
    );
    await rejects(
      () =>
        legacyAuditTargetSha256([{
          key: "issue",
          label: "Issue",
          content: invalid,
        }]),
      /DOCUMENT_AUDIT_TEXT_INVALID/,
    );
  });
}

Deno.test("audit arrays are dense own-data snapshots and never execute caller iteration", async (test) => {
  await test.step("a five-slot source cannot substitute a shorter iterator", () => {
    const sources = ["first", "", "", "", ""];
    let invoked = false;
    Object.defineProperty(sources, Symbol.iterator, {
      value() {
        invoked = true;
        return ["substituted"].values();
      },
    });
    throws(
      () => validateLegacyAuditSources(sources),
      /DOCUMENT_AUDIT_SOURCE_INVALID/,
    );
    deepStrictEqual(
      invoked,
      false,
      "Source admission must not execute an iterator",
    );
  });
  await test.step("source index accessors are rejected without reading them", () => {
    const sources = ["first", "", "", "", ""];
    let invoked = false;
    Object.defineProperty(sources, "0", {
      enumerable: true,
      get() {
        invoked = true;
        return "substituted";
      },
    });
    throws(
      () => validateLegacyAuditSources(sources),
      /DOCUMENT_AUDIT_SOURCE_INVALID/,
    );
    deepStrictEqual(
      invoked,
      false,
      "Source admission must not execute an index getter",
    );
  });
  await test.step("custom array prototypes cannot supply source fields", () => {
    const sources = ["first", "", "", "", ""];
    Object.setPrototypeOf(sources, Object.create(Array.prototype));
    throws(
      () => validateLegacyAuditSources(sources),
      /DOCUMENT_AUDIT_SOURCE_INVALID/,
    );
  });
  for (const field of ["sections", "units"] as const) {
    await test.step(`${field} cannot replace their admitted rows with an iterator`, () => {
      const input = auditBinding();
      const acceptedRows = [...input[field]];
      let invoked = false;
      Object.defineProperty(input[field], Symbol.iterator, {
        value() {
          invoked = true;
          return acceptedRows.values();
        },
      });
      throws(
        () => validateLegacyDocumentAuditBinding(input),
        /DOCUMENT_AUDIT_BINDING_INVALID/,
      );
      deepStrictEqual(
        invoked,
        false,
        "Metadata admission must not execute caller iteration",
      );
    });
    await test.step(`${field} reject index accessors without reading them`, () => {
      const input = auditBinding();
      const first = input[field][0];
      ok(first);
      let invoked = false;
      Object.defineProperty(input[field], "0", {
        enumerable: true,
        get() {
          invoked = true;
          return first;
        },
      });
      throws(
        () => validateLegacyDocumentAuditBinding(input),
        /DOCUMENT_AUDIT_BINDING_INVALID/,
      );
      deepStrictEqual(
        invoked,
        false,
        "Metadata admission must not execute an index getter",
      );
    });
    await test.step(`${field} reject holes and custom prototypes`, () => {
      const sparse = auditBinding();
      Reflect.deleteProperty(sparse[field], "0");
      throws(
        () => validateLegacyDocumentAuditBinding(sparse),
        /DOCUMENT_AUDIT_BINDING_INVALID/,
      );
      const inherited = auditBinding();
      Object.setPrototypeOf(inherited[field], Object.create(Array.prototype));
      throws(
        () => validateLegacyDocumentAuditBinding(inherited),
        /DOCUMENT_AUDIT_BINDING_INVALID/,
      );
    });
  }
  await test.step("oversized source is rejected before encoding its oversized field", () => {
    const oversized = "x".repeat(1_048_577);
    const nativeEncode = TextEncoder.prototype.encode;
    let encodedOversized = false;
    TextEncoder.prototype.encode = function (input) {
      if (input === oversized) {
        encodedOversized = true;
        throw new Error("TEST_OVERSIZED_SOURCE_REACHED_ENCODER");
      }
      return nativeEncode.call(this, input);
    };
    try {
      throws(
        () => validateLegacyAuditSources([oversized, "", "", "", ""]),
        /DOCUMENT_AUDIT_SOURCE_INVALID/,
      );
      deepStrictEqual(encodedOversized, false);
    } finally {
      TextEncoder.prototype.encode = nativeEncode;
    }
    const exact = "x".repeat(1_048_576);
    deepStrictEqual(
      validateLegacyAuditSources([exact, "", "", "", ""])[0],
      exact,
    );
  });
});

function exactTargetFixture(): [LegacyAuditTargetSection] {
  return [{
    key: "issue",
    label: "Issue",
    content: "I was charged $10 twice.",
  }];
}

Deno.test("audit object snapshots never reread caller-controlled properties", async (test) => {
  await test.step("unit identity comes from the checked data descriptor", () => {
    const input = auditBinding();
    const expected = structuredClone(input);
    let reads = 0;
    let idReads = 0;
    input.units[0] = new Proxy(input.units[0], {
      get(target, property, receiver) {
        reads++;
        if (property === "id" && ++idReads > 1) return "changed";
        return Reflect.get(target, property, receiver);
      },
    });
    deepStrictEqual(validateLegacyDocumentAuditBinding(input), expected);
    deepStrictEqual(reads, 0);
  });
  await test.step("top-level metadata is copied before use", () => {
    const input = auditBinding();
    let reads = 0;
    const proxied = new Proxy(input, {
      get(target, property, receiver) {
        reads++;
        return Reflect.get(target, property, receiver);
      },
    });
    deepStrictEqual(validateLegacyDocumentAuditBinding(proxied), input);
    deepStrictEqual(reads, 0);
  });
  await test.step("target digest uses the checked wording descriptor", async () => {
    const sections = exactTargetFixture();
    const expected = await legacyAuditTargetSha256(sections);
    let reads = 0;
    sections[0] = new Proxy(sections[0], {
      get(target, property, receiver) {
        reads++;
        if (property === "content") return "Substituted wording";
        return Reflect.get(target, property, receiver);
      },
    });
    deepStrictEqual(await legacyAuditTargetSha256(sections), expected);
    deepStrictEqual(reads, 0);
  });
});

Deno.test("audit target framing requires exact dense rows and unique identities", async (test) => {
  await test.step("a sparse target cannot hash a count without its section", async () => {
    const sections = exactTargetFixture();
    Reflect.deleteProperty(sections, "0");
    await rejects(
      () => legacyAuditTargetSha256(sections),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
  });
  await test.step("target hashing never executes an overridden flatMap", async () => {
    const sections = exactTargetFixture();
    let invoked = false;
    Object.defineProperty(sections, "flatMap", {
      value() {
        invoked = true;
        return ["issue", "Issue", "Substituted target"];
      },
    });
    await rejects(
      () => legacyAuditTargetSha256(sections),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
    deepStrictEqual(invoked, false);
  });
  await test.step("target row getters are rejected without execution", async () => {
    const sections = exactTargetFixture();
    let invoked = false;
    Object.defineProperty(sections[0], "content", {
      enumerable: true,
      get() {
        invoked = true;
        return "Substituted target";
      },
    });
    await rejects(
      () => legacyAuditTargetSha256(sections),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
    deepStrictEqual(invoked, false);
  });
  await test.step("targets reject missing, null, extra and inherited rows", async () => {
    const missing = exactTargetFixture();
    Reflect.deleteProperty(missing[0], "content");
    await rejects(
      () => legacyAuditTargetSha256(missing),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
    const nullRow = exactTargetFixture();
    Reflect.set(nullRow, "0", null);
    await rejects(
      () => legacyAuditTargetSha256(nullRow),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
    const extra = exactTargetFixture();
    Reflect.set(extra[0], "unreviewed", true);
    await rejects(
      () => legacyAuditTargetSha256(extra),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
    const inherited = exactTargetFixture();
    Object.setPrototypeOf(inherited[0], Object.create(Object.prototype));
    await rejects(
      () => legacyAuditTargetSha256(inherited),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
  });
  await test.step("duplicate keys cannot masquerade as two target sections", async () => {
    const [section] = exactTargetFixture();
    await rejects(
      () =>
        legacyAuditTargetSha256([section, {
          ...section,
          content: "Different wording",
        }]),
      /DOCUMENT_AUDIT_TARGET_INVALID/,
    );
  });
});

Deno.test("audit identifiers match existing strict schema whitespace rules while labels stay literal", () => {
  for (const key of [" issue", "issue ", "\u00a0issue", "issue\ufeff"]) {
    const input = auditBinding();
    input.sections[0].key = key;
    input.units[0].section_key = key;
    input.units[0].id = `${key}#1`;
    throws(
      () => validateLegacyDocumentAuditBinding(input),
      /DOCUMENT_AUDIT_BINDING_INVALID/,
    );
  }
  const unit = auditBinding();
  unit.units[0].id = "issue#1 ";
  throws(
    () => validateLegacyDocumentAuditBinding(unit),
    /DOCUMENT_AUDIT_BINDING_INVALID/,
  );
  const label = " \tIssue\r\n\u00a0";
  const labelled = auditBinding();
  labelled.sections[0].label = label;
  deepStrictEqual(
    validateLegacyDocumentAuditBinding(labelled).sections[0].label,
    label,
  );
});

Deno.test("all admitted escaped-control field limits fit the explicit four-MiB metadata ceiling", () => {
  const sections = Array.from({ length: 128 }, (_, index) => ({
    key: "\u0001".repeat(195) + String(index).padStart(3, "0"),
    label: "\u0001".repeat(1_000),
    content_sha256: "a".repeat(64),
  }));
  const units = sections.flatMap((section) =>
    Array.from({ length: 4 }, (_, index) => ({
      id: `${section.key}#${index + 1}`,
      section_key: section.key,
      content_sha256: "a".repeat(64),
    }))
  );
  const input = { ...auditBinding(), sections, units };
  ok(
    sections.every((section) =>
      section.key.length === 198 && section.label.length === 1_000
    ),
  );
  ok(
    units.length === 512 &&
      units.every((unit) =>
        unit.id.length === 200 && unit.section_key.length === 198
      ),
  );
  const compact = JSON.stringify(input);
  const size = new TextEncoder().encode(compact).byteLength;
  ok(
    size > 2_097_152 && size < 4_194_304,
    "This must exercise the actual two-MiB escaping contradiction",
  );
  const accepted = validateLegacyDocumentAuditBinding(input);
  deepStrictEqual(
    createHash("sha256").update(JSON.stringify(accepted)).digest("hex"),
    createHash("sha256").update(compact).digest("hex"),
  );
});
