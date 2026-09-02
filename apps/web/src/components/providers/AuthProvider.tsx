"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { GuestMigrationResult } from "@/lib/guest-workspace-migration";
import {
  claimUnclaimedGuestWorkspacesForMigration,
  discardUnclaimedGuestWorkspaces,
  hasGuestWorkspaceForMigration,
  hasUnclaimedGuestWorkspaceForReview,
} from "@/lib/workspace-store";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  recordBrowserPrincipal,
} from "@/lib/browser-principal-state";

export type GuestMigrationStatus =
  | "idle"
  | "review_required"
  | "migrating"
  | "complete"
  | "failed";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  guestMigrationStatus: GuestMigrationStatus;
  guestMigrationResult: GuestMigrationResult | null;
  retryGuestMigration: () => void;
  confirmGuestMigration: () => void;
  discardGuestMigration: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  guestMigrationStatus: "idle",
  guestMigrationResult: null,
  retryGuestMigration: () => undefined,
  confirmGuestMigration: () => undefined,
  discardGuestMigration: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestMigrationStatus, setGuestMigrationStatus] = useState<GuestMigrationStatus>("idle");
  const [guestMigrationResult, setGuestMigrationResult] = useState<GuestMigrationResult | null>(null);
  const migratedUserRef = useRef<string | null>(null);
  const principalRef = useRef<string | null | undefined>(undefined);
  const migrationRunningUsersRef = useRef(new Set<string>());

  const runGuestMigration = useCallback(async (userId: string) => {
    if (migrationRunningUsersRef.current.has(userId)) return;
    const requestContext = captureOwnerDispatch(userId);
    migrationRunningUsersRef.current.add(userId);
    if (ownerDispatchIsCurrent(requestContext)) setGuestMigrationStatus("migrating");

    try {
      const { migrateGuestWorkspaces } = await import(
        "@/lib/guest-workspace-migration"
      );
      const result = await migrateGuestWorkspaces(userId, requestContext);
      if (ownerDispatchIsCurrent(requestContext)) {
        setGuestMigrationResult(result);
        setGuestMigrationStatus(
          result.failed > 0 || result.skipped > 0 || result.cleanupFailed > 0
            ? "failed"
            : "complete",
        );
        if (result.migrated > 0) router.refresh();
      }
    } catch {
      if (ownerDispatchIsCurrent(requestContext)) {
        setGuestMigrationResult(null);
        setGuestMigrationStatus("failed");
      }
    } finally {
      migrationRunningUsersRef.current.delete(userId);
    }
  }, [router]);

  const retryGuestMigration = useCallback(() => {
    if (!user?.id) return;
    if (hasGuestWorkspaceForMigration(user.id)) {
      void runGuestMigration(user.id);
    } else if (hasUnclaimedGuestWorkspaceForReview()) {
      setGuestMigrationStatus("review_required");
      setGuestMigrationResult(null);
    }
  }, [runGuestMigration, user?.id]);

  const confirmGuestMigration = useCallback(() => {
    if (!user?.id) return;
    const claimed = claimUnclaimedGuestWorkspacesForMigration(user.id);
    if (claimed > 0 || hasGuestWorkspaceForMigration(user.id)) {
      void runGuestMigration(user.id);
    } else {
      setGuestMigrationStatus("failed");
      setGuestMigrationResult(null);
    }
  }, [runGuestMigration, user?.id]);

  const discardGuestMigration = useCallback(() => {
    if (!user?.id) return;
    if (discardUnclaimedGuestWorkspaces()) {
      setGuestMigrationStatus("complete");
      setGuestMigrationResult({
        migrated: 0,
        skipped: 0,
        failed: 0,
        failedOutcomeIds: [],
        cleanupFailed: 0,
        cleanupFailedOutcomeIds: [],
      });
    } else {
      setGuestMigrationStatus("failed");
      setGuestMigrationResult(null);
    }
  }, [user?.id]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const applySession = (next: Session | null) => {
      if (!active) return;
      const nextPrincipal = next?.user.id ?? null;
      const previousPrincipal = principalRef.current;
      principalRef.current = nextPrincipal;
      recordBrowserPrincipal(nextPrincipal);
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
      if (previousPrincipal !== undefined && previousPrincipal !== nextPrincipal) {
        router.refresh();
      }
    };

    // Anonymous access has been removed entirely: PrompTED no longer
    // creates a Supabase auth session for unauthenticated visitors. A
    // signed-in, confirmed account is required before any workspace work.
    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      applySession(data.session);
    };

    void refresh();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleFocus = () => void refresh();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      recordBrowserPrincipal(undefined);
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [router]);

  useEffect(() => {
    if (!user?.id) {
      migratedUserRef.current = null;
      setGuestMigrationStatus("idle");
      setGuestMigrationResult(null);
      return;
    }
    if (migratedUserRef.current === user.id) return;
    migratedUserRef.current = user.id;
    if (hasGuestWorkspaceForMigration(user.id)) {
      void runGuestMigration(user.id);
    } else if (hasUnclaimedGuestWorkspaceForReview()) {
      setGuestMigrationStatus("review_required");
      setGuestMigrationResult(null);
    } else {
      setGuestMigrationStatus("complete");
      setGuestMigrationResult({
        migrated: 0,
        skipped: 0,
        failed: 0,
        failedOutcomeIds: [],
        cleanupFailed: 0,
        cleanupFailedOutcomeIds: [],
      });
    }
  }, [runGuestMigration, user?.id]);

  if (loading) {
    return <p role="status">Confirming your signed-in workspace…</p>;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        guestMigrationStatus,
        guestMigrationResult,
        retryGuestMigration,
        confirmGuestMigration,
        discardGuestMigration,
      }}
    >
      <Fragment key={user?.id ?? "anonymous"}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
