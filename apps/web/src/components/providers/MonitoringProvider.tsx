"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

type AnalyticsModule = typeof import("@/lib/analytics");

/**
 * Initialises Sentry + PostHog once on mount and tracks page views and
 * user identity changes. Must be a child of AuthProvider.
 */
export function MonitoringProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const analyticsRef = useRef<AnalyticsModule | null>(null);
  const latestPathRef = useRef(pathname);
  const latestUserIdRef = useRef<string | null>(user?.id ?? null);

  latestPathRef.current = pathname;
  latestUserIdRef.current = user?.id ?? null;

  // Monitoring is optional and must not compete with the first useful screen.
  // The dynamic imports also keep both SDKs out of the critical client chunk.
  useEffect(() => {
    const hasSentry = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
    const hasAnalytics = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
    if (!hasSentry && !hasAnalytics) return;

    let cancelled = false;
    const start = async () => {
      if (hasSentry) {
        try {
          const monitoring = await import("@/lib/monitoring");
          if (!cancelled) monitoring.initMonitoring();
        } catch {
          // Monitoring is optional; a chunk or SDK failure cannot blank the app.
        }
      }

      if (hasAnalytics) {
        try {
          const analytics = await import("@/lib/analytics");
          if (cancelled) return;
          analytics.initAnalytics();
          analyticsRef.current = analytics;
          analytics.trackPageView(latestPathRef.current);
          const userId = latestUserIdRef.current;
          if (userId) analytics.identifyUser(userId);
          else analytics.resetAnalytics();
        } catch {
          // Analytics is optional and never owns application workflow state.
        }
      }
    };

    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const id = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(() => void start(), { timeout: 2_000 })
      : window.setTimeout(() => void start(), 1_000);

    return () => {
      cancelled = true;
      if (idleWindow.requestIdleCallback) idleWindow.cancelIdleCallback?.(id);
      else window.clearTimeout(id);
    };
  }, []);

  // Track page views on navigation.
  useEffect(() => {
    analyticsRef.current?.trackPageView(pathname);
  }, [pathname]);

  // Identify / reset analytics on auth state changes.
  useEffect(() => {
    if (user) {
      analyticsRef.current?.identifyUser(user.id);
    } else {
      analyticsRef.current?.resetAnalytics();
    }
  }, [user]);

  return <>{children}</>;
}
