import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "ghost" | "danger" | "text";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. `loadingLabel` describes the wait. */
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  children: ReactNode;
}

/**
 * Button — primary interactive control.
 * Enforces 44×44 touch target, AA-contrast variants, visible focus,
 * and a labelled loading state (never a silent spinner).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel = "Loading",
    fullWidth = false,
    leadingIcon,
    disabled,
    children,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner label={loadingLabel} size={size === "lg" ? "md" : "sm"} />
      ) : (
        <>
          {leadingIcon}
          {children}
        </>
      )}
    </button>
  );
});
