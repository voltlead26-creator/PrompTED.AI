import { readFile } from "node:fs/promises";

const path = "docs/product-promise-registry.json";
const raw = await readFile(path, "utf8");
const registry = JSON.parse(raw);

if (!registry || !Array.isArray(registry.promises) || registry.promises.length === 0) {
  console.error("Product promise registry must contain at least one promise.");
  process.exit(1);
}

const allowedStatuses = new Set(["planned", "enforced", "deprecated"]);
const ids = new Set();
const failures = [];

for (const [index, promise] of registry.promises.entries()) {
  const location = `promises[${index}]`;
  if (!promise.id || typeof promise.id !== "string") failures.push(`${location}: missing id`);
  else if (ids.has(promise.id)) failures.push(`${location}: duplicate id ${promise.id}`);
  else ids.add(promise.id);

  if (!promise.promise || typeof promise.promise !== "string") failures.push(`${location}: missing promise text`);
  if (!promise.owner || typeof promise.owner !== "string") failures.push(`${location}: missing owner`);
  if (!allowedStatuses.has(promise.status)) failures.push(`${location}: invalid status ${promise.status}`);
  if (!Array.isArray(promise.requiredEvidence) || promise.requiredEvidence.length < 2) {
    failures.push(`${location}: requiredEvidence must contain at least two checks`);
  }
  if (promise.status === "enforced" && promise.requiredEvidence.some((item) => !String(item).trim())) {
    failures.push(`${location}: enforced promise contains blank evidence`);
  }
}

if (failures.length > 0) {
  console.error("Product promise registry validation failed:\n" + failures.join("\n"));
  process.exit(1);
}

console.log(`Product promise registry passed (${registry.promises.length} promises).`);
