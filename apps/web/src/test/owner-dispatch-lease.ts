import type { OwnerDispatchLease } from "@/lib/browser-principal-state";

/** Immutable owner context for unit tests that mock the authenticated transport. */
export function testOwnerDispatchLease(
  expectedUserId = "00000000-0000-4000-8000-000000000001",
): OwnerDispatchLease {
  const signal = new AbortController().signal;
  return {
    expectedUserId: expectedUserId.trim().toLowerCase(),
    principalEpoch: 1,
    signal,
    assertCurrent: () => undefined,
  };
}
