import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHumanReview } from "./verify-live-document-review.mjs";

const report = {
  automatedPassed: true,
  attempted: 5,
  maximumAttempts: 5,
  results: [
    { id: "complete-resume" },
    { id: "resume-with-missing-facts" },
    { id: "upload-backed-resume" },
    { id: "cover-letter-with-unknown-recipient" },
    { id: "business-email" },
  ],
};

function fixtureReview(overrides = {}) {
  return {
    templateFit: true,
    circumstanceCoverage: true,
    factualGrounding: true,
    voiceMatch: true,
    intentFulfilment: true,
    notes: "Specific wording and source facts were checked against the fixture.",
    ...overrides,
  };
}

test("accepts explicit evidence-backed review of all five outputs", () => {
  const reviewed = evaluateHumanReview(report, {
    reviewer: "Kai Church",
    reviewedAt: "2026-08-15T09:30:00.000Z",
    fixtures: Object.fromEntries(report.results.map(({ id }) => [id, fixtureReview()])),
  });
  assert.equal(reviewed.passed, true);
  assert.deepEqual(reviewed.failures, []);
});

test("rejects missing, failed, or evidence-free review criteria", () => {
  const reviewed = evaluateHumanReview(report, {
    reviewer: "Kai Church",
    reviewedAt: "2026-08-15T09:30:00.000Z",
    fixtures: {
      "complete-resume": fixtureReview({ factualGrounding: false }),
      "resume-with-missing-facts": fixtureReview({ notes: "looks fine" }),
    },
  });
  assert.equal(reviewed.passed, false);
  assert.ok(reviewed.failures.includes("complete-resume: factualGrounding was not approved"));
  assert.ok(reviewed.failures.includes("resume-with-missing-facts: review notes must record specific evidence"));
  assert.ok(reviewed.failures.includes("upload-backed-resume: human review is missing"));
});

test("rejects five result rows that duplicate a fixture or omit an acceptance case", () => {
  const duplicateReport = {
    ...report,
    results: report.results.map((result, index) =>
      index === 4 ? { id: "complete-resume" } : result
    ),
  };
  const reviewed = evaluateHumanReview(duplicateReport, {
    reviewer: "Kai Church",
    reviewedAt: "2026-08-15T09:30:00.000Z",
    fixtures: Object.fromEntries(report.results.map(({ id }) => [id, fixtureReview()])),
  });

  assert.equal(reviewed.passed, false);
  assert.ok(reviewed.failures.includes("acceptance results must contain each of the five fixtures exactly once"));
});
