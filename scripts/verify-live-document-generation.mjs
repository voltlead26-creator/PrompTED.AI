#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const MAX_GENERATION_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 180_000;
const VALID_PLACEHOLDER = /\{\{TED_PLACEHOLDER:[A-Za-z0-9._-]+:[^{}]+\}\}/g;
const FORBIDDEN_FINAL_WORDING = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /TED will replace this scaffold/i,
  /prompted:template-draft/i,
  /\binsert (?:your|the)\b/i,
  /\bfill in (?:your|the)\b/i,
  /\bthis section should\b/i,
  /\bprompt the user\b/i,
  /\bask the user\b/i,
  /\bsystem prompt\b/i,
  /\bconversation_context\b/i,
  /\bupload_context\b/i,
];
const GENERIC_INFLATED_WORDING = [
  /\bresults[- ]driven\b/i,
  /\bdynamic professional\b/i,
  /\bproven track record\b/i,
  /\bgame[- ]chang(?:e|ing)\b/i,
  /\bsynerg(?:y|ies)\b/i,
  /\bpassionate professional\b/i,
];
const QUALIFICATION_TERMS = [
  "bachelor",
  "certificate",
  "degree",
  "diploma",
  "doctorate",
  "institute",
  "master",
  "university",
];

const FIXTURES = [
  {
    id: "complete-resume",
    template: "resume",
    situation: "Write a resume for Elena Rossi applying for an Operations Manager role in Melbourne.",
    conversationContext: [
      "Elena writes in a calm, practical and direct style. Use Australian English and short sentences.",
      "Elena Rossi, Melbourne VIC, 0400 111 222, elena.rossi@example.com.",
      "Operations Lead at Northstar Coworking, March 2021 to present. Leads 12 people across three sites.",
      "Reduced member request response time by 35% and introduced a weekly safety walk-through.",
      "Site Coordinator at Harbour Workspaces, February 2018 to February 2021.",
      "Diploma of Leadership and Management, Victoria Polytechnic, completed 2020.",
      "Skills: team leadership, facilities coordination, member service, incident response, rostering and vendor management.",
      "Referees available on request.",
    ].join("\n"),
    evidence: ["Elena Rossi", "Northstar Coworking", "35%"],
    requiredSignals: [/leads? 12 (?:people|staff|team members)/i, /weekly safety/i],
    sectionSignals: {
      contact_details: [/Elena Rossi/i, /Melbourne/i, /0400 111 222/, /elena\.rossi@example\.com/i],
      summary: [/operations (?:manager|lead)/i],
      experience: [/Northstar Coworking/i, /35%/, /12 (?:people|staff|team members)/i],
      education: [/Diploma of Leadership and Management/i, /Victoria Polytechnic/i, /2020/],
      skills: [/team leadership/i, /vendor management/i],
    },
    forbiddenSignals: [/\bI (?:am|have|lead|manage)\b/i],
    maxAverageSentenceWords: 22,
    mode: "resume",
  },
  {
    id: "resume-with-missing-facts",
    template: "resume",
    situation: "Write a usable resume for Sam Lee seeking an entry-level warehouse role. Do not invent missing dates, employers, qualifications or contact details.",
    conversationContext: [
      "Sam writes plainly and avoids corporate language. Use Australian English.",
      "Confirmed facts: Sam Lee lives in Geelong and has helped a family business receive stock, count inventory and keep work areas tidy.",
      "No phone, email, employer name, dates, qualifications or referee details were supplied.",
    ].join("\n"),
    evidence: ["Sam Lee", "Geelong"],
    requiredSignals: [/receiv(?:e|ed|ing) stock/i, /count(?:ed|ing)? inventory/i],
    sectionSignals: {
      contact_details: [/Sam Lee/i, /Geelong/i],
      summary: [/warehouse/i],
      experience: [/family business/i, /receiv(?:e|ed|ing) stock/i, /count(?:ed|ing)? inventory/i],
      education: [/TED_PLACEHOLDER/i],
      skills: [/(?:stock|inventory|tidy)/i],
    },
    forbiddenSignals: [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /\b(?:\+?61|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/],
    maxAverageSentenceWords: 18,
    mode: "resume",
  },
  {
    id: "upload-backed-resume",
    template: "resume",
    situation: "Update this resume for a Business Centre Manager role while retaining confirmed source facts.",
    conversationContext: "The user prefers warm, capable and plain-spoken wording in Australian English.",
    uploadContext: [
      "SOURCE RESUME — FICTIONAL ACCEPTANCE FIXTURE",
      "Jordan Vale — Business Centre Manager, Northstar Coworking Balaclava, 2022-present.",
      "Coordinates member experience, tenant communication and daily centre operations for 180 members.",
      "Introduced a triage process that reduced unresolved member requests from 22 to 7 per week.",
      "Certificate IV in Business, Holmesglen Institute, 2021.",
    ].join("\n"),
    evidence: ["Northstar Coworking Balaclava", "180", "22", "7"],
    requiredSignals: [/reduced unresolved member requests/i, /Certificate IV in Business/i],
    sectionSignals: {
      contact_details: [/Jordan Vale/i],
      summary: [/Business Centre Manager/i],
      experience: [/Northstar Coworking Balaclava/i, /180/, /22/, /7/],
      education: [/Certificate IV in Business/i, /Holmesglen Institute/i, /2021/],
      skills: [/(?:member experience|tenant communication|centre operations)/i],
    },
    maxAverageSentenceWords: 22,
    mode: "resume",
  },
  {
    id: "cover-letter-with-unknown-recipient",
    template: "cover-letter",
    situation: "Write a cover letter for Priya Nair applying for an Operations Coordinator role at Greenline Services. The recipient name is unknown.",
    conversationContext: [
      "Priya's natural style is thoughtful, direct and specific. Use Australian English and avoid inflated claims.",
      "Priya coordinates supplier bookings, weekly schedules and customer updates for a 15-person maintenance team.",
      "She redesigned the booking checklist and reduced missed appointments by 18%.",
      "Greenline Services appeals to her because it publicly prioritises reliable local service.",
    ].join("\n"),
    evidence: ["Greenline Services", "18%"],
    requiredSignals: [/(?:Dear Hiring Manager|Dear Recruitment Team)/i, /15-person maintenance team/i],
    sectionSignals: {
      opening: [/Priya Nair/i, /Operations Coordinator/i, /Greenline Services/i],
      fit: [/15-person maintenance team/i, /18%/],
      motivation: [/reliable local service/i],
      closing: [/(?:interview|discuss|speak)/i],
    },
    forbiddenSignals: [/To whom it may concern/i, /Dear \[.*?\]/i],
    maxAverageSentenceWords: 24,
    mode: "cover-letter",
  },
  {
    id: "business-email",
    template: "business-email",
    situation: "Write an email from Alex Morgan to supplier Casey Tran asking for a corrected invoice by Friday 21 August 2026.",
    conversationContext: [
      "Alex writes in short, courteous sentences. The goal is resolution, not blame.",
      "Invoice INV-2048 incorrectly lists 14 chairs. Only 12 chairs were delivered to the Carlton office.",
      "Ask Casey to issue a corrected invoice before the accounts run on Friday 21 August 2026.",
    ].join("\n"),
    evidence: ["INV-2048", "12", "14", "21 August 2026"],
    requiredSignals: [/(?:Hi|Dear) Casey/i, /(?:please|could you|would you).*(?:corrected|revised) invoice/is],
    sectionSignals: {
      subject: [/Casey/i, /INV-2048/i],
      body: [/14 chairs/i, /12 chairs/i, /Carlton/i],
      action: [/(?:corrected|revised) invoice/i, /21 August 2026/i],
    },
    forbiddenSignals: [/\byou (?:made|caused|incorrectly)\b/i],
    maxAverageSentenceWords: 18,
    mode: "business-email",
  },
];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function loadTemplates() {
  return JSON.parse(
    await readFile(new URL("../packages/shared/src/templates/templates.data.json", import.meta.url), "utf8"),
  );
}

function requestFor(fixture, template) {
  return {
    template_id: template.slug,
    situation: fixture.situation,
    conversation_context: fixture.conversationContext,
    upload_context: fixture.uploadContext ?? "",
    sections: template.sections.map((section) => ({
      key: section.key,
      label: section.name,
      required: section.is_required !== false,
      hint: section.description,
      vital: section.vital,
      improver: section.improver,
    })),
    domain: template.domain,
    structure_type: template.structure_type,
    advice_boundary: template.advice_boundary,
    document_name: template.name,
    generation_request_id: randomUUID(),
  };
}

function parseEventBlock(block) {
  const payload = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!payload || payload === "[DONE]") return null;
  return JSON.parse(payload);
}

async function invokeGeneration({ endpoint, token, anonKey, body }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(anonKey ? { apikey: anonKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Generation request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }

    const events = [];
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseEventBlock(block);
        if (event) events.push(event);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseEventBlock(buffer);
      if (event) events.push(event);
    }
    const pipelineError = events.find((event) => event.type === "error");
    if (pipelineError) throw new Error(`Generation pipeline error: ${JSON.stringify(pipelineError)}`);
    return events;
  } finally {
    clearTimeout(timeout);
  }
}

function normalisedWordSet(value) {
  return new Set(
    value
      .toLocaleLowerCase("en-AU")
      .replace(VALID_PLACEHOLDER, " ")
      .match(/[a-z0-9%]+/g) ?? [],
  );
}

function sectionSimilarity(left, right) {
  const leftWords = normalisedWordSet(left);
  const rightWords = normalisedWordSet(right);
  if (leftWords.size < 8 || rightWords.size < 8) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / new Set([...leftWords, ...rightWords]).size;
}

function sectionSemanticFailures(fixture, sections) {
  const failures = [];
  for (const [key, patterns] of Object.entries(fixture.sectionSignals ?? {})) {
    const content = sections.get(key) ?? "";
    for (const pattern of patterns) {
      if (!pattern.test(content)) failures.push(`${key}: missing section-specific signal ${pattern}`);
    }
  }

  const populated = [...sections.entries()].filter(([, content]) => content.trim());
  for (let left = 0; left < populated.length; left += 1) {
    for (let right = left + 1; right < populated.length; right += 1) {
      const [leftKey, leftContent] = populated[left];
      const [rightKey, rightContent] = populated[right];
      if (sectionSimilarity(leftContent, rightContent) >= 0.85) {
        failures.push(`${leftKey} and ${rightKey}: duplicated or semantically indistinct wording`);
      }
    }
  }
  return failures;
}

function groundingFailures(fixture, fullText) {
  const source = [fixture.situation, fixture.conversationContext, fixture.uploadContext]
    .filter(Boolean)
    .join("\n");
  const failures = [];
  const numericFactPattern = /\d+(?:[.,]\d+)?%?/g;
  const sourceNumbers = new Set(source.match(numericFactPattern) ?? []);
  const outputNumbers = new Set(
    fullText.replace(VALID_PLACEHOLDER, " ").match(numericFactPattern) ?? [],
  );
  for (const value of outputNumbers) {
    if (!sourceNumbers.has(value)) failures.push(`unsupported numeric claim: ${value}`);
  }

  const lowerSource = source.toLocaleLowerCase("en-AU");
  const lowerOutput = fullText.toLocaleLowerCase("en-AU");
  for (const term of QUALIFICATION_TERMS) {
    if (lowerOutput.includes(term) && !lowerSource.includes(term)) {
      failures.push(`unsupported qualification claim: ${term}`);
    }
  }
  return failures;
}

function averageSentenceWordCount(value) {
  const counts = value
    .split(/(?:[.!?]+|\n+)/)
    .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
    .filter(Boolean);
  return counts.length ? counts.reduce((sum, count) => sum + count, 0) / counts.length : 0;
}

export function evaluateGeneration({ fixture, template, events }) {
  const sections = new Map(
    events.filter((event) => event.type === "section").map((event) => [event.key, String(event.content ?? "")]),
  );
  const failures = requiredSectionFailures(template, sections);
  const fullText = [...sections.values()].join("\n\n");
  failures.push(...sectionSemanticFailures(fixture, sections));
  failures.push(...groundingFailures(fixture, fullText));
  failures.push(...voiceAndCircumstanceFailures(fixture, fullText));
  failures.push(...documentTypeFailures(fixture, fullText));

  return {
    passed: failures.length === 0,
    failures,
    sections: Object.fromEntries(sections),
    unresolvedPlaceholders: events
      .filter((event) => event.type === "unresolved_placeholders")
      .flatMap((event) => event.placeholders ?? []),
  };
}

function requiredSectionFailures(template, sections) {
  const failures = [];
  for (const expected of template.sections.filter((section) => section.is_required !== false)) {
    const content = sections.get(expected.key)?.trim() ?? "";
    if (!content) {
      failures.push(`${expected.name}: blank or missing`);
      continue;
    }
    const withoutValidPlaceholders = content.replace(VALID_PLACEHOLDER, "");
    if (/TED_PLACEHOLDER/i.test(withoutValidPlaceholders)) {
      failures.push(`${expected.name}: malformed placeholder token`);
    }
    for (const pattern of FORBIDDEN_FINAL_WORDING) {
      if (pattern.test(withoutValidPlaceholders)) failures.push(`${expected.name}: forbidden final wording ${pattern}`);
    }
  }
  return failures;
}

function voiceAndCircumstanceFailures(fixture, fullText) {
  const failures = [];
  for (const signal of fixture.evidence) {
    if (!fullText.toLocaleLowerCase("en-AU").includes(signal.toLocaleLowerCase("en-AU"))) {
      failures.push(`missing supplied evidence: ${signal}`);
    }
  }
  for (const pattern of [...GENERIC_INFLATED_WORDING, ...(fixture.forbiddenSignals ?? [])]) {
    if (pattern.test(fullText)) failures.push(`wording does not match the requested voice: ${pattern}`);
  }
  for (const pattern of fixture.requiredSignals ?? []) {
    if (!pattern.test(fullText)) failures.push(`missing required circumstance or voice signal: ${pattern}`);
  }
  if (fixture.maxAverageSentenceWords) {
    const averageSentenceWords = averageSentenceWordCount(fullText);
    if (averageSentenceWords > fixture.maxAverageSentenceWords) {
      failures.push(
        `average sentence length ${averageSentenceWords.toFixed(1)} exceeds requested voice limit ${fixture.maxAverageSentenceWords}`,
      );
    }
  }
  return failures;
}

function documentTypeFailures(fixture, fullText) {
  const failures = [];
  if (fixture.mode === "resume" && /\bDear\b/i.test(fullText)) {
    failures.push("resume used letter-style greeting");
  }
  if (fixture.mode === "cover-letter" && !/\bI\b/.test(fullText)) {
    failures.push("cover letter did not use the user's first-person voice");
  }
  if (fixture.mode === "business-email" && !/\bCasey\b/i.test(fullText)) {
    failures.push("business email did not address the supplied recipient");
  }
  return failures;
}

async function main() {
  const endpoint = process.env.PROMPTED_ACCEPTANCE_API_URL?.trim() ||
    "https://ted.littlemissscarlett.co/api/generate-document";
  const token = requiredEnv("PROMPTED_ACCEPTANCE_ACCESS_TOKEN");
  const anonKey = process.env.PROMPTED_ACCEPTANCE_ANON_KEY?.trim() || "";
  const templates = await loadTemplates();
  const results = [];

  if (FIXTURES.length !== MAX_GENERATION_ATTEMPTS) {
    throw new Error(`Acceptance budget must remain exactly ${MAX_GENERATION_ATTEMPTS} attempts`);
  }

  for (const [index, fixture] of FIXTURES.entries()) {
    const template = templates.find((candidate) => candidate.slug === fixture.template);
    if (!template) throw new Error(`Unknown fixture template: ${fixture.template}`);
    process.stderr.write(`Running live generation ${index + 1}/${MAX_GENERATION_ATTEMPTS}: ${fixture.id}\n`);
    const events = await invokeGeneration({
      endpoint,
      token,
      anonKey,
      body: requestFor(fixture, template),
    });
    const result = evaluateGeneration({ fixture, template, events });
    results.push({ id: fixture.id, template: fixture.template, ...result });
    if (!result.passed) break;
  }

  const automatedPassed =
    results.length === MAX_GENERATION_ATTEMPTS && results.every((result) => result.passed);
  const report = {
    endpoint,
    attempted: results.length,
    maximumAttempts: MAX_GENERATION_ATTEMPTS,
    automatedPassed,
    status: automatedPassed ? "awaiting_human_review" : "automated_checks_failed",
    humanReviewRequired: true,
    humanReviewCriteria: [
      "templateFit",
      "circumstanceCoverage",
      "factualGrounding",
      "voiceMatch",
      "intentFulfilment",
    ],
    generatedAt: new Date().toISOString(),
    results,
  };
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.PROMPTED_ACCEPTANCE_OUTPUT?.trim()) {
    await writeFile(process.env.PROMPTED_ACCEPTANCE_OUTPUT.trim(), rendered, "utf8");
  }
  process.stdout.write(rendered);
  if (!report.automatedPassed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
