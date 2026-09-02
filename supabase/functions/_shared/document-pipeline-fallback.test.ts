import {
  applySectionQualityGate,
  mergeFinalPlaceholders,
  sectionFallbackPlaceholder,
} from "./document-pipeline.ts";
import { parseDocumentPlaceholderTokens } from "./document-placeholder-policy.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const brief = {
  user_goal: "",
  primary_outcome: "",
  audience: "",
  author_perspective: "",
  tone: [],
  required_content: [],
  prohibited_content: [],
  known_facts: [],
  safe_assumptions: [],
  missing_critical_information: [],
  section_readiness: [],
  confidence: 0,
};

const section = { key: "experience", label: "Work Experience" };

Deno.test("sectionFallbackPlaceholder isolates the failure to a single interactive placeholder, never a thrown error", () => {
  const result = sectionFallbackPlaceholder(brief, null, section, undefined);

  assert(
    result.section.key === "experience" &&
      result.section.label === "Work Experience",
    "the section's key and label must be preserved so it stays a normal, addressable document section",
  );
  const tokens = parseDocumentPlaceholderTokens(result.section.content);
  assert(
    tokens.length === 1 && tokens[0].id === result.placeholder.id,
    "the section content must consist of exactly the declared placeholder token, so assertPlaceholderIntegrity finds it",
  );
});

Deno.test("sectionFallbackPlaceholder folds specific missing facts into the placeholder's question", () => {
  const readiness = {
    key: "experience",
    ready: false,
    missing_information: ["Employer name", "Dates of employment"],
    missing_information_keys: ["employer_name", "employment_dates"],
  };
  const result = sectionFallbackPlaceholder(brief, null, section, readiness);

  assert(
    result.placeholder.question.includes("Employer name") &&
      result.placeholder.question.includes("Dates of employment"),
    "the specific missing facts TED already identified must reach the user, not just a generic prompt",
  );
});

Deno.test("sectionFallbackPlaceholder falls back to a generic question when no specific facts are known", () => {
  const result = sectionFallbackPlaceholder(brief, null, section, undefined);

  assert(
    result.placeholder.question.length > 0,
    "a section can fail for reasons other than missing info (e.g. only ever producing weak/instructional output), so the question must still be non-empty",
  );
});

Deno.test("sectionFallbackPlaceholder is deterministic for the same inputs, so it can be used to detect a fallback after the fact", () => {
  const readiness = {
    key: "experience",
    ready: false,
    missing_information: ["Employer name"],
    missing_information_keys: ["employer_name"],
  };
  const first = sectionFallbackPlaceholder(brief, null, section, readiness);
  const second = sectionFallbackPlaceholder(brief, null, section, readiness);

  assert(
    first.section.content === second.section.content,
    "two calls with identical inputs must produce identical content, since the pipeline re-derives fallbacks from final section content instead of tracking them as they occur",
  );
});

Deno.test("sectionFallbackPlaceholder is marked required for export, since the section has no real content yet", () => {
  const result = sectionFallbackPlaceholder(brief, null, section, undefined);
  assert(
    result.placeholder.requiredForExport,
    "exporting a document with an unwritten section must be blocked until the user resolves it",
  );
});

Deno.test("applySectionQualityGate preserves passing sections and isolates only the failed section", () => {
  const opening = {
    key: "opening",
    label: "Opening",
    content: "I am writing to raise a formal complaint.",
  };
  const body = {
    key: "body",
    label: "Complaint details",
    content: "Content rejected by the final quality audit.",
  };
  const result = applySectionQualityGate(
    brief,
    null,
    [
      { key: "opening", label: "Opening" },
      { key: "body", label: "Complaint details" },
    ],
    [opening, body],
    [{
      severity: "high",
      category: "fact",
      section_key: "body",
      finding: "Unsupported factual wording.",
      required_correction: "Remove the unsupported wording.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 0,
    "a valid section_key must keep the issue section-scoped instead of failing the document",
  );
  assert(
    result.draft.find((candidate: { key: string; content: string }) =>
      candidate.key === "opening"
    )?.content ===
      opening.content,
    "a section that passed the audit must be preserved exactly",
  );
  const isolatedBody = result.draft.find((candidate) =>
    candidate.key === "body"
  );
  assert(
    Boolean(isolatedBody) &&
      parseDocumentPlaceholderTokens(isolatedBody!.content).length === 1,
    "only the failed section must become an interactive TED placeholder",
  );
});

Deno.test("applySectionQualityGate retains a genuinely unscoped issue as a document-level failure", () => {
  const draft = [{
    key: "body",
    label: "Complaint details",
    content: "Complete complaint wording.",
  }];
  const result = applySectionQualityGate(
    brief,
    null,
    [{ key: "body", label: "Complaint details" }],
    draft,
    [{
      severity: "high",
      category: "intent",
      finding: "The complete document contradicts the supplied purpose.",
      required_correction: "Rebuild the document around the supplied purpose.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 1,
    "an issue with no valid section_key must remain a genuine document-level failure",
  );
  assert(
    result.draft[0].content === draft[0].content,
    "a document-level issue must not arbitrarily replace an unrelated section",
  );
});

Deno.test("applySectionQualityGate recovers unscoped safety issues into section placeholders instead of throwing the stream away", () => {
  const opening = {
    key: "opening",
    label: "Opening",
    content: "I am writing to raise a formal complaint.",
  };
  const body = {
    key: "body",
    label: "Complaint details",
    content: "The supplier caused $50,000 in losses.",
  };
  const result = applySectionQualityGate(
    brief,
    null,
    [
      { key: "opening", label: "Opening" },
      { key: "body", label: "Complaint details" },
    ],
    [opening, body],
    [{
      severity: "high",
      category: "fact",
      finding:
        "The audit reported unsupported factual wording without a valid section key.",
      required_correction: "Do not release unsupported factual wording.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 0,
    "an unscoped recoverable safety issue must be converted to required section placeholders instead of failing the whole stream",
  );
  assert(
    result.draft.every((section) =>
      parseDocumentPlaceholderTokens(section.content).length === 1
    ),
    "every section is replaced when the auditor cannot identify which section contains the unsafe factual wording",
  );
});

Deno.test("applySectionQualityGate maps an unscoped factual issue back to the implicated section", () => {
  const opening = {
    key: "opening",
    label: "Opening",
    content: "I am writing to raise a formal complaint.",
  };
  const body = {
    key: "body",
    label: "Complaint details",
    content: "The supplier caused $50,000 in losses.",
  };
  const result = applySectionQualityGate(
    brief,
    null,
    [
      { key: "opening", label: "Opening" },
      { key: "body", label: "Complaint details" },
    ],
    [opening, body],
    [{
      severity: "high",
      category: "fact",
      finding:
        "Unsupported factual wording: The supplier caused $50,000 in losses.",
      required_correction:
        "Remove the unsupported factual clause unless the source confirms it.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 0,
    "a recoverable issue with identifiable section content must not fail the whole document",
  );
  assert(
    result.draft.find((candidate) => candidate.key === "opening")?.content ===
      opening.content,
    "the unrelated opening section must remain full generated wording",
  );
  const isolatedBody = result.draft.find((candidate) =>
    candidate.key === "body"
  );
  assert(
    Boolean(isolatedBody) &&
      parseDocumentPlaceholderTokens(isolatedBody!.content).length === 1,
    "only the section containing the unsupported clause should become an interactive placeholder",
  );
});

Deno.test("applySectionQualityGate returns structured recovery placeholders instead of failing recovered blank output", () => {
  const fallback = sectionFallbackPlaceholder(
    brief,
    null,
    { key: "body", label: "Complaint details" },
    undefined,
  );
  const result = applySectionQualityGate(
    brief,
    null,
    [{ key: "body", label: "Complaint details" }],
    [fallback.section],
    [{
      severity: "high",
      category: "blank_output",
      finding: "No final wording was available for factual review.",
      required_correction: "Write complete final wording before release.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 0,
    "a document already recovered into declared interactive placeholders is not genuinely blank and must be returned to the user",
  );
  assert(
    result.draft[0].content === fallback.section.content,
    "the declared recovery placeholder must remain available for the user to resolve",
  );
});
Deno.test("mergeFinalPlaceholders replaces stale fact placeholders when an entire section falls back", () => {
  const fallback = sectionFallbackPlaceholder(
    brief,
    null,
    { key: "body", label: "Complaint details" },
    undefined,
  ).placeholder;
  const staleFactPlaceholder = {
    ...fallback,
    id: "complaint.body.incident_date",
    informationKey: "incident_date",
  };
  const otherSectionPlaceholder = {
    ...fallback,
    id: "complaint.opening.recipient",
    sectionKey: "opening",
    informationKey: "recipient",
  };

  const merged = mergeFinalPlaceholders(
    [staleFactPlaceholder, otherSectionPlaceholder],
    [fallback],
  );

  assert(
    merged.some((placeholder) => placeholder.id === fallback.id) &&
      !merged.some((placeholder) => placeholder.id === staleFactPlaceholder.id),
    "a whole-section fallback must supersede stale fact tokens that no longer exist in that section",
  );
  assert(
    merged.some((placeholder) => placeholder.id === otherSectionPlaceholder.id),
    "placeholders belonging to unaffected sections must be preserved",
  );
});
Deno.test("applySectionQualityGate replaces an undeclared model-shaped token with a declared fallback", () => {
  const result = applySectionQualityGate(
    brief,
    null,
    [{ key: "body", label: "Complaint details" }],
    [{
      key: "body",
      label: "Complaint details",
      content: "{{TED_PLACEHOLDER:invented.id:Invented placeholder}}",
    }],
    [{
      severity: "high",
      category: "blank_output",
      finding: "No final wording was available for factual review.",
      required_correction: "Write complete final wording before release.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 0,
    "an undeclared placeholder-shaped response must not fail the stream when it can be replaced safely",
  );
  assert(
    result.draft[0].content !==
        "{{TED_PLACEHOLDER:invented.id:Invented placeholder}}" &&
      parseDocumentPlaceholderTokens(result.draft[0].content).length === 1,
    "the unsafe model-shaped token must be replaced by a declared pipeline fallback placeholder",
  );
});
Deno.test("applySectionQualityGate normalises a decorated whole-section fallback to the declared fallback", () => {
  const fallback = sectionFallbackPlaceholder(
    brief,
    null,
    { key: "body", label: "Complaint details" },
    undefined,
  );
  const result = applySectionQualityGate(
    brief,
    null,
    [{ key: "body", label: "Complaint details" }],
    [{
      ...fallback.section,
      content: `# Complaint details\n${fallback.section.content}`,
    }],
    [{
      severity: "high",
      category: "blank_output",
      finding: "No final wording was available for factual review.",
      required_correction: "Write complete final wording before release.",
    }],
  );

  assert(
    result.documentLevelIssues.length === 0,
    "a decorated whole-section fallback must not fail the stream when it can be normalised safely",
  );
  assert(
    result.draft[0].content === fallback.section.content,
    "the decorated fallback must be replaced with the exact registered fallback content",
  );
});
