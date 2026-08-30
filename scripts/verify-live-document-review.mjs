#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const REVIEW_CRITERIA = [
  "templateFit",
  "circumstanceCoverage",
  "factualGrounding",
  "voiceMatch",
  "intentFulfilment",
];

const ACCEPTANCE_FIXTURE_IDS = [
  "complete-resume",
  "resume-with-missing-facts",
  "upload-backed-resume",
  "cover-letter-with-unknown-recipient",
  "business-email",
];

export function evaluateHumanReview(automatedReport, review) {
  const failures = [];
  if (!automatedReport?.automatedPassed) failures.push("automated generation checks did not pass");
  if (automatedReport?.attempted !== automatedReport?.maximumAttempts || automatedReport?.attempted !== 5) {
    failures.push("the five-attempt acceptance set is incomplete");
  }
  const resultIds = (automatedReport?.results ?? []).map((result) => result?.id);
  if (
    resultIds.length !== ACCEPTANCE_FIXTURE_IDS.length ||
    new Set(resultIds).size !== ACCEPTANCE_FIXTURE_IDS.length ||
    ACCEPTANCE_FIXTURE_IDS.some((id) => !resultIds.includes(id))
  ) {
    failures.push("acceptance results must contain each of the five fixtures exactly once");
  }
  if (!String(review?.reviewer ?? "").trim()) failures.push("reviewer is required");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(review?.reviewedAt ?? ""))) {
    failures.push("reviewedAt must be an ISO timestamp");
  }

  for (const result of automatedReport?.results ?? []) {
    const fixtureReview = review?.fixtures?.[result.id];
    if (!fixtureReview) {
      failures.push(`${result.id}: human review is missing`);
      continue;
    }
    for (const criterion of REVIEW_CRITERIA) {
      if (fixtureReview[criterion] !== true) failures.push(`${result.id}: ${criterion} was not approved`);
    }
    if (String(fixtureReview.notes ?? "").trim().length < 20) {
      failures.push(`${result.id}: review notes must record specific evidence`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    reviewer: String(review?.reviewer ?? "").trim(),
    reviewedAt: review?.reviewedAt ?? null,
    criteria: REVIEW_CRITERIA,
  };
}

async function main() {
  const automatedPath = process.env.PROMPTED_ACCEPTANCE_OUTPUT?.trim();
  const reviewPath = process.env.PROMPTED_ACCEPTANCE_REVIEW?.trim();
  if (!automatedPath || !reviewPath) {
    throw new Error("PROMPTED_ACCEPTANCE_OUTPUT and PROMPTED_ACCEPTANCE_REVIEW are required");
  }
  const automatedReport = JSON.parse(await readFile(automatedPath, "utf8"));
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  const humanReview = evaluateHumanReview(automatedReport, review);
  const finalReport = {
    ...automatedReport,
    status: humanReview.passed ? "passed" : "human_review_failed",
    passed: humanReview.passed,
    humanReview,
  };
  const rendered = `${JSON.stringify(finalReport, null, 2)}\n`;
  const finalPath = process.env.PROMPTED_ACCEPTANCE_FINAL_OUTPUT?.trim();
  if (finalPath) await writeFile(finalPath, rendered, "utf8");
  process.stdout.write(rendered);
  if (!humanReview.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
