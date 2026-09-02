import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandKit } from "@prompted/shared";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toast: vi.fn(),
  assertCurrent: vi.fn(),
  createObjectUrl: vi.fn(() => "blob:local-logo"),
  revokeObjectUrl: vi.fn(),
}));

vi.mock("@prompted/shared/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      public payload: unknown,
    ) {
      super(code);
    }
  },
  saveBrandKitOperation: mocks.save,
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "b6000000-0000-4000-8000-000000000001" } }),
}));

vi.mock("@/components/atoms/Toast", () => ({
  useToast: () => ({ showToast: mocks.toast }),
}));

vi.mock("@/lib/browser-principal-state", () => ({
  captureOwnerDispatch: () => ({
    expectedUserId: "b6000000-0000-4000-8000-000000000001",
    principalEpoch: 1,
    signal: new AbortController().signal,
    assertCurrent: mocks.assertCurrent,
  }),
  ownerDispatchIsCurrent: () => true,
}));

import { BrandKitEditor } from "./BrandKitEditor";

const BUSINESS_ID = "b7000000-0000-4000-8000-000000000001";

function kit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    id: "ba000000-0000-4000-8000-000000000001",
    business_id: BUSINESS_ID,
    logo_url: "https://project.test/storage/v1/object/public/assets/brand-kits/b7000000-0000-4000-8000-000000000001/logo.png",
    primary_colour: "#dc5430",
    secondary_colour: null,
    footer_text: "Trusted footer",
    revision: 3,
    logo_operation_id: null,
    logo_storage_path: null,
    logo_content_sha256: null,
    logo_media_type: null,
    logo_byte_length: null,
    logo_status: "legacy_unverified",
    updated_at: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mocks.createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: mocks.revokeObjectUrl,
  });
  mocks.save.mockResolvedValue(kit({
    revision: 4,
    logo_url: "https://project.test/storage/v1/object/public/assets/brand-kits/b7000000-0000-4000-8000-000000000001/logos/b9000000-0000-8000-8000-000000000001.png",
    logo_operation_id: "b9000000-0000-8000-8000-000000000001",
    logo_storage_path: "brand-kits/b7000000-0000-4000-8000-000000000001/logos/b9000000-0000-8000-8000-000000000001.png",
    logo_content_sha256: "a".repeat(64),
    logo_media_type: "image/png",
    logo_byte_length: 4,
    logo_status: "ready",
  }));
});

describe("BrandKitEditor durable logo lifecycle", () => {
  it("keeps selection local until Save and revokes the preview after authoritative completion", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <BrandKitEditor
        ownerUserId="b6000000-0000-4000-8000-000000000001"
        businessId={BUSINESS_ID}
        initial={kit()}
        onSave={onSave}
      />,
    );
    const file = new File([new Uint8Array([1, 2, 3, 4])], "new-logo.png", {
      type: "image/png",
    });
    await user.upload(container.querySelector('input[type="file"]')!, file);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", "blob:local-logo");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "Logo selected. Save brand kit to apply it.",
    }));

    await user.click(screen.getByRole("button", { name: "Save brand kit" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      businessId: BUSINESS_ID,
      expectedRevision: 3,
      logoAction: "replace",
      file,
    }), expect.objectContaining({ expectedUserId: expect.any(String) }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:local-logo");
    expect(screen.getByRole("status")).toHaveTextContent("Brand kit is saved.");
  });

  it("does not report removal or clear the old authoritative logo when deletion is uncertain", async () => {
    mocks.save.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(
      <BrandKitEditor
        ownerUserId="b6000000-0000-4000-8000-000000000001"
        businessId={BUSINESS_ID}
        initial={kit()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Your brand logo" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save brand kit" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      logoAction: "remove",
      file: null,
    }), expect.any(Object));
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved brand kit changes.");
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "error" }));
  });

  it("preserves a selected replacement after failure so the same operation can be retried", async () => {
    mocks.save.mockRejectedValueOnce(new Error("response lost"));
    const user = userEvent.setup();
    const { container } = render(
      <BrandKitEditor
        ownerUserId="b6000000-0000-4000-8000-000000000001"
        businessId={BUSINESS_ID}
        initial={kit()}
      />,
    );
    const file = new File([new Uint8Array([1, 2, 3, 4])], "retry.png", {
      type: "image/png",
    });
    await user.upload(container.querySelector('input[type="file"]')!, file);
    await user.click(screen.getByRole("button", { name: "Save brand kit" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", "blob:local-logo");
    await user.click(screen.getByRole("button", { name: "Save brand kit" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]![0]).toMatchObject({ file, logoAction: "replace" });
  });

  it("rejects invalid selection locally and revokes a live preview on unmount", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(
      <BrandKitEditor
        ownerUserId="b6000000-0000-4000-8000-000000000001"
        businessId={BUSINESS_ID}
        initial={kit()}
      />,
    );
    await user.upload(
      container.querySelector('input[type="file"]')!,
      new File(["svg"], "logo.svg", { type: "image/svg+xml" }),
    );
    expect(mocks.createObjectUrl).not.toHaveBeenCalled();
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File([new Uint8Array([1])], "logo.webp", { type: "image/webp" })],
      },
    });
    expect(mocks.createObjectUrl).toHaveBeenCalledOnce();
    unmount();
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:local-logo");
  });
});
