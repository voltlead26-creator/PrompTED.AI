"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { createClient } from "@/lib/supabase/client";
import styles from "../AuthLayout.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    setLinkExpired(
      new URLSearchParams(window.location.search).get("error") === "link_expired",
    );
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    if (!email.trim()) {
      setEmailError("Email is required.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setSubmitting(false);
    // Always show the same confirmation, whether or not the account exists.
    // Confirming "no account with that email" would let anyone probe which
    // emails have PrompTED accounts.
    setSent(true);
  }

  if (sent) {
    return (
      <div className={styles.authForm}>
        <h1 className={styles.heading}>Check your email</h1>
        <p className={styles.sub}>
          If an account exists for <strong>{email.trim()}</strong>, a link to set a
          new password is on its way. It can take a few minutes — check your spam
          folder too.
        </p>
        <p className={styles.switchLink}>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.authForm}>
      <h1 className={styles.heading}>Reset your password</h1>
      {linkExpired && (
        <p className={styles.sub} role="alert">
          <strong>That reset link has expired or was already used.</strong> Enter
          your email below and TED will send a fresh one.
        </p>
      )}
      <p className={styles.sub}>
        Enter your email and TED will send you a link to set a new one.
      </p>

      <form onSubmit={handleSubmit} noValidate aria-label="Request a password reset">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          className={styles.field}
        />
        <Button
          type="submit"
          fullWidth
          loading={submitting}
          loadingLabel="Sending…"
          className={styles.submit}
        >
          Email me a reset link
        </Button>
      </form>

      <p className={styles.switchLink}>
        Remembered it? <Link href="/sign-in">Back to sign in</Link>
      </p>
    </div>
  );
}
