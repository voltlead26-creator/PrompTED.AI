"use client";

import { useEffect, useState } from "react";

/** Loads a first-visit tour only when unseen and after critical interaction is ready. */
export function useDeferredTour(tourId: string): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(`prompted.tour.${tourId}`) === "done") return;
    } catch {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(() => setReady(true), {
        timeout: 2_000,
      });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setReady(true), 1_000);
    return () => window.clearTimeout(id);
  }, [tourId]);

  return ready;
}
