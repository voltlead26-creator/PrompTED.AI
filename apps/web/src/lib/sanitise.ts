"use client";

import DOMPurify from "dompurify";

const MAX_CONTENT_LENGTH = 20_000;

const PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "u", "s",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote",
    "a", "span", "code", "pre",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "class"],
  ALLOW_DATA_ATTR: false,
};

/**
 * Sanitise Tiptap HTML output before storing to sections.content.
 * Strips scripts, event handlers, and dangerous attributes.
 * Caps content at 20,000 characters.
 */
export function sanitiseSectionContent(html: string): string {
  const clean = DOMPurify.sanitize(html, PURIFY_CONFIG);
  return clean.length > MAX_CONTENT_LENGTH
    ? clean.slice(0, MAX_CONTENT_LENGTH)
    : clean;
}

/**
 * Sanitise plain text input (no HTML tags allowed).
 * Caps at 20,000 characters.
 */
export function sanitisePlainText(text: string): string {
  const stripped = DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return stripped.length > MAX_CONTENT_LENGTH
    ? stripped.slice(0, MAX_CONTENT_LENGTH)
    : stripped;
}
