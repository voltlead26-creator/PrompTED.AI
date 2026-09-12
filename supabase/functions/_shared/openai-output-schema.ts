// OpenAI's strict schema subset rejects uniqueItems. Keep that constraint in
// the canonical contract and enforce it locally; only the wire copy omits it.
type Schema = Record<string, unknown>;
type Check = (value: unknown) => boolean;

export class OpenAIOutputSchemaError extends Error {
  constructor() {
    super("OPENAI_UNSUPPORTED_UNIQUENESS_SCHEMA");
  }
}

interface CompiledNode {
  schema: Schema;
  check: Check;
  hasUnique: boolean;
  hasReference: boolean;
}

function record(value: unknown): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function unionSelector(schema: Schema): { identity: string; matches: Check } {
  if (schema.type === "object") {
    if (
      schema.additionalProperties !== false || !record(schema.properties) ||
      !Array.isArray(schema.required)
    ) throw new OpenAIOutputSchemaError();
    const keys = Object.keys(schema.properties).sort();
    if (JSON.stringify([...schema.required].sort()) !== JSON.stringify(keys)) {
      throw new OpenAIOutputSchemaError();
    }
    const identity = JSON.stringify(keys);
    return {
      identity: `object:${identity}`,
      matches: (value) =>
        record(value) &&
        JSON.stringify(Object.keys(value).sort()) === identity,
    };
  }
  if (
    !["null", "array", "string", "number", "integer", "boolean"].includes(
      String(schema.type),
    )
  ) {
    throw new OpenAIOutputSchemaError();
  }
  return {
    identity: schema.type === "integer" ? "number" : String(schema.type),
    matches: (value) => {
      switch (schema.type) {
        case "null":
          return value === null;
        case "array":
          return Array.isArray(value);
        case "integer":
          return Number.isInteger(value);
        case "number":
          return typeof value === "number";
        case "string":
          return typeof value === "string";
        case "boolean":
          return typeof value === "boolean";
        default:
          return false;
      }
    },
  };
}

function compile(source: Schema): CompiledNode {
  const schema = structuredClone(source);
  const checks: Check[] = [];
  let hasUnique = false;
  let hasReference = typeof source.$ref === "string";
  const include = (child: CompiledNode) => {
    hasUnique ||= child.hasUnique;
    hasReference ||= child.hasReference;
  };

  if ("uniqueItems" in source) {
    if (source.type !== "array" || typeof source.uniqueItems !== "boolean") {
      throw new OpenAIOutputSchemaError();
    }
    delete schema.uniqueItems;
    if (source.uniqueItems) {
      hasUnique = true;
      checks.push((value) =>
        !Array.isArray(value) ||
        new Set(value.map((item) => JSON.stringify(canonical(item)))).size ===
          value.length
      );
    }
  }

  if (record(source.properties)) {
    const properties: Array<[string, Schema]> = [];
    for (const [key, value] of Object.entries(source.properties)) {
      if (!record(value)) throw new OpenAIOutputSchemaError();
      const child = compile(value);
      include(child);
      properties.push([key, child.schema]);
      checks.push((output) =>
        !record(output) || !Object.hasOwn(output, key) ||
        child.check(output[key])
      );
    }
    schema.properties = Object.fromEntries(properties);
  }
  if (record(source.items)) {
    const child = compile(source.items);
    include(child);
    schema.items = child.schema;
    checks.push((value) => !Array.isArray(value) || value.every(child.check));
  }
  if (Array.isArray(source.anyOf)) {
    const branches = source.anyOf.map((value) => {
      if (!record(value)) throw new OpenAIOutputSchemaError();
      return compile(value);
    });
    branches.forEach(include);
    schema.anyOf = branches.map((branch) => branch.schema);
    if (branches.some((branch) => branch.hasUnique)) {
      // Current unions are nullable or closed payload objects with distinct
      // required keys. Select those branches exactly, without guessing from
      // incomplete output or borrowing a less restrictive branch's checks.
      const selectors = branches.map((branch) => unionSelector(branch.schema));
      for (let index = 0; index < branches.length; index++) {
        if (
          selectors.some((other, otherIndex) =>
            otherIndex !== index &&
            other.identity === selectors[index].identity &&
            (branches[index].hasUnique || branches[otherIndex].hasUnique)
          )
        ) {
          throw new OpenAIOutputSchemaError();
        }
      }
      checks.push((value) =>
        branches.some((branch, index) =>
          selectors[index].matches(value) && branch.check(value)
        )
      );
    }
  }
  if (record(source.$defs)) {
    schema.$defs = Object.fromEntries(
      Object.entries(source.$defs).map(([key, value]) => {
        if (!record(value)) throw new OpenAIOutputSchemaError();
        const child = compile(value);
        include(child);
        return [key, child.schema];
      }),
    );
  }
  return {
    schema,
    check: (value) => checks.every((check) => check(value)),
    hasUnique,
    hasReference,
  };
}

export function prepareOpenAIOutputSchema(source: Schema): {
  schema: Schema;
  acceptsUniqueItems: Check;
} {
  const compiled = compile(source);
  // References require resolving the original constraint at its use site.
  // None of the current output contracts use them; fail before dispatch if a
  // future contract combines references and locally enforced uniqueness.
  if (compiled.hasUnique && compiled.hasReference) {
    throw new OpenAIOutputSchemaError();
  }
  return { schema: compiled.schema, acceptsUniqueItems: compiled.check };
}
