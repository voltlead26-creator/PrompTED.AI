import { Editor, mergeAttributes } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  renderTedPlaceholdersForEditor,
  serialiseTedPlaceholdersFromEditor,
  TedPlaceholderExtension,
} from "./TedPlaceholderExtension";

describe("the real editor dependency boundary", () => {
  it("does not promote a JSON-origin prototype key into executable DOM attributes", () => {
    // Exercise the upstream merge/DOM boundary used by the placeholder renderer.
    // This establishes dependency behavior, not an application exploit path.
    const untrustedAttributes = JSON.parse(
      '{"__proto__":{"onclick":"syntheticHandler()"},"class":"source-class"}',
    );
    const attributes = mergeAttributes(
      { "data-ted-placeholder-id": "incident.date", role: "button" },
      untrustedAttributes,
    );
    const { dom } = DOMSerializer.renderSpec(document, ["span", attributes, "Date"]);
    expect(dom).toBeInstanceOf(HTMLElement);
    expect((dom as HTMLElement).hasAttribute("onclick")).toBe(false);
    expect((dom as HTMLElement).getAttribute("data-ted-placeholder-id")).toBe("incident.date");
    expect((dom as HTMLElement).classList.contains("source-class")).toBe(true);
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    expect(attributes.onclick).toBeUndefined();
  });

  it("preserves wording, formatting, safe links and placeholder identity after serialisation and reopen", () => {
    const content =
      '<p>Reviewed <strong>wording</strong> and <a href="https://example.com/evidence">evidence</a>.</p>' +
      "<ul><li>Keep the receipt.</li></ul>" +
      "<p>{{TED_PLACEHOLDER:incident.date:Date & time}}</p>";
    const editor = new Editor({
      extensions: [StarterKit, TedPlaceholderExtension],
      content: renderTedPlaceholdersForEditor(content),
    });
    try {
      const html = editor.getHTML();
      const root = document.createElement("div");
      root.innerHTML = html;
      expect(root.querySelector("strong")?.textContent).toBe("wording");
      expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/evidence");
      expect(root.querySelector("li")?.textContent).toBe("Keep the receipt.");
      const placeholder = root.querySelector('[data-ted-placeholder-id="incident.date"]');
      expect(placeholder?.textContent).toBe("Date & time");
      expect(placeholder?.getAttribute("aria-label")).toBe("Missing information: Date & time");
      expect(placeholder?.getAttribute("role")).toBe("button");
      expect(placeholder?.getAttribute("tabindex")).toBe("0");

      const serialised = serialiseTedPlaceholdersFromEditor(html);
      expect(serialised).toContain("{{TED_PLACEHOLDER:incident.date:Date &amp; time}}");
      for (let reopen = 0; reopen < 3; reopen += 1) {
        editor.commands.setContent(renderTedPlaceholdersForEditor(serialised));
        expect(serialiseTedPlaceholdersFromEditor(editor.getHTML())).toBe(serialised);
      }
    } finally {
      editor.destroy();
    }
  });

  it("keeps hostile placeholder label markup as text on import and serialisation", () => {
    const editor = new Editor({
      extensions: [StarterKit, TedPlaceholderExtension],
      content: renderTedPlaceholdersForEditor(
        '<p>{{TED_PLACEHOLDER:incident.date:Date <img src=x onerror="syntheticHandler()">}}</p>',
      ),
    });
    try {
      const root = document.createElement("div");
      root.innerHTML = editor.getHTML();
      expect(root.querySelector("img")).toBeNull();
      expect(root.querySelector("[onerror]")).toBeNull();
      expect(root.querySelector("[data-ted-placeholder-id]")?.textContent).toBe(
        'Date <img src=x onerror="syntheticHandler()">',
      );
      const serialised = serialiseTedPlaceholdersFromEditor(editor.getHTML());
      expect(serialised).toContain("{{TED_PLACEHOLDER:incident.date:");
      expect(serialised).not.toContain("<img");
    } finally {
      editor.destroy();
    }
  });

  it.each([
    ["literal entity text", "Date &amp;lt; time", "Date &lt; time"],
    ["nonbreaking space", "Date&nbsp;and time", "Date\u00a0and time"],
    [
      "encoded markup and textarea closing tag",
      '&lt;/textarea&gt;&lt;img src=x onerror="syntheticHandler()"&gt;',
      '</textarea><img src=x onerror="syntheticHandler()">',
    ],
    ["numeric token delimiters", "Date &#123;&#125;", "Date &#123;&#125;"],
    ["named token delimiters", "Date &lbrace;&rbrace;", "Date &lbrace;&rbrace;"],
    ["entity-only whitespace", "&nbsp;", "&nbsp;"],
  ])("preserves %s as one label across repeated reopen", (_name, encoded, expected) => {
    const editor = new Editor({
      extensions: [StarterKit, TedPlaceholderExtension],
      content: renderTedPlaceholdersForEditor(
        `<p>{{TED_PLACEHOLDER:incident.date:${encoded}}}</p>`,
      ),
    });
    try {
      const serialised = serialiseTedPlaceholdersFromEditor(editor.getHTML());
      for (let reopen = 0; reopen < 3; reopen += 1) {
        editor.commands.setContent(renderTedPlaceholdersForEditor(serialised));
        const root = document.createElement("div");
        root.innerHTML = editor.getHTML();
        expect(root.querySelectorAll("[data-ted-placeholder-id]")).toHaveLength(1);
        expect(root.querySelector("[data-ted-placeholder-id]")?.textContent).toBe(expected);
        expect(root.querySelector("img, textarea, [onerror]")).toBeNull();
        expect(serialiseTedPlaceholdersFromEditor(editor.getHTML())).toBe(serialised);
      }
    } finally {
      editor.destroy();
    }
  });
});
