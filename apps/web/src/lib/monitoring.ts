"use client";

import * as Sentry from "@sentry/nextjs";

let initialised = false;

/**
 * Initialise Sentry. Called once from the root layout.
 * No-ops if the DSN env var is absent (local dev without Sentry configured).
 */
export function initMonitoring(): void {
  if (initialised) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
    // Capture 10% of sessions as performance traces in production to keep quota low.
    tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === "production" ? 0.1 : 1.0,
    // Replay 1% of sessions; 10% of sessions with errors.
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 0.1,
    // Never log user content — only structural errors.
    beforeSend(event) {
      // Strip any request body that may contain user document text.
      if (event.request?.data) {
        event.request.data = "[filtered]";
      }
      return event;
    },
  });
  initialised = true;
}

/**
 * Capture an unhandled error. Use in catch blocks that would otherwise be silent.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(err, { extra: context });
}
