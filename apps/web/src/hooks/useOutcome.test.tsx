import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INTAKE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-8333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  upsert: vi.fn(),
  commit: vi.fn(),
  reconcileCommit: vi.fn(),
  getIntake: vi.fn(),
  savePending: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: USER_ID } }),
}));
vi.mock("@/lib/api/outcomes", () => ({
  upsertOutcome: (...args: unknown[]) => mocks.upsert(...args),
}));
vi.mock("@/lib/api/home-intakes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/home-intakes")>(
    "@/lib/api/home-intakes",
  );
  return {
    ...actual,
    commitHomeUploadIntake: (...args: unknown[]) => mocks.commit(...args),
    reconcileHomeUploadIntakeCommit: (...args: unknown[]) => mocks.reconcileCommit(...args),
    getHomeUploadIntake: (...args: unknown[]) => mocks.getIntake(...args),
  };
});
vi.mock("@/lib/workspace-store", () => ({
  currentWorkspaceCacheScope: (userId: string) => ({ kind: "user", userId }),
  savePendingOutcome: (...args: unknown[]) => mocks.savePending(...args),
}));

import { useOutcome } from "./useOutcome";
import { HomeUploadIntakeError } from "@/lib/api/home-intakes";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useOutcome durable Home commit", () => {
  beforeEach(() => {
    recordBrowserPrincipal(USER_ID);
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.upsert.mockResolvedValue(undefined);
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("waits for the atomic intake receipt before caching or navigating", async () => {
    const pending = deferred<{
      outcomeId: string;
      situation: string;
      templateId: string;
      templateName: string;
      uploadId: string;
      uploadContext: string;
    }>();
    mocks.commit.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useOutcome());
    let confirmation!: Promise<string>;

    act(() => {
      confirmation = result.current.confirm({
        situation: "Improve my resume",
        templateName: "Resume",
        uploadId: UPLOAD_ID,
        uploadContext: "USER CORRECTED",
        conversationContext: "TED: I can help.",
        conversation: [{ role: "user", text: "Improve my resume" }],
        homeUploadIntake: {
          intakeId: INTAKE_ID,
          uploadId: UPLOAD_ID,
          expectedRevision: 2,
          confirmedText: "USER CORRECTED",
        },
      });
    });

    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.savePending).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    const input = mocks.commit.mock.calls[0]?.[0] as {
      confirmedText: string;
      recommendationPayload: {
        primary: { template_id: string; reason: string };
      };
    };
    expect(input.confirmedText).toBe("USER CORRECTED");
    pending.resolve({
      outcomeId: INTAKE_ID,
      situation: "Improve my resume",
      templateId: input.recommendationPayload.primary.template_id,
      templateName: input.recommendationPayload.primary.reason,
      uploadId: UPLOAD_ID,
      uploadContext: "USER CORRECTED",
    });

    await expect(confirmation).resolves.toBe(INTAKE_ID);
    expect(mocks.savePending).toHaveBeenCalledWith(
      { kind: "user", userId: USER_ID },
      INTAKE_ID,
      expect.objectContaining({
        situation: "Improve my resume",
        uploadId: UPLOAD_ID,
        uploadContext: "USER CORRECTED",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/outcomes/${INTAKE_ID}`);
  });

  it("preserves ordinary outcome creation without an explicit intake handle", async () => {
    const { result } = renderHook(() => useOutcome());

    await act(async () => {
      await result.current.confirm({
        situation: "Write a complaint",
        templateName: "Complaint Letter",
      });
    });

    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.savePending).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("reconciles an ambiguous commit acknowledgement by replaying the exact command", async () => {
    const ambiguity = new HomeUploadIntakeError(
      "HOME_UPLOAD_INTAKE_ACKNOWLEDGEMENT_UNKNOWN",
      true,
    );
    mocks.commit.mockRejectedValue(ambiguity);
    mocks.reconcileCommit.mockResolvedValue({
      outcomeId: INTAKE_ID,
      situation: "Improve my resume",
      templateId: "resume",
      templateName: "Resume",
      uploadId: UPLOAD_ID,
      uploadContext: "USER CORRECTED",
      conversationContext: "",
    });
    const { result } = renderHook(() => useOutcome());

    await expect(result.current.confirm({
      situation: "Improve my resume",
      templateName: "Resume",
      uploadId: UPLOAD_ID,
      uploadContext: "Decorated model context",
      homeUploadIntake: {
        intakeId: INTAKE_ID,
        uploadId: UPLOAD_ID,
        expectedRevision: 2,
        confirmedText: "USER CORRECTED",
      },
    })).resolves.toBe(INTAKE_ID);

    expect(mocks.reconcileCommit).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileCommit.mock.calls[0]?.[0]).toEqual(
      mocks.commit.mock.calls[0]?.[0],
    );
    expect(mocks.getIntake).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.savePending).toHaveBeenCalledWith(
      { kind: "user", userId: USER_ID },
      INTAKE_ID,
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        uploadContext: "USER CORRECTED",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/outcomes/${INTAKE_ID}`);
  });

  it("preserves ambiguity when the exact command replay remains unresolved", async () => {
    const ambiguity = new HomeUploadIntakeError(
      "HOME_UPLOAD_INTAKE_ACKNOWLEDGEMENT_UNKNOWN",
      true,
    );
    mocks.commit.mockRejectedValue(ambiguity);
    mocks.reconcileCommit.mockRejectedValue(ambiguity);
    const { result } = renderHook(() => useOutcome());

    await expect(result.current.confirm({
      situation: "Improve my resume",
      templateName: "Resume",
      uploadId: UPLOAD_ID,
      homeUploadIntake: {
        intakeId: INTAKE_ID,
        uploadId: UPLOAD_ID,
        expectedRevision: 2,
        confirmedText: "USER CORRECTED",
      },
    })).rejects.toBe(ambiguity);

    expect(mocks.reconcileCommit).toHaveBeenCalledTimes(1);
    expect(mocks.getIntake).not.toHaveBeenCalled();
    expect(mocks.savePending).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
