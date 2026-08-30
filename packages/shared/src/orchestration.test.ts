import { describe, it, expect } from "vitest";
import {
  coerceIntentResult,
  requireInitialClarification,
  validateRecommendation,
  clarifyShouldContinue,
  validateChecklist,
} from "./orchestration";

describe("requireInitialClarification", () => {
  it("preserves a useful first question chosen from the document context", () => {
    const result = coerceIntentResult({
      domain: "personal",
      situation: "Contest a towing incident",
      intent_clear: false,
      question: "When and where was the vehicle towed?",
    });

    expect(requireInitialClarification(result, "I need to contest a tow")).toBe(result);
  });

  it("does not let a first-turn job-search signal bypass a useful question", () => {
    const result = coerceIntentResult({
      intent_clear: false,
      question: "Which location should I use for the search?",
      job_search: true,
    });

    const guarded = requireInitialClarification(result, "Find me work");

    expect(guarded.question).toBe("Which location should I use for the search?");
    expect(guarded.jobSearch).toBe(false);
  });

  it("replaces a premature recommendation with a factual confirmation turn", () => {
    const result = coerceIntentResult({
      domain: "personal",
      situation: "The user wants to contest a towing incident with the operator.",
      intent_clear: true,
      job_search: true,
      recommendation: {
        primary: { name: "Complaint Letter" },
        alternatives: [],
      },
    });

    const guarded = requireInitialClarification(result, "My car was towed and I want to contest it");

    expect(guarded.intentClear).toBe(false);
    expect(guarded.recommendation).toBeNull();
    expect(guarded.jobSearch).toBe(false);
    expect(guarded.question).toContain("The user wants to contest a towing incident");
    expect(guarded.question).toContain("Is that accurate");
    expect(guarded.questionOptions).toEqual([
      "Yes, that's accurate",
      "I need to correct or add something",
    ]);
  });

  it("uses the original request when TED returns no usable summary or question", () => {
    const guarded = requireInitialClarification(
      coerceIntentResult({ intent_clear: false }),
      "  Help me challenge a towing fee.  ",
    );

    expect(guarded.question).toContain("Help me challenge a towing fee.");
    expect(guarded.intentClear).toBe(false);
  });
});

describe("validateRecommendation", () => {
  it("returns null without a usable primary", () => {
    expect(validateRecommendation(null)).toBeNull();
    expect(validateRecommendation({})).toBeNull();
    expect(validateRecommendation({ primary: {} })).toBeNull();
  });

  it("coerces a valid recommendation", () => {
    const rec = validateRecommendation({
      primary: {
        name: "Offer Letter",
        format: "pdf",
        reason: "Fits a new hire.",
        use_case: "Confirming a job offer",
        benefits: ["Clear", "Professional"],
      },
      alternatives: [
        { name: "Email", format: "word" },
        { name: "Contract", format: "pdf" },
      ],
    });
    expect(rec?.primary.name).toBe("Offer Letter");
    expect(rec?.alternatives).toHaveLength(2);
  });

  it("truncates extra alternatives to two", () => {
    const rec = validateRecommendation({
      primary: { name: "A" },
      alternatives: [{ name: "B" }, { name: "C" }, { name: "D" }],
    });
    expect(rec?.alternatives).toHaveLength(2);
    expect(rec?.alternatives.map((a) => a.name)).toEqual(["B", "C"]);
  });

  it("accepts camelCase useCase", () => {
    const rec = validateRecommendation({
      primary: { name: "A", useCase: "do a thing" },
      alternatives: [],
    });
    expect(rec?.primary.use_case).toBe("do a thing");
  });
});

describe("coerceIntentResult", () => {
  it("marks intent clear when a recommendation is present", () => {
    const r = coerceIntentResult({
      domain: "employment",
      situation: "hiring",
      confidence: 0.9,
      recommendation: { primary: { name: "Offer Letter" }, alternatives: [] },
    });
    expect(r.intentClear).toBe(true);
    expect(r.question).toBeNull();
    expect(r.recommendation?.primary.name).toBe("Offer Letter");
  });

  it("keeps the question when intent is not clear", () => {
    const r = coerceIntentResult({
      domain: "business",
      situation: "",
      confidence: 0.4,
      intent_clear: false,
      question: "What's the goal?",
    });
    expect(r.intentClear).toBe(false);
    expect(r.question).toBe("What's the goal?");
    expect(r.questionOptions).toBeNull();
  });

  it("keeps selectable answers when there are at least 2", () => {
    const r = coerceIntentResult({
      intent_clear: false,
      question: "Is this a rental or a property you own?",
      question_options: ["Renting", "Own"],
    });
    expect(r.questionOptions).toEqual(["Renting", "Own"]);
  });

  it("drops a single leftover option — not a real choice", () => {
    const r = coerceIntentResult({
      intent_clear: false,
      question: "What's the goal?",
      question_options: ["Just one"],
    });
    expect(r.questionOptions).toBeNull();
  });

  it("strips a stray 'Other' option since free text is always available", () => {
    const r = coerceIntentResult({
      intent_clear: false,
      question: "Full-time, part-time or casual?",
      question_options: ["Full-time", "Part-time", "Casual", "Other"],
    });
    expect(r.questionOptions).toEqual(["Full-time", "Part-time", "Casual"]);
  });

  it("caps selectable answers at 4", () => {
    const r = coerceIntentResult({
      intent_clear: false,
      question: "Which one?",
      question_options: ["A", "B", "C", "D", "E"],
    });
    expect(r.questionOptions).toHaveLength(4);
  });

  it("ignores options once intent is clear — no question left to answer", () => {
    const r = coerceIntentResult({
      intent_clear: true,
      question_options: ["A", "B"],
      recommendation: { primary: { name: "Offer Letter" }, alternatives: [] },
    });
    expect(r.questionOptions).toBeNull();
  });

  it("clamps confidence to 0..1", () => {
    expect(coerceIntentResult({ confidence: 5 }).confidence).toBe(1);
    expect(coerceIntentResult({ confidence: -2 }).confidence).toBe(0);
    expect(coerceIntentResult({ confidence: "nope" }).confidence).toBe(0);
  });

  it("falls back to general for unknown domains", () => {
    expect(coerceIntentResult({ domain: "weird" }).domain).toBe("general");
    expect(coerceIntentResult({ domain: "finance" }).domain).toBe("finance");
  });

  it("handles empty/garbage input gracefully", () => {
    const r = coerceIntentResult(null);
    expect(r.domain).toBe("general");
    expect(r.intentClear).toBe(false);
    expect(r.recommendation).toBeNull();
    expect(r.jobSearch).toBe(false);
  });

  it("only treats an explicit true as a job-search signal", () => {
    expect(coerceIntentResult({ job_search: true }).jobSearch).toBe(true);
    expect(coerceIntentResult({ jobSearch: true }).jobSearch).toBe(true);
    expect(coerceIntentResult({ job_search: "true" }).jobSearch).toBe(false);
    expect(coerceIntentResult({ job_search: 1 }).jobSearch).toBe(false);
    expect(coerceIntentResult({}).jobSearch).toBe(false);
  });
});

describe("clarifyShouldContinue", () => {
  it("continues while unclear with a question", () => {
    const r = coerceIntentResult({
      intent_clear: false,
      question: "Tell me more?",
    });
    expect(clarifyShouldContinue(r)).toBe(true);
  });

  it("stops once intent is clear (no fixed cap)", () => {
    const r = coerceIntentResult({
      recommendation: { primary: { name: "X" }, alternatives: [] },
    });
    expect(clarifyShouldContinue(r)).toBe(false);
  });

  it("stops when unclear but no question is offered", () => {
    const r = coerceIntentResult({ intent_clear: false, question: "" });
    expect(clarifyShouldContinue(r)).toBe(false);
  });

  it("supports an unbounded number of exchanges", () => {
    // Five consecutive unclear turns all continue — there is no turn cap.
    for (let i = 0; i < 5; i++) {
      const r = coerceIntentResult({
        intent_clear: false,
        question: `Question ${i}?`,
      });
      expect(clarifyShouldContinue(r)).toBe(true);
    }
  });
});

describe("validateChecklist", () => {
  it("parses items with text/due_date/reason", () => {
    const items = validateChecklist({
      items: [
        { text: "Lodge form", due_date: "2026-07-01", reason: "Deadline" },
        { text: "Pay fee", reason: "Required" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]!.due_date).toBe("2026-07-01");
    expect(items[1]!.due_date).toBeNull();
  });

  it("drops items without text", () => {
    const items = validateChecklist({ items: [{ reason: "no text" }, { text: "ok" }] });
    expect(items).toHaveLength(1);
  });

  it("accepts a bare array", () => {
    expect(validateChecklist([{ text: "a" }])).toHaveLength(1);
  });

  it("returns empty for garbage", () => {
    expect(validateChecklist(null)).toEqual([]);
    expect(validateChecklist("nope")).toEqual([]);
  });
});
