import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  enumerateStoragePrefix,
  StorageEnumerationError,
  type StorageListOptions,
} from "./assets.ts";

interface FixtureEntry {
  id: string | null;
  name: string;
}

Deno.test("storage enumeration walks every page and nested directory under one exact prefix", async () => {
  const calls: Array<{ prefix: string; options: StorageListOptions }> = [];
  const pages = new Map<string, FixtureEntry[]>([
    [
      "brand-kits/business-a:0",
      [
        { id: "logo-png", name: "logo.png" },
        { id: null, name: "replaced" },
      ],
    ],
    ["brand-kits/business-a:2", [{ id: "logo-svg", name: "logo.svg" }]],
    [
      "brand-kits/business-a/replaced:0",
      [
        { id: "old-jpg", name: "logo.jpg" },
        { id: "old-webp", name: "logo.webp" },
      ],
    ],
    ["brand-kits/business-a/replaced:2", []],
  ]);

  const paths = await enumerateStoragePrefix({
    rootPrefix: "brand-kits/business-a",
    pageSize: 2,
    list: async (prefix, options) => {
      calls.push({ prefix, options });
      return {
        data: pages.get(`${prefix}:${options.offset}`) ?? [],
        error: null,
      };
    },
  });

  assertEquals(paths, [
    "brand-kits/business-a/logo.png",
    "brand-kits/business-a/logo.svg",
    "brand-kits/business-a/replaced/logo.jpg",
    "brand-kits/business-a/replaced/logo.webp",
  ]);
  assertEquals(
    calls.map(({ prefix, options }) => [prefix, options.limit, options.offset]),
    [
      ["brand-kits/business-a", 2, 0],
      ["brand-kits/business-a", 2, 2],
      ["brand-kits/business-a/replaced", 2, 0],
      ["brand-kits/business-a/replaced", 2, 2],
    ],
  );
});

Deno.test("storage enumeration fails closed on a listing error", async () => {
  await assertRejects(
    () =>
      enumerateStoragePrefix({
        rootPrefix: "user-a",
        list: async () => ({ data: null, error: new Error("list failed") }),
      }),
    StorageEnumerationError,
  );
});

Deno.test("storage enumeration rejects malformed entries instead of silently skipping them", async () => {
  await assertRejects(
    () =>
      enumerateStoragePrefix({
        rootPrefix: "user-a",
        list: async () => ({
          data: [{ id: "object-a", name: "nested/unexpected.pdf" }],
          error: null,
        }),
      }),
    StorageEnumerationError,
  );
});
