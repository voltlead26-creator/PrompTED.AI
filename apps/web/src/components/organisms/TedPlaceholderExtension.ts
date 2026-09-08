"use client";

import { Node, mergeAttributes } from "@tiptap/core";

const TOKEN_PATTERN = /\{\{TED_PLACEHOLDER:([A-Za-z0-9._-]+):([^{}]+)\}\}/g;
const SERIALISED_TEXT_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": "\u00a0",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderTedPlaceholdersForEditor(content: string): string {
  return content.replace(
    TOKEN_PATTERN,
    (_token, id, label) => {
      const text = String(label).trim();
      // Undo only the entities emitted by TextNode HTML serialisation, once.
      // Broader decoding could turn numeric/named references into token braces.
      const decoded = text.replace(
        /&(?:amp|lt|gt|nbsp);/g,
        (entity) => SERIALISED_TEXT_ENTITIES[entity] ?? entity,
      );
      const escapedLabel = escapeHtml(decoded.trim() ? decoded : text);
      return `<span data-ted-placeholder-id="${escapeHtml(String(id))}" data-ted-placeholder-label="${escapedLabel}">${escapedLabel}</span>`;
    },
  );
}

export function serialiseTedPlaceholdersFromEditor(html: string): string {
  if (typeof document === "undefined") return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll<HTMLElement>("[data-ted-placeholder-id]").forEach((node) => {
    const id = node.dataset.tedPlaceholderId?.trim();
    const label = node.dataset.tedPlaceholderLabel?.trim() || node.textContent?.trim();
    if (!id || !label) return;
    node.replaceWith(document.createTextNode(`{{TED_PLACEHOLDER:${id}:${label}}}`));
  });
  return root.innerHTML;
}

export const TedPlaceholderExtension = Node.create({
  name: "tedPlaceholder",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: "" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [{
      tag: "span[data-ted-placeholder-id]",
      getAttrs: (element) => {
        const node = element as HTMLElement;
        return {
          id: node.dataset.tedPlaceholderId ?? "",
          label: node.dataset.tedPlaceholderLabel ?? node.textContent ?? "",
        };
      },
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? "").trim();
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-ted-placeholder-id": String(node.attrs.id ?? ""),
        "data-ted-placeholder-label": label,
        "data-ted-placeholder": "true",
        role: "button",
        tabindex: "0",
        "aria-label": `Missing information: ${label}`,
      }),
      label,
    ];
  },

  renderText({ node }) {
    return String(node.attrs.label ?? "");
  },
});
