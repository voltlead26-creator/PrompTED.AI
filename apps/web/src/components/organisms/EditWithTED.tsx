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
  onRun: (action: EditAction, instruction?: string) => void | Promise<unknown>;
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
  const [submitting, setSubmitting] = useState(false);
  const unavailable = streaming || reconciling || submitting;
  const [messages, setMessages] = useState<ThreadMessage[]>([
    {
      id: nextId(),
      role: "ted",
      text: "Tell me what you want changed, or choose a quick action. I’ll show you a suggestion before anything is applied.",
    },
  ]);
  const [input, setInput] = useState("");
  const [clarification, setClarification] = useState<"change_tone" | "add_detail" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const requestRef = useRef<symbol | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const addMessage = (role: ThreadMessage["role"], text: string) =>
    setMessages((previous) => [...previous, { id: nextId(), role, text }]);

  useEffect(() => {
    const end = threadEndRef.current;
    if (end?.parentElement) end.parentElement.scrollTop = end.offsetTop;
  }, [messages, streaming]);

  useEffect(() => () => { requestRef.current = null; }, []);

  const dispatch = async (action: EditAction, said: string, instruction?: string) => {
    if (unavailable || requestRef.current) return;
    const token = Symbol("edit");
    requestRef.current = token;
    setSubmitting(true);
    setLocalError(null);
    setClarification(null);
    addMessage("user", said);
    const trimmed = instruction?.trim();
    try {
      await onRun(action, trimmed || undefined);
    } catch {
      if (requestRef.current === token) {
        setLocalError("TED could not confirm this request. Check the document status before trying again.");
      }
    } finally {
      if (requestRef.current === token) { requestRef.current = null; setSubmitting(false); }
    }
  };

  const handleQuickAction = (action: EditAction, said: string) => {
    if (unavailable || requestRef.current) return;
    const instruction = input.trim();
    if ((action === "change_tone" || action === "add_detail") && !instruction) {
      setClarification(action);
      addMessage("ted", action === "change_tone"
        ? "Which tone would you like? Choose below or describe it in your own words."
        : "What facts should I add? Enter the names, dates, amounts or other details you want included. I’ll prepare a suggestion for you to review.");
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    void dispatch(action, instruction ? `${said} ${instruction}` : said, instruction || undefined);
    if (instruction) setInput("");
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || unavailable) return;
    void dispatch(clarification ?? "improve", text, text);
    setInput("");
  };

  const handleCancel = () => {
    requestRef.current = null;
    setSubmitting(false);
    onCancel();
    addMessage(
      "ted",
      "Stopping this request. TED will check its status before you can try again. Your existing wording has not been changed.",
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <section className={styles.panel} aria-label="tEdit">
      <div className={styles.header}>
        <Icon name="sparkles" size={18} />
        <h3 className={styles.title}>tEdit</h3>
        <span className={styles.scope}>{hasSelection ? "Selected wording" : "Whole section"}</span>
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
                ? "Checking your previous request before another edit can start…"
                : "TED is preparing a suggestion…"}
            </p>
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {(error || localError) && <p className={styles.error} role="alert">{error || localError}</p>}
      {clarification === "change_tone" && (
        <div className={styles.quickRow} role="group" aria-label="Choose a tone">
          {["Professional", "Friendly", "Direct"].map((tone) => (
            <button key={tone} type="button" className={styles.chip} disabled={unavailable}
              onClick={() => {
                if (unavailable || requestRef.current) return;
                void dispatch("change_tone", `Use a ${tone.toLowerCase()} tone.`, `Use a ${tone.toLowerCase()} tone. Preserve the meaning and supplied facts.`);
                setInput("");
              }}>
              {tone}
            </button>
          ))}
        </div>
      )}

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
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={clarification === "add_detail" ? "Enter only the facts you want added…" : clarification === "change_tone" ? "For example: professional and warm…" : "For example: make this clearer and keep all dates…"}
          rows={2}
          maxLength={500}
          disabled={unavailable}
          aria-label="Tell TED what to change"
        />
        {streaming || submitting ? (
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
