import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGeneration } from "./verify-live-document-generation.mjs";

const template = {
  sections: [
    { key: "opening", name: "Opening", is_required: true },
    { key: "body", name: "Body", is_required: true },
  ],
};

test("accepts complete final wording that retains supplied evidence", () => {
  const result = evaluateGeneration({
    fixture: {
      mode: "cover-letter",
      evidence: ["Northstar", "18%"],
      conversationContext: "Northstar. Reduced missed appointments by 18%.",
    },
    template,
    events: [
      { type: "section", key: "opening", content: "Dear Hiring Manager, I am applying to Northstar." },
      { type: "section", key: "body", content: "I reduced missed appointments by 18%." },
    ],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test("rejects blank sections, instruction leakage and lost source facts", () => {
  const result = evaluateGeneration({
    fixture: { mode: "business-email", evidence: ["INV-2048"] },
    template,
    events: [
      { type: "section", key: "opening", content: "Ask the user to fill in the recipient." },
      { type: "section", key: "body", content: "" },
    ],
  });

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("forbidden final wording")));
  assert.ok(result.failures.includes("Body: blank or missing"));
  assert.ok(result.failures.includes("missing supplied evidence: INV-2048"));
});

test("allows declared placeholders but rejects malformed raw placeholder markers", () => {
  const valid = evaluateGeneration({
    fixture: { mode: "resume", evidence: ["Sam Lee"] },
    template,
    events: [
      { type: "section", key: "opening", content: "Sam Lee — {{TED_PLACEHOLDER:resume.phone:phone number}}" },
      { type: "section", key: "body", content: "Geelong-based warehouse candidate." },
    ],
  });
  const malformed = evaluateGeneration({
    fixture: { mode: "resume", evidence: ["Sam Lee"] },
    template,
    events: [
      { type: "section", key: "opening", content: "Sam Lee — TED_PLACEHOLDER phone" },
      { type: "section", key: "body", content: "Geelong-based warehouse candidate." },
    ],
  });

  assert.equal(valid.passed, true);
  assert.equal(malformed.passed, false);
  assert.ok(malformed.failures.includes("Opening: malformed placeholder token"));
});

test("rejects generic or stylistically mismatched wording even when facts are present", () => {
  const result = evaluateGeneration({
    fixture: {
      mode: "cover-letter",
      evidence: ["Northstar", "18%"],
      conversationContext: "Northstar. Reduced missed appointments by 18%.",
      requiredSignals: [/Dear Hiring Manager/i],
      forbiddenSignals: [/thrilled to apply/i],
      maxAverageSentenceWords: 8,
    },
    template,
    events: [
      {
        type: "section",
        key: "opening",
        content: "To whom it may concern, I am a results-driven dynamic professional thrilled to apply to Northstar.",
      },
      {
        type: "section",
        key: "body",
        content: "I achieved 18% and would leverage my proven track record to create game-changing synergy.",
      },
    ],
  });

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("requested voice")));
  assert.ok(result.failures.some((failure) => failure.includes("missing required circumstance")));
  assert.ok(result.failures.some((failure) => failure.includes("average sentence length")));
});

test("rejects duplicated sections and unsupported factual claims despite retained evidence", () => {
  const duplicated =
    "Northstar candidate increased revenue by 900% and completed a doctorate at Oxford University.";
  const result = evaluateGeneration({
    fixture: {
      mode: "resume",
      evidence: ["Northstar"],
      situation: "Write a resume for a Northstar operations manager.",
      conversationContext: "The only confirmed achievement is reducing delays by 18%.",
      sectionSignals: {
        opening: [/Northstar/i],
        body: [/Northstar/i],
      },
    },
    template,
    events: [
      { type: "section", key: "opening", content: duplicated },
      { type: "section", key: "body", content: duplicated },
    ],
  });

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("duplicated")));
  assert.ok(result.failures.some((failure) => failure.includes("unsupported numeric claim: 900%")));
  assert.ok(result.failures.some((failure) => failure.includes("unsupported qualification claim")));
});

test("accepts a natural paraphrase of a courteous request", () => {
  const result = evaluateGeneration({
    fixture: {
      mode: "business-email",
      evidence: ["INV-2048", "12", "14"],
      situation: "Ask Casey to correct INV-2048. It lists 14 chairs but 12 arrived.",
      requiredSignals: [/(?:please|could you|would you).*(?:corrected|revised) invoice/is],
    },
    template,
    events: [
      { type: "section", key: "opening", content: "Hi Casey — INV-2048" },
      {
        type: "section",
        key: "body",
        content: "Would you send a revised invoice? It lists 14 chairs, but 12 arrived.",
      },
    ],
  });

  assert.equal(result.passed, true);
});
