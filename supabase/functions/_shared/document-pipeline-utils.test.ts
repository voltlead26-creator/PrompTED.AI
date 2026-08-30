// Hermetic tests: no provider calls and no remote imports.
import {
  actionableMissingInformation,
  affectedSectionKeys,
  boundedConversationSource,
  findUnsupportedNumericClaims,
  groundingIssuesFromAudit,
  hasBlockingQualityIssues,
  hasIdentityCriticalMissingInformation,
  mapWithConcurrency,
  mergeByKey,
} from "./document-pipeline-utils.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("mapWithConcurrency preserves input order and respects the ceiling", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) =>
      setTimeout(resolve, value % 2 === 0 ? 2 : 1)
    );
    active -= 1;
    return value * 10;
  });

  assert(
    JSON.stringify(result) === JSON.stringify([10, 20, 30, 40, 50]),
    "order changed",
  );
  assert(peak <= 2, `expected peak <= 2, got ${peak}`);
  assert(peak > 1, "work did not run concurrently");
});

Deno.test("affectedSectionKeys targets only named sections", () => {
  const keys = affectedSectionKeys(
    [{ section_key: "summary" }, { section_key: "risks" }, {
      section_key: "summary",
    }],
    ["intro", "summary", "risks", "next_steps"],
  );
  assert(
    JSON.stringify(keys) === JSON.stringify(["summary", "risks"]),
    "wrong targeted keys",
  );
});

Deno.test("document-level audit issue targets the whole document", () => {
  const keys = affectedSectionKeys(
    [{ section_key: "summary" }, {}],
    ["intro", "summary", "next_steps"],
  );
  assert(
    JSON.stringify(keys) === JSON.stringify(["intro", "summary", "next_steps"]),
    "not all keys",
  );
});

Deno.test("audit infrastructure warnings re-audit without rewriting good sections", () => {
  const keys = affectedSectionKeys(
    [{
      severity: "low",
      category: "completeness",
      section_key: "experience",
      finding: "Factual audit did not return a result for: Managed rosters.",
    }],
    ["summary", "experience", "education"],
  );
  assert(
    keys.length === 0,
    "an incomplete audit asked the writer to replace valid wording",
  );
});

Deno.test("mergeByKey replaces sections without reordering the document", () => {
  const merged = mergeByKey(
    [
      { key: "a", content: "original a" },
      { key: "b", content: "original b" },
      { key: "c", content: "original c" },
    ],
    [{ key: "b", content: "rewritten b" }],
  );
  assert(merged.map((item) => item.key).join(",") === "a,b,c", "order changed");
  assert(merged[1]?.content === "rewritten b", "replacement missing");
  assert(merged[0]?.content === "original a", "unaffected section changed");
});

Deno.test("unknown audit section key safely targets the whole document", () => {
  const keys = affectedSectionKeys(
    [{ section_key: "invented-key" }],
    ["intro", "summary", "next_steps"],
  );
  assert(
    JSON.stringify(keys) === JSON.stringify(["intro", "summary", "next_steps"]),
    "did not fail safe",
  );
});

Deno.test("conversation source preserves ordinary histories and both ends of long histories", () => {
  assert(
    boundedConversationSource(
      "User: original goal\nTED: question\nUser: final answer",
    ) ===
      "User: original goal\nTED: question\nUser: final answer",
    "ordinary conversation changed",
  );

  const long = `User: opening goal ${"a".repeat(120)}\n${
    "middle turn\n".repeat(40)
  }User: latest correction ${"z".repeat(120)}`;
  const bounded = boundedConversationSource(long, 400);
  assert(
    bounded.length === 400,
    `expected 400 characters, got ${bounded.length}`,
  );
  assert(bounded.startsWith("User: opening goal"), "opening goal was lost");
  assert(
    bounded.includes("Earlier middle turns omitted"),
    "omission was not disclosed",
  );
  assert(
    bounded.includes("User: latest correction"),
    "latest correction was lost",
  );
});

Deno.test("quality release blocks safety failures but not exhausted editorial preferences", () => {
  assert(
    !hasBlockingQualityIssues([
      { severity: "low", category: "tone" },
      { severity: "low", category: "layout" },
    ]),
    "low editorial preferences erased an otherwise usable document",
  );
  assert(
    hasBlockingQualityIssues([
      { severity: "low", category: "layout" },
      { severity: "medium", category: "completeness" },
    ]),
    "medium completeness failure was allowed through",
  );
  assert(
    hasBlockingQualityIssues([
      { severity: "high", category: "fact" },
    ]),
    "high factual failure was allowed through",
  );
});

Deno.test("only identity-critical gaps block final wording", () => {
  assert(
    !hasIdentityCriticalMissingInformation([
      "A brief personal statement or specific professional summary based on the provided experience and achievements.",
    ]),
    "TED should author a professional summary from supplied evidence",
  );
  assert(
    hasIdentityCriticalMissingInformation([
      "The employer name for the addressed cover letter",
    ]),
    "an unknown employer identity should remain blocking",
  );
});

Deno.test("TED does not ask the user to author wording TED should produce", () => {
  const missing = actionableMissingInformation([
    "A concise statement summarizing the candidate's professional profile and value proposition",
    "Referee contact details or statement 'Available on request'",
    "Current forklift licence expiry date",
  ]);
  assert(
    JSON.stringify(missing) ===
      JSON.stringify(["Current forklift licence expiry date"]),
    `unexpected clarification list: ${JSON.stringify(missing)}`,
  );
});

Deno.test("unsupported numeric claims are identified before release", () => {
  const unsupported = findUnsupportedNumericClaims(
    [
      "Reduced dispatch errors from 4.8% to 1.9%.",
      "Improved on-time dispatch from 89% to 97%.",
      "Reduced picking errors by 15%.",
    ].join("\n"),
    "The user supplied 4.8%, 1.9%, 89% and 97%.",
  );
  assert(
    JSON.stringify(unsupported) === JSON.stringify(["15%"]),
    `unsupported numeric claims were not isolated: ${
      JSON.stringify(unsupported)
    }`,
  );
});

Deno.test("an omitted factual audit unit is audit incompleteness, not unsafe wording", () => {
  const issues = groundingIssuesFromAudit(
    [
      { id: "experience#1", sectionKey: "experience", text: "Led 24 staff." },
      {
        id: "experience#2",
        sectionKey: "experience",
        text: "Managed rosters.",
      },
    ],
    [{
      unit_id: "experience#1",
      classification: "supported",
      evidence_quotes: ["leads 24 staff"],
      unsupported_fragments: [],
    }],
    "The user says Alex leads 24 staff.",
  );
  assert(
    issues.length === 1,
    `expected one incomplete-audit issue, got ${issues.length}`,
  );
  assert(
    issues[0]?.severity === "low" &&
      issues[0]?.category === "completeness" &&
      issues[0]?.finding.includes("Managed rosters"),
    "the omitted audit unit was incorrectly presented as a factual safety failure",
  );
});

Deno.test("explicit unsupported wording remains a blocking factual issue", () => {
  const issues = groundingIssuesFromAudit(
    [{
      id: "summary#1",
      sectionKey: "summary",
      text: "Award-winning manager.",
    }],
    [{
      unit_id: "summary#1",
      classification: "unsupported",
      evidence_quotes: [],
      unsupported_fragments: ["Award-winning"],
    }],
    "Experienced manager.",
  );
  assert(
    issues.length === 1 &&
      issues[0]?.severity === "high" &&
      issues[0]?.category === "fact",
    "an explicitly unsupported claim was not blocked",
  );
});

Deno.test("evidence matching tolerates punctuation-only formatting differences", () => {
  const issues = groundingIssuesFromAudit(
    [{
      id: "education#1",
      sectionKey: "education",
      text: "Certificate IV — Leadership & Management.",
    }],
    [{
      unit_id: "education#1",
      classification: "supported",
      evidence_quotes: ["Certificate IV - Leadership & Management"],
      unsupported_fragments: [],
    }],
    "Certificate IV — Leadership & Management",
  );
  assert(
    issues.length === 0,
    "punctuation-only evidence differences caused a false failure",
  );
});

Deno.test("a fabricated evidence quote becomes audit incompleteness, not proof of fabrication", () => {
  const issues = groundingIssuesFromAudit(
    [{
      id: "education#1",
      sectionKey: "education",
      text: "Studied at TAFE Melbourne.",
    }],
    [{
      unit_id: "education#1",
      classification: "supported",
      evidence_quotes: ["TAFE Melbourne"],
      unsupported_fragments: [],
    }],
    "Certificate IV in Leadership and Management, 2020.",
  );
  assert(
    issues.length === 1 &&
      issues[0]?.severity === "low" &&
      issues[0]?.category === "completeness",
    "an invalid auditor quote was treated as proof that user wording was unsafe",
  );
});
