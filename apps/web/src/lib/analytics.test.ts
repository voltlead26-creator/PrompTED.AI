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

  it("disables session recording by default and masks all inputs", async () => {
    const { initAnalytics } = await import("./analytics");
    initAnalytics();

    expect(init).toHaveBeenCalledWith(
      "ph_test",
      expect.objectContaining({
        autocapture: false,
        disable_session_recording: true,
        session_recording: expect.objectContaining({ maskAllInputs: true }),
      }),
    );
  });

  it("enables masked session recording only through an explicit flag", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING = "true";
    const { initAnalytics } = await import("./analytics");
    initAnalytics();

    expect(init).toHaveBeenCalledWith(
      "ph_test",
      expect.objectContaining({
        disable_session_recording: false,
        session_recording: expect.objectContaining({ maskAllInputs: true }),
      }),
    );
  });
});
