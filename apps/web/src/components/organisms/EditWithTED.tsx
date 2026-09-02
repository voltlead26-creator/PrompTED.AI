"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { EditAction } from "@prompted/shared";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import styles from "./EditWithTED.module.css";

interface EditWithTEDProps {
  streaming: boolean;
  reconciling?: boolean;
  hasSelection: boolean;
  error?: string | null;
  onRun: (action: EditAction, instruction?: string) => void;
  onCancel: () => void;
}

interface ThreadMessage {
  id: number;
  role: "user" | "ted";
  text: string;
}

const QUICK_ACTIONS: Array<{ id: EditAction; label: string; icon: string; said: string }> = [
  { id: "improve", label: "Make clearer", icon: "wand", said: "Make this clearer." },
  { id: "shorten", label: "Shorten", icon: "arrows-minimize", said: "Make this shorter." },
  { id: "expand", label: "Expand", icon: "arrows-maximize", said: "Add useful detail." },
  { id: "change_tone", label: "Change tone", icon: "mood-smile", said: "Adjust the tone." },
  { id: "add_detail", label: "Add detail", icon: "plus", said: "Add concrete detail." },
];

let messageCounter = 0;
const nextId = () => (messageCounter += 1);

export function EditWithTED({
  streaming,
  reconciling = false,
  hasSelection,
  error,
  onRun,
  onCancel,
}: EditWithTEDProps) {
  const unavailable = streaming || reconciling;
  const [messages, setMessages] = useState<ThreadMessage[]>([
    {
      id: nextId(),
      role: "ted",
      text: "Tell me what you want changed, or choose a quick action. I’ll show you a suggestion before anything is applied.",
    },
  ]);
  const [input, setInput] = useState("");
  const awaitingRef = useRef(false);
  const prevStreamingRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const addMessage = (role: ThreadMessage["role"], text: string) =>
    setMessages((previous) => [...previous, { id: nextId(), role, text }]);

  useEffect(() => {
    const end = threadEndRef.current;
    if (typeof end?.scrollIntoView === "function") end.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming && awaitingRef.current) {
      awaitingRef.current = false;
      addMessage(
        "ted",
        error ?? "The suggestion is ready. Review it, then choose Apply, Try again or Discard.",
      );
    }
  }, [streaming, error]);

  const dispatch = (action: EditAction, said: string, instruction?: string) => {
    if (unavailable) return;
    addMessage("user", said);
    awaitingRef.current = true;
    const trimmed = instruction?.trim();
    onRun(action, trimmed || undefined);
  };

  const handleQuickAction = (action: EditAction, said: string) => {
    if (action === "change_tone") {
      const tone = input.trim();
      dispatch("change_tone", tone ? `Change the tone: ${tone}` : said, tone || undefined);
      if (tone) setInput("");
      return;
    }
    dispatch(action, said);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || unavailable) return;
    dispatch("improve", text, text);
    setInput("");
  };

  const handleCancel = () => {
    awaitingRef.current = false;
    onCancel();
    addMessage(
      "ted",
      "Cancellation requested. TED is reconciling the durable edit before another attempt can start. Your existing wording has not been changed.",
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <section className={styles.panel} aria-label="tEdit">
      <div className={styles.header}>
        <Icon name="sparkles" size={18} />
        <h3 className={styles.title}>tEdit</h3>
        {hasSelection && <span className={styles.scope}>Selected wording</span>}
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
        {unavailable && (
          <div className={`${styles.msg} ${styles.ted}`}>
            <span className={styles.avatar} aria-hidden="true">
              <Icon name="loader-2" size={15} />
            </span>
            <p className={styles.msgText}>
              {reconciling
                ? "TED is reconciling the durable edit…"
                : "TED is preparing a suggestion…"}
            </p>
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      <div className={styles.quickRow}>
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={styles.chip}
            onClick={() => handleQuickAction(action.id, action.said)}
            disabled={unavailable}
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
          placeholder="Tell TED what to change…"
          rows={2}
          disabled={unavailable}
          aria-label="Tell TED what to change"
        />
        {streaming ? (
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={unavailable || !input.trim()}
            leadingIcon={<Icon name="arrow-right" size={16} />}
          >
            Suggest
          </Button>
        )}
      </div>
    </section>
  );
}
