import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function cssProperty(file: string, selector: string, property: string): string {
  const style = document.createElement("style");
  style.textContent = readFileSync(file, "utf8");
  document.head.append(style);

  try {
    const rule = Array.from(style.sheet?.cssRules ?? []).find(
      (candidate): candidate is CSSStyleRule =>
        candidate instanceof CSSStyleRule && candidate.selectorText === selector,
    );
    return rule?.style.getPropertyValue(property).trim() ?? "";
  } finally {
    style.remove();
  }
}

describe("viewport layout ownership", () => {
  it("keeps viewport sizing at the application shell boundary", () => {
    expect(
      cssProperty("src/app/(app)/AppLayout.module.css", ".shell", "min-height"),
    ).toBe("100dvh");
  });

  it("makes Home and Conversation fill their bounded parent", () => {
    expect(
      cssProperty("src/app/(app)/home/HomeScreen.module.css", ".screen", "min-height"),
    ).toBe("100%");
    expect(
      cssProperty("src/app/(app)/home/HomeScreen.module.css", ".inner", "min-height"),
    ).toBe("");
    expect(
      cssProperty(
        "src/components/organisms/ConversationView.module.css",
        ".wrap",
        "height",
      ),
    ).toBe("100%");
  });

  it("centres upload analysis within its parent instead of the viewport", () => {
    expect(
      cssProperty(
        "src/components/organisms/UploadAnalysisPanel.module.css",
        ".wrap",
        "min-height",
      ),
    ).toBe("100%");
  });
});
