import { ok as assert, deepStrictEqual as assertEquals, throws as assertThrows } from "node:assert/strict";
import { buildSystemPrompt, capturePromptProfileSelectionContext, PROMPT_PROFILE_SELECTOR_VERSION } from "./prompt-builder.ts";
import { DIPS, DOCUMENT_PROFILE_SELECTOR_VERSION, selectProfile } from "./document-intelligence-profiles.ts";
import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};

Deno.test("recommend prompt embeds every real catalogue name as ground truth", () => {
  const prompt = buildSystemPrompt({ task: "recommend", domain: "business" });
  const names = [...coreTemplates, ...phase2Templates].map((t) =>
    (t as { name: string }).name
  );
  assert(names.length > 50, "expected the catalogue to have a substantial number of templates");
  for (const name of names) {
    assert(prompt.includes(name), `expected prompt to include catalogue name "${name}"`);
  }
});

Deno.test("recommend prompt forbids inventing a plausible-sounding name outside the catalogue", () => {
  const prompt = buildSystemPrompt({ task: "recommend" });
  assert(prompt.includes("MUST be exactly one of these PrompTED catalogue names"));
  assert(
    prompt.includes("choose the closest real catalogue name rather than inventing one"),
  );
  // Regression case: this exact plausible-but-nonexistent name previously
  // slipped through unconstrained and produced a blank generic-blueprint
  // document (Key details / Main content / Next steps / Closing) with no
  // real content, since nothing in the catalogue resolves to it.
  assert(!prompt.includes("Marketing and Sales Strategy"));
});

Deno.test("initial intent supports profile-grounded question batches and a knowledge checkpoint", () => {
  const prompt = buildSystemPrompt({
    task: "intent",
    profileHint: "I want to contest a towing incident and recover the fee.",
  });

  assert(prompt.includes("ask two or three focused questions together"));
  assert(prompt.includes("section information contracts"));
  assert(prompt.includes("obtain explicit user confirmation first"));
  assert(prompt.includes('"knowledge_summary"'));
  assert(!prompt.includes("MUST ask exactly ONE"));
});

Deno.test("every active document profile carries its own facts, context and depth into clarification", () => {
  assert(DIPS.length > 50);
  for (const profile of DIPS) {
    const prompt = buildSystemPrompt({ task: "clarify", profileHint: profile.key });
    assert(prompt.includes(`DOCUMENT INTELLIGENCE PROFILE — ${profile.label}`));
    assert(prompt.includes("APPROPRIATE LENGTH AND DEPTH"), profile.key);
    assert(prompt.includes("SPECIFIC EVIDENCE REQUIREMENTS"), profile.key);
    for (const section of profile.informationContract?.sections ?? []) {
      assert(prompt.includes(`SECTION INFORMATION CONTRACT — ${section.sectionKey}`));
      for (const fact of section.requiredInformation) {
        assert(prompt.includes(`information_key=${fact.key}; label=${fact.label}`), `${profile.key}:${fact.key}`);
      }
    }
  }
});

Deno.test("the selected document profile takes precedence over unrelated user memory", () => {
  const prompt = buildSystemPrompt({ task: "clarify", domain: "personal", profileHint: "moving-house-checklist", extra: "User previously prepared a resume CV cover letter job application with experience, skills and education." });
  assert(prompt.includes("DOCUMENT INTELLIGENCE PROFILE — Moving House Checklist"));
  assert(prompt.includes("information_key=move_date"));
});


Deno.test("server profile selection snapshot preserves all existing candidates and selector defaults", () => {
  const before = JSON.stringify(DIPS);
  const context = capturePromptProfileSelectionContext();
  assertEquals(context.version, PROMPT_PROFILE_SELECTOR_VERSION);
  assertEquals(context.profileSelectorVersion, DOCUMENT_PROFILE_SELECTOR_VERSION);
  assertEquals(context.profiles, DIPS);
  assertEquals(context.profiles.length, 86);
  assert(context.profiles !== DIPS);
  for (const profile of DIPS) {
    const options = { task: "document", profileHint: profile.key };
    assertEquals(selectProfile(profile.key, undefined, context.profiles), selectProfile(profile.key));
    assertEquals(buildSystemPrompt({ ...options, profileSelection: context }), buildSystemPrompt(options));
  }
  for (const hint of ["", "unclassified synthetic subject", "resume cover letter", "Business Plan\nOffer Letter"]) {
    assertEquals(selectProfile(hint, "employment", context.profiles), selectProfile(hint, "employment"));
  }
  assert(Object.isFrozen(context) && Object.isFrozen(context.profiles));
  const fact = context.profiles[0].informationContract?.sections[0].requiredInformation[0];
  assert(fact && Object.isFrozen(fact));
  assertThrows(() => { fact.question = "Cannot change an accepted candidate"; }, TypeError);
  assertEquals(JSON.stringify(DIPS), before);
});

Deno.test("captured supplemental proposal remains private source data and follows existing prompt precedence", () => {
  const context = capturePromptProfileSelectionContext();
  assertEquals(context.supplementalBusinessProposal.key, "business-proposal");
  assert(Object.isFrozen(context.supplementalBusinessProposal.riskChecks));
  for (const profileHint of ["business proposal", "client proposal", "funding proposal", "grant proposal", "proposal"]) {
    const options = { task: "document", profileHint };
    assertEquals(buildSystemPrompt({ ...options, profileSelection: context }), buildSystemPrompt(options));
  }
  const original = buildSystemPrompt({ task: "document", profileHint: "business proposal", profileSelection: context });
  assert(original.includes(context.supplementalBusinessProposal.riskChecks[0]));
  // An independent context models a newly authored supplemental policy. This
  // is new-contract coverage; the private source constant is never exported
  // or changed merely to manufacture a predecessor regression.
  const changed = structuredClone(context);
  changed.supplementalBusinessProposal.riskChecks[0] = "SYNTHETIC_NEW_SUPPLEMENTAL_RULE";
  const revised = buildSystemPrompt({ task: "document", profileHint: "business proposal", profileSelection: changed });
  assert(revised.includes("SYNTHETIC_NEW_SUPPLEMENTAL_RULE"));
  assert(!original.includes("SYNTHETIC_NEW_SUPPLEMENTAL_RULE"));
  assertEquals(buildSystemPrompt({ task: "document", profileHint: "business proposal" }), original);
  assert(!buildSystemPrompt({ task: "document", profileHint: "business proposal", profileSelection: changed, resolvedProfile: null }).includes("DOCUMENT INTELLIGENCE PROFILE —"));
});
