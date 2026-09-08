import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import type { IntentResult } from "@prompted/shared/orchestration";

const mocks = vi.hoisted(() => ({ start: vi.fn(), next: vi.fn(), recommend: vi.fn(), user: { id: "11111111-1111-4111-8111-111111111111" } }));
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./useInterpretIntent", () => ({ useInterpretIntent: () => ({ start: mocks.start, continue: mocks.next }) }));
vi.mock("@prompted/shared/api-client", async () => ({ ...await vi.importActual("@prompted/shared/api-client"), recommend: mocks.recommend }));
import { useRecommendation } from "./useRecommendation";

const questions: IntentResult = { domain: "personal", situation: "Moving house", confidence: 0.8, intentClear: false, question: "1. What date are you moving?\n2. What are the old and new addresses?\n3. Are you renting or buying?", questionOptions: null, recommendation: null, jobSearch: false, missingInformation: [] };
const ready: IntentResult = { ...questions, intentClear: true, question: null, recommendation: { primary: { name: "Moving House Checklist", format: "checklist", reason: "Prepare for the move", use_case: "Move house", benefits: [] }, alternatives: [] } };
const readyWithSummary = { ...ready, knowledgeSummary: "Goal: move on 20 October.\nCurrent address: 1 Example St.\nNew address: 2 Sample Rd.\nTenure: renting.\nRequired depth: dated tasks for notices, utilities and handover." };

describe("profile clarification and knowledge confirmation", () => {
  beforeEach(() => {
    recordBrowserPrincipal(mocks.user.id);
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(questions);
    mocks.next.mockResolvedValue(readyWithSummary);
  });
  afterEach(() => recordBrowserPrincipal(undefined));

  it("carries a complete 20,000-character request into clarification without adding an oversized prefix", async () => {
    const original = "x".repeat(20_000);
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { expect(await result.current.submit(original)).toBe(true); });
    expect(mocks.start.mock.calls[0]?.[0]).toBe(original);
    await act(async () => { expect(await result.current.submit("Please use those facts")).toBe(true); });
    expect(mocks.next.mock.calls[0]?.[0]).toMatchObject({
      situation: original,
      history: expect.arrayContaining([{ role: "user", content: original }]),
      answer: "Please use those facts",
    });
  });

  it("rejects oversized new requests before changing history and accepts their corrected replacement", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useRecommendation(onError));
    await act(async () => { expect(await result.current.submit("x".repeat(20_001))).toBe(false); });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.next).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("20,000"));
    await act(async () => { expect(await result.current.submit("Help me move")).toBe(true); });
    expect(mocks.start.mock.calls[0]?.[0]).toBe("Help me move");
  });

  it("keeps the current knowledge summary when an oversized correction was never accepted", async () => {
    mocks.start.mockResolvedValue(readyWithSummary);
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("Help me move"); });
    const acceptedMessages = result.current.messages;
    await act(async () => { expect(await result.current.submit("x".repeat(20_001))).toBe(false); });
    expect(mocks.next).not.toHaveBeenCalled();
    expect(result.current.messages).toBe(acceptedMessages);
    await act(async () => { expect(await result.current.submit("Confirm knowledge summary")).toBe(true); });
    expect(result.current.showRecommendation).toBe(true);
  });

  it("shows multiple questions, then holds the recommendation until explicit summary confirmation", async () => {
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("Help me move"); });
    expect(result.current.messages.at(-1)?.text).toContain("3. Are you renting");
    await act(async () => { await result.current.submit("20 October, from 1 Example St to 2 Sample Rd, renting"); });
    expect(result.current.showRecommendation).toBe(false);
    expect(result.current.result?.recommendation).toBeNull();
    expect(result.current.messages.at(-1)?.text).toContain(readyWithSummary.knowledgeSummary);
    await act(async () => { await result.current.submit("Confirm knowledge summary"); });
    expect(result.current.showRecommendation).toBe(true);
    expect(mocks.next).toHaveBeenCalledTimes(1);
    expect(result.current.getDocumentContext()).toContain("Confirm knowledge summary");
    expect(result.current.getDocumentContext()).toContain("Required depth: dated tasks");
  });

  it("asks for corrections without treating the correction button as a factual answer", async () => {
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("Help me move"); await result.current.submit("Moving next month"); });
    await act(async () => { await result.current.submit("Correct or add details"); });
    expect(result.current.messages.at(-1)?.text).toMatch(/what should.*correct or add/i);
    expect(mocks.next).toHaveBeenCalledTimes(1);
    expect(result.current.showRecommendation).toBe(false);
    await act(async () => { await result.current.submit("Actually buying, not renting"); });
    expect(mocks.next).toHaveBeenCalledTimes(2);
    expect(result.current.showRecommendation).toBe(false);
  });

  it("does not force a recommendation when interpretation returns neither question nor recommendation", async () => {
    mocks.next.mockResolvedValue({ ...questions, intentClear: true, question: null });
    const onError = vi.fn();
    const { result } = renderHook(() => useRecommendation(onError));
    await act(async () => { await result.current.submit("Help me move"); await result.current.submit("Next month"); });
    expect(mocks.recommend).not.toHaveBeenCalled();
    expect(result.current.showRecommendation).toBe(false);
    expect(onError).toHaveBeenCalled();
  });

  it("invalidates confirmation when upload content changes", async () => {
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("Help me move"); await result.current.submit("Next month"); });
    act(() => result.current.replaceUploadContext("Corrected move date: November"));
    await act(async () => { await result.current.submit("Confirm knowledge summary"); });
    expect(result.current.showRecommendation).toBe(false);
  });

  it("does not restore generation permission from an old confirmation transcript", () => {
    const { result } = renderHook(() => useRecommendation());
    act(() => result.current.hydrate({ messages: [{ role: "ted", text: "Knowledge summary: old facts" }, { role: "user", text: "Confirm knowledge summary" }], situation: "Moving house" }));
    expect(result.current.showRecommendation).toBe(false);
  });
  it("rejects duplicate sends and late results after cancellation", async () => {
    let resolve!: (value: IntentResult) => void;
    mocks.start.mockReturnValue(new Promise<IntentResult>((done) => { resolve = done; }));
    const { result } = renderHook(() => useRecommendation());
    let first!: Promise<boolean>;
    act(() => { first = result.current.submit("Help me move"); });
    await act(async () => { expect(await result.current.submit("Help me move")).toBe(false); });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    act(() => result.current.reset());
    await act(async () => { resolve(readyWithSummary); expect(await first).toBe(false); });
    expect(result.current.messages).toEqual([]);
    expect(result.current.showRecommendation).toBe(false);
    expect(result.current.thinking).toBe(false);
  });

  it("ignores a pending answer after the upload is replaced", async () => {
    let resolve!: (value: IntentResult) => void;
    mocks.start.mockReturnValue(new Promise<IntentResult>((done) => { resolve = done; }));
    const { result } = renderHook(() => useRecommendation());
    let first!: Promise<boolean>;
    act(() => { first = result.current.submit("Help me move"); });
    act(() => result.current.replaceUploadContext("Changed source"));
    await act(async () => { resolve(readyWithSummary); expect(await first).toBe(false); });
    expect(result.current.messages.some((message) => message.text.includes("Knowledge summary"))).toBe(false);
    expect(result.current.showRecommendation).toBe(false);
  });

  it("clears a pending summary on account changes", async () => {
    const originalId = mocks.user.id;
    const { result, rerender } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("Help me move"); await result.current.submit("Next month"); });
    try {
      mocks.user = { id: "22222222-2222-4222-8222-222222222222" };
      recordBrowserPrincipal(mocks.user.id);
      rerender();
      await act(async () => { expect(await result.current.submit("Confirm knowledge summary")).toBe(false); });
      expect(result.current.messages).toEqual([]);
      expect(result.current.showRecommendation).toBe(false);
    } finally { mocks.user = { id: originalId }; }
  });

  it("keeps a fully supplied first-turn brief behind the same confirmation gate", async () => {
    mocks.start.mockResolvedValue(readyWithSummary);
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("All move details supplied"); });
    expect(result.current.showRecommendation).toBe(false);
    await act(async () => { await result.current.submit("Confirm knowledge summary"); });
    expect(result.current.showRecommendation).toBe(true);
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("retains answers through a failed request and requires confirmation after retry", async () => {
    mocks.next.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(readyWithSummary);
    const { result } = renderHook(() => useRecommendation());
    await act(async () => { await result.current.submit("Help me move"); expect(await result.current.submit("20 October")).toBe(false); });
    expect(result.current.showRecommendation).toBe(false);
    await act(async () => { await result.current.submit("Please retry"); });
    expect(mocks.next.mock.calls.at(-1)?.[0].history).toContainEqual({ role: "user", content: "20 October" });
    expect(result.current.showRecommendation).toBe(false);
    await act(async () => { await result.current.submit("Confirm knowledge summary"); });
    expect(result.current.showRecommendation).toBe(true);
  });

  it("does not substitute raw chat for a missing document knowledge summary", async () => {
    mocks.next.mockResolvedValue(ready);
    const onError = vi.fn();
    const { result } = renderHook(() => useRecommendation(onError));
    await act(async () => { await result.current.submit("Help me move"); await result.current.submit("Next month"); });
    expect(result.current.showRecommendation).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("without the knowledge summary"));
    await act(async () => { expect(await result.current.submit("Confirm knowledge summary")).toBe(false); });
  });

  it("carries a reloaded upload into the next profile check without restoring approval", async () => {
    const { result } = renderHook(() => useRecommendation());
    act(() => result.current.hydrate({ messages: [{ role: "user", text: "Help me move" }], uploadContext: "Confirmed upload details" }));
    await act(async () => { await result.current.submit("Continue checking the move"); });
    expect(mocks.next.mock.calls[0]?.[0].extractedText).toBe("Confirmed upload details");
    expect(result.current.showRecommendation).toBe(false);
  });

  it("rejects confirmation during an account transition before the UI rerenders", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useRecommendation(onError));
    await act(async () => { await result.current.submit("Help me move"); await result.current.submit("Next month"); });
    recordBrowserPrincipal(undefined);
    await act(async () => { expect(await result.current.submit("Confirm knowledge summary")).toBe(false); });
    expect(result.current.showRecommendation).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("sign-in changed"));
  });

});
