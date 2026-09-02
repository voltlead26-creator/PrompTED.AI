import { createReleaseAttestationResponse } from "./response";

// This route is generated from the one build-time revision supplied by the
// shell-safe production launcher. It lets both the draft and canonical origin
// prove which checked-out commit produced the bytes being exercised.
export const dynamic = "force-static";
export const revalidate = false;

export function GET(): Response {
  return createReleaseAttestationResponse(process.env.NEXT_PUBLIC_PROMPTED_BUILD_SHA);
}
