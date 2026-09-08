import { describe, expect, it } from "vitest";
import type { Section } from "@prompted/shared";
import {
  applyGeneratedSection,
  applyGeneratedResult,
  mergeGenerationMissingInfo,
  type DocumentGenerationResult,
  applyRequiredSectionFallbacks,
  pendingDefaults,
  shouldGenerateInitialDraft,
  stateFromStored,
  storedFromState,
} from "./document-generation";
import { resolveGenerationTemplate } from "./document-generation-catalogue";
import type { StoredWorkspace, WorkspaceDocumentState } from "./workspace-store";

const SEED_SCAFFOLD =
  "Draft scaffold for Introduction.\n\nPurpose: Introduce the document.\n\nContext: Hiring a warehouse supervisor\n\nTED will replace this scaffold with generated content when the draft runs.";

const PURPOSE_ONLY_SECTION =
  "Prepare clear answers for questions about strengths, work style, motivation, challenges, and why this role is the right next step.";

function section(overrides: Partial<Section> = {}): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "section-1",
    document_id: "doc-1",
    user_id: "user-1",
    name: "Introduction",
    order_index: 0,
    content: "",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function state(overrides: Partial<WorkspaceDocumentState> = {}): WorkspaceDocumentState {
  return {
    documentId: "doc-1",
    title: "Offer Letter",
    situation: "Hiring a warehouse supervisor",
    status: "draft",
    sections: [section()],
    generated: false,
    templateId: "offer_letter",
    conversationContext: "User: I need to hire someone.",
    uploadContext: "Resume text",
    ...overrides,
  };
}

describe("document generation helpers", () => {
  it.each([
    { key: "unrelated", label: "Introduction" },
    { key: "unrelated", label: "Intro" },
    { key: "unrelated", label: "Something else" },
  ])(
    "rejects an unbound unknown key without label or blank-section reassignment: %j",
    (identity) => {
      const current = state();
      const original = structuredClone(current);
      expect(() =>
        applyGeneratedSection(current, { ...identity, content: "Unrelated generated wording." }),
      ).toThrow("DOCUMENT_GENERATION_SCOPE_INVALID");
      expect(current).toEqual(original);
    },
  );

  it("preserves stored identity and structure when a keyed section receives new wording", () => {
    const current = state({ sections: [section({ key: "introduction", status: "approved" })] });
    const next = applyGeneratedSection(current, {
      key: "introduction",
      label: "Provider replacement title",
      content: "Supported new wording.",
    });
    expect(next.sections[0]).toEqual({
      ...current.sections[0],
      content: "Supported new wording.",
      status: "draft",
      updated_at: expect.any(String),
    });
  });

  it("uses an explicit request-bound ID instead of another section's label or key", () => {
    const sibling = section({
      id: "kept",
      key: "introduction",
      content: "Approved sibling wording.",
      status: "approved",
    });
    const current = state({
      sections: [sibling, section({ id: "requested", name: "!!!", order_index: 1 })],
    });
    const event = {
      targetSectionId: "requested",
      key: "section_1",
      label: "Introduction",
      content: "Exact requested wording.",
    };
    const next = applyGeneratedSection(current, event);
    expect(next.sections[0]).toBe(sibling);
    expect(next.sections[1]).toEqual({
      ...current.sections[1],
      key: "section_1",
      content: "Exact requested wording.",
      status: "draft",
      updated_at: expect.any(String),
    });
  });

  it.each(["missing", "duplicate"])(
    "rejects a %s bound ID without falling back to an exact key",
    (kind) => {
      const current = state({
        sections: [
          section({ id: "same", key: "introduction" }),
          section({
            id: kind === "duplicate" ? "same" : "different",
            key: "request",
            order_index: 1,
          }),
        ],
      });
      const event = {
        targetSectionId: kind === "duplicate" ? "same" : "absent",
        key: "introduction",
        label: "Introduction",
        content: "Generated wording.",
      };
      expect(() => applyGeneratedSection(current, event)).toThrow(
        "DOCUMENT_GENERATION_SCOPE_INVALID",
      );
      expect(current.sections.every((item) => item.content === "")).toBe(true);
    },
  );

  it("rejects an ambiguous unbound keyless normalized name", () => {
    const current = state({
      sections: [
        section({ id: "one", name: "Introduction" }),
        section({ id: "two", name: "INTRODUCTION", order_index: 1 }),
      ],
    });
    expect(() =>
      applyGeneratedSection(current, {
        key: "introduction",
        label: "Introduction",
        content: "Generated wording.",
      }),
    ).toThrow("DOCUMENT_GENERATION_SCOPE_INVALID");
  });

  it("rejects a positional key for an unbound keyless section", () => {
    const current = state({ sections: [section({ name: "!!!" })] });
    expect(() =>
      applyGeneratedSection(current, {
        key: "section_1",
        label: "!!!",
        content: "Generated wording.",
      }),
    ).toThrow("DOCUMENT_GENERATION_SCOPE_INVALID");
  });

  it("rejects a provisional event at the canonical reducer boundary", () => {
    const current = state({ sections: [section({ key: "introduction" })] });
    expect(() =>
      applyGeneratedSection(current, {
        type: "draft_section",
        key: "introduction",
        label: "Introduction",
        content: "Provisional wording.",
      }),
    ).toThrow("DOCUMENT_GENERATION_SCOPE_INVALID");
    expect(current.sections[0]?.content).toBe("");
  });

  it("round-trips workspace state through storage without dropping context", () => {
    const current = state();
    const stored = storedFromState("outcome-1", current);
    const hydrated = stateFromStored(stored, {
      templateId: null,
      conversationContext: "",
      uploadContext: "",
    });

    expect(hydrated).toMatchObject(current);
    expect(stored.outcomeId).toBe("outcome-1");
  });

  it("uses pending outcome defaults when stored workspace has no context yet", () => {
    const workspace: StoredWorkspace = {
      documentId: "doc-1",
      outcomeId: "outcome-1",
      title: "Offer Letter",
      situation: "",
      status: "draft",
      sections: [section()],
    };

    const hydrated = stateFromStored(workspace, {
      templateId: "offer_letter",
      conversationContext: "Conversation transcript",
      uploadContext: "Upload text",
    });

    expect(hydrated.templateId).toBe("offer_letter");
    expect(hydrated.conversationContext).toBe("Conversation transcript");
    expect(hydrated.uploadContext).toBe("Upload text");
  });

  it("clears scaffold content when hydrating stored workspaces", () => {
    const workspace: StoredWorkspace = {
      documentId: "doc-1",
      outcomeId: "outcome-1",
      title: "Offer Letter",
      situation: "Hiring a warehouse supervisor",
      status: "draft",
      sections: [section({ content: SEED_SCAFFOLD })],
    };

    const hydrated = stateFromStored(workspace, {
      templateId: "offer-letter",
      conversationContext: "Transcript",
      uploadContext: "",
    });

    expect(hydrated.generated).toBe(false);
    expect(hydrated.sections[0]?.content).toBe("");
  });

  it("does not mistake unmarked document wording for a disposable scaffold", () => {
    const workspace: StoredWorkspace = {
      documentId: "doc-1",
      outcomeId: "outcome-1",
      title: "Interview Preparation Questions",
      situation: "Final-stage building manager interview",
      status: "draft",
      sections: [section({ name: "Questions About You", content: PURPOSE_ONLY_SECTION })],
      generated: true,
    };

    const hydrated = stateFromStored(workspace, {
      templateId: "interview-prep-questions",
      conversationContext: "Transcript with resume and clarifying answers",
      uploadContext: "Resume text",
    });

    expect(hydrated.generated).toBe(true);
    expect(hydrated.sections[0]?.content).toBe(PURPOSE_ONLY_SECTION);
    expect(shouldGenerateInitialDraft(hydrated, null)).toBe(false);
  });

  it("ignores stale generated flags when stored sections only contain scaffold", () => {
    const workspace: StoredWorkspace = {
      documentId: "doc-1",
      outcomeId: "outcome-1",
      title: "Offer Letter",
      situation: "Hiring a warehouse supervisor",
      status: "draft",
      sections: [section({ content: SEED_SCAFFOLD })],
      generated: true,
    };

    const hydrated = stateFromStored(workspace, {
      templateId: "offer-letter",
      conversationContext: "Transcript",
      uploadContext: "",
    });

    expect(hydrated.generated).toBe(false);
    expect(shouldGenerateInitialDraft(hydrated, null)).toBe(true);
  });

  it("preserves unmarked content when storing a workspace", () => {
    const stored = storedFromState(
      "outcome-1",
      state({
        generated: true,
        sections: [section({ content: PURPOSE_ONLY_SECTION })],
      }),
    );

    expect(stored.generated).toBe(true);
    expect(stored.sections[0]?.content).toBe(PURPOSE_ONLY_SECTION);
  });

  it("preserves concise final resume wording that describes outcomes", () => {
    const finalResumeWording =
      "Warehouse supervisor who reduces picking errors, helps teams work safely, and ensures orders leave on time.";
    const stored = storedFromState(
      "outcome-1",
      state({
        title: "Resume",
        templateId: "resume",
        generated: true,
        sections: [section({ name: "Professional Summary", content: finalResumeWording })],
      }),
    );

    expect(stored.generated).toBe(true);
    expect(stored.sections[0]?.content).toBe(finalResumeWording);
  });

  it("generates when required content is missing, even if a stale generated flag is set", () => {
    expect(shouldGenerateInitialDraft(state(), null)).toBe(true);
    expect(
      shouldGenerateInitialDraft(state({ sections: [section({ content: SEED_SCAFFOLD })] }), null),
    ).toBe(true);
    expect(
      shouldGenerateInitialDraft(
        state({ sections: [section({ content: SEED_SCAFFOLD })], generated: true }),
        null,
      ),
    ).toBe(true);
    expect(
      shouldGenerateInitialDraft(
        state({ sections: [section({ content: "Already drafted." })] }),
        null,
      ),
    ).toBe(false);
    expect(shouldGenerateInitialDraft(state({ generated: true }), null)).toBe(true);
    expect(
      shouldGenerateInitialDraft(
        state({ situation: "", conversationContext: "", uploadContext: "" }),
        null,
      ),
    ).toBe(false);
  });

  it("applies streamed wording by the exact generated key of a historical keyless section", () => {
    const next = applyGeneratedSection(state(), {
      type: "section",
      key: "introduction",
      label: "Provider display label",
      content: "Generated intro",
    });

    expect(next.sections[0]?.content).toBe("Generated intro");
  });

  it("does not let blank streamed content erase a scaffold", () => {
    const current = state({ sections: [section({ content: SEED_SCAFFOLD })] });
    const next = applyGeneratedSection(current, {
      type: "section",
      key: "intro",
      label: "Introduction",
      content: "   ",
    });

    expect(next.sections[0]?.content).toBe(SEED_SCAFFOLD);
  });

  it("converts blank required sections into visible TED placeholders", () => {
    const next = applyRequiredSectionFallbacks(
      state({
        title: "Complaint Letter",
        templateId: "complaint_letter",
        sections: [
          section({
            id: "section-issue",
            key: "issue",
            name: "The Issue",
            content: "",
          }),
          section({
            id: "section-impact",
            key: "impact",
            name: "Impact",
            content: "Existing factual wording.",
          }),
        ],
      }),
    );

    expect(next.generated).toBe(true);
    expect(next.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(next.sections[0]?.key).toBe("issue");
    expect(next.sections[1]?.content).toBe("Existing factual wording.");
    expect(next.unresolvedPlaceholders).toEqual([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        informationKey: "section_content",
        label: "The Issue needs your input",
        requiredForExport: true,
      }),
    ]);
  });

  it("treats tag-only editor HTML as a blank required section", () => {
    const next = applyRequiredSectionFallbacks(
      state({
        title: "Complaint Letter",
        templateId: "complaint_letter",
        sections: [
          section({
            id: "section-issue",
            key: "issue",
            name: "The Issue",
            content: '<p><br class="ProseMirror-trailingBreak"></p>',
          }),
        ],
      }),
    );

    expect(next.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(next.unresolvedPlaceholders?.[0]).toEqual(
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
      }),
    );
  });

  it("adds visible placeholders for optional blank sections without blocking export", () => {
    const current = state({
      sections: [
        section({
          id: "section-optional",
          key: "optional_note",
          name: "Optional Note",
          content: "",
          is_required: false,
        }),
      ],
    });
    const next = applyRequiredSectionFallbacks(current);

    expect(next.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:offer_letter.optional_note.section_content:Optional Note needs your input}}",
    );
    expect(next.unresolvedPlaceholders).toEqual([
      expect.objectContaining({
        id: "offer_letter.optional_note.section_content",
        requiredForExport: false,
      }),
    ]);
  });

  it("preserves existing unresolved placeholder metadata when adding workspace fallbacks", () => {
    const next = applyRequiredSectionFallbacks(
      state({
        unresolvedPlaceholders: [
          {
            id: "complaint_letter.recipient.name",
            profileKey: "complaint_letter",
            sectionKey: "recipient",
            informationKey: "name",
            label: "Recipient name",
            question: "Who should receive the letter?",
            factType: "person",
            requiredForExport: true,
            neutralReplacementOptions: [],
          },
        ],
      }),
    );

    expect(next.unresolvedPlaceholders?.map((placeholder) => placeholder.id)).toEqual([
      "complaint_letter.recipient.name",
      "offer_letter.introduction.section_content",
    ]);
  });

  it("rejects generic generated content that has no exact single-section destination", () => {
    const current = state({ sections: [section({ name: "Professional Summary" })] });
    expect(() =>
      applyGeneratedSection(current, {
        type: "section",
        key: "body",
        label: "Content",
        content: "Generated summary",
      }),
    ).toThrow("DOCUMENT_GENERATION_SCOPE_INVALID");
    expect(current.sections[0]?.content).toBe("");
    const next = applyGeneratedSection(current, {
      type: "section",
      key: "professional_summary",
      label: "Content",
      content: "Generated summary",
    });
    expect(next.sections[0]).toEqual({
      ...current.sections[0],
      key: "professional_summary",
      content: "Generated summary",
      updated_at: expect.any(String),
    });
  });

  it("hydrates pending defaults without loading the full template catalogue", () => {
    const defaults = pendingDefaults({
      situation: "Hiring",
      templateName: "Offer Letter",
      conversationContext: "Transcript",
    });

    expect(defaults.templateName).toBe("Offer Letter");
    expect(defaults.templateId).toBeNull();
    expect(defaults.conversationContext).toBe("Transcript");
  });

  it("resolves a legacy name through the catalogue only at generation time", () => {
    const pending = {
      situation: "Hiring",
      templateName: "Offer Letter",
      conversationContext: "Transcript",
    };
    const resolved = resolveGenerationTemplate(pending, pendingDefaults(pending));

    expect(resolved.defaults.templateId).toBe("offer-letter");
    expect(resolved.template?.name).toBe("Offer Letter");
  });
});

function placeholder(sectionKey: string, id = `contract.${sectionKey}.detail`) {
  return {
    id,
    sectionKey,
    profileKey: "contract",
    informationKey: "detail",
    label: "Confirmed detail",
    question: "What is the confirmed detail?",
    factType: "detail",
    requiredForExport: true,
    neutralReplacementOptions: [],
    sharedResolutionKey: "same-confirmed-fact",
  };
}

function resultFor(key = "introduction", sectionId = "section-1"): DocumentGenerationResult {
  return {
    documentId: "doc-1",
    requestId: "accepted-request",
    scope: [{ key, sectionId }],
    sections: [
      {
        type: "section",
        targetSectionId: sectionId,
        key,
        label: "Provider heading",
        content: "Confirmed new wording.",
      },
    ],
    missingInfo: [],
    unresolvedPlaceholders: [],
  };
}

describe("complete generation result adoption", () => {
  it.each(["sibling", "Issue__DETAILS", "issue-details"])(
    "replaces only exact scoped metadata while preserving %s",
    (siblingKey) => {
      const currentPlaceholder = placeholder("issue_details");
      const siblingPlaceholder = placeholder(siblingKey);
      const stalePlaceholder = placeholder("unknown-historical-key");
      const sibling = section({
        id: "sibling-id",
        key: siblingKey,
        status: "approved",
        content: "Approved wording.",
        order_index: 1,
      });
      const current = state({
        sections: [section({ key: "issue_details" }), sibling],
        unresolvedPlaceholders: [currentPlaceholder, siblingPlaceholder, stalePlaceholder],
      });
      const result = resultFor("issue_details");
      const next = applyGeneratedResult(current, result);
      expect(next.sections[0]?.content).toBe("Confirmed new wording.");
      expect(next.sections[0]?.name).toBe("Introduction");
      expect(next.sections[1]).toBe(sibling);
      expect(next.unresolvedPlaceholders).toEqual([siblingPlaceholder, stalePlaceholder]);
      expect(next.unresolvedPlaceholders?.[0]).toBe(siblingPlaceholder);
      const siblingQuestion = { key: siblingKey, label: "Sibling", missing: ["Confirmed detail"] };
      expect(
        mergeGenerationMissingInfo(
          [{ key: "issue_details", label: "Issue", missing: ["Old fact"] }, siblingQuestion],
          result,
        ),
      ).toEqual([siblingQuestion]);
      expect(current.unresolvedPlaceholders).toEqual([
        currentPlaceholder,
        siblingPlaceholder,
        stalePlaceholder,
      ]);
    },
  );

  it("accepts exact new placeholder wording and retains unrelated blockers", () => {
    const incoming = placeholder("introduction");
    const result = resultFor();
    result.sections[0]!.content = `I contacted {{TED_PLACEHOLDER:${incoming.id}:${incoming.label}}}.`;
    result.unresolvedPlaceholders = [incoming];
    result.missingInfo = [
      { key: "introduction", label: "Introduction", missing: ["Contact name"] },
    ];
    const next = applyGeneratedResult(state(), result);
    expect(next.unresolvedPlaceholders).toEqual([incoming]);
    expect(next.sections[0]?.key).toBe("introduction");
    expect(mergeGenerationMissingInfo([], result)).toEqual(result.missingInfo);
  });

  it.each([
    "retained collision",
    "duplicate incoming",
    "foreign metadata",
    "foreign question",
    "orphaned sibling token",
    "undeclared token",
    "metadata without token",
    "different stored key",
    "empty result",
    "blank body",
    "scaffold body",
    "empty HTML",
  ])("rejects %s before candidate mutation", (failure) => {
    const old = placeholder("introduction");
    const other = placeholder("sibling");
    const current = state({
      sections: [
        section({ key: "introduction" }),
        section({
          id: "sibling-id",
          key: "sibling",
          content: "Approved wording.",
          status: "approved",
          order_index: 1,
        }),
      ],
      unresolvedPlaceholders: [old, other],
    });
    const result = resultFor();
    if (failure === "retained collision")
      result.unresolvedPlaceholders = [{ ...old, id: other.id }];
    if (failure === "duplicate incoming") result.unresolvedPlaceholders = [old, old];
    if (failure === "foreign metadata") result.unresolvedPlaceholders = [placeholder("unknown")];
    if (failure === "foreign question")
      result.missingInfo = [{ key: "unknown", label: "Unknown", missing: ["Private detail"] }];
    if (failure === "orphaned sibling token")
      current.sections[1]!.content = `{{TED_PLACEHOLDER:${old.id}:${old.label}}}`;
    if (failure === "undeclared token")
      result.sections[0]!.content = `{{TED_PLACEHOLDER:${old.id}:${old.label}}}`;
    if (failure === "metadata without token") result.unresolvedPlaceholders = [old];
    if (failure === "different stored key") current.sections[0]!.key = "other-stored-key";
    if (failure === "empty result") {
      result.scope = [];
      result.sections = [];
    }
    if (failure === "blank body") result.sections[0]!.content = " ";
    if (failure === "scaffold body") result.sections[0]!.content = "TED will replace this scaffold";
    if (failure === "empty HTML") result.sections[0]!.content = "<p><br></p>";
    const original = structuredClone(current);
    expect(() => {
      applyGeneratedResult(current, result);
      mergeGenerationMissingInfo([], result);
    }).toThrow(/DOCUMENT_GENERATION_SCOPE_INVALID|DOCUMENT_FINAL_WORDING_INVALID/);
    expect(current).toEqual(original);
  });
});

it("rejects a downgrade of an existing unresolved required fact", () => {
  const required = placeholder("introduction");
  const content = `Please contact {{TED_PLACEHOLDER:${required.id}:${required.label}}}.`;
  const current = state({
    sections: [section({ key: "introduction", content })],
    unresolvedPlaceholders: [required],
  });
  const result = resultFor();
  result.sections[0]!.content = content;
  result.unresolvedPlaceholders = [{ ...required, requiredForExport: false }];
  expect(() => applyGeneratedResult(current, result)).toThrow("DOCUMENT_GENERATION_SCOPE_INVALID");
  expect(current.unresolvedPlaceholders).toEqual([required]);
});

it.each([false, true])(
  "checks an existing neutral option with changed=%s by its values",
  (changed) => {
    const option = {
      id: "general",
      label: "Use general wording",
      value: "the contact",
      suitability: "Optional contact",
      clearsExportWarning: false,
      regenerateSurroundingWording: false,
    };
    const accepted = { ...placeholder("introduction"), neutralReplacementOptions: [option] };
    const current = state({
      sections: [section({ key: "introduction" })],
      unresolvedPlaceholders: [accepted],
    });
    const result = resultFor();
    result.sections[0]!.content = `Please contact {{TED_PLACEHOLDER:${accepted.id}:${accepted.label}}}.`;
    result.unresolvedPlaceholders = [
      { ...accepted, neutralReplacementOptions: [{ ...option, clearsExportWarning: changed }] },
    ];
    if (changed)
      expect(() => applyGeneratedResult(current, result)).toThrow(
        "DOCUMENT_GENERATION_SCOPE_INVALID",
      );
    else
      expect(applyGeneratedResult(current, result).unresolvedPlaceholders).toEqual(
        result.unresolvedPlaceholders,
      );
  },
);
