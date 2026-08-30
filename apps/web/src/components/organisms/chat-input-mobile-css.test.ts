import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/components/organisms/ChatInput.module.css"),
  "utf8",
);

describe("ChatInput mobile layout", () => {
  it("keeps a compact icon-only send button visible and lets typed text use the width", () => {
    const mobileRule = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*)\}\s*$/);

    // The send button stays visible on mobile (not display:none) — Enter
    // alone isn't a reliable or discoverable submit affordance on a phone
    // keyboard — but shrinks to an icon-only circle by hiding its label.
    expect(mobileRule?.[1]).not.toMatch(/\.sendButton\s*\{[^}]*display:\s*none;/);
    expect(mobileRule?.[1]).toMatch(/\.sendButton\s*\{[^}]*min-width:\s*var\(--touch-target\);/);
    expect(mobileRule?.[1]).toMatch(/\.sendLabel\s*\{[^}]*display:\s*none;/);
    expect(mobileRule?.[1]).toMatch(/\.textarea\s*\{[^}]*min-width:\s*0;/);
    expect(mobileRule?.[1]).toMatch(/\.composer\s*\{[^}]*min-width:\s*0;/);
  });
});
