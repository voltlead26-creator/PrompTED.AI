import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ApiError } from "@prompted/shared/api-client";
import { CapturedAdmission } from "./CapturedAdmission";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  reconnect: vi.fn(),
}));

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
    sessionStorage.clear();
    mocks.start.mockReset();
    mocks.resume.mockReset();
    mocks.cancel.mockReset();
    mocks.reconnect.mockReset();
  });

  it("asks no more than three questions at once and falls back only before admission", async () => {
    const onLegacyFallback = vi.fn();
    mocks.start.mockRejectedValue(
      new ApiError(409, "CAPTURED_ACTIVATION_DISABLED", {
        error: { code: "CAPTURED_ACTIVATION_DISABLED" },
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
    await userEvent.click(
      screen.getByRole("button", { name: "Generate from confirmed facts" }),
    );

    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        template_id: "complaint-letter",
        input_values: expect.objectContaining({
          recipient_name: "Synthetic Energy Co",
          desired_outcome: "Reverse the duplicate charge.",
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(onLegacyFallback).toHaveBeenCalledOnce();
    expect(
      sessionStorage.getItem(
        "prompted:captured-admission:22222222-2222-4222-8222-222222222222",
      ),
    ).toBeNull();
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

  it("records durable cancellation against the visible operation revision", async () => {
    const outcomeId = "22222222-2222-4222-8222-222222222222";
    sessionStorage.setItem(
      `prompted:captured-admission:${outcomeId}`,
      JSON.stringify({
        documentId: "33333333-3333-4333-8333-333333333333",
        generationRequestId: "44444444-4444-4444-8444-444444444444",
        inputRevision: 1,
        inputValues: {},
        operationId: "55555555-5555-4555-8555-555555555555",
      }),
    );
    mocks.reconnect.mockResolvedValue({
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "33333333-3333-4333-8333-333333333333",
      operation_revision: 7,
      status: "generating",
      retryable: false,
    });
    mocks.cancel.mockResolvedValue({
      operation_id: "55555555-5555-4555-8555-555555555555",
      operation_revision: 8,
      status: "cancelled",
      idempotent_replay: false,
      reconnect:
        "/api/document-operation?operation_id=55555555-5555-4555-8555-555555555555",
      retryable: false,
    });

    render(
      <CapturedAdmission
        outcomeId={outcomeId}
        templateId="resume"
        title="Resume"
        onLegacyFallback={() => undefined}
      />,
    );

    await screen.findByRole("heading", { name: /TED is drafting/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel this operation" }),
    );

    expect(mocks.cancel).toHaveBeenCalledWith({
      operation_id: "55555555-5555-4555-8555-555555555555",
      expected_operation_revision: 7,
      cancellation_code: "owner_cancelled",
    });
    expect(
      await screen.findByRole("heading", { name: "The operation was cancelled" }),
    ).toBeInTheDocument();
  });
});
