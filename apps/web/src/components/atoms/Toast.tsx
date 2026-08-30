"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Toast.module.css";

export type ToastTone = "info" | "success" | "error";

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Auto-dismiss after this many ms. Defaults: error 5000, otherwise 3000. */
  durationMs?: number;
}

interface ActiveToast extends Required<Omit<ToastOptions, "durationMs">> {
  id: number;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON: Record<ToastTone, string> = {
  info: "info-circle",
  success: "check",
  error: "alert-circle",
};

/**
 * ToastProvider — wraps the app and exposes `useToast()`.
 * Toasts are announced via an aria-live region (polite for info/success,
 * assertive for errors).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, tone = "info", durationMs }: ToastOptions) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      const ms = durationMs ?? (tone === "error" ? 5000 : 3000);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${styles[t.tone]}`}
            role={t.tone === "error" ? "alert" : "status"}
          >
            <Icon name={TONE_ICON[t.tone]} size={18} />
            <span className={styles.message}>{t.message}</span>
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
