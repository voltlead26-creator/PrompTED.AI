import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  awaitGroundedResearchWithTimeout,
  canonicalHttpsUrl,
  groundJobMatchOutput,
  groundJobVacancies,
  groundResearchOutput,
  JOB_VACANCY_OUTPUT_SCHEMA,
  requestGroundedJobVacancies,
  requestGroundedResearch,
  RESEARCH_OUTPUT_SCHEMA,
  ResearchGroundingError,
  normalizeAuthoritativeJobRoles,
  settleVacancySearch,
} from "./research-grounding.ts";
import type { ProviderRequest, ProviderResponse } from "./provider-router.ts";
import {
  bindModelCallContext,
  prepareLegacyModelAttempt,
} from "./model-call-context.ts";

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
  assertEquals(
    vacancies[0].source_status,
    "source_linked_not_independently_verified",
  );
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
  }, verified, [], {});
  const listings = grounded.listings as Array<Record<string, unknown>>;
  assertEquals(listings[0].title, "Analyst");
  assertEquals(listings[0].employer, "Example Department");

  assertThrows(
    () =>
      groundJobMatchOutput({
        need_more_context: false,
        listings: [{ url: "https://invented.example/jobs/999" }],
      }, verified, [], {}),
    ResearchGroundingError,
    "JOB_MATCH_URL_NOT_CAPTURED",
  );
});

Deno.test("job role facts are reconstructed from an exact authoritative dataset id", () => {
  const roles = normalizeAuthoritativeJobRoles([{
    id: "a1000000-0000-4000-8000-000000000001",
    role: "Facilities Coordinator",
    industry: "Property services",
    demand: "high",
    typical_pay_aud: "$70,000-$85,000",
    start_speed: "Two to four weeks",
    data_as_of: "2026-08-01",
  }]);
  const grounded = groundJobMatchOutput({
    listings: [],
    role_ideas: [{
      dataset_role_id: roles[0].id,
      role: "Invented executive",
      industry: "Invented industry",
      typical_pay: "$999,999",
      demand: "guaranteed",
      how_fast: "today",
      why_fit: "Uses the user's operations background.",
      first_steps: ["Review current vacancies"],
      fabricated_fact: "must not survive",
    }],
  }, [], roles, { countryCode: "AU" });
  const idea = (grounded.role_ideas as Array<Record<string, unknown>>)[0];
  assertEquals(idea.role, "Facilities Coordinator");
  assertEquals(idea.industry, "Property services");
  assertEquals(idea.typical_pay, "$70,000-$85,000");
  assertEquals(idea.demand, "high");
  assertEquals(idea.how_fast, "Two to four weeks");
  assertEquals(idea.market_country, "AU");
  assertEquals(idea.currency, "AUD");
  assertEquals("fabricated_fact" in idea, false);

  const outsideAustralia = groundJobMatchOutput({
    listings: [],
    role_ideas: [{ dataset_role_id: roles[0].id }],
  }, [], roles, { countryCode: "US" });
  const outsideIdea = (outsideAustralia.role_ideas as Array<Record<string, unknown>>)[0];
  assertEquals("typical_pay" in outsideIdea, false);
  assertEquals("demand" in outsideIdea, false);
  assertEquals("how_fast" in outsideIdea, false);
});

Deno.test("job role normalization and selection fail closed for malformed, unknown and duplicate ids", () => {
  const roles = normalizeAuthoritativeJobRoles([
    {
      id: "a1000000-0000-4000-8000-000000000001",
      role: "Facilities Coordinator",
      industry: "Property services",
      demand: "high",
      typical_pay_aud: "$70,000-$85,000",
      start_speed: "Two to four weeks",
      data_as_of: "2026-08-01",
    },
    {
      id: "not-a-uuid",
      role: "Invalid",
      industry: "Invalid",
      demand: "high",
      typical_pay_aud: "$1",
      start_speed: "Now",
      data_as_of: "2026-08-01",
    },
  ]);
  assertEquals(roles.length, 1);
  const grounded = groundJobMatchOutput({
    listings: [],
    role_ideas: [
      { dataset_role_id: roles[0].id },
      { dataset_role_id: roles[0].id },
      { dataset_role_id: "b1000000-0000-4000-8000-000000000001" },
    ],
  }, [], roles, { countryCode: "AU" });
  assertEquals((grounded.role_ideas as unknown[]).length, 1);
});

Deno.test("vacancy search distinguishes validated zero results from retryable failure", async () => {
  const signal = new AbortController().signal;
  assertEquals(
    await settleVacancySearch(
      () => Promise.resolve({ vacancies: [], sources: [] }),
      signal,
    ),
    { status: "completed", vacancies: [], sources: [] },
  );
  assertEquals(
    await settleVacancySearch(
      () => Promise.reject({
        code: "OPENAI_RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: 17,
      }),
      signal,
    ),
    {
      status: "failed",
      vacancies: [],
      sources: [],
      retryable: true,
      code: "VACANCY_RESEARCH_UNAVAILABLE",
      retryAfterSeconds: 17,
    },
  );
  await assertRejects(
    () => settleVacancySearch(
      () => Promise.reject({ code: "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED" }),
      signal,
    ),
  );
});

Deno.test("late research is aborted and awaited before downstream matching can begin", async () => {
  const parent = new AbortController();
  bindModelCallContext(parent.signal, {
    userId: "synthetic-user",
    admin: {} as never,
    generationRequestId: "synthetic-job-match",
  });
  let researchTerminal = false;
  let matchStarted = false;
  const research = awaitGroundedResearchWithTimeout(
    async (signal) => {
      const terminal = new Promise<never>((_resolve, reject) => {
        const rejectAborted = () => {
          researchTerminal = true;
          reject(signal.reason);
        };
        if (signal.aborted) rejectAborted();
        else signal.addEventListener("abort", rejectAborted, { once: true });
      });
      void terminal.catch(() => undefined);
      const prepared = await prepareLegacyModelAttempt(signal, {
        logicalStageKey: "job-match:research",
        requestSha256: "a".repeat(64),
        attemptNumber: 1,
      });
      assertEquals(prepared.clientRequestId.startsWith("prompted-"), true);
      return await terminal;
    },
    parent.signal,
    1,
  );

  await assertRejects(
    async () => {
      await research;
      matchStarted = true;
    },
    DOMException,
    "Research deadline reached",
  );
  assertEquals(researchTerminal, true);
  assertEquals(matchStarted, false);
});
