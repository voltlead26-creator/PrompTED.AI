import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ArtifactOutcomeAuthorizationCode =
  | "ARTIFACT_OUTCOME_ID_INVALID"
  | "ARTIFACT_OUTCOME_NOT_FOUND"
  | "ARTIFACT_OUTCOME_AUTHORIZATION_UNAVAILABLE";

export interface ArtifactOutcomeAuthorizationPayload {
  error: {
    code: ArtifactOutcomeAuthorizationCode;
    message: string;
    retryable: boolean;
  };
}

export class ArtifactOutcomeAuthorizationError extends Error {
  constructor(
    public readonly status: 400 | 404 | 503,
    public readonly code: ArtifactOutcomeAuthorizationCode,
    public readonly payload: ArtifactOutcomeAuthorizationPayload,
  ) {
    super(code);
    this.name = "ArtifactOutcomeAuthorizationError";
  }
}

function authorizationError(
  status: 400 | 404 | 503,
  code: ArtifactOutcomeAuthorizationCode,
  message: string,
  retryable: boolean,
): ArtifactOutcomeAuthorizationError {
  return new ArtifactOutcomeAuthorizationError(status, code, {
    error: { code, message, retryable },
  });
}

export function artifactOutcomeAuthorizationUnavailable(): ArtifactOutcomeAuthorizationError {
  return authorizationError(
    503,
    "ARTIFACT_OUTCOME_AUTHORIZATION_UNAVAILABLE",
    "TED could not confirm access to that outcome. Try again shortly.",
    true,
  );
}

/** Proves the exact outcome and authenticated owner before any downstream work. */
export async function requireOwnedArtifactOutcome(
  admin: SupabaseClient,
  userId: string,
  value: unknown,
): Promise<string> {
  const outcomeId = typeof value === "string" ? value.trim().toLowerCase() : "";
  const ownerId = userId.trim().toLowerCase();
  if (!UUID_PATTERN.test(outcomeId)) {
    throw authorizationError(
      400,
      "ARTIFACT_OUTCOME_ID_INVALID",
      "A valid outcome_id is required.",
      false,
    );
  }

  let result: { data: unknown; error: unknown };
  try {
    result = await admin
      .from("outcomes")
      .select("id, user_id")
      .eq("id", outcomeId)
      .eq("user_id", ownerId)
      .maybeSingle();
  } catch {
    throw artifactOutcomeAuthorizationUnavailable();
  }

  if (result.error) throw artifactOutcomeAuthorizationUnavailable();
  if (result.data === null) {
    throw authorizationError(
      404,
      "ARTIFACT_OUTCOME_NOT_FOUND",
      "That outcome is unavailable for this account.",
      false,
    );
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw artifactOutcomeAuthorizationUnavailable();
  }

  const row = result.data as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.user_id !== "string" ||
    row.id.toLowerCase() !== outcomeId ||
    row.user_id.toLowerCase() !== ownerId
  ) {
    throw artifactOutcomeAuthorizationUnavailable();
  }
  return outcomeId;
}
