"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SubscriptionPlan } from "@/components/organisms/SubscriptionPlan";
import { PaywallModal } from "@/components/organisms/PaywallModal";
import { useAuth } from "@/components/providers";
import { useToast } from "@/components/atoms/Toast";
import { fetchUsageState } from "@/lib/usage";
import type { UsageState } from "@prompted/shared";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import styles from "../settings.module.css";

export default function AccountPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{
    ownerId: string;
    attempt: number;
    lease: OwnerDispatchLease | null;
    status: "loading" | "ready" | "error";
    value?: UsageState;
  } | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const userId = user?.id;
  const currentRead =
    read &&
    read.ownerId === userId &&
    read.attempt === attempt &&
    (!read.lease || ownerDispatchIsCurrent(read.lease))
      ? read
      : null;
  const usageState = currentRead?.status === "ready" ? currentRead.value : null;

  useEffect(() => {
    if (loading || !userId) return;
    const controller = new AbortController();
    let disposed = false;
    let lease: OwnerDispatchLease;
    try {
      lease = captureOwnerDispatch(userId);
    } catch {
      setRead({ ownerId: userId, attempt, lease: null, status: "error" });
      return;
    }
    const identity = { ownerId: userId, attempt, lease };
    setRead({ ...identity, status: "loading" });
    setPaywallOpen(false);
    const current = () => !disposed && ownerDispatchIsCurrent(lease);
    const timer = setTimeout(() => {
      if (current()) setRead({ ...identity, status: "error" });
      controller.abort();
    }, 30_000);
    void fetchUsageState(userId, controller.signal)
      .then((value) => {
        if (current() && !controller.signal.aborted)
          setRead({ ...identity, status: "ready", value });
      })
      .catch(() => {
        if (current() && !controller.signal.aborted) setRead({ ...identity, status: "error" });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, loading, userId]);

  if (loading) return null;
  if (!user) {
    router.replace("/sign-in");
    return null;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Account</h1>
        <p className={styles.userEmail}>{user.email}</p>
      </header>

      {usageState ? (
        <SubscriptionPlan
          plan={usageState.plan}
          access={usageState.access}
          documentsThisMonth={usageState.documentsThisMonth}
          subscriptionStatus={usageState.subscriptionStatus}
          currentPeriodEnd={usageState.currentPeriodEnd}
          onUpgrade={() => setPaywallOpen(true)}
        />
      ) : currentRead?.status === "error" ? (
        <div role="alert">
          <p>Your plan and usage could not be confirmed. Try loading them again.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry plan details
          </button>
        </div>
      ) : (
        <div aria-busy="true" aria-label="Loading plan details">
          Loading…
        </div>
      )}

      {usageState && (
        <PaywallModal
          open={paywallOpen}
          currentPlan={usageState.plan}
          onClose={() => setPaywallOpen(false)}
          onSelectPlan={() => {
            setPaywallOpen(false);
            showToast({
              message:
                "Online checkout isn't available yet. No upgrade request was sent, and your plan is unchanged.",
              tone: "info",
            });
          }}
        />
      )}

      <div className={styles.danger}>
        <h2 className={styles.dangerHeading}>Account</h2>
        <Link href="/sign-out" className={styles.signOutLink}>
          Sign out
        </Link>
        <Link href="/settings/delete-account" className={styles.deleteLink}>
          Delete account
        </Link>
      </div>
    </main>
  );
}
