import { afterEach, describe, expect, it } from "vitest";
import {
  OwnerDispatchError,
  browserPrincipalMatchesOwnerEpoch,
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  recordBrowserPrincipal,
} from "./browser-principal-state";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => recordBrowserPrincipal(undefined));

describe("owner dispatch leases", () => {
  it("preserves the epoch for a same-account token refresh", () => {
    recordBrowserPrincipal(USER_A);
    const lease = captureOwnerDispatch(USER_A);

    recordBrowserPrincipal(USER_A);

    expect(ownerDispatchIsCurrent(lease)).toBe(true);
    expect(lease.signal.aborted).toBe(false);
  });

  it("aborts and rejects an old lease when the account changes", () => {
    recordBrowserPrincipal(USER_A);
    const lease = captureOwnerDispatch(USER_A);

    recordBrowserPrincipal(USER_B);

    expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assertCurrent()).toThrow(OwnerDispatchError);
  });

  it("detects an A to B to A transition with the monotonic epoch", () => {
    recordBrowserPrincipal(USER_A);
    const staleA = captureOwnerDispatch(USER_A);
    recordBrowserPrincipal(USER_B);
    recordBrowserPrincipal(USER_A);

    expect(ownerDispatchIsCurrent(staleA)).toBe(false);
    expect(ownerDispatchIsCurrent(captureOwnerDispatch(USER_A))).toBe(true);
  });

  it("fails closed while the provider principal is unavailable", () => {
    recordBrowserPrincipal(USER_A);
    const lease = captureOwnerDispatch(USER_A);

    recordBrowserPrincipal(undefined);

    expect(lease.signal.aborted).toBe(true);
    expect(() => captureOwnerDispatch(USER_A)).toThrow(OwnerDispatchError);
    expect(browserPrincipalMatchesOwnerEpoch(`user:${USER_A}`)).toBe(false);
    expect(browserPrincipalMatchesOwnerEpoch("owner-unavailable")).toBe(false);
  });

  it("combines caller cancellation with principal cancellation", () => {
    recordBrowserPrincipal(USER_A);
    const caller = new AbortController();
    const lease = captureOwnerDispatch(USER_A, caller.signal);

    caller.abort(new DOMException("Cancelled", "AbortError"));

    expect(lease.signal.aborted).toBe(true);
    expect(ownerDispatchIsCurrent(lease)).toBe(false);
  });
});
