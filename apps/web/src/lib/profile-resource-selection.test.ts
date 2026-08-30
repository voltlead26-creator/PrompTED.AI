import { describe, expect, it } from "vitest";
import type { ProfileResourceSnapshot } from "./profile-resources";
import {
  locationFromSelectedAddress,
  materializeSelectedProfileResources,
  resolveUnselectedRequiredFact,
} from "./profile-resource-selection";

const snapshot: ProfileResourceSnapshot = {
  details: {
    fullName: "Kai Churchward",
    preferredName: "Kai",
    email: "kai@example.com",
    phone: "0400000000",
    dateOfBirth: "1990-01-02",
    addressLine1: "1 Example Street",
    addressLine2: "",
    suburb: "Balaclava",
    state: "VIC",
    postcode: "3183",
    country: "Australia",
  },
  currentResume: {
    id: "current",
    uploadId: "upload-current",
    slot: "current",
    acceptedAt: "2026-08-12T00:00:00.000Z",
    sourceKind: "upload",
    fileName: "Current.pdf",
    fileType: "application/pdf",
    fileSizeBytes: 1000,
    storagePath: "user/current.pdf",
    extractedText: "Current resume text",
  },
  previousResume: null,
};

describe("profile resource selection resolution", () => {
  it("materializes only explicitly selected Profile values", () => {
    const selected = materializeSelectedProfileResources(snapshot, {
      personal: ["fullName", "email"],
      resume: null,
    });

    expect(selected).toEqual({
      facts: {
        fullName: "Kai Churchward",
        email: "kai@example.com",
      },
      resume: null,
    });
    expect(selected.facts).not.toHaveProperty("dateOfBirth");
    expect(selected.facts).not.toHaveProperty("address");
    expect(selected.facts).not.toHaveProperty("phone");
  });

  it("returns only the selected resume slot", () => {
    expect(materializeSelectedProfileResources(snapshot, {
      personal: [],
      resume: "current",
    }).resume?.uploadId).toBe("upload-current");

    expect(materializeSelectedProfileResources(snapshot, {
      personal: [],
      resume: "previous",
    }).resume).toBeNull();
  });

  it("uses a workflow-only manual value when supplied", () => {
    expect(resolveUnselectedRequiredFact({
      key: "address",
      manualValue: "10 Other Street",
      placeholderId: "address",
      placeholderLabel: "Address",
    })).toEqual({ kind: "manual", value: "10 Other Street" });
  });

  it("creates a declared TED placeholder instead of blank content", () => {
    expect(resolveUnselectedRequiredFact({
      key: "date_of_birth",
      leaveAsPlaceholder: true,
      placeholderId: "date_of_birth",
      placeholderLabel: "Date of birth",
    })).toEqual({
      kind: "placeholder",
      token: "{{TED_PLACEHOLDER:date_of_birth:Date of birth}}",
    });
  });

  it("refuses unresolved required facts rather than inventing or returning blank", () => {
    expect(() => resolveUnselectedRequiredFact({
      key: "phone",
      placeholderId: "phone",
      placeholderLabel: "Contact number",
    })).toThrow("PROFILE_FACT_UNRESOLVED:phone");
  });

  it("derives a short searchable location from a selected address, omitting the street", () => {
    expect(locationFromSelectedAddress({
      addressLine1: "1 Example Street",
      addressLine2: "",
      suburb: "Balaclava",
      state: "VIC",
      postcode: "3183",
      country: "Australia",
    })).toBe("Balaclava, VIC, 3183, Australia");
  });

  it("skips missing address parts rather than leaving stray commas", () => {
    expect(locationFromSelectedAddress({
      addressLine1: "",
      addressLine2: "",
      suburb: "Balaclava",
      state: "",
      postcode: "",
      country: "",
    })).toBe("Balaclava");
  });

  it("returns an empty string when no address was selected", () => {
    expect(locationFromSelectedAddress(undefined)).toBe("");
  });
});
