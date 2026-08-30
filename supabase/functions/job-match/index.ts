// =====================================================
// PrompTED - job-match
// Surfaces REAL, current job vacancies near the user from the open
// web - government sites (*.gov.au) and employers' own career pages,
// never the big aggregators (Seek, Indeed). Returns a browsable list
// the user can open in their own browser (no apply-through-TED), plus
// role ideas grounded in a curated national dataset. Gated on having
// enough context to judge suitability.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { parseModelJson } from "../_shared/orchestration.ts";
import {
  type GroundedVacancy,
  groundJobMatchOutput,
  type ProviderWebSource,
  requestGroundedJobVacancies,
} from "../_shared/research-grounding.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface JobRole {
  role: string;
  industry: string;
  demand: "very high" | "high" | "moderate";
  typical_pay_aud: string;
  entry_requirements: string;
  fast_start: boolean;
  start_speed: string;
  where_to_apply: string[];
  notes: string;
  data_as_of: string;
}

interface JobMatchBody {
  situation?: string;
  experience?: string;
  location?: string;
  work_type?: string;
  distance?: string;
  role_focus?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

async function loadRoles(): Promise<{
  roles: JobRole[];
  source: "database" | "unavailable";
  dataAsOf: string | null;
}> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const admin = createClient(url, key);
      const { data, error } = await admin
        .from("job_market_roles")
        .select(
          "role,industry,demand,typical_pay_aud,entry_requirements,fast_start,start_speed,where_to_apply,notes,data_as_of",
        )
        .limit(60);
      if (!error && Array.isArray(data) && data.length > 0) {
        const roles = data as JobRole[];
        const dates = roles
          .map((role) => role.data_as_of)
          .filter((value): value is string =>
            typeof value === "string" && value.trim().length > 0
          );
        return {
          roles,
          source: "database",
          dataAsOf: dates.length > 0 ? [...new Set(dates)].join(", ") : null,
        };
      }
    }
  } catch (_e) {
    // fall through
  }
  // A missing or empty data table is not permission to revive the donor's
  // unverified bundled pay and labour-market snapshot. Live vacancies may
  // still be returned, but market claims fail closed until sourced rows exist.
  return { roles: [], source: "unavailable", dataAsOf: null };
}

// Live web search for REAL current vacancies. Government and employer
// career pages only; the big aggregators are explicitly excluded. Returns
// only what the search actually finds - never fabricated listings.
async function liveVacancies(
  location: string,
  brief: string,
  signal: AbortSignal,
): Promise<{ vacancies: GroundedVacancy[]; sources: ProviderWebSource[] }> {
  const where = location ||
    "the location mentioned in the user's context; if no location is present, return no vacancies";
  try {
    return await requestGroundedJobVacancies({
      systemPrompt: [
        "You are a careful job-vacancy researcher. Use web search to find REAL, currently-advertised vacancies relative to the user's location.",
        "COUNTRY: work out the user's country from their location. If no location can be determined, return an empty vacancies array.",
        "STRICT SOURCE RULES:",
        "- Only return vacancies from official GOVERNMENT job sites OR an employer's own careers page. Examples by country: United States - USAJOBS.gov and state / county / city *.gov career pages; Australia - Workforce Australia, APSjobs and *.gov.au state / health / education / council pages; other countries - their equivalent official government portals.",
        "- NEVER use large job-board aggregators. Do not return any listing whose URL is on Indeed, Seek, ZipRecruiter, Monster, or Glassdoor.",
        "- Only include a vacancy you actually found in a real search result, with its real, working source URL. If you are not sure a listing is real, leave it out.",
        "- If you cannot find real matching vacancies, return an empty array. Never invent vacancies, employers, or URLs.",
        "Return up to 8 of the most relevant, currently-open roles.",
        "Return the strict structured result. Copy each exact source URL into url. Source labels are derived from captured provider sources and must not be invented.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content:
            `Find current real job vacancies near ${where} suited to this person. Match the seniority and skills in the resume highlights - do not suggest roles far above or below their experience level. Context:\n${
              brief.slice(0, 3600)
            }`,
        },
      ],
      maxTokens: 1600,
      signal,
    });
  } catch (_e) {
    return { vacancies: [], sources: [] };
  }
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
    const body = auth.body as unknown as JobMatchBody;
    const situation = String(body.situation ?? "").slice(0, 20000).trim();
    const experience = String(body.experience ?? "").slice(0, 20000).trim();
    const location = String(body.location ?? "").slice(0, 200).trim();
    const workType = String(body.work_type ?? "").slice(0, 60).trim();
    const distance = String(body.distance ?? "").slice(0, 40).trim();
    const roleFocus = String(body.role_focus ?? "").slice(0, 300).trim();
    const history = Array.isArray(body.history)
      ? body.history.slice(-12).map((message) => ({
        role: message.role === "assistant"
          ? "assistant" as const
          : "user" as const,
        content: String(message.content ?? "").slice(0, 800).trim(),
      })).filter((message) => message.content)
      : [];
    const clarificationAnswers = history
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    if (!situation) {
      return jsonResponse(
        { error: { message: "situation is required" } },
        400,
        origin,
      );
    }

    // Search brief with a guaranteed resume budget: the vacancy hunt must see
    // the person's actual experience, not just their situation sentence.
    // (Previously the resume sat last in a 1600-char slice and was mostly
    // truncated away, so live listings matched the request but not the CV.)
    const searchBrief = [
      situation && `Situation: ${situation.slice(0, 600)}`,
      location && `Location: ${location}`,
      workType &&
      `Required work type: ${workType} \u2014 only return vacancies matching or clearly compatible with this arrangement`,
      distance && `Maximum travel distance: ${distance}`,
      roleFocus && `Role focus: ${roleFocus}`,
      experience &&
      `Resume highlights (match seniority, industries and skills to THIS): ${
        experience.slice(0, 2800)
      }`,
    ].filter(Boolean).join("\n");

    // The vacancy hunt uses live web search and can blow the function's wall
    // clock (observed 502s at ~85s). Race it against a hard 40s budget: role
    // ideas from the curated dataset are always available as the fallback,
    // so a slow search degrades results instead of killing the request.
    const vacancyBudget = new Promise<{
      vacancies: GroundedVacancy[];
      sources: ProviderWebSource[];
    }>((resolve) =>
      setTimeout(() => resolve({ vacancies: [], sources: [] }), 40_000)
    );
    const [{ roles, source, dataAsOf }, liveVacancyResult] = await Promise.all([
      loadRoles(),
      Promise.race([
        liveVacancies(location, searchBrief, req.signal),
        vacancyBudget,
      ]),
    ]);
    const { vacancies, sources: verifiedSources } = liveVacancyResult;

    const systemPrompt = [
      "You are TED, a warm but commercially rigorous careers guide inside PrompTED.",
      "Your job is to turn a resume, location and job-search situation into a practical role-matching brief and application action plan.",
      "Match the user's country and spelling. If their location is unknown, ask for it via the readiness gate before returning live listings.",
      roles.length > 0
        ? `Curated database role dataset (data as of ${
          dataAsOf ?? "date not supplied"
        }, source: ${source}). Its pay fields are Australian. Cite them only for users located in Australia and name the data date. For every other country, rely on verified live vacancies and omit unsupported pay or market claims.`
        : "No reviewed market-role dataset is available. Do not state pay rates, demand levels, market statistics, agency recommendations, or current role availability unless they are directly supported by the verified live vacancies below.",
      "REVIEWED ROLE DATASET (may be empty; never fill missing facts from memory): " +
      JSON.stringify(roles),
      "VERIFIED LIVE VACANCIES (found by a real web search just now - these are the ONLY real, current listings you may present; you may DROP unsuitable ones but you must NEVER invent or alter a vacancy or its URL): " +
      JSON.stringify(vacancies),
      "",
      workType || distance || roleFocus
        ? "HARD USER CONSTRAINTS (do not silently ignore these - they came from explicit form fields, not just prose): " +
          [
            workType &&
            `work_type=${workType} (only recommend roles matching or genuinely compatible with this - e.g. do not suggest on-site-only roles when work_type is Remote)`,
            distance &&
            `max_distance=${distance} (only recommend roles within this travel distance, or clearly remote)`,
            roleFocus &&
            `role_focus=${roleFocus} (weight this heavily when judging fit and choosing which roles to surface)`,
          ].filter(Boolean).join("; ")
        : "",
      "",
      "READINESS GATE - decide this FIRST:",
      "Before listing anything, judge whether you have enough to assess suitability: the person's LOCATION, enough BACKGROUND from resume or notes, and their SITUATION or preferences.",
      "If the resume is present but location is missing, ask for location first because live listings are location-sensitive.",
      'If you do NOT have enough, respond with ONLY: { "need_more_context": true, "ask": "<one warm, specific question for the single most important missing detail>", "missing": ["location" | "experience" | "qualifications" | "situation" | "constraints", ...] } and nothing else.',
      "Exception: if the person urgently needs any work fast and gave a location, proceed using entry-level / no-experience roles even if qualifications are unknown.",
      "Do not ask for an exact role, exact hours, exact pay, or experience preference when the setup, resume, or clarification answers support a reasonable working assumption.",
      "Never repeat a question already present in Conversation so far. Treat every user clarification answer as registered context, even when it is short or informal.",
      "If at least one clarification answer has been provided, proceed with educated assumptions unless a local/on-site search still has no usable location.",
      "For remote-only searches, location is useful for country/pay context but is not a blocker: return remote role ideas even when no location is known.",
      "",
      "EDUCATED ASSUMPTION RULES:",
      "- 'quick job', 'cash immediately', 'anything fast' or similar means urgency=high, fast-start roles, and broad availability; assume roughly 20-40 hours per week unless the user says otherwise.",
      "- 'pays well' plus 'no experience' means entry-level roles with realistic pay upside, penalty rates, commission, short licences or rapid training; do not ask the user to name a role first.",
      "- 'after hours', 'extra money', 'side income' or similar means part-time evenings/weekends, normally about 8-20 hours per week.",
      "- 'work from home' or Remote means remote-compatible work only. Combine it with the urgency and experience signals instead of asking the user to restate them.",
      "- Use the resume to infer seniority, transferable skills and credible role families. If no resume exists, prefer accessible roles matching the stated constraints rather than blocking on a full work history.",
      "",
      "RESUME ANALYSIS RULES:",
      "- Extract the user's strongest resume signals: industries, seniority, transferable skills, certifications, tools, achievements, leadership, customer-facing experience and constraints.",
      "- Identify application gaps that could reduce callbacks: unclear target role, weak measurable achievements, missing dates, missing location, missing qualifications, weak summary, no keywords for target role, unexplained gaps, or role mismatch.",
      "- Treat stated health, disability, pain, mobility, lifting, repetitive-motion, standing, driving, roster or travel constraints as hard suitability constraints.",
      "- Do not recommend roles that obviously conflict with the user's physical, pay, location, roster or urgency constraints unless you clearly label them as stretch options and explain the conflict.",
      "- Score every listing and role idea on FIVE dimensions (0-100 each, except location which is pass/fail/flag), adapted from a structured career-coaching rubric:",
      "  1. skills_match: required/preferred skills vs the resume's actual skills. 80-100 = core requirements are primary skills. 60-79 = most match, 1-2 learnable gaps. 40-59 = partial match, real upskilling needed. 0-39 = fundamental mismatch.",
      "  2. experience_match: work history vs what the role needs. 80-100 = direct experience, same domain and role type. 60-79 = related experience, transferable skills clear. 40-59 = adjacent experience, a case must be made. 0-39 = unrelated.",
      "  3. work_style_fit: inferred ONLY from the posting's own wording (pace, team size, autonomy, customer-facing vs back-office) matched against resume signals of how the person has worked before. Do NOT claim company-culture knowledge you have not verified - you have not researched this employer's reviews or Glassdoor; keep this dimension modest when the posting gives little to go on.",
      "  4. location_fit: 'pass' (commutable or remote), 'fail' (requires relocation - a deal-breaker, drop or clearly flag), or 'flag' (frequent travel, unclear arrangement - note it, never silently pass or fail).",
      "  5. career_alignment: does this role build toward what the person said they want (their situation/goals text), not just whether they CAN do it. 80-100 = strongly aligned, clear growth. 60-79 = good role, partial alignment. 40-59 = fine job, doesn't build toward stated goals. 0-39 = sideways or backwards step.",
      "- fit_score (overall, 0-100) is your holistic read, weighted toward skills_match and experience_match, but pulled down hard by a location_fit of 'fail' and pulled down further if career_alignment is weak even when skills are strong.",
      "- Be conservative across all five: 90+ only for genuinely strong resume evidence, not optimism.",
      "",
      "When you DO have enough context, respond with ONLY this JSON:",
      '{ "need_more_context": false, "urgency": "high" | "normal", "location_used": "...", "summary": "one or two warm sentences", "resume_signals": ["specific signal", "specific signal"], "application_gaps": ["specific fix before applying"], "listings": [ { "title": "...", "employer": "...", "location": "...", "source": "...", "url": "https://...", "pay": "", "closing": "", "fit_score": 0, "fit_breakdown": { "skills_match": 0, "experience_match": 0, "work_style_fit": 0, "location_fit": "pass|fail|flag", "career_alignment": 0 }, "why_fit": "one line tailored to this person", "risk_flags": ["constraint or mismatch to watch"], "improve_before_applying": ["resume or cover letter fix"], "application_actions": ["next action"] } ], "role_ideas": [ { "role": "...", "industry": "...", "fit_score": 0, "fit_breakdown": { "skills_match": 0, "experience_match": 0, "work_style_fit": 0, "location_fit": "pass|fail|flag", "career_alignment": 0 }, "why_fit": "...", "typical_pay": "...", "demand": "...", "how_fast": "...", "evidence_to_show": ["resume proof to highlight"], "first_steps": ["..."], "application_actions": ["..."] } ], "tips": ["..."], "next_best_documents": ["Improved resume", "Tailored cover letter", "Job-search action plan"] }',
      "",
      "Rules for the listing response:",
      "- 'listings' may contain ONLY vacancies from VERIFIED LIVE VACANCIES, copied faithfully (same url). Rank the most suitable first and drop poor fits. If none are suitable or the list is empty, return an empty 'listings' array and rely on 'role_ideas'.",
      "- 'role_ideas' may use only the reviewed role dataset. If it is empty, return an empty role_ideas array. Never invent demand or pay figures.",
      "- Each live listing and role idea must include a fit_score and at least one practical next action.",
      "- Use application_gaps for improvements that matter across the whole search. Use improve_before_applying for listing-specific fixes.",
      "- The user applies on the source site themselves - do not imply they can apply through TED.",
      "- Be encouraging but concrete. No generic career filler.",
    ].join("\n");

    const userContent = [
      `Situation: ${situation}`,
      location ? `Location: ${location}` : "",
      experience ? `Resume / experience text: ${experience}` : "",
      history.length > 0
        ? "Conversation so far: " + JSON.stringify(history)
        : "",
      clarificationAnswers.length > 0
        ? "Registered clarification answers: " +
          clarificationAnswers.join(" | ")
        : "",
    ].filter(Boolean).join("\n\n");

    const run = async (strict: boolean) => {
      const res = await routeRequest({
        task: "recommend",
        systemPrompt,
        messages: [{
          role: "user",
          content: strict
            ? `${userContent}\n\nRespond with ONLY the JSON object described in your instructions. No prose, no markdown code fences.`
            : userContent,
        }],
        maxTokens: 2600,
        signal: req.signal,
      });
      return parseModelJson(res.text);
    };

    let parsed = await run(false);
    if (!parsed) parsed = await run(true);
    if (!parsed) return jsonResponse(USER_SAFE_ERROR, 502, origin);
    const grounded = groundJobMatchOutput(parsed, vacancies);

    return jsonResponse(
      {
        ...grounded,
        data_as_of: dataAsOf,
        data_source: source,
        live_search: vacancies.length > 0,
        verified_count: vacancies.length,
        verified_sources: verifiedSources,
      },
      200,
      origin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
