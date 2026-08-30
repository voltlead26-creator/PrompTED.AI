"use client";

import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { createClient } from "@/lib/supabase/client";
import styles from "./AuthModal.module.css";

export type AuthModalMode = "sign-in" | "sign-up";

interface AuthModalProps {
  open: boolean;
  /** 'save' | 'export' — shown in the preamble */
  trigger: "save" | "export";
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * AuthModal — shown when an anonymous user tries to save or export.
 * Never shown before the user has a completed draft (FR-012).
 */
export function AuthModal({ open, trigger, onClose, onSuccess }: AuthModalProps) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<AuthModalMode>("sign-up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!open) return null;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (mode === "sign-up" && !name.trim()) next.name = "Please enter your name.";
    if (!email.trim()) next.email = "Email is required.";
    if (password.length < 8) next.password = "Password must be at least 8 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    const supabase = createClient();

    const { error } =
      mode === "sign-up"
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { display_name: name.trim() },
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          })
        : await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);

    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        setErrors({ email: "That email is already registered. Try signing in." });
      } else if (error.message.toLowerCase().includes("invalid")) {
        setErrors({ password: "Email or password is incorrect." });
      } else {
        showToast({ message: "Something went wrong. Please try again.", tone: "error" });
      }
      return;
    }

    if (mode === "sign-up") {
      setPendingEmail(email.trim());
      return;
    }

    onSuccess();
  }

  async function handleResend() {
    if (!pendingEmail || resending) return;

    setResending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    showToast({
      message: error
        ? "Couldn't request another email right now. Try again shortly."
        : "Confirmation requested. Check your inbox and spam folder in a few minutes.",
      tone: error ? "error" : "success",
    });
  }

  async function handleGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  const triggerLabel = trigger === "save" ? "save your work" : "export your document";

  if (pendingEmail) {
    return (
      <div className={styles.backdrop} role="presentation">
        <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="auth-modal-heading">
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2 id="auth-modal-heading" className={styles.heading}>Check your email</h2>
          <p className={styles.sub}>
            Confirm <strong>{pendingEmail}</strong> before signing in to {triggerLabel}.
          </p>
          <Button type="button" fullWidth loading={resending} loadingLabel="Sending…" onClick={handleResend}>
            Resend confirmation email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-heading"
      >
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <h2 id="auth-modal-heading" className={styles.heading}>
          {mode === "sign-up" ? "Create a free account" : "Welcome back"}
        </h2>
        <p className={styles.sub}>
          {mode === "sign-up"
            ? `Create a free account to ${triggerLabel}. Your work is waiting.`
            : `Sign in to ${triggerLabel} and pick up where you left off.`}
        </p>

        <button
          type="button"
          className={styles.oauthButton}
          onClick={handleGoogle}
          aria-label="Continue with Google"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616Z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" />
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" />
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" />
          </svg>
          Continue with Google
        </button>

        <div className={styles.divider} role="separator" aria-hidden="true">
          <span>or</span>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {mode === "sign-up" && (
            <Input
              label="Your name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              className={styles.field}
            />
          )}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            className={styles.field}
          />
          <Input
            label="Password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={mode === "sign-up" ? "At least 8 characters." : undefined}
            className={styles.field}
          />
          {mode === "sign-in" && (
            <p className={styles.switchLink} style={{ textAlign: "right", marginTop: 0 }}>
              <a href="/forgot-password">Forgot your password?</a>
            </p>
          )}
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            loadingLabel={mode === "sign-up" ? "Creating account…" : "Signing in…"}
          >
            {mode === "sign-up" ? "Create free account" : "Sign in"}
          </Button>
        </form>

        <p className={styles.switchLink}>
          {mode === "sign-up" ? (
            <>
              Already have an account?{" "}
              <button type="button" className={styles.switchBtn} onClick={() => setMode("sign-in")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New to PrompTED?{" "}
              <button type="button" className={styles.switchBtn} onClick={() => setMode("sign-up")}>
                Create a free account
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
