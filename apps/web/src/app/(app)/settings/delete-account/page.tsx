"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { createClient } from "@/lib/supabase/client";
import {
  accountDeletionFailureMessage,
  isCompleteAccountDeletion,
} from "./deletion-feedback";
import styles from "../settings.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export default function DeleteAccountPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { showToast } = useToast();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;

  if (!user) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Delete account</h1>
        </header>
        <p className={styles.dangerCopy}>
          You&apos;ll need to <Link href="/sign-in">sign in</Link>{" "}
          first to delete your account.
        </p>
      </main>
    );
  }

  const confirmed = confirmText.trim().toUpperCase() === "DELETE";

  async function handleDelete() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError(
          "Your session has expired. Sign in again, then try once more.",
        );
        setDeleting(false);
        return;
      }
      const res = await fetch(`${API_BASE}/account-delete`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      let responseBody: unknown = null;
      try {
        responseBody = await res.json();
      } catch {
        // A missing response body cannot prove that a destructive request did
        // not reach the server. The fallback below is intentionally cautious.
      }
      if (!res.ok || !isCompleteAccountDeletion(responseBody)) {
        setError(accountDeletionFailureMessage(responseBody));
        setDeleting(false);
        return;
      }
      try {
        await supabase.auth.signOut();
      } catch {
        // The server has already confirmed account deletion. Local session
        // cleanup failure must not turn that confirmed outcome into a false
        // partial-deletion message.
      }
      showToast({
        tone: "success",
        message: "Your account and data have been deleted.",
      });
      router.replace("/");
    } catch {
      setError(accountDeletionFailureMessage(null));
      setDeleting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Delete account</h1>
        <p className={styles.userEmail}>{user.email}</p>
      </header>

      <div className={styles.dangerCard}>
        <h2 className={styles.dangerHeading}>This can&apos;t be undone</h2>
        <p className={styles.dangerCopy}>
          Deleting your account permanently removes everything: your documents,
          uploads, saved roles, business profile and brand kit, and your
          sign-in. There is no recovery afterwards.
        </p>
        <p className={styles.dangerCopy}>
          If you only want a break, just sign out instead - everything will be
          waiting when you come back.
        </p>

        <Input
          label="Type DELETE to confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          className={styles.confirmField}
        />

        {error && (
          <p className={styles.dangerError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.dangerActions}>
          <Button
            variant="primary"
            onClick={() => void handleDelete()}
            disabled={!confirmed || deleting}
            loading={deleting}
            loadingLabel="Deleting..."
          >
            Permanently delete my account
          </Button>
          <Link href="/settings" className={styles.cancelLink}>
            Keep my account
          </Link>
        </div>
      </div>
    </main>
  );
}
