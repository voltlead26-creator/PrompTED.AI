"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import type { ExplainResult } from "@prompted/shared";
import styles from "./EditWithTED.module.css";

interface ExplainWithTEDProps {
  running: boolean;
  hasSelection: boolean;
  error?: string | null;
  onRun: (question?: string) => Promise<ExplainResult | null>;
  onCancel: () => void;
}

type ThreadMessage = { id: number; role: "user" | "ted"; text?: string; answer?: ExplainResult };

function Explanation({ answer }: { answer: ExplainResult }) {
  const titleId = useId();
  return (
    <article className={styles.explanation} aria-labelledby={titleId}>
      <h4 id={titleId}>{answer.title}</h4>
      <p>{answer.plain_english}</p>
      {([
        ["Why it matters", answer.why_it_matters],
        ["What to check", answer.what_to_watch],
        ["Missing details or risks", answer.missing_or_risky],
      ] as const).map(([label, items]) => items.length > 0 && (
        <div key={label}>
          <h5>{label}</h5>
          <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      ))}
      {answer.suggested_next_step && (
        <div className={styles.nextStep}>
          <h5>Next step</h5>
          <p>{answer.suggested_next_step}</p>
        </div>
      )}
    </article>
  );
}

export function ExplainWithTED({ running, hasSelection, error, onRun, onCancel }: ExplainWithTEDProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const requestRef = useRef<symbol | null>(null);
  const messageId = useRef(0);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const threadRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const busy = running || submitting;
  const scope = hasSelection ? "the selected wording" : "this section";
  const prompts = [
    { label: "Plain English", question: `Explain ${scope} in plain English.` },
    { label: "Why it matters", question: `Why does ${scope} matter?` },
    { label: "What to check", question: `What should I check in ${scope} before using it?` },
    { label: "Next step", question: `What is the next useful step based on ${scope}?` },
  ];

  useEffect(() => () => { requestRef.current = null; cancelRef.current(); }, []);
  useEffect(() => {
    // Scroll only the conversation, keeping the document and page in place.
    if (threadRef.current && latestMessageRef.current) {
      threadRef.current.scrollTop = latestMessageRef.current.offsetTop;
    }
  }, [messages]);

  function addMessage(message: Omit<ThreadMessage, "id">) {
    const id = ++messageId.current;
    setMessages((previous) => [...previous, { ...message, id }]);
  }

  async function dispatch(question: string) {
    if (busy || requestRef.current) return;
    const token = Symbol("explanation");
    requestRef.current = token;
    setSubmitting(true);
    setLocalError(null);
    setLastQuestion(question);
    addMessage({ role: "user", text: question });
    try {
      const answer = await onRun(question);
      if (requestRef.current !== token) return;
      if (answer) addMessage({ role: "ted", answer });
      else setLocalError("TED could not explain this wording. Your document is unchanged; try again.");
    } catch {
      if (requestRef.current === token) {
        setLocalError("TED could not explain this wording. Your document is unchanged; try again.");
      }
    } finally {
      if (requestRef.current === token) { requestRef.current = null; setSubmitting(false); }
    }
  }

  function send() {
    const question = input.trim();
    if (!question || busy || requestRef.current) return;
    void dispatch(question);
    setInput("");
  }

  function cancel() {
    requestRef.current = null;
    setSubmitting(false);
    setLocalError(null);
    onCancel();
    addMessage({ role: "ted", text: "Explanation stopped. Your document is unchanged." });
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); send();
    }
  }

  return (
    <section className={styles.panel} aria-label="Explain this">
      <div className={styles.header}>
        <Icon name="book" size={18} />
        <h3 className={styles.title}>Explain this</h3>
        <span className={styles.scope}>{hasSelection ? "Selected wording" : "Whole section"}</span>
      </div>
      <p className={styles.guidance}>Understand what this wording means, what to check and what to do next. Explanations do not change your document.</p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the labelled explanation log. */}
      <div ref={threadRef} className={styles.thread} role="log" aria-label="TED explanations" aria-live="polite" tabIndex={0}>
        {messages.map((message, index) => (
          <div key={message.id} ref={index === messages.length - 1 ? latestMessageRef : undefined} className={`${styles.msg} ${message.role === "user" ? styles.user : styles.ted}`}>
            {message.answer ? <Explanation answer={message.answer} /> : <p className={styles.msgText}>{message.text}</p>}
          </div>
        ))}
        {busy && <p role="status" className={styles.guidance}>TED is explaining {hasSelection ? "your selection" : "this section"}…</p>}
      </div>
      {(error || localError) && !busy && <p role="alert" className={styles.error}>{error || localError}</p>}
      {localError && lastQuestion && !busy && <Button variant="ghost" size="sm" onClick={() => void dispatch(lastQuestion)}>Try explanation again</Button>}
      <div className={styles.quickRow}>
        {prompts.map(({ label, question }) => <button key={label} type="button" className={styles.chip} onClick={() => void dispatch(question)} disabled={busy}>{label}</button>)}
      </div>
      <div className={styles.composer}>
        <textarea className={styles.input} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={keyDown}
          placeholder="For example: What does this deadline mean?" rows={2} maxLength={500} disabled={busy} aria-label="Ask TED to explain the section" />
        {busy ? <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button> : <Button variant="primary" size="sm" onClick={send} disabled={!input.trim()}>Ask TED</Button>}
      </div>
    </section>
  );
}
