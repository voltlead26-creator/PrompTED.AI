"use client";

import type { CSSProperties } from "react";
import type { BrandKit, Section } from "@prompted/shared";
import { sanitiseSectionContent } from "@/lib/sanitise";
import { isWorkspaceSectionContentLoaded } from "@/lib/workspace-initial-state";
import styles from "./LivePreview.module.css";

/** True when content carries HTML tags (rich text from the editor). */
function looksLikeHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

interface LivePreviewProps {
  title: string;
  sections: Section[];
  /** Optional lede shown above the body (TED's understanding). */
  lede?: string;
  /** Business brand kit — applied when present (logo, colour, footer). */
  brandKit?: BrandKit | null;
}

/**
 * LivePreview — right pane. A styled HTML preview of the document that updates
 * optimistically from local section state on every edit. This is NOT a PDF
 * render (that happens on export); it is a faithful on-screen approximation.
 *
 * Content is rendered as plain text paragraphs in Layer 8. Layer 9 introduces
 * rich text, at which point sanitised HTML is rendered here.
 */
export function LivePreview({
  title,
  sections,
  lede,
  brandKit,
}: LivePreviewProps) {
  const headingStyle: CSSProperties | undefined = brandKit?.primary_colour
    ? { color: brandKit.primary_colour }
    : undefined;

  return (
    <div className={styles.pane} aria-label="Live preview">
      <article className={styles.document}>
        {brandKit?.logo_url && (
          <img src={brandKit.logo_url} alt="" className={styles.logo} />
        )}

        <h1 className={styles.docTitle} style={headingStyle}>
          {title}
        </h1>

        {lede && <p className={styles.lede}>{lede}</p>}

        {sections.map((section) => (
          <section key={section.id} className={styles.section}>
            <h2 className={styles.heading} style={headingStyle}>
              {section.name}
            </h2>
            {!isWorkspaceSectionContentLoaded(section) ? (
              <p className={styles.placeholder}>
                Saved wording for this section has not been loaded into this preview.
              </p>
            ) : section.content.trim() ? (
              looksLikeHtml(section.content) ? (
                <div
                  className={styles.richBody}
                  // Sanitised before render — the editor's HTML is never trusted raw.
                  dangerouslySetInnerHTML={{
                    __html: sanitiseSectionContent(section.content),
                  }}
                />
              ) : (
                section.content
                  .split(/\n{2,}/)
                  .map((para, i) => (
                    <p key={i} className={styles.paragraph}>
                      {para}
                    </p>
                  ))
              )
            ) : (
              <p className={styles.placeholder}>
                This section is empty. Add content in the editor.
              </p>
            )}
          </section>
        ))}

        {brandKit?.footer_text && (
          <footer className={styles.footer}>{brandKit.footer_text}</footer>
        )}
      </article>
    </div>
  );
}
