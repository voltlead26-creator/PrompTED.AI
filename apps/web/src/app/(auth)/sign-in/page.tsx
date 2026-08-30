"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { safeInternalReturnPath } from "@/lib/auth-return";
import { createClient } from "@/lib/supabase/client";
import styles from "../AuthLayout.module.css";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnPath = safeInternalReturnPath(searchParams.get("next"));
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  function authCallbackUrl(): string {
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", returnPath);
    return callback.toString();
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setPasswordError("");
    setUnconfirmedEmail(null);

    if (!email.trim()) {
      setEmailError("Email is required.");
      return;
    }
    if (!password) {
      setPasswordError("Password is required.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (error) {
      const reason = error.message.toLowerCase();
      if (reason.includes("email not confirmed") || reason.includes("email_not_confirmed")) {
        setUnconfirmedEmail(email.trim());
      } else if (reason.includes("invalid")) {
        setPasswordError("Email or password is incorrect.");
      } else {
        showToast({ message: "Something went wrong. Please try again.", tone: "error" });
      }
      return;
    }

    router.replace(returnPath);
  }

  async function handleResend() {
    if (!unconfirmedEmail || resending) return;
    setResending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: unconfirmedEmail,
      options: { emailRedirectTo: authCallbackUrl() },
    });
    setResending(false);
    showToast({
      message: error
        ? "Couldn't request another email right now. Try again shortly."
        : "Confirmation requested. Check your inbox and spam folder in a few minutes.",
      tone: error ? "error" : "success",
    });
  }

  async function handleGoogleSignIn() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authCallbackUrl() },
    });
    if (error) {
      showToast({ message: "Google sign-in could not start. Please try again.", tone: "error" });
    }
  }

  return (
    <div className={styles.authForm}>
      <h1 className={styles.heading}>Welcome back</h1>
      <p className={styles.sub}>Sign in to pick up where you left off.</p>

      <button
        type="button"
        className={styles.oauthButton}
        onClick={handleGoogleSignIn}
        aria-label="Sign in with Google"
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

      {unconfirmedEmail && (
        <div className={styles.inlineNotice} role="alert">
          <p>
            <strong>{unconfirmedEmail}</strong> hasn&apos;t been confirmed yet. Check your
            inbox for the link TED sent, or resend it below.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={resending}
            loadingLabel="Sending…"
            onClick={handleResend}
          >
            Resend confirmation email
          </Button>
        </div>
      )}

      <form onSubmit={handleEmailSignIn} noValidate aria-label="Sign in with email">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          className={styles.field}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          className={styles.field}
        />
        <p className={styles.switchLink} style={{ textAlign: "right", marginTop: 0 }}>
          <Link href="/forgot-password">Forgot your password?</Link>
        </p>
        <Button
          type="submit"
          fullWidth
          loading={submitting}
          loadingLabel="Signing in…"
          className={styles.submit}
        >
          Sign in
        </Button>
      </form>

      <p className={styles.switchLink}>
        New to PrompTED?{" "}
        <Link href="/sign-up">Create an account</Link>
      </p>
    </div>
  );
}

function SignInFallback() {
  return (
    <div className={styles.authForm} aria-busy="true" aria-live="polite">
      <h1 className={styles.heading}>Welcome back</h1>
      <p className={styles.sub}>Preparing sign in…</p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInForm />
    </Suspense>
  );
}
