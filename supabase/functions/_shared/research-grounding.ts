import {
  type OpenAIRouteSnapshot,
  type ProviderRequest,
  type ProviderResponse,
  routeRequest,
  type StrictOutputSchema,
} from "./provider-router.ts";

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
  pay: string;
  closing: string;
  why_relevant: string;
}

export class ResearchGroundingError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ResearchGroundingError";
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
      url: verified.url,
      pay: verified.pay,
      closing: verified.closing,
    }];
  });

  return { ...result, listings };
}
