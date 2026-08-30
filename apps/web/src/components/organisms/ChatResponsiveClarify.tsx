"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@/components/atoms/Spinner";
import styles from "./ChatResponsiveClarify.module.css";

export type ClarifyRole = "ted" | "user";

export interface ClarifyMessage {
  id: string;
  role: ClarifyRole;
  text: string;
  /**
   * 3-4 selectable answers for this question, only when TED judged the
   * answer space genuinely small and enumerable. The free-text box stays
   * available regardless — these are a shortcut, not a replacement.
   */
  options?: string[] | null;
}

interface ChatResponsiveClarifyProps {
  /** The conversation so far, oldest first. Supplied by the orchestration layer. */
  messages: ClarifyMessage[];
  /** True while TED is working out the next question (or the recommendation). */
  thinking?: boolean;
  /** Called when the user taps a selectable answer instead of typing. */
  onSelectOption?: (option: string) => void;
}

/**
 * ChatResponsiveClarify — TED's warm, adaptive clarification conversation.
 *
 * Each TED message is a single open question, responsive to the last answer.
 * The conversation continues until TED understands the intent well enough to
 * commit to a recommendation — there is no fixed exchange cap. It is not an
 * open-ended chat: it has a defined end state (the recommendation checkpoint),
 * and there is no "keep chatting" affordance here.
 *
 * This component is presentational: it renders the thread state it is given.
 * The orchestration layer (Layer 6) decides when to ask again vs. recommend.
 */
export function ChatResponsiveClarify({
  messages,
  thinking = false,
  onSelectOption,
}: ChatResponsiveClarifyProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking]);

  if (messages.length === 0 && !thinking) return null;

  const lastMessage = messages[messages.length - 1];
  // Only the most recent TED question is still awaiting an answer — options
  // on any earlier message are stale once the conversation has moved on.
  const activeOptions =
    !thinking && lastMessage?.role === "ted" && lastMessage.options?.length
      ? lastMessage.options
      : null;

  return (
    <div
      className={styles.thread}
      aria-label="Conversation with TED"
      aria-live="polite"
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`${styles.bubble} ${
            msg.role === "ted" ? styles.ted : styles.user
          }`}
        >
          {msg.role === "ted" && <span className={styles.who}>TED</span>}
          <p className={styles.text}>{msg.text}</p>
          {msg.id === lastMessage?.id && activeOptions && (
            <div className={styles.options} role="group" aria-label="Suggested answers">
              {activeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={styles.optionChip}
                  onClick={() => onSelectOption?.(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {thinking && (
        <div className={`${styles.bubble} ${styles.ted} ${styles.thinking}`}>
          <Spinner label="TED is thinking" size="sm" showLabel />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
