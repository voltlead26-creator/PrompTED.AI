import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ArtifactOutcomeAuthorizationError,
  requireOwnedArtifactOutcome,
} from "./owner-authorization.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const FOREIGN_USER_ID = "10000000-0000-4000-8000-000000000099";
const OUTCOME_ID = "20000000-0000-4000-8000-000000000001";

function outcomeLookup(
  row: { id: string; user_id: string } | null,
  error: { message: string } | null = null,
  rejection?: Error,
) {
  const filters: Array<[string, string]> = [];
  let reads = 0;
  let selected = "";
  const builder = {
    select(columns: string) {
      selected = columns;
      return builder;
    },
    eq(column: string, value: string) {
      filters.push([column, value]);
      return builder;
    },
    async maybeSingle() {
      reads += 1;
      if (rejection) throw rejection;
      const requestedId = filters.find(([column]) => column === "id")?.[1];
      const requestedOwner = filters.find(([column]) => column === "user_id")?.[1];
      const owned =
        row?.id.toLowerCase() === requestedId?.toLowerCase() &&
        row?.user_id.toLowerCase() === requestedOwner?.toLowerCase();
      return { data: owned ? row : null, error };
    },
  };
  return {
    filters,
    get reads() {
      return reads;
    },
    get selected() {
      return selected;
    },
    client: {
      from(table: string) {
        assertEquals(table, "outcomes");
        return builder;
      },
    },
  };
}

async function authorizationFailure(
  lookup: ReturnType<typeof outcomeLookup>,
  value: unknown,
  userId = USER_ID,
): Promise<ArtifactOutcomeAuthorizationError> {
  return await assertRejects(
    () => requireOwnedArtifactOutcome(lookup.client as never, userId, value),
    ArtifactOutcomeAuthorizationError,
  );
}

Deno.test("artifact outcome lookup requires exact outcome and owner", async () => {
  const lookup = outcomeLookup({ id: OUTCOME_ID, user_id: USER_ID });
  assertEquals(
    await requireOwnedArtifactOutcome(lookup.client as never, USER_ID, OUTCOME_ID),
    OUTCOME_ID,
  );
  assertEquals(lookup.selected, "id, user_id");
  assertEquals(lookup.filters, [
    ["id", OUTCOME_ID],
    ["user_id", USER_ID],
  ]);
  assertEquals(lookup.reads, 1);
});

Deno.test("malformed artifact outcome identity fails before a database read", async () => {
  const lookup = outcomeLookup(null);
  const failure = await authorizationFailure(lookup, "not-a-uuid");
  assertEquals(failure.status, 400);
  assertEquals(failure.code, "ARTIFACT_OUTCOME_ID_INVALID");
  assertEquals(failure.payload.error.retryable, false);
  assertEquals(lookup.reads, 0);
});

Deno.test("foreign and missing artifact outcomes are indistinguishable", async () => {
  const missing = await authorizationFailure(outcomeLookup(null), OUTCOME_ID);
  const foreign = await authorizationFailure(
    outcomeLookup({ id: OUTCOME_ID, user_id: FOREIGN_USER_ID }),
    OUTCOME_ID,
  );
  assertEquals(missing.status, 404);
  assertEquals(missing.code, "ARTIFACT_OUTCOME_NOT_FOUND");
  assertEquals(foreign.status, 404);
  assertEquals(foreign.payload, missing.payload);
});

Deno.test("artifact outcome database errors fail closed as retryable", async () => {
  for (
    const lookup of [
      outcomeLookup(null, { message: "database unavailable" }),
      outcomeLookup(null, null, new Error("network unavailable")),
    ]
  ) {
    const failure = await authorizationFailure(lookup, OUTCOME_ID);
    assertEquals(failure.status, 503);
    assertEquals(failure.code, "ARTIFACT_OUTCOME_AUTHORIZATION_UNAVAILABLE");
    assertEquals(failure.payload.error.retryable, true);
  }
});

Deno.test("artifact outcome lookup rejects structurally mismatched rows", async () => {
  const lookup = outcomeLookup({ id: OUTCOME_ID, user_id: USER_ID });
  const builder = lookup.client.from("outcomes");
  builder.maybeSingle = async () => ({
    data: { id: "20000000-0000-4000-8000-000000000099", user_id: USER_ID },
    error: null,
  });
  const failure = await authorizationFailure(lookup, OUTCOME_ID);
  assertEquals(failure.status, 503);
});

Deno.test("artifact outcome identity is canonicalized", async () => {
  const lookup = outcomeLookup({ id: OUTCOME_ID, user_id: USER_ID });
  assertEquals(
    await requireOwnedArtifactOutcome(
      lookup.client as never,
      USER_ID.toUpperCase(),
      OUTCOME_ID.toUpperCase(),
    ),
    OUTCOME_ID,
  );
});
