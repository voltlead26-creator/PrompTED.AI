import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Supplementary source guard. The pgTAP tests must also prove the connected
// database/cluster identity and exercise real independent concurrent sessions.
async function sqlTests() {
  const directory = new URL("../supabase/tests/", import.meta.url);
  const files = await readdir(directory, { recursive: true });
  return Promise.all(
    files
      .filter((name) => name.endsWith(".sql"))
      .map(async (file) => ({
        file,
        sql: await readFile(`${fileURLToPath(directory)}${file}`, "utf8"),
      })),
  );
}

test("SQL fixtures do not hardcode another database server", async () => {
  const unsafe = [];
  for (const { file, sql } of await sqlTests()) {
    for (const match of sql.matchAll(/\bhost(?:addr)?=([^\s'";]+)/g)) {
      const derived =
        match[1] === "%s" && /v_address inet := pg_catalog\.inet_server_addr\(\)/.test(sql);
      if (match[1] !== "127.0.0.1" && !derived) unsafe.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(unsafe, [], "Database test connections must remain server-local");
});

test("concurrency fixtures retain dblink authentication and derive their TCP endpoint", async () => {
  const unsafe = [];
  for (const { file, sql } of await sqlTests()) {
    if (/dblink_connect_u\s*\(/.test(sql)) {
      unsafe.push(file);
      continue;
    }
    const connections = [...sql.matchAll(/select extensions\.dblink_connect\([\s\S]*?\n\);/g)];
    if (!connections.length) continue;
    if (
      connections.some(
        ([connection]) => !connection.includes("pg_temp.local_test_connection_string()"),
      ) ||
      !sql.includes("v_address inet := pg_catalog.inet_server_addr()") ||
      !sql.includes("DATABASE_TEST_NON_LOOPBACK_TCP_REQUIRED")
    )
      unsafe.push(file);
  }
  assert.deepEqual(
    unsafe,
    [],
    "Use this server's authenticated TCP interface without bypassing dblink's credential check",
  );
});
