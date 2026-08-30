import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceCss = readFileSync(
  resolve(process.cwd(), "src/components/organisms/WorkspacePane.module.css"),
  "utf8",
);
const editorCss = readFileSync(
  resolve(process.cwd(), "src/components/organisms/SectionEditor.module.css"),
  "utf8",
);

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("workspace editor fixed chrome", () => {
  it("keeps the section header and feature bar still while only prose scrolls", () => {
    expect(rule(workspaceCss, ".documentViewport")).toMatch(/overflow:\s*hidden/);
    expect(rule(workspaceCss, ".documentPage")).toMatch(/height:\s*100%/);
    expect(rule(workspaceCss, ".documentSection")).toMatch(/height:\s*100%/);

    expect(rule(editorCss, ".documentMode .body")).toMatch(/overflow:\s*hidden/);
    expect(rule(editorCss, ".documentMode .editorWrap")).toMatch(/overflow-y:\s*auto/);
    expect(rule(editorCss, ".documentMode .contextBar")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(editorCss, ".documentMode .contextBar")).toMatch(/position:\s*static/);
  });
});
