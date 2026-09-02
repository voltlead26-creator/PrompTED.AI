import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init,
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

describe("initAnalytics", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockReset();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "ph_test";
    delete process.env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING;
  });

  it("disables session recording by default and sets its sample rate to zero", async () => {
    const { initAnalytics } = await import("./analytics");
    initAnalytics();

    expect(init).toHaveBeenCalledWith(
      "ph_test",
      expect.objectContaining({
        autocapture: false,
        disable_session_recording: true,
        session_recording: expect.objectContaining({
          sampleRate: 0,
          maskAllInputs: true,
        }),
      }),
    );
  });

  it("keeps session recording disabled even when the public flag requests it", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING = "true";
    const { initAnalytics } = await import("./analytics");
    initAnalytics();

    expect(init).toHaveBeenCalledWith(
      "ph_test",
      expect.objectContaining({
        disable_session_recording: true,
        session_recording: expect.objectContaining({
          sampleRate: 0,
          maskAllInputs: true,
        }),
      }),
    );
  });
});
