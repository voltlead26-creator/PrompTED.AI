// =====================================================
// PrompTED — recommend
// Produces a recommendation: 1 primary + exactly 2 alternatives.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  buildSystemPrompt,
  type ClariPrefs,
  type Domain,
} from "../_shared/prompt-builder.ts";
import { parseModelJson } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import { lockExplicitJobDocument } from "../_shared/job-template-lock.ts";

interface RecommendBody {
  domain?: Domain;
  situation?: string;
  clari?: ClariPrefs;
}

const CATALOG_RECOMMENDATION_GUARD = `Recommendation catalogue guard:
- Recommend only PrompTED catalogue outputs by exact name.
- For a user seeking work, applying for work, unemployed, or saying "I need a job", recommend job-seeker outputs only: Resume, Cover Letter, Job-search Action Checklist, Interview Preparation Questions, Interview Script, Job Follow-up Email, or Reference Request.
- Never recommend Resignation Letter, Offer Letter, Terms of Employment, Induction Manual, Onboarding Checklist, Performance Review, or other employer/offboarding documents for a job-seeker request.
- Resignation-related documents are only suitable when the user explicitly says they are resigning, quitting, or giving notice.
- If the user asks for actual job/role ideas rather than a document, recommend Job-search Action Checklist first, with Resume and Cover Letter as alternatives.`;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isJobSeekerSituation(situation: string): boolean {
  const lower = situation.toLowerCase();
  const leaving =
    /\b(resign|resignation|quit|leaving my job|leave my job|notice period)\b/
      .test(lower);
  const hiring =
    /\b(hiring someone|hire someone|hire a|hiring a|offer letter|onboard|onboarding)\b/
      .test(lower);
  const seeking =
    /\b(i need a job|need a job|looking for (a )?(new )?job|find (a )?job|job search|job application|apply for|applying for|resume|cv|cover letter|interview|unemployed|lost my job|work asap|warehouse supervisor)\b/
      .test(
        lower,
      );
  return seeking && !leaving && !hiring;
}

function recommendationItem(
  name: string,
  reason: string,
  useCase: string,
): Record<string, unknown> {
  return {
    name,
    format: name.includes("Checklist") ? "checklist" : "document",
    reason,
    use_case: useCase,
    benefits: [
      "Matches the job-seeker workflow",
      "Uses the user's experience as context",
    ],
  };
}

function sanitiseJobSeekerRecommendation(
  parsed: unknown,
  situation: string,
): unknown {
  const explicitRequest = lockExplicitJobDocument(situation);
  if (explicitRequest) return explicitRequest;
  if (
    !isJobSeekerSituation(situation) || !parsed || typeof parsed !== "object"
  ) return parsed;

  const obj = parsed as Record<string, unknown>;
  const primary = obj.primary && typeof obj.primary === "object"
    ? obj.primary as Record<string, unknown>
    : {};
  const primaryText = [
    text(primary.name),
    text(primary.reason),
    text(primary.use_case),
  ].join(" ").toLowerCase();
  const invalidPrimary = !text(primary.name).trim() ||
    /\b(resignation|resign|offer letter|terms of employment|induction|onboarding|performance review)\b/
      .test(primaryText);

  if (!invalidPrimary) return parsed;

  return {
    primary: recommendationItem(
      "Resume",
      "A resume is the core document for applying for work and can use the user's uploaded experience directly.",
      "Applying for a new job",
    ),
    alternatives: [
      recommendationItem(
        "Cover Letter",
        "A cover letter connects the user's experience to a target role or employer.",
        "Applying for a specific role",
      ),
      recommendationItem(
        "Job-search Action Checklist",
        "A checklist turns the job search into concrete next steps.",
        "Planning and tracking the job search",
      ),
    ],
  };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  try {
    const body = auth.body as unknown as RecommendBody;
    const situation = String(body.situation ?? "").slice(0, 20000).trim();
    if (!situation) {
      return jsonResponse(
        { error: { message: "situation is required" } },
        400,
        origin,
      );
    }

    const memory = await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "recommend",
      domain: body.domain,
      clari: body.clari,
      extra: [memory, CATALOG_RECOMMENDATION_GUARD].filter(Boolean).join(
        "\n\n",
      ),
    });

    const result = await routeRequest({
      task: "recommend",
      systemPrompt,
      messages: [{ role: "user", content: `Situation: ${situation}` }],
      maxTokens: 2500,
      signal: req.signal,
    });

    let parsed = parseModelJson(result.text);

    // The model occasionally adds prose around the JSON or runs long on richer
    // situations (e.g. the "I need a job" bundle). Retry once with a strict
    // JSON-only nudge before giving up, so a single malformed reply never
    // dead-ends as a "snag".
    if (!parsed) {
      const retry = await routeRequest({
        task: "recommend",
        systemPrompt,
        messages: [
          {
            role: "user",
            content:
              `Situation: ${situation}\n\nRespond with ONLY the JSON object described in your instructions. No prose, no explanation, and no markdown code fences.`,
          },
        ],
        maxTokens: 2500,
        signal: req.signal,
      });
      parsed = parseModelJson(retry.text);
    }

    if (!parsed) {
      return jsonResponse(USER_SAFE_ERROR, 502, origin);
    }

    return jsonResponse(
      sanitiseJobSeekerRecommendation(parsed, situation),
      200,
      origin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
