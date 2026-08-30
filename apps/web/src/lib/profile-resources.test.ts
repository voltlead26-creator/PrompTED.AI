import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProfileResourceAvailability,
  normaliseProfileDetails,
  ProfileResourceError,
  saveProfileDetails,
  type ProfileResourceSnapshot,
} from "./profile-resources";

const { createClient, getSession, refreshSession, rpc } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient }));

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
    createClient.mockReset();
    getSession.mockReset();
    refreshSession.mockReset();
    rpc.mockReset();
    createClient.mockReturnValue({
      auth: { getSession, refreshSession },
      rpc,
    });
  });

  it("saves using the cached session directly when it is not near expiry, without a live server round trip", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", email: "kai@example.com" },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    rpc.mockResolvedValue({ error: null });

    await saveProfileDetails({ ...EMPTY_DETAILS, fullName: "Kai Churchward" });

    expect(refreshSession).not.toHaveBeenCalled();
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

  it("refreshes an expiring session before saving", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "stale-user" },
          expires_at: Math.floor(Date.now() / 1000) - 5,
        },
      },
    });
    refreshSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "kai@example.com" }, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    });
    rpc.mockResolvedValue({ error: null });

    await saveProfileDetails({ ...EMPTY_DETAILS, fullName: "Kai Churchward" });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("throws a sign-in error rather than silently failing when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("no session") });

    await expect(
      saveProfileDetails({ ...EMPTY_DETAILS, fullName: "Kai Churchward" }),
    ).rejects.toThrow(ProfileResourceError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC rejection without silently changing protected fields", async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", email: "kai@example.com" },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    });
    rpc.mockResolvedValue({ error: new Error("rejected") });

    await expect(saveProfileDetails(EMPTY_DETAILS)).rejects.toThrow(
      "Your Profile couldn't be saved",
    );
  });
});
