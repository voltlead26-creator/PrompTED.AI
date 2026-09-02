import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentResult } from "@prompted/shared/orchestration";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-8333-8333-333333333333";
const startMock = vi.hoisted(() => vi.fn());
const continueMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: USER_ID } }),
}));

vi.mock("./useInterpretIntent", () => ({
  useInterpretIntent: () => ({ start: startMock, continue: continueMock }),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return { ...actual, jobMatch: vi.fn(), recommend: vi.fn() };
});

import { useRecommendation } from "./useRecommendation";

function result(question: string): IntentResult {
  return {
    domain: "employment",
    situation: "Improve my resume",
    confidence: 0.7,
    intentClear: false,
    question,
    questionOptions: null,
    jobSearch: false,
    missingInformation: [],
    recommendation: null,
  };
}

describe("useRecommendation upload context", () => {
  beforeEach(() => {
    recordBrowserPrincipal(USER_ID);
    startMock.mockReset().mockResolvedValue(result("Which role are you targeting?"));
    continueMock.mockReset().mockResolvedValue(result("Which achievement matters most?"));
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("replaces raw extraction with the confirmed text exactly once across turns", async () => {
    const { result: hook } = renderHook(() => useRecommendation());

    act(() => {
      hook.current.seedUploadContext({
        uploadId: UPLOAD_ID,
        fileName: "resume.pdf",
        summary: "A warehouse resume.",
        extractedText: "OCR ORIGINAL",
      });
      hook.current.replaceUploadContext("USER CORRECTED");
    });

    await act(async () => {
      await hook.current.submit("Improve my resume");
    });
    await act(async () => {
      await hook.current.submit("Supervisor roles");
    });

    await waitFor(() => expect(continueMock).toHaveBeenCalledTimes(1));
    expect(hook.current.getUploadId()).toBe(UPLOAD_ID);
    const context = hook.current.getUploadContext();
    expect(context).toContain("Uploaded file: resume.pdf");
    expect(context).toContain("TED read: A warehouse resume.");
    expect(context).not.toContain("OCR ORIGINAL");
    expect(context.match(/USER CORRECTED/g)).toHaveLength(1);
    expect(startMock.mock.calls[0]?.[1]).toBe("USER CORRECTED");
    const continued = continueMock.mock.calls[0]?.[0] as { extractedText?: string };
    expect(continued.extractedText).not.toContain("OCR ORIGINAL");
    expect(continued.extractedText?.match(/USER CORRECTED/g)).toHaveLength(1);
  });
});
