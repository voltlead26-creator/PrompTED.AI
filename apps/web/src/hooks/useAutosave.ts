"use client";

import { useEffect, useRef } from "react";

/**
 * useAutosave — debounced persistence.
 *
 * Calls `onSave(value)` `delay` ms after `value` stops changing. The first
 * render never fires (nothing has changed yet). Flushes a pending save on
 * unmount so an in-flight edit is not lost when leaving the workspace.
 */
export function useAutosave<T>(
  value: T,
  onSave: (value: T) => void,
  delay = 500,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const save = useRef(onSave);
  const mounted = useRef(false);
  const dirty = useRef(false);

  latest.current = value;
  save.current = onSave;

  useEffect(() => {
    // Skip the initial mount — only persist actual changes.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      save.current(latest.current);
    }, delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay]);

  // Flush on unmount if a debounced save is still pending.
  useEffect(() => {
    return () => {
      if (dirty.current) save.current(latest.current);
    };
  }, []);
}
