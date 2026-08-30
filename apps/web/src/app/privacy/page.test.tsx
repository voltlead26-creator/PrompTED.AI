import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  it("explains the personal-data lifecycle in plain language", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: /privacy/i })).toBeInTheDocument();
    for (const heading of [
      /information we collect/i,
      /uploaded documents/i,
      /AI processing/i,
      /analytics/i,
      /retention/i,
      /delete your data/i,
      /contact/i,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });
});
