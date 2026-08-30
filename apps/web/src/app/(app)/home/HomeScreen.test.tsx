import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@prompted/shared/api-client";
import type { IntentResult } from "@prompted/shared/orchestration";

const interpretIntentMock = vi.fn();
const clarifyMock = vi.fn();
const ingestUploadMock = vi.fn();

vi.mock("@/lib/api", () => ({ ensureApiConfigured: vi.fn() }));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return {
    ...actual,
    interpretIntent: (...args: unknown[]) => interpretIntentMock(...args),
    clarify: (...args: unknown[]) => clarifyMock(...args),
    ingestUpload: (...args: unknown[]) => ingestUploadMock(...args),
  };
});

import { HomeScreen } from "./HomeScreen";
import { ToastProvider } from "@/components/atoms/Toast";

function renderHome() {
  return render(
    <ToastProvider>
      <HomeScreen fastLaneItems={[]} />
    </ToastProvider>,
  );
}

function unclear(question: string): IntentResult {
  return {
    domain: "general",
    situation: "",
    confidence: 0.3,
    intentClear: false,
    question,
    questionOptions: null,
    recommendation: null,
    jobSearch: false,
    missingInformation: [],
  };
}

function clearResult(): IntentResult {
  return {
    domain: "employment",
    situation: "hiring someone",
    confidence: 0.9,
    intentClear: true,
    question: null,
    questionOptions: null,
    jobSearch: false,
    missingInformation: [],
    recommendation: {
      primary: {
        name: "Offer Letter",
        format: "pdf",
        reason: "Confirms the offer in writing.",
        use_case: "Hiring a new employee",
        benefits: ["Clear terms", "Professional"],
      },
      alternatives: [
        { name: "Email Offer", format: "word", reason: "", use_case: "Informal", benefits: [] },
        { name: "Contract", format: "pdf", reason: "", use_case: "Formal", benefits: [] },
      ],
    },
  };
}

function clearResumeResult(): IntentResult {
  return {
    ...clearResult(),
    situation: "resume",
    recommendation: {
      primary: {
        name: "Resume",
        format: "document",
        reason: "Use the uploaded experience directly.",
        use_case: "Applying for work",
        benefits: ["Preserves confirmed experience"],
      },
      alternatives: [],
    },
  };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  interpretIntentMock.mockReset();
  clarifyMock.mockReset();
  ingestUploadMock.mockReset();
});

describe("HomeScreen orchestration", () => {
  it("renders the completion-focused headline before any conversation", () => {
    renderHome();
    expect(
      screen.getByRole("heading", { name: "What do you need help completing?" }),
    ).toBeDefined();
  });

  it("first turn calls interpretIntent and shows TED's question when unclear", async () => {
    interpretIntentMock.mockResolvedValue(unclear("What outcome do you want?"));
    renderHome();

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(textarea, "I need help with my team");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));

    await waitFor(() => expect(screen.getByText("What outcome do you want?")).toBeDefined());
    expect(interpretIntentMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("I need help with my team")).toBeDefined();
  });

  it("supports an unbounded clarification loop", async () => {
    interpretIntentMock.mockResolvedValue(unclear("Question 1?"));
    clarifyMock
      .mockResolvedValueOnce(unclear("Question 2?"))
      .mockResolvedValueOnce(unclear("Question 3?"))
      .mockResolvedValueOnce(unclear("Question 4?"));
    renderHome();

    const textarea = screen.getByLabelText("What do you need help completing?");
    const send = () => screen.getByRole("button", { name: /Ask TED/i });

    await userEvent.type(textarea, "first");
    await userEvent.click(send());
    await waitFor(() => expect(screen.getByText("Question 1?")).toBeDefined());

    for (const question of ["Question 2?", "Question 3?", "Question 4?"]) {
      await userEvent.type(textarea, "answer");
      await userEvent.click(send());
      await waitFor(() => expect(screen.getByText(question)).toBeDefined());
    }

    expect(clarifyMock).toHaveBeenCalledTimes(3);
  });

  it("requires a confirmation turn before showing a premature first-turn recommendation", async () => {
    interpretIntentMock.mockResolvedValue(clearResult());
    clarifyMock.mockResolvedValue(clearResult());
    renderHome();

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(textarea, "I'm hiring someone next week");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));

    await waitFor(() => expect(screen.getByText(/Is that accurate/i)).toBeDefined());
    expect(screen.queryByRole("region", { name: "TED's recommendation" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Yes, that's accurate" }));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "TED's recommendation" })).toBeDefined(),
    );
    expect(clarifyMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Create Offer Letter/i })).toBeDefined();
    expect(screen.queryByLabelText("What do you need help completing?")).toBeNull();
  });

  it("shows the summary card with what TED understood", async () => {
    interpretIntentMock.mockResolvedValue(clearResult());
    clarifyMock.mockResolvedValue(clearResult());
    renderHome();

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(textarea, "I'm hiring someone next week");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, that's accurate" }));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "What TED understood" })).toBeDefined(),
    );
    expect(screen.getByText("hiring someone")).toBeDefined();
  });

  it("confirming the primary recommendation hands off the chosen template", async () => {
    interpretIntentMock.mockResolvedValue(clearResult());
    clarifyMock.mockResolvedValue(clearResult());
    const onConfirm = vi.fn();
    render(
      <ToastProvider>
        <HomeScreen fastLaneItems={[]} onConfirm={onConfirm} />
      </ToastProvider>,
    );

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(textarea, "I'm hiring someone next week");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, that's accurate" }));

    const create = await screen.findByRole("button", { name: /Create Offer Letter/i });
    await userEvent.click(create);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].name).toBe("Offer Letter");
    expect(onConfirm.mock.calls[0]![1]).toBe("hiring someone");
  });

  it("keeps confirmation locked until an asynchronous handoff settles", async () => {
    interpretIntentMock.mockResolvedValue(clearResult());
    clarifyMock.mockResolvedValue(clearResult());
    let resolveConfirmation!: () => void;
    const onConfirm = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveConfirmation = resolve;
      }),
    );
    render(
      <ToastProvider>
        <HomeScreen fastLaneItems={[]} onConfirm={onConfirm} />
      </ToastProvider>,
    );

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(textarea, "I'm hiring someone next week");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, that's accurate" }));

    const create = await screen.findByRole("button", { name: /Create Offer Letter/i });
    await userEvent.click(create);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Creating…" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    resolveConfirmation();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Create Offer Letter/i })).toBeEnabled(),
    );
  });

  it("shows an error toast when the API call fails", async () => {
    interpretIntentMock.mockRejectedValue(new Error("network"));
    renderHome();

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(textarea, "something");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/small snag/i));
  });

  it("recovers temporary intent server failures into the clarification checkpoint", async () => {
    interpretIntentMock.mockRejectedValue(new ApiError(500, "REQUEST_FAILED", {}));
    renderHome();

    const textarea = screen.getByLabelText("What do you need help completing?");
    await userEvent.type(
      textarea,
      "Please prepare a complaint letter structure for an electricity bill dispute.",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));

    await waitFor(() => expect(screen.getByText(/Here.s what I understand/i)).toBeDefined());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("region", { name: "TED's recommendation" })).toBeNull();
  });

  it("ingests an uploaded document, confirms what TED read, and sends the extracted text", async () => {
    ingestUploadMock.mockResolvedValue({
      upload_id: "upload-1",
      extracted_text: "Warehouse supervisor with 8 years' experience.",
      confirm_payload: {
        summary: "A resume for a warehouse supervisor role.",
        memory_notes: ["Warehouse supervisor experience", "Seeking a job"],
        suggested_domain: "employment",
        confidence: 0.91,
        file_name: "cv.pdf",
      },
    });
    interpretIntentMock.mockResolvedValue(clearResult());
    const { container } = renderHome();

    const file = new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" });
    const textarea = screen.getByLabelText("What do you need help completing?");
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    await userEvent.upload(fileInput as HTMLInputElement, file);
    await userEvent.type(textarea, "I need a job");
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));

    let confirmRegion!: HTMLElement;
    await waitFor(() => {
      confirmRegion = screen.getByRole("region", { name: "Confirm what TED read" });
      expect(confirmRegion).toBeDefined();
    });
    expect(screen.getByText(/I read your upload\. TED thinks it is/i)).toBeDefined();
    expect(within(confirmRegion).getByText(/warehouse supervisor role/i)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /That.s right — continue/i }));

    await waitFor(() => expect(interpretIntentMock).toHaveBeenCalled());
    expect(interpretIntentMock.mock.calls[0]![0].extracted_text).toBe(
      "Warehouse supervisor with 8 years' experience.",
    );
  });

  it("persists uploaded resume text once instead of duplicating it into conversation context", async () => {
    sessionStorage.clear();
    const extractedText = "Warehouse operations experience. ".repeat(230);
    ingestUploadMock.mockResolvedValue({
      upload_id: "upload-long-resume",
      extracted_text: extractedText,
      confirm_payload: {
        summary: "A resume for warehouse operations roles.",
        document_type: "resume",
        structure: null,
        filename: "resume.pdf",
      },
    });
    interpretIntentMock.mockResolvedValue(clearResumeResult());
    clarifyMock.mockResolvedValue(clearResumeResult());
    const { container } = renderHome();

    const file = new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" });
    const fileInput = container.querySelector('input[type="file"]');
    await userEvent.upload(fileInput as HTMLInputElement, file);
    await userEvent.type(
      screen.getByLabelText("What do you need help completing?"),
      "Improve my resume",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await userEvent.click(await screen.findByRole("button", { name: /That.s right — continue/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, that's accurate" }));
    await userEvent.click(await screen.findByRole("button", { name: /Create Resume/i }));

    const pendingKey = Object.keys(sessionStorage).find((key) =>
      key.startsWith("prompted:pending:"),
    );
    expect(pendingKey).toBeDefined();
    const pending = JSON.parse(sessionStorage.getItem(pendingKey!) ?? "{}") as {
      conversationContext?: string;
      uploadContext?: string;
      uploadId?: string;
    };
    expect(pending.uploadId).toBe("upload-long-resume");
    expect(pending.uploadContext).toContain(extractedText.trim());
    expect(pending.conversationContext).not.toContain(extractedText.trim());
    expect(pending.conversationContext?.length ?? 0).toBeLessThan(20_000);
  });
});
