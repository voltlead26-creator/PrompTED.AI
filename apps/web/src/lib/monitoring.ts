"use client";

import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, Exception, StackFrame } from "@sentry/nextjs";

let initialised = false;

const SAFE_EVENT_ID = /^[0-9a-f]{32}$/i;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/;
const SAFE_SOURCE_LOCATION = /^[A-Za-z0-9@_./:[\]()+~%=-]+$/;
const SAFE_SYMBOL = /^(?:[A-Za-z_$][A-Za-z0-9_$.[\]<>/:-]*|<anonymous>)$/;
const SAFE_LEVELS = new Set(["fatal", "error", "warning", "log", "info", "debug"]);
const SAFE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const PRIVATE_URL_BASE = "https://prompted.invalid";

function safeLabel(value: unknown, maxLength = 256): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !SAFE_LABEL.test(value)
  ) {
    return undefined;
  }
  return value;
}

function safeSymbol(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256 || !SAFE_SYMBOL.test(value)) {
    return undefined;
  }
  return value;
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function scrubUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return undefined;
  }
  try {
    const parsed = new URL(value, PRIVATE_URL_BASE);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    const path = parsed.pathname || "/";
    return parsed.origin === PRIVATE_URL_BASE ? path : parsed.origin + path;
  } catch {
    return undefined;
  }
}

function scrubSourceLocation(value: unknown): string | undefined {
  const url = scrubUrl(value);
  if (url) return url;
  if (typeof value !== "string") return undefined;
  const withoutQueryOrFragment = value.split(/[?#]/u, 1)[0];
  if (
    !withoutQueryOrFragment ||
    withoutQueryOrFragment.length > 512 ||
    !SAFE_SOURCE_LOCATION.test(withoutQueryOrFragment)
  ) {
    return undefined;
  }
  return withoutQueryOrFragment;
}

function scrubStackFrame(frame: StackFrame): StackFrame {
  const scrubbed: StackFrame = {};
  const filename = scrubSourceLocation(frame.filename);
  const functionName = safeSymbol(frame.function);
  const moduleName = safeLabel(frame.module);
  const platform = safeLabel(frame.platform, 64);
  const line = safeInteger(frame.lineno);
  const column = safeInteger(frame.colno);

  if (filename) scrubbed.filename = filename;
  if (functionName) scrubbed.function = functionName;
  if (moduleName) scrubbed.module = moduleName;
  if (platform) scrubbed.platform = platform;
  if (line !== undefined) scrubbed.lineno = line;
  if (column !== undefined) scrubbed.colno = column;
  if (typeof frame.in_app === "boolean") scrubbed.in_app = frame.in_app;
  return scrubbed;
}

type MonitoringMechanism = NonNullable<Exception["mechanism"]>;

function scrubMechanism(
  mechanism: MonitoringMechanism | undefined,
): MonitoringMechanism | undefined {
  const type = safeLabel(mechanism?.type, 64);
  if (!type || !mechanism) return undefined;
  const scrubbed: MonitoringMechanism = { type };
  if (typeof mechanism.handled === "boolean") scrubbed.handled = mechanism.handled;
  if (typeof mechanism.synthetic === "boolean") scrubbed.synthetic = mechanism.synthetic;
  if (typeof mechanism.is_exception_group === "boolean") {
    scrubbed.is_exception_group = mechanism.is_exception_group;
  }
  return scrubbed;
}

function scrubException(exception: Exception): Exception | null {
  const scrubbed: Exception = {};
  const type = safeLabel(exception.type, 128);
  const moduleName = safeLabel(exception.module);
  const mechanism = scrubMechanism(exception.mechanism);
  const frames = exception.stacktrace?.frames
    ?.map(scrubStackFrame)
    .filter((frame) => Object.keys(frame).length > 0);

  if (type) scrubbed.type = type;
  if (moduleName) scrubbed.module = moduleName;
  if (mechanism) scrubbed.mechanism = mechanism;
  if (frames?.length) scrubbed.stacktrace = { frames };
  return Object.keys(scrubbed).length > 0 ? scrubbed : null;
}

function scrubMonitoringEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: Partial<ErrorEvent> = {};
  if (typeof event.event_id === "string" && SAFE_EVENT_ID.test(event.event_id)) {
    scrubbed.event_id = event.event_id;
  }
  if (typeof event.timestamp === "number" && Number.isFinite(event.timestamp)) {
    scrubbed.timestamp = event.timestamp;
  }
  if (event.level && SAFE_LEVELS.has(event.level)) scrubbed.level = event.level;

  const platform = safeLabel(event.platform, 64);
  const environment = safeLabel(event.environment, 128);
  const release = safeLabel(event.release);
  if (platform) scrubbed.platform = platform;
  if (environment) scrubbed.environment = environment;
  if (release) scrubbed.release = release;

  const exceptions = event.exception?.values
    ?.map(scrubException)
    .filter((exception): exception is Exception => exception !== null);
  if (exceptions?.length) scrubbed.exception = { values: exceptions };

  const requestUrl = scrubUrl(event.request?.url);
  const requestMethod =
    typeof event.request?.method === "string" ? event.request.method.toUpperCase() : "";
  const safeMethod = SAFE_METHODS.has(requestMethod) ? requestMethod : undefined;
  if (requestUrl || safeMethod) {
    scrubbed.request = {};
    if (requestUrl) scrubbed.request.url = requestUrl;
    if (safeMethod) scrubbed.request.method = safeMethod;
  }

  return scrubbed as ErrorEvent;
}

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
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    // Rebuild outbound errors from a structural allowlist. This deliberately
    // excludes messages, values, content-bearing frame context, arbitrary
    // extras/tags/contexts, breadcrumbs, user data, and request payload data.
    beforeSend: scrubMonitoringEvent,
  });
  initialised = true;
}

/**
 * Capture an unhandled error. Use in catch blocks that would otherwise be silent.
 */
export function captureError(err: unknown): void {
  Sentry.captureException(err);
}
