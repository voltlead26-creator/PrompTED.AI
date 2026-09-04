import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const directory = "supabase/migrations";
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const failures = [];
const timestamps = new Set();

for (const file of files) {
  const match = file.match(/^(\d{14})_.+\.sql$/);
  if (!match) {
    failures.push(`${file}: migration filename must begin with a 14-digit UTC timestamp`);
    continue;
  }

  const timestamp = match[1];
  if (timestamps.has(timestamp)) failures.push(`${file}: duplicate migration timestamp ${timestamp}`);
  timestamps.add(timestamp);

  const sql = await readFile(join(directory, file), "utf8");
  if (!sql.trim()) failures.push(`${file}: migration is empty`);
  if (/security\s+definer/i.test(sql) && !/set\s+search_path/i.test(sql)) {
    failures.push(`${file}: SECURITY DEFINER function must set an explicit search_path`);
  }
  if (
    timestamp >= "20260812170000" &&
    /(^|[^.\w])uuid_generate_v[45]\s*\(/im.test(sql)
  ) {
    failures.push(
      `${file}: new migrations must not depend on an unqualified uuid_generate_v4()/uuid_generate_v5(); use gen_random_uuid() or an explicitly qualified extension function`,
    );
  }
}

const atomicImport = files.find((file) => file.includes("atomic_document_import"));
if (!atomicImport) {
  failures.push("Missing atomic document import migration");
} else {
  const sql = await readFile(join(directory, atomicImport), "utf8");
  for (const requirement of [
    "commit_document_import",
    "original-documents",
    "idempotency_key",
    "status = 'committed'",
  ]) {
    if (!sql.includes(requirement)) failures.push(`${atomicImport}: missing required marker ${requirement}`);
  }
}

const atomicGuestImport = files.find((file) =>
  file.includes("atomic_guest_workspace_import"),
);
if (!atomicGuestImport) {
  failures.push("Missing atomic guest workspace import migration");
} else {
  const sql = await readFile(join(directory, atomicGuestImport), "utf8");
  for (const requirement of [
    "commit_guest_workspace_import",
    "private.guest_workspace_imports",
    "request_sha256",
    "set search_path = ''",
    "GUEST_IMPORT_OUTCOME_ID_COLLISION",
    "GUEST_IMPORT_DOCUMENT_ID_COLLISION",
    "GUEST_IMPORT_SECTION_ID_COLLISION",
    "grant execute on function public.commit_guest_workspace_import",
  ]) {
    if (!sql.includes(requirement)) {
      failures.push(`${atomicGuestImport}: missing required marker ${requirement}`);
    }
  }

  // This boundary imports device-only work exactly once. Existing durable
  // rows must be rejected, never repurposed as an update/reconciliation path.
  for (const prohibited of [
    /update\s+public\.outcomes\b/i,
    /update\s+public\.documents\b/i,
    /update\s+public\.sections\b/i,
    /delete\s+from\s+public\.outcomes\b/i,
    /delete\s+from\s+public\.documents\b/i,
    /delete\s+from\s+public\.sections\b/i,
  ]) {
    if (prohibited.test(sql)) {
      failures.push(
        `${atomicGuestImport}: guest import must remain insert-only (${prohibited})`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Migration validation failed:\n" + failures.join("\n"));
  process.exit(1);
}

console.log(`Migration validation passed (${files.length} migrations).`);
