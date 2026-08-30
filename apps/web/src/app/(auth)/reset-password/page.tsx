"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { createClient } from "@/lib/supabase/client";
import styles from "../AuthLayout.module.css";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // The reset email signs the person in via /auth/callback before landing
  // here. If someone opens this page without that session (bookmark, expired
  // link), send them to request a fresh link instead of showing a form that
  // can only fail.
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/forgot-password");
        return;
      }
      setCheckingSession(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setConfirmError("");

    if (password.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    if (confirm !== password) {
      setConfirmError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      const reason = error.message.toLowerCase();
      if (reason.includes("same") || reason.includes("different")) {
        setPasswordError("That's your current password — choose a new one.");
      } else {
        showToast({
          message: "Couldn't update your password. The link may have expired — request a new one.",
          tone: "error",
        });
      }
      return;
    }

    showToast({ message: "Password updated. You're signed in.", tone: "success" });
    router.replace("/home");
  }

  if (checkingSession) {
    return (
      <div className={styles.authForm}>
        <h1 className={styles.heading}>One moment…</h1>
        <p className={styles.sub}>Checking your reset link.</p>
      </div>
    );
  }

  return (
    <div className={styles.authForm}>
      <h1 className={styles.heading}>Choose a new password</h1>
      <p className={styles.sub}>You&apos;ll be signed in as soon as it&apos;s saved.</p>

      <form onSubmit={handleSubmit} noValidate aria-label="Set a new password">
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          hint="At least 8 characters."
          className={styles.field}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirmError}
          className={styles.field}
        />
        <Button
          type="submit"
          fullWidth
          loading={submitting}
          loadingLabel="Saving…"
          className={styles.submit}
        >
          Save new password
        </Button>
      </form>
    </div>
  );
}
