import {
  type OpenAIRouteSnapshot,
  type ProviderRequest,
  type ProviderResponse,
  routeRequest,
  type StrictOutputSchema,
} from "./provider-router.ts";
import { inheritModelCallContext } from "./model-call-context.ts";

export interface ProviderWebSource {
  id: string;
  title: string;
  url: string;
  type: "web";
}

export interface GroundedResearchClaim {
  text: string;
  source_ids: string[];
  source_urls: string[];
}

export interface GroundedResearchResult {
  text: string;
  claims: GroundedResearchClaim[];
  sources: ProviderWebSource[];
}

export interface GroundedResearchResponse extends GroundedResearchResult {
  routeSnapshot: OpenAIRouteSnapshot;
}

export interface GroundedVacancy {
  title: string;
  employer: string;
  location: string;
  url: string;
  source: string;
  source_id: string;
  source_status: "source_linked_not_independently_verified";
  pay: string;
  closing: string;
  why_relevant: string;
}

export interface AuthoritativeJobRole {
  id: string;
  role: string;
  industry: string;
  demand: "very high" | "high" | "moderate";
  typical_pay_aud: string;
  start_speed: string;
  data_as_of: string;
}

export type VacancySearchOutcome =
  | {
    status: "completed";
    vacancies: GroundedVacancy[];
    sources: ProviderWebSource[];
  }
  | {
    status: "failed";
    vacancies: [];
    sources: [];
    retryable: boolean;
    code: "VACANCY_RESEARCH_UNAVAILABLE";
    retryAfterSeconds?: number;
  };

export class ResearchGroundingError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ResearchGroundingError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeAuthoritativeJobRoles(
  rows: unknown,
): AuthoritativeJobRole[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const normalized: AuthoritativeJobRole[] = [];
  for (const raw of rows) {
    const row = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    const id = typeof row?.id === "string" ? row.id.trim().toLowerCase() : "";
    const role = typeof row?.role === "string" ? row.role.trim() : "";
    const industry = typeof row?.industry === "string" ? row.industry.trim() : "";
    const demand = row?.demand;
    const typicalPay = typeof row?.typical_pay_aud === "string"
      ? row.typical_pay_aud.trim()
      : "";
    const startSpeed = typeof row?.start_speed === "string"
      ? row.start_speed.trim()
      : "";
    const dataAsOf = typeof row?.data_as_of === "string"
      ? row.data_as_of.trim()
      : "";
    if (
      !UUID_PATTERN.test(id) || seen.has(id) || !role || role.length > 240 ||
      !industry || industry.length > 240 ||
      (demand !== "very high" && demand !== "high" && demand !== "moderate") ||
      !typicalPay || typicalPay.length > 240 || !startSpeed ||
      startSpeed.length > 240 || !/^\d{4}-\d{2}-\d{2}/.test(dataAsOf)
    ) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      role,
      industry,
      demand,
      typical_pay_aud: typicalPay,
      start_speed: startSpeed,
      data_as_of: dataAsOf,
    });
  }
  return normalized;
}

export async function settleVacancySearch(
  run: () => Promise<{ vacancies: GroundedVacancy[]; sources: ProviderWebSource[] }>,
  signal: AbortSignal,
): Promise<VacancySearchOutcome> {
  try {
    const result = await run();
    return { status: "completed", ...result };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      code.endsWith("_RECONCILIATION_REQUIRED") ||
      code.endsWith("_ACK_UNRESOLVED")
    ) {
      throw error;
    }
    const retryable = Boolean(
      error && typeof error === "object" && "retryable" in error &&
        (error as { retryable?: unknown }).retryable === true,
    );
    const rawRetryAfter = error && typeof error === "object" &&
        "retryAfterSeconds" in error
      ? (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined;
    const retryAfterSeconds = Number.isSafeInteger(rawRetryAfter) &&
        Number(rawRetryAfter) > 0 && Number(rawRetryAfter) <= 3_600
      ? Number(rawRetryAfter)
      : undefined;
    return {
      status: "failed",
      vacancies: [],
      sources: [],
      retryable,
      code: "VACANCY_RESEARCH_UNAVAILABLE",
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    };
  }
}

/**
 * Give one research operation an owned deadline without racing away from its
 * promise. The caller does not continue until the research adapter has handled
 * the abort and durably terminally accounted for the dispatched attempt.
 */
export async function awaitGroundedResearchWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  inheritModelCallContext(parentSignal, controller.signal);
  const relayAbort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", relayAbort, { once: true });
  if (parentSignal.aborted) relayAbort();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Research deadline reached", "TimeoutError"),
      ),
    timeoutMs,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", relayAbort);
  }
}

type ResearchRoute = (request: ProviderRequest) => Promise<ProviderResponse>;

export interface ResearchRequestInput {
  systemPrompt: string;
  messages: ProviderRequest["messages"];
  maxTokens?: number;
  signal?: AbortSignal;
}

const CLOSED_STRING = { type: "string" } as const;

export const RESEARCH_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_grounded_research",
  version: "research-grounding.1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "source_urls"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 2_000 },
            source_urls: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              uniqueItems: true,
              items: CLOSED_STRING,
            },
          },
        },
      },
    },
  },
};

export const JOB_VACANCY_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_grounded_job_vacancies",
  version: "job-vacancies-grounding.1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["vacancies"],
    properties: {
      vacancies: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "employer",
            "location",
            "url",
            "pay",
            "closing",
            "why_relevant",
          ],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 240 },
            employer: { type: "string", minLength: 1, maxLength: 240 },
            location: { type: "string", maxLength: 240 },
            url: { type: "string", minLength: 1, maxLength: 2_048 },
            pay: { type: "string", maxLength: 240 },
            closing: { type: "string", maxLength: 240 },
            why_relevant: { type: "string", maxLength: 500 },
          },
        },
      },
    },
  },
};

export function canonicalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizedSources(sources: ProviderWebSource[]): ProviderWebSource[] {
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const normalized: ProviderWebSource[] = [];
  for (const source of sources) {
    const url = canonicalHttpsUrl(source?.url);
    const id = typeof source?.id === "string" ? source.id.trim() : "";
    if (
      !url || !id || source?.type !== "web" || seenUrls.has(url) ||
      seenIds.has(id)
    ) {
      continue;
    }
    seenUrls.add(url);
    seenIds.add(id);
    normalized.push({
      id,
      title: typeof source.title === "string"
        ? source.title.trim().slice(0, 500)
        : "",
      url,
      type: "web",
    });
  }
  return normalized;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)]
    .map((match) => match[0].replace(/[.,;:!?]+$/g, ""));
}

export function groundResearchOutput(
  structured: unknown,
  providerSources: ProviderWebSource[],
): GroundedResearchResult {
  const sources = normalizedSources(providerSources);
  if (sources.length === 0) {
    throw new ResearchGroundingError("RESEARCH_SOURCES_REQUIRED");
  }
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const payload = record(structured);
  const rawClaims = payload?.claims;
  if (
    !Array.isArray(rawClaims) || rawClaims.length === 0 || rawClaims.length > 12
  ) {
    throw new ResearchGroundingError("RESEARCH_CLAIMS_INVALID");
  }

  const claims: GroundedResearchClaim[] = rawClaims.map((rawClaim) => {
    const claim = record(rawClaim);
    const text = stringValue(claim?.text, 2_000);
    const rawUrls = claim?.source_urls;
    if (
      !text || !Array.isArray(rawUrls) || rawUrls.length === 0 ||
      rawUrls.length > 5
    ) {
      throw new ResearchGroundingError("RESEARCH_CLAIM_SOURCE_REQUIRED");
    }

    const bound = rawUrls.map((rawUrl) => {
      const url = canonicalHttpsUrl(rawUrl);
      const source = url ? sourceByUrl.get(url) : undefined;
      if (!source) {
        throw new ResearchGroundingError("RESEARCH_SOURCE_NOT_CAPTURED");
      }
      return source;
    });

    for (const rawUrl of urlsInText(text)) {
      const url = canonicalHttpsUrl(rawUrl);
      if (!url || !sourceByUrl.has(url)) {
        throw new ResearchGroundingError("RESEARCH_TEXT_URL_NOT_CAPTURED");
      }
    }

    const unique = [
      ...new Map(bound.map((source) => [source.id, source])).values(),
    ];
    return {
      text,
      source_ids: unique.map((source) => source.id),
      source_urls: unique.map((source) => source.url),
    };
  });

  return {
    text: claims.map((claim) => claim.text).join("\n\n"),
    claims,
    sources,
  };
}

export async function requestGroundedResearch(
  input: ResearchRequestInput,
  requestRoute: ResearchRoute = routeRequest,
): Promise<GroundedResearchResponse> {
  const result = await requestRoute({
    task: "research",
    logicalStageKey: "research-grounding.primary",
    webSearch: true,
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    maxTokens: input.maxTokens,
    outputSchema: RESEARCH_OUTPUT_SCHEMA,
    signal: input.signal,
  });
  return {
    ...groundResearchOutput(result.structured, result.sources),
    routeSnapshot: result.routeSnapshot,
  };
}

const BANNED_JOB_HOST =
  /(^|\.)(?:seek|indeed|ziprecruiter|monster|glassdoor)\./i;

export function groundJobVacancies(
  structured: unknown,
  providerSources: ProviderWebSource[],
): GroundedVacancy[] {
  const sources = normalizedSources(providerSources);
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const payload = record(structured);
  if (!Array.isArray(payload?.vacancies)) {
    throw new ResearchGroundingError("JOB_VACANCIES_INVALID");
  }

  const seen = new Set<string>();
  return payload.vacancies.flatMap((rawVacancy) => {
    const vacancy = record(rawVacancy);
    const url = canonicalHttpsUrl(vacancy?.url);
    const source = url ? sourceByUrl.get(url) : undefined;
    if (!url || !source || seen.has(url)) return [];
    const hostname = new URL(url).hostname;
    if (BANNED_JOB_HOST.test(hostname)) return [];

    const title = stringValue(vacancy?.title, 240);
    const employer = stringValue(vacancy?.employer, 240);
    if (!title || !employer) return [];

    seen.add(url);
    return [{
      title,
      employer,
      location: stringValue(vacancy?.location, 240),
      url,
      source: source.title || hostname,
      source_id: source.id,
      source_status: "source_linked_not_independently_verified" as const,
      pay: stringValue(vacancy?.pay, 240),
      closing: stringValue(vacancy?.closing, 240),
      why_relevant: stringValue(vacancy?.why_relevant, 500),
    }];
  }).slice(0, 8);
}

export async function requestGroundedJobVacancies(
  input: ResearchRequestInput,
  requestRoute: ResearchRoute = routeRequest,
): Promise<{ vacancies: GroundedVacancy[]; sources: ProviderWebSource[] }> {
  const result = await requestRoute({
    task: "research",
    logicalStageKey: "research-grounding.job-vacancies",
    webSearch: true,
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    maxTokens: input.maxTokens,
    outputSchema: JOB_VACANCY_OUTPUT_SCHEMA,
    signal: input.signal,
  });
  return {
    vacancies: groundJobVacancies(result.structured, result.sources),
    sources: result.sources,
  };
}

function collectUrls(value: unknown, urls: string[]): void {
  if (typeof value === "string") {
    urls.push(...urlsInText(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
    return;
  }
  const valueRecord = record(value);
  if (!valueRecord) return;
  for (const item of Object.values(valueRecord)) collectUrls(item, urls);
}

export function groundJobMatchOutput(
  parsed: unknown,
  verifiedVacancies: GroundedVacancy[],
  authoritativeRoles: AuthoritativeJobRole[],
  marketContext: { countryCode?: string },
): Record<string, unknown> {
  const result = record(parsed);
  if (!result) throw new ResearchGroundingError("JOB_MATCH_OUTPUT_INVALID");

  const verifiedByUrl = new Map(
    verifiedVacancies.map((vacancy) => [vacancy.url, vacancy]),
  );
  const urls: string[] = [];
  collectUrls(result, urls);
  if (
    urls.some((rawUrl) => {
      const url = canonicalHttpsUrl(rawUrl);
      return !url || !verifiedByUrl.has(url);
    })
  ) {
    throw new ResearchGroundingError("JOB_MATCH_URL_NOT_CAPTURED");
  }

  const rawListings = Array.isArray(result.listings) ? result.listings : [];
  const listings = rawListings.flatMap((rawListing) => {
    const listing = record(rawListing);
    const url = canonicalHttpsUrl(listing?.url);
    const verified = url ? verifiedByUrl.get(url) : undefined;
    if (!listing || !verified) return [];
    return [{
      ...listing,
      title: verified.title,
      employer: verified.employer,
      location: verified.location,
      source: verified.source,
      source_id: verified.source_id,
      source_status: verified.source_status,
      url: verified.url,
      pay: verified.pay,
      closing: verified.closing,
    }];
  });

  const roleById = new Map(authoritativeRoles.map((role) => [role.id, role]));
  const seenRoleIds = new Set<string>();
  const exposeAustralianMarket = marketContext.countryCode?.trim().toUpperCase() === "AU";
  const rawRoleIdeas = Array.isArray(result.role_ideas) ? result.role_ideas : [];
  const roleIdeas = rawRoleIdeas.flatMap((rawIdea) => {
    const idea = record(rawIdea);
    const roleId = typeof idea?.dataset_role_id === "string"
      ? idea.dataset_role_id.trim().toLowerCase()
      : "";
    const authoritative = roleById.get(roleId);
    if (!idea || !authoritative || seenRoleIds.has(roleId)) return [];
    seenRoleIds.add(roleId);

    const stringList = (value: unknown, limit: number): string[] =>
      Array.isArray(value)
        ? value.map((item) => stringValue(item, 500)).filter(Boolean).slice(0, limit)
        : [];
    const fitScore = typeof idea.fit_score === "number" &&
        Number.isFinite(idea.fit_score)
      ? Math.max(0, Math.min(100, Math.round(idea.fit_score)))
      : undefined;
    const rawBreakdown = record(idea.fit_breakdown);
    const numericFit = (key: string): number | undefined => {
      const value = rawBreakdown?.[key];
      return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value)))
        : undefined;
    };
    const locationFit = rawBreakdown?.location_fit === "pass" ||
        rawBreakdown?.location_fit === "fail" || rawBreakdown?.location_fit === "flag"
      ? rawBreakdown.location_fit
      : undefined;
    const fitBreakdown = rawBreakdown
      ? {
        ...(numericFit("skills_match") !== undefined
          ? { skills_match: numericFit("skills_match") }
          : {}),
        ...(numericFit("experience_match") !== undefined
          ? { experience_match: numericFit("experience_match") }
          : {}),
        ...(numericFit("work_style_fit") !== undefined
          ? { work_style_fit: numericFit("work_style_fit") }
          : {}),
        ...(locationFit ? { location_fit: locationFit } : {}),
        ...(numericFit("career_alignment") !== undefined
          ? { career_alignment: numericFit("career_alignment") }
          : {}),
      }
      : undefined;
    return [{
      dataset_role_id: authoritative.id,
      role: authoritative.role,
      industry: authoritative.industry,
      why_fit: stringValue(idea.why_fit, 1_000),
      ...(fitScore !== undefined ? { fit_score: fitScore } : {}),
      ...(fitBreakdown ? { fit_breakdown: fitBreakdown } : {}),
      evidence_to_show: stringList(idea.evidence_to_show, 6),
      first_steps: stringList(idea.first_steps, 6),
      application_actions: stringList(idea.application_actions, 6),
      ...(exposeAustralianMarket
        ? {
          typical_pay: authoritative.typical_pay_aud,
          demand: authoritative.demand,
          how_fast: authoritative.start_speed,
          market_country: "AU",
          currency: "AUD",
          data_as_of: authoritative.data_as_of,
        }
        : {}),
    }];
  });

  return { ...result, listings, role_ideas: roleIdeas };
}
