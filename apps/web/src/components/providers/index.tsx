"use client";

import type { ReactNode } from "react";
import { QueryClientProvider } from "./QueryClientProvider";
import { AuthProvider } from "./AuthProvider";
import { ThemeProvider } from "./ThemeProvider";
import { TextSizeProvider } from "./TextSizeProvider";
import { ToastProvider } from "@/components/atoms/Toast";
import { MonitoringProvider } from "./MonitoringProvider";
import { useAuth } from "./AuthProvider";
import { GuestMigrationNotice } from "@/components/organisms/GuestMigrationNotice";
import { ensureApiConfigured } from "@/lib/api";

// Configure the process-wide shared client before any direct-route child can
// issue a request. The helper is browser-guarded and idempotent, so server
// module evaluation and hot reloads cannot create another browser client.
ensureApiConfigured();

function PrincipalBoundProviders({ children }: { children: ReactNode }) {
  const {
    guestMigrationStatus,
    guestMigrationResult,
    retryGuestMigration,
    confirmGuestMigration,
    discardGuestMigration,
  } = useAuth();

  return (
    <>
      <GuestMigrationNotice
        status={guestMigrationStatus}
        result={guestMigrationResult}
        onRetry={retryGuestMigration}
        onConfirm={confirmGuestMigration}
        onDiscard={discardGuestMigration}
      />
      <MonitoringProvider>
        <ThemeProvider>
          <TextSizeProvider>
            <ToastProvider>{children}</ToastProvider>
          </TextSizeProvider>
        </ThemeProvider>
      </MonitoringProvider>
    </>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider>
      <AuthProvider>
        <PrincipalBoundProviders>{children}</PrincipalBoundProviders>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export { useAuth } from "./AuthProvider";
export { useTheme } from "./ThemeProvider";
export type { ThemeMode } from "./ThemeProvider";
export { useTextSize } from "./TextSizeProvider";
export type { TextSize } from "./TextSizeProvider";
