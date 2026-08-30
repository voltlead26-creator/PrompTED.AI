"use client";

import { Node, mergeAttributes } from "@tiptap/core";

const TOKEN_PATTERN = /\{\{TED_PLACEHOLDER:([A-Za-z0-9._-]+):([^{}]+)\}\}/g;

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
    (_token, id, label) =>
      `<span data-ted-placeholder-id="${escapeHtml(String(id))}" data-ted-placeholder-label="${escapeHtml(String(label).trim())}">${escapeHtml(String(label).trim())}</span>`,
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
