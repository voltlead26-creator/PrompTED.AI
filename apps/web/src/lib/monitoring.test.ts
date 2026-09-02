import type { Event, EventHint } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  init: sentry.init,
  captureException: sentry.captureException,
}));

type BeforeSend = (event: Event, hint: EventHint) => Event | null | PromiseLike<Event | null>;

const PRIVATE_DOCUMENT = "DOCUMENT_BODY_4fc9c";
const PRIVATE_PROMPT = "PROMPT_TEXT_6a8de";
const PRIVATE_UPLOAD = "UPLOAD_TEXT_81bd2";
const PRIVATE_SOURCE = "SOURCE_TEXT_5cb31";
const PRIVATE_VALUES = [PRIVATE_DOCUMENT, PRIVATE_PROMPT, PRIVATE_UPLOAD, PRIVATE_SOURCE];

function readMonitoringOptions(): {
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  maxBreadcrumbs?: number;
  sendDefaultPii?: boolean;
  beforeBreadcrumb?: () => unknown;
  beforeSend?: BeforeSend;
} {
  const options = sentry.init.mock.calls[0]?.[0] as
    | {
        replaysSessionSampleRate?: number;
        replaysOnErrorSampleRate?: number;
        maxBreadcrumbs?: number;
        sendDefaultPii?: boolean;
        beforeBreadcrumb?: () => unknown;
        beforeSend?: BeforeSend;
      }
    | undefined;
  if (!options) throw new Error("Sentry.init was not called.");
  return options;
}

describe("monitoring privacy boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    sentry.init.mockReset();
    sentry.captureException.mockReset();
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    process.env.NEXT_PUBLIC_APP_ENV = "production";
  });

  it("disables replay and breadcrumb capture", async () => {
    const { initMonitoring } = await import("./monitoring");
    initMonitoring();

    const options = readMonitoringOptions();
    expect(options).toEqual(
      expect.objectContaining({
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        maxBreadcrumbs: 0,
        sendDefaultPii: false,
      }),
    );
    expect(options.beforeBreadcrumb?.()).toBeNull();
  });

  it("rebuilds error events from a structural allowlist without private content", async () => {
    const { initMonitoring } = await import("./monitoring");
    initMonitoring();

    const beforeSend = readMonitoringOptions().beforeSend;
    if (!beforeSend) throw new Error("Sentry beforeSend was not configured.");

    const unsafeEvent: Event = {
      event_id: "a".repeat(32),
      timestamp: 1_788_200_000.25,
      level: "error",
      platform: "javascript",
      environment: "production",
      release: "68124981a0f481f2a79a4c2a2bd09537e8afcbdc",
      message: PRIVATE_PROMPT,
      logentry: { message: PRIVATE_DOCUMENT, params: [PRIVATE_SOURCE] },
      logger: PRIVATE_SOURCE,
      transaction: `GET /outcomes?prompt=${PRIVATE_PROMPT}`,
      server_name: PRIVATE_UPLOAD,
      fingerprint: [PRIVATE_DOCUMENT],
      modules: { [PRIVATE_SOURCE]: PRIVATE_UPLOAD },
      exception: {
        values: [
          {
            type: "TypeError",
            value: PRIVATE_DOCUMENT,
            module: "workspace",
            mechanism: {
              type: "generic",
              handled: true,
              synthetic: false,
              source: PRIVATE_SOURCE,
              data: { prompt: PRIVATE_PROMPT },
            },
            stacktrace: {
              frames: [
                {
                  filename: `https://app.prompted.example/_next/static/chunks/workspace.js?prompt=${PRIVATE_PROMPT}#${PRIVATE_SOURCE}`,
                  function: "saveWorkspace",
                  module: "workspace",
                  platform: "javascript",
                  lineno: 41,
                  colno: 9,
                  in_app: true,
                  abs_path: PRIVATE_UPLOAD,
                  context_line: PRIVATE_DOCUMENT,
                  pre_context: [PRIVATE_PROMPT],
                  post_context: [PRIVATE_SOURCE],
                  vars: { upload: PRIVATE_UPLOAD },
                },
              ],
            },
          },
        ],
      },
      request: {
        url: `https://${PRIVATE_SOURCE}:${PRIVATE_UPLOAD}@app.prompted.example/outcomes/123?document=${PRIVATE_DOCUMENT}#${PRIVATE_PROMPT}`,
        method: "POST",
        data: { document: PRIVATE_DOCUMENT },
        query_string: { prompt: PRIVATE_PROMPT },
        cookies: { upload: PRIVATE_UPLOAD },
        env: { source: PRIVATE_SOURCE },
        headers: {
          authorization: PRIVATE_PROMPT,
          cookie: PRIVATE_DOCUMENT,
        },
      },
      extra: {
        document: PRIVATE_DOCUMENT,
        prompt: PRIVATE_PROMPT,
        upload: PRIVATE_UPLOAD,
        source: PRIVATE_SOURCE,
      },
      breadcrumbs: [
        {
          message: PRIVATE_UPLOAD,
          data: { source: PRIVATE_SOURCE },
        },
      ],
      contexts: {
        private: { document: PRIVATE_DOCUMENT },
      },
      tags: {
        prompt: PRIVATE_PROMPT,
      },
      user: {
        id: PRIVATE_DOCUMENT,
        email: `${PRIVATE_SOURCE}@example.com`,
      },
    };

    const scrubbed = await beforeSend(unsafeEvent, {});

    expect(scrubbed).toEqual({
      event_id: "a".repeat(32),
      timestamp: 1_788_200_000.25,
      level: "error",
      platform: "javascript",
      environment: "production",
      release: "68124981a0f481f2a79a4c2a2bd09537e8afcbdc",
      exception: {
        values: [
          {
            type: "TypeError",
            module: "workspace",
            mechanism: {
              type: "generic",
              handled: true,
              synthetic: false,
            },
            stacktrace: {
              frames: [
                {
                  filename: "https://app.prompted.example/_next/static/chunks/workspace.js",
                  function: "saveWorkspace",
                  module: "workspace",
                  platform: "javascript",
                  lineno: 41,
                  colno: 9,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      request: {
        url: "https://app.prompted.example/outcomes/123",
        method: "POST",
      },
    });
    const serialised = JSON.stringify(scrubbed);
    for (const privateValue of PRIVATE_VALUES) {
      expect(serialised).not.toContain(privateValue);
    }
    expect(unsafeEvent.extra).toEqual(expect.objectContaining({ document: PRIVATE_DOCUMENT }));
    expect(unsafeEvent.request?.data).toEqual({ document: PRIVATE_DOCUMENT });
  });

  it("never forwards caller-supplied extras through captureError", async () => {
    const { captureError } = await import("./monitoring");
    const error = new Error("Structural application failure");
    const callWithLegacyContext = captureError as unknown as (
      err: unknown,
      context: Record<string, unknown>,
    ) => void;

    callWithLegacyContext(error, {
      document: PRIVATE_DOCUMENT,
      prompt: PRIVATE_PROMPT,
      upload: PRIVATE_UPLOAD,
      source: PRIVATE_SOURCE,
    });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.captureException.mock.calls[0]).toHaveLength(1);
  });
});
