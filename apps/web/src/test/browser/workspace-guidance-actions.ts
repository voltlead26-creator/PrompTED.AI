// Controlled provider actions for browser presentation checks. No network or persistence.
import { useCallback, useState } from "react";
import type { ExplainResult } from "@prompted/shared";

declare global {
  interface Window {
    guidanceTest?: {
      hold: boolean;
      fail: boolean;
      requests: number;
      edits: Array<{ action: string; instruction?: string }>;
      release?: () => void;
    };
  }
}

export const answer: ExplainResult = {
  title: "The response deadline",
  plain_english: "The letter asks for a reply within 14 days. It does not say when that period starts.",
  why_it_matters: ["A clear start date helps the recipient know when to reply."],
  what_to_watch: ["Check the sending date and the requested response date."],
  missing_or_risky: ["The sending date is not stated in this wording."],
  suggested_next_step: "Confirm the sending date before approving the letter.",
};
const recover = async () => null;

export function useEditWithTED() {
  const [streaming, setStreaming] = useState(false);
  return {
    streaming, error: null, recover,
    cancel: () => setStreaming(false),
    run: async ({ action, instruction }: { action: string; instruction?: string }) => {
      window.guidanceTest!.edits.push({ action, instruction });
      setStreaming(true);
      await Promise.resolve();
      setStreaming(false);
      return { content: "Please reply within 14 days of receiving this letter.", changes: ["Made the response request more direct."], persisted: null };
    },
  };
}

export function useExplainWithTED(contextKey: string) {
  const [running, setRunning] = useState(false);
  const cancel = useCallback(() => setRunning(false), []);
  return {
    contextKey, running, error: null, cancel,
    run: async () => {
      const state = window.guidanceTest!;
      state.requests++;
      setRunning(true);
      if (state.hold) await new Promise<void>((resolve) => { state.release = resolve; });
      setRunning(false);
      return state.fail ? null : answer;
    },
  };
}
