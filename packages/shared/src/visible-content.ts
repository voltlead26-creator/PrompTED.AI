/**
 * True when text contains no visible content after markup and non-breaking
 * space placeholders are removed. Numeric entities other than whitespace stay
 * visible because they may represent real script characters.
 */
export function isVisiblyEmpty(content: string): boolean {
  return !content
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, " ")
    .trim();
}
