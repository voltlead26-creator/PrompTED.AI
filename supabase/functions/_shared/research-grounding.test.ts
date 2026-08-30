import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  canonicalHttpsUrl,
  groundJobMatchOutput,
  groundJobVacancies,
  groundResearchOutput,
  JOB_VACANCY_OUTPUT_SCHEMA,
  requestGroundedJobVacancies,
  requestGroundedResearch,
  RESEARCH_OUTPUT_SCHEMA,
  ResearchGroundingError,
} from "./research-grounding.ts";
import type { ProviderRequest, ProviderResponse } from "./provider-router.ts";

const sources = [{
  id: "src-1",
  title: "Official employer vacancy",
  url: "https://careers.example.gov.au/jobs/123",
  type: "web" as const,
}];

Deno.test("research contracts use closed strict-output schemas", () => {
  assertEquals(RESEARCH_OUTPUT_SCHEMA.schema.additionalProperties, false);
  assertEquals(JOB_VACANCY_OUTPUT_SCHEMA.schema.additionalProperties, false);
  const researchProperties = RESEARCH_OUTPUT_SCHEMA.schema.properties as Record<
    string,
    unknown
  >;
  assertEquals(
    (researchProperties.claims as Record<string, unknown>).minItems,
    1,
  );
});

function syntheticProviderResponse(
  structured: Record<string, unknown>,
): ProviderResponse {
  return {
    text: "ignored in favour of strict structured output",
    structured,
    sources,
    inputTokens: 10,
    outputTokens: 5,
    _provider: "openai",
    responseId: "resp-synthetic-research",
    status: "completed",
    routeSnapshot: {
      provider: "openai",
      semanticRoute: "research",
      model: "synthetic-research-model",
      reasoningEffort: "medium",
      routingVersion: "routing.test.1",
      structuredOutputSchemaVersion: "research-grounding.1",
      allowedTools: ["web_search"],
      timeoutMs: 90_000,
      maxAttempts: 2,
      background: false,
      store: false,
      fallback: null,
    },
    attempts: [],
  };
}

Deno.test("approved research always uses the research route, web search and strict output", async () => {
  const captured: ProviderRequest[] = [];
  const route = (request: ProviderRequest): Promise<ProviderResponse> => {
    captured.push(request);
    return Promise.resolve(syntheticProviderResponse({
      claims: [{ text: "Grounded claim", source_urls: [sources[0].url] }],
    }));
  };

  const result = await requestGroundedResearch({
    systemPrompt: "Synthetic safe research",
    messages: [{ role: "user", content: "Synthetic query" }],
  }, route);

  assertEquals(captured[0].task, "research");
  assertEquals(captured[0].webSearch, true);
  assertEquals(captured[0].outputSchema, RESEARCH_OUTPUT_SCHEMA);
  assertEquals(result.sources, sources);
});

Deno.test("job-vacancy search uses the same approved strict research route", async () => {
  const captured: ProviderRequest[] = [];
  const route = (request: ProviderRequest): Promise<ProviderResponse> => {
    captured.push(request);
    return Promise.resolve(syntheticProviderResponse({
      vacancies: [{
        title: "Analyst",
        employer: "Example Department",
        location: "Melbourne",
        url: sources[0].url,
        pay: "",
        closing: "",
        why_relevant: "Relevant experience",
      }],
    }));
  };

  const result = await requestGroundedJobVacancies({
    systemPrompt: "Synthetic vacancy search",
    messages: [{ role: "user", content: "Synthetic vacancy query" }],
  }, route);
  assertEquals(captured[0].task, "research");
  assertEquals(captured[0].webSearch, true);
  assertEquals(captured[0].outputSchema, JOB_VACANCY_OUTPUT_SCHEMA);
  assertEquals(result.vacancies[0].url, sources[0].url);
});

Deno.test("groundResearchOutput binds every claim and URL to captured tool sources", () => {
  assertEquals(
    groundResearchOutput({
      claims: [{
        text: "The official listing is current.",
        source_urls: [sources[0].url],
      }],
    }, sources),
    {
      text: "The official listing is current.",
      claims: [{
        text: "The official listing is current.",
        source_ids: ["src-1"],
        source_urls: [sources[0].url],
      }],
      sources,
    },
  );

  assertThrows(
    () =>
      groundResearchOutput({
        claims: [{
          text: "Unsupported claim",
          source_urls: ["https://invented.example/claim"],
        }],
      }, sources),
    ResearchGroundingError,
    "RESEARCH_SOURCE_NOT_CAPTURED",
  );
  assertThrows(
    () =>
      groundResearchOutput({
        claims: [{
          text: "See https://invented.example/claim",
          source_urls: [sources[0].url],
        }],
      }, sources),
    ResearchGroundingError,
    "RESEARCH_TEXT_URL_NOT_CAPTURED",
  );
  assertThrows(
    () =>
      groundResearchOutput({
        claims: [{
          text: "See http://insecure.example/claim",
          source_urls: [sources[0].url],
        }],
      }, sources),
    ResearchGroundingError,
    "RESEARCH_TEXT_URL_NOT_CAPTURED",
  );
});

Deno.test("research refuses unsafe provider source URLs", () => {
  assertEquals(canonicalHttpsUrl("http://example.com"), null);
  assertEquals(canonicalHttpsUrl("https://user:pass@example.com"), null);
  assertThrows(
    () =>
      groundResearchOutput({
        claims: [{ text: "Claim", source_urls: ["https://example.com/"] }],
      }, []),
    ResearchGroundingError,
    "RESEARCH_SOURCES_REQUIRED",
  );
});

Deno.test("job vacancies accept only captured non-aggregator URLs", () => {
  const vacancies = groundJobVacancies({
    vacancies: [
      {
        title: "Analyst",
        employer: "Example Department",
        location: "Melbourne",
        url: sources[0].url,
        pay: "",
        closing: "",
        why_relevant: "Relevant experience",
      },
      {
        title: "Invented",
        employer: "Invented Employer",
        location: "Melbourne",
        url: "https://invented.example/jobs/999",
        pay: "",
        closing: "",
        why_relevant: "",
      },
    ],
  }, sources);

  assertEquals(vacancies.length, 1);
  assertEquals(vacancies[0].url, sources[0].url);
  assertEquals(vacancies[0].source_id, "src-1");
});

Deno.test("job-match recommendations cannot introduce or alter vacancy URLs", () => {
  const verified = groundJobVacancies({
    vacancies: [{
      title: "Analyst",
      employer: "Example Department",
      location: "Melbourne",
      url: sources[0].url,
      pay: "",
      closing: "",
      why_relevant: "Relevant experience",
    }],
  }, sources);

  const grounded = groundJobMatchOutput({
    need_more_context: false,
    listings: [{
      title: "Altered title",
      employer: "Altered employer",
      url: sources[0].url,
      why_fit: "Good fit",
    }],
    tips: ["Apply on the source site."],
  }, verified);
  const listings = grounded.listings as Array<Record<string, unknown>>;
  assertEquals(listings[0].title, "Analyst");
  assertEquals(listings[0].employer, "Example Department");

  assertThrows(
    () =>
      groundJobMatchOutput({
        need_more_context: false,
        listings: [{ url: "https://invented.example/jobs/999" }],
      }, verified),
    ResearchGroundingError,
    "JOB_MATCH_URL_NOT_CAPTURED",
  );
});
