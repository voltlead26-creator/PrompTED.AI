"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import type { ExplainResult } from "@prompted/shared";
import styles from "./EditWithTED.module.css";

interface ExplainWithTEDProps {
  running: boolean;
  hasSelection: boolean;
  error?: string | null;
  result?: ExplainResult | null;
  onRun: (question?: string) => Promise<ExplainResult | null> | void;
  onCancel: () => void;
}

interface ThreadMessage {
  id: number;
  role: "user" | "ted";
  text: string;
}

const QUICK_PROMPTS: Array<{ label: string; icon: string; said: string; question: string }> = [
  {
    label: "Plain English",
    icon: "book",
    said: "Explain this section in plain English.",
    question: "Explain this section in plain English.",
  },
  {
    label: "Make simpler",
    icon: "adjustments",
    said: "Make this easier to understand.",
    question: "Make this easier to understand.",
  },
  {
    label: "Why it matters",
    icon: "info-circle",
    said: "Why does this matter?",
    question: "Why does this section matter?",
  },
  {
    label: "Watch for risks",
    icon: "alert-triangle",
    said: "What should I watch out for?",
    question: "What should I watch out for in this section?",
  },
];

let messageCounter = 1000;
const nextId = () => (messageCounter += 1);

function formatResult(result: ExplainResult): string {
  const parts: string[] = [];
  parts.push(result.title);
  parts.push("");
  parts.push(result.plain_english.trim());

  if (result.why_it_matters.length) {
    parts.push("");
    parts.push("Why it matters:");
    for (const item of result.why_it_matters) parts.push(`- ${item}`);
  }

  if (result.what_to_watch.length) {
    parts.push("");
    parts.push("What to watch:");
    for (const item of result.what_to_watch) parts.push(`- ${item}`);
  }

  if (result.missing_or_risky.length) {
    parts.push("");
    parts.push("Missing or risky:");
    for (const item of result.missing_or_risky) parts.push(`- ${item}`);
  }

  if (result.suggested_next_step) {
    parts.push("");
    parts.push(result.suggested_next_step);
  }

  return parts.join("\n").trim();
}

export function ExplainWithTED({
  running,
  hasSelection,
  error,
  result,
  onRun,
  onCancel,
}: ExplainWithTEDProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([
    {
      id: nextId(),
      role: "ted",
      text: "Ask TED to explain this section in plain English. You can type a question or tap a quick prompt.",
    },
  ]);
  const [input, setInput] = useState("");

  const awaitingRef = useRef(false);
  const prevRunningRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const addMessage = (role: ThreadMessage["role"], text: string) =>
    setMessages((prev) => [...prev, { id: nextId(), role, text }]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, running]);

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = running;
    if (wasRunning && !running && awaitingRef.current) {
      awaitingRef.current = false;
      if (error) {
        addMessage("ted", error);
      } else if (result) {
        addMessage("ted", formatResult(result));
      } else {
        addMessage("ted", "I couldn't explain that section just now.");
      }
    }
  }, [running, error, result]);

  const dispatch = (said: string, question?: string) => {
    if (running) return;
    addMessage("user", said);
    awaitingRef.current = true;
    onRun(question?.trim() || undefined);
  };

  const handleQuickPrompt = (said: string, question: string) => {
    dispatch(said, question);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || running) return;
    dispatch(text, text);
    setInput("");
  };

  const handleCancel = () => {
    awaitingRef.current = false;
    onCancel();
    addMessage("ted", "Okay, I’ve stopped there — the document is unchanged.");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <section className={styles.panel} aria-label="Explain this">
      <div className={styles.header}>
        <Icon name="book" size={18} />
        <h3 className={styles.title}>Explain this</h3>
        {hasSelection && <span className={styles.scope}>Applies to your selection</span>}
      </div>

      <div className={styles.thread} role="log" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.msg} ${message.role === "user" ? styles.user : styles.ted}`}
          >
            {message.role === "ted" && (
              <span className={styles.avatar} aria-hidden="true">
                <Icon name="message-chatbot" size={15} />
              </span>
            )}
            <p className={styles.msgText}>{message.text}</p>
          </div>
        ))}
        {running && (
          <div className={`${styles.msg} ${styles.ted}`}>
            <span className={styles.avatar} aria-hidden="true">
              <Icon name="loader-2" size={15} />
            </span>
            <p className={styles.msgText} aria-live="polite">
              TED is explaining…
            </p>
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      <div className={styles.quickRow}>
        {QUICK_PROMPTS.map((action) => (
          <button
            key={action.label}
            type="button"
            className={styles.chip}
            onClick={() => handleQuickPrompt(action.said, action.question)}
            disabled={running}
          >
            <Icon name={action.icon} size={14} />
            {action.label}
          </button>
        ))}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask TED to explain something in this section…"
          rows={2}
          disabled={running}
          aria-label="Ask TED to explain the section"
        />
        {running ? (
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!input.trim()}
            leadingIcon={<Icon name="arrow-right" size={16} />}
          >
            Send
          </Button>
        )}
      </div>
    </section>
  );
}
