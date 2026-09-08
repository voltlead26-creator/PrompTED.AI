"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  jobMatch,
  type ClarifyTurn,
  type JobMatchResult,
} from "@prompted/shared/api-client";
import { clarifyShouldContinue, type IntentResult } from "@prompted/shared/orchestration";
import type { ConversationMessage } from "@prompted/shared/browser";
import type { ClarifyMessage } from "@/components/organisms/ChatResponsiveClarify";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  OwnerDispatchError,
} from "@/lib/browser-principal-state";
import { useInterpretIntent } from "./useInterpretIntent";

export interface UseRecommendation {
  messages: ClarifyMessage[];
  thinking: boolean;
  result: IntentResult | null;
  conversationStarted: boolean;
  /** True only after the user confirms the current document knowledge summary. */
  showRecommendation: boolean;
  /** Seed TED with upload-derived context before the first recommendation turn. */
  seedUploadContext: (params: {
    uploadId?: string;
    fileName?: string;
    summary?: string;
    extractedText: string;
  }) => void;
  /** Replace the extracted body after user confirmation without duplicating source text. */
  replaceUploadContext: (extractedText: string) => void;
  /** Clear any upload-derived context when the user abandons that upload. */
  clearUploadContext: () => void;
  /** Upload-derived context only, kept separate from the conversation transcript. */
  getUploadContext: () => string;
  /** Retained upload identifier used to load the complete extracted document server-side. */
  getUploadId: () => string | undefined;
  /** Combined context TED should carry into document generation. */
  getDocumentContext: () => string;
  /** Submit a user turn. `displayText` is what's shown in the thread. */
  submit: (typed: string, displayText?: string, extractedText?: string) => Promise<boolean>;
  /** Apply an edited "understood" situation — re-runs clarification. */
  adjustUnderstanding: (next: string) => void;
  /** Rehydrate a saved thread so the chat can be continued where it left off. */
  hydrate: (params: {
    messages: ConversationMessage[];
    situation?: string;
    uploadContext?: string;
    uploadId?: string;
  }) => void;
  reset: () => void;
}

const CONFIRM_KNOWLEDGE = "Confirm knowledge summary";
const CORRECT_KNOWLEDGE = "Correct or add details";
// Matches clarify's factual-input budget; presentation labels stay out of it.
const MAX_CLARIFICATION_INPUT_CHARS = 20_000;

function extractLocation(text: string): string | undefined {
  const patterns = [
    /\bnear\s+([^.\n,]+(?:,\s*[^.\n]+)?)/i,
    /\bin\s+((?:richmond|melbourne|sydney|brisbane|perth|adelaide|canberra|hobart|darwin)[^.\n]*)/i,
    /\b(remote|melbourne|richmond,?\s*melbourne|richmond)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim() || match?.[0]?.trim();
    if (value) return value;
  }

  return undefined;
}

function formatJobMatch(result: JobMatchResult): string {
  if (result.need_more_context) {
    return result.ask || "Tell me a little more so I can find roles that genuinely fit.";
  }

  const lines = [
    result.summary || "I found role options that fit your brief.",
    result.location_used ? `Location used: ${result.location_used}` : "",
  ].filter(Boolean);

  const listings = (result.listings ?? []).slice(0, 4);
  if (listings.length > 0) {
    lines.push("", "Current openings:");
    listings.forEach((listing, index) => {
      const title = [listing.title, listing.employer].filter(Boolean).join(" at ") || "Role";
      const meta = [listing.location, listing.pay, listing.closing && `closes ${listing.closing}`]
        .filter(Boolean)
        .join(" | ");
      lines.push(
        `${index + 1}. ${title}`,
        meta ? `   ${meta}` : "",
        listing.why_fit ? `   Why it fits: ${listing.why_fit}` : "",
        listing.url ? `   Apply/source: ${listing.url}` : "",
      );
    });
  }

  const ideas = (result.role_ideas ?? []).slice(0, 5);
  if (ideas.length > 0) {
    lines.push("", "Roles worth targeting:");
    ideas.forEach((idea, index) => {
      const meta = [idea.industry, idea.typical_pay, idea.how_fast].filter(Boolean).join(" | ");
      lines.push(
        `${index + 1}. ${idea.role || "Role"}`,
        meta ? `   ${meta}` : "",
        idea.why_fit ? `   Why it fits: ${idea.why_fit}` : "",
        idea.first_steps?.length
          ? `   First steps: ${idea.first_steps.slice(0, 2).join("; ")}`
          : "",
      );
    });
  }

  if (result.tips?.length) {
    lines.push("", `Next: ${result.tips.slice(0, 3).join(" ")}`);
  }

  lines.push(
    "",
    "Open the source listing to apply. I can then tailor your resume or cover letter for any role you choose.",
  );

  return lines.filter((line) => line !== "").join("\n");
}

/**
 * useRecommendation — drives TED's adaptive clarification loop and the
 * resulting recommendation. No fixed exchange cap: clarification continues
 * until `clarifyShouldContinue` reports the intent is clear.
 */
export function useRecommendation(onError?: (message: string) => void): UseRecommendation {
  const api = useInterpretIntent();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ClarifyMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<IntentResult | null>(null);

  const msgId = useRef(0);
  const situationRef = useRef<string>("");
  const uploadContextRef = useRef<string>("");
  const uploadIdRef = useRef<string | undefined>(undefined);
  const uploadFileNameRef = useRef<string>("");
  const uploadSummaryRef = useRef<string>("");
  const uploadTextRef = useRef<string>("");
  const historyRef = useRef<ClarifyTurn[]>([]);
  const contextRevision = useRef(0);
  const submissionRef = useRef<symbol | null>(null);
  const pendingKnowledge = useRef<{ result: IntentResult; summary: string; revision: number; userId: string } | null>(null);
  const confirmedKnowledge = useRef<string | null>(null);

  const invalidateKnowledge = useCallback(() => {
    contextRevision.current += 1;
    pendingKnowledge.current = null;
    confirmedKnowledge.current = null;
    setResult(null);
  }, []);

  useEffect(() => {
    invalidateKnowledge();
    submissionRef.current = null;
    situationRef.current = "";
    historyRef.current = [];
    uploadContextRef.current = "";
    uploadIdRef.current = undefined;
    uploadTextRef.current = "";
    uploadFileNameRef.current = "";
    uploadSummaryRef.current = "";
    setMessages([]);
    setThinking(false);
    return () => { contextRevision.current += 1; };
  }, [user?.id, invalidateKnowledge]);

  const addMessage = useCallback(
    (role: "user" | "ted", text: string, options?: string[] | null) => {
      setMessages((prev) => [...prev, { id: `m${msgId.current++}`, role, text, options }]);
    },
    [],
  );

  const seedUploadContext = useCallback(
    ({
      uploadId,
      fileName,
      summary,
      extractedText,
    }: {
      uploadId?: string;
      fileName?: string;
      summary?: string;
      extractedText: string;
    }) => {
      invalidateKnowledge();
      const cleanExtracted = extractedText.trim();
      const cleanSummary = summary?.trim() ?? "";
      const cleanFileName = fileName?.trim() ?? "";
      const contextParts = [
        cleanFileName ? `Uploaded file: ${cleanFileName}` : "",
        cleanSummary ? `TED read: ${cleanSummary}` : "",
        cleanExtracted ? `Uploaded document text:\n${cleanExtracted}` : "",
      ].filter(Boolean);

      uploadContextRef.current = contextParts.join("\n\n");
      uploadIdRef.current = uploadId?.trim() || undefined;
      uploadFileNameRef.current = cleanFileName;
      uploadSummaryRef.current = cleanSummary;
      uploadTextRef.current = cleanExtracted;

      if (cleanSummary || cleanExtracted) {
        addMessage(
          "ted",
          cleanSummary
            ? `I read your upload. TED thinks it is: ${cleanSummary}`
            : `I read your upload and can use its content as context.`,
        );
      }
    },
    [addMessage, invalidateKnowledge],
  );

  const replaceUploadContext = useCallback((extractedText: string) => {
    invalidateKnowledge();
    const cleanExtracted = extractedText.trim();
    uploadTextRef.current = cleanExtracted;
    uploadContextRef.current = [
      uploadFileNameRef.current ? `Uploaded file: ${uploadFileNameRef.current}` : "",
      uploadSummaryRef.current ? `TED read: ${uploadSummaryRef.current}` : "",
      cleanExtracted ? `Uploaded document text:\n${cleanExtracted}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [invalidateKnowledge]);

  const clearUploadContext = useCallback(() => {
    invalidateKnowledge();
    uploadContextRef.current = "";
    uploadIdRef.current = undefined;
    uploadFileNameRef.current = "";
    uploadSummaryRef.current = "";
    uploadTextRef.current = "";
  }, [invalidateKnowledge]);

  const getUploadContext = useCallback(() => uploadContextRef.current, []);
  const getUploadId = useCallback(() => uploadIdRef.current, []);

  const getDocumentContext = useCallback(() => {
    const transcript = messages
      .map((message) => `${message.role === "ted" ? "TED" : "User"}: ${message.text}`)
      .join("\n");
    return [
      confirmedKnowledge.current && `User-confirmed knowledge summary:\n${confirmedKnowledge.current}\nUse this confirmed brief over superseded summaries in the transcript.`,
      situationRef.current && `Current situation:\n${situationRef.current}`,
      transcript && `Conversation transcript:\n${transcript}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [messages]);

  const applyResult = useCallback(
    (next: IntentResult) => {
      if (clarifyShouldContinue(next) && next.question) {
        setResult(next);
        addMessage("ted", next.question, next.questionOptions);
        historyRef.current.push({ role: "assistant", content: next.question });
      } else if (next.intentClear && next.recommendation && user?.id) {
        const summary = next.knowledgeSummary?.trim();
        if (!summary) {
          setResult(null);
          onError?.("TED returned a document suggestion without the knowledge summary. Your answers are kept; please retry so you can review the details before continuing.");
          return;
        }
        const gaps = next.missingInformation.length
          ? `\n\nStill missing or unresolved:\n${next.missingInformation.map((item) => `- ${item}`).join("\n")}`
          : "";
        const question = `Knowledge summary — please review\n\n${summary}${gaps}\n\nIs this accurate and complete enough for the proposed document? Confirm this summary, or correct or add details before continuing.`;
        pendingKnowledge.current = { result: next, summary: `${summary}${gaps}`, revision: contextRevision.current, userId: user.id };
        setResult({ ...next, intentClear: false, recommendation: null, question, questionOptions: [CONFIRM_KNOWLEDGE, CORRECT_KNOWLEDGE] });
        addMessage("ted", question, [CONFIRM_KNOWLEDGE, CORRECT_KNOWLEDGE]);
        historyRef.current.push({ role: "assistant", content: question });
      } else {
        setResult(null);
        onError?.("TED couldn't finish checking the document requirements. Your answers are kept; please try again.");
      }
    },
    [addMessage, onError, user?.id],
  );

  const submit = useCallback(
    async (typed: string, displayText?: string, extractedText?: string) => {
      const trimmed = typed.trim();
      if (!trimmed && !displayText) return false;
      if (!user?.id || submissionRef.current) return false;
      if ((trimmed || displayText?.trim() || "").length > MAX_CLARIFICATION_INPUT_CHARS) {
        onError?.("This message is longer than 20,000 characters. Shorten it before sending; your existing answers have not been changed.");
        return false;
      }
      let requestContext;
      try {
        requestContext = captureOwnerDispatch(user.id);
      } catch (error) {
        if (!(error instanceof OwnerDispatchError)) throw error;
        invalidateKnowledge();
        onError?.("Your sign-in changed. Please wait for your account to finish loading before continuing.");
        return false;
      }

      if (trimmed === CONFIRM_KNOWLEDGE && !extractedText) {
        const pending = pendingKnowledge.current;
        if (!pending || pending.userId !== user.id || pending.revision !== contextRevision.current) {
          onError?.("The knowledge summary needs to be refreshed after those changes. Tell TED what to update before confirming again.");
          return false;
        }
        requestContext.assertCurrent();
        addMessage("user", CONFIRM_KNOWLEDGE);
        historyRef.current.push({ role: "user", content: CONFIRM_KNOWLEDGE });
        confirmedKnowledge.current = pending.summary;
        pendingKnowledge.current = null;
        setResult(pending.result);
        return true;
      }

      if (trimmed === CORRECT_KNOWLEDGE && pendingKnowledge.current && !extractedText) {
        invalidateKnowledge();
        addMessage("user", CORRECT_KNOWLEDGE);
        const question = "What should I correct or add to the knowledge summary before I continue?";
        addMessage("ted", question);
        historyRef.current.push({ role: "assistant", content: question });
        return true;
      }

      invalidateKnowledge();
      const submission = Symbol("clarification");
      submissionRef.current = submission;

      addMessage("user", displayText ?? trimmed);

      // Fold any (possibly edited) uploaded document text into the carried
      // upload context so it is used now AND persists for later turns. The
      // confirmed body replaces the extraction; contradictory copies are
      // never appended to the durable source context.
      const docText = extractedText?.trim();
      if (docText) replaceUploadContext(docText);
      const effectiveExtractedText = uploadTextRef.current || docText || undefined;
      const revision = contextRevision.current;

      const isFirstTurn = situationRef.current === "";
      setThinking(true);

      try {
        const combinedContext = [
          situationRef.current,
          trimmed,
          displayText,
          uploadContextRef.current,
        ]
          .filter(Boolean)
          .join("\n\n");

        let next: IntentResult;
        if (isFirstTurn) {
          const firstUserContent = trimmed || displayText?.trim() || "";
          situationRef.current = firstUserContent;
          historyRef.current.push({ role: "user", content: firstUserContent });
          next = await api.start(firstUserContent, effectiveExtractedText, requestContext);
        } else {
          const answer = trimmed || "Please use the document I just uploaded.";
          historyRef.current.push({ role: "user", content: answer });
          next = await api.continue(
            {
              situation: situationRef.current,
              domain: result?.domain,
              history: historyRef.current,
              answer,
              extractedText: effectiveExtractedText || uploadContextRef.current || undefined,
            },
            requestContext,
          );
        }
        requestContext.assertCurrent();
        if (revision !== contextRevision.current) return false;
        // Every message is interpreted by TED first. TED — not a keyword
        // check — decides whether the user is explicitly asking for live
        // job openings. Because the decision is re-made from the latest
        // message each turn, the user can enter or leave the job-search
        // flow just by saying so.
        if (next.jobSearch) {
          const jobResult = await jobMatch(
            {
              situation: combinedContext,
              experience: uploadContextRef.current || extractedText,
              location: extractLocation(combinedContext),
              history: historyRef.current,
            },
            requestContext,
          );
          requestContext.assertCurrent();
          if (revision !== contextRevision.current) return false;
          const reply = formatJobMatch(jobResult);
          addMessage("ted", reply);
          historyRef.current.push({ role: "assistant", content: reply });
          if (!situationRef.current) situationRef.current = combinedContext;
          setResult(null);
          return true;
        }

        applyResult(next);

        return true;
      } catch {
        if (ownerDispatchIsCurrent(requestContext)) {
          onError?.("TED hit a small snag. Please try again in a moment.");
        }
        return false;
      } finally {
        if (submissionRef.current === submission) {
          submissionRef.current = null;
          if (ownerDispatchIsCurrent(requestContext)) setThinking(false);
        }
      }
    },
    [addMessage, api, applyResult, invalidateKnowledge, replaceUploadContext, result, onError, user?.id],
  );

  const adjustUnderstanding = useCallback((next: string) => {
    void submit(next);
  }, [submit]);

  const hydrate = useCallback(
    ({
      messages: saved,
      situation,
      uploadContext,
      uploadId,
    }: {
      messages: ConversationMessage[];
      situation?: string;
      uploadContext?: string;
      uploadId?: string;
    }) => {
      if (saved.length === 0 && !situation?.trim()) return;
      invalidateKnowledge();
      const hydrated = saved.map((m, i) => ({
        id: `m${i}`,
        role: m.role,
        text: m.text,
      }));
      msgId.current = hydrated.length;
      setMessages(hydrated);
      const firstUser = saved.find((m) => m.role === "user")?.text ?? "";
      // A non-empty situationRef means the next submit continues (not restarts).
      situationRef.current = situation?.trim() || firstUser || "(resumed conversation)";
      uploadContextRef.current = uploadContext?.trim() ?? "";
      uploadIdRef.current = uploadId?.trim() || undefined;
      uploadFileNameRef.current = "";
      uploadSummaryRef.current = "";
      uploadTextRef.current = "";
      historyRef.current = saved.map((m) => ({
        role: m.role === "ted" ? "assistant" : "user",
        content: m.text,
      }));
      setResult(null);
      setThinking(false);
    },
    [invalidateKnowledge],
  );

  const reset = useCallback(() => {
    invalidateKnowledge();
    submissionRef.current = null;
    setMessages([]);
    setResult(null);
    setThinking(false);
    situationRef.current = "";
    uploadContextRef.current = "";
    uploadIdRef.current = undefined;
    uploadFileNameRef.current = "";
    uploadSummaryRef.current = "";
    uploadTextRef.current = "";
    historyRef.current = [];
  }, [invalidateKnowledge]);

  return {
    messages,
    thinking,
    result,
    conversationStarted: messages.length > 0,
    showRecommendation: Boolean(result?.intentClear && result.recommendation),
    seedUploadContext,
    replaceUploadContext,
    clearUploadContext,
    getUploadContext,
    getUploadId,
    getDocumentContext,
    submit,
    adjustUnderstanding,
    hydrate,
    reset,
  };
}
