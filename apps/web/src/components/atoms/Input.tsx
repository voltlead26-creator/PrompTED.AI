import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Input.module.css";

interface BaseFieldProps {
  label: string;
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id">,
    BaseFieldProps {}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">,
    BaseFieldProps {
  multiline: true;
}

function fieldClasses(error?: string) {
  return [styles.field, error ? styles.fieldError : ""].filter(Boolean).join(" ");
}

/**
 * Input — labelled text field with hint + error wiring.
 * The label is always present (visually or via sr-only). Errors are announced
 * and linked with aria-describedby / aria-invalid.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hideLabel, hint, error, className, ...rest },
  ref,
) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`${styles.wrapper} ${className ?? ""}`.trim()}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : styles.label}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className={fieldClasses(error)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint && !error && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

/**
 * Textarea — the multiline counterpart of Input, same label/hint/error contract.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hideLabel, hint, error, className, multiline: _multiline, ...rest },
    ref,
  ) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy =
      [hintId, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <div className={`${styles.wrapper} ${className ?? ""}`.trim()}>
        <label htmlFor={id} className={hideLabel ? "sr-only" : styles.label}>
          {label}
        </label>
        <textarea
          id={id}
          ref={ref}
          className={fieldClasses(error)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {hint && !error && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}
        {error && (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        )}
      </div>
    );
  },
);
