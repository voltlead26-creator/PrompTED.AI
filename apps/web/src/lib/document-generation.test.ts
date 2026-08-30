import { describe, expect, it } from "vitest";
import type { Section } from "@prompted/shared";
import {
  applyGeneratedSection,
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

  it("applies streamed section content by section label", () => {
    const next = applyGeneratedSection(state(), {
      type: "section",
      key: "intro",
      label: "Introduction",
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

  it("applies generic generated content to a single-section workspace", () => {
    const next = applyGeneratedSection(
      state({ sections: [section({ name: "Professional Summary" })] }),
      {
        type: "section",
        key: "body",
        label: "Content",
        content: "Generated summary",
      },
    );

    expect(next.sections[0]?.content).toBe("Generated summary");
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
