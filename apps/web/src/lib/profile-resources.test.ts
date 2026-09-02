import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProfileResourceAvailability,
  normaliseProfileDetails,
  saveProfileDetails,
  type ProfileResourceSnapshot,
} from "./profile-resources";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const { withOwnerSupabase, rpc } = vi.hoisted(() => ({
  withOwnerSupabase: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/owner-client", () => ({ withOwnerSupabase }));

const EMPTY_DETAILS = {
  fullName: "",
  preferredName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  country: "",
};

describe("profile-resources", () => {
  it("normalises stored profile values without inventing missing facts", () => {
    expect(normaliseProfileDetails({
      full_name: "  Kai Churchward  ",
      preferred_name: "  Kai ",
      phone: " 0400000000 ",
      date_of_birth: null,
      address_line_1: " 1 Example Street ",
      suburb: " Melbourne ",
    }, " kai@example.com ")).toEqual(expect.objectContaining({
      fullName: "Kai Churchward",
      preferredName: "Kai",
      email: "kai@example.com",
      phone: "0400000000",
      dateOfBirth: "",
      addressLine1: "1 Example Street",
      suburb: "Melbourne",
    }));
  });

  it("falls back to legacy display_name as the preferred name", () => {
    expect(normaliseProfileDetails({ display_name: "Kai" }, "").preferredName).toBe("Kai");
  });

  it("reports only resources that really exist", () => {
    const snapshot: ProfileResourceSnapshot = {
      details: {
        fullName: "Kai Churchward",
        preferredName: "Kai",
        email: "kai@example.com",
        phone: "",
        dateOfBirth: "",
        addressLine1: "",
        addressLine2: "",
        suburb: "Balaclava",
        state: "VIC",
        postcode: "3183",
        country: "Australia",
      },
      currentResume: {
        id: "resume-current",
        uploadId: "upload-current",
        slot: "current",
        acceptedAt: "2026-08-12T00:00:00.000Z",
        sourceKind: "upload",
        fileName: "resume.pdf",
        fileType: "application/pdf",
        fileSizeBytes: 1000,
        storagePath: "user/upload/resume.pdf",
        extractedText: "Resume text",
      },
      previousResume: null,
    };

    expect(getProfileResourceAvailability(snapshot)).toEqual({
      personal: {
        fullName: true,
        preferredName: true,
        dateOfBirth: false,
        address: true,
        email: true,
        phone: false,
      },
      currentResume: true,
      previousResume: false,
    });
  });
});

describe("saveProfileDetails", () => {
  beforeEach(() => {
    withOwnerSupabase.mockReset();
    rpc.mockReset();
    withOwnerSupabase.mockImplementation(async (_lease, operation) =>
      operation({ rpc }),
    );
  });

  it("saves through the exact immutable owner transport", async () => {
    rpc.mockResolvedValue({ error: null });
    const lease = testOwnerDispatchLease("user-1");

    await saveProfileDetails(
      { ...EMPTY_DETAILS, fullName: "Kai Churchward" },
      lease,
    );

    expect(withOwnerSupabase).toHaveBeenCalledWith(lease, expect.any(Function));
    expect(rpc).toHaveBeenCalledWith("update_own_profile_details", {
      p_display_name: "Kai Churchward",
      p_full_name: "Kai Churchward",
      p_preferred_name: null,
      p_phone: null,
      p_date_of_birth: null,
      p_address_line_1: null,
      p_address_line_2: null,
      p_suburb: null,
      p_state: null,
      p_postcode: null,
      p_country: null,
    });
  });

  it("does not reach the RPC when the owner transport rejects", async () => {
    withOwnerSupabase.mockRejectedValue(new Error("owner changed"));
    await expect(
      saveProfileDetails(
        { ...EMPTY_DETAILS, fullName: "Kai Churchward" },
        testOwnerDispatchLease("user-1"),
      ),
    ).rejects.toThrow("owner changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC rejection without silently changing protected fields", async () => {
    rpc.mockResolvedValue({ error: new Error("rejected") });

    await expect(
      saveProfileDetails(EMPTY_DETAILS, testOwnerDispatchLease("user-1")),
    ).rejects.toThrow("Your Profile couldn't be saved");
  });
});
