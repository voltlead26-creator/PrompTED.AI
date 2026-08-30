// supabase/functions/_shared/draft-validator.test.ts
// Hermetic unit test (no remote imports) so the CI gate cannot break on a
// std-library version bump and needs no network at test time.
import { stripResidual, validateSection } from "./draft-validator.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
const clean = (c: string): void =>
  assert(validateSection({ content: c }).length === 0, `expected clean: ${JSON.stringify(c)}`);
const flagged = (c: string): void =>
  assert(validateSection({ content: c }).length > 0, `expected flagged: ${JSON.stringify(c)}`);

Deno.test("clean final wording passes", () => {
  clean(
    "Dear Hiring Manager,\n\nI am writing to apply for the venue supervisor role. I bring five years of hospitality experience and a record of leading busy teams.",
  );
  clean("Please see our menu at [our website](https://example.com) for details.");
  clean("![logo](logo.png)\n\nWelcome to the team.");
  clean("- [ ] Confirm the booking\n- [x] Pay the deposit");
  clean("## Experience\n\nLed a team of five across two venues, lifting weekend covers by thirty percent.");
});

Deno.test("bracketed and fill-in placeholders are flagged", () => {
  flagged("Dear [recipient name], thank you for your time.");
  flagged("I am available to start on [date].");
  flagged("{{customer_name}}, welcome aboard.");
  flagged("Reach me at <your email here>.");
  flagged("Signature line: ____");
  flagged("Reference: XXXX");
  flagged("Delivery date: TBD");
});

Deno.test("instruction and scaffold leakage is flagged", () => {
  flagged("Use this section to describe your experience.");
  flagged("Missing vital details: recipient name, start date.");
  flagged("As an AI, I cannot verify these claims.");
  flagged("Here's a template you can adapt for your needs.");
  flagged("Insert your reason for leaving here.");
});

Deno.test("empty content is flagged", () => {
  flagged("");
  flagged("   \n   ");
});

Deno.test("stripResidual removes placeholders but keeps real wording", () => {
  const out = stripResidual("Dear [recipient name], thank you for the interview.");
  assert(!out.includes("["), "bracket should be removed");
  assert(out.includes("thank you for the interview"), "real wording should remain");
});

Deno.test("stripResidual preserves links and checkboxes, drops leak", () => {
  const out = stripResidual(
    "See [our site](https://x.com) and confirm [TBD].\nUse this section to add detail.\n- [ ] follow up",
  );
  assert(out.includes("(https://x.com)"), "markdown link should survive");
  assert(!/\bTBD\b/.test(out), "TBD placeholder should be gone");
  assert(!out.includes("Use this section"), "instruction line should be dropped");
  assert(out.includes("[ ]"), "task checkbox should survive");
});

Deno.test("stripResidual of a pure placeholder yields empty string", () => {
  assert(stripResidual("[insert everything here]") === "", "should be empty");
});

Deno.test("seed markers and document-describing scaffold are flagged", () => {
  flagged("<!-- prompted:template-draft --><p>Anything here.</p>");
  flagged(
    "Achievement stories will be drafted in a situation, task, action, result structure using only real examples the user can explain.",
  );
  flagged("This section will summarise the confirmed results and examples.");
  flagged("This section captures the important facts, names, and dates.");
});

Deno.test("legitimate future tense and clauses are NOT flagged", () => {
  clean("I will bring five years of hospitality experience to this role.");
  clean("Services will be provided under the terms set out in this agreement.");
  clean("I would like to discuss whether there is room to review my pay.");
});

Deno.test("tag-only rich-text husks are flagged empty", () => {
  flagged("<p><br></p>");
  flagged("<p>&nbsp;</p>");
  flagged("<div><p> </p><p><br/></p></div>");
  flagged("&nbsp;&#160;");
});

Deno.test("real HTML wording still passes", () => {
  clean("<p>I am writing to confirm my availability for the Saturday shift.</p>");
});
