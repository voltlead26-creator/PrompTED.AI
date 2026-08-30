import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";
import type { WorkspaceDocumentState } from "./workspace-store";

const { generateDocumentStream } = vi.hoisted(() => ({
  generateDocumentStream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return {
    ...actual,
    generateDocumentStream,
  };
});

import {
  sectionsNeedingInitialGeneration,
  shouldGenerateInitialDraft,
  streamInitialDraft,
} from "./document-generation";

function section(key: string, name: string, order: number): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: `section-${key}`,
    key,
    document_id: "doc-1",
    user_id: "user-1",
    name,
    order_index: order,
    content: "",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
  };
}

function workspace(): WorkspaceDocumentState {
  return {
    documentId: "doc-1",
    title: "Cover Letter",
    situation: "Apply for Warehouse Operations Manager",
    status: "draft",
    sections: [section("opening", "Opening & Role", 0), section("fit", "Why You Fit", 1)],
    generated: false,
    templateId: "cover-letter",
    conversationContext: "User supplied the role, employer and evidence.",
    uploadContext: "",
  };
}

const pending = {
  situation: "Apply for Warehouse Operations Manager",
  templateName: "Cover Letter",
  templateId: "cover-letter",
  conversationContext: "User supplied the role, employer and evidence.",
};

describe("streamInitialDraft", () => {
  beforeEach(() => {
    generateDocumentStream.mockReset();
    generateDocumentStream.mockResolvedValue(undefined);
  });

  it("routes workspace documents through the audited document pipeline", async () => {
    const onSection = vi.fn();

    await streamInitialDraft({
      outcomeId: "outcome-1",
      state: workspace(),
      pending,
      onSection,
    });

    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    expect(generateDocumentStream.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        template_id: "cover-letter",
        situation: "Apply for Warehouse Operations Manager",
        conversation_context: "User supplied the role, employer and evidence.",
        sections: [
          expect.objectContaining({
            key: "opening",
            label: "Opening & Role",
            required: true,
          }),
          expect.objectContaining({
            key: "fit",
            label: "Why You Fit",
            required: true,
          }),
        ],
      }),
    );
  });

  it("treats a required blank sibling as unfinished even when another section is populated", () => {
    const state = workspace();
    state.generated = true;
    state.sections[0]!.content = "I am applying for the Warehouse Operations Manager role.";

    expect(sectionsNeedingInitialGeneration(state).map((item) => item.key)).toEqual(["fit"]);
    expect(shouldGenerateInitialDraft(state, pending)).toBe(true);
  });

  it("requests only missing required sections when recovering a partial cached document", async () => {
    const state = workspace();
    state.generated = true;
    state.sections[0]!.content = "I am applying for the Warehouse Operations Manager role.";

    await streamInitialDraft({
      outcomeId: "outcome-1",
      state,
      pending,
      onSection: vi.fn(),
    });

    const request = generateDocumentStream.mock.calls[0]?.[0];
    expect(request?.sections).toEqual([
      expect.objectContaining({ key: "fit", label: "Why You Fit", required: true }),
    ]);
    expect(request?.sections).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "opening" })]),
    );
    expect(request?.conversation_context).toContain(
      "Existing final wording — preserve its voice and do not rewrite it",
    );
    expect(request?.conversation_context).toContain(
      "I am applying for the Warehouse Operations Manager role.",
    );
  });

  it("does not restart generation once every required section has final content", () => {
    const state = workspace();
    state.generated = true;
    state.sections[0]!.content = "I am applying for the Warehouse Operations Manager role.";
    state.sections[1]!.content = "My confirmed experience aligns with the role requirements.";

    expect(sectionsNeedingInitialGeneration(state)).toEqual([]);
    expect(shouldGenerateInitialDraft(state, pending)).toBe(false);
  });

  it("sends a maximum-size uploaded resume once through the dedicated upload channel", async () => {
    const uploadContext = `Uploaded document text:\n${"r".repeat(20_000)}`;
    const state = workspace();
    state.templateId = "resume";
    state.uploadContext = uploadContext;

    await streamInitialDraft({
      outcomeId: "outcome-1",
      state,
      pending: {
        situation: state.situation,
        templateName: "Resume",
        templateId: "resume",
        uploadContext,
        uploadId: "retained-upload-id",
      },
      onSection: vi.fn(),
    });

    const request = generateDocumentStream.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        upload_context: uploadContext,
        upload_id: "retained-upload-id",
      }),
    );
    expect(request).not.toHaveProperty("extracted_text");
  });

  it("forwards only final usable section events", async () => {
    const onSection = vi.fn();
    generateDocumentStream.mockImplementation(async (_input, onEvent) => {
      onEvent({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "TED will replace this scaffold",
      });
      onEvent({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "I am applying for the Warehouse Operations Manager role.",
      });
    });

    await streamInitialDraft({
      outcomeId: "outcome-1",
      state: workspace(),
      pending: null,
      onSection,
    });

    expect(onSection).toHaveBeenCalledTimes(1);
    expect(onSection).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "opening",
        content: "I am applying for the Warehouse Operations Manager role.",
      }),
    );
  });

  it("forwards usable draft section events for early workspace preview", async () => {
    const onDraftSection = vi.fn();
    generateDocumentStream.mockImplementation(
      async (
        _input,
        _onEvent,
        _signal,
        _onDesign,
        _onMissing,
        _onUnresolved,
        onDraft,
      ) => {
        onDraft?.({
          type: "draft_section",
          key: "opening",
          label: "Opening & Role",
          content: "I am applying for the Warehouse Operations Manager role.",
        });
        onDraft?.({
          type: "draft_section",
          key: "fit",
          label: "Why You Fit",
          content: "TED will replace this scaffold",
        });
      },
    );

    await streamInitialDraft({
      outcomeId: "outcome-1",
      state: workspace(),
      pending: null,
      onSection: vi.fn(),
      onDraftSection,
    });

    expect(onDraftSection).toHaveBeenCalledTimes(1);
    expect(onDraftSection).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "opening",
        content: "I am applying for the Warehouse Operations Manager role.",
      }),
    );
  });

  it("passes missing-information events through without converting them into blank sections", async () => {
    const onSection = vi.fn();
    const onMissingInfo = vi.fn();
    generateDocumentStream.mockImplementation(
      async (_input, _onEvent, _signal, _onDesign, onMissing) => {
        onMissing?.({
          type: "missing_info",
          sections: [
            {
              key: "opening",
              label: "Opening & Role",
              missing: ["Employer name"],
            },
          ],
        });
      },
    );

    await streamInitialDraft({
      outcomeId: "outcome-1",
      state: workspace(),
      pending: null,
      onSection,
      onMissingInfo,
    });

    expect(onSection).not.toHaveBeenCalled();
    expect(onMissingInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [expect.objectContaining({ key: "opening" })],
      }),
    );
  });
});
