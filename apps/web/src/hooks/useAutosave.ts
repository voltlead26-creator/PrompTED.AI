"use client";

import { useEffect, useRef } from "react";
import {
  browserPrincipalMatchesOwnerEpoch,
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";

function captureScheduledLease(ownerEpoch: string): OwnerDispatchLease | null {
  if (!ownerEpoch.startsWith("user:")) return null;
  return captureOwnerDispatch(ownerEpoch.slice("user:".length));
}

function scheduledOwnerIsCurrent(
  ownerEpoch: string,
  lease: OwnerDispatchLease | null,
): boolean {
  if (lease) return ownerDispatchIsCurrent(lease);
  if (ownerEpoch === "default") return true;
  return browserPrincipalMatchesOwnerEpoch(ownerEpoch);
}

/**
 * useAutosave — debounced persistence.
 *
 * Calls `onSave(value)` `delay` ms after `value` stops changing. The first
 * render never fires (nothing has changed yet). Flushes a pending save on
 * unmount so an in-flight edit is not lost when leaving the workspace. An
 * owner epoch change is different from normal navigation: pending values from
 * the prior principal are discarded and can never run through the next
 * principal's authenticated callback.
 */
export function useAutosave<T>(
  value: T,
  onSave: (value: T, lease: OwnerDispatchLease | null) => void,
  delay = 500,
  ownerEpoch = "default",
  mutationEpochSource: string | number | (() => string | number) = 0,
): void {
  const mutationEpoch =
    typeof mutationEpochSource === "function"
      ? mutationEpochSource()
      : mutationEpochSource;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const activeOwnerEpoch = useRef(ownerEpoch);
  const activeMutationEpoch = useRef(mutationEpoch);
  const ownerTransition = useRef(false);
  const mutationTransition = useRef(false);
  const latestSave = useRef(onSave);
  const latestMutationEpochSource = useRef(mutationEpochSource);
  const pending = useRef<{
    ownerEpoch: string;
    mutationEpoch: string | number;
    readMutationEpoch: () => string | number;
    value: T;
    save: (value: T, lease: OwnerDispatchLease | null) => void;
    lease: OwnerDispatchLease | null;
  } | null>(null);

  latestSave.current = onSave;
  latestMutationEpochSource.current = mutationEpochSource;

  if (activeOwnerEpoch.current !== ownerEpoch) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    activeOwnerEpoch.current = ownerEpoch;
    ownerTransition.current = true;
  }

  if (activeMutationEpoch.current !== mutationEpoch) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    activeMutationEpoch.current = mutationEpoch;
    mutationTransition.current = true;
  }

  useEffect(() => {
    // Skip the initial mount — only persist actual changes.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (ownerTransition.current) {
      ownerTransition.current = false;
      mutationTransition.current = false;
      return;
    }
    if (mutationTransition.current) {
      mutationTransition.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    let lease: OwnerDispatchLease | null;
    try {
      lease = captureScheduledLease(ownerEpoch);
    } catch {
      pending.current = null;
      return;
    }
    const readMutationEpoch = () => {
      const source = latestMutationEpochSource.current;
      return typeof source === "function" ? source() : source;
    };
    const scheduled = {
      ownerEpoch,
      mutationEpoch,
      readMutationEpoch,
      value,
      save: latestSave.current,
      lease,
    };
    pending.current = scheduled;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (
        activeOwnerEpoch.current !== scheduled.ownerEpoch ||
        activeMutationEpoch.current !== scheduled.mutationEpoch ||
        scheduled.readMutationEpoch() !== scheduled.mutationEpoch ||
        pending.current !== scheduled ||
        !scheduledOwnerIsCurrent(scheduled.ownerEpoch, scheduled.lease)
      ) {
        return;
      }
      pending.current = null;
      scheduled.save(scheduled.value, scheduled.lease);
    }, delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay, ownerEpoch, mutationEpoch]);

  // Flush on unmount if a debounced save is still pending.
  useEffect(() => {
    return () => {
      const scheduled = pending.current;
      if (
        scheduled &&
        scheduled.ownerEpoch === activeOwnerEpoch.current &&
        scheduled.mutationEpoch === activeMutationEpoch.current &&
        scheduled.readMutationEpoch() === scheduled.mutationEpoch &&
        scheduledOwnerIsCurrent(scheduled.ownerEpoch, scheduled.lease)
      ) {
        pending.current = null;
        scheduled.save(scheduled.value, scheduled.lease);
      }
    };
  }, []);
}
