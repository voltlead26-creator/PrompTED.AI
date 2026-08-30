import { assertEquals } from "jsr:@std/assert@1";
import { ownedBusinessId } from "./user-memory.ts";

function businessLookup(
  result: { id: string; owner_user_id: string } | null,
  error: { message: string } | null = null,
) {
  const filters: Array<[string, string]> = [];
  const builder = {
    select(_columns: string) {
      return builder;
    },
    eq(column: string, value: string) {
      filters.push([column, value]);
      return builder;
    },
    async maybeSingle() {
      const requestedId = filters.find(([column]) => column === "id")?.[1];
      const ownerId = filters.find(([column]) => column === "owner_user_id")?.[1];
      const owned = result?.id === requestedId && result?.owner_user_id === ownerId;
      return { data: owned ? result : null, error };
    },
  };

  return {
    filters,
    client: {
      from(table: string) {
        if (table !== "businesses") throw new Error(`unexpected table: ${table}`);
        return builder;
      },
    },
  };
}

Deno.test("memory ownership lookup requires both business identity and owner", async () => {
  const lookup = businessLookup({ id: "business-a", owner_user_id: "user-a" });
  const id = await ownedBusinessId(
    lookup.client as never,
    "user-a",
    "business-a",
  );

  assertEquals(id, "business-a");
  assertEquals(lookup.filters, [
    ["id", "business-a"],
    ["owner_user_id", "user-a"],
  ]);
});

Deno.test("memory ownership lookup fails closed for a foreign pointer", async () => {
  const lookup = businessLookup({ id: "business-b", owner_user_id: "user-b" });
  assertEquals(
    await ownedBusinessId(lookup.client as never, "user-a", "business-b"),
    null,
  );
});

Deno.test("memory ownership lookup errors fail closed", async () => {
  const lookup = businessLookup(
    { id: "business-a", owner_user_id: "user-a" },
    { message: "database unavailable" },
  );
  assertEquals(
    await ownedBusinessId(lookup.client as never, "user-a", "business-a"),
    null,
  );
});

Deno.test("memory ownership lookup ignores absent links", async () => {
  const lookup = businessLookup(null);
  assertEquals(await ownedBusinessId(lookup.client as never, "user-a", null), null);
  assertEquals(lookup.filters, []);
});
