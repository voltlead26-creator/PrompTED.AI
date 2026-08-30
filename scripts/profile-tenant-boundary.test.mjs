import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function section(input, start, end) {
  const startIndex = input.search(start);
  assert.notEqual(startIndex, -1, `missing section: ${start}`);
  const remainder = input.slice(startIndex);
  const endOffset = remainder.search(end);
  assert.notEqual(endOffset, -1, `missing section terminator: ${end}`);
  return remainder.slice(0, endOffset);
}

test("the forward migration makes profile changes RPC-only", async () => {
  const sql = await source(
    "supabase/migrations/20260831090000_profile_tenant_boundary.sql",
  );

  assert.match(sql, /revoke\s+update\s+on\s+table\s+public\.profiles\s+from\s+authenticated/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+profiles_update_own/i);
  assert.match(sql, /function\s+public\.update_own_profile_details\s*\(/i);
  assert.match(sql, /function\s+public\.link_own_business\s*\(/i);
  assert.match(sql, /function\s+public\.create_and_link_own_business\s*\(/i);
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /set\s+search_path\s*=\s*''/i);
  assert.doesNotMatch(sql, /grant\s+update[^;]*public\.profiles[^;]*authenticated/is);
});

test("the profile RPC cannot mutate authority or accounting columns", async () => {
  const sql = await source(
    "supabase/migrations/20260831090000_profile_tenant_boundary.sql",
  );
  const detailsBody = section(
    sql,
    /create\s+or\s+replace\s+function\s+public\.update_own_profile_details/i,
    /create\s+or\s+replace\s+function\s+public\.link_own_business/i,
  );
  const assignments = detailsBody.match(/update\s+public\.profiles\s+set([\s\S]*?)\bwhere\b/i)?.[1];
  assert.ok(assignments, "profile UPDATE assignment list is present");
  assert.doesNotMatch(assignments, /\bplan\s*=/i);
  assert.doesNotMatch(assignments, /\busage_count\s*=/i);
  assert.doesNotMatch(assignments, /\bbusiness_id\s*=/i);
  assert.doesNotMatch(assignments, /\bmemory_context\s*=/i);
  assert.doesNotMatch(assignments, /\bid\s*=/i);
});

test("business linking derives identity and proves ownership", async () => {
  const sql = await source(
    "supabase/migrations/20260831090000_profile_tenant_boundary.sql",
  );
  const linkBody = section(
    sql,
    /create\s+or\s+replace\s+function\s+public\.link_own_business/i,
    /create\s+or\s+replace\s+function\s+public\.set_updated_at/i,
  );
  assert.match(linkBody, /auth\.uid\s*\(\s*\)/i);
  assert.match(linkBody, /owner_user_id\s*=\s*v_user_id/i);
  assert.match(linkBody, /raise\s+exception/i);
  assert.doesNotMatch(linkBody, /p_user_id/i);
});

test("browser profile writers use the narrow RPCs", async () => {
  const personal = await source("apps/web/src/lib/profile-resources.ts");
  const business = await source("apps/web/src/app/(app)/settings/business/page.tsx");

  assert.match(personal, /\.rpc\(\s*["']update_own_profile_details["']/);
  assert.doesNotMatch(personal, /\.from\(\s*["']profiles["']\s*\)\s*\.update/s);
  assert.match(business, /\.rpc\(\s*["']create_and_link_own_business["']/);
  assert.doesNotMatch(business, /\.from\(\s*["']profiles["']\s*\)\s*\.update/s);
});

test("service-role memory access rechecks business ownership", async () => {
  const memory = await source("supabase/functions/_shared/user-memory.ts");

  assert.match(memory, /\.eq\(\s*["']owner_user_id["']\s*,\s*userId\s*\)/);
  assert.match(memory, /ownedBusinessId/);
});

test("account deletion scopes brand assets to businesses actually owned by the user", async () => {
  const handler = await source("supabase/functions/account-delete/index.ts");
  const deletion = await source("supabase/functions/account-delete/deletion.ts");
  const assets = await source("supabase/functions/account-delete/assets.ts");

  assert.match(handler, /\.from\(\s*["']businesses["']\s*\)/);
  assert.match(
    handler,
    /\.eq\(\s*["']owner_user_id["']\s*,\s*authenticatedUserId\s*\)/,
  );
  assert.match(handler, /\.from\(\s*["']memberships["']\s*\)/);
  assert.doesNotMatch(
    handler,
    /select\(\s*["']business_id["']\s*\)[\s\S]*profile\?\.business_id/,
  );
  assert.doesNotMatch(handler, /\.from\(\s*["']uploads["']\s*\)/);
  assert.doesNotMatch(handler, /logo_url/);

  assert.match(deletion, /enumerateStoragePrefix/);
  assert.match(deletion, /rootPrefix:\s*`brand-kits\/\$\{id\}`/);
  assert.match(
    deletion,
    /bucket:\s*["']original-documents["'],\s*rootPrefix:\s*userId/,
  );
  assert.match(assets, /pendingDirectories/);
  assert.match(assets, /offset\s*\+=\s*result\.data\.length/);
});
