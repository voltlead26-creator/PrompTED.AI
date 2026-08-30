/**
 * Layer 16 — Bundle security scan.
 * Verifies that no AI provider API key patterns exist in the source tree.
 * This prevents accidentally committed secrets from reaching the client bundle.
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "fs/promises";
import path from "path";

// Patterns that indicate real provider keys committed to source.
const KEY_PATTERNS = [
  // OpenAI secret keys
  /sk-[A-Za-z0-9]{20,}/,
  // Google AI / Firebase API keys
  /AIza[A-Za-z0-9_-]{35}/,
  // Anthropic project / API keys
  /ant-proj-[A-Za-z0-9_-]{20,}/,
  /ant-api[A-Za-z0-9_-]{20,}/,
];

const SRC_DIR = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "out",
  "coverage",
]);
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".env"]);

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(full);
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

describe("Security — source key scan", () => {
  it("source files contain no AI provider key patterns", async () => {
    const violations: string[] = [];

    for await (const file of walkFiles(SRC_DIR)) {
      // Skip .env.example — it documents key names but never has real values.
      if (file.endsWith(".env.example")) continue;

      const content = await readFile(file, "utf-8");
      for (const pattern of KEY_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: matches ${pattern.source}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Provider key patterns found in source:\n${violations.join("\n")}`,
      );
    }

    expect(violations).toHaveLength(0);
  }, 30_000);
});
