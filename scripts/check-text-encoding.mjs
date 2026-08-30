import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOTS = ["apps", "packages", "supabase", "docs"];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".md", ".sql"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", "dist", "coverage", ".git"]);
const CORRUPTION_MARKERS = ["Ãƒ", "Ã¢", "Â€", "Â™", "â€¢", "â€”", "â€“", "ï¿½"];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const failures = [];
for (const root of ROOTS) {
  let files = [];
  try {
    files = await walk(root);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const marker = CORRUPTION_MARKERS.find((candidate) => content.includes(candidate));
    if (marker) failures.push(`${file}: contains suspicious encoding marker ${JSON.stringify(marker)}`);
  }
}

if (failures.length > 0) {
  console.error("Possible text-encoding corruption found:\n" + failures.join("\n"));
  process.exit(1);
}

console.log("Text encoding check passed.");
