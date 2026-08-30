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
import styles from "../settings.module.css";

export default function AccountPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const [usageState, setUsageState] = useState<UsageState | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchUsageState(user.id).then(setUsageState);
  }, [user]);

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
          documentsThisMonth={usageState.documentsThisMonth}
          subscriptionStatus={usageState.subscriptionStatus}
          currentPeriodEnd={usageState.currentPeriodEnd}
          onUpgrade={() => setPaywallOpen(true)}
        />
      ) : (
        <div aria-busy="true" aria-label="Loading plan details">Loading…</div>
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
                "Thanks — TED's team will reach out about upgrading. Online checkout isn't live yet.",
              tone: "success",
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
