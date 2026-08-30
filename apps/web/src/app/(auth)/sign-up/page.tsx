"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { createClient } from "@/lib/supabase/client";
import styles from "../AuthLayout.module.css";

export default function SignUpPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Supabase requires email confirmation before a session exists — signUp()
  // succeeding does NOT mean the user is logged in. Previously the page
  // routed to /home immediately, which looked like a successful sign-in
  // while the person was actually still signed out (TopBar correctly showed
  // "Sign in", which read as a bug because the redirect implied otherwise).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Please enter your name.";
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSubmitting(false);

    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        setErrors({ email: "An account with this email already exists." });
      } else {
        showToast({ message: "Something went wrong. Please try again.", tone: "error" });
      }
      return;
    }

    // If the project's "Confirm email" setting is ever turned off, signUp()
    // returns an active session immediately — showing "check your email"
    // in that case would be false. Only show it when there truly isn't a
    // session yet.
    if (data.session) {
      router.push("/home");
      return;
    }

    setPendingEmail(email.trim());
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

  async function handleGoogleSignUp() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  if (pendingEmail) {
    return (
      <div className={styles.authForm}>
        <h1 className={styles.heading}>Check your email</h1>
        <p className={styles.sub}>
          TED sent a confirmation link to <strong>{pendingEmail}</strong>. Open it to
          activate your account — this page won&apos;t sign you in until you do.
        </p>
        <Button
          type="button"
          fullWidth
          loading={resending}
          loadingLabel="Sending\u2026"
          onClick={handleResend}
          className={styles.submit}
        >
          Resend confirmation email
        </Button>
        <p className={styles.switchLink}>
          Wrong email?{" "}
          <button type="button" className={styles.linkButton} onClick={() => setPendingEmail(null)}>
            Go back
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.authForm}>
      <h1 className={styles.heading}>Create your account</h1>
      <p className={styles.sub}>Start free — no credit card required.</p>

      <button
        type="button"
        className={styles.oauthButton}
        onClick={handleGoogleSignUp}
        aria-label="Sign up with Google"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616Z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
          />
          <path
            fill="#FBBC05"
            d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
          />
        </svg>
        Continue with Google
      </button>

      <div className={styles.divider} role="separator" aria-hidden="true">
        <span>or</span>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-label="Create account">
        <Input
          label="Your name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          className={styles.field}
        />
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="At least 8 characters."
          className={styles.field}
        />
        <Button
          type="submit"
          fullWidth
          loading={submitting}
          loadingLabel="Creating account…"
          className={styles.submit}
        >
          Create account
        </Button>
      </form>

      <p className={styles.switchLink}>
        Already have an account?{" "}
        <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
