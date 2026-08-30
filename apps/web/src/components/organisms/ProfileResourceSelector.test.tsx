import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProfileResourceSnapshot } from "@/lib/profile-resources";
import { ProfileResourceSelector } from "./ProfileResourceSelector";

const snapshot: ProfileResourceSnapshot = {
  details: {
    fullName: "Kai Churchward",
    preferredName: "Kai",
    email: "kai@example.com",
    phone: "",
    dateOfBirth: "",
    addressLine1: "1 Example Street",
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
    fileName: "Kai CV.pdf",
    fileType: "application/pdf",
    fileSizeBytes: 1234,
    storagePath: "user/upload/Kai-CV.pdf",
    extractedText: "Private resume text",
  },
  previousResume: null,
};

describe("ProfileResourceSelector", () => {
  it("shows resource titles without exposing raw personal values", () => {
    render(
      <ProfileResourceSelector
        snapshot={snapshot}
        value={{ personal: [], resume: null }}
        onChange={() => undefined}
        includeResumeResources
      />,
    );

    for (const title of ["Full name", "Preferred name", "Date of birth", "Address", "Email", "Contact number"]) {
      expect(screen.getByRole("checkbox", { name: title })).toBeInTheDocument();
    }
    expect(screen.queryByText("Kai Churchward")).not.toBeInTheDocument();
    expect(screen.queryByText("1 Example Street")).not.toBeInTheDocument();
    expect(screen.queryByText("Private resume text")).not.toBeInTheDocument();
  });

  it("marks missing values as Not saved and disables them", () => {
    render(
      <ProfileResourceSelector
        snapshot={snapshot}
        value={{ personal: [], resume: null }}
        onChange={() => undefined}
        includeResumeResources
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Date of birth" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Contact number" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Previous resume" })).toBeDisabled();
    expect(screen.getAllByText("Not saved").length).toBeGreaterThanOrEqual(3);
  });

  it("returns selected personal information only for the active workflow", () => {
    const onChange = vi.fn();
    render(
      <ProfileResourceSelector
        snapshot={snapshot}
        value={{ personal: [], resume: null }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("Full name"));
    expect(onChange).toHaveBeenCalledWith({ personal: ["fullName"], resume: null });
  });

  it("selects only one saved resume resource at a time", () => {
    const onChange = vi.fn();
    render(
      <ProfileResourceSelector
        snapshot={{ ...snapshot, previousResume: { ...snapshot.currentResume!, id: "previous", uploadId: "upload-previous", slot: "previous" } }}
        value={{ personal: [], resume: "current" }}
        onChange={onChange}
        includeResumeResources
      />,
    );

    fireEvent.click(screen.getByText("Previous resume"));
    expect(onChange).toHaveBeenCalledWith({ personal: [], resume: "previous" });
  });
});
