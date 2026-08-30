"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { GuestMigrationResult } from "@/lib/guest-workspace-migration";

export type GuestMigrationStatus = "idle" | "migrating" | "complete" | "failed";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  guestMigrationStatus: GuestMigrationStatus;
  guestMigrationResult: GuestMigrationResult | null;
  retryGuestMigration: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  guestMigrationStatus: "idle",
  guestMigrationResult: null,
  retryGuestMigration: () => undefined,
});

function hasGuestWorkspace(): boolean {
  if (typeof window === "undefined") return false;
  for (let index = 0; index < sessionStorage.length; index += 1) {
    if (sessionStorage.key(index)?.startsWith("prompted:workspace:")) {
      return true;
    }
  }
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestMigrationStatus, setGuestMigrationStatus] = useState<GuestMigrationStatus>("idle");
  const [guestMigrationResult, setGuestMigrationResult] = useState<GuestMigrationResult | null>(null);
  const migratedUserRef = useRef<string | null>(null);
  const migrationRunningRef = useRef(false);

  const runGuestMigration = useCallback(async (userId: string) => {
    if (migrationRunningRef.current) return;
    migrationRunningRef.current = true;
    setGuestMigrationStatus("migrating");

    try {
      const { migrateGuestWorkspaces } = await import(
        "@/lib/guest-workspace-migration"
      );
      const result = await migrateGuestWorkspaces(userId);
      setGuestMigrationResult(result);
      setGuestMigrationStatus(result.failed > 0 ? "failed" : "complete");
    } catch {
      setGuestMigrationResult(null);
      setGuestMigrationStatus("failed");
    } finally {
      migrationRunningRef.current = false;
    }
  }, []);

  const retryGuestMigration = useCallback(() => {
    if (user?.id) void runGuestMigration(user.id);
  }, [runGuestMigration, user?.id]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const applySession = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
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
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      migratedUserRef.current = null;
      setGuestMigrationStatus("idle");
      setGuestMigrationResult(null);
      return;
    }
    if (migratedUserRef.current === user.id) return;
    migratedUserRef.current = user.id;
    if (hasGuestWorkspace()) {
      void runGuestMigration(user.id);
    } else {
      setGuestMigrationStatus("complete");
      setGuestMigrationResult({
        migrated: 0,
        skipped: 0,
        failed: 0,
        failedOutcomeIds: [],
      });
    }
  }, [runGuestMigration, user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        guestMigrationStatus,
        guestMigrationResult,
        retryGuestMigration,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
