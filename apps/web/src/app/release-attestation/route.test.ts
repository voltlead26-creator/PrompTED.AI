import { describe, expect, it } from "vitest";

import { createReleaseAttestationResponse } from "./response";

const BUILD_SHA = "5574dee72e02f44507b22bd3c761dfc9d3c3bd51";

describe("release attestation", () => {
  it("returns the immutable build commit with a non-cacheable public contract", async () => {
    const response = createReleaseAttestationResponse(BUILD_SHA);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      gitSha: BUILD_SHA,
    });
  });

  it.each([undefined, "", "0".repeat(39), BUILD_SHA.toUpperCase()])(
    "fails closed when the build commit is unavailable or invalid",
    async (gitSha) => {
      const response = createReleaseAttestationResponse(gitSha);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "RELEASE_ATTESTATION_UNAVAILABLE",
          message: "This release cannot attest its source revision.",
        },
      });
    },
  );
});
