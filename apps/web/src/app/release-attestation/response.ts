const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
} as const;

export function createReleaseAttestationResponse(gitSha: string | undefined): Response {
  if (!GIT_SHA_PATTERN.test(gitSha ?? "")) {
    return Response.json(
      {
        error: {
          code: "RELEASE_ATTESTATION_UNAVAILABLE",
          message: "This release cannot attest its source revision.",
        },
      },
      { status: 503, headers: HEADERS },
    );
  }

  return Response.json({ schemaVersion: 1, gitSha }, { status: 200, headers: HEADERS });
}
