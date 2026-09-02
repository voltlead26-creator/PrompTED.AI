"use client";

import posthog from "posthog-js";

let initialised = false;

/**
 * Initialise PostHog. Called once from the root layout.
 * No-ops if the key env var is absent (local dev without PostHog configured).
 */
export function initAnalytics(): void {
  if (initialised || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";
  if (!key) return;

  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // Manual page tracking via App Router navigation
    persistence: "localStorage",
    // Respect user privacy: disable autocapture to avoid capturing document content.
    autocapture: false,
    // PrompTED handles document, prompt, source, and upload content. Session
    // recording stays off in every environment, including when an obsolete
    // public flag is present.
    disable_session_recording: true,
    session_recording: {
      sampleRate: 0,
      maskAllInputs: true,
      maskTextSelector: "*",
      maskInputOptions: { password: true },
    } as Record<string, unknown>,
  });
  initialised = true;
}

// ── North-star funnel events ──────────────────────────────────────────────────

/** Fired when a user submits their first situation on the home screen. */
export function trackOutcomeStarted(props: { domain?: string; is_anonymous: boolean }): void {
  posthog.capture("outcome_started", props);
}

/** Fired when a user confirms a template recommendation and begins drafting. */
export function trackRecommendationConfirmed(props: {
  template_id: string;
  template_name: string;
  bundle_id?: string;
}): void {
  posthog.capture("recommendation_confirmed", props);
}

/** Fired when a user approves all sections and exports the document. */
export function trackDocumentExported(props: {
  template_id: string;
  format: "pdf" | "word" | "excel";
  sections_count: number;
}): void {
  posthog.capture("document_exported", props);
}

/** Fired when a user completes a subscription purchase via RevenueCat. */
export function trackSubscriptionConverted(props: { plan: string; from_plan: string }): void {
  posthog.capture("subscription_converted", props);
}

/** Fired on every page navigation for funnel tracking. */
export function trackPageView(path: string): void {
  posthog.capture("$pageview", { $current_url: path });
}

/** Associate analytics events with the authenticated user. */
export function identifyUser(userId: string): void {
  posthog.identify(userId);
}

/** Reset analytics identity on sign-out. */
export function resetAnalytics(): void {
  posthog.reset();
}
