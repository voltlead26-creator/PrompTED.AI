import { describe, expect, it } from "vitest";
import * as browser from "@prompted/shared/browser";

describe("browser-safe shared entry", () => {
  it("does not expose the full catalogue or immutable ledger payload", () => {
    expect(browser).not.toHaveProperty("TEMPLATES");
    expect(browser).not.toHaveProperty("BUNDLES");
    expect(browser).not.toHaveProperty("CAPTURED_DOCUMENT_LEDGER");
    expect(browser).not.toHaveProperty("configureApiClient");
    expect(browser).not.toHaveProperty("buildBudgetWorkbook");
  });

  it("does expose lightweight durable operation validators", () => {
    expect(browser.validateDurableGenerationOperation).toBeTypeOf("function");
    expect(browser.validateRevisionBoundExport).toBeTypeOf("function");
  });

  it("shares the no-blank rule without erasing visible numeric entities", () => {
    expect(browser.isVisiblyEmpty("<p><br></p>&#xA0;")).toBe(true);
    expect(browser.isVisiblyEmpty("&#1609;")).toBe(false);
  });
});
