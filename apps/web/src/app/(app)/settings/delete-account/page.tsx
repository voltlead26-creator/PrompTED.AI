"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { createClient } from "@/lib/supabase/client";
import { purgeBrowserDataForUser } from "@/lib/browser-owner-data";
import {
  accountDeletionFailureMessage,
  isCompleteAccountDeletion,
} from "./deletion-feedback";
import styles from "../settings.module.css";

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

  const ownerUserId = user.id;
  const confirmed = confirmText.trim().toUpperCase() === "DELETE";

  async function handleDelete() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || data.session?.user.id !== ownerUserId) {
        setError(
          "Your session has expired. Sign in again, then try once more.",
        );
        setDeleting(false);
        return;
      }
      const res = await fetch("/api/account-delete", {
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
      let browserDataCleared = purgeBrowserDataForUser(ownerUserId);
      let localSessionCleared = true;
      const { data: currentData } = await supabase.auth.getSession();
      const currentOwnerUserId = currentData.session?.user.id ?? null;
      if (currentOwnerUserId && currentOwnerUserId !== ownerUserId) {
        // The destructive server result belongs to the captured owner, but a
        // different account now controls this browser. Never sign out, toast,
        // or navigate that newer principal from the stale component.
        return;
      }
      if (currentOwnerUserId === ownerUserId) {
        try {
          const signOutResult = await supabase.auth.signOut();
          localSessionCleared = !signOutResult?.error;
        } catch {
          localSessionCleared = false;
        }
      }
      // Signing out remounts the principal-bound tree. Its unmount cleanups may
      // flush same-owner editor state, so purge the deleted owner once more
      // after the session transition has settled.
      browserDataCleared = purgeBrowserDataForUser(ownerUserId) && browserDataCleared;
      const localCleanupComplete = browserDataCleared && localSessionCleared;
      showToast({
        tone: localCleanupComplete ? "success" : "error",
        message: localCleanupComplete
          ? "Your account and data have been deleted."
          : "Your account was deleted, but this browser could not clear every local cache. Clear this site's browser data before another person uses this device.",
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
