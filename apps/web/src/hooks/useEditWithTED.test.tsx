import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mockEditSectionStream = vi.fn();
const mockApply = vi.fn();
const mockDiscard = vi.fn();
const mockRecover = vi.fn();
const authState = vi.hoisted(() => ({
  userId: "33333333-3333-4333-8333-333333333333",
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return {
    ...actual,
    editSectionStream: (...args: unknown[]) => mockEditSectionStream(...args),
  };
});

vi.mock("@/lib/api", () => ({ ensureApiConfigured: vi.fn() }));
vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: authState.userId } }),
}));
vi.mock("@/lib/api/sections", () => ({
  applyLegacySectionEdit: (...args: unknown[]) => mockApply(...args),
  discardLegacySectionEdit: (...args: unknown[]) => mockDiscard(...args),
  fetchLatestLegacySectionEdit: (...args: unknown[]) => mockRecover(...args),
}));

import {
  purgeEditOperationIdentitiesForUser,
  type EditRunResult,
  useEditWithTED,
} from "./useEditWithTED";

const persistence = {
  userId: "33333333-3333-4333-8333-333333333333",
  documentId: "11111111-1111-4111-8111-111111111111",
  sectionId: "22222222-2222-4222-8222-222222222222",
  expectedSectionRevision: 3,
};

beforeEach(() => {
  authState.userId = persistence.userId;
  recordBrowserPrincipal(persistence.userId);
  vi.useRealTimers();
  purgeEditOperationIdentitiesForUser(persistence.userId);
  purgeEditOperationIdentitiesForUser("77777777-7777-4777-8777-777777777777");
  sessionStorage.clear();
  mockEditSectionStream.mockReset();
  mockApply.mockReset();
  mockDiscard.mockReset();
  mockRecover.mockReset();
});

afterEach(() => recordBrowserPrincipal(undefined));

function success() {
  return async (
    input: { persistence?: { operation_id: string } },
    onDelta: (value: string) => void,
    onChanges: (value: string[]) => void,
  ) => {
    onDelta("Revised wording.");
    onChanges(["Clarified wording."]);
    return {
      operation: null,
      result: {
        type: "result",
        operation_id: input.persistence!.operation_id,
        accepted_section_revision: 3,
        result_sha256: "a".repeat(64),
        applied_candidate_content: "<p>Revised wording.</p>",
        applied_candidate_sha256: "c".repeat(64),
        state: "ready",
        idempotent_replay: false,
      },
    };
  };
}

describe("useEditWithTED durable identity", () => {
  it("reuses one operation UUID after a lost response and changes it only after discard", async () => {
    const seen: string[] = [];
    mockEditSectionStream
      .mockImplementationOnce(async (input: { persistence: { operation_id: string } }) => {
        seen.push(input.persistence.operation_id);
        throw new TypeError("response lost");
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        const input = args[0] as { persistence: { operation_id: string } };
        seen.push(input.persistence.operation_id);
        return success()(...(args as Parameters<ReturnType<typeof success>>));
      })
      .mockImplementationOnce(success());
    mockDiscard.mockResolvedValue({ state: "discarded" });
    const { result } = renderHook(() => useEditWithTED());
    const request = {
      action: "improve" as const,
      content: "<p>Unique retry wording.</p>",
      persistence,
    };

    await act(async () => {
      expect(await result.current.run(request)).toBeNull();
    });
    const completed: { value: EditRunResult | null } = { value: null };
    await act(async () => {
      completed.value = await result.current.run(request);
    });
    expect(completed.value?.persisted?.operationId).toBe(seen[0]);
    expect(seen[1]).toBe(seen[0]);

    await act(async () => {
      expect(await result.current.discardPersisted(completed.value!.persisted!)).toBe(true);
    });
    let newAttempt: EditRunResult | null = null;
    await act(async () => {
      newAttempt = await result.current.run(request);
    });
    const newId = (
      mockEditSectionStream.mock.calls[2]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    expect(newId).not.toBe(seen[0]);
    await act(async () => {
      await result.current.discardPersisted(newAttempt!.persisted!);
    });
  });

  it("passes exact CAS identity to Apply and returns the authoritative revision", async () => {
    mockApply.mockResolvedValue({
      operation_id: "operation",
      section_id: persistence.sectionId,
      section_revision: 4,
      idempotent_replay: false,
    });
    const { result } = renderHook(() => useEditWithTED());
    const identity = {
      operationId: "33333333-3333-4333-8333-333333333333",
      acceptedSectionRevision: 3,
      resultSha256: "b".repeat(64),
      appliedCandidateContent: "<p>Applied.</p>",
      appliedCandidateSha256: "c".repeat(64),
      requestFingerprint: null,
    };
    let applied = null;
    await act(async () => {
      applied = await result.current.applyPersisted(identity);
    });
    expect(mockApply).toHaveBeenCalledWith(
      {
        operationId: identity.operationId,
        expectedSectionRevision: 3,
        resultSha256: identity.resultSha256,
        content: identity.appliedCandidateContent,
      },
      expect.objectContaining({ expectedUserId: persistence.userId }),
    );
    expect(applied).toMatchObject({ section_revision: 4 });
  });

  it("reads a recoverable suggestion by section without exposing another API", async () => {
    mockRecover.mockResolvedValue({ state: "discarded", recoverable: false });
    const { result } = renderHook(() => useEditWithTED());
    await act(async () => {
      expect(await result.current.recover(persistence.sectionId)).toMatchObject({
        state: "discarded",
      });
    });
    expect(mockRecover).toHaveBeenCalledWith(
      persistence.sectionId,
      expect.objectContaining({ expectedUserId: persistence.userId }),
    );
  });

  it("uses a new operation identity after an exact terminal replay", async () => {
    const seen: string[] = [];
    mockEditSectionStream
      .mockImplementationOnce(async (input: { persistence: { operation_id: string } }) => {
        seen.push(input.persistence.operation_id);
        throw { code: "LEGACY_SECTION_EDIT_TERMINAL_FAILURE" };
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        const input = args[0] as { persistence: { operation_id: string } };
        seen.push(input.persistence.operation_id);
        return success()(...(args as Parameters<ReturnType<typeof success>>));
      });
    mockDiscard.mockResolvedValue({ state: "discarded" });
    const { result } = renderHook(() => useEditWithTED());
    const request = {
      action: "improve" as const,
      content: "<p>Retry after terminal state.</p>",
      persistence,
    };

    await act(async () => {
      expect(await result.current.run(request)).toBeNull();
    });
    let completed: EditRunResult | null = null;
    await act(async () => {
      completed = await result.current.run(request);
      expect(completed).not.toBeNull();
    });

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
    await act(async () => {
      await result.current.discardPersisted(completed!.persisted!);
    });
  });

  it("scopes retained retry identities to the authenticated owner", async () => {
    mockEditSectionStream.mockImplementation(success());
    mockDiscard.mockResolvedValue({ state: "discarded" });
    const { result, rerender } = renderHook(() => useEditWithTED());
    const request = {
      action: "improve" as const,
      content: "<p>Same visible wording.</p>",
      persistence,
    };

    let first: EditRunResult | null = null;
    let second: EditRunResult | null = null;
    await act(async () => {
      first = await result.current.run(request);
    });
    authState.userId = "77777777-7777-4777-8777-777777777777";
    recordBrowserPrincipal(authState.userId);
    act(() => rerender());
    await act(async () => {
      second = await result.current.run({
        ...request,
        persistence: {
          ...persistence,
          userId: "77777777-7777-4777-8777-777777777777",
        },
      });
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const firstId = (
      mockEditSectionStream.mock.calls[0]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    const secondId = (
      mockEditSectionStream.mock.calls[1]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    expect(secondId).not.toBe(firstId);
    purgeEditOperationIdentitiesForUser(persistence.userId);
    purgeEditOperationIdentitiesForUser(authState.userId);
  });

  it("purges volatile and stored retry identities for only the deleted owner", async () => {
    mockEditSectionStream.mockImplementation(success());
    const { result, rerender } = renderHook(() => useEditWithTED());
    const request = {
      action: "improve" as const,
      content: "<p>Owner-bound wording.</p>",
      persistence,
    };
    await act(async () => {
      await result.current.run(request);
    });
    authState.userId = "77777777-7777-4777-8777-777777777777";
    recordBrowserPrincipal(authState.userId);
    act(() => rerender());
    await act(async () => {
      await result.current.run({
        ...request,
        persistence: {
          ...persistence,
          userId: "77777777-7777-4777-8777-777777777777",
        },
      });
    });
    const ownerAFirst = mockEditSectionStream.mock.calls[0]![0].persistence.operation_id;
    const ownerBFirst = mockEditSectionStream.mock.calls[1]![0].persistence.operation_id;

    expect(purgeEditOperationIdentitiesForUser(persistence.userId)).toBe(true);
    authState.userId = persistence.userId;
    recordBrowserPrincipal(authState.userId);
    act(() => rerender());
    await act(async () => {
      await result.current.run(request);
    });
    authState.userId = "77777777-7777-4777-8777-777777777777";
    recordBrowserPrincipal(authState.userId);
    act(() => rerender());
    await act(async () => {
      await result.current.run({
        ...request,
        persistence: {
          ...persistence,
          userId: "77777777-7777-4777-8777-777777777777",
        },
      });
    });
    expect(mockEditSectionStream.mock.calls[2]![0].persistence.operation_id).not.toBe(ownerAFirst);
    expect(mockEditSectionStream.mock.calls[3]![0].persistence.operation_id).toBe(ownerBFirst);
    purgeEditOperationIdentitiesForUser(persistence.userId);
    purgeEditOperationIdentitiesForUser("77777777-7777-4777-8777-777777777777");
  });

  it("retains an unresolved durable UUID beyond the former browser TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    mockEditSectionStream.mockImplementation(success());
    mockDiscard.mockResolvedValue({ state: "discarded" });
    const { result } = renderHook(() => useEditWithTED());
    const request = {
      action: "improve" as const,
      content: "<p>TTL-scoped wording.</p>",
      persistence,
    };

    let completed: EditRunResult | null = null;
    await act(async () => {
      completed = await result.current.run(request);
      expect(completed).not.toBeNull();
    });
    vi.setSystemTime(new Date("2026-09-02T00:00:01.000Z"));
    await act(async () => {
      expect(await result.current.run(request)).not.toBeNull();
    });

    const firstId = (
      mockEditSectionStream.mock.calls[0]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    const secondId = (
      mockEditSectionStream.mock.calls[1]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    expect(secondId).toBe(firstId);
    await act(async () => {
      await result.current.discardPersisted(completed!.persisted!);
    });
  });

  it("retains a cancelled UUID through remount and blocks UUID B until durable terminal recovery", async () => {
    const seen: string[] = [];
    let inFlight: Promise<EditRunResult | null> | null = null;
    let markStreamStarted: (() => void) | null = null;
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve;
    });
    mockEditSectionStream.mockImplementationOnce(
      async (
        input: { persistence: { operation_id: string } },
        _onDelta: unknown,
        _onChanges: unknown,
        requestContext: { signal: AbortSignal },
      ) => {
        seen.push(input.persistence.operation_id);
        return await new Promise((_resolve, reject) => {
          if (requestContext.signal.aborted) {
            reject(requestContext.signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          requestContext.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          markStreamStarted?.();
        });
      },
    );
    const firstHook = renderHook(() => useEditWithTED());
    const request = {
      action: "improve" as const,
      content: "<p>Cancellation-bound wording.</p>",
      persistence,
    };

    await act(async () => {
      inFlight = firstHook.result.current.run(request);
      await streamStarted;
    });
    await waitFor(() => expect(firstHook.result.current.streaming).toBe(true));
    await act(async () => {
      firstHook.result.current.cancel();
      await inFlight;
    });
    expect(firstHook.result.current.error).toContain("Cancellation requested");
    const operationA = seen[0]!;
    firstHook.unmount();

    mockRecover
      .mockResolvedValueOnce({
        state: "provider_dispatched",
        operation_id: operationA,
        recoverable: false,
      })
      .mockResolvedValueOnce({
        state: "terminal_failure",
        operation_id: operationA,
        terminal_code: "OPENAI_KEY_UNAVAILABLE",
        recoverable: false,
      });
    const remounted = renderHook(() => useEditWithTED());
    await act(async () => {
      expect(await remounted.result.current.recover(persistence.sectionId)).toMatchObject({
        state: "provider_dispatched",
        operation_id: operationA,
      });
    });
    await act(async () => {
      expect(
        await remounted.result.current.run({
          ...request,
          instruction: "This would otherwise mint UUID B.",
        }),
      ).toBeNull();
    });
    expect(mockEditSectionStream).toHaveBeenCalledTimes(1);
    expect(remounted.result.current.error).toContain("reconciling");

    await act(async () => {
      expect(await remounted.result.current.recover(persistence.sectionId)).toMatchObject({
        state: "terminal_failure",
      });
    });
    mockEditSectionStream.mockImplementationOnce(success());
    mockDiscard.mockResolvedValue({ state: "discarded" });
    let newAttempt: EditRunResult | null = null;
    await act(async () => {
      newAttempt = await remounted.result.current.run({
        ...request,
        instruction: "Explicit new attempt after terminal truth.",
      });
    });
    const operationB = (
      mockEditSectionStream.mock.calls[1]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    expect(operationB).not.toBe(operationA);
    await act(async () => {
      await remounted.result.current.discardPersisted(newAttempt!.persisted!);
    });
  });

  it("fails a mocked malformed durable candidate closed before Apply identity", async () => {
    mockEditSectionStream.mockImplementation(
      async (
        input: { persistence: { operation_id: string } },
        onDelta: (value: string) => void,
      ) => {
        onDelta("Unbound wording.");
        return {
          operation: null,
          result: {
            type: "result",
            operation_id: input.persistence.operation_id,
            accepted_section_revision: 3,
            result_sha256: "a".repeat(64),
            applied_candidate_content: "",
            applied_candidate_sha256: "c".repeat(64),
            state: "ready",
            idempotent_replay: false,
          },
        };
      },
    );
    const { result } = renderHook(() => useEditWithTED());
    const completed: { value: EditRunResult | null } = { value: null };
    await act(async () => {
      completed.value = await result.current.run({
        action: "improve",
        content: "<p>Malformed durable result.</p>",
        persistence,
      });
    });
    expect(completed.value?.content).toBe("Unbound wording.");
    expect(completed.value?.persisted).toBeNull();

    const operationId = (
      mockEditSectionStream.mock.calls[0]![0] as {
        persistence: { operation_id: string };
      }
    ).persistence.operation_id;
    mockRecover.mockResolvedValue({
      state: "terminal_failure",
      operation_id: operationId,
      recoverable: false,
    });
    await act(async () => {
      await result.current.recover(persistence.sectionId);
    });
  });
});
