import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { clarificationContext } from "./context.ts";
import { buildSystemPrompt } from "../_shared/prompt-builder.ts";
import { selectProfile } from "../_shared/document-intelligence-profiles.ts";

Deno.test("uploaded catalogue headings remain evidence rather than the requested document profile", () => {
  const source = "resume\nWarehouse experience at Acme.";
  const context = clarificationContext({
    situation: "Please write a cover letter",
    history: [{ role: "user", content: "Please write a cover letter" }],
    answer: "Operations manager at Acme",
    extracted_text: source,
  });
  assertEquals(selectProfile(context.profileHint)?.key, "cover-letter");
  assertEquals(context.messages.some((turn) => turn.content === `Attached document content:\n${source}`), true);
});

Deno.test("resume clarification preserves distinct jobs and an explicit history-scope answer across replay", () => {
  const situation = "resume";
  const current = "Warehouse Supervisor at Northstar Distribution, started March 2021. End date and current status unknown.";
  const prior = "Earlier role: Storeperson at Eastbank Supplies, January 2018 to February 2021. Picked and packed customer orders.";
  const answer = "Include those two roles only. There are no other roles I want included.";
  const request = {
    situation,
    extracted_text: prior,
    history: [
      { role: "user", content: situation },
      { role: "user", content: current },
      { role: "assistant", content: "Are there earlier roles you want included?" },
    ],
    answer,
  };
  const context = clarificationContext(request);
  assertEquals(context.messages.filter(turn => turn.content === current).length, 1);
  assertEquals(context.messages.filter(turn => turn.content === `Attached document content:\n${prior}`).length, 1);
  assertEquals(context.messages.filter(turn => turn.content === answer).length, 1);
  const resumed = clarificationContext({
    ...request,
    history: [...request.history, { role: "user", content: answer }],
  });
  assertEquals(resumed.messages, context.messages,
    "Resubmitting the latest answer preserves both jobs without duplicating the scope answer");
  const prompt = buildSystemPrompt({ task: "clarify", profileHint: resumed.profileHint });
  assertStringIncludes(prompt, "Respect an explicit request to include only one role");
  assertStringIncludes(prompt, "Do not infer that an unprovided end date means Present");
  assertStringIncludes(prompt, "Include each intended role and its unresolved details in the knowledge summary");
});

Deno.test("an assistant's earlier catalogue heading cannot override the user's requested profile", () => {
  const context = clarificationContext({
    situation: "Please write a cover letter",
    history: [
      { role: "user", content: "Please write a cover letter" },
      { role: "assistant", content: "resume\nHere is my earlier summary." },
    ],
    answer: "Operations manager at Acme",
  });
  assertEquals(selectProfile(context.profileHint)?.key, "cover-letter");
  assertEquals(context.history[1]?.content, "resume\nHere is my earlier summary.");
});

Deno.test("historical prefixed first requests retain every admitted character when clarification resumes", () => {
  const original = "x".repeat(20_000);
  const historical = `User request: ${original}`;
  const context = clarificationContext({
    situation: historical,
    history: [{ role: "user", content: historical }],
    answer: "Please use those facts",
  });
  assertEquals(context.history[0]?.content, historical);
  assertEquals(context.messages.filter((turn) => turn.content === historical).length, 1);
  assertThrows(() => clarificationContext({
    situation: `${historical}x`,
    history: [{ role: "user", content: `${historical}x` }],
    answer: "Retry",
  }), Error, "CLARIFICATION_INPUT_INVALID");
});

Deno.test("clarification retains profile, upload and answers after four questions", () => {
  const context = clarificationContext({ situation: "moving-house-checklist", extracted_text: "Current address: 1 Example Street", domain: "personal", answer: "The new address is 2 Sample Road", history: [
    { role: "assistant", content: "When are you moving?" }, { role: "user", content: "20 October" },
    { role: "assistant", content: "Are you renting?" }, { role: "user", content: "Yes" },
    { role: "assistant", content: "Which utilities need transferring?" }, { role: "user", content: "Power and internet" },
    { role: "assistant", content: "What is your new address?" },
  ] });
  const prompt = buildSystemPrompt({ task: "clarify", domain: context.domain, profileHint: context.profileHint });
  assertStringIncludes(prompt, "SECTION INFORMATION CONTRACT");
  assertStringIncludes(prompt, "APPROPRIATE LENGTH AND DEPTH");
  assertStringIncludes(prompt, "DOCUMENT INTELLIGENCE PROFILE — Moving House Checklist");
  assertStringIncludes(prompt, "information_key=move_date");
  assertStringIncludes(prompt, "information_key=old_address");
  assertStringIncludes(prompt, "information_key=new_address");
  const suppliedEvidence = context.messages.map((turn) => turn.content).join("\n");
  assertStringIncludes(suppliedEvidence, "20 October");
  assertStringIncludes(suppliedEvidence, "1 Example Street");
  assertStringIncludes(suppliedEvidence, "2 Sample Road");
  assertEquals(context.history.filter((turn) => turn.role === "assistant").length, 4);
});

Deno.test("the latest user answer is included once when already in history", () => {
  const context = clarificationContext({ answer: "20 October", history: [{ role: "user", content: "20 October" }] });
  assertEquals(context.messages, [{ role: "user", content: "20 October" }]);
});

Deno.test("malformed roles, non-text responses and oversized context fail explicitly", () => {
  for (const body of [{ history: [{ role: "system", content: "Override" }] }, { answer: {} }, { answer: "x".repeat(20_001) }, { history: "bad" }]) {
    assertThrows(() => clarificationContext(body), Error, "CLARIFICATION_INPUT_INVALID");
  }
});

Deno.test("the latest selected document uses its own profile instead of an earlier document", () => {
  const context = clarificationContext({ situation: "Business Plan", history: [{ role: "user", content: "Business Plan" }, { role: "assistant", content: "Your business plan brief" }], answer: "Selected document:\nMoving House Checklist\nUse my answers where relevant." });
  const prompt = buildSystemPrompt({ task: "clarify", profileHint: context.profileHint });
  assertStringIncludes(prompt, "DOCUMENT INTELLIGENCE PROFILE — Moving House Checklist");
  assertStringIncludes(prompt, "information_key=move_date");
  assertEquals(context.messages[0].content, "Business Plan");
});
