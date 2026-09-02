import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const mocks = vi.hoisted(() => ({
  renderExport: vi.fn(),
  ensureApiConfigured: vi.fn(),
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
}));

vi.mock("@/lib/api", () => ({
  ensureApiConfigured: mocks.ensureApiConfigured,
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return { ...actual, renderExport: mocks.renderExport };
});

import { useExport, type ExportDeliveryResult } from "./useExport";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "77777777-7777-4777-8777-777777777777";

describe("useExport browser delivery truth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.renderExport.mockReset().mockResolvedValue({
      blob: new Blob(["synthetic-pdf"], { type: "application/pdf" }),
      filename: "synthetic.pdf",
      approvedSections: 1,
      capturedExportId: EXPORT_ID,
    });
    mocks.ensureApiConfigured.mockReset();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:synthetic"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports browser delivery, retains the object URL briefly, and never claims a saved file", async () => {
    const { result } = renderHook(() => useExport());
    const lease = testOwnerDispatchLease(USER_ID);
    const deliveries: Array<ExportDeliveryResult | null> = [];

    await act(async () => {
      deliveries.push(
        await result.current.run(
          {
            documentId: "33333333-3333-4333-8333-333333333333",
            title: "Synthetic",
            format: "pdf",
            sections: [],
            capturedExport: {
              exportId: EXPORT_ID,
              operationId: "55555555-5555-4555-8555-555555555555",
              expectedOperationRevision: 9,
            },
          },
          lease,
        ),
      );
    });
    const delivery = deliveries[0];

    expect(delivery).toMatchObject({
      state: "artifact_delivered_to_browser",
      capturedExportId: EXPORT_ID,
    });
    expect(delivery?.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  });

  it("rejects a mismatched owner before export or browser delivery", async () => {
    const { result } = renderHook(() => useExport());

    const deliveries: Array<ExportDeliveryResult | null> = [];
    await act(async () => {
      deliveries.push(
        await result.current.run(
          {
            documentId: "33333333-3333-4333-8333-333333333333",
            title: "Synthetic",
            format: "pdf",
            sections: [],
          },
          testOwnerDispatchLease("22222222-2222-4222-8222-222222222222"),
        ),
      );
    });
    expect(deliveries).toEqual([null]);

    expect(mocks.renderExport).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Sign in again before exporting this document.");
  });
});
