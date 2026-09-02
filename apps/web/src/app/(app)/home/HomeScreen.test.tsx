import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { ComponentPropsWithoutRef } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ApiError } from "@prompted/shared/api-client";
import type { IntentResult } from "@prompted/shared/orchestration";
import type {
  IngestUploadOptions,
  IngestUploadOutput,
  PreparedUploadDispatch,
} from "@prompted/shared/api-client";
import type {
  HomeIntakeInitialState,
  HomeUploadIntakeSnapshot,
} from "@/lib/home-intake-initial-state";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INTAKE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-8333-8333-333333333333";

const interpretIntentMock = vi.fn();
const clarifyMock = vi.fn();
const ingestUploadMock = vi.fn();
const upsertOutcomeMock = vi.fn();
const beginIntakeMock = vi.fn();
const confirmIntakeMock = vi.fn();
const cancelIntakeMock = vi.fn();
const commitIntakeMock = vi.fn();
const getIntakeMock = vi.fn();
const authState = vi.hoisted(() => ({
  current: {
    user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
    loading: false,
  },
}));

vi.mock("@/lib/api", () => ({ ensureApiConfigured: vi.fn() }));
vi.mock("@/lib/api/outcomes", () => ({
  upsertOutcome: (...args: unknown[]) => upsertOutcomeMock(...args),
}));
vi.mock("@/lib/api/home-intakes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/home-intakes")>(
    "@/lib/api/home-intakes",
  );
  return {
    ...actual,
    beginHomeUploadIntake: (...args: unknown[]) => beginIntakeMock(...args),
    confirmHomeUploadIntake: (...args: unknown[]) => confirmIntakeMock(...args),
    cancelHomeUploadIntake: (...args: unknown[]) => cancelIntakeMock(...args),
    commitHomeUploadIntake: (...args: unknown[]) => commitIntakeMock(...args),
    getHomeUploadIntake: (...args: unknown[]) => getIntakeMock(...args),
  };
});
vi.mock("@/components/providers", () => ({
  useAuth: () => authState.current,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

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
import { HomeUploadIntakeError } from "@/lib/api/home-intakes";

function noIntake(): HomeIntakeInitialState {
  return {
    authenticated: true,
    ownerUserId: USER_ID,
    persistence: "not_found",
    intake: null,
  };
}

function intakeSnapshot(
  overrides: Partial<HomeUploadIntakeSnapshot> = {},
): HomeUploadIntakeSnapshot {
  return {
    contractVersion: "home-upload-intake.v1",
    intakeId: INTAKE_ID,
    ownerUserId: USER_ID,
    uploadId: UPLOAD_ID,
    state: "open",
    revision: 1,
    acceptedRevision: 0,
    typedSituation: "Improve my resume",
    fileName: "resume.pdf",
    fileType: "application/pdf",
    fileSizeBytes: 1024,
    contentSha256: "a".repeat(64),
    uploadState: "file_required",
    extractedText: null,
    confirmPayload: null,
    confirmedText: null,
    confirmedTextSha256: null,
    outcomeId: null,
    retryable: true,
    safeNextAction: "Reselect the same file to continue this upload.",
    updatedAt: "2026-09-02T01:02:03.000Z",
    idempotentReplay: false,
    ...overrides,
  };
}

function initialWith(intake: HomeUploadIntakeSnapshot): HomeIntakeInitialState {
  return {
    authenticated: true,
    ownerUserId: USER_ID,
    persistence: "persisted",
    intake,
  };
}

function completedUpload(
  extractedText: string,
  fileName = "resume.pdf",
): IngestUploadOutput {
  return {
    upload_id: UPLOAD_ID,
    extracted_text: extractedText,
    original_retained: true,
    classification_status: "completed",
    confirm_payload: {
      summary: "A resume for warehouse operations roles.",
      document_type: "resume",
      structure: [{ title: "Experience", items: ["Warehouse operations experience."] }],
      filename: fileName,
      char_count: extractedText.length,
      truncated: false,
    },
  };
}

function preparedUpload(
  situationText: string,
  fileName = "resume.pdf",
): Readonly<PreparedUploadDispatch> {
  return Object.freeze({
    uploadId: UPLOAD_ID,
    situationText,
    fileName,
    mimeType: "application/pdf",
    persistedFileType: "application/pdf",
    fileSizeBytes: 1024,
    contentSha256: "a".repeat(64),
  });
}

function arrangeDurableUpload(
  extractedText: string,
  situationText: string,
  fileName = "resume.pdf",
  events?: string[],
) {
  const output = completedUpload(extractedText, fileName);
  const prepared = preparedUpload(situationText, fileName);
  beginIntakeMock.mockImplementation(
    async ({ intakeId }: { intakeId: string }) => {
      events?.push("begin");
      return intakeSnapshot({
        intakeId,
        uploadId: prepared.uploadId,
        typedSituation: prepared.situationText,
        fileName: prepared.fileName,
        fileType: prepared.persistedFileType,
        fileSizeBytes: prepared.fileSizeBytes,
        contentSha256: prepared.contentSha256,
      });
    },
  );
  ingestUploadMock.mockImplementation(
    async (
      _file: File,
      _situation: string,
      _requestContext: unknown,
      options: IngestUploadOptions,
    ) => {
      await options.beforeDispatch?.(prepared);
      events?.push("dispatch");
      return output;
    },
  );
  confirmIntakeMock.mockImplementation(
    async ({ intakeId, confirmedText }: { intakeId: string; confirmedText: string }) =>
      intakeSnapshot({
        intakeId,
        state: "confirmed",
        revision: 2,
        acceptedRevision: 1,
        uploadState: "confirmed",
        extractedText: null,
        confirmPayload: output.confirm_payload,
        confirmedText,
        confirmedTextSha256: "b".repeat(64),
        retryable: false,
        safeNextAction: "Continue with the text you confirmed.",
      }),
  );
  return { output, prepared };
}

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderHome(
  initialState: HomeIntakeInitialState = noIntake(),
  onMessagesChange?: (messages: Array<{ role: "user" | "ted"; text: string }>) => void,
) {
  return render(
    <ToastProvider>
      <HomeScreen
        fastLaneItems={[]}
        initialState={initialState}
        onMessagesChange={onMessagesChange}
      />
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
  recordBrowserPrincipal(USER_ID);
  authState.current = { user: { id: USER_ID }, loading: false };
  interpretIntentMock.mockReset();
  clarifyMock.mockReset();
  ingestUploadMock.mockReset();
  upsertOutcomeMock.mockReset();
  beginIntakeMock.mockReset();
  confirmIntakeMock.mockReset();
  cancelIntakeMock.mockReset();
  commitIntakeMock.mockReset();
  getIntakeMock.mockReset();
  pushMock.mockReset();
  upsertOutcomeMock.mockResolvedValue(undefined);
});

afterEach(() => recordBrowserPrincipal(undefined));

describe("HomeScreen orchestration", () => {
  it("shows a sign-in path without calling a paid API when signed out", async () => {
    authState.current = { user: null, loading: false };
    const { container } = renderHome();

    expect(
      screen.getByRole("link", { name: "Sign in to ask TED" }),
    ).toHaveAttribute("href", "/sign-in?next=%2Fhome");
    expect(
      screen.queryByLabelText("What do you need help completing?"),
    ).toBeNull();
    expect(interpretIntentMock).not.toHaveBeenCalled();
    expect(ingestUploadMock).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not enable chat while session state is still resolving", () => {
    authState.current = { user: null, loading: true };
    renderHome();

    expect(screen.getByRole("status")).toHaveTextContent("Checking your sign-in");
    expect(screen.queryByLabelText("What do you need help completing?")).toBeNull();
    expect(interpretIntentMock).not.toHaveBeenCalled();
  });

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
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({
      templateName: "Offer Letter",
      situation: "hiring someone",
    });
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
    const events: string[] = [];
    arrangeDurableUpload(
      "Warehouse supervisor with 8 years' experience.",
      "I need a job",
      "cv.pdf",
      events,
    );
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
    expect(within(confirmRegion).getByText(/warehouse operations roles/i)).toBeDefined();
    expect(events).toEqual(["begin", "dispatch"]);
    expect(beginIntakeMock.mock.calls[0]?.[0]).toEqual({
      intakeId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      prepared: preparedUpload("I need a job", "cv.pdf"),
    });
    await userEvent.click(screen.getByRole("button", { name: /That.s right — continue/i }));

    await waitFor(() => expect(interpretIntentMock).toHaveBeenCalled());
    expect(confirmIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        expectedRevision: 1,
        confirmedText: "Warehouse supervisor with 8 years' experience.",
      }),
      expect.any(Object),
    );
    expect(interpretIntentMock.mock.calls[0]![0].extracted_text).toBe(
      "Warehouse supervisor with 8 years' experience.",
    );
  });

  it("cannot resurrect a cancelled intake when an in-flight ingest completes late", async () => {
    const output = completedUpload("Late source text.");
    const prepared = preparedUpload("Improve my resume");
    const ingestResult = deferredValue<IngestUploadOutput>();
    beginIntakeMock.mockResolvedValue(intakeSnapshot());
    ingestUploadMock.mockImplementation(
      async (
        _file: File,
        _situation: string,
        _requestContext: unknown,
        options: IngestUploadOptions,
      ) => {
        await options.beforeDispatch?.(prepared);
        return await ingestResult.promise;
      },
    );
    cancelIntakeMock.mockResolvedValue(intakeSnapshot({
      state: "cancelled",
      revision: 2,
      acceptedRevision: 1,
      uploadState: "cancelled",
      retryable: false,
      safeNextAction: "Start again or continue without the upload.",
    }));
    const { container } = renderHome();

    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["resume"], "resume.pdf", { type: "application/pdf" }),
    );
    await userEvent.type(
      screen.getByLabelText("What do you need help completing?"),
      "Improve my resume",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Start again" }));
    await waitFor(() => expect(cancelIntakeMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      ingestResult.resolve(output);
      await Promise.resolve();
    });

    expect(screen.queryByRole("region", { name: "Confirm what TED read" })).toBeNull();
    expect(screen.getByLabelText("What do you need help completing?")).toBeDefined();
    expect(interpretIntentMock).not.toHaveBeenCalled();
  });

  it("reconciles an in-flight begin command before removing its attachment", async () => {
    const beginAcknowledgement = deferredValue<HomeUploadIntakeSnapshot>();
    const prepared = preparedUpload("Improve my resume");
    beginIntakeMock
      .mockReturnValueOnce(beginAcknowledgement.promise)
      .mockResolvedValueOnce(intakeSnapshot());
    cancelIntakeMock.mockResolvedValue(intakeSnapshot({
      state: "cancelled",
      revision: 2,
      acceptedRevision: 1,
      uploadState: "cancelled",
      retryable: false,
      safeNextAction: "Start again or continue without the upload.",
    }));
    ingestUploadMock.mockImplementation(
      async (
        _file: File,
        _situation: string,
        _requestContext: unknown,
        options: IngestUploadOptions,
      ) => {
        await options.beforeDispatch?.(prepared);
        return completedUpload("Late source text.");
      },
    );
    const { container } = renderHome();

    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["resume"], "resume.pdf", { type: "application/pdf" }),
    );
    await userEvent.type(
      screen.getByLabelText("What do you need help completing?"),
      "Improve my resume",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await waitFor(() => expect(beginIntakeMock).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Remove resume.pdf" }));

    await waitFor(() => expect(beginIntakeMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cancelIntakeMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove resume.pdf" })).toBeNull()
    );
    expect(beginIntakeMock.mock.calls[1]?.[0]).toEqual(beginIntakeMock.mock.calls[0]?.[0]);

    await act(async () => {
      beginAcknowledgement.resolve(intakeSnapshot());
      await Promise.resolve();
    });
    expect(screen.queryByRole("region", { name: "Confirm what TED read" })).toBeNull();
  });

  it("persists uploaded resume text once in the durable outcome instead of duplicating it into conversation context", async () => {
    sessionStorage.clear();
    const extractedText = "Warehouse operations experience. ".repeat(230);
    arrangeDurableUpload(extractedText, "Improve my resume");
    commitIntakeMock.mockImplementation(
      async (input: {
        recommendationPayload: {
          primary: { template_id: string; reason: string };
          upload_id?: string;
          upload_context?: string;
          conversation_context?: string;
        };
      }) => ({
        outcomeId: INTAKE_ID,
        situation: "resume",
        templateId: input.recommendationPayload.primary.template_id,
        templateName: input.recommendationPayload.primary.reason,
        uploadId: UPLOAD_ID,
        uploadContext: extractedText.trim(),
        conversationContext: input.recommendationPayload.conversation_context ?? "",
      }),
    );
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

    expect(upsertOutcomeMock).not.toHaveBeenCalled();
    expect(commitIntakeMock).toHaveBeenCalledTimes(1);
    const persisted = commitIntakeMock.mock.calls[0]![0] as {
      intakeId: string;
      uploadId: string;
      expectedRevision: number;
      confirmedText: string;
      recommendationPayload: {
        upload_id?: string;
        upload_context?: string;
        conversation_context?: string;
      };
    };
    expect(persisted).toMatchObject({
      intakeId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      uploadId: UPLOAD_ID,
      expectedRevision: 2,
      confirmedText: extractedText.trim(),
    });
    expect(persisted.recommendationPayload.upload_id).toBe(UPLOAD_ID);
    const uploadContext = persisted.recommendationPayload.upload_context ?? "";
    expect(uploadContext).toContain(`Uploaded document text:\n${extractedText.trim()}`);
    expect(uploadContext.split(extractedText.trim())).toHaveLength(2);
    expect(persisted.recommendationPayload.conversation_context).not.toContain(extractedText.trim());
    expect(persisted.recommendationPayload.conversation_context?.length ?? 0).toBeLessThan(20_000);
  });

  it("rehydrates an awaiting-confirmation intake without repeating upload or provider work", () => {
    const output = completedUpload("Recovered source text.");
    renderHome(initialWith(intakeSnapshot({
      uploadState: "awaiting_confirmation",
      extractedText: output.extracted_text,
      confirmPayload: output.confirm_payload,
      retryable: false,
      safeNextAction: "Review and confirm what TED read.",
    })));

    expect(screen.getByRole("region", { name: "Confirm what TED read" })).toBeDefined();
    expect(screen.getByText("Warehouse operations experience.")).toBeDefined();
    expect(ingestUploadMock).not.toHaveBeenCalled();
    expect(beginIntakeMock).not.toHaveBeenCalled();
    expect(interpretIntentMock).not.toHaveBeenCalled();
    expect(clarifyMock).not.toHaveBeenCalled();
  });

  it("resumes a confirmed checkpoint only after an explicit user action", async () => {
    const output = completedUpload("Raw source that must stay withheld.");
    interpretIntentMock.mockResolvedValue(clearResumeResult());
    renderHome(initialWith(intakeSnapshot({
      state: "confirmed",
      revision: 2,
      acceptedRevision: null,
      uploadState: "confirmed",
      extractedText: null,
      confirmPayload: output.confirm_payload,
      confirmedText: "User-confirmed source.",
      confirmedTextSha256: "b".repeat(64),
      retryable: false,
      safeNextAction: "Continue with the text you confirmed.",
    })));

    expect(interpretIntentMock).not.toHaveBeenCalled();
    expect(confirmIntakeMock).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: /Continue with confirmed text/i }),
    );

    await waitFor(() => expect(interpretIntentMock).toHaveBeenCalledTimes(1));
    expect(interpretIntentMock.mock.calls[0]?.[0].extracted_text).toBe(
      "User-confirmed source.",
    );
    expect(confirmIntakeMock).not.toHaveBeenCalled();
  });

  it("fails closed when durable Home truth is unavailable", () => {
    renderHome({
      authenticated: true,
      ownerUserId: USER_ID,
      persistence: "unavailable",
      intake: null,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load your saved upload state/i);
    expect(screen.queryByLabelText("What do you need help completing?")).toBeNull();
  });

  it("retains the corrected confirmation card when durable confirmation fails", async () => {
    const output = completedUpload("OCR ORIGINAL");
    confirmIntakeMock.mockRejectedValue(new Error("network"));
    renderHome(initialWith(intakeSnapshot({
      uploadState: "awaiting_confirmation",
      extractedText: output.extracted_text,
      confirmPayload: output.confirm_payload,
      retryable: false,
      safeNextAction: "Review and confirm what TED read.",
    })));

    await userEvent.click(screen.getByRole("button", { name: /Looks wrong/i }));
    const editor = screen.getByLabelText("Correct the text TED read");
    await userEvent.clear(editor);
    await userEvent.type(editor, "USER CORRECTED");
    await userEvent.click(screen.getByRole("button", { name: /That.s right — continue/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t save/i));
    expect(screen.getByLabelText("Correct the text TED read")).toHaveValue("USER CORRECTED");
    expect(confirmIntakeMock).toHaveBeenCalledTimes(1);
    expect(interpretIntentMock).not.toHaveBeenCalled();
  });

  it("continues a durably confirmed upload without confirming it twice after provider failure", async () => {
    arrangeDurableUpload("Confirmed warehouse source.", "Improve my resume");
    interpretIntentMock.mockRejectedValueOnce(new Error("provider unavailable"));
    clarifyMock.mockResolvedValueOnce(clearResumeResult());
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

    expect(await screen.findByRole("alert")).toHaveTextContent(/small snag/i);
    const continueButton = screen.getByRole("button", { name: /Continue with confirmed text/i });
    expect(confirmIntakeMock).toHaveBeenCalledTimes(1);

    await userEvent.click(continueButton);

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "TED's recommendation" })).toBeDefined(),
    );
    expect(confirmIntakeMock).toHaveBeenCalledTimes(1);
    expect(interpretIntentMock).toHaveBeenCalledTimes(1);
    expect(clarifyMock).toHaveBeenCalledTimes(1);
  });

  it("does not clear an upload when durable cancellation fails", async () => {
    const output = completedUpload("Retained source text.");
    cancelIntakeMock.mockRejectedValue(new Error("network"));
    renderHome(initialWith(intakeSnapshot({
      uploadState: "awaiting_confirmation",
      extractedText: output.extracted_text,
      confirmPayload: output.confirm_payload,
      retryable: false,
      safeNextAction: "Review and confirm what TED read.",
    })));

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t cancel/i));
    expect(screen.getByRole("region", { name: "Confirm what TED read" })).toBeDefined();
    expect(cancelIntakeMock).toHaveBeenCalledTimes(1);
  });

  it("offers the exact saved outcome after a lost final acknowledgement", () => {
    renderHome(initialWith(intakeSnapshot({
      state: "consumed",
      revision: 3,
      acceptedRevision: null,
      uploadState: "consumed",
      confirmedText: null,
      confirmedTextSha256: null,
      outcomeId: INTAKE_ID,
      retryable: false,
      safeNextAction: "Continue the saved outcome.",
    })));

    expect(screen.getByRole("link", { name: /Continue saved outcome/i })).toHaveAttribute(
      "href",
      `/outcomes/${INTAKE_ID}`,
    );
    expect(commitIntakeMock).not.toHaveBeenCalled();
    expect(interpretIntentMock).not.toHaveBeenCalled();
  });

  it("allows a new text-only outcome while retaining a consumed upload recovery link", async () => {
    interpretIntentMock.mockResolvedValue(clearResult());
    clarifyMock.mockResolvedValue(clearResult());
    renderHome(initialWith(intakeSnapshot({
      state: "consumed",
      revision: 3,
      acceptedRevision: null,
      uploadState: "consumed",
      confirmedText: null,
      confirmedTextSha256: null,
      outcomeId: INTAKE_ID,
      retryable: false,
      safeNextAction: "Continue the saved outcome.",
    })));

    await userEvent.type(
      screen.getByLabelText("What do you need help completing?"),
      "Create a new offer letter",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask TED/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, that's accurate" }));
    await userEvent.click(await screen.findByRole("button", { name: /Create Offer Letter/i }));

    await waitFor(() => expect(upsertOutcomeMock).toHaveBeenCalledTimes(1));
    expect(commitIntakeMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Continue saved outcome/i })).toHaveAttribute(
      "href",
      `/outcomes/${INTAKE_ID}`,
    );
  });

  it("fails closed when server-loaded absence belongs to a different hydrated principal", () => {
    authState.current = {
      user: { id: "44444444-4444-4444-8444-444444444444" },
      loading: false,
    };
    renderHome(noIntake());

    expect(screen.getByRole("alert")).toHaveTextContent(/saved upload state is unavailable/i);
    expect(screen.queryByLabelText("What do you need help completing?")).toBeNull();
    expect(beginIntakeMock).not.toHaveBeenCalled();
  });

  it("never renders or seeds a persisted upload owned by a different hydrated principal", async () => {
    const hydratedUserId = "44444444-4444-4444-8444-444444444444";
    const foreignSummary = "PRIVATE OWNER A SUMMARY";
    const foreignText = "PRIVATE OWNER A CONFIRMED DOCUMENT TEXT";
    const foreignFileName = "private-owner-a-resume.pdf";
    authState.current = {
      user: { id: hydratedUserId },
      loading: false,
    };
    recordBrowserPrincipal(hydratedUserId);
    const onMessagesChange = vi.fn();

    const { container } = renderHome(initialWith(intakeSnapshot({
      state: "confirmed",
      revision: 2,
      acceptedRevision: 1,
      uploadState: "confirmed",
      typedSituation: "PRIVATE OWNER A REQUEST",
      fileName: foreignFileName,
      extractedText: null,
      confirmPayload: {
        summary: foreignSummary,
        document_type: "resume",
        structure: [{ title: "Private history", items: ["PRIVATE OWNER A ROLE"] }],
        filename: foreignFileName,
        char_count: foreignText.length,
        truncated: false,
      },
      confirmedText: foreignText,
      confirmedTextSha256: "b".repeat(64),
      retryable: false,
      safeNextAction: "Continue with the text you confirmed.",
    })), onMessagesChange);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/saved upload state is unavailable/i);
    });
    expect(container).not.toHaveTextContent("PRIVATE OWNER A");
    expect(container).not.toHaveTextContent(foreignFileName);
    expect(JSON.stringify(onMessagesChange.mock.calls)).not.toContain("PRIVATE OWNER A");
    expect(interpretIntentMock).not.toHaveBeenCalled();
    expect(beginIntakeMock).not.toHaveBeenCalled();
  });

  it("requires both Home owner envelopes to match the hydrated principal", async () => {
    const hydratedUserId = "44444444-4444-4444-8444-444444444444";
    authState.current = {
      user: { id: hydratedUserId },
      loading: false,
    };
    recordBrowserPrincipal(hydratedUserId);
    const outerOwnerMatches: HomeIntakeInitialState = {
      authenticated: true,
      ownerUserId: hydratedUserId,
      persistence: "persisted",
      intake: intakeSnapshot({
        state: "confirmed",
        revision: 2,
        acceptedRevision: 1,
        uploadState: "confirmed",
        fileName: "PRIVATE INNER OWNER FILE.pdf",
        extractedText: null,
        confirmPayload: {
          summary: "PRIVATE INNER OWNER SUMMARY",
          document_type: "resume",
          structure: [{
            title: "PRIVATE INNER OWNER HISTORY",
            items: ["PRIVATE INNER OWNER DETAIL"],
          }],
          filename: "PRIVATE INNER OWNER FILE.pdf",
          char_count: 27,
          truncated: false,
        },
        confirmedText: "PRIVATE INNER OWNER CONTENT",
        confirmedTextSha256: "b".repeat(64),
        retryable: false,
        safeNextAction: "Continue with the text you confirmed.",
      }),
    };

    const { container } = renderHome(outerOwnerMatches);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/saved upload state is unavailable/i);
    });
    expect(container).not.toHaveTextContent("PRIVATE INNER OWNER");
    expect(screen.queryByRole("region", { name: "Confirm what TED read" })).toBeNull();
  });

  it("reports an unresolved final acknowledgement as unconfirmed rather than not created", async () => {
    const output = completedUpload("Raw source that must stay withheld.");
    interpretIntentMock.mockResolvedValue(clearResumeResult());
    clarifyMock.mockResolvedValue(clearResumeResult());
    commitIntakeMock.mockRejectedValue(new HomeUploadIntakeError(
      "HOME_UPLOAD_INTAKE_ACKNOWLEDGEMENT_UNKNOWN",
      true,
    ));
    getIntakeMock.mockResolvedValue(null);
    renderHome(initialWith(intakeSnapshot({
      state: "confirmed",
      revision: 2,
      acceptedRevision: null,
      uploadState: "confirmed",
      extractedText: null,
      confirmPayload: output.confirm_payload,
      confirmedText: "User-confirmed source.",
      confirmedTextSha256: "b".repeat(64),
      retryable: false,
      safeNextAction: "Continue with the text you confirmed.",
    })));

    await userEvent.click(screen.getByRole("button", { name: /Continue with confirmed text/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, that's accurate" }));
    await userEvent.click(await screen.findByRole("button", { name: /Create Resume/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t confirm whether the outcome was saved/i);
    expect(alert).not.toHaveTextContent(/couldn.t create/i);
  });
});
