"use client";

// =====================================================
// GuidedTour — lightweight first-visit coach marks.
// No third-party tour library: a fixed overlay, a pulsing
// spotlight ring around the anchored element, and a card
// with Next / Back / Skip. Shows once per tour id
// (localStorage), always skippable, keyboard dismissable.
// Anchors are located via [data-tour="<anchor>"].
// =====================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./GuidedTour.module.css";

export interface TourStep {
  /** Matches an element carrying data-tour="<anchor>". */
  anchor: string;
  title: string;
  body: string;
}

interface GuidedTourProps {
  /** Unique id per surface, e.g. "home-v1". Bump to re-show after big changes. */
  tourId: string;
  steps: TourStep[];
  /** Delay before first paint so the page settles (ms). */
  startDelayMs?: number;
}

const STORAGE_PREFIX = "prompted.tour.";

function seen(tourId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + tourId) === "done";
  } catch {
    return true; // no storage -> never nag
  }
}

function markSeen(tourId: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + tourId, "done");
  } catch {
    // ignore
  }
}

interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GuidedTour({ tourId, steps, startDelayMs = 600 }: GuidedTourProps) {
  const [index, setIndex] = useState(-1);
  const [rect, setRect] = useState<SpotRect | null>(null);

  const active = index >= 0 && index < steps.length;
  const step = active ? steps[index] : null;

  useEffect(() => {
    if (seen(tourId)) return;
    const t = setTimeout(() => setIndex(0), startDelayMs);
    return () => clearTimeout(t);
  }, [tourId, startDelayMs]);

  const locate = useCallback(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 });
  }, [step]);

  useEffect(() => {
    if (!active) return;
    locate();
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [active, locate]);

  const finish = useCallback(() => {
    markSeen(tourId);
    setIndex(steps.length);
  }, [tourId, steps.length]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        setIndex((i) => (i + 1 < steps.length ? i + 1 : (markSeen(tourId), steps.length)));
      }
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, steps.length, tourId, finish]);

  const cardStyle = useMemo(() => {
    if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" } as const;
    const below = rect.top + rect.height + 16;
    const fitsBelow = below + 180 < window.innerHeight;
    return {
      top: fitsBelow ? below : Math.max(16, rect.top - 196),
      left: Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - 356)),
    } as const;
  }, [rect]);

  if (!active || !step) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Quick tour">
      {rect && (
        <div
          className={styles.spotlight}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div className={styles.card} style={cardStyle}>
        <p className={styles.progress}>
          {index + 1} of {steps.length}
        </p>
        <h3 className={styles.title}>{step.title}</h3>
        <p className={styles.body}>{step.body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={finish}>
            Skip tour
          </button>
          <div className={styles.nav}>
            {index > 0 && (
              <button type="button" className={styles.back} onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className={styles.next}
              onClick={() =>
                index + 1 < steps.length ? setIndex(index + 1) : finish()
              }
            >
              {index + 1 < steps.length ? "Next" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
