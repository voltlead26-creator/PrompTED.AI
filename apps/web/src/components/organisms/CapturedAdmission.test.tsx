import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ApiError } from "@prompted/shared/api-client";
import { CapturedAdmission as CapturedAdmissionImplementation } from "./CapturedAdmission";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const OWNER_USER_ID = "11111111-1111-4111-8111-111111111111";

function ownerLeaseMatcher() {
  return expect.objectContaining({
    expectedUserId: OWNER_USER_ID,
    signal: expect.any(AbortSignal),
    assertCurrent: expect.any(Function),
  });
}

function CapturedAdmission(
  props: Omit<ComponentProps<typeof CapturedAdmissionImplementation>, "ownerUserId">,
) {
  return <CapturedAdmissionImplementation ownerUserId={OWNER_USER_ID} {...props} />;
}

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  reconnect: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

vi.mock("@prompted/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prompted/shared/api-client")>();
  return {
    ...actual,
    startCapturedDocumentOperation: mocks.start,
    resumeCapturedDocumentOperation: mocks.resume,
    cancelCapturedDocumentOperation: mocks.cancel,
    getCapturedDocumentOperation: mocks.reconnect,
  };
});

vi.mock("@/lib/api", () => ({ ensureApiConfigured: vi.fn() }));

describe("CapturedAdmission", () => {
  beforeEach(() => {
    recordBrowserPrincipal(OWNER_USER_ID);
    sessionStorage.clear();
    mocks.start.mockReset();
    mocks.resume.mockReset();
    mocks.cancel.mockReset();
    mocks.reconnect.mockReset();
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it.each(["CAPTURED_ACTIVATION_DISABLED", "CAPTURED_ROLLOUT_NOT_ASSIGNED"])(
    "asks no more than three questions at once and falls back only before admission for %s",
    async (fallbackCode) => {
      const onLegacyFallback = vi.fn();
      mocks.start.mockRejectedValue(
        new ApiError(409, fallbackCode, {
          error: { code: fallbackCode },
          retryable: false,
        }),
      );
      render(
        <CapturedAdmission
          outcomeId="22222222-2222-4222-8222-222222222222"
          templateId="complaint-letter"
          title="Complaint Letter"
          onLegacyFallback={onLegacyFallback}
        />,
      );

      expect(screen.getAllByRole("textbox")).toHaveLength(3);
      await userEvent.type(
        screen.getByLabelText(/Recipient person or organisation/),
        "Synthetic Energy Co",
      );
      await userEvent.type(
        screen.getByLabelText(/Confirmed issue facts and timing/),
        "A synthetic invoice was charged twice on 30 August.",
      );
      await userEvent.type(
        screen.getByLabelText(/Requested resolution/),
        "Reverse the duplicate charge.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.getAllByRole("textbox")).toHaveLength(2);
      await userEvent.click(screen.getByRole("button", { name: "Generate from confirmed facts" }));

      expect(mocks.start).toHaveBeenCalledWith(
        expect.objectContaining({
          template_id: "complaint-letter",
          input_values: expect.objectContaining({
            recipient_name: "Synthetic Energy Co",
            desired_outcome: "Reverse the duplicate charge.",
          }),
        }),
        ownerLeaseMatcher(),
      );
      expect(onLegacyFallback).toHaveBeenCalledOnce();
      expect(
        sessionStorage.getItem("prompted:captured-admission:22222222-2222-4222-8222-222222222222"),
      ).toBeNull();
    },
  );

  it("cancels an immutable clarification-blocked operation before starting a successor with preserved facts", async () => {
    const firstOperationId = "55555555-5555-4555-8555-555555555555";
    const secondOperationId = "66666666-6666-4666-8666-666666666666";
    const submittedBodies: Array<Record<string, unknown>> = [];
    mocks.start
      .mockImplementationOnce(async (request: Record<string, unknown>) => {
        submittedBodies.push(request);
        return {
          operation_id: firstOperationId,
          document_id: request.document_id,
          operation_revision: 4,
          status: "awaiting_clarification",
          retryable: true,
          questions: [
            {
              input_key: "issue_facts",
              question: "Confirm the exact issue timing.",
            },
          ],
        };
      })
      .mockImplementationOnce(async (request: Record<string, unknown>) => {
        submittedBodies.push(request);
        return {
          operation_id: secondOperationId,
          document_id: request.document_id,
          operation_revision: 1,
          status: "retryable_failure",
          retryable: true,
        };
      });
    mocks.cancel.mockResolvedValue({
      operation_id: firstOperationId,
      operation_revision: 5,
      status: "cancelled",
      idempotent_replay: false,
      retryable: false,
    });
    mocks.reconnect.mockImplementation(async (operationId: string) => ({
      operation_id: operationId,
      document_id: String(submittedBodies.at(-1)?.document_id),
      operation_revision: 1,
      status: "retryable_failure",
      retryable: true,
    }));

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="complaint-letter"
        title="Complaint Letter"
        onLegacyFallback={() => undefined}
      />,
    );

    await userEvent.type(
      screen.getByLabelText(/Recipient person or organisation/),
      "Synthetic Energy Co",
    );
    await userEvent.type(
      screen.getByLabelText(/Confirmed issue facts and timing/),
      "A synthetic invoice was charged twice on 30 August.",
    );
    await userEvent.type(
      screen.getByLabelText(/Requested resolution/),
      "Reverse the duplicate charge.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate from confirmed facts" }));

    expect(await screen.findByText("Confirm the exact issue timing.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Generate from confirmed facts" }));

    expect(mocks.cancel).toHaveBeenCalledWith(
      {
        operation_id: firstOperationId,
        expected_operation_revision: 4,
        cancellation_code: "owner_cancelled",
      },
      ownerLeaseMatcher(),
    );
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(submittedBodies[1]?.document_id).not.toBe(submittedBodies[0]?.document_id);
    expect(submittedBodies[1]?.generation_request_id).not.toBe(
      submittedBodies[0]?.generation_request_id,
    );
    expect(submittedBodies[1]?.input_values).toEqual(submittedBodies[0]?.input_values);
    expect(
      await screen.findByRole("heading", {
        name: "The operation can be resumed safely",
      }),
    ).toBeInTheDocument();
  });

  it("renders an accessible confirmed-facts gate", async () => {
    const { container } = render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        onLegacyFallback={() => undefined}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reconnects from persisted operation truth without showing an empty intake", async () => {
    const initialOperation = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 7,
      status: "generating",
      retryable: false,
      message: "The accepted operation is still drafting.",
      safe_next_action: "Keep this page open or reconnect later.",
    };
    mocks.reconnect.mockResolvedValue(initialOperation);

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={initialOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "TED is drafting from your confirmed facts" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(initialOperation.safe_next_action)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume this operation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check latest status" })).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.reconnect).toHaveBeenCalledWith(
        initialOperation.operation_id,
        ownerLeaseMatcher(),
      );
    });
    expect(
      sessionStorage.getItem("prompted:captured-admission:22222222-2222-4222-8222-222222222222"),
    ).toBeNull();
  });

  it("resumes a persisted retryable operation after reload using durable identity only", async () => {
    const outcomeId = "22222222-2222-4222-8222-222222222222";
    const operationId = "55555555-5555-4555-8555-555555555555";
    const documentId = "33333333-3333-4333-8333-333333333333";
    const retryableOperation = {
      operation_id: operationId,
      document_id: documentId,
      operation_revision: 7,
      status: "retryable_failure",
      retryable: true,
      safe_next_action: "Resume this exact operation.",
    };
    mocks.reconnect.mockResolvedValue(retryableOperation);
    mocks.resume.mockResolvedValue({
      ...retryableOperation,
      operation_revision: 8,
      status: "generating",
      retryable: false,
    });

    render(
      <CapturedAdmission
        outcomeId={outcomeId}
        templateId="resume"
        title="Resume"
        initialOperation={retryableOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Resume this operation" }));
    expect(mocks.resume).toHaveBeenCalledWith(
      { action: "resume", operation_id: operationId },
      ownerLeaseMatcher(),
    );
  });

  it("offers same-operation recovery after the server declares an active worker lease stale", async () => {
    const operationId = "55555555-5555-4555-8555-555555555555";
    const strandedOperation = {
      operation_id: operationId,
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 9,
      status: "generating",
      retryable: false,
      resume_available: true,
      lease_expires_at: "2026-09-01T00:00:00.000Z",
    };
    mocks.reconnect.mockResolvedValue(strandedOperation);
    mocks.resume.mockResolvedValue({
      ...strandedOperation,
      operation_revision: 10,
      resume_available: false,
      lease_expires_at: "2026-09-01T00:05:00.000Z",
    });

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={strandedOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Resume this operation" }));
    expect(mocks.resume).toHaveBeenCalledWith(
      { action: "resume", operation_id: operationId },
      ownerLeaseMatcher(),
    );
  });

  it("offers the same operation when its durable capacity retry becomes available", async () => {
    const operationId = "55555555-5555-4555-8555-555555555555";
    const capacityOperation = {
      operation_id: operationId,
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 9,
      status: "awaiting_capacity",
      retryable: true,
      resume_available: true,
      retry_after_seconds: 0,
      capacity_retry_after_at: "2026-09-01T00:00:00.000Z",
      safe_next_action: "Resume this same operation.",
    };
    mocks.reconnect.mockResolvedValue(capacityOperation);
    mocks.resume.mockResolvedValue({
      ...capacityOperation,
      operation_revision: 10,
      status: "generating",
      retryable: false,
      resume_available: false,
    });

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={capacityOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    expect(screen.getByText(/The retry window is open/)).toBeInTheDocument();
    expect(screen.queryByText(/capacity is available/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Resume this operation" }));
    expect(mocks.resume).toHaveBeenCalledWith(
      { action: "resume", operation_id: operationId },
      ownerLeaseMatcher(),
    );
  });

  it("records durable cancellation against the visible operation revision", async () => {
    const outcomeId = "22222222-2222-4222-8222-222222222222";
    const initialOperation = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 7,
      status: "generating",
      retryable: false,
    };
    mocks.reconnect.mockResolvedValue(initialOperation);
    mocks.cancel.mockResolvedValue({
      operation_id: "55555555-5555-4555-8555-555555555555",
      operation_revision: 8,
      status: "cancelled",
      idempotent_replay: false,
      reconnect: "/api/document-operation?operation_id=55555555-5555-4555-8555-555555555555",
      retryable: false,
    });

    render(
      <CapturedAdmission
        outcomeId={outcomeId}
        templateId="resume"
        title="Resume"
        initialOperation={initialOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    await screen.findByRole("heading", { name: /TED is drafting/ });
    await userEvent.click(screen.getByRole("button", { name: "Cancel this operation" }));

    expect(mocks.cancel).toHaveBeenCalledWith(
      {
        operation_id: "55555555-5555-4555-8555-555555555555",
        expected_operation_revision: 7,
        cancellation_code: "owner_cancelled",
      },
      ownerLeaseMatcher(),
    );
    expect(
      await screen.findByRole("heading", { name: "The operation was cancelled" }),
    ).toBeInTheDocument();
  });

  it("shows cancellation intent while an in-flight attempt is reconciled", async () => {
    const initialOperation = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 7,
      status: "generating",
      retryable: false,
    };
    mocks.reconnect.mockResolvedValue(initialOperation);
    mocks.cancel.mockResolvedValue({
      ...initialOperation,
      operation_revision: 8,
      cancellation_requested: true,
      idempotent_replay: false,
      reconnect: "/api/document-operation?operation_id=55555555-5555-4555-8555-555555555555",
    });

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={initialOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel this operation" }));

    expect(await screen.findByText(/Cancellation is recorded and pending/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel this operation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check latest status" })).toBeInTheDocument();
  });

  it("does not let a delayed reconnect overwrite a newer operation revision", async () => {
    const cancelledOperation = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 8,
      status: "cancelled",
      retryable: false,
    };
    mocks.reconnect.mockResolvedValue({
      ...cancelledOperation,
      operation_revision: 7,
      status: "generating",
    });

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={cancelledOperation}
        onLegacyFallback={() => undefined}
      />,
    );

    await waitFor(() => expect(mocks.reconnect).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("heading", { name: "The operation was cancelled" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume this operation" })).toBeNull();
  });

  it("does not let a delayed operation-A reconnect overwrite newer operation B", async () => {
    const operationAId = "55555555-5555-4555-8555-555555555555";
    const operationBId = "66666666-6666-4666-8666-666666666666";
    const delayedOperationA = deferred<{
      operation_id: string;
      document_id: string;
      operation_revision: number;
      status: string;
      retryable: boolean;
    }>();
    const operationA = {
      operation_id: operationAId,
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 8,
      status: "cancelled",
      retryable: false,
    };
    const operationB = {
      operation_id: operationBId,
      document_id: "44444444-4444-4444-8444-444444444444",
      operation_revision: 1,
      status: "retryable_failure",
      retryable: true,
    };
    mocks.reconnect.mockImplementation((operationId: string) =>
      operationId === operationAId ? delayedOperationA.promise : Promise.resolve(operationB),
    );
    mocks.start.mockImplementation(async (request: Record<string, unknown>) => ({
      ...operationB,
      document_id: String(request.document_id),
    }));

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={operationA}
        onLegacyFallback={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(mocks.reconnect).toHaveBeenCalledWith(operationAId, ownerLeaseMatcher()),
    );
    await userEvent.click(screen.getByRole("button", { name: "Start a new operation" }));
    await userEvent.type(screen.getByLabelText(/Full name/), "Synthetic Person");
    await userEvent.type(screen.getByLabelText(/Target role or field/), "Operations Manager");
    await userEvent.type(
      screen.getByLabelText(/Confirmed work history/),
      "Managed a synthetic venue team.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate from confirmed facts" }));

    expect(
      await screen.findByRole("heading", { name: "The operation can be resumed safely" }),
    ).toBeInTheDocument();
    expect(screen.getByText(operationBId)).toBeInTheDocument();

    await act(async () => {
      delayedOperationA.resolve({
        ...operationA,
        operation_revision: 9,
        status: "generating",
      });
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { name: "The operation can be resumed safely" }),
    ).toBeInTheDocument();
    expect(screen.getByText(operationBId)).toBeInTheDocument();
    expect(screen.queryByText(operationAId)).toBeNull();
  });

  it("aborts and invalidates a deferred operation when its owner-bound component unmounts", async () => {
    const delayed = deferred<{
      operation_id: string;
      document_id: string;
      operation_revision: number;
      status: "ready_for_review";
      retryable: boolean;
    }>();
    mocks.start.mockReturnValue(delayed.promise);
    const outcomeId = "22222222-2222-4222-8222-222222222222";
    const { unmount } = render(
      <CapturedAdmission
        outcomeId={outcomeId}
        templateId="resume"
        title="Resume"
        onLegacyFallback={() => undefined}
      />,
    );

    await userEvent.type(screen.getByLabelText(/Full name/), "Synthetic Person");
    await userEvent.type(screen.getByLabelText(/Target role or field/), "Operations Manager");
    await userEvent.type(
      screen.getByLabelText(/Confirmed work history/),
      "Managed a synthetic venue team.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate from confirmed facts" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());

    const signal = (mocks.start.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    const key = `prompted:captured-admission:v2:${encodeURIComponent(OWNER_USER_ID)}:${encodeURIComponent(outcomeId)}`;
    const storedBeforeUnmount = sessionStorage.getItem(key);
    expect(storedBeforeUnmount).not.toBeNull();

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      delayed.resolve({
        operation_id: "55555555-5555-4555-8555-555555555555",
        document_id: "33333333-3333-4333-8333-333333333333",
        operation_revision: 1,
        status: "ready_for_review",
        retryable: false,
      });
      await Promise.resolve();
    });

    expect(sessionStorage.getItem(key)).toBe(storedBeforeUnmount);
  });

  it("keeps the last known durable state when a validated resume receipt is rejected", async () => {
    const operation = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 7,
      status: "retryable_failure",
      retryable: true,
    };
    mocks.reconnect.mockResolvedValue(operation);
    mocks.resume.mockRejectedValue(new ApiError(502, "CAPTURED_OPERATION_RESPONSE_INVALID", {}));

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={operation}
        onLegacyFallback={() => undefined}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Resume this operation" }));

    expect(
      screen.getByRole("heading", { name: "The operation can be resumed safely" }),
    ).toBeInTheDocument();
    expect(screen.getByText(operation.operation_id)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("lets a persisted terminal operation return to its saved document", async () => {
    const openPersistedWorkspace = vi.fn();
    const terminalOperation = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 8,
      status: "terminal_failure",
      retryable: false,
    };
    mocks.reconnect.mockResolvedValue(terminalOperation);

    render(
      <CapturedAdmission
        outcomeId="22222222-2222-4222-8222-222222222222"
        templateId="resume"
        title="Resume"
        initialOperation={terminalOperation}
        onLegacyFallback={() => undefined}
        onOpenPersistedWorkspace={openPersistedWorkspace}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open saved document" }));
    expect(openPersistedWorkspace).toHaveBeenCalledOnce();
  });

  it("retries transient reconnect failures with bounded backoff", async () => {
    vi.useFakeTimers();
    try {
      const initialOperation = {
        operation_id: "55555555-5555-4555-8555-555555555555",
        document_id: "33333333-3333-4333-8333-333333333333",
        operation_revision: 7,
        status: "generating",
        retryable: false,
      };
      mocks.reconnect
        .mockRejectedValueOnce(new Error("temporary network failure"))
        .mockResolvedValueOnce({
          ...initialOperation,
          operation_revision: 8,
          status: "terminal_failure",
        });

      render(
        <CapturedAdmission
          outcomeId="22222222-2222-4222-8222-222222222222"
          templateId="resume"
          title="Resume"
          initialOperation={initialOperation}
          onLegacyFallback={() => undefined}
        />,
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(mocks.reconnect).toHaveBeenCalledOnce();
      expect(
        screen.getByText("TED could not reconnect yet. Your accepted operation is still recorded."),
      ).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(mocks.reconnect).toHaveBeenCalledTimes(2);
      expect(
        screen.getByRole("heading", { name: "The operation could not be completed" }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
