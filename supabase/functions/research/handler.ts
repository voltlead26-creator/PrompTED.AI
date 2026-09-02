import { AuthError } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";

export const RESEARCH_CLAIM_VERIFICATION_REQUIRED = {
  error: {
    code: "RESEARCH_CLAIM_VERIFICATION_REQUIRED",
    message:
      "Research results are temporarily unavailable until source-linked claims can be independently verified.",
    retryable: false,
  },
  grounding_status: "source_linked_not_independently_verified",
  persistence_eligible: false,
  completion_eligible: false,
} as const;

export interface ResearchGateDependencies {
  handleOptions(req: Request): Response | null;
  guardRequest(
    req: Request,
    options: { enforceCap: false },
  ): Promise<unknown>;
  jsonResponse(
    body: unknown,
    status: number,
    origin: string | null,
  ): Response;
  downstream: {
    readMemory(): Promise<unknown>;
    readDatabaseContent(): Promise<unknown>;
    callProvider(): Promise<unknown>;
  };
}

export async function handleResearchRequest(
  req: Request,
  dependencies: ResearchGateDependencies,
): Promise<Response> {
  const options = dependencies.handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return dependencies.jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  try {
    await dependencies.guardRequest(req, { enforceCap: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return dependencies.jsonResponse(error.payload, error.status, origin);
    }
    return dependencies.jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  return dependencies.jsonResponse(
    RESEARCH_CLAIM_VERIFICATION_REQUIRED,
    409,
    origin,
  );
}
