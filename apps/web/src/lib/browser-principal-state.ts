export interface OwnerDispatchLease {
  /** Exact account that initiated the action before its first async boundary. */
  expectedUserId: string;
  /** Monotonic browser-principal generation. Detects A -> B -> A transitions. */
  principalEpoch: number;
  /** Aborts when the principal changes or the caller cancels the action. */
  signal: AbortSignal;
  /** Fails closed before dispatch, retry, streamed delivery, or side effects. */
  assertCurrent: () => void;
}

export class OwnerDispatchError extends Error {
  readonly code = "OWNER_DISPATCH_STALE";

  constructor() {
    super("The signed-in account changed before this action completed.");
    this.name = "OwnerDispatchError";
  }
}

let activeBrowserPrincipal: string | null | undefined;
let principalEpoch = 0;
let principalController = new AbortController();
principalController.abort(new OwnerDispatchError());

function normaliseUserId(userId: string): string {
  return userId.trim().toLowerCase();
}

function retirePrincipalEpoch(): void {
  if (!principalController.signal.aborted) {
    principalController.abort(new OwnerDispatchError());
  }
  principalEpoch += 1;
  principalController = new AbortController();
}

/**
 * Synchronous principal truth for async dispatch and teardown paths. A token
 * refresh for the same account preserves the epoch; every effective identity
 * transition retires and aborts all leases owned by the previous epoch.
 */
export function recordBrowserPrincipal(userId: string | null | undefined): void {
  const next = typeof userId === "string" ? normaliseUserId(userId) : userId;
  if (next === activeBrowserPrincipal && next !== undefined) return;

  retirePrincipalEpoch();
  activeBrowserPrincipal = next;

  // Provider teardown/uninitialised state is never a permissive owner state.
  if (next === undefined) {
    principalController.abort(new OwnerDispatchError());
  }
}

function combinedSignal(principalSignal: AbortSignal, callerSignal?: AbortSignal): AbortSignal {
  if (!callerSignal || callerSignal === principalSignal) return principalSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([principalSignal, callerSignal]);
  }

  // Some supported browser/test runtimes implement AbortController without
  // AbortSignal.any. Preserve the first abort reason and detach both listeners
  // as soon as either source wins.
  const controller = new AbortController();
  const cleanup = () => {
    principalSignal.removeEventListener("abort", abortFromPrincipal);
    callerSignal.removeEventListener("abort", abortFromCaller);
  };
  const abortFrom = (source: AbortSignal) => {
    cleanup();
    if (!controller.signal.aborted) {
      controller.abort(source.reason ?? new OwnerDispatchError());
    }
  };
  const abortFromPrincipal = () => abortFrom(principalSignal);
  const abortFromCaller = () => abortFrom(callerSignal);

  if (principalSignal.aborted) abortFromPrincipal();
  else if (callerSignal.aborted) abortFromCaller();
  else {
    principalSignal.addEventListener("abort", abortFromPrincipal, { once: true });
    callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  return controller.signal;
}

/** Capture once, synchronously, before an owner action performs any await. */
export function captureOwnerDispatch(
  expectedUserId: string,
  callerSignal?: AbortSignal,
): OwnerDispatchLease {
  const expected = normaliseUserId(expectedUserId);
  if (!expected || activeBrowserPrincipal !== expected || principalController.signal.aborted) {
    throw new OwnerDispatchError();
  }

  const capturedEpoch = principalEpoch;
  const signal = combinedSignal(principalController.signal, callerSignal);
  const assertCurrent = () => {
    if (
      signal.aborted ||
      activeBrowserPrincipal !== expected ||
      principalEpoch !== capturedEpoch
    ) {
      const reason = signal.reason;
      if (reason instanceof Error) throw reason;
      throw new OwnerDispatchError();
    }
  };

  return {
    expectedUserId: expected,
    principalEpoch: capturedEpoch,
    signal,
    assertCurrent,
  };
}

export function ownerDispatchIsCurrent(lease: OwnerDispatchLease): boolean {
  try {
    lease.assertCurrent();
    return true;
  } catch {
    return false;
  }
}

/** Adds a timeout or user-cancel signal without recapturing mutable identity. */
export function withOwnerDispatchSignal(
  lease: OwnerDispatchLease,
  callerSignal: AbortSignal,
): OwnerDispatchLease {
  lease.assertCurrent();
  const signal = combinedSignal(lease.signal, callerSignal);
  return {
    expectedUserId: lease.expectedUserId,
    principalEpoch: lease.principalEpoch,
    signal,
    assertCurrent: () => {
      lease.assertCurrent();
      if (signal.aborted) {
        const reason = signal.reason;
        if (reason instanceof Error) throw reason;
        throw new OwnerDispatchError();
      }
    },
  };
}

export function browserPrincipalMatchesOwnerEpoch(ownerEpoch: string): boolean {
  if (ownerEpoch.startsWith("user:")) {
    const expected = normaliseUserId(ownerEpoch.slice("user:".length));
    return Boolean(expected) && activeBrowserPrincipal === expected;
  }
  if (ownerEpoch.startsWith("guest:")) {
    return ownerEpoch.length > "guest:".length && activeBrowserPrincipal === null;
  }
  return false;
}
