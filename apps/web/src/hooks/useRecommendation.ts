"use client";

import { useCallback, useRef, useState } from "react";
import {
  jobMatch,
  recommend,
  type ClarifyTurn,
  type JobMatchResult,
} from "@prompted/shared/api-client";
import { clarifyShouldContinue, type IntentResult } from "@prompted/shared/orchestration";
import type { ConversationMessage } from "@prompted/shared/browser";
import type { ClarifyMessage } from "@/components/organisms/ChatResponsiveClarify";
import { useInterpretIntent } from "./useInterpretIntent";

export interface UseRecommendation {
  messages: ClarifyMessage[];
  thinking: boolean;
  result: IntentResult | null;
  conversationStarted: boolean;
  /** True once intent is clear and a recommendation is available. */
  showRecommendation: boolean;
  /** Seed TED with upload-derived context before the first recommendation turn. */
  seedUploadContext: (params: {
    uploadId?: string;
    fileName?: string;
    summary?: string;
    extractedText: string;
  }) => void;
  /** Clear any upload-derived context when the user abandons that upload. */
  clearUploadContext: () => void;
  /** Upload-derived context only, kept separate from the conversation transcript. */
  getUploadContext: () => string;
  /** Retained upload identifier used to load the complete extracted document server-side. */
  getUploadId: () => string | undefined;
  /** Combined context TED should carry into document generation. */
  getDocumentContext: () => string;
  /** Submit a user turn. `displayText` is what's shown in the thread. */
  submit: (typed: string, displayText?: string, extractedText?: string) => Promise<void>;
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
  const [messages, setMessages] = useState<ClarifyMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<IntentResult | null>(null);

  const msgId = useRef(0);
  const situationRef = useRef<string>("");
  const uploadContextRef = useRef<string>("");
  const uploadIdRef = useRef<string | undefined>(undefined);
  const historyRef = useRef<ClarifyTurn[]>([]);

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
      const cleanExtracted = extractedText.trim();
      const cleanSummary = summary?.trim() ?? "";
      const contextParts = [
        fileName ? `Uploaded file: ${fileName}` : "",
        cleanSummary ? `TED read: ${cleanSummary}` : "",
        cleanExtracted ? `Uploaded document text:\n${cleanExtracted}` : "",
      ].filter(Boolean);

      uploadContextRef.current = contextParts.join("\n\n");
      uploadIdRef.current = uploadId?.trim() || undefined;

      if (cleanSummary || cleanExtracted) {
        addMessage(
          "ted",
          cleanSummary
            ? `I read your upload. TED thinks it is: ${cleanSummary}`
            : `I read your upload and can use its content as context.`,
        );
      }
    },
    [addMessage],
  );

  const clearUploadContext = useCallback(() => {
    uploadContextRef.current = "";
    uploadIdRef.current = undefined;
  }, []);

  const getUploadContext = useCallback(() => uploadContextRef.current, []);
  const getUploadId = useCallback(() => uploadIdRef.current, []);

  const getDocumentContext = useCallback(() => {
    const transcript = messages
      .map((message) => `${message.role === "ted" ? "TED" : "User"}: ${message.text}`)
      .join("\n");
    return [
      situationRef.current && `Current situation:\n${situationRef.current}`,
      transcript && `Conversation transcript:\n${transcript}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [messages]);

  const applyResult = useCallback(
    (next: IntentResult) => {
      setResult(next);
      if (clarifyShouldContinue(next) && next.question) {
        addMessage("ted", next.question, next.questionOptions);
        historyRef.current.push({ role: "assistant", content: next.question });
      }
    },
    [addMessage],
  );

  const submit = useCallback(
    async (typed: string, displayText?: string, extractedText?: string) => {
      const trimmed = typed.trim();
      if (!trimmed && !displayText) return;

      addMessage("user", displayText ?? trimmed);

      // Fold any (possibly edited) uploaded document text into the carried
      // upload context so it is used now AND persists for later turns.
      const docText = extractedText?.trim();
      if (docText && !uploadContextRef.current.includes(docText)) {
        uploadContextRef.current = [uploadContextRef.current, `Uploaded document text:\n${docText}`]
          .filter(Boolean)
          .join("\n\n");
      }

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
          const contextParts = [
            trimmed && `User request: ${trimmed}`,
            !trimmed && displayText ? displayText : "",
          ].filter(Boolean);
          const firstUserContent =
            contextParts.length > 0 ? contextParts.join("\n\n") : displayText || trimmed || "";
          situationRef.current = firstUserContent;
          historyRef.current.push({ role: "user", content: firstUserContent });
          next = await api.start(firstUserContent, extractedText);
        } else {
          const answer = trimmed || "Please use the document I just uploaded.";
          historyRef.current.push({ role: "user", content: answer });
          next = await api.continue({
            situation: situationRef.current,
            domain: result?.domain,
            history: historyRef.current,
            answer,
            extractedText:
              [uploadContextRef.current, extractedText?.trim()].filter(Boolean).join("\n\n") ||
              undefined,
          });
        }
        // Every message is interpreted by TED first. TED — not a keyword
        // check — decides whether the user is explicitly asking for live
        // job openings. Because the decision is re-made from the latest
        // message each turn, the user can enter or leave the job-search
        // flow just by saying so.
        if (next.jobSearch) {
          const jobResult = await jobMatch({
            situation: combinedContext,
            experience: uploadContextRef.current || extractedText,
            location: extractLocation(combinedContext),
            history: historyRef.current,
          });
          const reply = formatJobMatch(jobResult);
          addMessage("ted", reply);
          historyRef.current.push({ role: "assistant", content: reply });
          if (!situationRef.current) situationRef.current = combinedContext;
          setResult(null);
          return;
        }

        applyResult(next);

        // Safety net: if TED neither asked a question nor produced a
        // recommendation, force a recommendation so the chat can never
        // silently stall mid-conversation.
        if (!clarifyShouldContinue(next) && !next.recommendation) {
          const forced = await recommend({
            situation: situationRef.current || trimmed,
            domain: next.domain,
          });
          setResult(forced);
        }
      } catch {
        onError?.("TED hit a small snag. Please try again in a moment.");
      } finally {
        setThinking(false);
      }
    },
    [addMessage, api, applyResult, result, onError],
  );

  const adjustUnderstanding = useCallback((next: string) => {
    setResult((prev) => (prev ? { ...prev, situation: next } : prev));
  }, []);

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
      historyRef.current = saved.map((m) => ({
        role: m.role === "ted" ? "assistant" : "user",
        content: m.text,
      }));
      setResult(null);
      setThinking(false);
    },
    [],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setResult(null);
    setThinking(false);
    situationRef.current = "";
    uploadContextRef.current = "";
    uploadIdRef.current = undefined;
    historyRef.current = [];
  }, []);

  return {
    messages,
    thinking,
    result,
    conversationStarted: messages.length > 0,
    showRecommendation: Boolean(result?.intentClear && result.recommendation),
    seedUploadContext,
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
