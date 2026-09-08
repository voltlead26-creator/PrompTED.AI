import type { CapturedGroundingTarget } from "./captured-document-operation.ts";

// Authored synthetic facts, 6 September 2026. These are regression fixtures,
// not approved model evaluations or historical benchmark evidence.
export const facts = {
  recipient_name: "Synthetic Energy Co",
  issue_facts:
    "On 1 August 2026 I paid a ten-dollar invoice to Synthetic Energy Co. " +
    "My account shows two ten-dollar debits for that same invoice. I authorised " +
    "one payment. I checked the invoice number and both entries refer to the " +
    "same invoice. I have not received a reversal. I am writing about the " +
    "duplicate payment only. I have not alleged a criminal offence, received " +
    "an admission of wrongdoing or obtained a finding about the cause. " +
    "My records do not establish why the second debit occurred.",
  desired_outcome:
    "Please reverse the duplicate ten-dollar debit within ten business days " +
    "and confirm the correction in writing. Please identify the invoice in " +
    "your response and explain the correction made to my account. If you need " +
    "more information to locate the entries, please tell me which record is " +
    "needed before taking any further payment.",
};

export function output() {
  return {
    sections: [
      {
        section_key: "issue",
        content: facts.issue_facts,
        state: "final",
        source_references: ["input:recipient_name", "input:issue_facts"],
      },
      {
        section_key: "impact",
        content: "",
        state: "omitted_optional",
        source_references: [],
      },
      {
        section_key: "resolution",
        content: facts.desired_outcome,
        state: "final",
        source_references: ["input:desired_outcome"],
      },
      {
        section_key: "close",
        content:
          "Please respond in writing to the concerns and requested resolution set out in this letter.",
        state: "neutral_fallback",
        source_references: ["system:neutral-fallback"],
      },
    ],
  };
}

export function passingReview(target: CapturedGroundingTarget) {
  return {
    target_sha256: target.target_sha256,
    sections: target.units.map((unit) => ({
      section_key: unit.section_key,
      content_sha256: unit.content_sha256,
      checks: {
        material_claim_support: "pass",
        semantic_requirements: "pass",
        critical_details: "pass",
        source_conflicts: "pass",
        no_padding_or_repetition: "pass",
        no_benchmark_copying: "pass",
      },
      evidence: unit.state === "final"
        ? unit.source_references.map((source_id) => ({
          source_id,
          quote: facts[source_id.slice(6) as keyof typeof facts],
        }))
        : [],
      issues: [] as Array<{ code: string; detail: string }>,
    })),
  };
}
