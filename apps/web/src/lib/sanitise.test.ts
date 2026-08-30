/**
 * Layer 15 — Client-side sanitisation tests.
 */
import { describe, expect, it } from "vitest";
import { sanitiseSectionContent, sanitisePlainText } from "./sanitise";

describe("sanitiseSectionContent", () => {
  it("passes safe HTML through unchanged", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    expect(sanitiseSectionContent(html)).toBe(html);
  });

  it("strips <script> tags", () => {
    const result = sanitiseSectionContent("<p>Hi</p><script>alert(1)</script>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Hi");
  });

  it("strips event handler attributes", () => {
    const result = sanitiseSectionContent('<p onclick="alert(1)">Click me</p>');
    expect(result).not.toContain("onclick");
    expect(result).toContain("Click me");
  });

  it("strips slash-delimited event handler attributes", () => {
    const result = sanitiseSectionContent(
      "<details/open/ontoggle=alert(document.domain)>Click me</details>",
    );
    expect(result).not.toContain("ontoggle");
    expect(result).not.toContain("alert(document.domain)");
    expect(result).toContain("Click me");
  });

  it("strips javascript: URIs from links", () => {
    const result = sanitiseSectionContent('<a href="javascript:alert(1)">link</a>');
    expect(result).not.toContain("javascript:");
  });

  it("allows safe href links", () => {
    const result = sanitiseSectionContent('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
  });

  it("truncates content exceeding 20,000 characters", () => {
    const long = "<p>" + "a".repeat(25_000) + "</p>";
    const result = sanitiseSectionContent(long);
    expect(result.length).toBeLessThanOrEqual(20_000);
  });

  it("preserves allowed tags (ul, ol, li)", () => {
    const list = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    expect(sanitiseSectionContent(list)).toBe(list);
  });
});

describe("sanitisePlainText", () => {
  it("strips all HTML tags", () => {
    const result = sanitisePlainText("<b>Bold</b> text");
    expect(result).not.toContain("<b>");
    expect(result).toContain("Bold");
    expect(result).toContain("text");
  });

  it("truncates plain text exceeding 20,000 characters", () => {
    const long = "a".repeat(25_000);
    const result = sanitisePlainText(long);
    expect(result.length).toBeLessThanOrEqual(20_000);
  });

  it("returns empty string for empty input", () => {
    expect(sanitisePlainText("")).toBe("");
  });
});
