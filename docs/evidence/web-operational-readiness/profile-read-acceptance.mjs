// Actual Auth and PostgREST acceptance on the disposable runner's own stack.
// Never accepts an external URL, credential, project or database connection.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const origin = "http://127.0.0.1:58321";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const projection = "id,upload_id,slot,accepted_at,source_kind,uploads!inner(file_name,file_type,file_size_bytes,storage_path,extracted_text)";
const resourceColumns = "id,file_name,file_type,file_size_bytes,storage_path,extracted_text";

export async function exerciseProfileReads({ project, workdir, env, sql, checkTarget, save }) {
  assert.match(project, /^prompted-db-\d{17}-[0-9a-f]{8}$/);
  assert.ok(workdir.includes(`${project}-`));
  checkTarget();
  // Status credentials belong only to this newly created local project. Keep
  // raw output, passwords and Auth responses in memory; do not use the runner's
  // general command logger for this credential-bearing status response.
  const status = spawnSync("supabase", ["--workdir", workdir, "--agent", "no", "status", "-o", "json"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(status.status, 0, "Disposable local API status unavailable");
  let config;
  try { config = JSON.parse(status.stdout); }
  catch { throw new Error("Disposable local status did not return valid JSON"); }
  assert.equal(config.API_URL, origin, "Unexpected API origin; no request was sent");
  assert.ok(typeof config.ANON_KEY === "string" && config.ANON_KEY.length > 100);
  assert.ok(typeof config.SERVICE_ROLE_KEY === "string" && config.SERVICE_ROLE_KEY.length > 100);
  const checks = [];
  async function request(label, path, { token = config.ANON_KEY, method = "GET", body, expected = 200 } = {}) {
    checkTarget();
    const url = new URL(path, origin);
    assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/"));
    const response = await fetch(url, {
      method, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.body, "Missing local fixture response body");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        assert.ok(bytes <= 128 * 1024, "Unexpected oversized local fixture response");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    let data;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      data = text ? JSON.parse(text) : null;
    } catch { throw new Error(`${label}: local fixture response was not valid UTF-8 JSON`); }
    checks.push({ label, method, path: url.pathname, expectedStatus: expected, status: response.status });
    save("profile-http-checks.json", checks);
    assert.equal(response.status, expected, `${label}: unexpected HTTP status`);
    return data;
  }
  const users = [];
  for (const slot of ["a", "b"]) {
    const email = `${project}-${slot}@example.invalid`;
    const password = randomBytes(30).toString("base64url");
    const user = await request(`create local synthetic user ${slot}`, "/auth/v1/admin/users", {
      token: config.SERVICE_ROLE_KEY, method: "POST", body: { email, password, email_confirm: true },
    });
    assert.ok(typeof user?.id === "string" && uuid.test(user.id), "Auth did not create a fixture user");
    const session = await request(`sign in local synthetic user ${slot}`, "/auth/v1/token?grant_type=password", {
      method: "POST", body: { email, password },
    });
    assert.ok(session?.user?.id === user.id && typeof session.access_token === "string", "Auth session identity mismatch");
    users.push({ id: user.id, token: session.access_token });
  }
  const [a, b] = users;
  assert.notEqual(a.id, b.id);
  const originals = [
    { id: randomUUID(), owner: a.id, slot: "current", name: "A current.pdf", type: "application/pdf", text: "A current synthetic original", accepted: "2026-09-06T00:00:00Z" },
    { id: randomUUID(), owner: a.id, slot: "previous", name: "A previous.md", type: "text/markdown", text: "A previous synthetic original", accepted: "2026-09-05T00:00:00Z" },
    { id: randomUUID(), owner: b.id, slot: "current", name: "B current.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "B current synthetic original", accepted: "2026-09-06T00:00:00Z" },
  ];
  // Every interpolated value is a generated UUID or a constant synthetic value.
  for (const item of originals) {
    assert.match(item.id, uuid);
    assert.match(item.owner, uuid);
  }
  sql("profile-http-seed", `begin;
    insert into public.uploads(id,user_id,storage_path,file_name,file_type,file_size_bytes,extracted_text) values
    ${originals.map(item => `('${item.id}','${item.owner}','${item.owner}/${item.id}/${item.name}','${item.name}','${item.type}',120,'${item.text}')`).join(",\n")};
    insert into public.profile_resume_versions(user_id,upload_id,slot,accepted_at,source_kind) values
    ${originals.map(item => `('${item.owner}','${item.id}','${item.slot}','${item.accepted}','upload')`).join(",\n")};
    commit;`);
  const stored = (label) => JSON.parse(sql(label, `select json_build_object(
    'uploads', (select count(*) from public.uploads where id in (${originals.map(item => `'${item.id}'`).join(",")})),
    'versions', (select count(*) from public.profile_resume_versions where user_id in ('${a.id}','${b.id}')),
    'texts', (select json_object_agg(id,extracted_text) from public.uploads where id in (${originals.map(item => `'${item.id}'`).join(",")}))
  );`));
  const before = stored("profile-http-independent-before");
  assert.equal(before.uploads, 3);
  assert.equal(before.versions, 3);
  assert.deepEqual(before.texts, Object.fromEntries(originals.map(item => [item.id, item.text])));
  const profilePath = (owner) => `/rest/v1/profile_resume_versions?${new URLSearchParams({ select: projection, user_id: `eq.${owner}`, order: "accepted_at.desc" })}`;

  // Reproduce the exact previous ACL, with real populated rows, then reapply
  // only the reviewed migration. This is a permission-upgrade check, not a
  // claim that all historical hosted schema/data upgrades have been tested.
  sql("profile-http-prior-acl", `revoke select (${resourceColumns}) on public.uploads from authenticated;`);
  const denied = await request("old grant reproduces Profile 403", profilePath(a.id), { token: a.token, expected: 403 });
  assert.equal(denied?.code, "42501");
  assert.equal(denied?.message, "permission denied for table uploads");
  const migration = readFileSync(`${workdir}/supabase/migrations/20260906010846_profile_resume_upload_reads.sql`, "utf8");
  sql("profile-http-apply-exact-grant", migration);

  async function readOwner(owner, expectedOriginals) {
    const rows = await request(`read Profile for ${owner === a ? "A" : "B"}`, profilePath(owner.id), { token: owner.token });
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, expectedOriginals.length);
    assert.deepEqual(rows.map(row => ({ uploadId: row.upload_id, slot: row.slot, sourceKind: row.source_kind,
      original: row.uploads })), expectedOriginals.map(item => ({ uploadId: item.id, slot: item.slot, sourceKind: "upload",
      original: { file_name: item.name, file_type: item.type, file_size_bytes: 120,
        storage_path: `${item.owner}/${item.id}/${item.name}`, extracted_text: item.text } })));
    return rows;
  }
  const first = await readOwner(a, originals.slice(0, 2));
  await readOwner(b, originals.slice(2));
  const reloaded = await readOwner(a, originals.slice(0, 2));
  assert.deepEqual(reloaded, first, "Reload changed persisted resume versions");
  const crossOwner = await request("changed owner cannot read A's Profile resumes", profilePath(a.id), { token: b.token });
  assert.deepEqual(crossOwner, []);
  for (const owner of [a, b]) {
    const rows = await request("unfiltered uploads preserve row isolation", `/rest/v1/uploads?select=${resourceColumns}`, { token: owner.token });
    assert.deepEqual(rows.map(row => row.id).sort(), originals.filter(item => item.owner === owner.id).map(item => item.id).sort());
  }
  for (const select of ["*", "ingest_claim_token,ingest_response"]) {
    const result = await request("private upload projection denied", `/rest/v1/uploads?${new URLSearchParams({ select })}`, { token: a.token, expected: 403 });
    assert.equal(result?.code, "42501");
  }
  const anonymous = await request("anonymous upload read denied", "/rest/v1/uploads?select=id,file_name", { expected: 401 });
  assert.equal(anonymous?.code, "42501");
  const mutation = await request("browser cannot rewrite original extraction", `/rest/v1/uploads?id=eq.${originals[0].id}`, {
    token: a.token, method: "PATCH", body: { extracted_text: "forged" }, expected: 403,
  });
  assert.equal(mutation?.code, "42501");
  assert.deepEqual(stored("profile-http-independent-after"), before, "Original rows or versions changed during read/denial acceptance");
  save("profile-http-acceptance.json", { passed: true, project, origin,
    fixtureUserIds: users.map(user => user.id), fixtureUploadIds: originals.map(item => item.id), checks,
    scope: "Real local Auth password sessions and PostgREST embedding, old-ACL failure, exact grant repair, reload, two-owner isolation and independent SQL read. No actual browser, hosted change or upload/provider execution." });
}
