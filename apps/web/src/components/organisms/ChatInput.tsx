"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import {
  ACCEPT_ATTRIBUTE,
  type Attachment,
} from "@/hooks/useFileAttachment";
import styles from "./ChatInput.module.css";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  attachment: Attachment | null;
  onAttachFile: (file: File) => void;
  onRemoveAttachment: () => void;
  /** Plain-language attachment error, if any. */
  attachError?: string | null;
  /** Disables submit while a request is in flight. */
  busy?: boolean;
  /** Keeps a recovered situation immutable while allowing same-file reselection. */
  textReadOnly?: boolean;
  /** Placeholder; defaults to "Ask TED". */
  placeholder?: string;
  /** Accessible label for the textarea. */
  ariaLabel?: string;
  /** Label on the send button; defaults to "Ask TED". */
  submitLabel?: string;
  /** Enables durable uploads; embedded legacy conversations remain text-only. */
  allowAttachment?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 200;

// Minimal shape of the browser SpeechRecognition API (typed to avoid `any`).
type SpeechResultList = ArrayLike<ArrayLike<{ transcript: string } | undefined> | undefined>;
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  attachment,
  onAttachFile,
  onRemoveAttachment,
  attachError,
  busy = false,
  textReadOnly = false,
  placeholder = "Ask TED",
  ariaLabel = "What are you trying to achieve?",
  submitLabel = "Ask TED",
  allowAttachment = true,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [micSupported, setMicSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest value available to the async speech callback.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const canSubmit =
    (textReadOnly
      ? allowAttachment && attachment !== null
      : value.trim().length > 0 || (allowAttachment && attachment !== null)) &&
    !busy;

  // Auto-resize the textarea to fit content, up to a cap.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  // Detect speech-recognition support after mount (SSR-safe).
  useEffect(() => {
    setMicSupported(Boolean(getSpeechRecognition()));
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleMic = useCallback(() => {
    if (textReadOnly) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "en-AU";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alternative = event.results[i]?.[0];
        if (alternative?.transcript) {
          transcript += alternative.transcript;
        }
      }
      transcript = transcript.trim();
      if (transcript) {
        const current = valueRef.current.trim();
        onChange(current ? `${current} ${transcript}` : transcript);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening, onChange, textReadOnly]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onAttachFile(file);
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.composer}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={1}
          readOnly={textReadOnly}
          aria-readonly={textReadOnly || undefined}
        />
        <div className={styles.attachCol}>
          {micSupported && (
            <button
              type="button"
              className={`${styles.iconButton}${listening ? ` ${styles.recording}` : ""}`}
              onClick={toggleMic}
              disabled={busy || textReadOnly}
              aria-label={listening ? "Stop voice input" : "Speak instead of typing"}
              aria-pressed={listening}
              title={listening ? "Stop listening" : "Speak instead of typing"}
            >
              <Icon name="microphone" size={20} />
            </button>
          )}
          {allowAttachment ? (
            <>
              <button
                type="button"
                className={styles.uploadButton}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                aria-label="Upload a document into chat"
                title="Upload a document"
              >
                <span className={styles.uploadPlus} aria-hidden="true">+</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                className={styles.fileInput}
                accept={ACCEPT_ATTRIBUTE}
                onChange={handleFileChange}
                tabIndex={-1}
                aria-hidden="true"
              />
            </>
          ) : null}
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={onSubmit}
          disabled={!canSubmit}
          loading={busy}
          loadingLabel="Asking TED"
          className={styles.sendButton}
        >
          <span className={styles.sendLabel}>{submitLabel}</span>
          <Icon name="arrow-right" size={18} />
        </Button>
      </div>

      {listening && (
        <p className={styles.listeningHint} role="status">
          Listening… speak now, then pause when you’re done.
        </p>
      )}

      {allowAttachment && attachment && (
        <div className={styles.attachmentChip}>
          <Icon name="file" size={16} />
          <span className={styles.attachmentName}>{attachment.name}</span>
          <button
            type="button"
            className={styles.removeAttach}
            onClick={onRemoveAttachment}
            aria-label={`Remove ${attachment.name}`}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {allowAttachment && attachError && (
        <p className={styles.attachError} role="alert">
          {attachError}
        </p>
      )}

    </div>
  );
}
